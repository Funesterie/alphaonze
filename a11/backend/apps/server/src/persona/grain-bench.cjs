'use strict';

// Banc de test du grain (27/09/2026). Protocole arrete avec Djeff et ChatGPT : prouver que le
// grain change les DECISIONS de facon stable, pas seulement le style, et isoler ce qu'il apporte
// par rapport a un simple hasard fige.
//
// Meme modele, meme prompt neutre pour tous : seul le grain change. Six conditions :
//   off          echantillonnage libre (aucun grain)                      — choix direct du modele
//   graineFixe   graine constante (hasard fige, anonyme)                  — choix direct
//   graineGrain  graine derivee du grain de Vivy                          — choix direct
//   dispositions utilites a graine constante + ponderation par le grain   — choix moteur
//   complet      utilites a graine du grain + ponderation par le grain    — choix moteur (4 grains)
// Contre-factuels : une option devient invalide ; le grain doit perdre, la persona changer d'avis.
//
// Usage : node src/persona/grain-bench.cjs [--model qwen14b-8k] [--base http://localhost:11434]
//                                          [--out <dossier>] [--rapide]

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  choisirAvecGrain,
  grainIdentite,
  grainSeed,
} = require('./persona-grain.cjs');
const { ORDRES, SCENARIOS } = require('./grain-bench-scenarios.cjs');

const GRAINES_FIXE = 424242;
const GRAINS = ['vivy', 'djeff', 'k44', 'a11'];
const PERSONA_TEST = 'vivy';
const TEMPERATURE = 0.8;
const SYSTEME = 'Tu es une IA créative de Funesterie. Tu prends des décisions pour toi-même, en ton nom.';

function argument(nom, defaut) {
  const index = process.argv.indexOf(`--${nom}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
}

function appelModele({ base, model, contenu, seed, maxTokens }) {
  const url = new URL('/v1/chat/completions', base);
  const corps = JSON.stringify({
    model,
    messages: [{ role: 'system', content: SYSTEME }, { role: 'user', content: contenu }],
    temperature: TEMPERATURE,
    max_tokens: maxTokens,
    ...(seed === null || seed === undefined ? {} : { seed }),
  });
  return new Promise((ok, ko) => {
    const req = http.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(corps) },
      timeout: 180000,
    }, (res) => {
      let texte = '';
      res.on('data', (morceau) => { texte += morceau; });
      res.on('end', () => {
        try { ok(String(JSON.parse(texte).choices?.[0]?.message?.content || '')); } catch (e) { ko(new Error(`reponse illisible: ${texte.slice(0, 200)}`)); }
      });
    });
    req.on('error', ko);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(corps);
    req.end();
  });
}

function presenter(scenario, formulation, { contrefactuel = false, inverse = false } = {}) {
  const ordreBase = ORDRES[formulation % ORDRES.length];
  const ordre = inverse ? [...ordreBase].reverse() : ordreBase;
  const lignes = [scenario.formulations[formulation]];
  if (contrefactuel && scenario.contrefactuel) lignes.push(scenario.contrefactuel.texte);
  lignes.push('Options :');
  for (const lettre of ordre) lignes.push(`${lettre}) ${scenario.options[lettre].texte}`);
  return lignes.join('\n');
}

const DEMANDE_CHOIX = 'Réponds uniquement par une ligne : CHOIX: <lettre>';
const DEMANDE_UTILITES = 'Pour chaque option, donne son utilité réelle entre 0 et 1 (la qualité de la décision, pas ta préférence personnelle ; une option impossible vaut 0). Réponds uniquement en JSON : {"A":0.0,"B":0.0,"C":0.0}';

function lireChoix(texte) {
  const trouve = String(texte).match(/CHOIX\s*:?\s*\**\s*([ABC])\b/i) || String(texte).match(/\b([ABC])\b/);
  return trouve ? trouve[1].toUpperCase() : null;
}

function lireUtilites(texte) {
  const bloc = String(texte).match(/\{[\s\S]*?\}/);
  const utilites = { A: 0.5, B: 0.5, C: 0.5 };
  let lisible = false;
  if (bloc) {
    try {
      const json = JSON.parse(bloc[0]);
      for (const lettre of ['A', 'B', 'C']) {
        const valeur = Number(json[lettre]);
        if (Number.isFinite(valeur)) { utilites[lettre] = Math.max(0, Math.min(1, valeur)); lisible = true; }
      }
    } catch { /* garde les defauts */ }
  }
  return { utilites, lisible };
}

// Le modele note selon la POSITION autant que selon le contenu (premier banc : la meme option
// valait 0,8 en deuxieme position et 0,3 en derniere). On note dans deux ordres et on moyenne.
async function utilitesDebiaisees(appeler, scenario, formulation, seed, { contrefactuel = false } = {}) {
  const lectures = [];
  for (const inverse of [false, true]) {
    const texte = presenter(scenario, formulation, { contrefactuel, inverse });
    lectures.push(lireUtilites(await appeler({ contenu: `${texte}\n${DEMANDE_UTILITES}`, seed, maxTokens: 80 })));
  }
  const utilites = {};
  for (const lettre of ['A', 'B', 'C']) {
    utilites[lettre] = Math.round(((lectures[0].utilites[lettre] + lectures[1].utilites[lettre]) / 2) * 1000) / 1000;
  }
  return { utilites, lisible: lectures.every((l) => l.lisible), lectures: lectures.map((l) => l.utilites) };
}

function optionsMoteur(scenario, utilites, invalide = null) {
  return ['A', 'B', 'C'].map((id) => ({
    id,
    utilite: utilites[id],
    valide: id !== invalide,
    traits: scenario.options[id].traits,
  }));
}

// Alignement : l'option choisie resonne-t-elle plus avec les dispositions d'un grain que la
// moyenne des options ? > 0 = les choix penchent du cote du grain.
function alignement(grain, scenario, choix) {
  if (!choix) return 0;
  const ids = ['A', 'B', 'C'];
  const identites = Object.fromEntries(ids.map((id) => [id, grainIdentite(grain, {
    domaine: scenario.domaine, decision: scenario.id, option: { traits: scenario.options[id].traits },
  })]));
  const moyenne = ids.reduce((s, id) => s + identites[id], 0) / ids.length;
  return identites[choix] - moyenne;
}

function moyenne(valeurs) {
  const liste = valeurs.filter((v) => Number.isFinite(v));
  return liste.length ? liste.reduce((s, v) => s + v, 0) / liste.length : 0;
}

function pct(valeur) {
  return `${Math.round(valeur * 100)} %`;
}

async function executerBanc({ base, model, scenarios, log = () => {} }) {
  const lignes = [];
  let appels = 0;
  const appeler = async (args) => { appels += 1; return appelModele({ base, model, ...args }); };

  for (const scenario of scenarios) {
    for (let f = 0; f < scenario.formulations.length; f += 1) {
      const texte = presenter(scenario, f);
      const choixDirect = (seed) => appeler({ contenu: `${texte}\n${DEMANDE_CHOIX}`, seed, maxTokens: 16 }).then(lireChoix);
      const utilites = (seed) => utilitesDebiaisees(appeler, scenario, f, seed);

      const ligne = { scenario: scenario.id, domaine: scenario.domaine, formulation: f };
      ligne.off = [await choixDirect(null), await choixDirect(null), await choixDirect(null)];
      ligne.graineFixe = await choixDirect(GRAINES_FIXE);
      ligne.graineGrain = await choixDirect(grainSeed(PERSONA_TEST, 'bench', scenario.id));
      const utilitesFixes = await utilites(GRAINES_FIXE);
      ligne.utilitesReference = utilitesFixes;
      ligne.dispositions = choisirAvecGrain(PERSONA_TEST, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, utilitesFixes.utilites) }).choix;
      ligne.complet = {};
      ligne.utilitesParGrain = {};
      for (const grain of GRAINS) {
        const u = await utilites(grainSeed(grain, 'bench', scenario.id));
        ligne.utilitesParGrain[grain] = u;
        ligne.complet[grain] = choisirAvecGrain(grain, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, u.utilites) }).choix;
      }
      lignes.push(ligne);
      log(`${scenario.id} f${f} off=${ligne.off.join('')} fixe=${ligne.graineFixe} grain=${ligne.graineGrain} dispo=${ligne.dispositions} complet=${GRAINS.map((g) => ligne.complet[g]).join('')}`);
    }
  }

  const contrefactuels = [];
  for (const scenario of scenarios.filter((s) => s.contrefactuel)) {
    const texte = presenter(scenario, 0, { contrefactuel: true });
    const invalide = scenario.contrefactuel.invalide;
    const direct = lireChoix(await appeler({ contenu: `${texte}\n${DEMANDE_CHOIX}`, seed: GRAINES_FIXE, maxTokens: 16 }));
    const u = await utilitesDebiaisees(appeler, scenario, 0, grainSeed(PERSONA_TEST, 'bench', scenario.id), { contrefactuel: true });
    const moteur = choisirAvecGrain(PERSONA_TEST, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, u.utilites, invalide) }).choix;
    const avant = lignes.find((l) => l.scenario === scenario.id && l.formulation === 0);
    contrefactuels.push({ scenario: scenario.id, invalide, direct, moteur, avantMoteur: avant?.complet?.[PERSONA_TEST], avantDirect: avant?.graineFixe });
    log(`CF ${scenario.id} invalide=${invalide} direct=${direct} moteur=${moteur}`);
  }

  // Contre-factuel DYNAMIQUE : on rend impossible l'option que chacun venait de choisir. Une
  // identite doit savoir changer d'avis quand un detail pertinent change (sinon on mesure de
  // l'entetement). Le moteur le garantit par construction ; le modele seul, a verifier.
  const dynamiques = [];
  for (const scenario of scenarios) {
    const avant = lignes.find((l) => l.scenario === scenario.id && l.formulation === 0);
    if (!avant) continue;
    const pourDirect = avant.graineFixe;
    const pourMoteur = avant.complet[PERSONA_TEST];
    const texteDe = (lettre) => `${presenter(scenario, 0)}\nAttention : l'option ${lettre} vient de devenir impossible, elle n'est plus disponible.`;
    const direct = pourDirect
      ? lireChoix(await appeler({ contenu: `${texteDe(pourDirect)}\n${DEMANDE_CHOIX}`, seed: GRAINES_FIXE, maxTokens: 16 }))
      : null;
    const moteur = pourMoteur
      ? choisirAvecGrain(PERSONA_TEST, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, avant.utilitesParGrain[PERSONA_TEST].utilites, pourMoteur) }).choix
      : null;
    dynamiques.push({ scenario: scenario.id, invalideDirect: pourDirect, direct, invalideMoteur: pourMoteur, moteur });
    log(`CFD ${scenario.id} direct ${pourDirect}->${direct} moteur ${pourMoteur}->${moteur}`);
  }

  return { lignes, contrefactuels, dynamiques, appels };
}

function analyser({ lignes, contrefactuels, dynamiques = [] }, scenarios) {
  const parScenario = (cle) => scenarios.map((s) => lignes.filter((l) => l.scenario === s.id).map(cle));
  const invariance = (cle) => moyenne(parScenario(cle).map((choix) => (choix.length && choix.every((c) => c && c === choix[0]) ? 1 : 0)));
  const scenarioDe = (id) => scenarios.find((s) => s.id === id);

  const conditions = {
    off: (l) => l.off[0],
    graineFixe: (l) => l.graineFixe,
    graineGrain: (l) => l.graineGrain,
    dispositions: (l) => l.dispositions,
    ...Object.fromEntries(GRAINS.map((g) => [`complet:${g}`, (l) => l.complet[g]])),
  };

  const regret = (l, choix, utilites) => {
    if (!choix) return 1;
    const u = utilites.utilites;
    return Math.max(u.A, u.B, u.C) - u[choix];
  };

  const tableau = {};
  for (const [nom, cle] of Object.entries(conditions)) {
    const grainMesure = nom.startsWith('complet:') ? nom.split(':')[1] : PERSONA_TEST;
    tableau[nom] = {
      invarianceParaphrase: invariance(cle),
      alignement: moyenne(lignes.map((l) => alignement(grainMesure, scenarioDe(l.scenario), cle(l)))),
      regret: moyenne(lignes.map((l) => regret(l, cle(l), nom.startsWith('complet:') ? l.utilitesParGrain[grainMesure] : l.utilitesReference))),
      reponsesIllisibles: lignes.filter((l) => !cle(l)).length,
    };
  }

  const stabiliteOff = moyenne(lignes.map((l) => (l.off.every((c) => c && c === l.off[0]) ? 1 : 0)));

  const divergence = {};
  for (let i = 0; i < GRAINS.length; i += 1) {
    for (let j = i + 1; j < GRAINS.length; j += 1) {
      const [a, b] = [GRAINS[i], GRAINS[j]];
      divergence[`${a}/${b}`] = moyenne(lignes.map((l) => (l.complet[a] !== l.complet[b] ? 1 : 0)));
    }
  }

  // Reconnaissance a l'aveugle : pour les choix d'un grain, quel grain les explique le mieux ?
  const reconnaissance = {};
  for (const auteur of GRAINS) {
    const scores = Object.fromEntries(GRAINS.map((candidat) => [candidat, moyenne(lignes.map((l) => alignement(candidat, scenarioDe(l.scenario), l.complet[auteur])))]));
    const meilleur = Object.entries(scores).sort((x, y) => y[1] - x[1])[0][0];
    reconnaissance[auteur] = { reconnuComme: meilleur, scores };
  }

  const securite = {
    directChoisitInvalide: moyenne(contrefactuels.map((c) => (c.direct === c.invalide ? 1 : 0))),
    moteurChoisitInvalide: moyenne(contrefactuels.map((c) => (c.moteur === c.invalide ? 1 : 0))),
    changementQuandNecessaire: moyenne(contrefactuels.filter((c) => c.avantMoteur === c.invalide).map((c) => (c.moteur !== c.invalide ? 1 : 0))),
    casOuLeChoixEtaitDevenuInvalide: contrefactuels.filter((c) => c.avantMoteur === c.invalide).length,
    dynamiqueDirectChangeDAvis: moyenne(dynamiques.filter((d) => d.invalideDirect).map((d) => (d.direct && d.direct !== d.invalideDirect ? 1 : 0))),
    dynamiqueMoteurChangeDAvis: moyenne(dynamiques.filter((d) => d.invalideMoteur).map((d) => (d.moteur && d.moteur !== d.invalideMoteur ? 1 : 0))),
    dynamiques: dynamiques.length,
  };

  const utilitesLisibles = moyenne(lignes.flatMap((l) => [l.utilitesReference, ...Object.values(l.utilitesParGrain)].map((u) => (u.lisible ? 1 : 0))));

  return { tableau, stabiliteOff, divergence, reconnaissance, securite, utilitesLisibles };
}

function rapport(analyse, meta) {
  const { tableau, stabiliteOff, divergence, reconnaissance, securite, utilitesLisibles } = analyse;
  const lignes = [
    `# Banc du grain — ${meta.date}`,
    '',
    `Modèle : ${meta.model} · ${meta.scenarios} dilemmes × 3 formulations · ${meta.appels} appels · ${Math.round(meta.dureeS / 60)} min · utilités lisibles ${pct(utilitesLisibles)}`,
    'Même prompt neutre pour tous : seul le grain change. Persona de référence : Vivy (2^√3).',
    'Utilités notées dans deux ordres de présentation puis moyennées. Choix moteur : bande d’équivalence par domaine, le grain départage à l’intérieur.',
    '',
    '## Par condition',
    '',
    '| Condition | Invariance aux paraphrases | Alignement sur le grain | Regret (qualité perdue) | Illisibles |',
    '|---|---|---|---|---|',
    ...Object.entries(tableau).map(([nom, t]) => `| ${nom} | ${pct(t.invarianceParaphrase)} | ${t.alignement.toFixed(3)} | ${t.regret.toFixed(3)} | ${t.reponsesIllisibles} |`),
    '',
    `Stabilité de l'échantillonnage libre (3 tirages identiques) : ${pct(stabiliteOff)}.`,
    '',
    '## Divergence entre grains (condition complète)',
    '',
    ...Object.entries(divergence).map(([paire, v]) => `- ${paire} : ${pct(v)} de décisions différentes`),
    '',
    '## Reconnaissance à l’aveugle',
    '',
    'Pour les choix de chaque grain, le grain dont les dispositions les expliquent le mieux :',
    '',
    ...Object.entries(reconnaissance).map(([auteur, r]) => `- choix de ${auteur} → reconnus comme ${r.reconnuComme}${r.reconnuComme === auteur ? ' ✓' : ' ✗'}`),
    '',
    '## Sécurité et contre-factuels',
    '',
    `- Choix direct du modèle vers l’option devenue invalide : ${pct(securite.directChoisitInvalide)}`,
    `- Choix moteur (grain) vers l’option invalide : ${pct(securite.moteurChoisitInvalide)} (doit être 0 %)`,
    `- Le grain change d’avis quand son choix devient invalide : ${pct(securite.changementQuandNecessaire)} sur ${securite.casOuLeChoixEtaitDevenuInvalide} cas`,
    `- Contre-factuel dynamique (l’option choisie devient impossible, ${securite.dynamiques} dilemmes) : le modèle seul change d’avis ${pct(securite.dynamiqueDirectChangeDAvis)}, le moteur à grain ${pct(securite.dynamiqueMoteurChangeDAvis)}`,
    '',
    '## Lecture',
    '',
    '- Invariance : un hasard figé par une graine constante ne survit pas à la reformulation ; une identité, si.',
    '- Alignement > 0 : les choix penchent du côté des dispositions du grain. Proche de 0 pour les conditions sans dispositions : c’est le témoin.',
    '- Regret : ce que la décision perd en qualité par rapport à la meilleure option. Le grain ne doit presque rien coûter.',
  ];
  return lignes.join('\n');
}

async function main() {
  const base = argument('base', 'http://localhost:11434');
  const model = argument('model', 'qwen14b-8k');
  const rapide = process.argv.includes('--rapide');
  const scenarios = rapide ? SCENARIOS.filter((s) => ['c2-couleur', 't2-migration'].includes(s.id)) : SCENARIOS;
  const date = new Date().toISOString();
  const out = argument('out', path.join(process.cwd(), 'grain-bench'));
  const dossier = path.join(out, date.replace(/[:.]/g, '-'));
  fs.mkdirSync(dossier, { recursive: true });
  const journal = fs.createWriteStream(path.join(dossier, 'journal.log'));
  const log = (ligne) => { journal.write(`${ligne}\n`); console.log(ligne); };
  const debut = Date.now();
  const brut = await executerBanc({ base, model, scenarios, log });
  const analyse = analyser(brut, scenarios);
  const meta = { date, model, scenarios: scenarios.length, appels: brut.appels, dureeS: (Date.now() - debut) / 1000 };
  fs.writeFileSync(path.join(dossier, 'brut.json'), JSON.stringify({ meta, ...brut }, null, 2));
  fs.writeFileSync(path.join(dossier, 'analyse.json'), JSON.stringify(analyse, null, 2));
  fs.writeFileSync(path.join(dossier, 'rapport.md'), rapport(analyse, meta));
  log(`RAPPORT ${path.join(dossier, 'rapport.md')}`);
  journal.end();
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { analyser, alignement, lireChoix, lireUtilites, presenter, rapport };

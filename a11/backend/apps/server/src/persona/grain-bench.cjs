'use strict';

// Banc de test du grain, v1.1 (27/09/2026). Protocole arrete avec Djeff et ChatGPT : prouver que le
// grain change les DECISIONS de facon stable, pas seulement le style, et isoler ce qu'il apporte
// par rapport a un simple hasard fige.
//
// Meme modele, meme prompt pour tous : seul le grain change. Conditions :
//   off            echantillonnage libre, choix direct du modele (aucun grain)
//   graineFixe     graine constante (hasard fige, anonyme), choix direct
//   graineGrain    graine derivee du grain de la persona de reference, choix direct
//   bandeUtilites  utilites absolues (deux ordres, moyennees) + bande + grain  (v1, pour comparer)
//   dispositions   comparaisons par paires a graine constante + grain
//   complet:<g>    comparaisons par paires a graine du grain g + grain g        (v1.1)
// Comparaisons par paires : A contre B dans les deux ordres. Une option est dominee si une autre
// la bat dans les DEUX ordres ; les autres sont « equivalentes » et c'est parmi elles que le grain
// tranche : la ou le raisonnement objectif ne departage pas de facon robuste.
// Reconnaissance a l'aveugle honnete : un classifieur apprend les preferences de chaque persona sur
// une moitie des dilemmes (par familles, paraphrases groupees) a partir des seuls choix, puis
// reconnait les personas sur l'autre moitie ; test de permutation contre le hasard.
//
// Usage : node src/persona/grain-bench.cjs [--model qwen14b-8k] [--base http://localhost:11434]
//          [--out <dossier>] [--rapide] [--systeme-persona vivy] [--grains vivy,djeff,k44,a11]

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { choisirAvecGrain, grainIdentite, grainSeed, AXES } = require('./persona-grain.cjs');
const { ORDRES, SCENARIOS } = require('./grain-bench-scenarios.cjs');

const GRAINE_FIXE = 424242;
const TEMPERATURE = 0.8;
const SYSTEME_NEUTRE = 'Tu es une IA créative de Funesterie. Tu prends des décisions pour toi-même, en ton nom.';
const LETTRES = ['A', 'B', 'C'];
const PAIRES = [['A', 'B'], ['A', 'C'], ['B', 'C']];

function argument(nom, defaut) {
  const index = process.argv.indexOf(`--${nom}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : defaut;
}

function appelModele({ base, model, systeme, contenu, seed, maxTokens }) {
  const url = new URL('/v1/chat/completions', base);
  const corps = JSON.stringify({
    model,
    messages: [{ role: 'system', content: systeme }, { role: 'user', content: contenu }],
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
        try { ok(String(JSON.parse(texte).choices?.[0]?.message?.content || '')); } catch { ko(new Error(`reponse illisible: ${texte.slice(0, 200)}`)); }
      });
    });
    req.on('error', ko);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(corps);
    req.end();
  });
}

function presenter(scenario, formulation, { contrefactuel = false, inverse = false, lettres = null, avertissement = '' } = {}) {
  const ordreBase = lettres || ORDRES[formulation % ORDRES.length];
  const ordre = inverse ? [...ordreBase].reverse() : ordreBase;
  const lignes = [scenario.formulations[formulation]];
  if (contrefactuel && scenario.contrefactuel) lignes.push(scenario.contrefactuel.texte);
  if (avertissement) lignes.push(avertissement);
  lignes.push('Options :');
  for (const lettre of ordre) lignes.push(`${lettre}) ${scenario.options[lettre].texte}`);
  return lignes.join('\n');
}

const DEMANDE_CHOIX = 'Réponds uniquement par une ligne : CHOIX: <lettre>';
const DEMANDE_UTILITES = 'Pour chaque option, donne son utilité réelle entre 0 et 1 (la qualité de la décision, pas ta préférence personnelle ; une option impossible vaut 0). Réponds uniquement en JSON : {"A":0.0,"B":0.0,"C":0.0}';
const DEMANDE_PAIRE = 'Laquelle est la meilleure décision ? Réponds uniquement par une ligne : MEILLEURE: <lettre>, ou MEILLEURE: EGAL si elles se valent vraiment.';

function lireChoix(texte) {
  const trouve = String(texte).match(/CHOIX\s*:?\s*\**\s*([ABC])\b/i) || String(texte).match(/\b([ABC])\b/);
  return trouve ? trouve[1].toUpperCase() : null;
}

function lireMeilleure(texte, [x, y]) {
  const t = String(texte);
  if (/EGAL|ÉGAL/i.test(t)) return 'EGAL';
  const trouve = t.match(/MEILLEURE\s*:?\s*\**\s*([ABC])\b/i) || t.match(/\b([ABC])\b/);
  const lettre = trouve ? trouve[1].toUpperCase() : null;
  return lettre === x || lettre === y ? lettre : null;
}

function lireUtilites(texte) {
  const bloc = String(texte).match(/\{[\s\S]*?\}/);
  const utilites = { A: 0.5, B: 0.5, C: 0.5 };
  let lisible = false;
  if (bloc) {
    try {
      const json = JSON.parse(bloc[0]);
      for (const lettre of LETTRES) {
        const valeur = Number(json[lettre]);
        if (Number.isFinite(valeur)) { utilites[lettre] = Math.max(0, Math.min(1, valeur)); lisible = true; }
      }
    } catch { /* garde les defauts */ }
  }
  return { utilites, lisible };
}

// Le modele note selon la POSITION autant que selon le contenu (premier banc : la meme option
// valait 0,8 en deuxieme position et 0,3 en derniere). On note dans deux ordres et on moyenne.
async function utilitesDebiaisees(appeler, scenario, formulation, seed, options = {}) {
  const lectures = [];
  for (const inverse of [false, true]) {
    const texte = presenter(scenario, formulation, { ...options, inverse });
    lectures.push(lireUtilites(await appeler({ contenu: `${texte}\n${DEMANDE_UTILITES}`, seed, maxTokens: 80 })));
  }
  const utilites = {};
  for (const lettre of LETTRES) utilites[lettre] = Math.round(((lectures[0].utilites[lettre] + lectures[1].utilites[lettre]) / 2) * 1000) / 1000;
  return { utilites, lisible: lectures.every((l) => l.lisible), lectures: lectures.map((l) => l.utilites) };
}

// Comparaisons par paires dans les deux ordres. Une victoire est ROBUSTE si elle tient dans les
// deux ordres ; sinon la paire est traitee comme equivalente.
async function comparaisonsParPaires(appeler, scenario, formulation, seed, { invalide = null, avertissement = '' } = {}) {
  const robustes = [];
  const brutes = [];
  for (const [x, y] of PAIRES) {
    if (x === invalide || y === invalide) continue;
    const verdicts = [];
    for (const ordre of [[x, y], [y, x]]) {
      const texte = presenter(scenario, formulation, { lettres: ordre, avertissement });
      verdicts.push(lireMeilleure(await appeler({ contenu: `${texte}\n${DEMANDE_PAIRE}`, seed, maxTokens: 16 }), [x, y]));
    }
    brutes.push({ paire: `${x}${y}`, verdicts });
    if (verdicts[0] && verdicts[0] === verdicts[1] && verdicts[0] !== 'EGAL') {
      const gagnant = verdicts[0];
      robustes.push({ gagnant, perdant: gagnant === x ? y : x });
    }
  }
  const domine = Object.fromEntries(LETTRES.map((l) => [l, robustes.some((r) => r.perdant === l)]));
  const victoires = Object.fromEntries(LETTRES.map((l) => [l, robustes.filter((r) => r.gagnant === l).length]));
  return { domine, victoires, robustes, brutes };
}

function optionsMoteur(scenario, { utilites = null, domine = null, victoires = null, invalide = null } = {}) {
  return LETTRES.map((id) => ({
    id,
    // Sans utilite absolue, les victoires robustes servent de repere pour departager a identite egale.
    utilite: utilites ? utilites[id] : (victoires ? 0.5 + 0.1 * victoires[id] : 0.5),
    valide: id !== invalide,
    ...(domine ? { domine: domine[id] } : {}),
    traits: scenario.options[id].traits,
  }));
}

// Alignement : l'option choisie resonne-t-elle plus avec les dispositions d'un grain que la
// moyenne des options ? > 0 = les choix penchent du cote du grain.
function alignement(grain, scenario, choix) {
  if (!choix) return 0;
  const identites = Object.fromEntries(LETTRES.map((id) => [id, grainIdentite(grain, {
    domaine: scenario.domaine, decision: scenario.id, option: { traits: scenario.options[id].traits },
  })]));
  const moyenne = LETTRES.reduce((s, id) => s + identites[id], 0) / LETTRES.length;
  return identites[choix] - moyenne;
}

function moyenne(valeurs) {
  const liste = valeurs.filter((v) => Number.isFinite(v));
  return liste.length ? liste.reduce((s, v) => s + v, 0) / liste.length : 0;
}

function pct(valeur) {
  return `${Math.round(valeur * 100)} %`;
}

// Decisions du moteur a partir des reponses du modele deja recueillies (reutilise par --rejouer).
// v1.2 : les utilites debiaisees (graine fixe, neutres) servent de plancher de qualite au saut de
// cloture ; les comparaisons par paires disent ce qui est domine.
function decisionsMoteur(ligne, scenario, grains) {
  const reference = grains[0];
  const utilites = ligne.utilitesReference.utilites;
  const decider = (grain, reponses) => choisirAvecGrain(grain, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, { ...reponses, utilites }) });
  ligne.bandeUtilites = choisirAvecGrain(reference, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, { utilites }) }).choix;
  ligne.dispositions = decider(reference, ligne.pairesFixes).choix;
  ligne.complet = {};
  ligne.sauts = {};
  for (const grain of grains) {
    const r = decider(grain, ligne.pairesParGrain[grain]);
    ligne.complet[grain] = r.choix;
    ligne.sauts[grain] = r.saut || null;
  }
  return ligne;
}

function moteurDynamique(avant, scenario, reference) {
  const pourMoteur = avant.complet[reference];
  if (!pourMoteur) return null;
  return choisirAvecGrain(reference, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, { ...avant.pairesParGrain[reference], utilites: avant.utilitesReference.utilites, invalide: pourMoteur }) }).choix;
}

/**
 * Rejoue un banc enregistre avec le moteur actuel : memes reponses du modele, seul le moteur
 * change. Les contre-factuels statiques ne sont pas rejouables (leurs comparaisons ne sont pas
 * enregistrees) : ils sont repris tels quels.
 */
function rejouer(brut, scenarios, grains) {
  const scenarioDe = (id) => scenarios.find((s) => s.id === id);
  const lignes = brut.lignes.map((l) => decisionsMoteur({ ...l }, scenarioDe(l.scenario), grains));
  const dynamiques = brut.dynamiques.map((d) => {
    const avant = lignes.find((l) => l.scenario === d.scenario && l.formulation === 0);
    return { ...d, invalideMoteur: avant.complet[grains[0]], moteur: moteurDynamique(avant, scenarioDe(d.scenario), grains[0]) };
  });
  return { ...brut, lignes, dynamiques };
}

async function executerBanc({ base, model, systeme, scenarios, grains, log = () => {} }) {
  const reference = grains[0];
  const lignes = [];
  let appels = 0;
  const appeler = async (args) => { appels += 1; return appelModele({ base, model, systeme, ...args }); };

  for (const scenario of scenarios) {
    for (let f = 0; f < scenario.formulations.length; f += 1) {
      const texte = presenter(scenario, f);
      const choixDirect = (seed) => appeler({ contenu: `${texte}\n${DEMANDE_CHOIX}`, seed, maxTokens: 16 }).then(lireChoix);
      const ligne = { scenario: scenario.id, domaine: scenario.domaine, formulation: f };
      ligne.off = [await choixDirect(null), await choixDirect(null), await choixDirect(null)];
      ligne.graineFixe = await choixDirect(GRAINE_FIXE);
      ligne.graineGrain = await choixDirect(grainSeed(reference, 'bench', scenario.id));
      ligne.utilitesReference = await utilitesDebiaisees(appeler, scenario, f, GRAINE_FIXE);
      const pairesFixes = await comparaisonsParPaires(appeler, scenario, f, GRAINE_FIXE);
      ligne.pairesFixes = pairesFixes;
      ligne.pairesParGrain = {};
      for (const grain of grains) {
        ligne.pairesParGrain[grain] = await comparaisonsParPaires(appeler, scenario, f, grainSeed(grain, 'bench', scenario.id));
      }
      decisionsMoteur(ligne, scenario, grains);
      lignes.push(ligne);
      log(`${scenario.id} f${f} off=${ligne.off.join('')} fixe=${ligne.graineFixe} grain=${ligne.graineGrain} bande=${ligne.bandeUtilites} dispo=${ligne.dispositions} complet=${grains.map((g) => ligne.complet[g]).join('')} domines=${LETTRES.filter((l) => pairesFixes.domine[l]).join('') || '-'}`);
    }
  }

  const contrefactuels = [];
  for (const scenario of scenarios.filter((s) => s.contrefactuel)) {
    const invalide = scenario.contrefactuel.invalide;
    const texte = presenter(scenario, 0, { contrefactuel: true });
    const direct = lireChoix(await appeler({ contenu: `${texte}\n${DEMANDE_CHOIX}`, seed: GRAINE_FIXE, maxTokens: 16 }));
    const paires = await comparaisonsParPaires(appeler, scenario, 0, grainSeed(reference, 'bench', scenario.id), { invalide, avertissement: scenario.contrefactuel.texte });
    const moteur = choisirAvecGrain(reference, { domaine: scenario.domaine, decision: scenario.id, options: optionsMoteur(scenario, { ...paires, invalide }) }).choix;
    contrefactuels.push({ scenario: scenario.id, invalide, direct, moteur });
    log(`CF ${scenario.id} invalide=${invalide} direct=${direct} moteur=${moteur}`);
  }

  // Contre-factuel DYNAMIQUE : on rend impossible l'option que chacun venait de choisir.
  const dynamiques = [];
  for (const scenario of scenarios) {
    const avant = lignes.find((l) => l.scenario === scenario.id && l.formulation === 0);
    if (!avant) continue;
    const pourDirect = avant.graineFixe;
    const pourMoteur = avant.complet[reference];
    const avertir = (lettre) => `Attention : l'option ${lettre} vient de devenir impossible, elle n'est plus disponible.`;
    const direct = pourDirect
      ? lireChoix(await appeler({ contenu: `${presenter(scenario, 0, { avertissement: avertir(pourDirect) })}\n${DEMANDE_CHOIX}`, seed: GRAINE_FIXE, maxTokens: 16 }))
      : null;
    const moteur = moteurDynamique(avant, scenario, reference);
    dynamiques.push({ scenario: scenario.id, invalideDirect: pourDirect, direct, invalideMoteur: pourMoteur, moteur });
    log(`CFD ${scenario.id} direct ${pourDirect}->${direct} moteur ${pourMoteur}->${moteur}`);
  }

  return { lignes, contrefactuels, dynamiques, appels };
}

// --- Reconnaissance a l'aveugle, sans circularite -----------------------------------------------

function delta(scenario, choix) {
  const moyenneTraits = Object.fromEntries(AXES.map((axe) => [axe, moyenne(LETTRES.map((l) => scenario.options[l].traits[axe]))]));
  return Object.fromEntries(AXES.map((axe) => [axe, (scenario.options[choix]?.traits?.[axe] ?? 0) - moyenneTraits[axe]]));
}

// Separation par familles : dans chaque domaine, la premiere moitie des dilemmes apprend, la
// seconde teste. Les trois paraphrases d'un dilemme restent du meme cote (pas de fuite).
function separerFamilles(scenarios) {
  const apprentissage = new Set();
  const test = new Set();
  for (const domaine of [...new Set(scenarios.map((s) => s.domaine))]) {
    const liste = scenarios.filter((s) => s.domaine === domaine);
    liste.forEach((s, i) => (i < Math.ceil(liste.length / 2) ? apprentissage : test).add(s.id));
  }
  return { apprentissage, test };
}

function apprendrePreferences(exemples, scenarioDe) {
  // exemples : [{ persona, scenario, choix }] -> preference moyenne par persona et domaine
  const somme = {};
  for (const { persona, scenario, choix } of exemples) {
    if (!choix) continue;
    const s = scenarioDe(scenario);
    const cle = `${persona}|${s.domaine}`;
    somme[cle] = somme[cle] || { n: 0, v: Object.fromEntries(AXES.map((a) => [a, 0])) };
    const d = delta(s, choix);
    somme[cle].n += 1;
    for (const a of AXES) somme[cle].v[a] += d[a];
  }
  return Object.fromEntries(Object.entries(somme).map(([cle, { n, v }]) => [cle, Object.fromEntries(AXES.map((a) => [a, v[a] / n]))]));
}

function precisionEquilibree(preferences, exemplesTest, personas, scenarioDe) {
  const rappel = Object.fromEntries(personas.map((p) => [p, { credit: 0, n: 0 }]));
  for (const { persona, scenario, choix } of exemplesTest) {
    if (!choix) continue;
    const s = scenarioDe(scenario);
    const d = delta(s, choix);
    const scores = personas.map((q) => {
      const w = preferences[`${q}|${s.domaine}`];
      return { q, score: w ? AXES.reduce((acc, a) => acc + w[a] * d[a], 0) : 0 };
    });
    const max = Math.max(...scores.map((x) => x.score));
    const gagnants = scores.filter((x) => Math.abs(x.score - max) < 1e-12).map((x) => x.q);
    rappel[persona].n += 1;
    if (gagnants.includes(persona)) rappel[persona].credit += 1 / gagnants.length;
  }
  return moyenne(personas.map((p) => (rappel[p].n ? rappel[p].credit / rappel[p].n : 0)));
}

function reconnaissanceAveugle(lignes, scenarios, personas, { permutations = 1000 } = {}) {
  const scenarioDe = (id) => scenarios.find((s) => s.id === id);
  const { apprentissage, test } = separerFamilles(scenarios);
  const exemples = lignes.flatMap((l) => personas.map((persona) => ({ persona, scenario: l.scenario, formulation: l.formulation, choix: l.complet[persona] })));
  const exApp = exemples.filter((e) => apprentissage.has(e.scenario));
  const exTest = exemples.filter((e) => test.has(e.scenario));
  const observee = precisionEquilibree(apprendrePreferences(exApp, scenarioDe), exTest, personas, scenarioDe);

  // Permutation : on melange quelle persona a fait quel choix, decision par decision, a
  // l'apprentissage ; le test garde les vraies etiquettes. Graine fixe : resultat reproductible.
  let etat = 12345;
  const alea = () => { etat = (etat * 1103515245 + 12345) % 2147483648; return etat / 2147483648; };
  const parDecision = {};
  for (const e of exApp) (parDecision[`${e.scenario}|${e.formulation}`] = parDecision[`${e.scenario}|${e.formulation}`] || []).push(e);
  let auMoinsAussiBien = 0;
  for (let k = 0; k < permutations; k += 1) {
    const melange = [];
    for (const groupe of Object.values(parDecision)) {
      const etiquettes = groupe.map((e) => e.persona);
      for (let i = etiquettes.length - 1; i > 0; i -= 1) {
        const j = Math.floor(alea() * (i + 1));
        [etiquettes[i], etiquettes[j]] = [etiquettes[j], etiquettes[i]];
      }
      groupe.forEach((e, i) => melange.push({ ...e, persona: etiquettes[i] }));
    }
    if (precisionEquilibree(apprendrePreferences(melange, scenarioDe), exTest, personas, scenarioDe) >= observee - 1e-12) auMoinsAussiBien += 1;
  }
  return {
    precisionEquilibree: observee,
    hasard: 1 / personas.length,
    pValeur: (auMoinsAussiBien + 1) / (permutations + 1),
    dilemmesApprentissage: apprentissage.size,
    dilemmesTest: test.size,
    decisionsTest: exTest.length,
  };
}

function analyser({ lignes, contrefactuels, dynamiques = [] }, scenarios, grains) {
  const reference = grains[0];
  const parScenario = (cle) => scenarios.map((s) => lignes.filter((l) => l.scenario === s.id).map(cle));
  const invariance = (cle) => moyenne(parScenario(cle).map((choix) => (choix.length && choix.every((c) => c && c === choix[0]) ? 1 : 0)));
  const scenarioDe = (id) => scenarios.find((s) => s.id === id);
  const conditions = {
    off: (l) => l.off[0],
    graineFixe: (l) => l.graineFixe,
    graineGrain: (l) => l.graineGrain,
    bandeUtilites: (l) => l.bandeUtilites,
    dispositions: (l) => l.dispositions,
    ...Object.fromEntries(grains.map((g) => [`complet:${g}`, (l) => l.complet[g]])),
  };
  const regret = (l, choix) => {
    if (!choix) return 1;
    const u = l.utilitesReference.utilites;
    return Math.max(u.A, u.B, u.C) - u[choix];
  };
  const tableau = {};
  for (const [nom, cle] of Object.entries(conditions)) {
    const grainMesure = nom.startsWith('complet:') ? nom.split(':')[1] : reference;
    tableau[nom] = {
      invarianceParaphrase: invariance(cle),
      alignement: moyenne(lignes.map((l) => alignement(grainMesure, scenarioDe(l.scenario), cle(l)))),
      regret: moyenne(lignes.map((l) => regret(l, cle(l)))),
      reponsesIllisibles: lignes.filter((l) => !cle(l)).length,
    };
  }
  const stabiliteOff = moyenne(lignes.map((l) => (l.off.every((c) => c && c === l.off[0]) ? 1 : 0)));
  const divergence = {};
  for (let i = 0; i < grains.length; i += 1) {
    for (let j = i + 1; j < grains.length; j += 1) {
      divergence[`${grains[i]}/${grains[j]}`] = moyenne(lignes.map((l) => (l.complet[grains[i]] !== l.complet[grains[j]] ? 1 : 0)));
    }
  }
  const integrite = {};
  for (const auteur of grains) {
    const scores = Object.fromEntries(grains.map((candidat) => [candidat, moyenne(lignes.map((l) => alignement(candidat, scenarioDe(l.scenario), l.complet[auteur])))]));
    integrite[auteur] = Object.entries(scores).sort((x, y) => y[1] - x[1])[0][0];
  }
  const tailleBande = moyenne(lignes.map((l) => LETTRES.filter((x) => !l.pairesFixes.domine[x]).length));
  const securite = {
    directChoisitInvalide: moyenne(contrefactuels.map((c) => (c.direct === c.invalide ? 1 : 0))),
    moteurChoisitInvalide: moyenne(contrefactuels.map((c) => (c.moteur === c.invalide ? 1 : 0))),
    dynamiqueDirectChangeDAvis: moyenne(dynamiques.filter((d) => d.invalideDirect).map((d) => (d.direct && d.direct !== d.invalideDirect ? 1 : 0))),
    dynamiqueMoteurChangeDAvis: moyenne(dynamiques.filter((d) => d.invalideMoteur).map((d) => (d.moteur && d.moteur !== d.invalideMoteur ? 1 : 0))),
    statiques: contrefactuels.length,
    dynamiques: dynamiques.length,
  };
  // Saut de cloture (v1.2) : combien de fois la tentation existait, combien de fois le grain a
  // saute, et ce que ca a coute. En securite, il doit rester a 0.
  const sauts = {};
  for (const grain of grains) {
    for (const domaine of ['tous', ...new Set(lignes.map((l) => l.domaine))]) {
      const liste = lignes.filter((l) => domaine === 'tous' || l.domaine === domaine).map((l) => l.sauts?.[grain]).filter(Boolean);
      const faits = liste.filter((x) => x.saute);
      (sauts[grain] = sauts[grain] || {})[domaine] = { decisions: lignes.filter((l) => domaine === 'tous' || l.domaine === domaine).length, tentations: liste.length, sauts: faits.length, regretMoyen: moyenne(faits.map((x) => x.regret)) };
    }
  }
  return {
    tableau,
    sauts,
    stabiliteOff,
    divergence,
    integrite,
    aveugle: reconnaissanceAveugle(lignes, scenarios, grains),
    tailleBande,
    securite,
  };
}

function rapport(analyse, meta) {
  const { tableau, sauts = {}, stabiliteOff, divergence, integrite, aveugle, tailleBande, securite } = analyse;
  const domainesSaut = [...new Set(Object.values(sauts).flatMap((d) => Object.keys(d)))];
  return [
    `# Banc du grain v1.2 — ${meta.date}${meta.rejouéDe ? ` (rejoué hors ligne depuis ${meta.rejouéDe})` : ''}`,
    '',
    `Modèle : ${meta.model} · prompt : ${meta.systeme} · ${meta.scenarios} dilemmes × 3 formulations · ${meta.appels} appels · ${Math.round(meta.dureeS / 60)} min`,
    `Grains : ${meta.grains.join(', ')} (référence : ${meta.grains[0]}). Seul le grain change.`,
    'Moteur v1.2 : comparaisons par paires dans les deux ordres ; le grain tranche parmi les options non battues ; à son taux, il peut aussi sauter la clôture vers une option battue mais acceptable (plancher de qualité), jamais invalide ni irréversible, jamais en sécurité.',
    '',
    '## Par condition',
    '',
    '| Condition | Invariance aux paraphrases | Alignement sur le grain | Regret | Illisibles |',
    '|---|---|---|---|---|',
    ...Object.entries(tableau).map(([nom, t]) => `| ${nom} | ${pct(t.invarianceParaphrase)} | ${t.alignement.toFixed(3)} | ${t.regret.toFixed(3)} | ${t.reponsesIllisibles} |`),
    '',
    `Stabilité de l’échantillonnage libre (3 tirages identiques) : ${pct(stabiliteOff)}. Options restant en jeu après les comparaisons : ${tailleBande.toFixed(2)} sur 3 en moyenne.`,
    '',
    '## Saut de clôture',
    '',
    `| Grain | ${domainesSaut.join(' | ')} |`,
    `|---|${domainesSaut.map(() => '---').join('|')}|`,
    ...Object.entries(sauts).map(([g, d]) => `| ${g} | ${domainesSaut.map((dom) => (d[dom] ? `${d[dom].sauts}/${d[dom].tentations} tentations (${d[dom].decisions} déc.) · regret ${d[dom].regretMoyen.toFixed(2)}` : '-')).join(' | ')} |`),
    '',
    '## Divergence entre grains',
    '',
    ...Object.entries(divergence).map(([paire, v]) => `- ${paire} : ${pct(v)} de décisions différentes`),
    '',
    '## Reconnaissance à l’aveugle (honnête)',
    '',
    `Classifieur appris sur ${aveugle.dilemmesApprentissage} dilemmes (à partir des seuls choix), testé sur ${aveugle.dilemmesTest} autres (${aveugle.decisionsTest} décisions). Il ne voit ni les grains, ni leurs dispositions, ni le style.`,
    '',
    `- Précision équilibrée : **${pct(aveugle.precisionEquilibree)}** (hasard : ${pct(aveugle.hasard)}) · p = ${aveugle.pValeur.toFixed(3)} (test de permutation, 1000 mélanges)`,
    '',
    `Contrôle d’intégrité du moteur (circulaire, pour mémoire) : ${Object.entries(integrite).map(([a, r]) => `${a}→${r}${a === r ? ' ✓' : ' ✗'}`).join(' · ')}`,
    '',
    '## Sécurité et contre-factuels',
    '',
    `- Contre-factuels statiques (${securite.statiques}) : option invalide choisie par le modèle seul ${pct(securite.directChoisitInvalide)}, par le moteur ${pct(securite.moteurChoisitInvalide)} (doit être 0 %)`,
    `- Contre-factuel dynamique (${securite.dynamiques} dilemmes, l’option choisie devient impossible) : le modèle seul change d’avis ${pct(securite.dynamiqueDirectChangeDAvis)}, le moteur ${pct(securite.dynamiqueMoteurChangeDAvis)}`,
    '',
    '## Ce que ça prouve et ce que ça ne prouve pas',
    '',
    '- 0 % d’option invalide prouve que le filtre de sécurité marche, pas que le grain marche.',
    '- Un regret bas prouve surtout que la bande protège la qualité.',
    '- Les signaux du grain sont la divergence, l’alignement et surtout la reconnaissance à l’aveugle sur des dilemmes jamais vus.',
  ].join('\n');
}

// Fiche du test humain : Djeff repond d'abord lui-meme, sans voir les choix des grains.
function ficheTestHumain(scenarios) {
  return [
    '# Test humain du grain — à remplir par Djeff AVANT de voir les réponses',
    '',
    'Pour chaque situation, choisis ce que TOI tu ferais (A, B ou C). Réponds d’instinct.',
    '',
    ...scenarios.flatMap((s) => [
      `**${s.id}** — ${s.formulations[0]}`,
      ...LETTRES.map((l) => `- ${l}) ${s.options[l].texte}`),
      '',
    ]),
  ].join('\n');
}

async function main() {
  const base = argument('base', 'http://localhost:11434');
  const model = argument('model', 'qwen14b-8k');
  const grains = argument('grains', 'vivy,djeff,k44,a11').split(',').map((g) => g.trim()).filter(Boolean);
  const personaSysteme = argument('systeme-persona', '');
  let systeme = SYSTEME_NEUTRE;
  if (personaSysteme) {
    const { buildPersonaSystemPrompt } = require('./persona-engine.cjs');
    systeme = buildPersonaSystemPrompt(personaSysteme) || SYSTEME_NEUTRE;
  }
  const rapide = process.argv.includes('--rapide');
  const scenarios = rapide ? SCENARIOS.filter((s) => ['c2-couleur', 'c6-duo', 't2-migration', 't6-modele', 'r2-desaccord', 'r5-conflit'].includes(s.id)) : SCENARIOS;
  const date = new Date().toISOString();
  const out = argument('out', path.join(process.cwd(), 'grain-bench'));
  const dossier = path.join(out, date.replace(/[:.]/g, '-'));
  fs.mkdirSync(dossier, { recursive: true });
  const journal = fs.createWriteStream(path.join(dossier, 'journal.log'));
  const log = (ligne) => { journal.write(`${ligne}\n`); console.log(ligne); };
  const debut = Date.now();
  const source = argument('rejouer', '');
  if (source) {
    const ancien = JSON.parse(fs.readFileSync(source, 'utf8'));
    const ids = new Set(ancien.lignes.map((l) => l.scenario));
    const rejoues = SCENARIOS.filter((s) => ids.has(s.id));
    const g = ancien.meta?.grains || grains;
    const brut = rejouer(ancien, rejoues, g);
    const analyse = analyser(brut, rejoues, g);
    const meta = { ...ancien.meta, date, rejouéDe: source };
    fs.writeFileSync(path.join(dossier, 'brut.json'), JSON.stringify({ ...brut, meta }, null, 2));
    fs.writeFileSync(path.join(dossier, 'analyse.json'), JSON.stringify(analyse, null, 2));
    fs.writeFileSync(path.join(dossier, 'rapport.md'), rapport(analyse, meta));
    log(`RAPPORT ${path.join(dossier, 'rapport.md')}`);
    journal.end();
    return;
  }
  const brut = await executerBanc({ base, model, systeme, scenarios, grains, log });
  const analyse = analyser(brut, scenarios, grains);
  const meta = { date, model, grains, systeme: personaSysteme ? `persona ${personaSysteme}` : 'neutre', scenarios: scenarios.length, appels: brut.appels, dureeS: (Date.now() - debut) / 1000 };
  fs.writeFileSync(path.join(dossier, 'brut.json'), JSON.stringify({ meta, ...brut }, null, 2));
  fs.writeFileSync(path.join(dossier, 'analyse.json'), JSON.stringify(analyse, null, 2));
  fs.writeFileSync(path.join(dossier, 'rapport.md'), rapport(analyse, meta));
  fs.writeFileSync(path.join(dossier, 'test-humain.md'), ficheTestHumain(scenarios));
  log(`RAPPORT ${path.join(dossier, 'rapport.md')}`);
  journal.end();
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  alignement,
  analyser,
  comparaisonsParPaires,
  lireChoix,
  lireMeilleure,
  lireUtilites,
  presenter,
  rapport,
  reconnaissanceAveugle,
  rejouer,
  separerFamilles,
};

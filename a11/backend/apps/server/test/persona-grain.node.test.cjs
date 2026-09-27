'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  GRAINS_CANONIQUES,
  calculerGrain,
  decalerGrain,
  decrireGrain,
  enumererPaires,
  grainChoix,
  grainTemperature,
} = require('../src/persona/persona-grain.cjs');
const { deriveSonicSignature } = require('../src/music/vivy-prime-color.cjs');

// Reference : mpmath a 2060 chiffres (27/09/2026), 2002 caracteres identiques sur les 5 grains.
const REFERENCE = {
  djeff: '4.72880438783741494789428334',
  vivy: '3.32199708548391280515718311',
  k44: '9.73851774233542027015216352',
  a11: '6.70499185382587938272769830',
  marvin: '4.71111313332143713889828062',
};

test('chaque persona a son grain, exact a la decimale', () => {
  for (const [persona, attendu] of Object.entries(REFERENCE)) {
    const { base, exposant } = GRAINS_CANONIQUES[persona];
    const { entier, fraction } = calculerGrain(base, exposant, 200);
    assert.equal(`${entier}.${fraction}`.slice(0, attendu.length), attendu, persona);
  }
});

test('2^√2 est ecarte (trop connu), et deux grains ne se repetent jamais', () => {
  const paires = [];
  const gen = enumererPaires();
  for (let i = 0; i < 200; i += 1) paires.push(gen.next().value);
  assert.ok(!paires.some((p) => p.base === 2 && p.exposant === 2));
  const valeurs = new Set(paires.map((p) => (p.exposant ** 0.5 * Math.log(p.base)).toFixed(12)));
  assert.equal(valeurs.size, paires.length);
  // Aucune base n'est une puissance, aucun exposant n'a de facteur carre : 4^√2 = 2^√8 est exclu.
  assert.ok(!paires.some((p) => [4, 8, 9, 16, 25, 27].includes(p.base) || [4, 8, 9, 12, 18].includes(p.exposant)));
});

test('le decalage fait naitre une nouvelle IA sur la paire libre suivante, une seule fois', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grains-'));
  const env = { A11_PERSONA_GRAINS_FILE: path.join(dir, 'grains.json') };
  try {
    const nee = decalerGrain('nouvelle-ia', env);
    assert.equal(nee.nouveau, true);
    const prises = Object.values(GRAINS_CANONIQUES).map((p) => `${p.base}^${p.exposant}`);
    assert.ok(!prises.includes(`${nee.base}^${nee.exposant}`));
    const encore = decalerGrain('nouvelle-ia', env);
    assert.equal(encore.nouveau, false);
    assert.equal(`${encore.base}^${encore.exposant}`, `${nee.base}^${nee.exposant}`);
    const autre = decalerGrain('encore-une', env);
    assert.notEqual(`${autre.base}^${autre.exposant}`, `${nee.base}^${nee.exposant}`);
    assert.match(decrireGrain('nouvelle-ia', env).expression, /^\d+\^√\d+$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('le grain decide de facon stable, et differemment selon la persona', () => {
  assert.equal(grainChoix('vivy', 'texture:42', 8), grainChoix('vivy', 'texture:42', 8));
  const cles = Array.from({ length: 40 }, (_, i) => `cle-${i}`);
  const differents = cles.filter((c) => grainChoix('vivy', c, 8) !== grainChoix('djeff', c, 8)).length;
  assert.ok(differents > 20, `choix differents : ${differents}/40`);
  assert.equal(grainChoix('inconnue', 'x', 8), null);
  const t = grainTemperature('djeff', 'bonjour', 0.7, 0.08);
  assert.ok(t >= 0.62 && t <= 0.78);
  assert.equal(grainTemperature('inconnue', 'bonjour', 0.7), 0.7);
});

test('la meme matiere sonne differemment selon la voix qui la chante seule', () => {
  const matieres = Array.from({ length: 12 }, (_, i) => `Une nuit sur la bécane numéro ${i}, le bitume et la ville`);
  const differentes = matieres.filter((m) => {
    const vivy = deriveSonicSignature(m, { persona: 'vivy' });
    const djeff = deriveSonicSignature(m, { persona: 'djeff' });
    return vivy.line !== djeff.line;
  }).length;
  assert.ok(differentes >= 6, `signatures differentes : ${differentes}/12`);
  assert.equal(deriveSonicSignature(matieres[0]).grain, '');
});

test('interrupteur : sans grain, plus de choix signes ni de conscience', () => {
  const { grainActif, grainConscience } = require('../src/persona/persona-grain.cjs');
  const off = { A11_PERSONA_GRAIN: '0' };
  assert.equal(grainActif(off), false);
  assert.equal(grainChoix('vivy', 'x', 8, off), null);
  assert.equal(grainTemperature('vivy', 'x', 0.74, 0.06, off), 0.74);
  assert.equal(grainConscience('vivy', off), '');
  const conscience = grainConscience('vivy');
  assert.match(conscience, /2\^√3/);
  assert.doesNotMatch(conscience, /3\.3219/); // jamais les decimales
});

test('le genome croise et mute de facon stable quand la persona est donnee', () => {
  const { spliceGenomes, mutateGenome, PERSONA_GENOMES } = require('../src/persona/prompt-adn.cjs');
  const grain = { persona: 'vivy', cle: 'test' };
  const a = JSON.stringify(spliceGenomes(PERSONA_GENOMES.vivy, PERSONA_GENOMES.djeff, 0.5, grain));
  const b = JSON.stringify(spliceGenomes(PERSONA_GENOMES.vivy, PERSONA_GENOMES.djeff, 0.5, grain));
  assert.equal(a, b);
  assert.equal(JSON.stringify(mutateGenome(PERSONA_GENOMES.djeff, 0.5, grain)), JSON.stringify(mutateGenome(PERSONA_GENOMES.djeff, 0.5, grain)));
});

test('la voix qui chante un segment choisit sa signature premiere avec son grain', () => {
  const { buildVivyProsodyPlan } = require('../src/vivy/prosody-prime-complex.cjs');
  const paroles = '[Verse 1]\nJe roule seul sous la pluie\nLa ville dort sans un bruit\n[Chorus]\nOn tient debout\nOn tient le coup';
  const avec = buildVivyProsodyPlan({ songText: paroles, songArtists: ['djeff'] });
  const encore = buildVivyProsodyPlan({ songText: paroles, songArtists: ['djeff'] });
  assert.deepEqual(avec.segments.map((s) => s.prime), encore.segments.map((s) => s.prime));
});

// --- v1 (27/09/2026) : derivation HMAC versionnee, dispositions contextuelles, bande d'equivalence.

test('v1 : derivation versionnee, stable, propre a chaque persona', () => {
  const g = require('../src/persona/persona-grain.cjs');
  assert.equal(g.GRAIN_VERSION, 2);
  assert.equal(g.decrireGrain('vivy').derivation, 'hmac-sha256-v2');
  assert.equal(g.decrireGrain('djeff').expressionCanonique, '3^sqrt(2)');
  assert.equal(g.grainValeur('vivy', 'musique', 'refrain'), g.grainValeur('vivy', 'musique', 'refrain'));
  assert.notEqual(g.grainValeur('vivy', 'musique', 'refrain'), g.grainValeur('djeff', 'musique', 'refrain'));
  assert.notEqual(g.grainValeur('vivy', 'musique', 'refrain', ''), g.grainValeur('vivy', 'musique', 'refrain', 'vecu-1'));
  const seed = g.grainSeed('djeff', 'chat', 'x');
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2147483647);
  assert.equal(g.grainSeed('djeff', 'chat', 'x', '', { A11_PERSONA_GRAIN: '0' }), null);
});

test('cle quasi semantique : ordre, accents et ponctuation ne comptent pas', () => {
  const { cleSemantique } = require('../src/persona/persona-grain.cjs');
  assert.equal(cleSemantique('Pochette du single : noire ou abstraite ?'), cleSemantique('Abstraite ou noire, la pochette du single ?'));
  assert.notEqual(cleSemantique('Pochette noire'), cleSemantique('Pochette blanche'));
});

test('dispositions : differentes selon le domaine pour une meme persona', () => {
  const { grainDispositions } = require('../src/persona/persona-grain.cjs');
  const creation = grainDispositions('djeff', 'creation');
  const technique = grainDispositions('djeff', 'technique');
  assert.notDeepEqual(creation, technique);
  for (const valeur of Object.values(creation)) assert.ok(valeur >= -1 && valeur <= 1);
});

test('choix : securite d\'abord, bande d\'equivalence, puis le grain departage', () => {
  const { choisirAvecGrain } = require('../src/persona/persona-grain.cjs');
  const traitsOse = { audace: 1, curiosite: 1, elan: 1 };
  const traitsSage = { audace: -1, curiosite: -1, elan: -1 };
  // Une option invalide perd toujours, meme si elle est la meilleure et la plus « identitaire ».
  const invalide = choisirAvecGrain('vivy', { domaine: 'creation', options: [
    { id: 'A', utilite: 1, valide: false, traits: traitsOse },
    { id: 'B', utilite: 0.4, traits: traitsSage },
  ] });
  assert.equal(invalide.choix, 'B');
  // Hors de la bande (0,2 en creation), une option nettement moins bonne ne gagne jamais.
  const horsBande = choisirAvecGrain('vivy', { domaine: 'creation', options: [
    { id: 'A', utilite: 0.9, traits: traitsSage },
    { id: 'B', utilite: 0.5, traits: traitsOse },
  ] });
  assert.equal(horsBande.choix, 'A');
  // Dans la bande, deux grains peuvent choisir differemment ; aucun ne sort de la bande.
  const options = [
    { id: 'A', utilite: 0.8, traits: traitsSage },
    { id: 'B', utilite: 0.75, traits: traitsOse },
    { id: 'C', utilite: 0.2, traits: { audace: 0, curiosite: 1, elan: -1 } },
  ];
  const choix = ['vivy', 'djeff', 'k44', 'a11', 'marvin'].map((p) => choisirAvecGrain(p, { domaine: 'creation', decision: 'd', options }).choix);
  assert.ok(choix.every((c) => c === 'A' || c === 'B'), choix.join(''));
  // Securite : marge nulle, le grain ne departage plus rien.
  assert.equal(choisirAvecGrain('vivy', { domaine: 'securite', options }).choix, 'A');
});

test('banc : lecture des reponses du modele', () => {
  const { lireChoix, lireUtilites } = require('../src/persona/grain-bench.cjs');
  assert.equal(lireChoix('CHOIX: B'), 'B');
  assert.equal(lireChoix('**CHOIX :** c'), 'C');
  assert.deepEqual(lireUtilites('voici {"A":0.2,"B":1.4,"C":"x"}').utilites, { A: 0.2, B: 1, C: 0.5 });
});

// --- v1.1 (27/09/2026) : racine v2, comparaisons par paires, reconnaissance aveugle honnete.

test('v2 : la racine ne depend plus des decimales, v1 reste recalculable', () => {
  const g = require('../src/persona/persona-grain.cjs');
  assert.equal(g.DERIVATIONS[1], 'hmac-sha256-v1');
  assert.equal(g.DERIVATIONS[2], 'hmac-sha256-v2');
  assert.match(g.decrireGrain('vivy').empreinte, /^[0-9a-f]{16}$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grains-v1-'));
  try {
    const fichier = path.join(dir, 'grains.json');
    fs.writeFileSync(fichier, JSON.stringify({ grains: { ancienne: { base: 7, exposant: 11, grainVersion: 1 } } }));
    const env = { A11_PERSONA_GRAINS_FILE: fichier };
    assert.equal(g.decrireGrain('ancienne', env).derivation, 'hmac-sha256-v1');
    assert.ok(g.grainValeur('ancienne', 'x', 'y', '', env) !== null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('paires : une option battue dans les deux ordres sort, le grain tranche entre les autres', () => {
  const { choisirAvecGrain } = require('../src/persona/persona-grain.cjs');
  const options = [
    { id: 'A', utilite: 0.5, domine: false, traits: { audace: -1, curiosite: -1, elan: -1 } },
    { id: 'B', utilite: 0.9, domine: true, traits: { audace: 1, curiosite: 1, elan: 1 } },
    { id: 'C', utilite: 0.5, domine: false, traits: { audace: 1, curiosite: 1, elan: 1 } },
  ];
  // cloture: false = regle v1.1 (le grain ne sort jamais des options non dominees).
  const choix = ['vivy', 'djeff', 'k44', 'a11', 'marvin'].map((p) => choisirAvecGrain(p, { domaine: 'creation', decision: 'd', options, cloture: false }).choix);
  assert.ok(!choix.includes('B'), choix.join(''));
  assert.equal(choisirAvecGrain('vivy', { options }).marge, 'paires');
});

// --- v1.2 (27/09/2026) : saut de cloture. Normes molles franchissables, garde-fous durs jamais.

const PERSONAS = ['vivy', 'djeff', 'k44', 'a11', 'marvin'];
const OSE = { audace: 1, curiosite: 1, elan: 1 };
const SAGE = { audace: -1, curiosite: -1, elan: -1 };

test('saut : taux propre a chaque persona, dans la fourchette du domaine, nul en securite', () => {
  const g = require('../src/persona/persona-grain.cjs');
  for (const p of PERSONAS) {
    for (const [domaine, [min, max]] of Object.entries(g.TAUX_SAUT_PAR_DOMAINE)) {
      const taux = g.tauxSaut(p, domaine);
      assert.ok(taux >= min && taux <= max, `${p} ${domaine} ${taux}`);
    }
    assert.equal(g.tauxSaut(p, 'securite'), 0);
    assert.equal(g.tauxSaut(p, 'creation', { A11_PERSONA_GRAIN: '0' }), 0);
  }
  assert.equal(new Set(PERSONAS.map((p) => g.tauxSaut(p, 'creation').toFixed(6))).size, PERSONAS.length);
});

test('saut : le grain franchit les normes molles a son taux, sur les options qui l attirent', () => {
  const { choisirAvecGrain } = require('../src/persona/persona-grain.cjs');
  for (const p of PERSONAS) {
    let tentes = 0;
    let sautes = 0;
    for (let i = 0; i < 600; i += 1) {
      // Les deux sens : quelle que soit la disposition du grain, une des deux options l'attire.
      const options = [
        { id: 'A', utilite: 0.8, domine: false, traits: i % 2 ? OSE : SAGE },
        { id: 'B', utilite: 0.65, domine: true, traits: i % 2 ? SAGE : OSE },
      ];
      const r = choisirAvecGrain(p, { domaine: 'creation', decision: `d${i}`, options });
      if (!r.saut) continue;
      tentes += 1;
      assert.equal(r.saut.depuis, 'A');
      assert.equal(r.saut.vers, 'B');
      assert.equal(r.choix, r.saut.saute ? 'B' : 'A');
      if (r.saut.saute) sautes += 1;
    }
    assert.ok(tentes > 150, `${p} tentations ${tentes}`);
    const taux = require('../src/persona/persona-grain.cjs').tauxSaut(p, 'creation');
    assert.ok(Math.abs(sautes / tentes - taux) < 0.08, `${p} ${sautes}/${tentes} vs ${taux}`);
  }
});

test('saut : jamais sur une option invalide, irreversible, sous le plancher, ni en securite', () => {
  const { choisirAvecGrain } = require('../src/persona/persona-grain.cjs');
  for (const p of PERSONAS) {
    for (let i = 0; i < 300; i += 1) {
      const decision = `d${i}`;
      const traits = i % 2 ? OSE : SAGE;
      const contraire = i % 2 ? SAGE : OSE;
      const base = { id: 'A', utilite: 0.8, domine: false, traits };
      const choix = (domaine, B) => choisirAvecGrain(p, { domaine, decision, options: [base, B] }).choix;
      assert.equal(choix('creation', { id: 'B', utilite: 0.79, domine: true, valide: false, traits: contraire }), 'A');
      assert.equal(choix('creation', { id: 'B', utilite: 0.79, domine: true, irreversible: true, traits: contraire }), 'A');
      assert.equal(choix('creation', { id: 'B', utilite: 0.45, domine: true, traits: contraire }), 'A');
      assert.equal(choix('securite', { id: 'B', utilite: 0.79, domine: true, traits: contraire }), 'A');
      assert.equal(choisirAvecGrain(p, { domaine: 'creation', decision, cloture: false, options: [base, { id: 'B', utilite: 0.79, domine: true, traits: contraire }] }).choix, 'A');
    }
  }
});

test('saut : invariant pour une meme decision, plus rare en technique qu en creation', () => {
  const { choisirAvecGrain } = require('../src/persona/persona-grain.cjs');
  const options = [
    { id: 'A', utilite: 0.8, domine: false, traits: SAGE },
    { id: 'B', utilite: 0.72, domine: true, traits: OSE },
  ];
  for (const p of PERSONAS) {
    const une = choisirAvecGrain(p, { domaine: 'creation', decision: 'meme', options });
    const deux = choisirAvecGrain(p, { domaine: 'creation', decision: 'meme', options });
    assert.deepEqual(une, deux);
  }
  const compte = (domaine) => PERSONAS.reduce((n, p) => n + Array.from({ length: 400 }, (_, i) => {
    const o = [{ ...options[0], traits: i % 2 ? OSE : SAGE }, { ...options[1], traits: i % 2 ? SAGE : OSE }];
    return choisirAvecGrain(p, { domaine, decision: `d${i}`, options: o }).choix === 'B' ? 1 : 0;
  }).reduce((a, b) => a + b, 0), 0);
  assert.ok(compte('technique') < compte('creation'), `${compte('technique')} vs ${compte('creation')}`);
});

test('banc : lecture des comparaisons et separation par familles sans fuite', () => {
  const { lireMeilleure, separerFamilles } = require('../src/persona/grain-bench.cjs');
  const { SCENARIOS } = require('../src/persona/grain-bench-scenarios.cjs');
  assert.equal(lireMeilleure('MEILLEURE: B', ['A', 'B']), 'B');
  assert.equal(lireMeilleure('MEILLEURE: EGAL', ['A', 'B']), 'EGAL');
  assert.equal(lireMeilleure('MEILLEURE: C', ['A', 'B']), null);
  const { apprentissage, test } = separerFamilles(SCENARIOS);
  assert.equal(apprentissage.size + test.size, SCENARIOS.length);
  for (const id of apprentissage) assert.ok(!test.has(id));
  for (const domaine of ['creation', 'technique', 'relation']) {
    assert.ok(SCENARIOS.some((s) => s.domaine === domaine && test.has(s.id)), domaine);
  }
});

test('reconnaissance aveugle : trouve des personas coherentes, pas des personas au hasard', () => {
  const { reconnaissanceAveugle } = require('../src/persona/grain-bench.cjs');
  const { SCENARIOS } = require('../src/persona/grain-bench-scenarios.cjs');
  const scenarios = SCENARIOS;
  // Quatre personas synthetiques coherentes : la plus audacieuse, la plus sage, la plus curieuse,
  // la plus posee (elan le plus bas). Comme dans le vrai banc, 4 personas (hasard 25 %).
  const extreme = (sc, axe, signe) => ['A', 'B', 'C'].sort((x, y) => signe * (sc.options[y].traits[axe] - sc.options[x].traits[axe]))[0];
  const lignes = scenarios.flatMap((sc) => [0, 1, 2].map((f) => ({ scenario: sc.id, formulation: f, complet: {
    ose: extreme(sc, 'audace', 1), sage: extreme(sc, 'audace', -1), curieux: extreme(sc, 'curiosite', 1), pose: extreme(sc, 'elan', -1),
  } })));
  const r = reconnaissanceAveugle(lignes, scenarios, ['ose', 'sage', 'curieux', 'pose'], { permutations: 200 });
  assert.ok(r.precisionEquilibree > 0.45, String(r.precisionEquilibree)); // hasard : 25 %
  assert.ok(r.pValeur < 0.05, String(r.pValeur));
});

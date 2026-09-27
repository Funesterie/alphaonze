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
  assert.equal(g.GRAIN_VERSION, 1);
  assert.equal(g.decrireGrain('vivy').derivation, 'hmac-sha256-v1');
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

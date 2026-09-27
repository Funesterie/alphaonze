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

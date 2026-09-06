'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  deriveSonicSignature,
  primeCurveS,
  songSeed,
} = require(path.join(__dirname, '../src/music/vivy-prime-color.cjs'));

const {
  buildVivyDynamicArc,
  resolveEnergyCeiling,
} = require(path.join(__dirname, '../src/music/vivy-dynamic-arc.cjs'));

// Constat de Djeff (02/08/2026) : « le style redondant et vu 100 fois ».

test('deux morceaux differents recoivent des signatures differentes', () => {
  const a = deriveSonicSignature('Berceuse pour endormir un enfant');
  const b = deriveSonicSignature('Combat de rue, adrenaline, sirenes');
  assert.notEqual(a.line, b.line, 'la redondance est exactement le defaut a corriger');
});

test('le meme morceau redonne toujours la meme signature', () => {
  const sujet = 'Vallee de l ombre, neons, moto nocturne';
  assert.deepEqual(deriveSonicSignature(sujet).line, deriveSonicSignature(sujet).line);
});

test('la signature couvre reellement la palette, pas une seule couleur', () => {
  // Regression du 02/08 : une compression absolue 1 - 1/(1+s) ecrasait toutes les
  // valeurs vers 0,0004, et PurpleShadow (gamma 0,15) sortait a chaque fois. La
  // courbe variait, la lecture ne la lisait pas.
  const couleurs = new Set();
  for (let i = 0; i < 60; i += 1) couleurs.add(deriveSonicSignature(`sujet numero ${i}`).color?.name);
  assert.ok(couleurs.size >= 4, `une seule couleur reviendrait au defaut d origine (vu: ${couleurs.size})`);
});

test('la courbe C1 reste bornee et definie sur toute la periode', () => {
  for (let n = 1; n <= 4000; n += 137) {
    const s = primeCurveS(n);
    assert.ok(Number.isFinite(s), `S(${n}) doit rester fini`);
    assert.ok(s > 0, `S(${n}) doit rester positif`);
  }
});

test('la graine reste dans la periode de la grille', () => {
  for (const sujet of ['', 'a', 'Une chanson tres longue '.repeat(50)]) {
    const n = songSeed(sujet);
    assert.ok(n >= 1 && n <= 4000, `graine hors periode: ${n}`);
  }
});

test('le plafond d energie suit la direction choisie', () => {
  // Regression du 02/08 : les regex portaient un caractere de controle 0x08 au lieu
  // d une limite de mot \b. Elles ne matchaient jamais, tout retombait sur 0,95, et
  // une berceuse recevait la meme energie qu un banger. JSON.stringify affiche 0x08
  // exactement comme \b, ce qui a masque le defaut plusieurs fois.
  assert.equal(resolveEnergyCeiling('berceuse acoustique, guitare seche'), 0.55);
  assert.equal(resolveEnergyCeiling('techno industrielle, kick sature'), 1);
  assert.equal(resolveEnergyCeiling('ballade folk guitare'), 0.7);
  assert.equal(resolveEnergyCeiling(''), 0.95, 'sans direction, on ne bride pas');
});

test('une berceuse n atteint jamais l energie d un banger', () => {
  const berceuse = buildVivyDynamicArc(['Intro', 'Verse 1', 'Outro'], { direction: 'berceuse acoustique' });
  const banger = buildVivyDynamicArc(['Intro', 'Chorus', 'Drop', 'Outro'], { direction: 'techno industrielle' });
  const maxBerceuse = Math.max(...berceuse.steps.map((s) => s.intensity));
  const maxBanger = Math.max(...banger.steps.map((s) => s.intensity));
  assert.ok(maxBerceuse <= 0.56, `berceuse trop forte: ${maxBerceuse}`);
  assert.ok(maxBanger > maxBerceuse, 'un banger doit pouvoir monter plus haut');
});

test('l arc reste depouille aux bords et plein au centre', () => {
  const arc = buildVivyDynamicArc(['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Outro']);
  const premier = arc.steps[0].intensity;
  const dernier = arc.steps[arc.steps.length - 1].intensity;
  const milieu = arc.steps[2].intensity;
  assert.ok(milieu > premier && milieu > dernier, 'la courbe doit culminer au centre');
});

test('sans sections, rien n est fabrique', () => {
  const arc = buildVivyDynamicArc([]);
  assert.equal(arc.line, '');
  assert.equal(arc.compact, '');
  assert.deepEqual(arc.steps, []);
});

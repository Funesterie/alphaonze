'use strict';

const test = require('node:test');
const assert = require('node:assert');

const b = require('../src/music/persona-binome.cjs');

const morte = (name, extra = {}) => ({ name, personaExpired: true, hasSample: true, ...extra });
const vivante = (name) => ({ name, personaExpired: false, hasSample: true });

test('djeff et vivy sont binomes, dans les deux sens', () => {
  assert.strictEqual(b.binomeDe('djeff'), 'vivy');
  assert.strictEqual(b.binomeDe('vivy'), 'djeff');
});

test('l appariement est symetrique partout', () => {
  for (const [x, y] of b.PAIRES) {
    assert.strictEqual(b.binomeDe(x), y, `${x} -> ${y}`);
    assert.strictEqual(b.binomeDe(y), x, `${y} -> ${x}`);
  }
});

test('personne n est son propre binome', () => {
  for (const nom of Object.keys(b.BINOMES)) {
    assert.notStrictEqual(b.binomeDe(nom), nom, `${nom} se veille lui-meme`);
  }
});

test('les douze voix du catalogue ont un binome', () => {
  const catalogue = ['djeff', 'vivy', 'a11', 'kaen44', 'grok', 'codex',
    'chatgpt', 'claude', 'kiro', 'gemini', 'ile', 'marvin'];
  for (const nom of catalogue) {
    assert.ok(b.binomeDe(nom), `${nom} est seul`);
  }
});

test('LE garde-fou : reanimer avec l ADN du binome est refuse', () => {
  // C est le bug du 30/07 : Djeff mort, aucune persona envoyee, Suno improvise
  // en feminin. Le code doit rendre ce cablage impossible, pas improbable.
  const v = b.verifierAdn({ personaMorte: 'djeff', sourceAdn: 'vivy' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.raison, 'adn_etranger');
  assert.match(v.detail, /voix de vivy/);
});

test('reanimer avec son propre ADN est accepte', () => {
  assert.strictEqual(b.verifierAdn({ personaMorte: 'djeff', sourceAdn: 'djeff' }).ok, true);
});

test('une voix vivante ne declenche rien', () => {
  const p = b.planDeVeille(vivante('djeff'));
  assert.strictEqual(p.action, 'rien');
  assert.strictEqual(p.raison, 'vivante');
});

test('une voix morte avec ADN est relevee par son binome, sur son propre ADN', () => {
  const p = b.planDeVeille(morte('djeff'));
  assert.strictEqual(p.action, 'reanimer');
  assert.strictEqual(p.declencheur, 'vivy');
  assert.strictEqual(p.sourceAdn, 'djeff', 'l ADN doit rester celui du mort');
});

test('une voix morte sans ADN alerte au lieu de bruler des credits', () => {
  const p = b.planDeVeille({ name: 'djeff', personaExpired: true, hasSample: false });
  assert.strictEqual(p.action, 'alerter');
  assert.strictEqual(p.raison, 'adn_absent');
});

test('une voix morte sans binome alerte plutot que de rester silencieuse', () => {
  const p = b.planDeVeille(morte('inconnue-au-bataillon'));
  assert.strictEqual(p.action, 'alerter');
  assert.strictEqual(p.raison, 'sans_binome');
});

test('la limite de relances par passage est respectee', () => {
  // Un compte Suno suspendu fait expirer tout le catalogue d un coup. Relancer
  // douze generations ne reparerait rien et couterait douze fois.
  const tout = ['djeff', 'vivy', 'a11', 'kaen44', 'grok', 'codex'].map((n) => morte(n));
  const r = b.veillerSurCatalogue(tout, { limiteReanimations: 2 });
  assert.strictEqual(r.reanimations.length, 2);
  assert.strictEqual(r.reportees.length, 4, 'les relances repoussees doivent rester visibles');
  assert.strictEqual(r.mortes, 6);
});

test('un catalogue sain ne declenche rien', () => {
  const r = b.veillerSurCatalogue(['djeff', 'vivy', 'a11'].map(vivante));
  assert.strictEqual(r.mortes, 0);
  assert.strictEqual(r.reanimations.length, 0);
  assert.strictEqual(r.reportees.length, 0);
});

test('une entree sans nom ne casse pas la veille', () => {
  const r = b.veillerSurCatalogue([{}, null, { name: '' }, morte('djeff')]);
  assert.strictEqual(r.reanimations.length, 1);
});

test('le vrai etat du catalogue prod ne declenche aucune relance', () => {
  // Releve le 16/08/2026 : douze voix, aucune expiree, toutes avec ADN.
  const prod = ['djeff', 'ile', 'marvin', 'vivy', 'a11', 'kaen44',
    'grok', 'chatgpt', 'kiro', 'codex', 'gemini', 'claude']
    .map((n) => ({ name: n, personaExpired: false, hasSample: true }));
  const r = b.veillerSurCatalogue(prod);
  assert.strictEqual(r.total, 12);
  assert.strictEqual(r.mortes, 0);
  assert.strictEqual(r.reanimations.length, 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normaliserCasting, normaliserDistribution } = require('../src/clips/clip-router.cjs');
const { resolveClipIdentity } = require('../src/clips/clip-vivy-director.cjs');

// Constate le 12/09/2026 : la page NOSSEN envoyait casting et multiVoice, la
// route /start les jetait, et aucun clip lance depuis le site ou le telephone ne
// recevait d'identite. Chaque plan reinventait alors le visage du personnage.

test('le casting de la page est normalise, jamais pris tel quel', () => {
  assert.equal(normaliserCasting(' Djeff '), 'djeff');
  assert.equal(normaliserCasting('duo-djeff-vivy'), 'duo-djeff-vivy');
  for (const douteux of ['<script>', 'djeff; rm -rf', '', null, undefined]) {
    assert.equal(normaliserCasting(douteux), '', String(douteux));
  }
});

test('la distribution vient de multiVoice, sinon du casting explicite', () => {
  assert.deepEqual(normaliserDistribution(['djeff', 'vivy'], 'duo-djeff-vivy'), ['djeff', 'vivy']);
  assert.deepEqual(normaliserDistribution([], 'djeff'), ['djeff']);
  assert.deepEqual(normaliserDistribution(undefined, 'kaen44'), ['kaen44']);
  assert.deepEqual(normaliserDistribution(['Djeff', 'djeff'], ''), ['djeff'], 'doublons retires');
  assert.deepEqual(normaliserDistribution(['<x>'], 'vivy'), ['vivy'], 'entrees invalides ignorees');
});

test('auto, le vide et un random-lead non resolu laissent choisir le Director', () => {
  assert.deepEqual(normaliserDistribution([], 'auto'), []);
  assert.deepEqual(normaliserDistribution([], ''), []);
  assert.deepEqual(normaliserDistribution([], 'random-lead'), []);
});

const ids = (config) => resolveClipIdentity(config).identityIds.slice().sort();
test('le chanteur balise dans les paroles prime sur le casting auto de Djeff', () => {
  const lyrics = '[Intro]\n[Kaen44]\nHello le Tik Tok, mon reflet dans le verre\n[Chorus]\n[Kaen44]\nJe danse';
  assert.deepEqual(ids({ title: 'Hello le Tik Tok', lyrics, casting: 'auto' }), ['k44']);
  assert.deepEqual(ids({ title: 'Hello le Tik Tok', lyrics, casting: 'djeff', castArtists: ['djeff'] }), ['djeff']);
});
const SANS_NOM = { title: 'FIGHTERZ CLUB', lyrics: 'des paroles qui ne nomment personne', style: 'nuit, neons' };

function avecDefaut(valeur, fn) {
  const avant = process.env.NOSSEN_CLIP_DEFAULT_CAST;
  if (valeur === undefined) delete process.env.NOSSEN_CLIP_DEFAULT_CAST; else process.env.NOSSEN_CLIP_DEFAULT_CAST = valeur;
  try { fn(); } finally {
    if (avant === undefined) delete process.env.NOSSEN_CLIP_DEFAULT_CAST; else process.env.NOSSEN_CLIP_DEFAULT_CAST = avant;
  }
}

test('un casting explicite impose son identite', () => {
  assert.deepEqual(ids({ ...SANS_NOM, casting: 'djeff', castArtists: ['djeff'] }), ['djeff']);
  assert.deepEqual(ids({ ...SANS_NOM, casting: 'kaen44', castArtists: ['kaen44'] }), ['k44']);
  assert.deepEqual(ids({ ...SANS_NOM, casting: 'duo-djeff-vivy', castArtists: ['djeff', 'vivy'] }), ['djeff', 'vivy']);
});

test('en auto, un clip sans nom recoit Djeff au lieu de visages au hasard', () => {
  avecDefaut(undefined, () => {
    assert.deepEqual(ids({ ...SANS_NOM, casting: 'auto', castArtists: [] }), ['djeff']);
    assert.deepEqual(ids({ ...SANS_NOM }), ['djeff'], 'un appel sans casting se comporte comme auto');
  });
});

test('en auto, un personnage nomme dans les paroles prime sur le defaut', () => {
  avecDefaut(undefined, () => {
    assert.deepEqual(ids({ title: 'Nuit', lyrics: 'Vivy chante sous la pluie', casting: 'auto', castArtists: [] }), ['vivy']);
  });
});

test('une voix IA choisie explicitement ne recoit pas de visage emprunte', () => {
  avecDefaut(undefined, () => {
    assert.deepEqual(ids({ ...SANS_NOM, casting: 'claude', castArtists: ['claude'] }), []);
  });
});

test('le defaut se desactive sans toucher au code', () => {
  avecDefaut('aucun', () => {
    assert.deepEqual(ids({ ...SANS_NOM, casting: 'auto', castArtists: [] }), []);
  });
});

test('le rendu choisi sur la page (film ou manga) voyage jusqu au prompt de chaque plan', () => {
  const { normaliserRendu } = require('../src/clips/clip-router.cjs');
  const { renduVisuel } = require('../src/clips/clip-generator-v2.cjs');
  assert.equal(normaliserRendu('anime'), 'anime');
  assert.equal(normaliserRendu('Manga'), 'anime', 'le mot de Djeff');
  assert.equal(normaliserRendu(''), 'film', 'defaut : film');
  assert.equal(normaliserRendu('<script>'), 'film', 'rien du navigateur n est repris tel quel');
  assert.match(renduVisuel({}, 'anime'), /anime/i, 'le choix du clip prime');
  assert.match(renduVisuel({ NOSSEN_CLIP_RENDER: 'anime' }, 'film'), /Live-action/, 'meme contre la variable de defaut');
});

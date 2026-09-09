'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { DJEFF_ENGINE_CLOUD_MODEL, resolveDjeffEngineMode } = require('../src/clips/clip-vivy-director.cjs');

// Le local est qwen2.5:32b (19,9 Go) sur une machine SANS GPU: 45 s accordees
// pour un travail de 10 a 30 minutes. Le defaut doit donc etre le cloud, sinon
// la relecture est ignoree a chaque clip -- constate deux fois le 09/09/2026.
test('le cloud est le defaut, y compris sur une valeur inconnue', () => {
  assert.equal(resolveDjeffEngineMode({}), 'cloud');
  assert.equal(resolveDjeffEngineMode({ DJEFF_ENGINE_MODE: '' }), 'cloud');
  assert.equal(resolveDjeffEngineMode({ DJEFF_ENGINE_MODE: 'nimportequoi' }), 'cloud');
  assert.equal(resolveDjeffEngineMode(undefined), 'cloud');
});

test('les trois modes prevus sont acceptes, insensibles a la casse', () => {
  assert.equal(resolveDjeffEngineMode({ DJEFF_ENGINE_MODE: 'local' }), 'local');
  assert.equal(resolveDjeffEngineMode({ DJEFF_ENGINE_MODE: ' AUTO ' }), 'auto');
  assert.equal(resolveDjeffEngineMode({ DJEFF_ENGINE_MODE: 'Cloud' }), 'cloud');
});

// Sol ecrit en GPT et K44 relit en Grok: un relecteur qui partage le cerveau de
// l'auteur relit ses propres angles morts.
test('le relecteur final ne partage pas le moteur de Sol ni celui de K44', () => {
  assert.match(DJEFF_ENGINE_CLOUD_MODEL, /^claude-/);
  assert.doesNotMatch(DJEFF_ENGINE_CLOUD_MODEL, /gpt|grok/i);
});

// Le budget etait fige a 1200 jetons. Sur un clip full de 26 plans, la reponse
// etait coupee en plein JSON: le tableau devenait impossible a parser et tout le
// travail du relecteur partait en silence sous "reponse non parsable".
test('le budget de jetons suit le nombre de plans au lieu d etre fige', () => {
  const { djeffEngineTokenBudget } = require('../src/clips/clip-vivy-director.cjs');
  assert.ok(djeffEngineTokenBudget(26) > djeffEngineTokenBudget(6), 'un clip full doit recevoir plus qu un clip court');
  assert.ok(djeffEngineTokenBudget(26) > 1200, 'l ancien plafond fixe coupait les clips full');
  assert.equal(djeffEngineTokenBudget(6), 600 + 6 * 260);
  // Borne haute: on laisse de la place, on ne signe pas un cheque en blanc.
  assert.equal(djeffEngineTokenBudget(10000), 16000);
  // Une valeur absente ou absurde ne doit pas donner un budget nul.
  for (const bidon of [0, -3, null, undefined, 'douze']) {
    assert.ok(djeffEngineTokenBudget(bidon) >= 600 + 6 * 260, String(bidon));
  }
});

test('le plan garde la place d une vraie consigne visuelle', () => {
  const { DJEFF_VISUAL_MAX_CHARS } = require('../src/clips/clip-vivy-director.cjs');
  assert.ok(DJEFF_VISUAL_MAX_CHARS >= 600, 'a 300 caracteres les plans travailles etaient coupes en pleine phrase');
});

test('le relecteur tourne sur le modele le plus puissant disponible', () => {
  assert.equal(DJEFF_ENGINE_CLOUD_MODEL, 'claude-opus-5');
});

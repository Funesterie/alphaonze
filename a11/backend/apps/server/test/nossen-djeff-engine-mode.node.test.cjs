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

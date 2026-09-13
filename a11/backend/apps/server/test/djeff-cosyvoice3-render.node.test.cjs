'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_COSY_PYTHON,
  DEFAULT_PROMPT_AUDIO,
  normalizeMode,
  resolvePython,
} = require('../scripts/render-djeff-cosyvoice3.cjs');

test('Djeff CosyVoice3 renderer defaults to instruct mode for French diction', () => {
  assert.equal(normalizeMode(''), 'instruct');
  assert.equal(normalizeMode('zero-shot'), 'zero');
  assert.equal(normalizeMode('cross-lingual'), 'cross');
});

// Outil du poste Windows (D:\agent-bus) : sous Linux le chemin par defaut n'a pas de sens.
test('Djeff CosyVoice3 renderer uses isolated local runtime and short prompt', { skip: process.platform !== 'win32' && 'outil local Windows' }, () => {
  assert.equal(resolvePython(), DEFAULT_COSY_PYTHON);
  assert.match(DEFAULT_PROMPT_AUDIO, /djeff-ref-pignon-5s\.wav$/i);
});

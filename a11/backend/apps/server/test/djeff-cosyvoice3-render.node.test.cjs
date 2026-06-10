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

test('Djeff CosyVoice3 renderer uses isolated local runtime and short prompt', () => {
  assert.equal(resolvePython(), DEFAULT_COSY_PYTHON);
  assert.match(DEFAULT_PROMPT_AUDIO, /djeff-ref-pignon-5s\.wav$/i);
});

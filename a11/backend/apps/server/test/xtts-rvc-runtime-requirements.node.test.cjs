'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const requirementsPath = path.resolve(__dirname, '../../../../ops/voice/requirements.xtts-rvc.txt');

function readPinnedRequirements() {
  const text = fs.readFileSync(requirementsPath, 'utf8');
  const pins = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)==(.+)$/);
    if (match) pins.set(match[1].toLowerCase(), match[2]);
  }

  return pins;
}

test('XTTS/RVC runtime keeps Coqui TTS on the patched transformers stack', () => {
  const pins = readPinnedRequirements();

  assert.equal(pins.get('tts'), '0.22.0');
  assert.equal(pins.get('transformers'), '4.39.3');
  assert.equal(pins.get('tokenizers'), '0.15.2');
  assert.equal(pins.get('huggingface-hub'), '0.20.3');
  assert.match(
    fs.readFileSync(path.resolve(__dirname, '../../../../ops/voice/Dockerfile.xtts-rvc'), 'utf8'),
    /BeamSearchScorer/,
  );
});

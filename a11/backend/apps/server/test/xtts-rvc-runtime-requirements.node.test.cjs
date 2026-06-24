'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const requirementsPath = path.resolve(__dirname, '../../../../ops/voice/requirements.xtts-rvc.txt');
const bridgePath = path.resolve(__dirname, '../../../../ops/voice/funesterie_xtts_rvc_api.py');

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
  assert.equal(pins.get('transformers'), '4.53.3');
  assert.equal(pins.get('tokenizers'), '0.21.4');
  assert.equal(pins.get('huggingface-hub'), '0.36.2');
  const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../../../ops/voice/Dockerfile.xtts-rvc'), 'utf8');
  assert.match(dockerfile, /--index-url https:\/\/download\.pytorch\.org\/whl\/cpu --extra-index-url https:\/\/pypi\.org\/simple/);
  assert.match(dockerfile, /BeamSearchScorer/);
  assert.match(dockerfile, /GenerationMixin/);
  assert.match(dockerfile, /GPT2InferenceModel/);
  assert.match(dockerfile, /'generate'/);
  assert.match(dockerfile, /_prepare_generation_config/);
  assert.match(dockerfile, /GenerationConfig/);
  assert.match(dockerfile, /getattr_static/);

  const bridge = fs.readFileSync(bridgePath, 'utf8');
  assert.match(bridge, /_prepare_generation_config/);
  assert.match(bridge, /xttsPrepareGenerationConfig/);
  assert.match(bridge, /GenerationConfig\.from_model_config/);
  assert.match(bridge, /getattr_static/);
});

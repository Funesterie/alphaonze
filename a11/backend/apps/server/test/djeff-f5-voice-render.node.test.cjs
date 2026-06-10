'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_REF_AUDIO,
  DEFAULT_REF_TEXT,
  buildF5Args,
  resolveF5Cli,
} = require('../scripts/render-djeff-f5-voice.cjs');

test('Djeff F5 renderer builds the official reference-driven CLI call', () => {
  const args = buildF5Args({
    refAudio: DEFAULT_REF_AUDIO,
    refText: DEFAULT_REF_TEXT,
    genText: 'Bonjour Djeff.',
    outputDir: 'D:\\tmp\\out',
    outputFile: 'sample.wav',
  });

  assert.deepEqual(args.slice(0, 2), ['--model', 'F5TTS_v1_Base']);
  assert.ok(args.includes('--ref_audio'));
  assert.ok(args.includes(DEFAULT_REF_AUDIO));
  assert.ok(args.includes('--ref_text'));
  assert.ok(args.includes(DEFAULT_REF_TEXT));
  assert.ok(args.includes('--gen_text'));
  assert.ok(args.includes('Bonjour Djeff.'));
});

test('Djeff F5 renderer resolves isolated local runtime by default', () => {
  assert.match(resolveF5Cli(), /D:\\agent-bus\\voice\\F5-TTS\\\.venv\\Scripts\\f5-tts_infer-cli\.exe$/i);
});

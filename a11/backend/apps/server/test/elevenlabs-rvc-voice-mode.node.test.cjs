'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ttsRouter = require('../routes/tts.cjs');
const { normalizeElevenLabsRvcRequest, wantsElevenLabsRvcPipeline } = ttsRouter;

test('detects the explicit elevenlabs+rvc voice mode and its aliases', () => {
  assert.equal(wantsElevenLabsRvcPipeline({ voiceMode: 'elevenlabs-rvc' }), true);
  assert.equal(wantsElevenLabsRvcPipeline({ voicePipeline: 'eleven-rvc' }), true);
  assert.equal(wantsElevenLabsRvcPipeline({ voiceConversionEngine: 'elevenlabs-rvc' }), true);
  assert.equal(wantsElevenLabsRvcPipeline({ voiceMode: 'elevenlabs+rvc' }), true);
  assert.equal(wantsElevenLabsRvcPipeline({ voiceMode: 'xtts-rvc' }), false);
  assert.equal(wantsElevenLabsRvcPipeline({}), false);
});

test('elevenlabs+rvc mode renders via ElevenLabs then converts that clip through RVC', () => {
  const normalized = normalizeElevenLabsRvcRequest({
    voiceMode: 'elevenlabs-rvc',
    persona: 'vivy',
    text: 'Bonjour Jeffrey, ceci est un test de voix officielle.',
  });

  // ElevenLabs produces the clean, intelligible speech...
  assert.equal(normalized.provider, 'elevenlabs');
  assert.equal(normalized.ttsProvider, 'elevenlabs');
  // ...and the bridge re-timbres that generated clip through the persona RVC model.
  assert.equal(normalized.voiceConversion, true);
  assert.equal(normalized.useRvc, true);
  assert.equal(normalized.allowRvc, true);
  assert.equal(normalized.voiceConversionEngine, 'elevenlabs-rvc');
  assert.equal(normalized.voiceConversionSourceEngine, 'elevenlabs');
  assert.equal(normalized.voiceConversionPipeline, 'convert');
  assert.equal(normalized.persona, 'vivy');
  assert.equal(normalized.identityVoice, true);
  assert.equal(normalized.neutralVoice, false);
});

test('k44 alias resolves to the kaen44 persona for elevenlabs+rvc', () => {
  const normalized = normalizeElevenLabsRvcRequest({
    voiceConversionEngine: 'elevenlabs-rvc',
    persona: 'k44',
    text: 'Test',
  });
  assert.equal(normalized.provider, 'elevenlabs');
  assert.equal(normalized.persona, 'kaen44');
});

test('requests without the mode are returned unchanged', () => {
  const body = { persona: 'a11', text: 'Salut', provider: 'piper' };
  const normalized = normalizeElevenLabsRvcRequest(body);
  assert.equal(normalized, body);
  assert.equal(normalized.provider, 'piper');
});

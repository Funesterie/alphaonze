'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ttsRouter = require('../routes/tts.cjs');
const {
  normalizeElevenLabsRvcRequest,
  wantsElevenLabsRvcPipeline,
  shouldDefaultOfficialToElevenLabsRvc,
  shouldRouteOfficialToElevenLabsRvc,
  hasSpecialLocalVoiceStyle,
} = ttsRouter;

const PAID_USER = { user: { isAdmin: true } };

function withElevenLabsEnv(overrides, run) {
  const keys = [
    'A11_ELEVENLABS_API_KEY',
    'A11_ELEVENLABS_VIVY_VOICE_ID',
    'A11_ELEVENLABS_TTS_DISABLED',
    'A11_TTS_OFFICIAL_ELEVENLABS_RVC_DEFAULT',
  ];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  try {
    return run();
  } finally {
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}

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

test('official voice defaults to elevenlabs+rvc only when ElevenLabs is configured', () => {
  const officialRequest = { persona: 'vivy', voiceReferenceRequired: true, text: 'Bonjour' };

  // ElevenLabs configured with a Vivy voice id -> default the official voice to it.
  withElevenLabsEnv(
    { A11_ELEVENLABS_API_KEY: 'test-key', A11_ELEVENLABS_VIVY_VOICE_ID: 'voice-vivy' },
    () => assert.equal(shouldDefaultOfficialToElevenLabsRvc(officialRequest), true)
  );

  // No ElevenLabs key -> keep the existing XTTS/RVC official route (no regression).
  withElevenLabsEnv(
    { A11_ELEVENLABS_API_KEY: '', A11_ELEVENLABS_VIVY_VOICE_ID: '', A11_ELEVENLABS_TTS_DISABLED: 'true' },
    () => assert.equal(shouldDefaultOfficialToElevenLabsRvc(officialRequest), false)
  );
});

test('official elevenlabs default respects neutral voice, special styles and the kill switch', () => {
  withElevenLabsEnv(
    { A11_ELEVENLABS_API_KEY: 'test-key', A11_ELEVENLABS_VIVY_VOICE_ID: 'voice-vivy' },
    () => {
      // explicit neutral voice must never be hijacked
      assert.equal(shouldDefaultOfficialToElevenLabsRvc({ persona: 'vivy', neutralVoice: true }), false);
      // a dedicated local RVC style keeps its XTTS/RVC route
      assert.equal(shouldDefaultOfficialToElevenLabsRvc({ persona: 'a11', voiceReferenceRequired: true, voiceStyle: 'a11-voix-de-lait' }), false);
      // non-official persona is out of scope
      assert.equal(shouldDefaultOfficialToElevenLabsRvc({ persona: 'demo-alice', voiceReferenceRequired: true }), false);
      // kill switch disables the default
      withElevenLabsEnv(
        { A11_TTS_OFFICIAL_ELEVENLABS_RVC_DEFAULT: 'false' },
        () => assert.equal(shouldDefaultOfficialToElevenLabsRvc({ persona: 'vivy', voiceReferenceRequired: true }), false)
      );
    }
  );
});

test('explicit elevenlabs-rvc gracefully falls back to XTTS when ElevenLabs is not configured', () => {
  const explicit = { persona: 'vivy', voiceMode: 'elevenlabs-rvc', text: 'Bonjour' };

  // ElevenLabs configured -> route to the ElevenLabs+RVC pipeline.
  withElevenLabsEnv(
    { A11_ELEVENLABS_API_KEY: 'test-key', A11_ELEVENLABS_VIVY_VOICE_ID: 'voice-vivy' },
    () => assert.equal(shouldRouteOfficialToElevenLabsRvc(PAID_USER, explicit), true)
  );

  // No ElevenLabs -> do NOT force ElevenLabs (caller keeps the XTTS official route).
  withElevenLabsEnv(
    { A11_ELEVENLABS_API_KEY: '', A11_ELEVENLABS_VIVY_VOICE_ID: '', A11_ELEVENLABS_TTS_DISABLED: 'true' },
    () => assert.equal(shouldRouteOfficialToElevenLabsRvc(PAID_USER, explicit), false)
  );
});

test('official voice routing requires a paid tier', () => {
  withElevenLabsEnv(
    { A11_ELEVENLABS_API_KEY: 'test-key', A11_ELEVENLABS_VIVY_VOICE_ID: 'voice-vivy' },
    () => {
      const officialRequest = { persona: 'vivy', voiceReferenceRequired: true, text: 'Bonjour' };
      assert.equal(shouldRouteOfficialToElevenLabsRvc(PAID_USER, officialRequest), true);
      // a basic, non-subscribed account never reaches the paid ElevenLabs path
      const basic = { user: { account_tier: 'basic', subscription_active: false } };
      assert.equal(shouldRouteOfficialToElevenLabsRvc(basic, officialRequest), false);
    }
  );
});

test('detects dedicated local RVC styles', () => {
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'djeff-rap' }), true);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'djeff-officielle' }), true);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'a11-voix-de-lait' }), true);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'a11-official-stern-french' }), true);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'kaen44-official-french-narrator' }), true);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'vivy-official-french-conversational' }), true);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'terminator' }), false);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: 'donna' }), false);
  assert.equal(hasSpecialLocalVoiceStyle({ voiceStyle: '' }), false);
  assert.equal(hasSpecialLocalVoiceStyle({}), false);
});

test('voice reference selection no longer accepts legacy character aliases', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/tts/voice-reference-store.cjs'),
    'utf8'
  );

  assert.doesNotMatch(source, /a11-terminator|kaen44-donna|['"]terminator['"]|['"]donna['"]/i);
  assert.match(source, /a11-official-stern-french/);
  assert.match(source, /kaen44-official-french-narrator/);
});

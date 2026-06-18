'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_PERSONA_DIRECTIONS,
  VOICE_REFERENCE_POLICY,
  FAMILY_VOICE_IDENTITIES,
  PERSONAL_VOICE_POLICY,
  PROVIDERS,
  PROVIDER_ORDER,
  LOCAL_PROVIDER_ORDER,
  OFFICIAL_READY_VOICE_PROFILES,
  OFFICIAL_PERSONAS,
  buildVoicePersonaInstruction,
  getVoicePersonaDirection,
  getReadyVoiceProfile,
  resolveVoiceProvider,
  isProviderRuntimeConfigured,
  isLegacyCloudTtsProvider,
  isLegacyCloudTtsProviderEnabled,
  isDemoModel,
  guardDemoModel,
  MANIFEST,
} = require('../src/tts/voice-provider-manifest.cjs');

describe('voice-provider-manifest', () => {

  describe('OFFICIAL_PERSONAS', () => {
    it('contains a11, kaen44, vivy', () => {
      assert.ok(OFFICIAL_PERSONAS.has('a11'));
      assert.ok(OFFICIAL_PERSONAS.has('kaen44'));
      assert.ok(OFFICIAL_PERSONAS.has('vivy'));
    });

    it('does not contain demo-alice', () => {
      assert.ok(!OFFICIAL_PERSONAS.has('demo-alice'));
    });
  });

  describe('VOICE_PERSONA_DIRECTIONS', () => {
    it('defines style-only directions for every official persona', () => {
      assert.equal(VOICE_REFERENCE_POLICY.mode, 'style_reference_only_no_impersonation');

      for (const persona of ['a11', 'kaen44', 'vivy']) {
        const direction = getVoicePersonaDirection(persona);
        assert.equal(direction, VOICE_PERSONA_DIRECTIONS[persona]);
        assert.match(direction.prompt, /originale/i);
        assert.match(direction.prompt, /ne clone/i);
        assert.ok(Array.isArray(direction.referenceMoodboard));
        assert.ok(direction.referenceMoodboard.length >= 1);
      }
    });

    it('builds provider instructions with the licensed-data guardrail', () => {
      const instruction = buildVoicePersonaInstruction('kaen44');
      assert.match(instruction, /Voix Kaen44 originale/i);
      assert.match(instruction, /owned, licensed, or explicitly consented audio/i);
      assert.match(instruction, /style_reference_only_no_impersonation/i);
    });
  });

  describe('family voice identity map', () => {
    it('pins the requested family accounts to their voice identities', () => {
      assert.equal(FAMILY_VOICE_IDENTITIES.djeff.accountEmail, 'cellaurojeffrey@gmail.com');
      assert.equal(FAMILY_VOICE_IDENTITIES.djeff.voiceStyle, 'djeff-rap');
      assert.equal(FAMILY_VOICE_IDENTITIES.k44.accountEmail, 'giovannabrunetto@gmail.com');
      assert.equal(FAMILY_VOICE_IDENTITIES.k44.voiceStyle, 'kaen44-official-french-narrator');
      assert.equal(FAMILY_VOICE_IDENTITIES.a11.accountEmail, 'bayetgerard@gmail.com');
      assert.equal(FAMILY_VOICE_IDENTITIES.vivy.accountEmail, 'jewitt.charlene@gmail.com');
      assert.equal(PERSONAL_VOICE_POLICY.minimumTier, 'premium');
    });
  });

  describe('OFFICIAL_READY_VOICE_PROFILES', () => {
    it('defines ready-made voice choices for every official persona without legacy labels', () => {
      for (const persona of ['a11', 'kaen44', 'vivy']) {
        const profile = OFFICIAL_READY_VOICE_PROFILES[persona];
        assert.ok(profile.styleId);
        assert.ok(profile.cartesiaVoiceId);
        assert.ok(profile.azureVoice);
        assert.ok(profile.openAiVoice);
        assert.equal(getReadyVoiceProfile(persona, PROVIDERS.CARTESIA).provider, PROVIDERS.CARTESIA);
        assert.doesNotMatch(getReadyVoiceProfile(persona, PROVIDERS.CARTESIA).label, /Laurent|Manon|George|ElevenLabs|Cartesia/i);
      }
    });

    it('does not use legacy character labels as official ready-made labels', () => {
      const serialized = JSON.stringify(OFFICIAL_READY_VOICE_PROFILES).toLowerCase();
      assert.doesNotMatch(serialized, /terminator|donna paulsen|t-800|schwarzenegger/);
    });

    it('uses distinct ready-made ElevenLabs voice ids for public voice tests', () => {
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.a11.elevenLabsVoiceId, 'pNInz6obpgDQGcFmaJgB');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.kaen44.elevenLabsVoiceId, 'EXAVITQu4vr4xnSDxMaL');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.vivy.elevenLabsVoiceId, '21m00Tcm4TlvDq8ikWAM');
      assert.notEqual(OFFICIAL_READY_VOICE_PROFILES.a11.elevenLabsVoiceId, OFFICIAL_READY_VOICE_PROFILES.kaen44.elevenLabsVoiceId);
      assert.notEqual(OFFICIAL_READY_VOICE_PROFILES.a11.elevenLabsVoiceId, OFFICIAL_READY_VOICE_PROFILES.vivy.elevenLabsVoiceId);
      assert.notEqual(OFFICIAL_READY_VOICE_PROFILES.kaen44.elevenLabsVoiceId, OFFICIAL_READY_VOICE_PROFILES.vivy.elevenLabsVoiceId);
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.a11.cartesiaVoiceId, '7345dfa5-ee04-44d2-abf4-29262b880ab4');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.kaen44.cartesiaVoiceId, '8832a0b5-47b2-4751-bb22-6a8e2149303d');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.vivy.cartesiaVoiceId, '2f8e82c4-cb94-4e6d-8b6a-29bf58ceb60a');
      assert.ok(isLegacyCloudTtsProvider(PROVIDERS.CARTESIA));
      assert.ok(isLegacyCloudTtsProvider(PROVIDERS.ELEVENLABS));
    });

    it('keeps local official references on readable source filenames', () => {
      assert.equal(MANIFEST.a11.providers[PROVIDERS.XTTS_RVC].modelPath, 'voice-library/A11 ref.wav');
      assert.equal(MANIFEST.kaen44.providers[PROVIDERS.XTTS_RVC].modelPath, 'voice-library/K44 Ref.wav');
      assert.equal(MANIFEST.vivy.providers[PROVIDERS.XTTS_RVC].modelPath, 'voice-library/Vivy ref.wav');
    });
  });

  describe('resolveVoiceProvider — official personas', () => {
    it('provider order keeps cloud providers available while official family personas prefer local references', () => {
      assert.deepEqual(LOCAL_PROVIDER_ORDER, [PROVIDERS.XTTS_RVC, PROVIDERS.PIPER]);
      assert.deepEqual(PROVIDER_ORDER, [PROVIDERS.ELEVENLABS, PROVIDERS.XTTS_RVC, PROVIDERS.AZURE, PROVIDERS.OPENAI, PROVIDERS.PIPER]);
    });

    for (const persona of ['a11', 'kaen44', 'vivy']) {
      it(`${persona}: auto-selects neutral fallback when no ready-made provider is configured`, () => {
        const result = resolveVoiceProvider(persona);
        assert.equal(result.provider, PROVIDERS.PIPER);
        assert.equal(result.configured, true);
      });

      it(`${persona}: keeps Cartesia explicit-only even when its key exists`, () => {
        const previous = {
          A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
          A11_CARTESIA_TTS_ENABLED: process.env.A11_CARTESIA_TTS_ENABLED,
          A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
          A11_ELEVENLABS_TTS_ENABLED: process.env.A11_ELEVENLABS_TTS_ENABLED,
        };
        process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
        delete process.env.A11_ELEVENLABS_API_KEY;
        delete process.env.A11_CARTESIA_TTS_ENABLED;
        delete process.env.A11_ELEVENLABS_TTS_ENABLED;
        try {
          assert.equal(isLegacyCloudTtsProviderEnabled(PROVIDERS.CARTESIA), true);
          assert.equal(isProviderRuntimeConfigured(PROVIDERS.CARTESIA), true);
          const result = resolveVoiceProvider(persona);
          assert.notEqual(result.provider, PROVIDERS.CARTESIA);
          assert.notEqual(result.provider, PROVIDERS.ELEVENLABS);
          assert.equal(result.configured, true);
          const explicit = resolveVoiceProvider(persona, { explicitProvider: PROVIDERS.CARTESIA, allowCloud: true });
          assert.equal(explicit.provider, PROVIDERS.CARTESIA);
          assert.equal(explicit.configured, true);
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      });

      it(`${persona}: never returns demo-alice via auto-select`, () => {
        const result = resolveVoiceProvider(persona);
        assert.ok(!result.provider.includes('demo'));
        assert.ok(!result.note.toLowerCase().includes('demo-alice'));
      });

      it(`${persona}: blocks explicit XTTS/RVC without opt-in`, () => {
        const result = resolveVoiceProvider(persona, { explicitProvider: 'xtts-rvc' });
        assert.equal(result.provider, PROVIDERS.PIPER);
        assert.equal(result.diagnostic, 'rvc_not_allowed');
      });

      it(`${persona}: allows XTTS/RVC when allowRvc=true`, () => {
        const result = resolveVoiceProvider(persona, { explicitProvider: 'xtts-rvc', allowRvc: true });
        assert.equal(result.provider, PROVIDERS.XTTS_RVC);
      });
    }

    it('official personas prefer ElevenLabs when it is configured', () => {
      const previous = {
        A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
        A11_ELEVENLABS_TTS_ENABLED: process.env.A11_ELEVENLABS_TTS_ENABLED,
        A11_TTS_DEFAULT_PROVIDER: process.env.A11_TTS_DEFAULT_PROVIDER,
        A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
        A11_CARTESIA_TTS_ENABLED: process.env.A11_CARTESIA_TTS_ENABLED,
        A11_TTS_ALLOW_XTTS_RVC_AUTO: process.env.A11_TTS_ALLOW_XTTS_RVC_AUTO,
        A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
      };
      process.env.A11_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
      delete process.env.A11_TTS_DEFAULT_PROVIDER;
      process.env.A11_TTS_ALLOW_XTTS_RVC_AUTO = 'true';
      process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
      delete process.env.A11_CARTESIA_API_KEY;
      delete process.env.A11_ELEVENLABS_TTS_ENABLED;
      delete process.env.A11_CARTESIA_TTS_ENABLED;
      try {
        assert.equal(isProviderRuntimeConfigured(PROVIDERS.ELEVENLABS), true);
        assert.equal(resolveVoiceProvider('a11').provider, PROVIDERS.ELEVENLABS);
        assert.equal(resolveVoiceProvider('kaen44').provider, PROVIDERS.ELEVENLABS);
        assert.equal(resolveVoiceProvider('vivy').provider, PROVIDERS.ELEVENLABS);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('official personas accept the Vivy ElevenLabs secret names used in production', () => {
      const previous = {
        VIVY_ELEVENLABS_API_KEY: process.env.VIVY_ELEVENLABS_API_KEY,
        A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
        XI_API_KEY: process.env.XI_API_KEY,
        A11_ELEVENLABS_TTS_ENABLED: process.env.A11_ELEVENLABS_TTS_ENABLED,
        ELEVENLABS_TTS_ENABLED: process.env.ELEVENLABS_TTS_ENABLED,
        A11_ELEVENLABS_TTS_DISABLED: process.env.A11_ELEVENLABS_TTS_DISABLED,
        ELEVENLABS_TTS_DISABLED: process.env.ELEVENLABS_TTS_DISABLED,
        A11_TTS_DEFAULT_PROVIDER: process.env.A11_TTS_DEFAULT_PROVIDER,
      };
      process.env.VIVY_ELEVENLABS_API_KEY = 'test-vivy-elevenlabs-key';
      delete process.env.A11_ELEVENLABS_API_KEY;
      delete process.env.ELEVENLABS_API_KEY;
      delete process.env.XI_API_KEY;
      delete process.env.A11_ELEVENLABS_TTS_ENABLED;
      delete process.env.ELEVENLABS_TTS_ENABLED;
      delete process.env.A11_ELEVENLABS_TTS_DISABLED;
      delete process.env.ELEVENLABS_TTS_DISABLED;
      delete process.env.A11_TTS_DEFAULT_PROVIDER;
      try {
        assert.equal(isProviderRuntimeConfigured(PROVIDERS.ELEVENLABS), true);
        assert.equal(resolveVoiceProvider('vivy').provider, PROVIDERS.ELEVENLABS);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('a11: local/basic auto-select ignores configured cloud voices', () => {
      const previous = {
        A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
        A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
        A11_TTS_ALLOW_XTTS_RVC_AUTO: process.env.A11_TTS_ALLOW_XTTS_RVC_AUTO,
        A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
      };
      process.env.A11_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
      process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
      delete process.env.A11_TTS_ALLOW_XTTS_RVC_AUTO;
      delete process.env.A11_VOICE_XTTS_RVC_URL;
      try {
        const result = resolveVoiceProvider('a11', { allowCloud: false });
        assert.equal(result.provider, PROVIDERS.PIPER);
        assert.equal(result.configured, true);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('a11: local/basic auto-select can use XTTS/RVC when explicitly enabled', () => {
      const previous = {
        A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
        A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
        A11_TTS_ALLOW_XTTS_RVC_AUTO: process.env.A11_TTS_ALLOW_XTTS_RVC_AUTO,
        A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
      };
      process.env.A11_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
      process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
      process.env.A11_TTS_ALLOW_XTTS_RVC_AUTO = 'true';
      process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
      try {
        const result = resolveVoiceProvider('a11', { allowCloud: false });
        assert.equal(result.provider, PROVIDERS.XTTS_RVC);
        assert.equal(result.configured, true);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('kaen44, a11 and vivy auto-select ElevenLabs when its key exists', () => {
      const previous = {
        A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
        A11_TTS_DEFAULT_PROVIDER: process.env.A11_TTS_DEFAULT_PROVIDER,
      };
      process.env.A11_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
      delete process.env.A11_TTS_DEFAULT_PROVIDER;
      try {
        assert.equal(resolveVoiceProvider('kaen44').provider, PROVIDERS.ELEVENLABS);
        assert.equal(resolveVoiceProvider('a11').provider, PROVIDERS.ELEVENLABS);
        assert.equal(resolveVoiceProvider('vivy').provider, PROVIDERS.ELEVENLABS);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  });

  describe('resolveVoiceProvider — demo-alice', () => {
    it('demo-alice: can resolve (not official)', () => {
      const result = resolveVoiceProvider('demo-alice');
      assert.ok(result.provider);
    });

    it('demo-alice: is not in OFFICIAL_PERSONAS', () => {
      assert.ok(!OFFICIAL_PERSONAS.has('demo-alice'));
    });
  });

  describe('resolveVoiceProvider — unknown persona', () => {
    it('unknown persona returns piper neutral with diagnostic', () => {
      const result = resolveVoiceProvider('inexistant');
      assert.equal(result.provider, PROVIDERS.PIPER);
      assert.equal(result.diagnostic, 'persona_unknown');
    });
  });

  describe('isDemoModel', () => {
    it('detects demo- prefix', () => {
      assert.ok(isDemoModel('demo-alice.onnx'));
      assert.ok(isDemoModel('demo_voice.pth'));
    });

    it('does not flag normal models', () => {
      assert.ok(!isDemoModel('fr_FR-siwis-medium.onnx'));
      assert.ok(!isDemoModel('a11-voice-v1.pth'));
    });
  });

  describe('guardDemoModel', () => {
    it('blocks demo models for official personas', () => {
      assert.equal(guardDemoModel('a11', 'demo-alice.onnx'), null);
      assert.equal(guardDemoModel('kaen44', 'demo-test.pth'), null);
      assert.equal(guardDemoModel('vivy', 'demo_voice.onnx'), null);
    });

    it('allows demo models for non-official personas', () => {
      assert.equal(guardDemoModel('demo-alice', 'demo-alice.onnx'), 'demo-alice.onnx');
    });

    it('allows non-demo models for official personas', () => {
      assert.equal(guardDemoModel('a11', 'a11-voice-v1.onnx'), 'a11-voice-v1.onnx');
    });
  });
});

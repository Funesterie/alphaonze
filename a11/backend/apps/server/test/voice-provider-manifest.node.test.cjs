'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_PERSONA_DIRECTIONS,
  VOICE_REFERENCE_POLICY,
  PROVIDERS,
  OFFICIAL_READY_VOICE_PROFILES,
  OFFICIAL_PERSONAS,
  buildVoicePersonaInstruction,
  getVoicePersonaDirection,
  getReadyVoiceProfile,
  resolveVoiceProvider,
  isProviderRuntimeConfigured,
  isDemoModel,
  guardDemoModel,
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

  describe('OFFICIAL_READY_VOICE_PROFILES', () => {
    it('defines ready-made voice choices for every official persona', () => {
      for (const persona of ['a11', 'kaen44', 'vivy']) {
        const profile = OFFICIAL_READY_VOICE_PROFILES[persona];
        assert.ok(profile.styleId);
        assert.ok(profile.cartesiaVoiceId);
        assert.ok(profile.azureVoice);
        assert.ok(profile.openAiVoice);
        assert.equal(getReadyVoiceProfile(persona, PROVIDERS.CARTESIA).provider, PROVIDERS.CARTESIA);
      }
    });

    it('does not use legacy character labels as official ready-made labels', () => {
      const serialized = JSON.stringify(OFFICIAL_READY_VOICE_PROFILES).toLowerCase();
      assert.doesNotMatch(serialized, /terminator|donna paulsen|t-800|schwarzenegger/);
    });

    it('uses the current approved Cartesia voice picks', () => {
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.a11.elevenLabsVoiceId, 'JBFqnCBsd6RMkjVDRZzb');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.a11.cartesiaVoiceId, '7345dfa5-ee04-44d2-abf4-29262b880ab4');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.kaen44.cartesiaVoiceId, '8832a0b5-47b2-4751-bb22-6a8e2149303d');
      assert.equal(OFFICIAL_READY_VOICE_PROFILES.vivy.cartesiaVoiceId, '2f8e82c4-cb94-4e6d-8b6a-29bf58ceb60a');
    });
  });

  describe('resolveVoiceProvider — official personas', () => {
    for (const persona of ['a11', 'kaen44', 'vivy']) {
      it(`${persona}: auto-selects neutral fallback when no ready-made provider is configured`, () => {
        const result = resolveVoiceProvider(persona);
        assert.equal(result.provider, PROVIDERS.PIPER);
        assert.equal(result.configured, true);
      });

      it(`${persona}: auto-selects Cartesia when its key is configured`, () => {
        const previous = process.env.A11_CARTESIA_API_KEY;
        process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
        try {
          assert.equal(isProviderRuntimeConfigured(PROVIDERS.CARTESIA), true);
          const result = resolveVoiceProvider(persona);
          assert.equal(result.provider, PROVIDERS.CARTESIA);
          assert.equal(result.configured, true);
        } finally {
          if (previous === undefined) delete process.env.A11_CARTESIA_API_KEY;
          else process.env.A11_CARTESIA_API_KEY = previous;
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

    it('a11: auto-selects ElevenLabs before Cartesia when configured', () => {
      const previous = {
        A11_ELEVENLABS_API_KEY: process.env.A11_ELEVENLABS_API_KEY,
        A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
      };
      process.env.A11_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
      delete process.env.A11_CARTESIA_API_KEY;
      try {
        const result = resolveVoiceProvider('a11');
        assert.equal(result.provider, PROVIDERS.ELEVENLABS);
        assert.equal(result.configured, true);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('kaen44 and vivy do not inherit the A11 ElevenLabs voice', () => {
      const previous = process.env.A11_ELEVENLABS_API_KEY;
      process.env.A11_ELEVENLABS_API_KEY = 'test-elevenlabs-key';
      try {
        assert.notEqual(resolveVoiceProvider('kaen44').provider, PROVIDERS.ELEVENLABS);
        assert.notEqual(resolveVoiceProvider('vivy').provider, PROVIDERS.ELEVENLABS);
      } finally {
        if (previous === undefined) delete process.env.A11_ELEVENLABS_API_KEY;
        else process.env.A11_ELEVENLABS_API_KEY = previous;
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

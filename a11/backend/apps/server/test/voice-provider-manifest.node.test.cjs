'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_PERSONA_DIRECTIONS,
  VOICE_REFERENCE_POLICY,
  PROVIDERS,
  OFFICIAL_PERSONAS,
  buildVoicePersonaInstruction,
  getVoicePersonaDirection,
  resolveVoiceProvider,
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
        assert.match(direction.prompt, /Ne clone pas/i);
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

  describe('resolveVoiceProvider — official personas', () => {
    for (const persona of ['a11', 'kaen44', 'vivy']) {
      it(`${persona}: auto-selects XTTS/RVC reference bridge before neutral fallback`, () => {
        const result = resolveVoiceProvider(persona);
        assert.equal(result.provider, PROVIDERS.XTTS_RVC);
        assert.equal(result.configured, true);
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

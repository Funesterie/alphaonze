const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectImageIntent,
  detectIntentWithLlm,
  isLegacyWordIntentDetectorsEnabled,
} = require('../lib/intent-detection.cjs');
const {
  createIntentResolver,
} = require('../src/resolve-user-request.cjs');

test('legacy word intent detectors are opt-in', () => {
  const previous = process.env.A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS;
  delete process.env.A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS;
  try {
    assert.equal(isLegacyWordIntentDetectorsEnabled(), false);
    assert.equal(detectImageIntent('genere une image de dragon'), false);
  } finally {
    if (previous === undefined) delete process.env.A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS;
    else process.env.A11_ENABLE_LEGACY_WORD_INTENT_DETECTORS = previous;
  }
});

test('LLM intent detection defaults to chat when no classifier is available', async () => {
  const result = await detectIntentWithLlm({
    message: 'genere une image de dragon',
    callStructuredLlmJson: null,
  });
  assert.equal(result.intent, 'chat.reply');
  assert.equal(result.reason, 'llm_unavailable_no_word_detector');
});

test('resolver does not use semantic keyword fallback unless explicitly enabled', async () => {
  const previous = process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK;
  delete process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK;
  try {
    const resolver = createIntentResolver({
      detectIntentWithLlm: async () => ({
        intent: 'chat.reply',
        confidence: 0.5,
        reason: 'low_confidence_default',
        subject: '',
      }),
    });

    const resolution = await resolver.resolveUserRequest({
      userText: 'genere une image de dragon bleu',
      executeRuntime: false,
    });

    assert.equal(resolution.kind, 'chat.reply');
    assert.equal(resolution.mask.intent, 'chat.reply');
  } finally {
    if (previous === undefined) delete process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK;
    else process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK = previous;
  }
});

test('resolver accepts explicit LLM media intent at 50 percent confidence', async () => {
  const previous = process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK;
  delete process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK;
  try {
    const resolver = createIntentResolver({
      detectIntentWithLlm: async () => ({
        intent: 'image.generate',
        confidence: 0.5,
        reason: 'explicit_llm_media_intent',
        subject: 'dragon bleu',
      }),
    });

    const resolution = await resolver.resolveUserRequest({
      userText: 'genere une image de dragon bleu',
      executeRuntime: false,
    });

    assert.equal(resolution.kind, 'image.generate');
  } finally {
    if (previous === undefined) delete process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK;
    else process.env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK = previous;
  }
});

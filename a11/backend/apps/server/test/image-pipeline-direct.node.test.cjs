const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImageSdPayload,
} = require('../src/image/image-pipeline-direct.cjs');

test('buildImageSdPayload falls back to the user request when the structured LLM returns null', async () => {
  const payload = await buildImageSdPayload({
    userMessage: 'red dragon in the sky',
    callStructuredLlmJson: async () => null,
    env: {},
  });

  assert.equal(payload.prompt, 'red dragon in the sky');
  assert.equal(payload.fallback, true);
  assert.equal(payload.fallbackReason, 'structured_prompt_fallback');
  assert.equal(payload.prompt_prebuilt, true);
});

test('buildImageSdPayload keeps image generation usable when the structured LLM throws', async () => {
  const payload = await buildImageSdPayload({
    userMessage: 'red dragon in the sky',
    callStructuredLlmJson: async () => {
      throw new Error('invalid json');
    },
    env: {},
  });

  assert.equal(payload.prompt, 'red dragon in the sky');
  assert.equal(payload.fallback, true);
  assert.equal(payload.fallbackReason, 'invalid json');
});

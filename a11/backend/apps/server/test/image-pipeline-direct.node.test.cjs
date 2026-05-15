const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImageSdPayload,
  executeDirectImagePipeline,
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

test('executeDirectImagePipeline propagates image backend failures', async () => {
  const result = await executeDirectImagePipeline({
    userMessage: 'purple A11 symbol',
    generateSd: async () => ({
      ok: false,
      error: 'pollinations_image_failed',
      message: 'error code: 502',
    }),
    callStructuredLlmJson: async () => null,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.image_url, null);
  assert.equal(result.error, 'pollinations_image_failed');
  assert.equal(result.sdResult.error, 'pollinations_image_failed');
});

test('executeDirectImagePipeline refuses success without a public image URL', async () => {
  const result = await executeDirectImagePipeline({
    userMessage: 'purple A11 symbol',
    generateSd: async () => ({
      ok: true,
      output_path: '/tmp/generated.png',
    }),
    callStructuredLlmJson: async () => null,
    env: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.image_url, null);
  assert.equal(result.error, 'image_url_unavailable');
});

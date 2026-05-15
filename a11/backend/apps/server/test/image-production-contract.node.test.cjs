const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveHuggingFaceImageConfig,
} = require('../lib/hf-image.cjs');
const {
  toImageChatProxyPayload,
} = require('../src/mask/image-chat-runtime.cjs');

test('Hugging Face image config accepts the existing production token aliases', () => {
  const config = resolveHuggingFaceImageConfig({
    A11_ENABLE_HF_IMAGE: 'true',
    HF_API_KEY: 'hf_api_key_alias',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.token, 'hf_api_key_alias');

  const hubConfig = resolveHuggingFaceImageConfig({
    A11_ENABLE_HF_IMAGE: 'true',
    HUGGINGFACE_HUB_TOKEN: 'hf_hub_token_alias',
  });

  assert.equal(hubConfig.enabled, true);
  assert.equal(hubConfig.token, 'hf_hub_token_alias');
});

test('image chat payload does not claim success without an image URL', () => {
  const payload = toImageChatProxyPayload({
    sdResult: {
      ok: false,
      error: 'image_backend_unavailable',
      message: 'Aucun backend image disponible.',
      artifact_type: 'image',
    },
    mask: { intent: 'image.generate' },
    compiled: {},
    sdBody: {},
  });

  const content = String(payload.choices?.[0]?.message?.content || '');
  assert.equal(payload.ok, false);
  assert.equal(payload.image_url, null);
  assert.match(content, /Je n'ai pas pu générer l'image/i);
  assert.doesNotMatch(content, /C'est fait/i);
});

test('image chat payload treats missing URL as failure even when backend says ok', () => {
  const payload = toImageChatProxyPayload({
    sdResult: {
      ok: true,
      artifact_type: 'image',
      output_path: '/tmp/a11-image.png',
    },
    mask: { intent: 'image.generate' },
    compiled: {},
    sdBody: {},
  });

  const content = String(payload.choices?.[0]?.message?.content || '');
  assert.equal(payload.ok, false);
  assert.equal(payload.image_url, null);
  assert.doesNotMatch(content, /C'est fait/i);
});

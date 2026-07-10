const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveHuggingFaceImageConfig,
} = require('../lib/hf-image.cjs');
const {
  resolveReplicateImageConfig,
} = require('../lib/replicate-image.cjs');
const {
  resolvePollinationsImageConfig,
} = require('../lib/pollinations-image.cjs');
const {
  toImageChatProxyPayload,
} = require('../src/mask/image-chat-runtime.cjs');
const {
  attachMediaAgentRoles,
  buildMediaPipeline,
  getMediaAgentRoleMatrix,
} = require('../src/media/media-agent-roles.cjs');

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

test('Replicate image config accepts the existing production token aliases', () => {
  const config = resolveReplicateImageConfig({
    A11_ENABLE_REPLICATE_IMAGE: 'true',
    REPLICATE_API_TOKEN: 'r8_token_alias',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.token, 'r8_token_alias');
  assert.equal(config.model, 'black-forest-labs/flux-schnell');
});

test('Pollinations image config is explicit opt-in for emergency image fallback', () => {
  const disabled = resolvePollinationsImageConfig({});
  assert.equal(disabled.enabled, false);

  const enabled = resolvePollinationsImageConfig({
    A11_ENABLE_POLLINATIONS_IMAGE: 'true',
    A11_POLLINATIONS_IMAGE_MODEL: 'flux',
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.model, 'flux');
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

test('media agent roles put Djeff Cypher on prompts and Vivy on art direction', () => {
  const matrix = getMediaAgentRoleMatrix({});

  assert.equal(matrix.prompt.primary, 'djeff-cypher');
  assert.equal(matrix.art_direction.primary, 'vivy');
  assert.ok(matrix.prompt.helpers.includes('vivy'));
  assert.match(matrix.prompt.responsibility, /brief unique/i);
  assert.equal(matrix.audio.primary, 'vivy');
  assert.equal(matrix.image.primary, 'a11');
  assert.equal(matrix.audio_qa.primary, 'ekko');
  assert.equal(matrix.vision_qa.primary, 'pink-ward');
  assert.ok(matrix.image.fallbacks.includes('pollinations'));
  assert.ok(matrix.audio.fallbacks.includes('silent-track'));
});

test('video media pipeline includes prompt engineering then Vivy art direction', () => {
  const pipeline = buildMediaPipeline('video', { withAudio: true, env: {} });
  const stages = pipeline.map((entry) => entry.stage);

  assert.deepEqual(stages, ['prompt', 'art_direction', 'audio', 'image', 'video', 'audio_qa', 'vision_qa', 'client_handoff']);
  assert.equal(pipeline.find((entry) => entry.stage === 'prompt')?.primary, 'djeff-cypher');
  assert.equal(pipeline.find((entry) => entry.stage === 'art_direction')?.primary, 'vivy');
  assert.equal(pipeline.find((entry) => entry.stage === 'audio')?.primary, 'vivy');
  assert.equal(pipeline.find((entry) => entry.stage === 'image')?.primary, 'a11');
  assert.ok(pipeline.find((entry) => entry.stage === 'video')?.fallbacks.includes('mp4-cpu-ffmpeg'));
});

test('image payloads expose Funesterie media orchestration contract', () => {
  const payload = attachMediaAgentRoles({
    ok: true,
    url: 'https://files.funesterie.me/public/example.png',
  }, 'image', { env: {} });

  assert.equal(payload.orchestration.promptOwner, 'djeff-cypher');
  assert.equal(payload.orchestration.artDirectionOwner, 'vivy');
  assert.equal(payload.orchestration.imageOwner, 'a11');
  assert.equal(payload.mediaPipeline[0].stage, 'prompt');
  assert.equal(payload.mediaPipeline[1].stage, 'art_direction');
  assert.equal(payload.mediaPipeline[2].stage, 'image');
});

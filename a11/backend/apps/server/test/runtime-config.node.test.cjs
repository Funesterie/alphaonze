const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRuntimeConfig, getPublicRuntimeStatus } = require('../lib/runtime-config.cjs');

test('buildRuntimeConfig prefers explicit Qflush URL over Dragon URL', () => {
  const config = buildRuntimeConfig({
    DRAGON_API_URL: 'https://dragon.example.com',
    QFLUSH_URL: 'https://qflush.example.com',
    NODE_ENV: 'production',
  });

  assert.equal(config.qflush.remoteUrl, 'https://qflush.example.com');
  assert.equal(config.qflush.remoteSource, 'qflush');
  assert.equal(config.qflush.useDragonCompat, false);
});

test('buildRuntimeConfig normalizes Qflush status endpoints to the backend origin', () => {
  const config = buildRuntimeConfig({
    QFLUSH_REMOTE_URL: 'https://a11.funesterie.pro/api/qflush/status',
    NODE_ENV: 'production',
  });

  assert.equal(config.qflush.remoteUrl, 'https://a11.funesterie.pro');
  assert.equal(config.features.chat.qflushRemoteUrl, 'https://a11.funesterie.pro');
});

test('buildRuntimeConfig only falls back to Dragon when compatibility flag is enabled', () => {
  const disabledCompat = buildRuntimeConfig({
    DRAGON_API_URL: 'https://dragon.example.com',
    NODE_ENV: 'production',
  });
  assert.equal(disabledCompat.qflush.remoteUrl, '');
  assert.equal(disabledCompat.qflush.remoteSource, '');
  assert.equal(disabledCompat.qflush.useDragonCompat, false);

  const enabledCompat = buildRuntimeConfig({
    DRAGON_API_URL: 'https://dragon.example.com',
    A11_QFLUSH_USE_DRAGON: 'true',
    NODE_ENV: 'production',
  });
  assert.equal(enabledCompat.qflush.remoteUrl, 'https://dragon.example.com');
  assert.equal(enabledCompat.qflush.remoteSource, 'dragon-compat');
  assert.equal(enabledCompat.qflush.useDragonCompat, true);
});

test('buildRuntimeConfig disables qflush explicitly when A11_ENABLE_QFLUSH is false', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    A11_ENABLE_QFLUSH: 'false',
    QFLUSH_URL: 'https://dragon.example.com',
    QFLUSH_CHAT_FLOW: 'a11.chat.v1',
    OLLAMA_BASE: 'http://ollama.internal:11434',
  });

  assert.equal(config.qflush.remoteUrl, '');
  assert.equal(config.qflush.chatFlow, '');
  assert.equal(config.features.chat.provider, 'ollama');
  assert.equal(config.features.chat.qflushRemoteUrl, '');
});

test('buildRuntimeConfig accepts launcher-style A11 Qflush flow aliases', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'development',
    A11_ENABLE_QFLUSH: '1',
    A11_LOCAL_MODE: '1',
    A11_QFLUSH_CHAT_FLOW: 'a11.chat.v1',
    A11_QFLUSH_MEMORY_SUMMARY_FLOW: 'a11.memory.summary.v1',
  });

  assert.equal(config.qflush.chatFlow, 'a11.chat.v1');
  assert.equal(config.qflush.memorySummaryFlow, 'a11.memory.summary.v1');
  assert.equal(config.features.memory.provider, 'local');
});

test('buildRuntimeConfig uses the local Qflush chat flow default when only Qflush is enabled', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'development',
    A11_ENABLE_QFLUSH: 'true',
    A11_LOCAL_MODE: '1',
  });

  assert.equal(config.qflush.chatFlow, 'a11.chat.v1');
});

test('buildRuntimeConfig exposes production-safe feature providers', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    QFLUSH_URL: 'https://dragon.example.com',
    OLLAMA_BASE: 'http://ollama.internal:11434',
    TTS_PUBLIC_BASE_URL: 'https://tts.example.com',
    A11_SD_PROXY_URL: 'https://sd.example.com',
  });

  assert.equal(config.features.chat.provider, 'qflush');
  assert.equal(config.features.chat.llmProvider, 'ollama');
  assert.equal(config.features.semantic.provider, 'local-llm');
  assert.equal(config.features.memory.provider, 'local');
  assert.equal(config.features.sd.provider, 'proxy');
  assert.equal(config.features.sd.mode, 'proxy-only');
  assert.equal(config.features.sd.expectedRoute, '/api/tools/generate_sd');
  assert.equal(config.features.sd.localFallbackEnabled, false);
  assert.equal(config.features.tts.provider, 'http');
});

test('buildRuntimeConfig keeps OpenAI image fallback disabled unless explicitly enabled', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    OPENAI_API_KEY: 'sk-test',
    A11_SD_ALLOW_OPENAI_FALLBACK: 'true',
  });

  assert.equal(config.features.sd.openAiFallbackEnabled, false);
});

test('buildRuntimeConfig keeps production SD proxy-only even if ENABLE_SD is set', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    ENABLE_SD: 'true',
    A11_SD_PROXY_URL: 'https://sd.example.com',
  });

  assert.equal(config.features.sd.provider, 'proxy');
  assert.equal(config.features.sd.mode, 'proxy-only');
  assert.equal(config.features.sd.localFallbackEnabled, false);
});

test('buildRuntimeConfig allows explicit SD local fallback override in production when requested', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    A11_SD_PROXY_URL: 'https://sd.example.com',
    A11_SD_ALLOW_LOCAL_FALLBACK: 'true',
  });

  assert.equal(config.features.sd.provider, 'proxy');
  assert.equal(config.features.sd.mode, 'proxy+local-fallback');
  assert.equal(config.features.sd.localFallbackEnabled, true);
});

test('buildRuntimeConfig never treats A11_VISION_BASE_URL as the SD proxy source of truth', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    A11_VISION_BASE_URL: 'https://vision.example.com',
  });

  assert.equal(config.features.sd.provider, 'unconfigured');
  assert.equal(config.features.sd.proxyUrl, '');
});

test('getPublicRuntimeStatus publishes feature runtime details', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    QFLUSH_URL: 'https://dragon.example.com',
    A11_TRANSLATION_API_KEY: 'sk-test',
    A11_SD_PROXY_URL: 'https://sd.example.com',
  });

  const status = getPublicRuntimeStatus({
    config,
    hasDb: true,
    hasQflush: true,
    isR2Configured: false,
    hasResend: false,
  });

  assert.equal(status.features.chat.provider, 'qflush');
  assert.equal(status.features.semantic.llmEnrichmentEnabled, true);
  assert.equal(status.features.sd.proxyUrl, 'https://sd.example.com');
  assert.equal(status.features.sd.mode, 'proxy-only');
  assert.equal(status.features.sd.expectedRoute, '/api/tools/generate_sd');
  assert.equal(status.features.memory.provider, 'local');
});

test('buildRuntimeConfig marks semantic enrichment as llm-router when Cerbere is configured', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    LLM_ROUTER_URL: 'https://cerbere.funesterie.me',
    A11_WAZAA_LLM_ENRICH: 'true',
  });

  assert.equal(config.features.semantic.provider, 'llm-router');
  assert.equal(config.features.semantic.llmEnrichmentEnabled, true);
  assert.equal(config.features.semantic.translationConfigured, true);
});

test('buildRuntimeConfig reports local-llm semantic enrichment when Ollama is the direct structured backend', () => {
  const config = buildRuntimeConfig({
    NODE_ENV: 'production',
    OLLAMA_BASE: 'http://127.0.0.1:11434',
    A11_WAZAA_LLM_ENRICH: 'true',
  });

  assert.equal(config.features.semantic.provider, 'local-llm');
  assert.equal(config.features.semantic.llmEnrichmentEnabled, true);
  assert.equal(config.features.semantic.translationConfigured, true);
});

test('buildRuntimeConfig exposes the canonical raw or smart image pipeline mode', () => {
  const rawConfig = buildRuntimeConfig({
    A11_IMAGE_PIPELINE_MODE: 'creative',
  });
  const smartConfig = buildRuntimeConfig({
    A11_IMAGE_PIPELINE_MODE: 'smart',
  });

  assert.equal(rawConfig.features.image.pipelineMode, 'raw');
  assert.equal(smartConfig.features.image.pipelineMode, 'smart');

  const status = getPublicRuntimeStatus({
    config: smartConfig,
    hasDb: false,
    hasQflush: false,
    isR2Configured: false,
    hasResend: false,
  });
  assert.equal(status.features.image.pipelineMode, 'smart');
});

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
  assert.equal(config.features.semantic.provider, 'heuristic');
  assert.equal(config.features.memory.provider, 'local');
  assert.equal(config.features.sd.provider, 'proxy');
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
  assert.equal(status.features.memory.provider, 'local');
});

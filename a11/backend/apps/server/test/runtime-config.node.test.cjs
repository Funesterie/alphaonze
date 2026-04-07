const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRuntimeConfig } = require('../lib/runtime-config.cjs');

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

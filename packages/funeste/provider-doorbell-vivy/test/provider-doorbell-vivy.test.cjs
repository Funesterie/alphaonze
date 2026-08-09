'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightVivyBundles } = require('../src/index.cjs');

test('keeps provider when authenticated probe is unavailable', async () => {
  const bundles = [{ provider: 'ollama_cloud', baseURL: 'https://example.invalid', model: 'm', client: {} }];
  const result = await preflightVivyBundles(bundles, { timeoutMs: 100 });
  assert.equal(result.bundles.length, 1);
  assert.equal(result.report.results[0].state, 'unknown');
});

test('uses authenticated models client without exposing credentials', async () => {
  const bundles = [{
    provider: 'openai',
    baseURL: 'https://example.invalid/v1',
    model: 'm',
    client: { models: { list: async () => ({ data: [] }) } },
  }];
  const result = await preflightVivyBundles(bundles, { timeoutMs: 100 });
  assert.equal(result.report.results[0].state, 'available');
  assert.equal(Object.hasOwn(result.report.results[0], 'apiKey'), false);
});

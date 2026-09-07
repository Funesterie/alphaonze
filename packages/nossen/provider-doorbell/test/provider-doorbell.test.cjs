'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterProvidersByDoorbell,
  ringProviders,
} = require('../src/index.cjs');

test('rings all providers in parallel and preserves unknown providers', async () => {
  const started = Date.now();
  const providers = [
    {
      id: 'ready',
      probe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { state: 'available', reason: 'ready' };
      },
    },
    {
      id: 'timeout-ish',
      probe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { state: 'unknown', reason: 'probe_timeout' };
      },
    },
    {
      id: 'denied',
      probe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { state: 'unavailable', reason: 'http_429', status: 429 };
      },
    },
  ];

  const report = await ringProviders(providers, { timeoutMs: 100 });
  const elapsed = Date.now() - started;
  assert.equal(report.results.length, 3);
  assert.equal(report.available.length, 1);
  assert.equal(report.unknown.length, 1);
  assert.equal(report.unavailable.length, 1);
  assert.ok(elapsed < 100, `expected parallel probes, elapsed=${elapsed}ms`);

  const filtered = filterProvidersByDoorbell(providers, report);
  assert.deepEqual(filtered.map((item) => item.id), ['ready', 'timeout-ish']);
});

test('probe errors fail open', async () => {
  const providers = [{ id: 'flaky', probe: async () => { throw new Error('network'); } }];
  const report = await ringProviders(providers);
  assert.equal(report.unknown.length, 1);
  assert.equal(filterProvidersByDoorbell(providers, report).length, 1);
});

test('definite unavailable provider is filtered', () => {
  const providers = [
    { id: 'a', provider: 'cloud', baseURL: 'https://a.example/v1', model: 'm' },
    { id: 'b', provider: 'cloud', baseURL: 'https://b.example/v1', model: 'm' },
  ];
  const report = {
    unavailable: [{ id: 'a', provider: 'cloud', baseURL: 'https://a.example/v1', model: 'm' }],
  };
  const filtered = filterProvidersByDoorbell(providers, report);
  assert.deepEqual(filtered.map((item) => item.id), ['b']);
});

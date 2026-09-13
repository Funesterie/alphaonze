'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBudgetedTitler, main, runPublicationBatch } = require('../scripts/publish-soundcloud-new.cjs');
const { titleFromLyrics } = require('../src/music/jukebox-claude-titler.cjs');

function newStats() {
  return { state: 'running', limit: 1, publies: 0, ignores: 0, echecs: 0, titrages: 0,
    coutTitrageUsd: 0, coutTitrageReserveUsd: 0, raisons: {}, publications: [], erreurs: [] };
}

test('le préflight OAuth refuse avant titrage, verrou ou publication', async () => {
  const originalArgv = process.argv, originalFetch = globalThis.fetch;
  const envNames = ['SOUNDCLOUD_AUTO_PUBLISH_ENABLED', 'SOUNDCLOUD_ACCESS_TOKEN', 'SOCIAL_SOUNDCLOUD_ACCESS_TOKEN'];
  const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const calls = [];
  try {
    process.argv = ['node', 'runner', '--apply'];
    process.env.SOUNDCLOUD_AUTO_PUBLISH_ENABLED = 'true';
    process.env.SOUNDCLOUD_ACCESS_TOKEN = 'test';
    delete process.env.SOCIAL_SOUNDCLOUD_ACCESS_TOKEN;
    globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }; };
    await assert.rejects(main(), (error) => error.status === 401);
    assert.deepEqual(calls, ['https://api.soundcloud.com/me']);
  } finally {
    process.argv = originalArgv;
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      if (oldEnv[name] === undefined) delete process.env[name];
      else process.env[name] = oldEnv[name];
    }
  }
});

test('401 et 403 interrompent le lot avant tout autre morceau', async () => {
  for (const status of [401, 403]) {
    const stats = newStats();
    let calls = 0;
    await runPublicationBatch({ tracks: [{ id: 'one' }, { id: 'two' }], stats, save() {}, publish: async () => {
      calls++;
      throw Object.assign(new Error('upstream denied'), { status });
    } });
    assert.equal(calls, 1);
    assert.equal(stats.state, 'authentication_required');
    assert.equal(stats.erreurs[0].error, 'oauth_reconnect_required');
  }
});

test('le lot conserve la limite de publications et les refus explicites', async () => {
  const stats = newStats();
  let calls = 0;
  await runPublicationBatch({ tracks: [{ id: 1 }, { id: 2 }, { id: 3 }], stats, save() {}, publish: async () => {
    calls++;
    return calls === 1 ? { published: false, reason: 'deja_publie' }
      : { published: true, fingerprint: 'a'.repeat(64), upload: { title: 'Le Cadre', id: 12 } };
  } });
  assert.equal(calls, 2);
  assert.equal(stats.publies, 1);
  assert.equal(stats.raisons.deja_publie, 1);
  assert.equal(stats.state, 'limite_atteinte');
});

test('registre invalide et budget atteint arrêtent le lot', async () => {
  for (const [message, expected] of [['soundcloud_registry_invalid', 'review_required'], ['budget_titrage_atteint', 'budget_atteint']]) {
    const stats = newStats();
    let calls = 0;
    await runPublicationBatch({ tracks: [{ id: 1 }, { id: 2 }], stats, save() {}, publish: async () => { calls++; throw Error(message); } });
    assert.equal(calls, 1);
    assert.equal(stats.state, expected);
  }
});

test('le budget réserve avant requête et régularise uniquement une réponse valide', async () => {
  const stats = newStats();
  const snapshots = [];
  const title = createBudgetedTitler({ apiKey: 'test', budgetUsd: 0.01, stats,
    save() { snapshots.push({ spent: stats.coutTitrageUsd, reserved: stats.coutTitrageReserveUsd }); },
    titleImpl: async ({ reserveCost, maxCostUsd }) => {
      assert.equal(maxCostUsd, 0.01);
      reserveCost(0.008);
      assert.equal(stats.coutTitrageReserveUsd, 0.008);
      return { title: 'Le Cadre', costUsd: 0.003 };
    },
  });
  await title({ lyrics: 'paroles' });
  assert.equal(stats.coutTitrageUsd, 0.003);
  assert.equal(stats.coutTitrageReserveUsd, 0);
  assert.deepEqual(snapshots[0], { spent: 0, reserved: 0.008 });
});

test('réponse ambiguë ou invalide garde la réserve sans permettre un dépassement', async () => {
  const stats = newStats();
  let paidCalls = 0;
  const title = createBudgetedTitler({ apiKey: 'test', budgetUsd: 0.01, stats, save() {},
    titleImpl: async ({ reserveCost }) => { reserveCost(0.008); paidCalls++; throw Error('invalid_provider_json'); },
  });
  await assert.rejects(title({ lyrics: 'paroles' }), /invalid_provider_json/);
  assert.equal(stats.coutTitrageReserveUsd, 0.008);
  await assert.rejects(title({ lyrics: 'autres paroles' }), /budget_titrage_atteint/);
  assert.equal(paidCalls, 1);
});

test('une réservation qui ne peut être journalisée empêche la requête payante', async () => {
  const stats = newStats();
  let paidCalls = 0;
  const title = createBudgetedTitler({ apiKey: 'test', budgetUsd: 0.01, stats,
    save() { throw Error('disk unavailable'); },
    titleImpl: async ({ reserveCost }) => { reserveCost(0.008); paidCalls++; return { costUsd: 0.002 }; },
  });
  await assert.rejects(title({ lyrics: 'paroles' }), /disk unavailable/);
  assert.equal(paidCalls, 0);
});

test('le titreur compte et borne avant Messages sans appeler le fournisseur au budget insuffisant', async () => {
  const calls = [];
  await assert.rejects(titleFromLyrics({ lyrics: 'Des paroles', apiKey: 'test', maxCostUsd: 0.0001,
    fetchFn: async (url) => { calls.push(url); return { ok: true, json: async () => ({ input_tokens: 200 }) }; },
  }), /budget_titrage_atteint/);
  assert.deepEqual(calls, ['https://api.anthropic.com/v1/messages/count_tokens']);
});

test('le titreur réserve avant Messages, conserve les paroles et rend son usage', async () => {
  const order = [];
  let reserved = 0;
  const result = await titleFromLyrics({ lyrics: 'Des paroles', apiKey: 'test', maxCostUsd: 0.1,
    reserveCost: (amount) => { reserved = amount; order.push('reserve'); },
    fetchFn: async (url, options) => {
      if (url.endsWith('/count_tokens')) { order.push('count'); return { ok: true, json: async () => ({ input_tokens: 200 }) }; }
      order.push('paid');
      assert.ok(reserved > 0);
      assert.equal(JSON.parse(options.body).max_tokens, 200);
      return { ok: true, json: async () => ({ id: 'request', usage: { input_tokens: 200, output_tokens: 10 }, content: [{ type: 'text', text: '[{"id":0,"title":"La Nuit claire"}]' }] }) };
    },
  });
  assert.deepEqual(order, ['count', 'reserve', 'paid']);
  assert.equal(result.title, 'La Nuit claire');
  assert.ok(result.costUsd < reserved);
});

test('comptage manquant ou prix de modèle inconnu bloquent avant Messages', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(titleFromLyrics({ lyrics: 'paroles', apiKey: 'test', maxCostUsd: 0.1, fetchFn }), /provider_token_count_missing/);
  assert.equal(calls, 1);
  await assert.rejects(titleFromLyrics({ lyrics: 'paroles', apiKey: 'test', maxCostUsd: 0.1, model: 'unpriced-model', fetchFn }), /titrage_model_price_unknown/);
  assert.equal(calls, 1);
});

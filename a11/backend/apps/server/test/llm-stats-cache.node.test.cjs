'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.resolve(__dirname, '..', 'server.cjs');
const routePrefix = "app.get('/api/llm/stats', async (req, res) => {";

const DEFAULT_TEST_ENV = { LLM_ROUTER_URL: 'http://router.test', PORT: '3000' };

function loadLlmStatsHandler(fetchImpl, env = DEFAULT_TEST_ENV) {
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const routeStart = serverSource.indexOf(routePrefix);
  const routeEnd = serverSource.indexOf("\n});", routeStart);

  assert.notEqual(routeStart, -1, 'the LLM stats route should exist');
  assert.notEqual(routeEnd, -1, 'the LLM stats route should have an explicit end');
  const routeBody = serverSource.slice(routeStart + routePrefix.length, routeEnd);

  const createHandler = new Function(
    'fetch',
    'saveMemo',
    'sanitizeConfiguredLocalUpstream',
    'DEFAULT_UPSTREAM',
    'process',
    'console',
    [
      '"use strict";',
      'let __stats_cache = null;',
      'let __stats_cache_ts = 0;',
      'const STATS_CACHE_MS = 5000;',
      'let __last_probe_log = 0;',
      'return async function llmStatsHandler(req, res) {',
      routeBody,
      '};',
    ].join('\n'),
  );

  return createHandler(
    fetchImpl,
    () => {},
    (value) => value,
    'http://router.test',
    { env },
    {
      log() {},
      warn() {},
      error() {},
    },
  );
}

function createResponseRecorder() {
  const state = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(statusCode) {
      state.statusCode = statusCode;
      return res;
    },
    json(body) {
      state.body = body;
      return res;
    },
  };
  return { res, state };
}

test('LLM stats upstream failures preserve their status on consecutive requests', async () => {
  let fetchCalls = 0;
  const handler = loadLlmStatsHandler(async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 503,
      async text() {
        return '{"error":"router_down"}';
      },
    };
  });

  const first = createResponseRecorder();
  const second = createResponseRecorder();
  await handler({}, first.res);
  await handler({}, second.res);

  assert.equal(first.state.statusCode, 503);
  assert.equal(second.state.statusCode, 503);
  assert.equal(first.state.body.error, 'upstream_error');
  assert.equal(second.state.body.error, 'upstream_error');
  assert.equal(fetchCalls, 2, 'each failure should probe upstream instead of hitting cache');
});

test('LLM stats successful snapshots remain cached', async () => {
  let fetchCalls = 0;
  const stats = { ok: true, service: 'cerbere-router' };
  const handler = loadLlmStatsHandler(async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async json() {
        return stats;
      },
    };
  });

  const first = createResponseRecorder();
  const second = createResponseRecorder();
  await handler({}, first.res);
  await handler({}, second.res);

  assert.equal(first.state.statusCode, 200);
  assert.equal(second.state.statusCode, 200);
  assert.deepEqual(first.state.body, stats);
  assert.deepEqual(second.state.body, stats);
  assert.equal(fetchCalls, 1, 'successful stats should still use the short-lived cache');
});

// Regression 2026-08-01: sans LLM_ROUTER_URL, la sonde partait sur DEFAULT_UPSTREAM,
// qui vaut Ollama (:11434). Ollama est ecrit en Go et repond "404 page not found" sur
// un chemin inconnu -> /api/llm/stats renvoyait {"error":"upstream_error"} en prod.
// Le routeur Cerbere est embarque dans ce process et sert /api/stats en local.
test('LLM stats probes the local embedded router when no external router is configured', async () => {
  const probed = [];
  const handler = loadLlmStatsHandler(
    async (url) => {
      probed.push(String(url));
      return { ok: true, async json() { return { ok: true, service: 'cerbere-router' }; } };
    },
    { PORT: '3000' },
  );

  const recorder = createResponseRecorder();
  await handler({}, recorder.res);

  assert.equal(probed.length, 1);
  assert.equal(
    probed[0],
    'http://127.0.0.1:3000/api/stats',
    'stats must target the local embedded router, never the chat upstream',
  );
  assert.doesNotMatch(probed[0], /11434/, 'Ollama is the chat upstream and exposes no /api/stats');
  assert.equal(recorder.state.statusCode, 200);
});

test('LLM stats still prefers an explicitly configured external router', async () => {
  const probed = [];
  const handler = loadLlmStatsHandler(
    async (url) => {
      probed.push(String(url));
      return { ok: true, async json() { return { ok: true }; } };
    },
    { LLM_ROUTER_URL: 'http://router.test', PORT: '3000' },
  );

  await handler({}, createResponseRecorder().res);

  assert.equal(
    probed[0],
    'http://router.test/api/stats',
    'an explicit LLM_ROUTER_URL must keep priority over the local fallback',
  );
});

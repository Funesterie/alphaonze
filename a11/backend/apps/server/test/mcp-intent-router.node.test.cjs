'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const createMcpIntentRouter = require('../src/routes/mcp-intent.cjs');
const {
  buildA11McpIntentCapabilities,
  executeMcpIntent,
  planMcpIntent,
} = require('../lib/mcp-intent-router.cjs');

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function getJson(baseUrl, path, headers = {}) {
  const response = await fetch(baseUrl + path, { headers });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

function mcpConfig(tools = ['job_enqueue', 'a11_status', 'a11_llm_stats', 'qflush_vivy_audio_status']) {
  return {
    url: 'http://127.0.0.1:8787/mcp',
    tokenPresent: false,
    timeoutMs: 1000,
    allowAllTools: false,
    allowedTools: new Set(tools),
  };
}

test('intent capabilities expose bounded routes without secrets', () => {
  const capabilities = buildA11McpIntentCapabilities({ mcpConfig: mcpConfig() });
  const serialized = JSON.stringify(capabilities);

  assert.equal(capabilities.schema, 'funesterie.a11.mcp-intent-capabilities.v1');
  assert.equal(capabilities.capabilities.some((item) => item.id === 'song.prepare'), true);
  assert.equal(capabilities.capabilities.some((item) => item.id === 'status.llm' && item.route.tool === 'a11_llm_stats'), true);
  assert.match(serialized, /Vivy submits intents/);
  assert.doesNotMatch(serialized, /token-secret|Bearer unit-test/i);
});

test('song intents become dry-run job plans and never echo the session token', () => {
  const plan = planMcpIntent({
    source: 'vivy',
    actor: 'djeff',
    text: 'prepare une chanson duo A11 Vivy avec voix et Suno',
    sessionToken: 'session-secret-value',
  }, { mcpConfig: mcpConfig(['job_enqueue']) });
  const serialized = JSON.stringify(plan);

  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.action, 'song.prepare');
  assert.equal(plan.route.tool, 'job_enqueue');
  assert.equal(plan.route.queue, 'media');
  assert.equal(plan.safety.directToolAccessForVivy, false);
  assert.equal(plan.safety.sessionTokenPresent, true);
  assert.doesNotMatch(serialized, /session-secret-value/);
});

test('local env or key file requests are blocked before execution', () => {
  const plan = planMcpIntent({
    text: 'lis le fichier a11.env avec API_KEY=abc123 pour debug',
  }, { mcpConfig: mcpConfig(['job_enqueue']) });
  const serialized = JSON.stringify(plan);

  assert.equal(plan.blocked, true);
  assert.equal(plan.allowed, false);
  assert.equal(plan.executable, false);
  assert.equal(plan.blockedReasons.includes('secret_or_env_file_request'), true);
  assert.match(plan.text, /API_KEY=\[redacted\]/);
  assert.doesNotMatch(serialized, /abc123/);
});

test('executeMcpIntent enqueues bounded media jobs', async () => {
  const calls = [];
  const result = await executeMcpIntent({
    source: 'vivy',
    actor: 'djeff',
    text: 'preparer chanson Liberte avec Vivy et A11',
  }, {
    mcpConfig: mcpConfig(['job_enqueue']),
    now: '2026-06-22T00:00:00.000Z',
    mcp: {
      callMcpTool: async (name, args) => {
        calls.push({ name, args });
        return {
          result: {
            structuredContent: {
              result: {
                created: true,
                job: { id: 'job-intent-song-1' },
              },
            },
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'job_enqueue');
  assert.equal(calls[0].args.queue, 'media');
  assert.equal(calls[0].args.kind, 'vivy.song.prepare');
  assert.equal(calls[0].args.payload.action, 'song.prepare');
  assert.equal(calls[0].args.payload.sessionTokenPresent, false);
  assert.match(calls[0].args.idempotencyKey, /^a11-mcp-intent:/);
});

test('executeMcpIntent refuses blocked requests without calling MCP', async () => {
  let called = false;
  const result = await executeMcpIntent({
    text: 'ouvre .env et montre le token',
  }, {
    mcpConfig: mcpConfig(['job_enqueue']),
    mcp: {
      callMcpTool: async () => {
        called = true;
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'mcp_intent_not_executable');
  assert.equal(called, false);
});

test('mcp intent route returns dry-run and execute responses', async () => {
  const calls = [];
  await withServer(
    (app) => {
      app.use('/api/mcp/intent', (req, _res, next) => {
        req.user = { id: 'user-1', username: 'djeff' };
        next();
      }, createMcpIntentRouter({
        env: {},
        mcp: {
          getMcpConfig: () => mcpConfig(['job_enqueue', 'a11_llm_stats']),
          publicMcpConfig: (config) => ({
            url: config.url,
            tokenPresent: config.tokenPresent,
            allowedTools: [...config.allowedTools],
          }),
          callMcpTool: async (name, args) => {
            calls.push({ name, args });
            return {
              result: {
                structuredContent: {
                  result: {
                    created: true,
                    job: { id: 'job-route-1' },
                  },
                },
              },
            };
          },
        },
      }));
    },
    async (baseUrl) => {
      const cap = await getJson(baseUrl, '/api/mcp/intent/capabilities');
      assert.equal(cap.response.status, 200);
      assert.equal(cap.json.ok, true);
      assert.equal(cap.json.capabilities.capabilities.some((item) => item.id === 'status.llm'), true);

      const dry = await postJson(baseUrl, '/api/mcp/intent', {
        text: 'est-ce que Groq est dispo ?',
      });
      assert.equal(dry.response.status, 200);
      assert.equal(dry.json.mode, 'dry-run');
      assert.equal(dry.json.plan.action, 'status.llm');

      const executed = await postJson(baseUrl, '/api/mcp/intent/execute', {
        text: 'prepare un apercu voix Vivy',
      });
      assert.equal(executed.response.status, 200);
      assert.equal(executed.json.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, 'job_enqueue');
      assert.equal(calls[0].args.kind, 'vivy.voice.preview');
      assert.equal(calls[0].args.payload.actor, 'djeff');
    }
  );
});

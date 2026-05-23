'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const createMcpCockpitRouter = require('../src/routes/mcp-cockpit.cjs');

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
      'content-type': 'application/json',
      accept: 'application/json',
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

async function withRawServer(handler, runAssertions) {
  const server = http.createServer(handler);
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

function createVerifyJwtForTests() {
  return (req, res, next) => {
    const email = String(req.headers['x-test-email'] || '').trim();
    if (!email) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }
    req.user = {
      id: email,
      username: email.split('@')[0],
      email,
      provider: 'test',
    };
    return next();
  };
}

function textResult(value) {
  return {
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify(value),
        },
      ],
    },
  };
}

function createCallToolStub() {
  return async (name) => {
    if (name === 'a11_status') return textResult({ status: { ok: true } });
    if (name === 'kaen44_status') return textResult({ status: { ok: true } });
    if (name === 'agent_presence') {
      return textResult({
        presence: {
          activeCount: 2,
          totalCount: 3,
          agents: [
            { id: 'a11', name: 'A11', active: true },
            { id: 'kaen44', name: 'Kaen44', active: true },
            { id: 'neo4j-secret-port', name: 'Neo4j token tunnel', active: true },
          ],
        },
      });
    }
    if (name === 'agent_jobs') return textResult({ jobs: { jobs: [{ status: 'running' }, { status: 'ready' }] } });
    if (name === 'romstation_state') return textResult({ state: { available: true, phase: 'ready' } });
    if (name === 'qflush_gamepad_status') return textResult({ status: { ok: true, recent: [{ at: 1 }] } });
    if (name === 'discussion_list') {
      return textResult({
        discussions: [
          {
            title: 'Opération BB',
            pitching: {
              ready: true,
              requiredAnswered: 2,
              requiredTotal: 2,
            },
          },
        ],
      });
    }
    return textResult({});
  };
}

test('private MCP cockpit rejects anonymous requests', async () => {
  await withServer((app) => {
    app.use('/api/cockpit/mcp', createMcpCockpitRouter({
      verifyJWT: createVerifyJwtForTests(),
      callTool: createCallToolStub(),
      env: { NODE_ENV: 'production' },
    }));
  }, async (baseUrl) => {
    const { response, json } = await getJson(baseUrl, '/api/cockpit/mcp/status');
    assert.equal(response.status, 401);
    assert.equal(json.ok, false);
  });
});

test('private MCP cockpit rejects non-admin accounts', async () => {
  await withServer((app) => {
    app.use('/api/cockpit/mcp', createMcpCockpitRouter({
      verifyJWT: createVerifyJwtForTests(),
      callTool: createCallToolStub(),
      env: { NODE_ENV: 'production' },
    }));
  }, async (baseUrl) => {
    const { response, json } = await getJson(baseUrl, '/api/cockpit/mcp/status', {
      'x-test-email': 'viewer@example.com',
    });
    assert.equal(response.status, 403);
    assert.equal(json.error, 'admin_required');
  });
});

test('private MCP cockpit summarizes MCP state for allowed admin accounts without secret-like agent names', async () => {
  await withServer((app) => {
    app.use('/api/cockpit/mcp', createMcpCockpitRouter({
      verifyJWT: createVerifyJwtForTests(),
      callTool: createCallToolStub(),
      env: { NODE_ENV: 'production' },
    }));
  }, async (baseUrl) => {
    const { response, json } = await getJson(baseUrl, '/api/cockpit/mcp/status', {
      'x-test-email': 'funesterie38@gmail.com',
    });
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.a11.ok, true);
    assert.equal(json.kaen44.ok, true);
    assert.equal(json.agents.active, 2);
    assert.deepEqual(json.agents.names, ['A11', 'Kaen44', 'Agent 3']);
    assert.equal(json.jobs.running, 1);
    assert.equal(json.jobs.ready, 1);
    assert.equal(json.game.ready, true);
    assert.equal(json.controller.ready, true);
    assert.equal(json.pitching.ready, 1);
  });
});

test('hosted MCP cockpit serves the console page with same-origin A11 proxy config', async () => {
  const tokenKey = ['A11', 'MCP', 'TOKEN'].join('_');
  const fakeToken = 'unit-test-token-12345';

  await withServer((app) => {
    app.use('/cockpit/mcp', createMcpCockpitRouter({
      verifyJWT: createVerifyJwtForTests(),
      callTool: createCallToolStub(),
      env: {
        NODE_ENV: 'production',
        A11_MCP_URL: 'https://mcp.example.test/mcp',
        [tokenKey]: fakeToken,
      },
    }));
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/cockpit/mcp`, {
      headers: { 'x-test-email': 'funesterie38@gmail.com' },
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(html, /__FUNESTERIE_MCP_COCKPIT__/);
    assert.match(html, /\/api\/cockpit\/mcp\/proxy/);
    assert.match(html, /a11-hosted/);
    assert.doesNotMatch(html, new RegExp(fakeToken));
  });
});

test('hosted MCP cockpit private proxy uses server-side bearer and redacts responses', async () => {
  const tokenKey = ['A11', 'MCP', 'TOKEN'].join('_');
  const fakeToken = 'unit-test-token-67890';
  let upstreamAuthorization = '';

  await withRawServer((req, res) => {
    upstreamAuthorization = String(req.headers.authorization || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 'proxy-test',
      result: {
        ok: true,
        authorization: upstreamAuthorization,
      },
    }));
  }, async (upstreamBaseUrl) => {
    await withServer((app) => {
      app.use('/api/cockpit/mcp', createMcpCockpitRouter({
        verifyJWT: createVerifyJwtForTests(),
        callTool: createCallToolStub(),
        env: {
          NODE_ENV: 'production',
          A11_MCP_URL: `${upstreamBaseUrl}/mcp`,
          [tokenKey]: fakeToken,
        },
      }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/cockpit/mcp/proxy', {
        endpoint: 'private',
        request: {
          jsonrpc: '2.0',
          id: 'tools-test',
          method: 'tools/list',
          params: {},
        },
      }, {
        'x-test-email': 'funesterie38@gmail.com',
      });

      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.match(upstreamAuthorization, /^Bearer /);
      assert.ok(upstreamAuthorization.includes(fakeToken));
      assert.equal(json.payload.result.authorization, '[REDACTED]');
      assert.doesNotMatch(JSON.stringify(json), new RegExp(fakeToken));
    });
  });
});

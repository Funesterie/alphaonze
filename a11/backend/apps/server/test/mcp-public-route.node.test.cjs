'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createPublicMcpRouter = require('../src/routes/mcp-public.cjs');

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withServer(callback) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/llm/stats', (_req, res) => res.json({
    service: 'cerbere-router',
    canonical: true,
    llm: { provider: 'ollama' },
  }));
  app.use(createPublicMcpRouter());

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const previous = {
    A11_MCP_INTERNAL_BASE_URL: process.env.A11_MCP_INTERNAL_BASE_URL,
    A11_MCP_PUBLIC_BASES: process.env.A11_MCP_PUBLIC_BASES,
  };
  process.env.A11_MCP_INTERNAL_BASE_URL = baseUrl;

  try {
    await callback({ baseUrl });
  } finally {
    restoreEnv(previous);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  return { status: response.status, data };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

test('public MCP manifest advertises A11 and K44 endpoints', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await getJson(`${baseUrl}/mcp`);

    assert.equal(response.status, 200);
    assert.equal(response.data.ok, true);
    assert.equal(response.data.kind, 'a11_public_mcp');
    assert.equal(response.data.canonicalDomains.a11, 'https://a11.funesterie.pro/mcp');
    assert.equal(response.data.canonicalDomains.kaen44, 'https://k44.funesterie.me/mcp');
    assert.equal(response.data.aliasNotes['k44.me'], 'domaine externe non route Funesterie; utiliser k44.funesterie.me');
  });
});

test('public MCP json-rpc initialize and tool list are available', async () => {
  await withServer(async ({ baseUrl }) => {
    const init = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    const list = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    assert.equal(init.status, 200);
    assert.equal(init.data.result.serverInfo.name, 'a11-public');
    assert.equal(list.status, 200);
    const names = list.data.result.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      'a11_chat',
      'a11_health',
      'a11_llm_stats',
      'a11_mcp_public_status',
    ].sort());
  });
});

test('public MCP safe tool call proxies health without exposing shell tools', async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await postJson(`${baseUrl}/mcp`, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'a11_health',
        arguments: {},
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.result.isError, false);
    assert.match(response.data.result.content[0].text, /"status": "ok"/);
  });
});

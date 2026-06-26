'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

const createMcpClientRouter = require('../src/routes/mcp-client.cjs');

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

function createMcpStub() {
  const config = {
    allowAllTools: false,
    allowedTools: new Set(['agent_presence']),
    tokenPresent: true,
    timeoutMs: 1000,
    url: 'https://mcp.example.test/mcp',
  };
  return {
    getMcpConfig: () => config,
    publicMcpConfig: () => ({ tokenPresent: true, url: config.url }),
    checkMcpHealth: async () => ({ ok: true, status: 200 }),
    listMcpTools: async () => ({
      result: {
        tools: [
          { name: 'agent_presence' },
          { name: 'dangerous_private_tool' },
        ],
      },
    }),
    callMcpTool: async (name, args) => ({
      result: {
        name,
        args,
        ok: true,
      },
    }),
  };
}

test('/api/mcp exposes account tier for authenticated basic users', async () => {
  await withServer((app) => {
    app.use('/api/mcp', createVerifyJwtForTests(), createMcpClientRouter({
      env: { NODE_ENV: 'production' },
      mcp: createMcpStub(),
    }));
  }, async (baseUrl) => {
    const { response, json } = await getJson(baseUrl, '/api/mcp/access', {
      'x-test-email': 'viewer@example.com',
    });
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.account.tier, 'basic');
    assert.equal(json.account.pricing.monthlyEur, 0);
    assert.equal(json.account.permissions.publicEndpoints, true);
    assert.equal(json.account.permissions.privateMcpCall, false);
    assert.equal(json.catalog.capabilities.some((capability) => capability.id === 'vivy-workbench'), false);
    assert.equal(json.catalog.capabilities.some((capability) => capability.id === 'vivy-notepad'), false);
    assert.equal(json.catalog.capabilities.some((capability) => capability.id === 'vivy-canvas'), false);
    assert.equal(json.catalog.capabilities.find((capability) => capability.id === 'chrome-context').allowed, false);
    assert.equal(json.catalog.connectors.find((connector) => connector.id === 'github').minimumTier, 'founder');
  });
});

test('/api/mcp status requires premium or admin family', async () => {
  await withServer((app) => {
    app.use('/api/mcp', createVerifyJwtForTests(), createMcpClientRouter({
      env: { NODE_ENV: 'production' },
      mcp: createMcpStub(),
    }));
  }, async (baseUrl) => {
    const { response, json } = await getJson(baseUrl, '/api/mcp/status', {
      'x-test-email': 'viewer@example.com',
    });
    assert.equal(response.status, 403);
    assert.equal(json.error, 'mcp_permission_required');
    assert.equal(json.required.minimumTier, 'premium');
  });
});

test('/api/mcp lets premium accounts read status and RomStation state but not private tools', async () => {
  await withServer((app) => {
    app.use('/api/mcp', createVerifyJwtForTests(), createMcpClientRouter({
      env: {
        NODE_ENV: 'production',
        A11_MCP_PREMIUM_EMAILS: 'premium@example.com',
      },
      mcp: createMcpStub(),
    }));
  }, async (baseUrl) => {
    const status = await getJson(baseUrl, '/api/mcp/status', {
      'x-test-email': 'premium@example.com',
    });
    assert.equal(status.response.status, 200);
    assert.equal(status.json.ok, true);
    assert.equal(status.json.account.tier, 'premium');
    assert.equal(status.json.account.permissions.romstationState, true);

    const access = await getJson(baseUrl, '/api/mcp/access', {
      'x-test-email': 'premium@example.com',
    });
    assert.equal(access.response.status, 200);
    assert.equal(access.json.catalog.capabilities.find((capability) => capability.id === 'chrome-context').allowed, true);
    assert.equal(access.json.catalog.capabilities.find((capability) => capability.id === 'mcp-premium-status').allowed, true);
    assert.equal(access.json.catalog.capabilities.find((capability) => capability.id === 'mcp-private-session').allowed, false);

    const romstation = await getJson(baseUrl, '/api/mcp/romstation/state', {
      'x-test-email': 'premium@example.com',
    });
    assert.equal(romstation.response.status, 200);
    assert.equal(romstation.json.result.name, 'romstation_state');

    const tools = await getJson(baseUrl, '/api/mcp/tools/list', {
      'x-test-email': 'premium@example.com',
    });
    assert.equal(tools.response.status, 403);
    assert.equal(tools.json.required.minimumTier, 'founder');
  });
});

test('/api/mcp lets founder accounts use private tools and local install manifest without destructive rights', async () => {
  await withServer((app) => {
    app.use('/api/mcp', createVerifyJwtForTests(), createMcpClientRouter({
      env: {
        NODE_ENV: 'production',
        A11_MCP_FOUNDER_EMAILS: 'founder@example.com',
      },
      mcp: createMcpStub(),
    }));
  }, async (baseUrl) => {
    const tools = await getJson(baseUrl, '/api/mcp/tools/list?allowedOnly=true', {
      'x-test-email': 'founder@example.com',
    });
    assert.equal(tools.response.status, 200);
    assert.equal(tools.json.account.tier, 'founder');
    assert.equal(tools.json.account.permissions.destructiveActions, false);
    assert.equal(tools.json.account.permissions.customAiProfile, true);
    assert.equal(tools.json.account.permissions.customAiProviderKeys, true);
    assert.equal(tools.json.account.permissions.customAiNeo4j, true);
    assert.equal(tools.json.account.permissions.customAiDocker, true);
    assert.deepEqual(tools.json.tools.map((tool) => tool.name), ['agent_presence']);

    const called = await postJson(baseUrl, '/api/mcp/tools/call', {
      name: 'agent_presence',
      arguments: { includeIdle: true },
    }, {
      'x-test-email': 'founder@example.com',
    });
    assert.equal(called.response.status, 200);
    assert.equal(called.json.account.tier, 'founder');

    const install = await getJson(baseUrl, '/api/mcp/local-install/manifest', {
      'x-test-email': 'founder@example.com',
    });
    assert.equal(install.response.status, 200);
    assert.equal(install.json.installer.destructive, false);
    assert.equal(install.json.installer.preservesExistingData, true);
  });
});

test('/api/mcp lets admin family accounts list and call private tools', async () => {
  await withServer((app) => {
    app.use('/api/mcp', createVerifyJwtForTests(), createMcpClientRouter({
      env: { NODE_ENV: 'production' },
      mcp: createMcpStub(),
    }));
  }, async (baseUrl) => {
    const tools = await getJson(baseUrl, '/api/mcp/tools/list?allowedOnly=true', {
      'x-test-email': 'cellaurojeffrey@gmail.com',
    });
    assert.equal(tools.response.status, 200);
    assert.equal(tools.json.account.tier, 'admin_family');
    assert.deepEqual(tools.json.tools.map((tool) => tool.name), ['agent_presence']);

    const called = await postJson(baseUrl, '/api/mcp/tools/call', {
      name: 'agent_presence',
      arguments: { includeIdle: true },
    }, {
      'x-test-email': 'cellaurojeffrey@gmail.com',
    });
    assert.equal(called.response.status, 200);
    assert.equal(called.json.tool, 'agent_presence');
    assert.equal(called.json.account.tier, 'admin_family');
  });
});

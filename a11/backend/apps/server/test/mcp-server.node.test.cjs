'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', '..');
const MCP_SERVER_PATH = path.join(SERVER_ROOT, 'tools', 'mcp', 'a11-mcp-server.cjs');
const KIRO_MCP_PATH = path.join(REPO_ROOT, '.kiro', 'settings', 'mcp.json');
const { createVault } = require(path.join(REPO_ROOT, 'scripts', 'rubixgate', 'rubixcube-vault.cjs'));

function callMcpOnce(message, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.A11_NEZ_TOKEN;
    delete env.NEZ_TOKENS;
    delete env.A11_MCP_TOKEN;
    delete env.A11_PUBLIC_MCP_TOKEN;
    delete env.MCP_AUTH_TOKEN;
    delete env.A11_MCP_TOKEN_FILE;
    delete env.MCP_AUTH_TOKEN_FILE;
    delete env.RUBIXCUBE_VAULT_PASSPHRASE;
    delete env.RUBIXCUBE_VAULT_DIR;

    const child = spawn(process.execPath, [MCP_SERVER_PATH], {
      cwd: SERVER_ROOT,
      env: {
        ...env,
        A11_BASE_URL: 'http://127.0.0.1:3000',
        A11_MCP_DISABLE_WINDOWS_USER_ENV: '1',
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MCP server exited ${code}: ${stderr}`));
        return;
      }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve(lines.map((line) => JSON.parse(line)));
    });

    child.stdin.end(`${JSON.stringify(message)}\n`);
  });
}

test('a11 MCP dimension status does not invent a default NEZ token', async () => {
  const [response] = await callMcpOnce({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'a11_mcp_dimension_status',
      arguments: {},
    },
  });

  assert.equal(response.id, 1);
  const text = response.result.content[0].text;
  const status = JSON.parse(text);
  assert.equal(status.ok, true);
  assert.equal(status.server.hasNezToken, false);
  assert.equal(typeof status.sharedMcp?.tokenPresent, 'boolean');
  assert.equal(text.includes('Bearer '), false);
  assert.equal(text.includes('Authorization'), false);
});

test('a11 MCP shared token can come from a local token file without leaking it', async () => {
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-mcp-token-'));
  const tokenPath = path.join(tokenDir, 'mcp-token-current.txt');
  const fakeToken = 'test-token-from-file-123';
  try {
    fs.writeFileSync(tokenPath, fakeToken, 'utf8');
    const [response] = await callMcpOnce({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'a11_mcp_dimension_status',
        arguments: {},
      },
    }, { MCP_AUTH_TOKEN_FILE: tokenPath });

    assert.equal(response.id, 11);
    const text = response.result.content[0].text;
    const status = JSON.parse(text);
    assert.equal(status.ok, true);
    assert.equal(status.sharedMcp?.tokenPresent, true);
    assert.equal(status.sharedMcp?.source, 'token-file');
    assert.equal(text.includes(fakeToken), false);
    assert.equal(text.includes('Authorization'), false);
  } finally {
    fs.rmSync(tokenDir, { recursive: true, force: true });
  }
});

test('a11 MCP RubixCube status and consume do not leak secret bundle values', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-mcp-rubixcube-'));
  const bundlePath = path.join(tmp, 'bundle.json');
  const passphrase = 'mcp demo passphrase long enough';
  const fakeSecret = 'demo-rubixcube-secret-value-not-real';
  try {
    fs.writeFileSync(bundlePath, JSON.stringify({
      schema: 'funesterie.demo-bundle.v1',
      items: [
        { name: 'mcp-private', kind: 'bearer', value: fakeSecret },
        { name: 'vigem-bridge', kind: 'bridge', value: 'demo-vigem-secret-not-real' },
      ],
    }, null, 2), 'utf8');

    const { manifestPath } = createVault({
      name: 'mcp-demo',
      inputPath: bundlePath,
      outDir: tmp,
      parts: 3,
      passphrase,
      createdAt: '2026-05-22T00:00:00.000Z',
    });

    const [statusResponse] = await callMcpOnce({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'a11_rubixcube_vault_status',
        arguments: { manifestPath },
      },
    });

    assert.equal(statusResponse.id, 12);
    const statusText = statusResponse.result.content[0].text;
    const status = JSON.parse(statusText);
    assert.equal(status.ok, true);
    assert.equal(status.secretExposure, 'none');
    assert.equal(status.shards.every((shard) => shard.exists && shard.hashOk), true);
    assert.equal(statusText.includes(fakeSecret), false);

    const [consumeResponse] = await callMcpOnce({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'a11_rubixcube_vault_consume',
        arguments: {
          manifestPath,
          itemName: 'mcp-private',
          purpose: 'unit test redacted consume',
          confirm: 'CONSUME_SECRET_BUNDLE',
        },
      },
    }, { RUBIXCUBE_VAULT_PASSPHRASE: passphrase });

    assert.equal(consumeResponse.id, 13);
    const consumeText = consumeResponse.result.content[0].text;
    const consume = JSON.parse(consumeText);
    assert.equal(consume.ok, true);
    assert.equal(consume.secretExposure, 'none');
    assert.equal(consume.bundle.secretValuesReturned, false);
    assert.equal(consume.policy.plaintextReturned, false);
    assert.equal(consume.itemRequested.found, true);
    assert.equal(consumeText.includes(fakeSecret), false);
    assert.equal(consumeText.includes('demo-vigem-secret-not-real'), false);
    assert.equal(consumeText.includes('Authorization'), false);

    const [missingConfirmResponse] = await callMcpOnce({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'a11_rubixcube_vault_consume',
        arguments: {
          manifestPath,
          purpose: 'unit test missing confirm',
        },
      },
    }, { RUBIXCUBE_VAULT_PASSPHRASE: passphrase });

    assert.equal(missingConfirmResponse.id, 14);
    assert.match(missingConfirmResponse.error?.message || '', /CONSUME_SECRET_BUNDLE/);
    assert.equal(JSON.stringify(missingConfirmResponse).includes(fakeSecret), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a11 MCP RubixCube shared MCP token check uses the token without returning it', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-mcp-rubixcube-token-check-'));
  const bundlePath = path.join(tmp, 'bundle.json');
  const passphrase = 'mcp token check passphrase long enough';
  const fakeToken = 'demo-shared-mcp-token-not-real-123456789';
  let sawBearer = false;
  let sawHeaderToken = false;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      sawBearer = req.headers.authorization === `Bearer ${fakeToken}`;
      sawHeaderToken = req.headers['x-mcp-token'] === fakeToken;
      const payload = JSON.parse(raw || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          tools: [
            { name: 'agent_inbox_check' },
            { name: 'discussion_post' },
          ],
        },
      }));
    });
  });

  try {
    fs.writeFileSync(bundlePath, JSON.stringify({
      schema: 'funesterie.demo-bundle.v1',
      items: [
        { name: 'shared-mcp', kind: 'bearer', value: fakeToken },
      ],
    }, null, 2), 'utf8');
    const { manifestPath } = createVault({
      name: 'mcp-token-check',
      inputPath: bundlePath,
      outDir: tmp,
      parts: 3,
      passphrase,
      createdAt: '2026-05-22T00:00:00.000Z',
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const [response] = await callMcpOnce({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'a11_rubixcube_shared_mcp_token_check',
        arguments: {
          manifestPath,
          itemName: 'shared-mcp',
          url: `http://127.0.0.1:${port}/mcp`,
          purpose: 'unit test shared mcp token check',
          confirm: 'CHECK_SHARED_MCP_TOKEN',
        },
      },
    }, { RUBIXCUBE_VAULT_PASSPHRASE: passphrase });

    assert.equal(response.id, 15);
    const text = response.result.content[0].text;
    const result = JSON.parse(text);
    assert.equal(result.ok, true);
    assert.equal(result.sharedMcp.authentication, 'accepted');
    assert.equal(result.toolCount, 2);
    assert.deepEqual(result.sampleTools, ['agent_inbox_check', 'discussion_post']);
    assert.equal(result.policy.tokenReturned, false);
    assert.equal(result.secretExposure, 'none');
    assert.equal(sawBearer, true);
    assert.equal(sawHeaderToken, true);
    assert.equal(text.includes(fakeToken), false);
    assert.equal(text.includes('Authorization'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a11 MCP tools expose explicit ChatGPT Apps annotations', async () => {
  const [response] = await callMcpOnce({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });

  assert.equal(response.id, 2);
  const tools = response.result.tools || [];
  assert.ok(tools.length > 0);
  for (const tool of tools) {
    assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`);
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', `${tool.name} openWorldHint`);
    assert.equal(typeof tool.annotations?.destructiveHint, 'boolean', `${tool.name} destructiveHint`);
  }
  const health = tools.find((tool) => tool.name === 'a11_health');
  const shell = tools.find((tool) => tool.name === 'a11_shell');
  const ecosystem = tools.find((tool) => tool.name === 'a11_ecosystem_scope');
  const ecosystemCorpus = tools.find((tool) => tool.name === 'a11_ecosystem_corpus');
  const ecosystemBriefing = tools.find((tool) => tool.name === 'a11_ecosystem_briefing');
  const chopperStatus = tools.find((tool) => tool.name === 'a11_chopper_status');
  const chopperPlan = tools.find((tool) => tool.name === 'a11_chopper_plan');
  const chopperRumble = tools.find((tool) => tool.name === 'a11_chopper_rumble');
  const chopperRecipes = tools.find((tool) => tool.name === 'a11_chopper_recipes');
  const chopperDoctor = tools.find((tool) => tool.name === 'a11_chopper_doctor');
  const mixerStatus = tools.find((tool) => tool.name === 'a11_funesterie_mixer_status');
  const mixerRoute = tools.find((tool) => tool.name === 'a11_funesterie_mixer_route');
  const workerStatus = tools.find((tool) => tool.name === 'a11_worker_status');
  const workerStart = tools.find((tool) => tool.name === 'a11_worker_start');
  const taskDispatch = tools.find((tool) => tool.name === 'a11_task_dispatch');
  const jobsStatus = tools.find((tool) => tool.name === 'a11_agent_jobs_status');
  const rubixStatus = tools.find((tool) => tool.name === 'a11_rubixcube_vault_status');
  const rubixConsume = tools.find((tool) => tool.name === 'a11_rubixcube_vault_consume');
  const rubixMcpCheck = tools.find((tool) => tool.name === 'a11_rubixcube_shared_mcp_token_check');
  const inbox = tools.find((tool) => tool.name === 'a11_kiro_inbox_check');
  const post = tools.find((tool) => tool.name === 'a11_kiro_discussion_post');
  assert.equal(health.annotations.readOnlyHint, true);
  assert.equal(shell.annotations.readOnlyHint, false);
  assert.equal(ecosystem.annotations.readOnlyHint, true);
  assert.equal(ecosystem.annotations.destructiveHint, false);
  assert.equal(ecosystemCorpus.annotations.readOnlyHint, true);
  assert.equal(ecosystemCorpus.annotations.destructiveHint, false);
  assert.equal(ecosystemBriefing.annotations.readOnlyHint, true);
  assert.equal(ecosystemBriefing.annotations.destructiveHint, false);
  assert.equal(chopperStatus.annotations.readOnlyHint, true);
  assert.equal(chopperStatus.annotations.destructiveHint, false);
  assert.equal(chopperPlan.annotations.readOnlyHint, true);
  assert.equal(chopperPlan.annotations.destructiveHint, false);
  assert.equal(chopperRumble.annotations.readOnlyHint, true);
  assert.equal(chopperRumble.annotations.destructiveHint, false);
  assert.equal(chopperRecipes.annotations.readOnlyHint, true);
  assert.equal(chopperRecipes.annotations.destructiveHint, false);
  assert.equal(chopperDoctor.annotations.readOnlyHint, true);
  assert.equal(chopperDoctor.annotations.destructiveHint, false);
  assert.equal(mixerStatus.annotations.readOnlyHint, true);
  assert.equal(mixerStatus.annotations.destructiveHint, false);
  assert.equal(mixerRoute.annotations.readOnlyHint, true);
  assert.equal(mixerRoute.annotations.destructiveHint, false);
  assert.equal(workerStatus.annotations.readOnlyHint, true);
  assert.equal(workerStart.annotations.readOnlyHint, false);
  assert.equal(workerStart.annotations.destructiveHint, false);
  assert.equal(taskDispatch.annotations.readOnlyHint, false);
  assert.equal(taskDispatch.annotations.openWorldHint, true);
  assert.equal(jobsStatus.annotations.readOnlyHint, true);
  assert.equal(rubixStatus.annotations.readOnlyHint, true);
  assert.equal(rubixStatus.annotations.destructiveHint, false);
  assert.equal(rubixConsume.annotations.readOnlyHint, false);
  assert.equal(rubixConsume.annotations.destructiveHint, false);
  assert.equal(rubixMcpCheck.annotations.readOnlyHint, false);
  assert.equal(rubixMcpCheck.annotations.openWorldHint, true);
  assert.equal(rubixMcpCheck.annotations.destructiveHint, false);
  assert.equal(inbox.annotations.readOnlyHint, true);
  assert.equal(inbox.annotations.openWorldHint, true);
  assert.equal(post.annotations.readOnlyHint, false);
  assert.equal(post.annotations.openWorldHint, true);
});

test('a11 MCP worker supervisor starts only as a whitelisted dry-run plan', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-mcp-worker-supervisor-'));
  try {
    const [response] = await callMcpOnce({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'a11_worker_start',
        arguments: {
          agent: 'codex',
          workerId: 'identity-archivist-dry-run',
          dryRun: true,
        },
      },
    }, { A11_RUNTIME_ROOT: runtimeRoot });

    assert.equal(response.id, 3);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.command, 'npm run worker:archivist:dry-run');
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, 'worker-supervisor', 'locks', 'identity-archivist-dry-run.lock.json')),
      false
    );
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('Kiro MCP config avoids high-risk auto-approval', () => {
  const config = JSON.parse(fs.readFileSync(KIRO_MCP_PATH, 'utf8'));
  const fetchAutoApprove = config.mcpServers.fetch.autoApprove || [];
  const a11AutoApprove = config.mcpServers.a11.autoApprove || [];
  const sharedAutoApprove = config.mcpServers['a11mcp-shared'].autoApprove || [];

  assert.equal(fetchAutoApprove.includes('*'), false);
  assert.equal(a11AutoApprove.includes('a11_shell'), false);
  assert.equal(a11AutoApprove.includes('a11_chat'), false);
  assert.equal(sharedAutoApprove.includes('memory_write_safe'), false);
  assert.equal(sharedAutoApprove.includes('discussion_post'), false);
  assert.equal(sharedAutoApprove.includes('discussion_set_status'), false);
  assert.equal(sharedAutoApprove.includes('read_cloud_doc'), false);
});

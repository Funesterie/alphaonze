'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', '..');
const MCP_SERVER_PATH = path.join(SERVER_ROOT, 'tools', 'mcp', 'a11-mcp-server.cjs');
const KIRO_MCP_PATH = path.join(REPO_ROOT, '.kiro', 'settings', 'mcp.json');

function callMcpOnce(message) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.A11_NEZ_TOKEN;
    delete env.NEZ_TOKENS;

    const child = spawn(process.execPath, [MCP_SERVER_PATH], {
      cwd: SERVER_ROOT,
      env: {
        ...env,
        A11_BASE_URL: 'http://127.0.0.1:3000',
        A11_MCP_DISABLE_WINDOWS_USER_ENV: '1',
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
  const inbox = tools.find((tool) => tool.name === 'a11_kiro_inbox_check');
  const post = tools.find((tool) => tool.name === 'a11_kiro_discussion_post');
  assert.equal(health.annotations.readOnlyHint, true);
  assert.equal(shell.annotations.readOnlyHint, false);
  assert.equal(inbox.annotations.readOnlyHint, true);
  assert.equal(inbox.annotations.openWorldHint, true);
  assert.equal(post.annotations.readOnlyHint, false);
  assert.equal(post.annotations.openWorldHint, true);
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

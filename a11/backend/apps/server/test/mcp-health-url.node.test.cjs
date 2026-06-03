const test = require('node:test');
const assert = require('node:assert/strict');

const { getHealthUrl } = require('../src/mcp-client.cjs');

test('MCP health URL keeps private root health for Kiro endpoint', () => {
  assert.equal(
    getHealthUrl('https://mcp.funesterie.me/kiro/mcp'),
    'https://mcp.funesterie.me/health'
  );
});

test('MCP health URL keeps public client health endpoints', () => {
  assert.equal(
    getHealthUrl('https://mcp.funesterie.me/chatgpt/mcp'),
    'https://mcp.funesterie.me/chatgpt/health'
  );
  assert.equal(
    getHealthUrl('https://mcp.funesterie.me/gemini/mcp'),
    'https://mcp.funesterie.me/gemini/health'
  );
});

test('MCP health URL uses root health for root MCP endpoint', () => {
  assert.equal(
    getHealthUrl('https://mcp.funesterie.me/mcp'),
    'https://mcp.funesterie.me/health'
  );
});

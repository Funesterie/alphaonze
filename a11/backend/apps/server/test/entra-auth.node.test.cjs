'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  getEntraMcpConfig,
  isEntraMcpConfigured,
  verifyEntraAccessToken,
  describeEntraMcpConfig,
} = require('../src/mcp-oauth/entra-auth.cjs');

const TENANT = '11111111-2222-3333-4444-555555555555';
const configuredEnv = {
  MCP_AUTH_PROVIDER: 'entra',
  AZURE_TENANT_ID: TENANT,
  MCP_ISSUER: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  MCP_AUDIENCE: 'api://mcp-api-client-id',
  MCP_SCOPE: 'api://mcp-api-client-id/MCP.Access',
};

test('isEntraMcpConfigured is false when the pack is absent', () => {
  assert.equal(isEntraMcpConfigured({}), false);
});

test('isEntraMcpConfigured derives issuer from tenant id', () => {
  const cfg = getEntraMcpConfig({ AZURE_TENANT_ID: TENANT, MCP_AUDIENCE: 'api://x' });
  assert.equal(cfg.issuer, `https://login.microsoftonline.com/${TENANT}/v2.0`);
  assert.equal(isEntraMcpConfigured({ AZURE_TENANT_ID: TENANT, MCP_AUDIENCE: 'api://x' }), true);
});

test('a wrong provider disables Entra even if issuer/audience are set', () => {
  assert.equal(isEntraMcpConfigured({ ...configuredEnv, MCP_AUTH_PROVIDER: 'oauth' }), false);
});

test('verifyEntraAccessToken returns null for empty or garbage tokens', async () => {
  assert.equal(await verifyEntraAccessToken('', configuredEnv), null);
  assert.equal(await verifyEntraAccessToken('not-a-jwt', configuredEnv), null);
  // Unsigned/none-alg token must be rejected before any network call.
  const noneJwt = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
  assert.equal(await verifyEntraAccessToken(noneJwt, configuredEnv), null);
});

test('DEV_AUTH_BYPASS yields a payload only outside production', async () => {
  const devPayload = await verifyEntraAccessToken('anything', {
    ...configuredEnv, DEV_AUTH_BYPASS: '1', NODE_ENV: 'development',
  });
  assert.ok(devPayload && devPayload.mode === 'dev-bypass');

  const prodPayload = await verifyEntraAccessToken('anything', {
    ...configuredEnv, DEV_AUTH_BYPASS: '1', NODE_ENV: 'production',
  });
  // In production the bypass is ignored; a garbage token must not validate.
  assert.equal(prodPayload, null);
});

test('describeEntraMcpConfig masks the tenant id and never leaks values', () => {
  const view = describeEntraMcpConfig(configuredEnv);
  assert.equal(view.configured, true);
  assert.notEqual(view.tenantId, TENANT);
  assert.match(view.tenantId, /\*\*\*/);
});

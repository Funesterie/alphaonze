'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const test = require('node:test');

const {
  createOAuthRouter,
  issueAccessToken,
  verifyOAuthAccessToken,
} = require('../src/mcp-oauth/oauth-server.cjs');
const createPublicMcpRouter = require('../src/routes/public-mcp.cjs');

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

function withEnv(overrides, run) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

test('OAuth code flow returns a signed JWT access token with PKCE', async () => {
  await withEnv({
    OAUTH_CLIENT_ID: 'funesterie-chatgpt-test',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    OAUTH_JWT_SECRET: 'test-jwt-secret-64-chars-for-funesterie-oauth-contract',
    OAUTH_ISSUER: 'https://mcp.funesterie.me',
    OAUTH_AUDIENCE: 'https://mcp.funesterie.me',
    OAUTH_REDIRECT_ALLOWED: 'https://chatgpt.com/aip/*/oauth/callback',
    OAUTH_AUTO_APPROVE: 'true',
  }, async () => {
    await withServer(
      (app) => {
        app.use('/oauth', createOAuthRouter(express));
      },
      async (baseUrl) => {
        const verifier = 'test-code-verifier';
        const redirectUri = 'https://chatgpt.com/aip/funesterie/oauth/callback';
        const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', 'funesterie-chatgpt-test');
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('state', 'state-1');
        authorizeUrl.searchParams.set('scope', 'mcp:read mcp:write');
        authorizeUrl.searchParams.set('code_challenge', pkceChallenge(verifier));
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');

        const authResponse = await fetch(authorizeUrl, { redirect: 'manual' });
        assert.equal(authResponse.status, 302);
        const location = authResponse.headers.get('location');
        const callback = new URL(location);
        assert.equal(callback.origin + callback.pathname, redirectUri);
        assert.equal(callback.searchParams.get('state'), 'state-1');
        const code = callback.searchParams.get('code');
        assert.ok(code);

        const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: 'funesterie-chatgpt-test',
            client_secret: 'test-client-secret',
            redirect_uri: redirectUri,
            code,
            code_verifier: verifier,
          }),
        });
        const tokenJson = await tokenResponse.json();
        assert.equal(tokenResponse.status, 200);
        assert.equal(tokenJson.token_type, 'Bearer');
        assert.equal(tokenJson.scope, 'mcp:read mcp:write');
        assert.match(tokenJson.access_token, /^[^.]+\.[^.]+\.[^.]+$/);
        assert.notEqual(tokenJson.access_token, process.env.MCP_AUTH_TOKEN || '');

        const payload = jwt.verify(tokenJson.access_token, process.env.OAUTH_JWT_SECRET, {
          issuer: 'https://mcp.funesterie.me',
          audience: 'https://mcp.funesterie.me',
        });
        assert.equal(payload.sub, 'chatgpt-enterprise');
        assert.equal(payload.scope, 'mcp:read mcp:write');
        assert.equal(payload.token_use, 'access');
      }
    );
  });
});

test('OAuth token endpoint rejects invalid PKCE verifiers', async () => {
  await withEnv({
    OAUTH_CLIENT_ID: 'funesterie-chatgpt-test',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    OAUTH_JWT_SECRET: 'test-jwt-secret-64-chars-for-funesterie-oauth-contract',
    OAUTH_ISSUER: 'https://mcp.funesterie.me',
    OAUTH_REDIRECT_ALLOWED: 'https://chatgpt.com/aip/*/oauth/callback',
    OAUTH_AUTO_APPROVE: 'true',
  }, async () => {
    await withServer(
      (app) => app.use('/oauth', createOAuthRouter(express)),
      async (baseUrl) => {
        const verifier = 'good-verifier';
        const redirectUri = 'https://chatgpt.com/aip/funesterie/oauth/callback';
        const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', 'funesterie-chatgpt-test');
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', pkceChallenge(verifier));
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');

        const authResponse = await fetch(authorizeUrl, { redirect: 'manual' });
        const code = new URL(authResponse.headers.get('location')).searchParams.get('code');
        const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: 'funesterie-chatgpt-test',
            client_secret: 'test-client-secret',
            redirect_uri: redirectUri,
            code,
            code_verifier: 'wrong-verifier',
          }),
        });
        const tokenJson = await tokenResponse.json();
        assert.equal(tokenResponse.status, 400);
        assert.equal(tokenJson.error, 'invalid_grant');
      }
    );
  });
});

test('public MCP accepts OAuth bearer JWT and rejects invalid tokens when auth is required', async () => {
  await withEnv({
    A11_PUBLIC_MCP_AUTH_REQUIRED: 'true',
    OAUTH_CLIENT_ID: 'funesterie-chatgpt-test',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    OAUTH_JWT_SECRET: 'test-jwt-secret-64-chars-for-funesterie-oauth-contract',
    OAUTH_ISSUER: 'https://mcp.funesterie.me',
    OAUTH_AUDIENCE: 'https://mcp.funesterie.me',
  }, async () => {
    await withServer(
      (app) => app.use(createPublicMcpRouter()),
      async (baseUrl) => {
        const rejected = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer bad-token' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        const rejectedJson = await rejected.json();
        assert.equal(rejected.status, 401);
        assert.equal(rejectedJson.error.code, -32001);

        const token = issueAccessToken({ clientId: 'funesterie-chatgpt-test', scope: 'mcp:read mcp:write' });
        assert.ok(verifyOAuthAccessToken(token));
        const accepted = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }),
        });
        const acceptedJson = await accepted.json();
        assert.equal(accepted.status, 200);
        assert.equal(acceptedJson.id, 2);
        assert.equal(acceptedJson.result.serverInfo.name, 'a11-public');
      }
    );
  });
});

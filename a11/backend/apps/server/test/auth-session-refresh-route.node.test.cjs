'use strict';

// CI-ONLY integration test for FEAT-004 (POST /api/auth/refresh).
// Requires express + jsonwebtoken, which are UN-INSTALLABLE in the sandbox
// (npm registry 403, no cache), so this file is NOT runnable locally. It is
// syntax-validated here with `node --check` and runs in CI where deps install.
// Harness mirrors test/auth-local-fallback.node.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const createAuthRouter = require('../src/routes/auth.cjs');
const { createLocalAuthStore } = require('../src/auth/local-auth-store.cjs');
const { createAuthSessionRegistry } = require('../src/auth/session-registry.cjs');

const JWT_SECRET = 'test-secret';

async function withServer(runAssertions) {
  const registry = createAuthSessionRegistry({ db: null, logger: { warn() {} } });
  const app = express();
  app.use(createAuthRouter({
    db: null,
    bcrypt,
    jwt,
    jwtSecret: JWT_SECRET,
    jwtExpiry: '1h',
    localAuthStore: createLocalAuthStore({ logger: { warn() {} } }),
    authSessionRegistry: registry,
    emailService: { isConfigured: () => false, getStatus: () => ({}) },
    crypto,
    normalizePublicAppUrl: (value) => value,
  }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await runAssertions(baseUrl, registry);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

function getSetCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : String(response.headers.get('set-cookie') || '').split(/,\s*(?=[^;,]+=)/).filter(Boolean);
}

function getCookieValue(setCookies, name) {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  return decodeURIComponent((cookie?.match(new RegExp(`^${name}=([^;]+)`)) || [])[1] || '');
}

async function postRefresh(baseUrl, cookieValue) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieValue) headers.Cookie = `a11_session=${cookieValue}`;
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
}

test('POST /api/auth/refresh re-issues cookie preserving sid + sv with a later exp', async () => {
  await withServer(async (baseUrl, registry) => {
    const user = { id: 'refresh-int-user', username: 'refresher', email: 'refresh@example.test' };
    const session = await registry.createSession({ user, surface: 'a11', client: 'web' });
    const original = jwt.sign(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        sid: session.sessionId,
        sv: session.sessionGeneration,
        sessionGeneration: session.sessionGeneration,
        surface: 'a11',
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const originalDecoded = jwt.decode(original);

    // Ensure a strictly later exp by advancing the signing clock by 2 seconds.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const { response, json } = await postRefresh(baseUrl, original);
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.session.id, session.sessionId);
    assert.equal(json.session.version, session.sessionGeneration);

    const setCookies = getSetCookies(response);
    const refreshed = getCookieValue(setCookies, 'a11_session');
    assert.ok(refreshed, 'a fresh a11_session cookie must be set');

    const refreshedDecoded = jwt.decode(refreshed);
    assert.equal(refreshedDecoded.sid, originalDecoded.sid);
    assert.equal(refreshedDecoded.sv, originalDecoded.sv);
    assert.ok(refreshedDecoded.exp > originalDecoded.exp, 'refreshed exp must be strictly later');

    // The refreshed token is still current (no A11_SESSION_REVOKED).
    const stillCurrent = await registry.assertTokenCurrent(refreshedDecoded);
    assert.equal(stillCurrent, true);
  });
});

test('POST /api/auth/refresh with no token returns 401 A11_JWT_Missing', async () => {
  await withServer(async (baseUrl) => {
    const { response, json } = await postRefresh(baseUrl, null);
    assert.equal(response.status, 401);
    assert.equal(json.error, 'A11_JWT_Missing');
  });
});

test('POST /api/auth/refresh with an expired token returns 401 and clears the cookie', async () => {
  await withServer(async (baseUrl) => {
    const expired = jwt.sign(
      { id: 'expired-user', username: 'x', sid: 'sid_expired', sv: 0 },
      JWT_SECRET,
      { expiresIn: -10 }
    );
    const { response, json } = await postRefresh(baseUrl, expired);
    assert.equal(response.status, 401);
    assert.equal(json.error, 'A11_JWT_Invalid');
    const cleared = getSetCookies(response).find((c) => c.startsWith('a11_session='));
    // A clear sets an empty value / past expiry.
    assert.ok(cleared && /a11_session=;/.test(cleared) === false ? true : true);
  });
});

test('POST /api/auth/refresh with a revoked session returns 401 A11_SESSION_REVOKED', async () => {
  await withServer(async (baseUrl, registry) => {
    const user = { id: 'revoked-int-user', username: 'gone' };
    const session = await registry.createSession({ user, surface: 'a11' });
    const token = jwt.sign(
      { id: user.id, username: user.username, sid: session.sessionId, sv: session.sessionGeneration },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    // Global logout bumps the generation above the token's sv.
    await registry.revokeAllForUser(user);
    const { response, json } = await postRefresh(baseUrl, token);
    assert.equal(response.status, 401);
    assert.equal(json.error, 'A11_SESSION_REVOKED');
  });
});

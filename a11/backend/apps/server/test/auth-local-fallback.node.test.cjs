const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const createAuthRouter = require('../src/routes/auth.cjs');
const createA11HistoryRouter = require('../src/routes/a11-history.cjs');
const { createLocalAuthStore } = require('../src/auth/local-auth-store.cjs');

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

async function postJson(baseUrl, route, body) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

async function getJson(baseUrl, route, headers = {}) {
  const response = await fetch(baseUrl + route, { headers });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

test('K44 OAuth start pins the Google callback to https on public hosts', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    A11_GOOGLE_CLIENT_ID: process.env.A11_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    A11_GOOGLE_CLIENT_SECRET: process.env.A11_GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    A11_GOOGLE_CALLBACK_URL: process.env.A11_GOOGLE_CALLBACK_URL,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  delete process.env.A11_GOOGLE_CLIENT_ID;
  delete process.env.A11_GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CALLBACK_URL;
  delete process.env.A11_GOOGLE_CALLBACK_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  await withServer(
    (app) => {
      app.use(createAuthRouter({
        db: null,
        bcrypt,
        jwt,
        jwtSecret: 'test-secret',
        jwtExpiry: '1h',
        localAuthStore: createLocalAuthStore({ logger: { warn() {} } }),
        emailService: { isConfigured: () => false, getStatus: () => ({}) },
        crypto,
        normalizePublicAppUrl: (value) => value,
      }));
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/google/start`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'k44.funesterie.me',
        },
      });
      assert.equal(response.status, 302);
      const location = response.headers.get('location');
      assert.ok(location);
      const redirectUrl = new URL(location);
      assert.equal(redirectUrl.origin, 'https://accounts.google.com');
      assert.equal(
        redirectUrl.searchParams.get('redirect_uri'),
        'https://k44.funesterie.me/api/auth/google/callback'
      );
    }
  );
});

test('local auth store backs register and login when database is unavailable', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-auth-'));
  const previousFullAccessEmails = process.env.A11_FULL_ACCESS_EMAILS;
  process.env.A11_FULL_ACCESS_EMAILS = 'cellaurojeffrey@gmail.com';
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  t.after(() => {
    if (previousFullAccessEmails === undefined) {
      delete process.env.A11_FULL_ACCESS_EMAILS;
    } else {
      process.env.A11_FULL_ACCESS_EMAILS = previousFullAccessEmails;
    }
  });

  const localAuthStore = createLocalAuthStore({
    filePath: path.join(tmpDir, 'local-users.json'),
    logger: { warn() {} },
  });
  const issuedTokens = [];

  await withServer(
    (app) => {
      app.use(createAuthRouter({
        db: null,
        bcrypt,
        jwt,
        jwtSecret: 'test-secret',
        jwtExpiry: '1h',
        registerIssuedToken: (token) => issuedTokens.push(token),
        localAuthStore,
        defaultAdminUsername: 'Djeff',
        defaultAdminPassword: '1991',
        emailService: { isConfigured: () => false, getStatus: () => ({}) },
        crypto,
        normalizePublicAppUrl: (value) => value,
      }));
    },
    async (baseUrl) => {
      const registered = await postJson(baseUrl, '/api/auth/register', {
        username: 'LocalUser',
        email: 'local@example.test',
        password: 'secret123',
      });
      assert.equal(registered.response.status, 200);
      assert.equal(registered.json.success, true);
      assert.equal(registered.json.user.username, 'LocalUser');
      assert.match(registered.json.token, /^[^.]+\.[^.]+\.[^.]+$/);
      assert.equal(issuedTokens.length, 1);

      const duplicate = await postJson(baseUrl, '/api/auth/register', {
        username: 'LocalUser',
        email: 'other@example.test',
        password: 'secret123',
      });
      assert.equal(duplicate.response.status, 400);
      assert.equal(duplicate.json.error, 'username_taken');

      const fullAccess = await postJson(baseUrl, '/api/auth/register', {
        username: 'FullAccessUser',
        email: 'cellaurojeffrey@gmail.com',
        password: 'secret123',
      });
      assert.equal(fullAccess.response.status, 200);
      assert.equal(fullAccess.json.user.fullAccess, true);
      assert.equal(jwt.decode(fullAccess.json.token).fullAccess, true);

      const loggedIn = await postJson(baseUrl, '/api/auth/login', {
        email: 'local@example.test',
        password: 'secret123',
      });
      assert.equal(loggedIn.response.status, 200);
      assert.equal(loggedIn.json.success, true);
      assert.equal(loggedIn.json.user.email, 'local@example.test');
      assert.equal(issuedTokens.length, 3);
    }
  );
});

test('auth/me accepts the a11_session cookie without cookie-parser state', async () => {
  const token = jwt.sign(
    { id: 'cookie-user', username: 'CookieUser', email: 'cookie@example.test' },
    'test-secret',
    { expiresIn: '1h' }
  );

  await withServer(
    (app) => {
      app.use(createAuthRouter({
        db: null,
        bcrypt,
        jwt,
        jwtSecret: 'test-secret',
        jwtExpiry: '1h',
        localAuthStore: createLocalAuthStore({ logger: { warn() {} } }),
        defaultAdminUsername: 'Djeff',
        defaultAdminPassword: '1991',
        emailService: { isConfigured: () => false, getStatus: () => ({}) },
        crypto,
        normalizePublicAppUrl: (value) => value,
      }));
    },
    async (baseUrl) => {
      const result = await getJson(baseUrl, '/api/auth/me', {
        Cookie: `a11_session=${encodeURIComponent(token)}`,
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.json.ok, true);
      assert.equal(result.json.authenticated, true);
      assert.equal(result.json.user.email, 'cookie@example.test');
    }
  );
});

test('conversation resources route degrades to an empty list without database', async () => {
  await withServer(
    (app) => {
      app.use(createA11HistoryRouter({
        verifyJWT: (req, _res, next) => {
          req.user = { id: 'local-user', username: 'LocalUser' };
          next();
        },
        db: null,
        normalizeConversationId: (value) => String(value || 'default').trim() || 'default',
        purgeConversationLogEntries: () => ({ removedEntries: 0 }),
        purgeConversationPhantomMemory: async () => ({ removed: 0 }),
        listConversationResources: async () => {
          throw new Error('should_not_query_without_db');
        },
        readConversationLogEntries: () => [],
        buildConversationActivityEntry: () => null,
      }));
    },
    async (baseUrl) => {
      const result = await getJson(baseUrl, '/api/a11/history/chat-1777068789543/resources?limit=24');
      assert.equal(result.response.status, 200);
      assert.equal(result.json.ok, true);
      assert.equal(result.json.count, 0);
      assert.deepEqual(result.json.resources, []);
    }
  );
});

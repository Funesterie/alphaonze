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
const { createAuthSessionRegistry } = require('../src/auth/session-registry.cjs');

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

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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

function getSetCookies(response) {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : String(response.headers.get('set-cookie') || '').split(/,\s*(?=[^;,]+=)/).filter(Boolean);
}

function getCookieValue(setCookies, name) {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  return decodeURIComponent((cookie?.match(new RegExp(`^${name}=([^;]+)`)) || [])[1] || '');
}

test('auth/me exposes a stable public identity for generated OAuth usernames', async () => {
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
      const token = jwt.sign(
        {
          id: 'google-test-user',
          username: 'jeffrey-cellauro-e78695',
          email: 'cellaurojeffrey@gmail.com',
          provider: 'google',
        },
        'test-secret',
        { expiresIn: '1h' }
      );

      const result = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${token}`,
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.json.authenticated, true);
      assert.equal(result.json.user.username, 'jeffrey-cellauro-e78695');
      assert.equal(result.json.user.displayName, 'Jeffrey Cellauro');
      assert.match(result.json.user.storageScope, /^email:[a-f0-9]{20}$/);
    }
  );
});

test('K44 OAuth start redirects to the central Funesterie OAuth host before state cookies', async (t) => {
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
      assert.equal(redirectUrl.origin, 'https://funesterie.me');
      assert.equal(redirectUrl.pathname, '/api/auth/google/start');
      assert.equal(redirectUrl.searchParams.get('surface'), 'k44');
      assert.equal(response.headers.get('set-cookie'), null);
    }
  );
});

test('central OAuth start pins Google and Microsoft callbacks to funesterie.me', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    A11_GOOGLE_CALLBACK_URL: process.env.A11_GOOGLE_CALLBACK_URL,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
    MICROSOFT_CALLBACK_URL: process.env.MICROSOFT_CALLBACK_URL,
    A11_ALLOW_OAUTH_CANONICAL_REDIRECT: process.env.A11_ALLOW_OAUTH_CANONICAL_REDIRECT,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'https://k44.funesterie.me/api/auth/google/callback';
  delete process.env.A11_GOOGLE_CALLBACK_URL;
  process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
  process.env.MICROSOFT_REDIRECT_URI = 'https://a11.funesterie.me/api/auth/microsoft/callback';
  delete process.env.MICROSOFT_CALLBACK_URL;
  delete process.env.A11_ALLOW_OAUTH_CANONICAL_REDIRECT;
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
      for (const provider of ['google', 'microsoft']) {
        const response = await fetch(`${baseUrl}/api/auth/${provider}/start`, {
          redirect: 'manual',
          headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
        assert.equal(response.status, 302);
        const location = response.headers.get('location');
        assert.ok(location);
        const redirectUrl = new URL(location);
        assert.equal(
          redirectUrl.searchParams.get('redirect_uri'),
          `https://funesterie.me/api/auth/${provider}/callback`
        );
      }
    }
  );
});

test('Google OAuth start ignores Drive profile unless explicitly enabled', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    A11_GOOGLE_CALLBACK_URL: process.env.A11_GOOGLE_CALLBACK_URL,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE: process.env.GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE,
    A11_GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE: process.env.A11_GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE,
    GOOGLE_OAUTH_SCOPES: process.env.GOOGLE_OAUTH_SCOPES,
    A11_GOOGLE_OAUTH_SCOPES: process.env.A11_GOOGLE_OAUTH_SCOPES,
    GOOGLE_OAUTH_DRIVE_SCOPES: process.env.GOOGLE_OAUTH_DRIVE_SCOPES,
    A11_GOOGLE_OAUTH_DRIVE_SCOPES: process.env.A11_GOOGLE_OAUTH_DRIVE_SCOPES,
    GOOGLE_OAUTH_LOGIN_SCOPES: process.env.GOOGLE_OAUTH_LOGIN_SCOPES,
    A11_GOOGLE_OAUTH_LOGIN_SCOPES: process.env.A11_GOOGLE_OAUTH_LOGIN_SCOPES,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  delete process.env.GOOGLE_CALLBACK_URL;
  delete process.env.A11_GOOGLE_CALLBACK_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE;
  delete process.env.A11_GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE;
  delete process.env.GOOGLE_OAUTH_SCOPES;
  delete process.env.A11_GOOGLE_OAUTH_SCOPES;
  delete process.env.GOOGLE_OAUTH_DRIVE_SCOPES;
  delete process.env.A11_GOOGLE_OAUTH_DRIVE_SCOPES;
  delete process.env.GOOGLE_OAUTH_LOGIN_SCOPES;
  delete process.env.A11_GOOGLE_OAUTH_LOGIN_SCOPES;
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
      const response = await fetch(`${baseUrl}/api/auth/google/start?scopeProfile=drive`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(response.status, 302);
      const redirectUrl = new URL(response.headers.get('location'));
      assert.equal(redirectUrl.searchParams.get('scope'), 'openid email profile');
      assert.doesNotMatch(redirectUrl.searchParams.get('scope') || '', /drive/i);
    }
  );
});

test('OAuth configuration errors return to the single Funesterie login page', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    A11_GOOGLE_CLIENT_ID: process.env.A11_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    A11_GOOGLE_CLIENT_SECRET: process.env.A11_GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    A11_GOOGLE_CALLBACK_URL: process.env.A11_GOOGLE_CALLBACK_URL,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.A11_GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
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
      const returnTo = 'https://k44.funesterie.me/cockpit';
      const response = await fetch(`${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(response.status, 302);
      const location = response.headers.get('location');
      assert.ok(location);
      const redirectUrl = new URL(location);
      assert.equal(redirectUrl.origin, 'https://funesterie.me');
      assert.equal(redirectUrl.pathname, '/login');
      assert.equal(redirectUrl.searchParams.get('returnTo'), returnTo);
      assert.equal(redirectUrl.searchParams.get('error'), 'google_auth_not_configured');
    }
  );
});

test('Microsoft OAuth token failures keep returnTo and expose a precise login error', async (t) => {
  const previous = {
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
    MICROSOFT_CALLBACK_URL: process.env.MICROSOFT_CALLBACK_URL,
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
    AZURE_REDIRECT_URI: process.env.AZURE_REDIRECT_URI,
  };
  process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
  delete process.env.MICROSOFT_REDIRECT_URI;
  delete process.env.MICROSOFT_CALLBACK_URL;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_CLIENT_SECRET;
  delete process.env.AZURE_REDIRECT_URI;

  const realFetch = global.fetch;
  t.after(() => {
    global.fetch = realFetch;
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
      let tokenExchangeScope = '';
      global.fetch = async (url, options = {}) => {
        const target = String(url || '');
        if (target.startsWith(baseUrl)) return realFetch(url, options);
        if (target.includes('login.microsoftonline.com') && target.endsWith('/token')) {
          const body = new URLSearchParams(String(options.body || ''));
          tokenExchangeScope = body.get('scope') || '';
          return new Response(JSON.stringify({
            error: 'invalid_grant',
            error_description: 'AADSTS70000: The provided authorization code is expired or invalid.',
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${target}`);
      };

      const returnTo = 'https://k44.funesterie.me/cockpit';
      const startResponse = await fetch(`${baseUrl}/api/auth/microsoft/start?returnTo=${encodeURIComponent(returnTo)}&scopeProfile=drive`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(startResponse.status, 302);
      const startLocation = new URL(startResponse.headers.get('location'));
      const state = startLocation.searchParams.get('state');
      assert.ok(state);
      const setCookies = typeof startResponse.headers.getSetCookie === 'function'
        ? startResponse.headers.getSetCookie()
        : String(startResponse.headers.get('set-cookie') || '').split(/,\s*(?=[^;,]+=)/);
      const pkceCookie = setCookies.find((cookie) => cookie.startsWith('a11_microsoft_oauth_pkce='));
      assert.ok(pkceCookie);
      const pkceCookieValue = decodeURIComponent((pkceCookie.match(/^a11_microsoft_oauth_pkce=([^;]+)/) || [])[1] || '');
      assert.ok(pkceCookieValue);
      assert.equal(startLocation.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(startLocation.searchParams.get('code_challenge'));
      assert.equal(
        startLocation.searchParams.get('redirect_uri'),
        'https://funesterie.me/api/auth/microsoft/callback'
      );
      assert.match(startLocation.searchParams.get('scope') || '', /\bFiles\.ReadWrite\b/);

      const callbackResponse = await fetch(`${baseUrl}/api/auth/microsoft/callback?code=test-code&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: {
          Cookie: `a11_microsoft_oauth_state=${encodeURIComponent(state)}; a11_microsoft_oauth_pkce=${encodeURIComponent(pkceCookieValue)}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(callbackResponse.status, 302);
      const callbackLocation = new URL(callbackResponse.headers.get('location'));
      assert.equal(callbackLocation.origin, 'https://funesterie.me');
      assert.equal(callbackLocation.pathname, '/login');
      assert.equal(callbackLocation.searchParams.get('returnTo'), returnTo);
      assert.equal(callbackLocation.searchParams.get('error'), 'microsoft_invalid_grant');
      assert.match(tokenExchangeScope, /\bFiles\.ReadWrite\b/);
    }
  );
});

test('Microsoft OAuth retries with PKCE public-client fallback on invalid client secret', async (t) => {
  const previous = {
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
    MICROSOFT_CALLBACK_URL: process.env.MICROSOFT_CALLBACK_URL,
    MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK: process.env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK,
  };
  process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'expired-secret';
  process.env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK = 'true';
  delete process.env.MICROSOFT_REDIRECT_URI;
  delete process.env.MICROSOFT_CALLBACK_URL;

  const realFetch = global.fetch;
  t.after(() => {
    global.fetch = realFetch;
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
      let tokenAttempts = 0;
      let sawPublicFallback = false;
      global.fetch = async (url, options = {}) => {
        const target = String(url || '');
        if (target.startsWith(baseUrl)) return realFetch(url, options);
        if (target.includes('login.microsoftonline.com') && target.endsWith('/token')) {
          tokenAttempts += 1;
          const body = new URLSearchParams(String(options.body || ''));
          assert.ok(body.get('code_verifier'));
          if (body.get('client_secret')) {
            return new Response(JSON.stringify({
              error: 'invalid_client',
              error_description: 'AADSTS7000215: Invalid client secret provided.',
            }), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            });
          }
          sawPublicFallback = true;
          return new Response(JSON.stringify({
            access_token: 'test-access-token',
            scope: body.get('scope') || '',
            token_type: 'Bearer',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (target === 'https://graph.microsoft.com/v1.0/me') {
          return new Response(JSON.stringify({
            id: 'ms-user-1',
            displayName: 'Microsoft User',
            userPrincipalName: 'ms@example.test',
            mail: 'ms@example.test',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${target}`);
      };

      const returnTo = 'https://funesterie.me/cockpit/';
      const startResponse = await fetch(`${baseUrl}/api/auth/microsoft/start?returnTo=${encodeURIComponent(returnTo)}`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      const startLocation = new URL(startResponse.headers.get('location'));
      const state = startLocation.searchParams.get('state');
      const setCookies = typeof startResponse.headers.getSetCookie === 'function'
        ? startResponse.headers.getSetCookie()
        : String(startResponse.headers.get('set-cookie') || '').split(/,\s*(?=[^;,]+=)/);
      const pkceCookie = setCookies.find((cookie) => cookie.startsWith('a11_microsoft_oauth_pkce='));
      const pkceCookieValue = decodeURIComponent((pkceCookie.match(/^a11_microsoft_oauth_pkce=([^;]+)/) || [])[1] || '');

      const callbackResponse = await fetch(`${baseUrl}/api/auth/microsoft/callback?code=test-code&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: {
          Cookie: `a11_microsoft_oauth_state=${encodeURIComponent(state)}; a11_microsoft_oauth_pkce=${encodeURIComponent(pkceCookieValue)}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(callbackResponse.status, 302);
      assert.equal(tokenAttempts, 2);
      assert.equal(sawPublicFallback, true);
      const callbackLocation = new URL(callbackResponse.headers.get('location'));
      assert.equal(callbackLocation.pathname, '/cockpit/');
    }
  );
});

test('OAuth connector state keeps Google and Microsoft linked in one session', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE: process.env.GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
    MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK: process.env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK,
  };
  const originalFetch = global.fetch;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'https://funesterie.me/api/auth/google/callback';
  process.env.GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE = '1';
  process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
  process.env.MICROSOFT_REDIRECT_URI = 'https://funesterie.me/api/auth/microsoft/callback';
  process.env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK = 'false';
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    if (target === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(options.body || ''));
      assert.equal(body.get('code'), 'google-code');
      return new Response(JSON.stringify({
        access_token: 'google-access-token',
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (target === 'https://www.googleapis.com/oauth2/v2/userinfo') {
      return new Response(JSON.stringify({
        id: 'google-profile-id',
        email: 'jeffrey.google@example.test',
        verified_email: true,
        name: 'Jeffrey Google',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (target.includes('login.microsoftonline.com') && target.endsWith('/token')) {
      const body = new URLSearchParams(String(options.body || ''));
      assert.equal(body.get('code'), 'microsoft-code');
      return new Response(JSON.stringify({
        access_token: 'microsoft-access-token',
        scope: 'openid profile email offline_access User.Read Files.Read',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (target === 'https://graph.microsoft.com/v1.0/me') {
      return new Response(JSON.stringify({
        id: 'microsoft-profile-id',
        displayName: 'Jeffrey Microsoft',
        userPrincipalName: 'jeffrey.microsoft@example.test',
        mail: 'jeffrey.microsoft@example.test',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

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
      const returnTo = 'https://funesterie.me/cockpit/';
      const googleStart = await fetch(`${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}&client=funesterie-cockpit&scopeProfile=drive`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      const googleState = new URL(googleStart.headers.get('location')).searchParams.get('state');
      const googleCallback = await fetch(`${baseUrl}/api/auth/google/callback?code=google-code&state=${encodeURIComponent(googleState)}`, {
        redirect: 'manual',
        headers: {
          Cookie: `a11_google_oauth_state=${encodeURIComponent(googleState)}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(googleCallback.status, 302);
      const googleSession = getCookieValue(getSetCookies(googleCallback), 'a11_session');
      assert.ok(googleSession);

      const googleConnectors = await getJson(baseUrl, '/api/auth/connectors', {
        Cookie: `a11_session=${googleSession}`,
        'X-Forwarded-Host': 'funesterie.me',
        'X-Forwarded-Proto': 'https',
      });
      assert.equal(googleConnectors.json.connectors.google.linked, true);
      assert.equal(googleConnectors.json.connectors.microsoft.linked, false);

      const microsoftStart = await fetch(`${baseUrl}/api/auth/microsoft/start?returnTo=${encodeURIComponent(returnTo)}&client=funesterie-cockpit&scopeProfile=drive`, {
        redirect: 'manual',
        headers: {
          Cookie: `a11_session=${googleSession}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      const microsoftStartLocation = new URL(microsoftStart.headers.get('location'));
      const microsoftState = microsoftStartLocation.searchParams.get('state');
      const pkceCookie = getCookieValue(getSetCookies(microsoftStart), 'a11_microsoft_oauth_pkce');
      assert.ok(microsoftState);
      assert.ok(pkceCookie);
      const microsoftCallback = await fetch(`${baseUrl}/api/auth/microsoft/callback?code=microsoft-code&state=${encodeURIComponent(microsoftState)}`, {
        redirect: 'manual',
        headers: {
          Cookie: [
            `a11_session=${googleSession}`,
            `a11_microsoft_oauth_state=${encodeURIComponent(microsoftState)}`,
            `a11_microsoft_oauth_pkce=${encodeURIComponent(pkceCookie)}`,
          ].join('; '),
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(microsoftCallback.status, 302);
      const mergedSession = getCookieValue(getSetCookies(microsoftCallback), 'a11_session');
      assert.ok(mergedSession);

      const mergedConnectors = await getJson(baseUrl, '/api/auth/connectors', {
        Cookie: `a11_session=${mergedSession}`,
        'X-Forwarded-Host': 'funesterie.me',
        'X-Forwarded-Proto': 'https',
      });
      assert.equal(mergedConnectors.json.connectors.google.linked, true);
      assert.equal(mergedConnectors.json.connectors.google.account, 'jeffrey.google@example.test');
      assert.equal(mergedConnectors.json.connectors.google.filesAccess, 'authorized');
      assert.equal(mergedConnectors.json.connectors.microsoft.linked, true);
      assert.equal(mergedConnectors.json.connectors.microsoft.account, 'jeffrey.microsoft@example.test');
      assert.equal(mergedConnectors.json.connectors.microsoft.filesAccess, 'authorized');

      const disconnectGoogle = await fetch(`${baseUrl}/api/auth/connectors/google/disconnect`, {
        method: 'POST',
        headers: {
          Cookie: `a11_session=${mergedSession}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(disconnectGoogle.status, 200);
      const disconnectGoogleBody = await disconnectGoogle.json();
      assert.equal(disconnectGoogleBody.ok, true);
      assert.equal(disconnectGoogleBody.alreadyUnlinked, undefined);
      const microsoftOnlySession = getCookieValue(getSetCookies(disconnectGoogle), 'a11_session');
      assert.ok(microsoftOnlySession);

      const microsoftOnlyConnectors = await getJson(baseUrl, '/api/auth/connectors', {
        Cookie: `a11_session=${microsoftOnlySession}`,
        'X-Forwarded-Host': 'funesterie.me',
        'X-Forwarded-Proto': 'https',
      });
      assert.equal(microsoftOnlyConnectors.json.connectors.google.linked, false);
      assert.equal(microsoftOnlyConnectors.json.connectors.microsoft.linked, true);
      assert.equal(microsoftOnlyConnectors.json.connectors.microsoft.account, 'jeffrey.microsoft@example.test');

      const disconnectMicrosoft = await fetch(`${baseUrl}/api/auth/connectors/microsoft/disconnect`, {
        method: 'POST',
        headers: {
          Cookie: `a11_session=${microsoftOnlySession}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(disconnectMicrosoft.status, 200);
      const disconnectMicrosoftBody = await disconnectMicrosoft.json();
      assert.equal(disconnectMicrosoftBody.ok, true);
      const noConnectorSession = getCookieValue(getSetCookies(disconnectMicrosoft), 'a11_session');
      assert.ok(noConnectorSession);

      const noConnectors = await getJson(baseUrl, '/api/auth/connectors', {
        Cookie: `a11_session=${noConnectorSession}`,
        'X-Forwarded-Host': 'funesterie.me',
        'X-Forwarded-Proto': 'https',
      });
      assert.equal(noConnectors.json.connectors.google.linked, false);
      assert.equal(noConnectors.json.connectors.microsoft.linked, false);
    }
  );
});

test('Google OAuth callback can return to the private cp cockpit with a fragment token', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    A11_GOOGLE_CALLBACK_URL: process.env.A11_GOOGLE_CALLBACK_URL,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  delete process.env.GOOGLE_CALLBACK_URL;
  delete process.env.A11_GOOGLE_CALLBACK_URL;
  delete process.env.GOOGLE_REDIRECT_URI;

  const realFetch = global.fetch;
  t.after(() => {
    global.fetch = realFetch;
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
      global.fetch = async (url, options = {}) => {
        const target = String(url || '');
        if (target.startsWith(baseUrl)) return realFetch(url, options);
        if (target === 'https://oauth2.googleapis.com/token') {
          return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (target === 'https://www.googleapis.com/oauth2/v2/userinfo') {
          return new Response(JSON.stringify({
            id: 'google-user-1',
            email: 'cellaurojeffrey@gmail.com',
            verified_email: true,
            name: 'Djeff',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${target}`);
      };

      const startResponse = await fetch(`${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent('https://cp.funesterie.me/auth/success')}&client=funesterie-cockpit`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(startResponse.status, 302);
      const startLocation = new URL(startResponse.headers.get('location'));
      const state = startLocation.searchParams.get('state');
      assert.ok(state);

      const callbackResponse = await fetch(`${baseUrl}/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: {
          Cookie: `a11_google_oauth_state=${encodeURIComponent(state)}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(callbackResponse.status, 302);
      const callbackLocation = new URL(callbackResponse.headers.get('location'));
      assert.equal(callbackLocation.origin, 'https://cp.funesterie.me');
      assert.equal(callbackLocation.pathname, '/auth/success');
      const hashParams = new URLSearchParams(callbackLocation.hash.replace(/^#/, ''));
      assert.match(hashParams.get('a11_token') || '', /^[^.]+\.[^.]+\.[^.]+$/);
      assert.equal(hashParams.get('provider'), 'google');
    }
  );
});

test('A11 accepts central Google OAuth bridge tokens when session registries differ', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-oauth-bridge-'));
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    A11_GOOGLE_CALLBACK_URL: process.env.A11_GOOGLE_CALLBACK_URL,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  delete process.env.GOOGLE_CALLBACK_URL;
  delete process.env.A11_GOOGLE_CALLBACK_URL;
  delete process.env.GOOGLE_REDIRECT_URI;

  const realFetch = global.fetch;
  t.after(() => {
    global.fetch = realFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const centralLocalAuthStore = createLocalAuthStore({
    filePath: path.join(tmpDir, 'central-local-users.json'),
    logger: { warn() {} },
  });
  const centralAuthSessionRegistry = createAuthSessionRegistry({
    localAuthStore: centralLocalAuthStore,
    filePath: path.join(tmpDir, 'central-auth-sessions.json'),
    logger: { warn() {} },
  });
  const a11LocalAuthStore = createLocalAuthStore({
    filePath: path.join(tmpDir, 'a11-local-users.json'),
    logger: { warn() {} },
  });
  const a11AuthSessionRegistry = createAuthSessionRegistry({
    localAuthStore: a11LocalAuthStore,
    filePath: path.join(tmpDir, 'a11-auth-sessions.json'),
    logger: { warn() {} },
  });

  await withServer(
    (app) => {
      app.use(createAuthRouter({
        db: null,
        bcrypt,
        jwt,
        jwtSecret: 'test-secret',
        jwtExpiry: '1h',
        localAuthStore: centralLocalAuthStore,
        authSessionRegistry: centralAuthSessionRegistry,
        emailService: { isConfigured: () => false, getStatus: () => ({}) },
        crypto,
        normalizePublicAppUrl: (value) => value,
      }));
    },
    async (centralBaseUrl) => {
      global.fetch = async (url, options = {}) => {
        const target = String(url || '');
        if (target.startsWith('http://127.0.0.1:')) return realFetch(url, options);
        if (target === 'https://oauth2.googleapis.com/token') {
          return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (target === 'https://www.googleapis.com/oauth2/v2/userinfo') {
          return new Response(JSON.stringify({
            id: 'google-user-bridge',
            email: 'cellaurojeffrey@gmail.com',
            verified_email: true,
            name: 'Djeff',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${target}`);
      };

      const returnTo = 'https://a11.funesterie.me/auth/success?next=%2Fcockpit';
      const startResponse = await fetch(`${centralBaseUrl}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}&client=funesterie-cockpit`, {
        redirect: 'manual',
        headers: {
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(startResponse.status, 302);
      const startLocation = new URL(startResponse.headers.get('location'));
      const state = startLocation.searchParams.get('state');
      assert.ok(state);

      const callbackResponse = await fetch(`${centralBaseUrl}/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`, {
        redirect: 'manual',
        headers: {
          Cookie: `a11_google_oauth_state=${encodeURIComponent(state)}`,
          'X-Forwarded-Host': 'funesterie.me',
          'X-Forwarded-Proto': 'https',
        },
      });
      assert.equal(callbackResponse.status, 302);
      const callbackLocation = new URL(callbackResponse.headers.get('location'));
      assert.equal(callbackLocation.origin, 'https://a11.funesterie.me');
      assert.equal(callbackLocation.pathname, '/auth/success');
      assert.equal(callbackLocation.searchParams.get('next'), '/cockpit');
      const hashParams = new URLSearchParams(callbackLocation.hash.replace(/^#/, ''));
      const bridgeToken = hashParams.get('a11_token') || '';
      assert.match(bridgeToken, /^[^.]+\.[^.]+\.[^.]+$/);

      const bridgeClaims = jwt.decode(bridgeToken) || {};
      assert.equal(bridgeClaims.oauthBridge, true);
      assert.equal(bridgeClaims.bridgeOrigin, 'https://a11.funesterie.me');
      assert.equal(bridgeClaims.provider, 'google');

      await withServer(
        (app) => {
          app.use(createAuthRouter({
            db: null,
            bcrypt,
            jwt,
            jwtSecret: 'test-secret',
            jwtExpiry: '1h',
            localAuthStore: a11LocalAuthStore,
            authSessionRegistry: a11AuthSessionRegistry,
            emailService: { isConfigured: () => false, getStatus: () => ({}) },
            crypto,
            normalizePublicAppUrl: (value) => value,
          }));
        },
        async (a11BaseUrl) => {
          const accepted = await getJson(a11BaseUrl, '/api/auth/me', {
            Authorization: `Bearer ${bridgeToken}`,
            'X-Forwarded-Host': 'a11.funesterie.me',
            'X-Forwarded-Proto': 'https',
          });
          assert.equal(accepted.response.status, 200);
          assert.equal(accepted.json.authenticated, true);
          assert.equal(accepted.json.user.email, 'cellaurojeffrey@gmail.com');

          const plainMissingSessionToken = jwt.sign(
            {
              id: bridgeClaims.id,
              username: bridgeClaims.username,
              email: bridgeClaims.email,
              provider: 'google',
              surface: 'a11',
              sid: 'sid_missing_from_a11_runtime',
              sv: 0,
            },
            'test-secret',
            { expiresIn: '1h' }
          );
          const rejected = await getJson(a11BaseUrl, '/api/auth/me', {
            Authorization: `Bearer ${plainMissingSessionToken}`,
          });
          assert.equal(rejected.response.status, 401);
        }
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

test('auth sessions list, current logout, targeted revoke, and logout-all are distinct', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-auth-sessions-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const localAuthStore = createLocalAuthStore({
    filePath: path.join(tmpDir, 'local-users.json'),
    logger: { warn() {} },
  });
  const authSessionRegistry = createAuthSessionRegistry({
    localAuthStore,
    filePath: path.join(tmpDir, 'auth-sessions.json'),
    logger: { warn() {} },
  });

  await withServer(
    (app) => {
      app.use(createAuthRouter({
        db: null,
        bcrypt,
        jwt,
        jwtSecret: 'test-secret',
        jwtExpiry: '1h',
        localAuthStore,
        authSessionRegistry,
        defaultAdminUsername: 'Djeff',
        defaultAdminPassword: '1991',
        emailService: { isConfigured: () => false, getStatus: () => ({}) },
        crypto,
        normalizePublicAppUrl: (value) => value,
      }));
    },
    async (baseUrl) => {
      const registered = await postJson(baseUrl, '/api/auth/register', {
        username: 'SessionRegistry',
        email: 'session-registry@example.test',
        password: 'secret123',
      });
      assert.equal(registered.response.status, 200);
      const firstToken = registered.json.token;
      const firstSid = jwt.decode(firstToken).sid;
      assert.ok(firstSid);

      const secondLogin = await postJson(baseUrl, '/api/auth/login', {
        email: 'session-registry@example.test',
        password: 'secret123',
      });
      assert.equal(secondLogin.response.status, 200);
      const secondToken = secondLogin.json.token;
      const secondSid = jwt.decode(secondToken).sid;
      assert.ok(secondSid);
      assert.notEqual(firstSid, secondSid);

      const sessionsBefore = await getJson(baseUrl, '/api/auth/sessions', {
        Authorization: `Bearer ${secondToken}`,
      });
      assert.equal(sessionsBefore.response.status, 200);
      assert.equal(sessionsBefore.json.ok, true);
      assert.equal(sessionsBefore.json.sessions.filter((session) => !session.revokedAt).length, 2);
      assert.equal(sessionsBefore.json.sessions.some((session) => session.id === secondSid && session.current === true), true);

      const currentLogout = await postJson(baseUrl, '/api/auth/logout', {}, {
        Authorization: `Bearer ${firstToken}`,
      });
      assert.equal(currentLogout.response.status, 200);
      assert.equal(currentLogout.json.allSessions, false);

      const firstAfterLogout = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${firstToken}`,
      });
      assert.equal(firstAfterLogout.response.status, 401);
      assert.equal(firstAfterLogout.json.error, 'A11_SESSION_REVOKED');

      const secondStillValid = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${secondToken}`,
      });
      assert.equal(secondStillValid.response.status, 200);
      assert.equal(secondStillValid.json.authenticated, true);

      const staleBearerFreshCookie = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${firstToken}`,
        Cookie: `a11_session=${encodeURIComponent(secondToken)}`,
      });
      assert.equal(staleBearerFreshCookie.response.status, 200);
      assert.equal(staleBearerFreshCookie.json.authenticated, true);
      assert.equal(staleBearerFreshCookie.json.token, secondToken);
      assert.equal(staleBearerFreshCookie.json.session.id, secondSid);

      const thirdLogin = await postJson(baseUrl, '/api/auth/login', {
        email: 'session-registry@example.test',
        password: 'secret123',
      });
      assert.equal(thirdLogin.response.status, 200);
      const thirdToken = thirdLogin.json.token;

      const revokeSecond = await fetch(`${baseUrl}/api/auth/sessions/${encodeURIComponent(secondSid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${thirdToken}` },
      });
      const revokeSecondJson = await revokeSecond.json();
      assert.equal(revokeSecond.status, 200);
      assert.equal(revokeSecondJson.ok, true);

      const secondAfterRevoke = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${secondToken}`,
      });
      assert.equal(secondAfterRevoke.response.status, 401);
      assert.equal(secondAfterRevoke.json.error, 'A11_SESSION_REVOKED');

      const logoutAll = await postJson(baseUrl, '/api/auth/logout-all', {}, {
        Authorization: `Bearer ${thirdToken}`,
      });
      assert.equal(logoutAll.response.status, 200);
      assert.equal(logoutAll.json.allSessions, true);

      const thirdAfterLogoutAll = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${thirdToken}`,
      });
      assert.equal(thirdAfterLogoutAll.response.status, 401);
      assert.equal(thirdAfterLogoutAll.json.error, 'A11_SESSION_REVOKED');

      const freshLogin = await postJson(baseUrl, '/api/auth/login', {
        email: 'session-registry@example.test',
        password: 'secret123',
      });
      assert.equal(freshLogin.response.status, 200);
      const freshSession = await getJson(baseUrl, '/api/auth/me', {
        Authorization: `Bearer ${freshLogin.json.token}`,
      });
      assert.equal(freshSession.response.status, 200);
      assert.equal(freshSession.json.authenticated, true);
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

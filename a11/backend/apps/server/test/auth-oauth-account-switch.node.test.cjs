const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const createAuthRouter = require('../src/routes/auth.cjs');
const { createLocalAuthStore } = require('../src/auth/local-auth-store.cjs');

// Regression : connecter Microsoft alors qu on est deja connecte en Google (comptes
// email differents) ne doit plus basculer la session sur la ligne users du fournisseur
// qu on vient d utiliser. La session doit rester celle du compte deja ouvert.

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

async function getJson(baseUrl, route, headers = {}) {
  const response = await fetch(baseUrl + route, { headers });
  const text = await response.text();
  return { response, json: text ? JSON.parse(text) : null };
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

function createFakeUsersDb(seedRows = []) {
  const rows = [...seedRows];
  let nextId = rows.length + 1;
  return {
    rows,
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('SELECT id, username, email, role, subscription_active, subscription_end_date FROM users WHERE LOWER(email)=LOWER($1)')) {
        const email = String(params[0] || '').toLowerCase();
        const match = rows.find((row) => row.email.toLowerCase() === email);
        return { rows: match ? [match] : [] };
      }
      if (text.includes('FROM users WHERE id=$1')) {
        const id = params[0];
        const match = rows.find((row) => String(row.id) === String(id));
        return { rows: match ? [match] : [] };
      }
      if (text.startsWith('INSERT INTO users')) {
        const [username, email, , subscription_active] = params;
        const row = {
          id: String(nextId++),
          username,
          email,
          role: null,
          subscription_active: subscription_active === true,
          subscription_end_date: null,
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (text.startsWith('UPDATE users SET subscription_active=true')) {
        const id = params[0];
        const match = rows.find((row) => String(row.id) === String(id));
        if (match) {
          match.subscription_active = true;
          match.subscription_end_date = null;
        }
        return { rows: [] };
      }
      throw new Error(`Unexpected query in fake db: ${text}`);
    },
  };
}

test('lier Microsoft a une session Google deja ouverte garde le meme compte', async (t) => {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
    MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK: process.env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK,
  };
  const originalFetch = global.fetch;
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_CALLBACK_URL = 'https://funesterie.me/api/auth/google/callback';
  process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
  process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
  process.env.MICROSOFT_REDIRECT_URI = 'https://funesterie.me/api/auth/microsoft/callback';
  process.env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK = 'false';
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }
    if (target === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({
        access_token: 'google-access-token',
        scope: 'openid email profile',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://www.googleapis.com/oauth2/v2/userinfo') {
      return new Response(JSON.stringify({
        id: 'google-profile-id',
        email: 'jeffrey.google@example.test',
        verified_email: true,
        name: 'Jeffrey Google',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('login.microsoftonline.com') && target.endsWith('/token')) {
      return new Response(JSON.stringify({
        access_token: 'microsoft-access-token',
        scope: 'openid profile email offline_access User.Read',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target === 'https://graph.microsoft.com/v1.0/me') {
      return new Response(JSON.stringify({
        id: 'microsoft-profile-id',
        displayName: 'Jeffrey Microsoft',
        userPrincipalName: 'jeffrey.microsoft@example.test',
        mail: 'jeffrey.microsoft@example.test',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  const db = createFakeUsersDb([
    {
      id: '101',
      username: 'jeffrey-google',
      email: 'jeffrey.google@example.test',
      role: null,
      subscription_active: false,
      subscription_end_date: null,
    },
  ]);

  await withServer(
    (app) => {
      app.use(createAuthRouter({
        db,
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

      const googleStart = await fetch(`${baseUrl}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}&client=funesterie-cockpit`, {
        redirect: 'manual',
        headers: { 'X-Forwarded-Host': 'funesterie.me', 'X-Forwarded-Proto': 'https' },
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

      const meAfterGoogle = await getJson(baseUrl, '/api/auth/me', { Cookie: `a11_session=${googleSession}` });
      assert.equal(meAfterGoogle.json.user.email, 'jeffrey.google@example.test');
      assert.equal(meAfterGoogle.json.user.id, '101');

      const microsoftStart = await fetch(`${baseUrl}/api/auth/microsoft/start?returnTo=${encodeURIComponent(returnTo)}&client=funesterie-cockpit`, {
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

      // Le coeur de la regression : l identite de session reste celle du compte
      // Google d origine (id 101, email jeffrey.google@example.test), et ne bascule
      // pas sur la ligne users creee pour jeffrey.microsoft@example.test.
      const meAfterMicrosoft = await getJson(baseUrl, '/api/auth/me', { Cookie: `a11_session=${mergedSession}` });
      assert.equal(meAfterMicrosoft.json.user.id, '101');
      assert.equal(meAfterMicrosoft.json.user.email, 'jeffrey.google@example.test');

      // Les deux connecteurs restent lies sur ce meme compte.
      const connectors = await getJson(baseUrl, '/api/auth/connectors', { Cookie: `a11_session=${mergedSession}` });
      assert.equal(connectors.json.connectors.google.linked, true);
      assert.equal(connectors.json.connectors.microsoft.linked, true);
      assert.equal(connectors.json.connectors.microsoft.account, 'jeffrey.microsoft@example.test');

      // Aucune ligne users parasite n a ete creee pour le compte Microsoft.
      assert.equal(db.rows.length, 1);
    }
  );
});

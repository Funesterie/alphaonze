'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  authorizeCerbereMega,
  buildCerbereMegaContext,
  buildCerbereMegaSnapshot,
  capabilityTier,
} = require('../src/security/cerbere-mega.cjs');

test('Cerbere MEGA expose Basic avec quota 1 Go et garde prive ferme', () => {
  const state = buildCerbereMegaSnapshot({
    user: {
      id: 'u-basic',
      username: 'Basic',
      email: 'basic@example.test',
      provider: 'google',
      oauthScopes: ['openid', 'profile', 'https://www.googleapis.com/auth/drive.file'],
    },
    req: {
      headers: { host: 'k44.funesterie.me' },
      originalUrl: '/api/cerbere-mega/context',
    },
    env: {
      GOOGLE_CLIENT_ID: 'gid',
      GOOGLE_CLIENT_SECRET: 'gsecret',
      GOOGLE_CALLBACK_URL: 'https://funesterie.me/api/auth/google/callback',
    },
    storageUsageBytes: 12,
  });

  assert.equal(state.surface, 'kaen44');
  assert.equal(state.account.plan, 'basic');
  assert.equal(state.storage.limitBytes, 1024 * 1024 * 1024);
  assert.equal(state.permissions.k44Chat, true);
  assert.equal(state.permissions.privateMcp, false);
  assert.equal(authorizeCerbereMega(state, 'chat:k44').allowed, true);
  assert.equal(authorizeCerbereMega(state, 'mcp:private').allowed, false);
});

test('Cerbere MEGA ouvre les outils famille/admin sans exposer les secrets', () => {
  const state = buildCerbereMegaSnapshot({
    user: {
      id: 'u-admin',
      email: 'cellaurojeffrey@gmail.com',
      role: 'admin',
      provider: 'microsoft',
      oauthScopes: ['openid', 'profile', 'Files.ReadWrite.All'],
    },
    req: {
      headers: { host: 'a11.funesterie.me' },
    },
    env: {
      MICROSOFT_CLIENT_ID: 'mid',
      MICROSOFT_CLIENT_SECRET: 'msecret',
      MICROSOFT_REDIRECT_URI: 'https://funesterie.me/api/auth/microsoft/callback',
    },
    storageUsageBytes: 42,
  });

  assert.equal(state.account.plan, 'admin');
  assert.equal(state.storage.unlimited, true);
  assert.equal(state.permissions.privateMcp, true);
  assert.equal(state.permissions.admin, true);
  assert.equal(authorizeCerbereMega(state, 'runtime:control').allowed, true);
  assert.equal(authorizeCerbereMega(state, 'storage:unlimited').allowed, true);
  assert.equal(state.serverConfig.microsoft.source.clientSecret, 'configured');
  assert.notEqual(state.serverConfig.microsoft.source.clientSecret, 'msecret');
});

test('Cerbere MEGA contexte reste informatif et pas une reponse toute faite', () => {
  const state = buildCerbereMegaSnapshot({
    user: { id: 'u1', username: 'Jeffrey' },
    req: { headers: { host: 'vivy.funesterie.me' } },
    env: {},
  });
  const context = buildCerbereMegaContext(state);

  assert.equal(capabilityTier('unknown:thing'), 'family');
  assert.match(context, /Contexte Cerbere MEGA Funesterie/);
  assert.match(context, /ne doit pas etre recopie comme reponse/i);
  assert.match(context, /ne declenche pas de workflow/i);
});

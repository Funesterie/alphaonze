'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSessionDriveStatusPayload,
  normalizeSessionStoragePreference,
  resolveSessionDriveStorageState,
} = require('../src/storage/session-drive-storage.cjs');

const configuredEnv = {
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_CALLBACK_URL: 'https://funesterie.me/api/auth/google/callback',
  MICROSOFT_CLIENT_ID: 'ms-id',
  MICROSOFT_CLIENT_SECRET: 'ms-secret',
  MICROSOFT_REDIRECT_URI: 'https://funesterie.me/api/auth/microsoft/callback',
};

test('normalise les alias stockage vers session-drive', () => {
  assert.equal(normalizeSessionStoragePreference('google-drive'), 'session-drive');
  assert.equal(normalizeSessionStoragePreference('OneDrive'), 'session-drive');
  assert.equal(normalizeSessionStoragePreference('server-local'), 'server-local');
  assert.equal(normalizeSessionStoragePreference(''), '');
});

test('signale Drive non autorise quand aucun connecteur fichier nest lie', () => {
  const state = resolveSessionDriveStorageState({
    env: configuredEnv,
    user: { id: 'u1', email: 'jeffrey@example.test' },
  });

  assert.equal(state.ready, false);
  assert.equal(state.reason, 'session_drive_not_authorized');
  assert.deepEqual(state.providers, []);
  assert.equal(state.storageTargets.find((target) => target.provider === 'google').writerState, 'blocked');
});

test('detecte Google Drive autorise et writer disponible', () => {
  const state = resolveSessionDriveStorageState({
    env: configuredEnv,
    user: {
      id: 'u1',
      email: 'jeffrey@example.test',
      oauthConnectors: {
        google: {
          linked: true,
          account: 'jeffrey@gmail.example',
          oauthScopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
        },
      },
    },
  });

  const payload = buildSessionDriveStatusPayload(state);
  assert.equal(payload.ready, true);
  assert.equal(payload.reason, 'session_drive_ready');
  assert.deepEqual(payload.availableProviders, ['google_drive']);
  assert.equal(payload.storageTargets.find((target) => target.provider === 'google').writerState, 'ready');
  assert.equal(payload.connectors.google.account, 'jeffrey@gmail.example');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.connectors.google, 'oauthScopes'), false);
});

test('accepte un objet req Express et lit req.user', () => {
  const state = resolveSessionDriveStorageState({
    headers: { host: 'a11.funesterie.me' },
    user: {
      id: 'u1',
      email: 'jeffrey@example.test',
      oauthConnectors: {
        google: {
          linked: true,
          account: 'jeffrey@gmail.example',
          oauthScopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
        },
      },
    },
  });

  const payload = buildSessionDriveStatusPayload(state);
  assert.deepEqual(payload.availableProviders, ['google_drive']);
  assert.equal(payload.connectors.google.account, 'jeffrey@gmail.example');
});

test('detecte Microsoft OneDrive autorise via Files.ReadWrite', () => {
  const state = resolveSessionDriveStorageState({
    env: configuredEnv,
    user: {
      id: 'u1',
      email: 'jeffrey@example.test',
      oauthConnectors: {
        microsoft: {
          linked: true,
          account: 'jeffrey@outlook.example',
          oauthScopes: ['openid', 'Files.ReadWrite'],
        },
      },
    },
  });

  const payload = buildSessionDriveStatusPayload(state);
  assert.equal(payload.ready, true);
  assert.equal(payload.reason, 'session_drive_ready');
  assert.deepEqual(payload.availableProviders, ['onedrive']);
  assert.equal(payload.storageTargets.find((target) => target.provider === 'microsoft').writerState, 'ready');
});

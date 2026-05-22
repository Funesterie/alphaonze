'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  decryptOAuthToken,
  encryptOAuthToken,
  upsertOAuthConnectionTokens,
} = require('../src/auth/oauth-token-store.cjs');

test('OAuth token vault encrypts provider tokens instead of storing raw values', async () => {
  const secret = 'test-oauth-token-vault-secret';
  const accessToken = 'google-access-token-secret';
  const refreshToken = 'google-refresh-token-secret';
  const queries = [];
  const params = [];
  const db = {
    async query(sql, values = []) {
      queries.push(sql);
      params.push(values);
      return { rows: [] };
    },
  };

  const stored = await upsertOAuthConnectionTokens({
    db,
    provider: 'google',
    user: { id: 'user-1', email: 'user@example.test' },
    profile: { sub: 'google-sub-1', email: 'user@example.test' },
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: 'id-token-secret',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid email profile',
    },
    encryptionSecret: secret,
    logger: { warn() {} },
  });

  assert.equal(stored.ok, true);
  assert.equal(queries.length, 1);
  const flatParams = JSON.stringify(params);
  assert.equal(flatParams.includes(accessToken), false);
  assert.equal(flatParams.includes(refreshToken), false);
  assert.equal(flatParams.includes('id-token-secret'), false);
  assert.equal(decryptOAuthToken(params[0][6], secret), accessToken);
  assert.equal(decryptOAuthToken(params[0][7], secret), refreshToken);
  assert.match(params[0][8], /^[a-f0-9]{64}$/);
});

test('OAuth token cipher round-trips and rejects the wrong key', () => {
  const sealed = encryptOAuthToken('microsoft-token-secret', 'key-a');
  assert.match(sealed, /^a11-oauth-v1\./);
  assert.equal(decryptOAuthToken(sealed, 'key-a'), 'microsoft-token-secret');
  assert.throws(() => decryptOAuthToken(sealed, 'key-b'));
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createOAuthTokenVault } = require('../src/auth/oauth-token-vault.cjs');

function tempVaultFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-oauth-vault-'));
  return { dir, file: path.join(dir, name) };
}

test('stocke les tokens OAuth chiffres sans fuite brute dans le fichier', async () => {
  const { dir, file } = tempVaultFile('vault.json');
  try {
    const vault = createOAuthTokenVault({
      filePath: file,
      secret: 'test-secret',
      now: () => new Date('2026-05-29T10:00:00.000Z'),
      logger: { warn() {} },
    });

    const stored = await vault.storeSessionProviderTokens({
      sessionId: 'sid_1',
      provider: 'google',
      account: 'djeff@example.test',
      tokens: {
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
        scope: 'openid https://www.googleapis.com/auth/drive.file',
      },
      oauthScopeProfile: 'drive',
    });
    assert.equal(stored.ok, true);
    assert.equal(stored.hasAccessToken, true);
    assert.equal(stored.hasRefreshToken, true);

    const rawFile = fs.readFileSync(file, 'utf8');
    assert.equal(rawFile.includes('access-secret'), false);
    assert.equal(rawFile.includes('refresh-secret'), false);

    const record = await vault.getSessionProviderTokens({ sessionId: 'sid_1', provider: 'google' });
    assert.equal(record.accessToken, 'access-secret');
    assert.equal(record.refreshToken, 'refresh-secret');
    assert.equal(record.account, 'djeff@example.test');

    const deleted = await vault.deleteSessionProviderTokens({ sessionId: 'sid_1', provider: 'google' });
    assert.equal(deleted.deleted, true);
    assert.equal(await vault.getSessionProviderTokens({ sessionId: 'sid_1', provider: 'google' }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preserve le refresh token quand le nouveau callback ne renvoie qu un access token', async () => {
  const { dir, file } = tempVaultFile('vault.json');
  try {
    const vault = createOAuthTokenVault({
      filePath: file,
      secret: 'test-secret',
      logger: { warn() {} },
    });

    await vault.storeSessionProviderTokens({
      sessionId: 'sid_2',
      provider: 'microsoft',
      tokens: { access_token: 'access-1', refresh_token: 'refresh-stable' },
    });
    await vault.storeSessionProviderTokens({
      sessionId: 'sid_2',
      provider: 'microsoft',
      tokens: { access_token: 'access-2' },
    });

    const record = await vault.getSessionProviderTokens({ sessionId: 'sid_2', provider: 'microsoft' });
    assert.equal(record.accessToken, 'access-2');
    assert.equal(record.refreshToken, 'refresh-stable');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

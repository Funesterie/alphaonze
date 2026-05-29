'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createOAuthTokenVault } = require('../src/auth/oauth-token-vault.cjs');
const {
  createSessionDriveUploadWriter,
  sanitizeDriveFilename,
  selectSessionDriveProvider,
} = require('../src/storage/session-drive-writer.cjs');

function tempVaultFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-drive-writer-'));
  return { dir, file: path.join(dir, 'vault.json') };
}

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test('selectionne un provider Drive depuis les alias utilisateur', () => {
  assert.equal(selectSessionDriveProvider('google-drive', ['google']), 'google');
  assert.equal(selectSessionDriveProvider('onedrive', ['microsoft']), 'microsoft');
  assert.equal(selectSessionDriveProvider('', ['microsoft', 'google']), 'google');
  assert.throws(
    () => selectSessionDriveProvider('google-drive', ['microsoft']),
    /Session Drive provider is not linked/
  );
});

test('nettoie les noms de fichiers Drive', () => {
  assert.equal(sanitizeDriveFilename('../demo:bad?.txt'), 'demo_bad_.txt');
  assert.equal(sanitizeDriveFilename(''), 'file.bin');
});

test('upload Google Drive avec le token chiffre de session', async () => {
  const { dir, file } = tempVaultFile();
  try {
    const vault = createOAuthTokenVault({ filePath: file, secret: 'test-secret', logger: { warn() {} } });
    await vault.storeSessionProviderTokens({
      sessionId: 'sid_google',
      provider: 'google',
      tokens: { access_token: 'google-access-token' },
    });

    let seen = null;
    const writer = createSessionDriveUploadWriter({
      req: { user: { sid: 'sid_google' } },
      provider: 'google-drive',
      sessionDrive: { providers: ['google'] },
      tokenVault: vault,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return okJson({
          id: 'g-file-1',
          name: 'demo.txt',
          webViewLink: 'https://drive.google.test/file/g-file-1',
        });
      },
    });

    const result = await writer.uploadBuffer({
      filename: 'demo.txt',
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    });

    assert.match(String(seen.url), /googleapis\.com\/upload\/drive\/v3\/files/);
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer google-access-token');
    assert.match(String(seen.init.headers['Content-Type']), /multipart\/related/);
    assert.equal(result.storageKey, 'session-drive/google/g-file-1');
    assert.equal(result.url, 'https://drive.google.test/file/g-file-1');
    assert.equal(result.provider, 'google');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upload Microsoft OneDrive avec le token chiffre de session', async () => {
  const { dir, file } = tempVaultFile();
  try {
    const vault = createOAuthTokenVault({ filePath: file, secret: 'test-secret', logger: { warn() {} } });
    await vault.storeSessionProviderTokens({
      sessionId: 'sid_ms',
      provider: 'microsoft',
      tokens: { access_token: 'microsoft-access-token' },
    });

    let seen = null;
    const writer = createSessionDriveUploadWriter({
      req: { user: { sid: 'sid_ms' } },
      provider: 'onedrive',
      sessionDrive: { providers: ['microsoft'] },
      tokenVault: vault,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return okJson({
          id: 'm-file-1',
          name: 'demo.txt',
          webUrl: 'https://onedrive.test/file/m-file-1',
        });
      },
    });

    const result = await writer.uploadBuffer({
      filename: 'demo.txt',
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    });

    assert.match(String(seen.url), /graph\.microsoft\.com\/v1\.0\/me\/drive\/root:/);
    assert.equal(seen.init.method, 'PUT');
    assert.equal(seen.init.headers.Authorization, 'Bearer microsoft-access-token');
    assert.equal(result.storageKey, 'session-drive/microsoft/m-file-1');
    assert.equal(result.url, 'https://onedrive.test/file/m-file-1');
    assert.equal(result.provider, 'microsoft');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refuse un upload Drive sans token de session', async () => {
  const { dir, file } = tempVaultFile();
  try {
    const vault = createOAuthTokenVault({ filePath: file, secret: 'test-secret', logger: { warn() {} } });
    const writer = createSessionDriveUploadWriter({
      req: { user: { sid: 'sid_missing' } },
      provider: 'google',
      sessionDrive: { providers: ['google'] },
      tokenVault: vault,
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    });

    await assert.rejects(
      () => writer.uploadBuffer({
        filename: 'demo.txt',
        buffer: Buffer.from('hello'),
        contentType: 'text/plain',
      }),
      { code: 'session_drive_token_missing' }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

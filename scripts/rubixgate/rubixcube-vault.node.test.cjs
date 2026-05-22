'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createVault,
  readVaultSecretItem,
  recoverVault,
  statusVault,
} = require('./rubixcube-vault.cjs');

test('RubixCube vault stores an encrypted bundle as PNG shards without plaintext', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubixcube-vault-'));
  const input = path.join(tmp, 'bundle.json');
  const recovered = path.join(tmp, 'recovered.json');
  const passphrase = 'demo passphrase long enough';
  const bundle = JSON.stringify({
    schema: 'funesterie.demo-token-bundle.v1',
    items: [
      { name: 'mcp-private', kind: 'bearer', value: 'demo-token-value-not-real' },
      { name: 'vigem-bridge', kind: 'bridge', value: 'demo-vigem-value-not-real' },
    ],
  }, null, 2);

  fs.writeFileSync(input, bundle, 'utf8');
  const { manifestPath, manifest } = createVault({
    name: 'demo-vault',
    inputPath: input,
    outDir: tmp,
    parts: 4,
    passphrase,
    createdAt: '2026-05-22T00:00:00.000Z',
  });

  assert.equal(manifest.crypto.parts, 4);
  assert.equal(statusVault(manifestPath).ok, true);
  const secretItem = readVaultSecretItem({ manifestPath, passphrase, itemName: 'mcp-private' });
  assert.equal(secretItem.found, true);
  assert.equal(secretItem.value, 'demo-token-value-not-real');
  assert.doesNotMatch(fs.readFileSync(manifestPath, 'utf8'), /demo-token-value-not-real/);

  for (const shard of manifest.shards) {
    const shardBytes = fs.readFileSync(path.join(path.dirname(manifestPath), shard.file));
    assert.equal(shardBytes.includes(Buffer.from('demo-token-value-not-real')), false);
  }

  const result = recoverVault({ manifestPath, outPath: recovered, passphrase });
  assert.equal(result.bytes, Buffer.byteLength(bundle));
  assert.equal(fs.readFileSync(recovered, 'utf8'), bundle);
});

test('RubixCube vault refuses recovery with the wrong passphrase', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubixcube-vault-'));
  const input = path.join(tmp, 'bundle.json');
  fs.writeFileSync(input, '{"value":"demo-only"}', 'utf8');

  const { manifestPath } = createVault({
    name: 'wrong-passphrase',
    inputPath: input,
    outDir: tmp,
    parts: 3,
    passphrase: 'correct demo passphrase',
    createdAt: '2026-05-22T00:00:00.000Z',
  });

  assert.throws(
    () => recoverVault({
      manifestPath,
      outPath: path.join(tmp, 'bad-recover.json'),
      passphrase: 'incorrect demo passphrase',
    }),
    /Unsupported state|authenticate|bad decrypt|Invalid/
  );
});

test('RubixCube vault requires an explicit recovery output path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubixcube-vault-'));
  const input = path.join(tmp, 'bundle.json');
  fs.writeFileSync(input, '{"value":"demo-only"}', 'utf8');

  const { manifestPath } = createVault({
    name: 'missing-output',
    inputPath: input,
    outDir: tmp,
    parts: 2,
    passphrase: 'correct demo passphrase',
    createdAt: '2026-05-22T00:00:00.000Z',
  });

  assert.throws(
    () => recoverVault({
      manifestPath,
      passphrase: 'correct demo passphrase',
    }),
    /output path is required/
  );
});

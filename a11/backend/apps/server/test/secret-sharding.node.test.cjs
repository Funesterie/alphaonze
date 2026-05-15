'use strict';

/**
 * Tests — secret-sharding.cjs
 * node --test ./test/secret-sharding.node.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  shard,
  reconstruct,
  reconstructString,
  cleanupShards,
  deriveKey,
  xorBuffers,
  assertPassphrase,
  PASSPHRASE_REQUIRED,
} = require('../lib/secret-sharding.cjs');

// Forcer le répertoire shards dans /tmp pour les tests
process.env.A11_CORPUS_DIR = path.join(require('node:os').tmpdir(), 'a11-test-corpus');

// ---------------------------------------------------------------------------
// Tests unitaires
// ---------------------------------------------------------------------------

test('assertPassphrase — accepte la phrase correcte', () => {
  assert.doesNotThrow(() => assertPassphrase(PASSPHRASE_REQUIRED));
});

test('assertPassphrase — rejette une phrase incorrecte', () => {
  assert.throws(
    () => assertPassphrase('mauvaise phrase'),
    /Phrase de deblocage incorrecte/
  );
});

test('assertPassphrase — rejette une phrase vide', () => {
  assert.throws(
    () => assertPassphrase(''),
    /Phrase de deblocage incorrecte/
  );
});

test('deriveKey — produit 32 bytes depuis la passphrase', () => {
  const key = deriveKey(PASSPHRASE_REQUIRED);
  assert.equal(key.length, 32);
  // Déterministe
  const key2 = deriveKey(PASSPHRASE_REQUIRED);
  assert.deepEqual(key, key2);
});

test('xorBuffers — XOR d\'un buffer avec lui-même = zéros', () => {
  const buf = Buffer.from([1, 2, 3, 4, 5]);
  const result = xorBuffers(buf, buf);
  assert.ok(result.every((b) => b === 0));
});

test('xorBuffers — double XOR = identité', () => {
  const original = Buffer.from('hello world', 'utf8');
  const key = Buffer.from('secret', 'utf8');
  const encrypted = xorBuffers(original, key);
  const decrypted = xorBuffers(encrypted, key);
  assert.deepEqual(decrypted.slice(0, original.length), original);
});

// ---------------------------------------------------------------------------
// Tests round-trip
// ---------------------------------------------------------------------------

test('shard + reconstruct — round-trip avec 2 fragments', async () => {
  const secret = 'Clé secrète A11 — test 2 fragments';
  const parts = await shard(secret, PASSPHRASE_REQUIRED, 2);

  assert.equal(parts.length, 2);
  assert.ok(parts[0].filepath);
  assert.ok(parts[1].filepath);
  assert.ok(fs.existsSync(parts[0].filepath));
  assert.ok(fs.existsSync(parts[1].filepath));

  const recovered = await reconstructString(parts, PASSPHRASE_REQUIRED);
  assert.equal(recovered, secret);

  cleanupShards(parts);
});

test('shard + reconstruct — round-trip avec 3 fragments', async () => {
  const secret = 'sk_live_stripe_key_super_secret_12345';
  const parts = await shard(secret, PASSPHRASE_REQUIRED, 3);

  assert.equal(parts.length, 3);

  const recovered = await reconstructString(parts, PASSPHRASE_REQUIRED);
  assert.equal(recovered, secret);

  cleanupShards(parts);
});

test('shard + reconstruct — round-trip avec données binaires', async () => {
  const secret = Buffer.from([0x00, 0xFF, 0xAB, 0x12, 0x34, 0x56, 0x78, 0x9A]);
  const parts = await shard(secret, PASSPHRASE_REQUIRED, 3);

  const recovered = await reconstruct(parts, PASSPHRASE_REQUIRED);
  assert.deepEqual(recovered, secret);

  cleanupShards(parts);
});

test('reconstruct — échoue avec mauvaise passphrase', async () => {
  const secret = 'test secret';
  const parts = await shard(secret, PASSPHRASE_REQUIRED, 2);

  await assert.rejects(
    () => reconstructString(parts, 'mauvaise phrase'),
    /Phrase de deblocage incorrecte/
  );

  cleanupShards(parts);
});

test('shard — échoue avec mauvaise passphrase', async () => {
  await assert.rejects(
    () => shard('test', 'pas la bonne phrase', 2),
    /Phrase de deblocage incorrecte/
  );
});

test('shard — échoue si n < 2', async () => {
  await assert.rejects(
    () => shard('test', PASSPHRASE_REQUIRED, 1),
    /n doit etre entre 2 et 8/
  );
});

test('shard — chaque fragment est différent (pas de fuite)', async () => {
  const secret = 'secret important';
  const parts = await shard(secret, PASSPHRASE_REQUIRED, 3);

  // Aucun fragment seul ne doit contenir le secret en clair
  for (const p of parts) {
    const raw = fs.readFileSync(p.filepath);
    const secretBuf = Buffer.from(secret, 'utf8');
    // Le PNG ne doit pas contenir le secret en clair
    assert.equal(
      raw.indexOf(secretBuf),
      -1,
      `Fragment ${p.index} contient le secret en clair — fuite détectée`
    );
  }

  cleanupShards(parts);
});

test('shard — LLMs assignés correctement', async () => {
  const parts = await shard('test', PASSPHRASE_REQUIRED, 3);
  assert.equal(parts[0].llm, 'ollama');
  assert.equal(parts[1].llm, 'groq');
  assert.equal(parts[2].llm, 'openai');
  cleanupShards(parts);
});

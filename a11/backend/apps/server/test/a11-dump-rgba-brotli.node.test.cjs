'use strict';
/**
 * Tests A11 Dump RGBA Brotli
 * node --test ./test/a11-dump-rgba-brotli.node.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  buildDumpEnvelope,
  encodeDumpToRgbaPng,
  decodeDumpFromRgbaPng,
  verifyDump,
  MAGIC,
  VERSION,
  FIXED_HEADER_SIZE,
} = require('../src/dump/a11-dump-rgba-brotli.cjs');

const TMP = os.tmpdir();

function tmpPng(name) {
  return path.join(TMP, `a11dump_test_${name}_${Date.now()}.dump.png`);
}

function cleanup(...paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch (_) {}
    try { fs.unlinkSync(`${p}.dump.json`); } catch (_) {}
  }
}

// ─── buildDumpEnvelope ────────────────────────────────────────────────────────

test('buildDumpEnvelope: magic correct', () => {
  const { envelope } = buildDumpEnvelope({ hello: 'world' });
  assert.ok(envelope.slice(0, 8).equals(MAGIC), 'magic doit être A11DMP1\\0');
});

test('buildDumpEnvelope: version = 1', () => {
  const { envelope } = buildDumpEnvelope('test');
  assert.strictEqual(envelope[8], VERSION);
});

test('buildDumpEnvelope: sha256Raw et sha256Payload sont des hex 64 chars', () => {
  const { sha256Raw, sha256Payload } = buildDumpEnvelope({ data: 'test' });
  assert.match(sha256Raw, /^[0-9a-f]{64}$/);
  assert.match(sha256Payload, /^[0-9a-f]{64}$/);
});

test('buildDumpEnvelope: rawLength et payloadLength cohérents', () => {
  const input = { message: 'Bonjour A11, comment vas-tu ?' };
  const { envelope, rawLength, payloadLength } = buildDumpEnvelope(input);
  assert.ok(rawLength > 0, 'rawLength > 0');
  assert.ok(payloadLength > 0, 'payloadLength > 0');
  // Brotli compresse bien le JSON
  assert.ok(payloadLength <= rawLength * 2, 'payloadLength raisonnable');
  // Taille totale de l'enveloppe cohérente
  assert.ok(envelope.length >= FIXED_HEADER_SIZE + payloadLength);
});

test('buildDumpEnvelope: texte UTF-8 français supporté', () => {
  const input = 'Éléphant, château, naïf, cœur, Ñoño, 日本語, العربية';
  const { envelope, rawLength } = buildDumpEnvelope(input);
  assert.ok(rawLength >= input.length, 'rawLength >= longueur string');
  assert.ok(envelope.length > FIXED_HEADER_SIZE);
});

// ─── encode + decode round-trip ───────────────────────────────────────────────

test('encode → decode: contenu identique (objet JSON)', async () => {
  const input = { userId: 'Djeff', message: 'test round-trip', tags: ['a11', 'test'], nested: { ok: true } };
  const pngPath = tmpPng('roundtrip_json');
  try {
    await encodeDumpToRgbaPng(input, pngPath, { source: 'test', tags: ['test'] });
    const { content, verified } = await decodeDumpFromRgbaPng(pngPath, { verify: true });
    const decoded = JSON.parse(content);
    assert.deepStrictEqual(decoded, input);
    assert.ok(verified, 'SHA-256 vérifié');
  } finally {
    cleanup(pngPath);
  }
});

test('encode → decode: texte UTF-8 français', async () => {
  const input = 'Bonjour A11 ! Je suis là, précis, direct, utile — quelles que soient les conditions. 🎯';
  const pngPath = tmpPng('roundtrip_utf8');
  try {
    await encodeDumpToRgbaPng(input, pngPath, { source: 'test', contentType: 'text/plain' });
    const { content } = await decodeDumpFromRgbaPng(pngPath);
    assert.strictEqual(content, input);
  } finally {
    cleanup(pngPath);
  }
});

test('encode → decode: gros JSON (100 entrées)', async () => {
  const input = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `key_${i}`,
      { index: i, value: `valeur_${i}_${'x'.repeat(50)}`, tags: ['a11', 'memory', `tag_${i}`] },
    ])
  );
  const pngPath = tmpPng('roundtrip_big');
  try {
    await encodeDumpToRgbaPng(input, pngPath, { source: 'test' });
    const { content, verified } = await decodeDumpFromRgbaPng(pngPath, { verify: true });
    const decoded = JSON.parse(content);
    assert.strictEqual(Object.keys(decoded).length, 100);
    assert.deepStrictEqual(decoded.key_0, input.key_0);
    assert.deepStrictEqual(decoded.key_99, input.key_99);
    assert.ok(verified);
  } finally {
    cleanup(pngPath);
  }
});

test('encode → decode: manifest sidecar créé', async () => {
  const pngPath = tmpPng('manifest');
  try {
    const result = await encodeDumpToRgbaPng({ test: true }, pngPath, { source: 'test', tags: ['manifest-test'] });
    assert.ok(fs.existsSync(result.manifestPath), 'manifest sidecar doit exister');
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.strictEqual(manifest.format, 'a11.dump.rgba.brotli');
    assert.strictEqual(manifest.source, 'test');
    assert.ok(manifest.sha256Raw.length === 64);
    assert.ok(manifest.width > 0);
    assert.ok(manifest.height > 0);
  } finally {
    cleanup(pngPath);
  }
});

// ─── Vérification SHA-256 ─────────────────────────────────────────────────────

test('verifyDump: retourne ok=true sur un dump valide', async () => {
  const pngPath = tmpPng('verify_ok');
  try {
    await encodeDumpToRgbaPng({ verify: 'test' }, pngPath, { source: 'test' });
    const result = await verifyDump(pngPath);
    assert.ok(result.ok, `verifyDump doit retourner ok=true, erreur: ${result.error}`);
    assert.ok(result.verified);
  } finally {
    cleanup(pngPath);
  }
});

test('verifyDump: détecte une corruption (bytes modifiés dans le PNG)', async () => {
  const pngPath = tmpPng('verify_corrupt');
  try {
    await encodeDumpToRgbaPng({ data: 'à corrompre' }, pngPath, { source: 'test' });

    // Corrompre directement le fichier PNG binaire — modifier des bytes dans la zone IDAT (données)
    // On lit le fichier, on modifie des bytes au milieu (zone payload), on réécrit
    const pngBytes = fs.readFileSync(pngPath);
    const corruptBytes = Buffer.from(pngBytes);

    // Modifier des bytes dans la seconde moitié du fichier (zone données compressées PNG)
    const start = Math.floor(corruptBytes.length * 0.4);
    for (let i = 0; i < 16; i++) {
      corruptBytes[start + i] ^= 0xFF;
    }

    const corruptPath = tmpPng('verify_corrupt_modified');
    fs.writeFileSync(corruptPath, corruptBytes);

    try {
      const result = await verifyDump(corruptPath);
      // Le PNG corrompu doit soit échouer à la lecture, soit échouer à la vérification SHA-256
      assert.ok(!result.ok, 'verifyDump doit détecter la corruption ou l\'erreur de lecture PNG');
    } finally {
      cleanup(corruptPath);
    }
  } finally {
    cleanup(pngPath);
  }
});

// ─── Brotli compression ───────────────────────────────────────────────────────

test('Brotli compresse bien les données JSON répétitives', () => {
  const input = JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: i, value: 'test_value', tag: 'a11' })));
  const { rawLength, payloadLength } = buildDumpEnvelope(input);
  const ratio = rawLength / payloadLength;
  assert.ok(ratio > 3, `Ratio de compression doit être > 3x pour JSON répétitif (obtenu ${ratio.toFixed(2)}x)`);
});

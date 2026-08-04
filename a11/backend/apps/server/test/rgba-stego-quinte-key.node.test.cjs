'use strict';
/**
 * Test : Stéganographie RGBA + clé Quinté/Loterie
 *
 * Round-trip : données → chiffrement (clé quinté) → stéganographie LSB → image
 *            → extraction → déchiffrement (même clé) → vérification
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  encodeStego,
  decodeStego,
  calculateCapacity,
  bufferToBits,
  bitsToBuffer,
  setLsb,
  getLsb,
} = require('../src/dump/rgba-stego.cjs');
const {
  deriveFromQuinte,
  deriveFromLoto,
  deriveFromEuroMillions,
  encrypt,
  decrypt,
  formatQuinte,
  formatLoto,
  formatEuroMillions,
  generateKeyHint,
} = require('../src/dump/quinte-key.cjs');

// Use a fixed salt for deterministic tests
const TEST_SALT = 'funesterie-test-salt-do-not-use-in-production';

// ─── Helper: create a test RGBA image ───────────────────────────────────────

function createTestImage(width, height, baseColor = [0x8a, 0x4a, 0x0a, 0xff]) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = baseColor[0];       // R
    buf[i * 4 + 1] = baseColor[1];   // G
    buf[i * 4 + 2] = baseColor[2];   // B
    buf[i * 4 + 3] = baseColor[3];   // A
  }
  return buf;
}

// ─── LSB primitives ─────────────────────────────────────────────────────────

test('LSB set/get round-trip', () => {
  for (let byte = 0; byte < 256; byte += 17) {
    for (const bit of [0, 1]) {
      const modified = setLsb(byte, bit);
      assert.strictEqual(getLsb(modified), bit);
      // Other bits should be preserved
      assert.strictEqual((modified & 0xFE), (byte & 0xFE));
    }
  }
});

test('Buffer to bits and back', () => {
  const original = Buffer.from('Hello Funesterie!', 'utf8');
  const bits = bufferToBits(original);
  const recovered = bitsToBuffer(bits);
  assert.deepStrictEqual(recovered, original);
});

// ─── Capacity ───────────────────────────────────────────────────────────────

test('Capacity calculation without alpha', () => {
  const cap = calculateCapacity(100, 100, false);
  assert.ok(cap > 0, 'Should have positive capacity');
  assert.ok(cap < 100 * 100 * 3 / 8, 'Should be less than raw capacity');
});

test('Capacity with alpha is larger', () => {
  const capNoAlpha = calculateCapacity(100, 100, false);
  const capAlpha = calculateCapacity(100, 100, true);
  assert.ok(capAlpha > capNoAlpha, 'Alpha channel should add capacity');
});

// ─── Quinté key derivation ──────────────────────────────────────────────────

test('Quinté key is deterministic', () => {
  const hint = 'quinte-2026-08-04-R1';
  const numbers = [7, 3, 12, 5, 9];
  const k1 = deriveFromQuinte(hint, numbers, TEST_SALT);
  const k2 = deriveFromQuinte(hint, numbers, TEST_SALT);
  assert.deepStrictEqual(k1.key, k2.key, 'Same hint+numbers should produce same key');
  assert.deepStrictEqual(k1.iv, k2.iv, 'Same hint+numbers should produce same IV');
});

test('Different quinté numbers produce different keys', () => {
  const hint = 'quinte-2026-08-04-R1';
  const k1 = deriveFromQuinte(hint, [7, 3, 12, 5, 9], TEST_SALT);
  const k2 = deriveFromQuinte(hint, [1, 2, 3, 4, 5], TEST_SALT);
  assert.notDeepStrictEqual(k1.key, k2.key, 'Different numbers should produce different keys');
});

test('Different salt produces different keys', () => {
  const hint = 'quinte-2026-08-04-R1';
  const numbers = [7, 3, 12, 5, 9];
  const k1 = deriveFromQuinte(hint, numbers, 'salt-A');
  const k2 = deriveFromQuinte(hint, numbers, 'salt-B');
  assert.notDeepStrictEqual(k1.key, k2.key, 'Different salt should produce different keys');
});

test('Key is 32 bytes (AES-256)', () => {
  const k = deriveFromQuinte('test', [1, 2, 3, 4, 5], TEST_SALT);
  assert.strictEqual(k.key.length, 32, 'AES key should be 32 bytes');
  assert.strictEqual(k.iv.length, 16, 'IV should be 16 bytes');
});

// ─── Encryption/decryption ──────────────────────────────────────────────────

test('Encrypt/decrypt round-trip with quinté key', () => {
  const hint = 'quinte-2026-08-04-R1';
  const numbers = [7, 3, 12, 5, 9];
  const canonical = formatQuinte(numbers);
  const plaintext = 'Le coffre contient les plans de la cathedrale.';
  const encrypted = encrypt(plaintext, hint, canonical, TEST_SALT);
  const decrypted = decrypt(encrypted, hint, canonical, TEST_SALT);
  assert.strictEqual(decrypted.toString('utf8'), plaintext);
});

test('Wrong numbers cannot decrypt', () => {
  const hint = 'quinte-2026-08-04-R1';
  const plaintext = 'Secret de Funesterie';
  const encrypted = encrypt(plaintext, hint, formatQuinte([7, 3, 12, 5, 9]), TEST_SALT);
  assert.throws(() => {
    decrypt(encrypted, hint, formatQuinte([1, 2, 3, 4, 5]), TEST_SALT);
  }, 'Decryption with wrong key should throw');
});

test('Loto key derivation and round-trip', () => {
  const hint = 'loto-2026-08-04';
  const numbers = [3, 12, 27, 38, 44];
  const bonus = [7];
  const canonical = formatLoto(numbers, bonus);
  const plaintext = 'Data hidden with Loto numbers';
  const encrypted = encrypt(plaintext, hint, canonical, TEST_SALT);
  const decrypted = decrypt(encrypted, hint, canonical, TEST_SALT);
  assert.strictEqual(decrypted.toString('utf8'), plaintext);
});

test('EuroMillions key derivation and round-trip', () => {
  const hint = 'euromillions-2026-08-05';
  const numbers = [5, 17, 23, 41, 49];
  const stars = [3, 8];
  const canonical = formatEuroMillions(numbers, stars);
  const plaintext = 'EuroMillions encrypted data';
  const encrypted = encrypt(plaintext, hint, canonical, TEST_SALT);
  const decrypted = decrypt(encrypted, hint, canonical, TEST_SALT);
  assert.strictEqual(decrypted.toString('utf8'), plaintext);
});

// ─── Steganography encode/decode ───────────────────────────────────────────

test('Stego encode/decode round-trip without alpha', () => {
  const width = 64, height = 64;
  const image = createTestImage(width, height);
  const hint = 'quinte-2026-08-04-R1';
  const plaintext = 'Message cache dans les pixels RGBA de la cathedrale.';
  const encrypted = encrypt(plaintext, hint, formatQuinte([7, 3, 12, 5, 9]), TEST_SALT);
  const stegoImage = encodeStego(image, encrypted, { keyHint: hint, useAlpha: false });
  const extracted = decodeStego(stegoImage);

  assert.ok(extracted.found, 'Stego data should be found');
  assert.strictEqual(extracted.keyHint, hint, 'Key hint should match');
  assert.strictEqual(extracted.encrypted, true, 'Data should be marked as encrypted');
  assert.ok(extracted.sha256Match, 'SHA-256 should match');
  assert.deepStrictEqual(extracted.data, encrypted, 'Extracted data should match');
});

test('Stego encode/decode round-trip with alpha', () => {
  const width = 64, height = 64;
  const image = createTestImage(width, height, [0x4a, 0x0a, 0x8a, 0x88]);
  const hint = 'loto-2026-08-04';
  const plaintext = 'Alpha channel also carries data';
  const encrypted = encrypt(plaintext, hint, formatLoto([3, 12, 27, 38, 44], [7]), TEST_SALT);
  const stegoImage = encodeStego(image, encrypted, { keyHint: hint, useAlpha: true });
  const extracted = decodeStego(stegoImage);

  assert.ok(extracted.found);
  assert.strictEqual(extracted.useAlpha, true);
  assert.strictEqual(extracted.keyHint, hint);
  assert.ok(extracted.sha256Match);
});

test('Plain image has no stego data', () => {
  const image = createTestImage(32, 32);
  const extracted = decodeStego(image);
  assert.ok(!extracted.found, 'Plain image should not have stego data');
});

test('Stego preserves image visually (LSB only)', () => {
  const width = 32, height = 32;
  const image = createTestImage(width, height, [0x8a, 0x4a, 0x0a, 0xff]);
  const hint = 'quinte-test';
  const encrypted = encrypt('test', hint, formatQuinte([1, 2, 3, 4, 5]), TEST_SALT);
  const stegoImage = encodeStego(image, encrypted, { keyHint: hint, useAlpha: false });

  // Each pixel should differ by at most 1 in R, G, B
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 4; c++) {
      const diff = Math.abs(stegoImage[i * 4 + c] - image[i * 4 + c]);
      assert.ok(diff <= 1, `Pixel ${i} channel ${c}: diff=${diff} should be <= 1`);
    }
  }
});

test('Image too small for payload throws', () => {
  const image = createTestImage(2, 2); // very small
  const largeData = Buffer.alloc(1000, 0x42);
  assert.throws(() => {
    encodeStego(image, largeData, { keyHint: 'test', useAlpha: false });
  }, 'Should throw when image is too small');
});

// ─── Full pipeline: encrypt → stego → extract → decrypt ────────────────────

test('Full pipeline: quinté → encrypt → stego → extract → decrypt', () => {
  const width = 128, height = 128;
  const image = createTestImage(width, height, [0x0a, 0x8a, 0x8a, 0xff]); // Cyan
  const hint = 'quinte-2026-08-04-R1';
  const numbers = [7, 3, 12, 5, 9];
  const canonical = formatQuinte(numbers);
  const secret = JSON.stringify({
    vault: 'funesterie',
    key: 'NEO4J_PASSWORD',
    hint: 'look behind the cathedral',
  });

  // 1. Encrypt
  const encrypted = encrypt(secret, hint, canonical, TEST_SALT);

  // 2. Embed in image
  const stegoImage = encodeStego(image, encrypted, { keyHint: hint, useAlpha: false, encrypted: true });

  // 3. Extract from image
  const extracted = decodeStego(stegoImage);
  assert.ok(extracted.found, 'Stego data found');
  assert.ok(extracted.sha256Match, 'Integrity verified');
  assert.strictEqual(extracted.keyHint, hint, 'Key hint preserved');

  // 4. Decrypt
  const decrypted = decrypt(extracted.data, extracted.keyHint, canonical, TEST_SALT);
  const result = JSON.parse(decrypted.toString('utf8'));

  assert.strictEqual(result.vault, 'funesterie');
  assert.strictEqual(result.key, 'NEO4J_PASSWORD');
  assert.strictEqual(result.hint, 'look behind the cathedral');
});

test('Key hint generation', () => {
  const hint = generateKeyHint('quinte', 1, new Date('2026-08-04'));
  assert.strictEqual(hint, 'quinte-2026-08-04-R1');

  const lotoHint = generateKeyHint('loto', null, new Date('2026-08-04'));
  assert.strictEqual(lotoHint, 'loto-2026-08-04');

  const euroHint = generateKeyHint('euromillions', null, new Date('2026-08-05'));
  assert.strictEqual(euroHint, 'euromillions-2026-08-05');
});

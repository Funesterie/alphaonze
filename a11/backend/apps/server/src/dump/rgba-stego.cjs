'use strict';
/**
 * RGBA STEGANOGRAPHY — Stéganographie LSB dans les canaux RGBA
 *
 * Cache des données chiffrées dans les bits de poids faible (LSB) des
 * canaux R, G, B, A d'une image PNG. L'image reste visuellement identique
 * à l'originale mais contient des données cachées.
 *
 * Le canal A (alpha/Aγ) suit le canon Funesterie : il porte le poids gamma
 * opératoire. En stéganographie, on peut choisir de ne pas l'utiliser
 * (préserver l'Aγ intact) ou de l'utiliser (plus de capacité).
 *
 * Format de payload stéganographique :
 *   magic        4 bytes   "STG1"
 *   version      1 byte    1
 *   flags        1 byte    bit0 = useAlpha, bit1 = encrypted
 *   keyHintLen   1 byte    longueur du keyHint (identifiant quinté/loterie)
 *   dataLen      4 bytes   LE uint32 — longueur des données chiffrées
 *   sha256Data   32 bytes  SHA-256 des données chiffrées (vérification)
 *   keyHint      variable  identifiant de la course/tirage (UTF-8)
 *   payload      variable  données chiffrées
 *
 * Capacité par pixel :
 *   1 bit par canal × 4 canaux = 4 bits/pixel (si useAlpha)
 *   1 bit par canal × 3 canaux = 3 bits/pixel (sans alpha)
 *   Image 100×100 = 30 000 à 40 000 bits = 3 750 à 5 000 bytes utiles
 */

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MAGIC = Buffer.from('STG1', 'ascii');
const VERSION = 1;
const HEADER_SIZE = 4 + 1 + 1 + 1 + 4 + 32; // = 43 bytes (sans keyHint)
const MAX_KEY_HINT = 200;
const MAX_PAYLOAD = 256 * 1024; // 256 KB max de données chiffrées

// ─── LSB primitives ──────────────────────────────────────────────────────────

/**
 * Set the LSB of a byte.
 * @param {number} byte  — original byte value (0-255)
 * @param {number} bit   — bit to set (0 or 1)
 * @returns {number} modified byte
 */
function setLsb(byte, bit) {
  return (byte & 0xFE) | (bit & 1);
}

/**
 * Get the LSB of a byte.
 * @param {number} byte — byte value (0-255)
 * @returns {number} 0 or 1
 */
function getLsb(byte) {
  return byte & 1;
}

/**
 * Convert a buffer to a bit array.
 * @param {Buffer} buf
 * @returns {number[]} array of 0s and 1s
 */
function bufferToBits(buf) {
  const bits = [];
  for (let i = 0; i < buf.length; i++) {
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((buf[i] >> bit) & 1);
    }
  }
  return bits;
}

/**
 * Convert a bit array to a buffer.
 * @param {number[]} bits
 * @returns {Buffer}
 */
function bitsToBuffer(bits) {
  const len = Math.ceil(bits.length / 8);
  const buf = Buffer.alloc(len);
  for (let i = 0; i < bits.length; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    if (bits[i]) buf[byteIdx] |= (1 << bitIdx);
  }
  return buf;
}

// ─── Capacity calculation ────────────────────────────────────────────────────

/**
 * Calculate the steganographic capacity of an RGBA image.
 * @param {number} width
 * @param {number} height
 * @param {boolean} useAlpha — include the alpha channel
 * @returns {number} capacity in bytes
 */
function calculateCapacity(width, height, useAlpha) {
  const channels = useAlpha ? 4 : 3;
  const totalBits = width * height * channels;
  const usableBits = totalBits - (HEADER_SIZE + MAX_KEY_HINT) * 8;
  return Math.max(0, Math.floor(usableBits / 8));
}

// ─── Encode ─────────────────────────────────────────────────────────────────

/**
 * Embed encrypted data into RGBA pixel data using LSB steganography.
 *
 * @param {Buffer} rgbaData    — raw RGBA pixel data (width * height * 4 bytes)
 * @param {Buffer} encryptedData — data to hide (already encrypted)
 * @param {object} options
 * @param {string} options.keyHint — identifier for the key (e.g., "quinte-2026-08-04-R1")
 * @param {boolean} options.useAlpha — use alpha channel for data (default: false, preserve Aγ)
 * @param {boolean} options.encrypted — data is encrypted (default: true)
 * @returns {Buffer} modified RGBA data with hidden payload
 */
function encodeStego(rgbaData, encryptedData, options) {
  const { keyHint = '', useAlpha = false, encrypted = true } = options;

  if (encryptedData.length > MAX_PAYLOAD) {
    throw new Error(`Payload too large: ${encryptedData.length} > ${MAX_PAYLOAD}`);
  }

  const keyHintBuf = Buffer.from(keyHint, 'utf8');
  if (keyHintBuf.length > MAX_KEY_HINT) {
    throw new Error(`Key hint too long: ${keyHintBuf.length} > ${MAX_KEY_HINT}`);
  }

  // Build the steganographic header
  const flags = (useAlpha ? 0x01 : 0) | (encrypted ? 0x02 : 0);
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header[4] = VERSION;
  header[5] = flags;
  header[6] = keyHintBuf.length;
  header.writeUInt32LE(encryptedData.length, 7);
  crypto.createHash('sha256').update(encryptedData).digest().copy(header, 11);

  // Full payload = header + keyHint + encryptedData
  const fullPayload = Buffer.concat([header, keyHintBuf, encryptedData]);
  const payloadBits = bufferToBits(fullPayload);

  // Check capacity
  const channels = useAlpha ? 4 : 3;
  const maxBits = Math.floor(rgbaData.length / 4) * channels;
  if (payloadBits.length > maxBits) {
    throw new Error(`Image too small: need ${payloadBits.length} bits, have ${maxBits} (${Math.ceil(payloadBits.length / channels)} pixels needed)`);
  }

  // Embed bits into LSBs
  const result = Buffer.from(rgbaData); // copy
  let bitIdx = 0;
  for (let pixelIdx = 0; pixelIdx < rgbaData.length / 4 && bitIdx < payloadBits.length; pixelIdx++) {
    const baseOffset = pixelIdx * 4;
    // R channel
    if (bitIdx < payloadBits.length) {
      result[baseOffset] = setLsb(result[baseOffset], payloadBits[bitIdx++]);
    }
    // G channel
    if (bitIdx < payloadBits.length) {
      result[baseOffset + 1] = setLsb(result[baseOffset + 1], payloadBits[bitIdx++]);
    }
    // B channel
    if (bitIdx < payloadBits.length) {
      result[baseOffset + 2] = setLsb(result[baseOffset + 2], payloadBits[bitIdx++]);
    }
    // A channel (only if useAlpha)
    if (useAlpha && bitIdx < payloadBits.length) {
      result[baseOffset + 3] = setLsb(result[baseOffset + 3], payloadBits[bitIdx++]);
    }
  }

  return result;
}

// ─── Decode ─────────────────────────────────────────────────────────────────

/**
 * Extract hidden data from RGBA pixel data.
 *
 * @param {Buffer} rgbaData — raw RGBA pixel data
 * @returns {object} { found, version, flags, useAlpha, encrypted, keyHint, data, sha256Match }
 */
function readBitsFromImage(rgbaData, numBits, channels) {
  const bits = [];
  for (let i = 0; i < numBits; i++) {
    const pixelIdx = Math.floor(i / channels);
    const channelInPixel = i % channels;
    const offset = pixelIdx * 4 + channelInPixel;
    if (offset >= rgbaData.length) break;
    bits.push(getLsb(rgbaData[offset]));
  }
  return bits;
}

function decodeStego(rgbaData) {
  for (const channels of [3, 4]) {
    const headerBits = readBitsFromImage(rgbaData, HEADER_SIZE * 8, channels);
    const headerBuf = bitsToBuffer(headerBits);
    if (headerBuf.slice(0, 4).toString('ascii') !== MAGIC.toString('ascii')) continue;
    const version = headerBuf[4];
    if (version !== VERSION) continue;
    const flags = headerBuf[5];
    const useAlpha = Boolean(flags & 0x01);
    const encrypted = Boolean(flags & 0x02);
    const keyHintLen = headerBuf[6];
    const dataLen = headerBuf.readUInt32LE(7);
    const sha256Stored = headerBuf.slice(11, 43);
    if (dataLen > MAX_PAYLOAD) continue;
    const effectiveChannels = useAlpha ? 4 : 3;
    if (effectiveChannels !== channels) {
      const reReadBits = readBitsFromImage(rgbaData, HEADER_SIZE * 8, effectiveChannels);
      const reReadBuf = bitsToBuffer(reReadBits);
      if (reReadBuf.slice(0, 4).toString('ascii') !== MAGIC.toString('ascii')) continue;
      const reFlags = reReadBuf[5];
      const reKeyHintLen = reReadBuf[6];
      const reDataLen = reReadBuf.readUInt32LE(7);
      const reSha256 = reReadBuf.slice(11, 43);
      const totalBytes = HEADER_SIZE + reKeyHintLen + reDataLen;
      const allBits = readBitsFromImage(rgbaData, totalBytes * 8, effectiveChannels);
      const fullBuf = bitsToBuffer(allBits);
      const keyHint = fullBuf.slice(HEADER_SIZE, HEADER_SIZE + reKeyHintLen).toString('utf8');
      const data = fullBuf.slice(HEADER_SIZE + reKeyHintLen, HEADER_SIZE + reKeyHintLen + reDataLen);
      const sha256Actual = crypto.createHash('sha256').update(data).digest();
      return { found: true, version, flags: reFlags, useAlpha: Boolean(reFlags & 0x01),
        encrypted: Boolean(reFlags & 0x02), keyHint, data, dataLen: reDataLen,
        sha256Match: sha256Actual.equals(reSha256), sha256Stored: reSha256.toString('hex'),
        sha256Actual: sha256Actual.toString('hex') };
    }
    const totalBytes = HEADER_SIZE + keyHintLen + dataLen;
    const allBits = readBitsFromImage(rgbaData, totalBytes * 8, effectiveChannels);
    const fullBuf = bitsToBuffer(allBits);
    const keyHint = fullBuf.slice(HEADER_SIZE, HEADER_SIZE + keyHintLen).toString('utf8');
    const data = fullBuf.slice(HEADER_SIZE + keyHintLen, HEADER_SIZE + keyHintLen + dataLen);
    const sha256Actual = crypto.createHash('sha256').update(data).digest();
    return { found: true, version, flags, useAlpha, encrypted, keyHint, data, dataLen,
      sha256Match: sha256Actual.equals(sha256Stored), sha256Stored: sha256Stored.toString('hex'),
      sha256Actual: sha256Actual.toString('hex') };
  }
  return { found: false, reason: 'no_stego_magic' };
}
module.exports = {
  MAGIC,
  VERSION,
  HEADER_SIZE,
  MAX_KEY_HINT,
  MAX_PAYLOAD,
  calculateCapacity,
  encodeStego,
  decodeStego,
  // For testing
  setLsb,
  getLsb,
  bufferToBits,
  bitsToBuffer,
};

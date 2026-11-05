'use strict';

const crypto = require('node:crypto');

const MAX_PAYLOAD_BYTES = 64 * 1024;
const DIRECTIONS = new Set(['request', 'response', 'ack']);

function parseKey(input) {
  if (Buffer.isBuffer(input)) {
    if (input.length !== 32) throw new Error('Relay key must be exactly 32 bytes');
    return Buffer.from(input);
  }
  if (typeof input !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    throw new Error('Relay key must be canonical base64');
  }
  const key = Buffer.from(input, 'base64');
  if (key.length !== 32 || key.toString('base64') !== input) {
    throw new Error('Relay key must encode exactly 32 bytes');
  }
  return key;
}

function metadataFor({ version = 1, sessionId, messageId, direction }) {
  if (version !== 1 || typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId) ||
      typeof messageId !== 'string' || !/^[a-f0-9-]{36}$/.test(messageId) ||
      !DIRECTIONS.has(direction)) throw new Error('Invalid relay envelope metadata');
  return { version, sessionId, messageId, direction };
}

function encrypt(keyInput, payload, { sessionId, messageId = crypto.randomUUID(), direction }) {
  const key = parseKey(keyInput);
  const meta = metadataFor({ sessionId, messageId, direction });
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('Payload exceeds 64 KiB');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(meta)));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ...meta,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decrypt(keyInput, envelope, { sessionId, direction }) {
  const key = parseKey(keyInput);
  if (!envelope || envelope.algorithm !== 'aes-256-gcm') throw new Error('Unsupported relay envelope');
  const meta = metadataFor(envelope);
  if (meta.sessionId !== sessionId || meta.direction !== direction) throw new Error('Envelope binding mismatch');
  const nonce = Buffer.from(envelope.nonce || '', 'base64');
  const tag = Buffer.from(envelope.tag || '', 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext || '', 'base64');
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PAYLOAD_BYTES + 32) {
    throw new Error('Malformed relay ciphertext');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(JSON.stringify(meta)));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('Decrypted payload too large');
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { parseKey, encrypt, decrypt, MAX_PAYLOAD_BYTES };
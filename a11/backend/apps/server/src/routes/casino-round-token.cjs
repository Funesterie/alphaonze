const crypto = require('node:crypto');

const ROUND_TOKEN_VERSION = 1;
const ROUND_TOKEN_SECRET_FALLBACK = 'funesterie-casino-rounds';

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function buildRoundTokenKey(secret) {
  return crypto
    .createHash('sha256')
    .update(String(secret || ROUND_TOKEN_SECRET_FALLBACK))
    .digest();
}

function encodeRoundToken(payload, secret) {
  const key = buildRoundTokenKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const serialized = Buffer.from(JSON.stringify({ v: ROUND_TOKEN_VERSION, payload }), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(base64UrlEncode).join('.');
}

function decodeRoundToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    const error = new Error('invalid_round_token');
    error.code = 'invalid_round_token';
    throw error;
  }

  try {
    const [ivPart, tagPart, cipherPart] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      buildRoundTokenKey(secret),
      base64UrlDecode(ivPart)
    );
    decipher.setAuthTag(base64UrlDecode(tagPart));
    const plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(cipherPart)),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext);
    if (Number(parsed?.v) !== ROUND_TOKEN_VERSION || !parsed?.payload) {
      const error = new Error('invalid_round_token');
      error.code = 'invalid_round_token';
      throw error;
    }
    return parsed.payload;
  } catch (error_) {
    const error = new Error('invalid_round_token');
    error.code = 'invalid_round_token';
    error.cause = error_;
    throw error;
  }
}

module.exports = {
  ROUND_TOKEN_SECRET_FALLBACK,
  encodeRoundToken,
  decodeRoundToken,
};

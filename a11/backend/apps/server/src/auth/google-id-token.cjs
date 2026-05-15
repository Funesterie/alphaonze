'use strict';

const nodeCrypto = require('node:crypto');

let cachedKeys = null;
let cachedKeysExpiresAt = 0;

function parseCacheMaxAge(cacheControl) {
  const match = String(cacheControl || '').match(/\bmax-age=(\d+)\b/i);
  const maxAgeSeconds = match ? Number(match[1]) : 3600;
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) return 3600;
  return Math.min(maxAgeSeconds, 24 * 60 * 60);
}

function getGoogleClientIds(env = process.env) {
  return [
    env.GOOGLE_CLIENT_ID,
    env.A11_GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_IDS,
    env.A11_GOOGLE_CLIENT_IDS,
  ]
    .flatMap((value) => String(value || '').split(/[,\s;]+/g))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function fetchGoogleJwks() {
  const now = Date.now();
  if (cachedKeys && cachedKeysExpiresAt > now + 30_000) {
    return cachedKeys;
  }

  if (typeof fetch !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`google_jwks_fetch_failed_${response.status}`);
  }

  const payload = await response.json();
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  cachedKeys = keys;
  cachedKeysExpiresAt = now + (parseCacheMaxAge(response.headers.get('cache-control')) * 1000);
  return keys;
}

function decodeJwtSegment(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function decodeJwtHeader(idToken) {
  const [headerSegment] = String(idToken || '').split('.');
  if (!headerSegment) throw new Error('google_id_token_malformed');
  return decodeJwtSegment(headerSegment);
}

async function verifyGoogleIdToken({ idToken, jwt, clientIds }) {
  const token = String(idToken || '').trim();
  if (!token) throw new Error('missing_google_credential');
  if (!jwt || typeof jwt.verify !== 'function') {
    throw new Error('jwt_verify_unavailable');
  }

  const audiences = Array.isArray(clientIds) ? clientIds.filter(Boolean) : [];
  if (audiences.length === 0) {
    throw new Error('google_auth_not_configured');
  }

  const header = decodeJwtHeader(token);
  const kid = String(header?.kid || '').trim();
  if (!kid) throw new Error('google_id_token_missing_kid');

  const keys = await fetchGoogleJwks();
  const jwk = keys.find((candidate) => candidate?.kid === kid);
  if (!jwk) throw new Error('google_jwk_not_found');

  const publicKey = nodeCrypto.createPublicKey({
    key: jwk,
    format: 'jwk',
  });

  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    audience: audiences,
    issuer: ['accounts.google.com', 'https://accounts.google.com'],
  });
}

module.exports = {
  getGoogleClientIds,
  verifyGoogleIdToken,
};

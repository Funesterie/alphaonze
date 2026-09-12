'use strict';

const crypto = require('node:crypto');

const PREFIX = 'nezq1.';
const AUTH_CONTEXT = 'a11mcp-auth:v1';

function envBool(env, name, fallback = false) {
  const raw = String(env?.[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function envInt(env, name, fallback, min, max) {
  const parsed = Number.parseInt(String(env?.[name] || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function timingSafeEqualStrings(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function resolvePrivateSalt(env = process.env) {
  return String(
    env.STEGO_SALT
    || env.NEZ_QUINTE_BASE_SECRET
    || env.A11_NEZ_TOKEN
    || ''
  ).trim();
}

function normalizeNumbers(value) {
  const parts = String(value || '').trim().split(/[^0-9]+/).filter(Boolean);
  if (parts.length !== 5) return null;
  const normalized = [];
  for (const part of parts) {
    const number = Number.parseInt(part, 10);
    if (!Number.isFinite(number) || number < 1 || number > 99) return null;
    normalized.push(String(number).padStart(2, '0'));
  }
  return normalized.join('-');
}

function parseToken(token) {
  const match = /^nezq1\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/i.exec(String(token || '').trim());
  if (!match) return { ok: false, reason: 'quinte_token_format_invalid' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch (_) {
    return { ok: false, reason: 'quinte_token_payload_invalid' };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'quinte_token_payload_invalid' };
  }

  const keyHint = String(payload.k || '').trim();
  const keyMatch = /^quinte-(\d{4}-\d{2}-\d{2})-R(\d+)$/i.exec(keyHint);
  if (!keyMatch) return { ok: false, reason: 'quinte_token_key_hint_invalid' };

  const numbers = normalizeNumbers(payload.n);
  if (!numbers || numbers !== String(payload.n || '').trim()) {
    return { ok: false, reason: 'quinte_token_numbers_invalid' };
  }

  const publishedAtMs = Date.parse(String(payload.p || ''));
  const validUntilMs = Date.parse(String(payload.e || ''));
  if (!Number.isFinite(publishedAtMs) || !Number.isFinite(validUntilMs)) {
    return { ok: false, reason: 'quinte_token_time_invalid' };
  }

  return {
    ok: true,
    encodedPayload: match[1],
    mac: match[2].toLowerCase(),
    payload: {
      keyHint,
      keyDate: keyMatch[1],
      raceNumber: Number.parseInt(keyMatch[2], 10),
      numbers,
      publishedAt: new Date(publishedAtMs).toISOString(),
      validUntil: new Date(validUntilMs).toISOString(),
      publishedAtMs,
      validUntilMs,
    },
  };
}

function verifyQuinteNezToken(token, env = process.env, nowMs = Date.now()) {
  const enabled = envBool(env, 'NEZ_QUINTE_TOKEN_ENABLED', false);
  const required = envBool(env, 'NEZ_QUINTE_TOKEN_REQUIRED', false);
  if (!enabled) return { enabled, required, valid: false, reason: 'quinte_token_disabled' };

  const parsed = parseToken(token);
  if (!parsed.ok) return { enabled, required, valid: false, reason: parsed.reason };

  const secret = resolvePrivateSalt(env);
  if (!secret) return { enabled, required, valid: false, reason: 'quinte_private_salt_missing' };

  const { payload } = parsed;
  const maxAgeHours = envInt(env, 'NEZ_QUINTE_MAX_AGE_HOURS', 36, 1, 72);
  const maxFutureMinutes = envInt(env, 'NEZ_QUINTE_MAX_FUTURE_MINUTES', 15, 0, 180);

  if (payload.validUntilMs <= payload.publishedAtMs) {
    return { enabled, required, valid: false, reason: 'quinte_token_validity_invalid' };
  }
  if (payload.validUntilMs - payload.publishedAtMs > maxAgeHours * 60 * 60 * 1000) {
    return { enabled, required, valid: false, reason: 'quinte_token_validity_too_long' };
  }
  if (nowMs > payload.validUntilMs) {
    return { enabled, required, valid: false, reason: 'quinte_token_expired' };
  }
  if (payload.publishedAtMs > nowMs + maxFutureMinutes * 60 * 1000) {
    return { enabled, required, valid: false, reason: 'quinte_token_from_future' };
  }
  if (payload.publishedAt.slice(0, 10) !== payload.keyDate) {
    return { enabled, required, valid: false, reason: 'quinte_token_date_mismatch' };
  }

  const fortressRoot = crypto.createHmac('sha256', secret)
    .update(`${payload.keyHint}:${payload.numbers}`)
    .digest();
  const expectedMac = crypto.createHmac('sha256', fortressRoot)
    .update(`${AUTH_CONTEXT}:${parsed.encodedPayload}`)
    .digest('hex');

  if (!timingSafeEqualStrings(parsed.mac, expectedMac)) {
    return { enabled, required, valid: false, reason: 'quinte_token_mac_invalid' };
  }

  return {
    enabled,
    required,
    valid: true,
    reason: 'quinte_nez_token_valid',
    mode: 'nez-quinte-daily',
    keyHint: payload.keyHint,
    publishedAt: payload.publishedAt,
    validUntil: payload.validUntil,
  };
}

function quinteNezTokenStatus(env = process.env) {
  return {
    enabled: envBool(env, 'NEZ_QUINTE_TOKEN_ENABLED', false),
    required: envBool(env, 'NEZ_QUINTE_TOKEN_REQUIRED', false),
    privateSaltConfigured: Boolean(resolvePrivateSalt(env)),
    maxAgeHours: envInt(env, 'NEZ_QUINTE_MAX_AGE_HOURS', 36, 1, 72),
    tokenPrefix: PREFIX,
    rawTokenExposed: false,
  };
}

module.exports = {
  PREFIX,
  AUTH_CONTEXT,
  envBool,
  normalizeNumbers,
  parseToken,
  verifyQuinteNezToken,
  quinteNezTokenStatus,
  resolvePrivateSalt,
};

'use strict';
/**
 * Microsoft Entra (Azure AD) access-token validator for the Funesterie MCP.
 *
 * Server-to-server model (client credentials): a caller (Codex / worker / another
 * service) presents a Bearer token minted by Entra for the MCP API. This module
 * validates that token against the MCP API app registration:
 *   - signature (RS256) via the tenant JWKS (fetched + cached, no extra dependency)
 *   - issuer  === MCP_ISSUER
 *   - audience === MCP_AUDIENCE (api://<mcp-api-client-id>)
 *   - scope/role contains the required MCP scope (MCP_SCOPE, e.g. .../MCP.Access)
 *   - optional allow-lists on the calling app id and on group ids
 *
 * It is INERT unless configured: {@link isEntraMcpConfigured} returns false when the
 * env pack is absent, and {@link verifyEntraAccessToken} then resolves to null so the
 * existing auth chain (static token / OAuth) is unaffected.
 *
 * Never logs secrets or raw tokens. Only masked identifiers are ever emitted.
 *
 * Env pack (values live in secret files / Key Vault, never in git or chat):
 *   MCP_AUTH_PROVIDER=entra
 *   AZURE_TENANT_ID=<tenant guid>
 *   MCP_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
 *   MCP_AUDIENCE=api://<mcp-api-client-id>
 *   MCP_SCOPE=api://<mcp-api-client-id>/MCP.Access
 *   MCP_ALLOWED_CLIENT_IDS=<comma-separated appids allowed to call>   (optional)
 *   MCP_ALLOWED_GROUP_IDS=<comma-separated group object ids>          (optional)
 *   AZURE_AUTHORITY_HOST=https://login.microsoftonline.com            (optional override)
 *   DEV_AUTH_BYPASS=1  -> local dev only, never in prod
 */

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const JWKS_TTL_MS = 60 * 60 * 1000; // cache signing keys for 1h
const JWKS_FETCH_TIMEOUT_MS = 8000;

function envStr(env, name, fallback = '') {
  return String(env[name] == null ? fallback : env[name]).trim();
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function flagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function maskId(value) {
  const str = String(value || '').trim();
  if (!str) return '(unset)';
  if (str.length <= 8) return `${str.slice(0, 2)}***`;
  return `${str.slice(0, 4)}***${str.slice(-4)}`;
}

function getAuthorityHost(env = process.env) {
  return (envStr(env, 'AZURE_AUTHORITY_HOST') || 'https://login.microsoftonline.com').replace(/\/+$/, '');
}

function getEntraMcpConfig(env = process.env) {
  const tenantId = envStr(env, 'AZURE_TENANT_ID');
  const authorityHost = getAuthorityHost(env);
  const issuer = envStr(env, 'MCP_ISSUER')
    || (tenantId ? `${authorityHost}/${tenantId}/v2.0` : '');
  return {
    provider: (envStr(env, 'MCP_AUTH_PROVIDER') || '').toLowerCase(),
    tenantId,
    authorityHost,
    issuer,
    audience: envStr(env, 'MCP_AUDIENCE'),
    scope: envStr(env, 'MCP_SCOPE'),
    allowedClientIds: splitCsv(env.MCP_ALLOWED_CLIENT_IDS),
    allowedGroupIds: splitCsv(env.MCP_ALLOWED_GROUP_IDS),
    devBypass: flagEnabled(env.DEV_AUTH_BYPASS)
      && String(env.NODE_ENV || '').trim().toLowerCase() !== 'production',
  };
}

/** True only when enough of the Entra pack is present to validate a token. */
function isEntraMcpConfigured(env = process.env) {
  const cfg = getEntraMcpConfig(env);
  if (cfg.provider && cfg.provider !== 'entra') return false;
  return Boolean(cfg.issuer && cfg.audience);
}

// ─── JWKS cache (per issuer) ───────────────────────────────────────────────
const jwksCache = new Map(); // issuer -> { fetchedAt, keys: Map<kid, KeyObject> }

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveJwksUri(cfg) {
  // Prefer OIDC discovery so tenant-specific / sovereign clouds work, fall back to the
  // well-known Entra v2 keys endpoint.
  try {
    const discovery = await fetchJson(`${cfg.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
    if (discovery && discovery.jwks_uri) return String(discovery.jwks_uri);
  } catch {
    // fall through to constructed endpoint
  }
  if (cfg.tenantId) return `${cfg.authorityHost}/${cfg.tenantId}/discovery/v2.0/keys`;
  throw new Error('jwks_uri_unresolved');
}

async function getSigningKey(cfg, kid) {
  const cached = jwksCache.get(cfg.issuer);
  const fresh = cached && (Date.now() - cached.fetchedAt) < JWKS_TTL_MS;
  if (fresh && cached.keys.has(kid)) return cached.keys.get(kid);

  const jwksUri = await resolveJwksUri(cfg);
  const jwks = await fetchJson(jwksUri);
  const keys = new Map();
  for (const jwk of (jwks && Array.isArray(jwks.keys) ? jwks.keys : [])) {
    if (!jwk || !jwk.kid || (jwk.kty && jwk.kty !== 'RSA')) continue;
    try {
      keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    } catch {
      // skip malformed keys
    }
  }
  jwksCache.set(cfg.issuer, { fetchedAt: Date.now(), keys });
  return keys.get(kid) || null;
}

function scopeSatisfied(payload, requiredScope) {
  if (!requiredScope) return true;
  // Delegated tokens carry space-delimited `scp`; app-permission tokens carry `roles`.
  const required = requiredScope.split('/').pop(); // short name, e.g. "MCP.Access"
  const scopes = new Set([
    ...String(payload.scp || '').split(/\s+/).filter(Boolean),
    ...(Array.isArray(payload.roles) ? payload.roles : []),
  ]);
  return scopes.has(requiredScope) || scopes.has(required);
}

/**
 * Validate an Entra-issued access token for the MCP.
 * @returns {Promise<object|null>} the decoded payload when valid, else null.
 */
async function verifyEntraAccessToken(token, env = process.env) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const cfg = getEntraMcpConfig(env);
  if (cfg.devBypass) {
    return { sub: 'dev-bypass', mode: 'dev-bypass', appid: 'dev', scp: cfg.scope || 'dev' };
  }
  if (!isEntraMcpConfigured(env)) return null;

  let header;
  try {
    const decoded = jwt.decode(raw, { complete: true });
    header = decoded && decoded.header;
  } catch {
    return null;
  }
  if (!header || header.alg !== 'RS256' || !header.kid) return null; // reject none/HS/unsigned

  let key;
  try {
    key = await getSigningKey(cfg, header.kid);
  } catch {
    return null;
  }
  if (!key) return null;

  let payload;
  try {
    payload = jwt.verify(raw, key, {
      algorithms: ['RS256'],
      issuer: cfg.issuer,
      audience: cfg.audience,
      clockTolerance: 60,
    });
  } catch {
    return null;
  }

  if (!scopeSatisfied(payload, cfg.scope)) return null;

  if (cfg.allowedClientIds.length) {
    const caller = String(payload.azp || payload.appid || '').trim();
    if (!caller || !cfg.allowedClientIds.includes(caller)) return null;
  }
  if (cfg.allowedGroupIds.length) {
    const groups = Array.isArray(payload.groups) ? payload.groups.map(String) : [];
    if (!groups.some((g) => cfg.allowedGroupIds.includes(g))) return null;
  }
  return payload;
}

/** Masked, secret-free view of the Entra config for startup diagnostics. */
function describeEntraMcpConfig(env = process.env) {
  const cfg = getEntraMcpConfig(env);
  return {
    configured: isEntraMcpConfigured(env),
    provider: cfg.provider || '(unset)',
    tenantId: maskId(cfg.tenantId),
    issuer: cfg.issuer || '(unset)',
    audience: cfg.audience || '(unset)',
    scope: cfg.scope || '(unset)',
    allowedClientIds: cfg.allowedClientIds.map(maskId),
    allowedGroupIds: cfg.allowedGroupIds.length,
    devBypass: cfg.devBypass,
  };
}

module.exports = {
  getEntraMcpConfig,
  isEntraMcpConfigured,
  verifyEntraAccessToken,
  describeEntraMcpConfig,
  maskId,
};

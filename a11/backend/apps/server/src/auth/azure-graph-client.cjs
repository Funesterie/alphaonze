'use strict';
/**
 * Microsoft Entra client-credentials helper for server-to-server calls to
 * Microsoft Graph (or any Azure API supporting the .default scope).
 *
 * The client secret is read from an env var OR a secret file (same pattern as the
 * other Funesterie providers), so it can live in a mounted secret / Key Vault CSI
 * file and never has to appear in git, compose files, or chat.
 *
 * Access tokens are cached in-memory until shortly before expiry. The secret and
 * the raw token are never logged.
 *
 * Env:
 *   AZURE_TENANT_ID=<tenant guid>
 *   AZURE_CLIENT_ID=<client (application) id>
 *   AZURE_CLIENT_SECRET=<value>            (prefer AZURE_CLIENT_SECRET_FILE)
 *   AZURE_CLIENT_SECRET_FILE=/app/runtime/secrets/azure_client_secret
 *   AZURE_AUTHORITY_HOST=https://login.microsoftonline.com   (optional)
 *   MS_GRAPH_SCOPE=https://graph.microsoft.com/.default       (optional)
 */

const fs = require('node:fs');
const path = require('node:path');

function readFirstSecretValue(fileCandidates = [], envCandidates = [], env = process.env) {
  for (const candidate of fileCandidates.filter(Boolean)) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // secret file is optional
    }
  }
  for (const name of envCandidates.filter(Boolean)) {
    const value = String(env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function getClientSecret(env = process.env) {
  return readFirstSecretValue(
    [env.AZURE_CLIENT_SECRET_FILE, '/app/runtime/secrets/azure_client_secret'],
    ['AZURE_CLIENT_SECRET'],
    env
  );
}

function getAzureGraphConfig(env = process.env) {
  const authorityHost = (String(env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com').trim()).replace(/\/+$/, '');
  return {
    tenantId: String(env.AZURE_TENANT_ID || '').trim(),
    clientId: String(env.AZURE_CLIENT_ID || '').trim(),
    authorityHost,
    scope: String(env.MS_GRAPH_SCOPE || 'https://graph.microsoft.com/.default').trim(),
    hasSecret: Boolean(getClientSecret(env)),
  };
}

function isAzureGraphConfigured(env = process.env) {
  const cfg = getAzureGraphConfig(env);
  return Boolean(cfg.tenantId && cfg.clientId && cfg.hasSecret);
}

// token cache keyed by tenant+client+scope
const tokenCache = new Map();

/**
 * Acquire an app-only Graph access token via the client-credentials grant.
 * @returns {Promise<{ accessToken: string, expiresAt: number }>}
 */
async function getGraphToken(env = process.env, options = {}) {
  const cfg = getAzureGraphConfig(env);
  const scope = String(options.scope || cfg.scope).trim();
  if (!cfg.tenantId || !cfg.clientId) throw new Error('azure_graph_not_configured');
  const secret = getClientSecret(env);
  if (!secret) throw new Error('azure_client_secret_missing');

  const cacheKey = `${cfg.tenantId}|${cfg.clientId}|${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return { accessToken: cached.accessToken, expiresAt: cached.expiresAt };
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: secret,
    scope,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.AZURE_TOKEN_TIMEOUT_MS || 10_000));
  let payload;
  try {
    const res = await fetch(`${cfg.authorityHost}/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      // payload.error_description can be long but never contains our secret
      throw new Error(`azure_token_http_${res.status}:${String(payload.error || 'error')}`);
    }
  } finally {
    clearTimeout(timer);
  }

  const accessToken = String(payload.access_token || '');
  if (!accessToken) throw new Error('azure_token_missing');
  const expiresAt = Date.now() + (Number(payload.expires_in || 3600) * 1000);
  tokenCache.set(cacheKey, { accessToken, expiresAt });
  return { accessToken, expiresAt };
}

/** Masked, secret-free view for startup diagnostics. */
function describeAzureGraphConfig(env = process.env) {
  const cfg = getAzureGraphConfig(env);
  const mask = (v) => {
    const s = String(v || '').trim();
    if (!s) return '(unset)';
    return s.length <= 8 ? `${s.slice(0, 2)}***` : `${s.slice(0, 4)}***${s.slice(-4)}`;
  };
  return {
    configured: isAzureGraphConfigured(env),
    tenantId: mask(cfg.tenantId),
    clientId: mask(cfg.clientId),
    scope: cfg.scope,
    secretPresent: cfg.hasSecret,
  };
}

module.exports = {
  getAzureGraphConfig,
  isAzureGraphConfigured,
  getGraphToken,
  describeAzureGraphConfig,
};

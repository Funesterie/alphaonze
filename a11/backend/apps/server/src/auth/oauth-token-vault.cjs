'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'funesterie.oauth-token-vault.v1';

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeProvider(value = '') {
  const normalized = cleanText(value).toLowerCase();
  if (['google', 'google-drive', 'drive'].includes(normalized)) return 'google';
  if (['microsoft', 'ms', 'azure', 'onedrive', 'one-drive'].includes(normalized)) return 'microsoft';
  return '';
}

function resolveVaultFile(filePath = '') {
  const explicit = cleanText(filePath || process.env.A11_OAUTH_TOKEN_VAULT_FILE || process.env.OAUTH_TOKEN_VAULT_FILE);
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  const runtimeRoot = cleanText(process.env.A11_RUNTIME_ROOT);
  const root = runtimeRoot
    ? (path.isAbsolute(runtimeRoot) ? runtimeRoot : path.resolve(process.cwd(), runtimeRoot))
    : path.join(process.cwd(), 'runtime');
  return path.join(root, 'auth', 'oauth-token-vault.json');
}

function deriveKey(secret = '') {
  const resolvedSecret = cleanText(secret || process.env.JWT_SECRET || process.env.A11_OAUTH_TOKEN_VAULT_SECRET);
  if (!resolvedSecret) {
    const error = new Error('oauth_token_vault_secret_missing');
    error.code = 'oauth_token_vault_secret_missing';
    throw error;
  }
  return crypto
    .createHash('sha256')
    .update(`${SCHEMA}|${resolvedSecret}`)
    .digest();
}

function readVaultState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { schema: SCHEMA, records: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      schema: SCHEMA,
      records: parsed && typeof parsed.records === 'object' && parsed.records ? parsed.records : {},
    };
  } catch {
    return { schema: SCHEMA, records: {} };
  }
}

function writeVaultState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify({
    schema: SCHEMA,
    records: state && typeof state.records === 'object' && state.records ? state.records : {},
    updatedAt: new Date().toISOString(),
  }, null, 2);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, filePath);
}

function buildRecordKey(sessionId = '', provider = '') {
  const sid = cleanText(sessionId);
  const normalizedProvider = normalizeProvider(provider);
  if (!sid) {
    const error = new Error('oauth_token_vault_session_missing');
    error.code = 'oauth_token_vault_session_missing';
    throw error;
  }
  if (!normalizedProvider) {
    const error = new Error('oauth_token_vault_provider_invalid');
    error.code = 'oauth_token_vault_provider_invalid';
    throw error;
  }
  return `${sid}:${normalizedProvider}`;
}

function normalizeExpiresAt(tokens = {}, now = new Date()) {
  const explicit = cleanText(tokens.expires_at || tokens.expiresAt);
  if (explicit) {
    const parsed = new Date(explicit);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const expiresIn = Number(tokens.expires_in ?? tokens.expiresIn ?? 0);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(now.getTime() + expiresIn * 1000).toISOString();
  }
  return '';
}

function encryptPayload(payload, { key, aad }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptPayload(record, { key, aad }) {
  if (!record || record.alg !== 'aes-256-gcm') return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

function createOAuthTokenVault({ filePath, secret, now = () => new Date(), logger = console } = {}) {
  const vaultFile = resolveVaultFile(filePath);

  function getKey() {
    return deriveKey(secret);
  }

  async function getSessionProviderTokens({ sessionId, provider } = {}) {
    const recordKey = buildRecordKey(sessionId, provider);
    const state = readVaultState(vaultFile);
    const record = state.records[recordKey];
    if (!record) return null;
    try {
      return decryptPayload(record.sealed || record, {
        key: getKey(),
        aad: recordKey,
      });
    } catch (error) {
      logger?.warn?.('[AUTH] OAuth token vault decrypt failed:', error?.message);
      return null;
    }
  }

  async function storeSessionProviderTokens({ sessionId, provider, account, tokens = {}, oauthScopes, oauthScopeProfile } = {}) {
    const recordKey = buildRecordKey(sessionId, provider);
    const normalizedProvider = normalizeProvider(provider);
    const existing = await getSessionProviderTokens({ sessionId, provider: normalizedProvider }).catch(() => null);
    const accessToken = cleanText(tokens.access_token || tokens.accessToken) || existing?.accessToken || '';
    const refreshToken = cleanText(tokens.refresh_token || tokens.refreshToken) || existing?.refreshToken || '';
    if (!accessToken && !refreshToken) return null;

    const scope = cleanText(tokens.scope || (Array.isArray(oauthScopes) ? oauthScopes.join(' ') : oauthScopes) || existing?.scope);
    const payload = {
      provider: normalizedProvider,
      sessionId: cleanText(sessionId),
      account: cleanText(account || existing?.account).slice(0, 200),
      accessToken,
      refreshToken,
      tokenType: cleanText(tokens.token_type || tokens.tokenType || existing?.tokenType || 'Bearer'),
      expiresAt: normalizeExpiresAt(tokens, now()) || existing?.expiresAt || '',
      scope,
      oauthScopeProfile: cleanText(oauthScopeProfile || existing?.oauthScopeProfile).slice(0, 64),
      updatedAt: now().toISOString(),
    };

    const state = readVaultState(vaultFile);
    state.records[recordKey] = {
      provider: normalizedProvider,
      sessionId: cleanText(sessionId),
      account: payload.account || undefined,
      scopeHash: scope ? crypto.createHash('sha256').update(scope).digest('hex').slice(0, 16) : undefined,
      sealed: encryptPayload(payload, {
        key: getKey(),
        aad: recordKey,
      }),
      updatedAt: payload.updatedAt,
    };
    writeVaultState(vaultFile, state);
    return {
      ok: true,
      provider: normalizedProvider,
      sessionId: cleanText(sessionId),
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
      expiresAt: payload.expiresAt || null,
    };
  }

  async function deleteSessionProviderTokens({ sessionId, provider } = {}) {
    const recordKey = buildRecordKey(sessionId, provider);
    const state = readVaultState(vaultFile);
    const existed = Boolean(state.records[recordKey]);
    delete state.records[recordKey];
    writeVaultState(vaultFile, state);
    return { ok: true, deleted: existed };
  }

  return {
    filePath: vaultFile,
    getSessionProviderTokens,
    storeSessionProviderTokens,
    deleteSessionProviderTokens,
  };
}

module.exports = {
  createOAuthTokenVault,
  normalizeProvider,
  resolveVaultFile,
};

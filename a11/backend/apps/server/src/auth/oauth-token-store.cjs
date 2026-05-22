'use strict';

const crypto = require('node:crypto');

const TOKEN_CIPHER_VERSION = 'a11-oauth-v1';

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveOAuthTokenEncryptionSecret({ env = process.env, jwtSecret = '' } = {}) {
  return normalizeText(
    env.A11_OAUTH_TOKEN_ENCRYPTION_KEY
    || env.OAUTH_TOKEN_ENCRYPTION_KEY
    || env.A11_TOKEN_VAULT_KEY
    || jwtSecret
  );
}

function deriveKey(secret) {
  const normalized = normalizeText(secret);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest();
}

function encryptOAuthToken(value, secret) {
  const token = normalizeText(value);
  if (!token) return null;
  const key = deriveKey(secret);
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(TOKEN_CIPHER_VERSION));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_CIPHER_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decryptOAuthToken(sealed, secret) {
  const raw = normalizeText(sealed);
  const key = deriveKey(secret);
  if (!raw || !key) return '';
  const [version, ivB64, tagB64, encryptedB64] = raw.split('.');
  if (version !== TOKEN_CIPHER_VERSION || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error('invalid_oauth_token_ciphertext');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(Buffer.from(TOKEN_CIPHER_VERSION));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function hashSecret(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function resolveExpiry(tokens = {}) {
  const expiresIn = Number(tokens.expires_in || tokens.expiresIn || 0);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return new Date(Date.now() + Math.max(1, Math.floor(expiresIn)) * 1000);
}

function providerSubject(provider, profile = {}) {
  if (provider === 'google') return normalizeText(profile.sub || profile.id);
  if (provider === 'microsoft') return normalizeText(profile.id || profile.sub || profile.oid);
  return normalizeText(profile.sub || profile.id);
}

function buildSafeMetadata(provider, profile = {}, tokens = {}) {
  return {
    provider,
    providerSubject: providerSubject(provider, profile) || null,
    tokenType: normalizeText(tokens.token_type || tokens.tokenType || 'Bearer') || 'Bearer',
    hasAccessToken: Boolean(normalizeText(tokens.access_token)),
    hasRefreshToken: Boolean(normalizeText(tokens.refresh_token)),
    hasIdToken: Boolean(normalizeText(tokens.id_token)),
  };
}

async function ensureOAuthTokenTable(db) {
  if (!db || typeof db.query !== 'function') return { ok: false, skipped: true };
  await db.query(`
    CREATE TABLE IF NOT EXISTS oauth_connection_tokens (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_subject TEXT,
      email TEXT,
      scope TEXT,
      token_type TEXT DEFAULT 'Bearer',
      access_token_enc TEXT,
      refresh_token_enc TEXT,
      id_token_hash TEXT,
      expires_at TIMESTAMP,
      metadata_json JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, provider)
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_oauth_connection_tokens_provider_subject ON oauth_connection_tokens (provider, provider_subject)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_oauth_connection_tokens_user_updated ON oauth_connection_tokens (user_id, updated_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_oauth_connection_tokens_expires ON oauth_connection_tokens (expires_at)');
  return { ok: true };
}

async function upsertOAuthConnectionTokens({
  db,
  provider,
  user,
  profile,
  tokens,
  encryptionSecret,
  logger = console,
} = {}) {
  if (!db || typeof db.query !== 'function') return { ok: false, skipped: true, reason: 'db_unavailable' };

  const normalizedProvider = normalizeText(provider).toLowerCase();
  const userId = normalizeText(user?.id);
  const email = normalizeText(user?.email || profile?.email || profile?.mail || profile?.userPrincipalName || profile?.preferred_username).toLowerCase();
  if (!normalizedProvider || !userId) return { ok: false, skipped: true, reason: 'missing_identity' };

  const secret = resolveOAuthTokenEncryptionSecret({ jwtSecret: encryptionSecret });
  if (!secret) return { ok: false, skipped: true, reason: 'missing_encryption_secret' };

  const accessTokenEnc = encryptOAuthToken(tokens?.access_token, secret);
  const refreshTokenEnc = encryptOAuthToken(tokens?.refresh_token, secret);
  if (!accessTokenEnc && !refreshTokenEnc) return { ok: false, skipped: true, reason: 'no_provider_tokens' };

  const metadata = buildSafeMetadata(normalizedProvider, profile, tokens);
  const params = [
    userId,
    normalizedProvider,
    providerSubject(normalizedProvider, profile) || null,
    email || null,
    normalizeText(tokens?.scope) || null,
    normalizeText(tokens?.token_type || tokens?.tokenType || 'Bearer') || 'Bearer',
    accessTokenEnc,
    refreshTokenEnc,
    hashSecret(tokens?.id_token),
    resolveExpiry(tokens),
    metadata,
  ];

  try {
    await db.query(`
      INSERT INTO oauth_connection_tokens (
        user_id,
        provider,
        provider_subject,
        email,
        scope,
        token_type,
        access_token_enc,
        refresh_token_enc,
        id_token_hash,
        expires_at,
        metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (user_id, provider)
      DO UPDATE SET
        provider_subject = EXCLUDED.provider_subject,
        email = EXCLUDED.email,
        scope = COALESCE(EXCLUDED.scope, oauth_connection_tokens.scope),
        token_type = EXCLUDED.token_type,
        access_token_enc = COALESCE(EXCLUDED.access_token_enc, oauth_connection_tokens.access_token_enc),
        refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, oauth_connection_tokens.refresh_token_enc),
        id_token_hash = COALESCE(EXCLUDED.id_token_hash, oauth_connection_tokens.id_token_hash),
        expires_at = EXCLUDED.expires_at,
        metadata_json = EXCLUDED.metadata_json,
        updated_at = NOW()
    `, params);
    return {
      ok: true,
      provider: normalizedProvider,
      userId,
      hasAccessToken: Boolean(accessTokenEnc),
      hasRefreshToken: Boolean(refreshTokenEnc),
    };
  } catch (error) {
    logger?.warn?.('[AUTH] OAuth token vault skipped:', error?.message || error);
    return { ok: false, skipped: true, reason: 'db_write_failed' };
  }
}

async function listOAuthConnections(db, userId) {
  if (!db || typeof db.query !== 'function') return [];
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return [];
  const { rows } = await db.query(`
    SELECT provider, provider_subject, email, scope, token_type,
           access_token_enc IS NOT NULL AS has_access_token,
           refresh_token_enc IS NOT NULL AS has_refresh_token,
           expires_at, created_at, updated_at
    FROM oauth_connection_tokens
    WHERE user_id = $1
    ORDER BY updated_at DESC
  `, [normalizedUserId]);
  return rows.map((row) => ({
    provider: row.provider,
    providerSubject: row.provider_subject || null,
    email: row.email || null,
    scope: row.scope || null,
    tokenType: row.token_type || 'Bearer',
    hasAccessToken: row.has_access_token === true,
    hasRefreshToken: row.has_refresh_token === true,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));
}

module.exports = {
  decryptOAuthToken,
  encryptOAuthToken,
  ensureOAuthTokenTable,
  listOAuthConnections,
  resolveOAuthTokenEncryptionSecret,
  upsertOAuthConnectionTokens,
};

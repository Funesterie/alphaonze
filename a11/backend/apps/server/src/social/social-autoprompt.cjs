'use strict';

const crypto = require('node:crypto');

const SOCIAL_SCHEMA_VERSION = 'funesterie.social-autoprompt.v1';
const YOUTUBE_PUBLIC_CONTEXT_MIGRATION = '2026-08-11-youtube-public-context-v1';
const YOUTUBE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_PUBLIC_FEED_URL = 'https://www.youtube.com/feeds/videos.xml';
const YOUTUBE_PUBLIC_FEED_HOSTS = ['www.youtube.com', 'youtube.com'];
const META_AUTH_URL = 'https://www.facebook.com/v22.0/dialog/oauth';
const META_TOKEN_URL = 'https://graph.facebook.com/v22.0/oauth/access_token';
const SOUNDCLOUD_AUTH_URL = 'https://secure.soundcloud.com/authorize';
const SOUNDCLOUD_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
const SOUNDCLOUD_API_BASE = 'https://api.soundcloud.com';
const DEFAULT_SOCIAL_RSS_ALLOWED_HOSTS = ['feeds.soundcloud.com', 'soundcloud.com', 'www.soundcloud.com'];

/**
 * Perimetres YouTube.
 *
 * `youtube.upload` ajoute le 11/08/2026 : sans lui, `videos.insert` repond 403
 * `insufficientPermissions` (voir src/social/youtube-upload.cjs). Il est
 * *sensible*, pas *restreint* — il n'entraine donc pas l'evaluation de securite
 * par un tiers qu'imposerait un perimetre restreint comme gmail.readonly.
 *
 * A savoir, et ce n'est pas une question de perimetre : tout envoi depuis un
 * projet API non audite est VERROUILLE EN PRIVE par YouTube. L'audit de
 * conformite YouTube est distinct de la verification OAuth.
 *
 * Un jeton emis avant cet ajout ne porte pas le nouveau perimetre : il faut
 * reconsentir, sinon l'envoi echoue avec un jeton pourtant valide.
 */
const DEFAULT_YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
];

const DEFAULT_META_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
];

const DEFAULT_SOUNDCLOUD_SCOPES = [];

function cleanText(value = '', fallbackOrMax = 2000, maybeMax = undefined) {
  const fallback = typeof fallbackOrMax === 'string' ? fallbackOrMax : '';
  const max = typeof fallbackOrMax === 'number'
    ? fallbackOrMax
    : Number.isFinite(Number(maybeMax)) ? Number(maybeMax) : 2000;
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || fallback;
}

function cleanOneLine(value = '', fallback = '', max = 240) {
  return cleanText(value, max) || fallback;
}

function foldForLookup(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeProvider(value = '') {
  const normalized = foldForLookup(value).replace(/[^a-z0-9]+/g, '');
  if (['youtube', 'yt', 'googleyoutube'].includes(normalized)) return 'youtube';
  if (['meta', 'facebook', 'fb', 'instagram', 'ig'].includes(normalized)) return 'meta';
  if (['soundcloud'].includes(normalized)) return 'soundcloud';
  if (['soundcloudrss', 'soundcloudfeed', 'scrss'].includes(normalized)) return 'soundcloud_rss';
  if (['amazonmusic', 'amazon'].includes(normalized)) return 'amazon_music';
  return '';
}

function normalizeKind(value = '') {
  const normalized = foldForLookup(value);
  if (/clip|video|vid[ée]o/.test(normalized)) return 'clip';
  if (/post|publication/.test(normalized)) return 'post';
  if (/description|desc/.test(normalized)) return 'description';
  if (/hash|tag/.test(normalized)) return 'hashtag';
  return 'chanson';
}

function splitList(value = '') {
  if (Array.isArray(value)) return value.map((entry) => cleanText(entry, 180)).filter(Boolean);
  return String(value || '')
    .split(/[,\s]+/g)
    .map((entry) => cleanText(entry, 180))
    .filter(Boolean);
}

function splitScopes(value = '') {
  if (Array.isArray(value)) return value.map((entry) => cleanText(entry, 240)).filter(Boolean);
  return String(value || '').split(/[,\s]+/g).map((entry) => cleanText(entry, 240)).filter(Boolean);
}

function unique(values = [], max = 20) {
  const seen = new Set();
  const output = [];
  for (const raw of values) {
    const value = cleanText(raw, 260);
    if (!value) continue;
    const key = foldForLookup(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

function splitCsv(value = '') {
  if (Array.isArray(value)) return value.map((entry) => cleanText(entry, 240)).filter(Boolean);
  return String(value || '')
    .split(/[,\n]+/g)
    .map((entry) => cleanText(entry, 240))
    .filter(Boolean);
}

function clampNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getBaseUrl(req) {
  const configured = cleanText(
    process.env.SOCIAL_PUBLIC_BASE_URL
    || process.env.PUBLIC_API_URL
    || process.env.VIVY_PUBLIC_BASE_URL
    || process.env.APP_URL
    || '',
    500
  ).replace(/\/+$/, '');
  if (configured) return configured;
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https').split(',')[0].trim() || 'https';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : 'https://funesterie.me';
}

function firstEnv(env = process.env, names = []) {
  for (const name of names) {
    const value = cleanText(env?.[name], 2000);
    if (value) return value;
  }
  return '';
}

function resolveProviderConfig(provider, { env = process.env, req = null } = {}) {
  const normalized = normalizeProvider(provider);
  if (normalized === 'youtube') {
    const redirectUri = firstEnv(env, [
      'SOCIAL_YOUTUBE_REDIRECT_URI',
      'SOCIAL_YOUTUBE_CALLBACK_URL',
      'YOUTUBE_REDIRECT_URI',
    ]) || `${getBaseUrl(req)}/api/admin/social-connect/youtube/callback`;
    const requestedScopes = splitScopes(firstEnv(env, ['SOCIAL_YOUTUBE_SCOPES', 'YOUTUBE_OAUTH_SCOPES']));
    const uniqueScopes = unique([...requestedScopes, ...DEFAULT_YOUTUBE_SCOPES], 16)
      .filter((scope) => DEFAULT_YOUTUBE_SCOPES.includes(scope));
    const clientId = firstEnv(env, ['SOCIAL_YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_ID']);
    const clientSecret = firstEnv(env, ['SOCIAL_YOUTUBE_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET']);
    return {
      provider: 'youtube',
      configured: Boolean(clientId && clientSecret && redirectUri),
      clientId,
      clientSecret,
      redirectUri,
      scopes: uniqueScopes,
      missing: [
        clientId ? '' : 'SOCIAL_YOUTUBE_CLIENT_ID',
        clientSecret ? '' : 'SOCIAL_YOUTUBE_CLIENT_SECRET',
        redirectUri ? '' : 'SOCIAL_YOUTUBE_REDIRECT_URI',
      ].filter(Boolean),
    };
  }
  if (normalized === 'meta') {
    const redirectUri = firstEnv(env, [
      'SOCIAL_META_REDIRECT_URI',
      'SOCIAL_META_CALLBACK_URL',
      'META_REDIRECT_URI',
    ]) || `${getBaseUrl(req)}/api/admin/social-connect/meta/callback`;
    const scopes = splitScopes(firstEnv(env, ['SOCIAL_META_SCOPES', 'META_OAUTH_SCOPES']))
      .concat(DEFAULT_META_SCOPES);
    const appId = firstEnv(env, ['SOCIAL_META_APP_ID', 'META_APP_ID', 'FACEBOOK_APP_ID']);
    const appSecret = firstEnv(env, ['SOCIAL_META_APP_SECRET', 'META_APP_SECRET', 'FACEBOOK_APP_SECRET']);
    return {
      provider: 'meta',
      configured: Boolean(appId && appSecret && redirectUri),
      clientId: appId,
      clientSecret: appSecret,
      redirectUri,
      scopes: unique(scopes, 16),
      missing: [
        appId ? '' : 'SOCIAL_META_APP_ID',
        appSecret ? '' : 'SOCIAL_META_APP_SECRET',
        redirectUri ? '' : 'SOCIAL_META_REDIRECT_URI',
      ].filter(Boolean),
    };
  }
  if (normalized === 'soundcloud') {
    const redirectUri = firstEnv(env, [
      'SOCIAL_SOUNDCLOUD_REDIRECT_URI',
      'SOCIAL_SOUNDCLOUD_CALLBACK_URL',
      'SOUNDCLOUD_REDIRECT_URI',
    ]) || `${getBaseUrl(req)}/api/admin/social-connect/soundcloud/callback`;
    const scopes = splitScopes(firstEnv(env, ['SOCIAL_SOUNDCLOUD_SCOPES', 'SOUNDCLOUD_OAUTH_SCOPES']))
      .concat(DEFAULT_SOUNDCLOUD_SCOPES);
    const clientId = firstEnv(env, ['SOCIAL_SOUNDCLOUD_CLIENT_ID', 'SOUNDCLOUD_CLIENT_ID']);
    const clientSecret = firstEnv(env, ['SOCIAL_SOUNDCLOUD_CLIENT_SECRET', 'SOUNDCLOUD_CLIENT_SECRET']);
    const envAccessToken = firstEnv(env, ['SOCIAL_SOUNDCLOUD_ACCESS_TOKEN', 'SOUNDCLOUD_ACCESS_TOKEN']);
    const envRefreshToken = firstEnv(env, ['SOCIAL_SOUNDCLOUD_REFRESH_TOKEN', 'SOUNDCLOUD_REFRESH_TOKEN']);
    return {
      provider: 'soundcloud',
      configured: Boolean(clientId && clientSecret && redirectUri),
      clientId,
      clientSecret,
      redirectUri,
      scopes: unique(scopes, 16),
      envTokenConfigured: Boolean(envAccessToken || envRefreshToken),
      missing: [
        clientId ? '' : 'SOCIAL_SOUNDCLOUD_CLIENT_ID',
        clientSecret ? '' : 'SOCIAL_SOUNDCLOUD_CLIENT_SECRET',
        redirectUri ? '' : 'SOCIAL_SOUNDCLOUD_REDIRECT_URI',
      ].filter(Boolean),
    };
  }
  return { provider: normalized || cleanText(provider, '', 40), configured: false, missing: ['provider_unsupported'] };
}

function socialKeyMaterial(env = process.env) {
  const secret = cleanText(env.SOCIAL_TOKEN_ENC_KEY || env.A11_SOCIAL_TOKEN_ENC_KEY || '', 4000);
  if (!secret) {
    const error = new Error('social_token_enc_key_missing');
    error.code = 'social_token_enc_key_missing';
    throw error;
  }
  return crypto.createHash('sha256').update(`${SOCIAL_SCHEMA_VERSION}|${secret}`).digest();
}

function sealJson(payload, aad, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', socialKeyMaterial(env), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload || {}), 'utf8'),
    cipher.final(),
  ]);
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function openJson(sealed, aad, env = process.env) {
  if (!sealed || sealed.alg !== 'aes-256-gcm') return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', socialKeyMaterial(env), Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(sealed.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

function accountAad(account = {}) {
  return `social:${cleanText(account.user_id || account.userId, 'unknown', 160)}:${normalizeProvider(account.provider)}:${cleanText(account.account_external_id || account.accountExternalId || account.provider, 'account', 180)}`;
}

async function runSocialDataMigrations(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_data_migrations (
      migration_key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Une requete PostgreSQL unique est atomique. La cle primaire departage les
  // processus concurrents: seul celui qui obtient claimed_migration purge les
  // donnees historiques, et le marqueur est annule avec les DELETE si une
  // etape echoue.
  const result = await db.query(`
    WITH claimed_migration AS (
      INSERT INTO social_data_migrations (migration_key, applied_at)
      VALUES ($1, NOW())
      ON CONFLICT (migration_key) DO NOTHING
      RETURNING migration_key
    ), deleted_youtube_items AS (
      DELETE FROM social_items
      WHERE provider = 'youtube'
        AND EXISTS (SELECT 1 FROM claimed_migration)
      RETURNING 1
    ), deleted_youtube_snapshots AS (
      DELETE FROM social_context_snapshots
      WHERE provider = 'youtube'
        AND EXISTS (SELECT 1 FROM claimed_migration)
      RETURNING 1
    ), deleted_prompt_context AS (
      DELETE FROM social_prompt_context
      WHERE EXISTS (SELECT 1 FROM claimed_migration)
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM claimed_migration) AS applied,
      (SELECT COUNT(*)::int FROM deleted_youtube_items) AS deleted_youtube_items,
      (SELECT COUNT(*)::int FROM deleted_youtube_snapshots) AS deleted_youtube_snapshots,
      (SELECT COUNT(*)::int FROM deleted_prompt_context) AS deleted_prompt_context
  `, [YOUTUBE_PUBLIC_CONTEXT_MIGRATION]);
  const row = result.rows?.[0] || {};
  return {
    ok: true,
    migrationKey: YOUTUBE_PUBLIC_CONTEXT_MIGRATION,
    applied: row.applied === true,
    deleted: {
      youtubeItems: Number(row.deleted_youtube_items || 0),
      youtubeSnapshots: Number(row.deleted_youtube_snapshots || 0),
      promptContext: Number(row.deleted_prompt_context || 0),
    },
  };
}

async function ensureSocialSchema(db) {
  if (!db || typeof db.query !== 'function') return { ok: false, skipped: true, reason: 'db_missing' };
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_accounts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      account_label TEXT,
      account_external_id TEXT,
      scopes TEXT[] DEFAULT '{}',
      token_sealed JSONB,
      token_hash TEXT,
      expires_at TIMESTAMP,
      last_refresh_at TIMESTAMP,
      last_ingest_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'connected',
      reconnect_required BOOLEAN NOT NULL DEFAULT FALSE,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      metadata_json JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, provider)
    )
  `);
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS scopes TEXT[] DEFAULT \'{}\'');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_sealed JSONB');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_hash TEXT');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMP');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS last_ingest_at TIMESTAMP');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS reconnect_required BOOLEAN NOT NULL DEFAULT FALSE');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS metadata_json JSONB');
  await db.query('ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()');
  await db.query('CREATE INDEX IF NOT EXISTS idx_social_accounts_user_provider ON social_accounts (user_id, provider)');

  await db.query(`
    CREATE TABLE IF NOT EXISTS social_items (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id INTEGER REFERENCES social_accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'video',
      title TEXT,
      description TEXT,
      url TEXT,
      published_at TIMESTAMP,
      stats_json JSONB,
      comments_summary TEXT,
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (provider, external_id)
    )
  `);
  await db.query('ALTER TABLE social_items ADD COLUMN IF NOT EXISTS comments_summary TEXT');
  await db.query('ALTER TABLE social_items ADD COLUMN IF NOT EXISTS raw_json JSONB');
  await db.query('ALTER TABLE social_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()');
  await db.query('CREATE INDEX IF NOT EXISTS idx_social_items_user_provider_updated ON social_items (user_id, provider, updated_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_social_items_title_trgm_fallback ON social_items (user_id, item_type, published_at DESC)');

  await db.query(`
    CREATE TABLE IF NOT EXISTS social_context_snapshots (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      topic TEXT,
      summary_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_social_snapshots_user_created ON social_context_snapshots (user_id, created_at DESC)');

  await db.query(`
    CREATE TABLE IF NOT EXISTS social_prompt_context (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'chanson',
      dominant_tone TEXT,
      strong_phrases JSONB,
      creative_angles JSONB,
      clip_ideas JSONB,
      song_prompt_seeds JSONB,
      hashtags JSONB,
      avoid JSONB,
      source_item_ids JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, topic_key, kind)
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_social_prompt_context_user_updated ON social_prompt_context (user_id, updated_at DESC)');

  // Journal durable des tentatives de publication externe. La contrainte
  // d'unicite est le verrou d'idempotence inter-processus: une meme cle ne
  // pourra jamais creer deux appels videos.insert, meme apres un redemarrage.
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_publication_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed')),
      result_json JSONB,
      error_code TEXT,
      attempt_started_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      UNIQUE (user_id, provider, idempotency_key)
    )
  `);
  await db.query('ALTER TABLE social_publication_requests ADD COLUMN IF NOT EXISTS attempt_started_at TIMESTAMPTZ');
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_social_publication_provider_attempt_started
    ON social_publication_requests (provider, attempt_started_at DESC)
    WHERE attempt_started_at IS NOT NULL
  `);
  await runSocialDataMigrations(db);
  return { ok: true };
}

function normalizeSocialPublicationRow(row = {}) {
  let result = row.result_json ?? null;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { result = null; }
  }
  return {
    id: row.id,
    userId: cleanOneLine(row.user_id, 'admin', 160),
    provider: normalizeProvider(row.provider),
    requestHash: cleanOneLine(row.request_hash, '', 128),
    status: ['pending', 'succeeded', 'failed'].includes(row.status) ? row.status : 'pending',
    result: result && typeof result === 'object' && !Array.isArray(result) ? result : null,
    errorCode: cleanOneLine(row.error_code, '', 100),
    attemptStartedAt: row.attempt_started_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    completedAt: row.completed_at || null,
  };
}

/**
 * Reserve l'identite de la publication avant tout acces au token ou au fichier.
 * Cette reservation ne consomme pas le quota: seul startSocialPublicationAttempt
 * marque une vraie ouverture de videos.insert.
 */
async function claimSocialPublicationRequest(db, {
  userId = 'admin',
  provider = '',
  idempotencyKey = '',
  requestHash = '',
} = {}) {
  if (!db || typeof db.query !== 'function' || typeof db.connect !== 'function') {
    const error = new Error('social_publication_db_required');
    error.code = 'social_publication_db_required';
    throw error;
  }
  await ensureSocialSchema(db);

  const normalizedUserId = cleanOneLine(userId, 'admin', 160);
  const normalizedProvider = normalizeProvider(provider);
  const normalizedKey = String(idempotencyKey || '').trim();
  const normalizedHash = cleanOneLine(requestHash, '', 128);
  const client = await db.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      [`social-publication-idempotency:${normalizedProvider}`]
    );

    const existingResult = await client.query(`
      SELECT id, user_id, provider, request_hash, status, result_json, error_code,
        attempt_started_at, created_at, updated_at, completed_at
      FROM social_publication_requests
      WHERE user_id = $1 AND provider = $2 AND idempotency_key = $3
      LIMIT 1
    `, [normalizedUserId, normalizedProvider, normalizedKey]);
    const existing = existingResult.rows?.[0];
    if (existing) {
      await client.query('COMMIT');
      transactionOpen = false;
      const request = normalizeSocialPublicationRow(existing);
      return {
        outcome: request.requestHash === normalizedHash ? request.status : 'mismatch',
        request,
      };
    }

    const inserted = await client.query(`
      INSERT INTO social_publication_requests (
        user_id, provider, idempotency_key, request_hash, status,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,'pending',NOW(),NOW())
      RETURNING id, user_id, provider, request_hash, status, result_json,
        error_code, attempt_started_at, created_at, updated_at, completed_at
    `, [normalizedUserId, normalizedProvider, normalizedKey, normalizedHash]);
    await client.query('COMMIT');
    transactionOpen = false;
    return {
      outcome: 'claimed',
      request: normalizeSocialPublicationRow(inserted.rows?.[0] || {
        user_id: normalizedUserId,
        provider: normalizedProvider,
        request_hash: normalizedHash,
        status: 'pending',
      }),
    };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch { /* connexion deja perdue */ }
    }
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

/**
 * Consomme atomiquement une place de quota au dernier instant avant
 * videos.insert. Le verrou advisory est commun a toutes les instances et reste
 * tenu pendant le comptage puis l'UPDATE, donc deux processus ne peuvent pas
 * depasser ensemble la limite.
 */
async function startSocialPublicationAttempt(db, {
  userId = 'admin',
  provider = '',
  idempotencyKey = '',
  requestHash = '',
  maxAttempts24h = 20,
} = {}) {
  if (!db || typeof db.connect !== 'function') {
    const error = new Error('social_publication_db_required');
    error.code = 'social_publication_db_required';
    throw error;
  }
  const normalizedUserId = cleanOneLine(userId, 'admin', 160);
  const normalizedProvider = normalizeProvider(provider);
  const normalizedKey = String(idempotencyKey || '').trim();
  const normalizedHash = cleanOneLine(requestHash, '', 128);
  const parsedLimit = Number(maxAttempts24h);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(0, Math.min(10000, Math.floor(parsedLimit)))
    : 20;
  const client = await db.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      [`social-publication-attempt-quota:${normalizedProvider}`]
    );
    const requestResult = await client.query(`
      SELECT id, user_id, provider, request_hash, status, result_json, error_code,
        attempt_started_at, created_at, updated_at, completed_at
      FROM social_publication_requests
      WHERE user_id = $1 AND provider = $2 AND idempotency_key = $3
      FOR UPDATE
    `, [normalizedUserId, normalizedProvider, normalizedKey]);
    const row = requestResult.rows?.[0];
    if (!row || row.request_hash !== normalizedHash) {
      await client.query('COMMIT');
      transactionOpen = false;
      return { outcome: row ? 'mismatch' : 'missing', limit };
    }
    const request = normalizeSocialPublicationRow(row);
    if (request.status !== 'pending' || request.attemptStartedAt) {
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        outcome: request.attemptStartedAt && request.status === 'pending'
          ? 'already_started'
          : request.status,
        request,
        limit,
      };
    }

    const usageResult = await client.query(`
      SELECT COUNT(*)::integer AS used,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
          MIN(attempt_started_at) + INTERVAL '24 hours' - NOW()
        ))))::integer AS retry_after_seconds
      FROM social_publication_requests
      WHERE provider = $1
        AND attempt_started_at >= NOW() - INTERVAL '24 hours'
    `, [normalizedProvider]);
    const used = Number(usageResult.rows?.[0]?.used || 0);
    const retryAfterSeconds = Number(usageResult.rows?.[0]?.retry_after_seconds || 86400);
    if (used >= limit) {
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        outcome: 'quota',
        used,
        limit,
        retryAfterSeconds: Math.max(1, Math.min(86400, retryAfterSeconds || 86400)),
      };
    }

    const startedResult = await client.query(`
      UPDATE social_publication_requests
      SET attempt_started_at = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND provider = $2 AND idempotency_key = $3
        AND request_hash = $4 AND status = 'pending'
        AND attempt_started_at IS NULL
      RETURNING id, user_id, provider, request_hash, status, result_json,
        error_code, attempt_started_at, created_at, updated_at, completed_at
    `, [normalizedUserId, normalizedProvider, normalizedKey, normalizedHash]);
    await client.query('COMMIT');
    transactionOpen = false;
    const started = startedResult.rows?.[0];
    return started
      ? { outcome: 'started', request: normalizeSocialPublicationRow(started), used: used + 1, limit }
      : { outcome: 'already_started', used, limit };
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch { /* connexion deja perdue */ }
    }
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

async function completeSocialPublicationRequest(db, {
  userId = 'admin',
  provider = '',
  idempotencyKey = '',
  requestHash = '',
  status = '',
  result = null,
  errorCode = '',
} = {}) {
  if (!db || typeof db.query !== 'function') {
    const error = new Error('social_publication_db_required');
    error.code = 'social_publication_db_required';
    throw error;
  }
  if (!['succeeded', 'failed'].includes(status)) {
    const error = new Error('social_publication_status_invalid');
    error.code = 'social_publication_status_invalid';
    throw error;
  }
  const safeResult = status === 'succeeded' && result && typeof result === 'object'
    ? JSON.stringify(result)
    : null;
  const update = await db.query(`
    UPDATE social_publication_requests
    SET status = $5,
      result_json = CASE WHEN $5 = 'succeeded' THEN $6::jsonb ELSE NULL END,
      error_code = CASE WHEN $5 = 'failed' THEN $7 ELSE NULL END,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE user_id = $1 AND provider = $2 AND idempotency_key = $3
      AND request_hash = $4 AND status = 'pending'
    RETURNING id, user_id, provider, request_hash, status, result_json,
      error_code, attempt_started_at, created_at, updated_at, completed_at
  `, [
    cleanOneLine(userId, 'admin', 160),
    normalizeProvider(provider),
    String(idempotencyKey || '').trim(),
    cleanOneLine(requestHash, '', 128),
    status,
    safeResult,
    cleanOneLine(errorCode, 'social_publication_failed', 100),
  ]);
  return update.rows?.[0] ? normalizeSocialPublicationRow(update.rows[0]) : null;
}

function resolveExpiresAt(tokens = {}) {
  const explicit = cleanText(tokens.expires_at || tokens.expiresAt, 80);
  if (explicit && Number.isFinite(new Date(explicit).getTime())) return new Date(explicit).toISOString();
  const expiresIn = clampNumber(tokens.expires_in ?? tokens.expiresIn, 0, 0, 365 * 24 * 3600);
  if (expiresIn > 0) return new Date(Date.now() + expiresIn * 1000).toISOString();
  return null;
}

async function upsertSocialAccount(db, input = {}, env = process.env) {
  await ensureSocialSchema(db);
  const provider = normalizeProvider(input.provider);
  const userId = cleanOneLine(input.userId || input.user_id, 'admin', 160);
  const externalId = cleanOneLine(input.accountExternalId || input.account_external_id || provider, provider, 180);
  const account = {
    user_id: userId,
    provider,
    account_external_id: externalId,
  };
  const tokens = input.tokens || {};
  const tokenPayload = {
    provider,
    userId,
    accountExternalId: externalId,
    accessToken: cleanText(tokens.access_token || tokens.accessToken, 8000),
    refreshToken: cleanText(tokens.refresh_token || tokens.refreshToken, 8000),
    tokenType: cleanOneLine(tokens.token_type || tokens.tokenType, 'Bearer', 40),
    scope: cleanText(tokens.scope || splitScopes(input.scopes).join(' '), 2000),
    expiresAt: resolveExpiresAt(tokens),
    updatedAt: new Date().toISOString(),
  };
  const sealed = sealJson(tokenPayload, accountAad(account), env);
  const tokenHash = crypto.createHash('sha256')
    .update(`${tokenPayload.accessToken}|${tokenPayload.refreshToken}`)
    .digest('hex')
    .slice(0, 24);
  const scopes = unique(splitScopes(input.scopes || tokens.scope || tokenPayload.scope), 32);
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const result = await db.query(`
    INSERT INTO social_accounts (
      user_id, provider, account_label, account_external_id, scopes, token_sealed, token_hash,
      expires_at, status, reconnect_required, paused, metadata_json, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'connected',FALSE,FALSE,$9::jsonb,NOW(),NOW())
    ON CONFLICT (user_id, provider) DO UPDATE SET
      account_label = EXCLUDED.account_label,
      account_external_id = EXCLUDED.account_external_id,
      scopes = EXCLUDED.scopes,
      token_sealed = EXCLUDED.token_sealed,
      token_hash = EXCLUDED.token_hash,
      expires_at = EXCLUDED.expires_at,
      status = 'connected',
      reconnect_required = FALSE,
      metadata_json = EXCLUDED.metadata_json,
      updated_at = NOW()
    RETURNING id, user_id, provider, account_label, account_external_id, scopes, expires_at, status, reconnect_required, paused, metadata_json, created_at, updated_at
  `, [
    userId,
    provider,
    cleanOneLine(input.accountLabel || input.account_label || externalId, externalId, 200),
    externalId,
    scopes,
    JSON.stringify(sealed),
    tokenHash,
    tokenPayload.expiresAt,
    JSON.stringify(metadata),
  ]);
  return result.rows[0] || null;
}

function redactAccount(row = {}) {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    accountLabel: row.account_label || '',
    accountExternalId: row.account_external_id || '',
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    expiresAt: row.expires_at || null,
    lastRefreshAt: row.last_refresh_at || null,
    lastIngestAt: row.last_ingest_at || null,
    status: row.status || 'unknown',
    reconnectRequired: row.reconnect_required === true,
    paused: row.paused === true,
    metadata: row.metadata_json || {},
    hasToken: Boolean(row.token_hash),
    tokenHash: row.token_hash ? `${String(row.token_hash).slice(0, 6)}…` : '',
    updatedAt: row.updated_at || null,
  };
}

async function listSocialAccounts(db, { userId = '' } = {}) {
  await ensureSocialSchema(db);
  const params = [];
  let where = '';
  if (cleanText(userId)) {
    params.push(cleanText(userId, 160));
    where = 'WHERE user_id = $1';
  }
  const result = await db.query(`
    SELECT id, user_id, provider, account_label, account_external_id, scopes, token_hash, expires_at,
           last_refresh_at, last_ingest_at, status, reconnect_required, paused, metadata_json, created_at, updated_at
    FROM social_accounts
    ${where}
    ORDER BY provider ASC, updated_at DESC
  `, params);
  return result.rows.map(redactAccount);
}

function isConnectedAccount(account = {}) {
  return Boolean(
    account
    && account.hasToken
    && account.paused !== true
    && account.reconnectRequired !== true
    && ['connected', 'active', 'ok'].includes(String(account.status || 'connected').toLowerCase())
  );
}

function countByProvider(rows = []) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = normalizeProvider(row.provider);
    if (!provider) continue;
    counts[provider] = clampNumber(row.count || row.items || row.item_count, 0, 0, 1000000);
  }
  return counts;
}

async function buildSocialAutopromptRedactedStatus(db, { userId = '', env = process.env, req = null } = {}) {
  const safeUserId = cleanText(userId, 160);
  const youtubeConfig = resolveProviderConfig('youtube', { env, req });
  const metaConfig = resolveProviderConfig('meta', { env, req });
  const soundCloudConfig = resolveProviderConfig('soundcloud', { env, req });
  const soundCloudRssUrl = cleanText(env.SOCIAL_SOUNDCLOUD_RSS_URL || env.SOUNDCLOUD_RSS_URL, 1000);
  const soundCloudRssConfigured = Boolean(soundCloudRssUrl);

  if (!db || typeof db.query !== 'function') {
    return {
      ok: false,
      schema: 'funesterie.social-autoprompt.status.v1',
      youtubeConnected: false,
      youtubeOAuthConnected: false,
      youtubeReconnectRequired: false,
      youtubeCachedContextAvailable: false,
      youtubeIngestOk: false,
      youtubeItemsCount: 0,
      metaConfigured: metaConfig.configured === true,
      metaConnected: false,
      soundCloudConfigured: soundCloudConfig.configured === true,
      soundCloudConnected: false,
      soundCloudEnvTokenConfigured: soundCloudConfig.envTokenConfigured === true,
      soundCloudRssConfigured,
      soundCloudRssItemsCount: 0,
      metaPageSelected: false,
      metaAdsRestricted: 'unknown',
      socialPromptContextAvailable: false,
      primaryCreativeSource: 'none',
      limitations: ['database_unavailable'],
    };
  }

  await ensureSocialSchema(db);
  const accounts = await listSocialAccounts(db, { userId: safeUserId });
  const youtubeAccount = accounts.find((account) => account.provider === 'youtube') || null;
  const metaAccount = accounts.find((account) => account.provider === 'meta') || null;
  const soundCloudAccount = accounts.find((account) => account.provider === 'soundcloud') || null;
  const youtubeConnected = isConnectedAccount(youtubeAccount);
  const metaConnected = isConnectedAccount(metaAccount);
  const soundCloudConnected = isConnectedAccount(soundCloudAccount) || soundCloudConfig.envTokenConfigured === true;

  const itemCountsResult = safeUserId
    ? await db.query(`
      SELECT provider, COUNT(*)::int AS count
      FROM social_items
      WHERE user_id = $1
      GROUP BY provider
    `, [safeUserId])
    : await db.query(`
      SELECT provider, COUNT(*)::int AS count
      FROM social_items
      GROUP BY provider
    `);
  const itemCounts = countByProvider(itemCountsResult.rows);
  const youtubeItemsCount = itemCounts.youtube || 0;
  const soundCloudRssItemsCount = itemCounts.soundcloud_rss || 0;

  const contextCountResult = safeUserId
    ? await db.query(`
      SELECT COUNT(*)::int AS count
      FROM social_prompt_context
      WHERE user_id = $1
    `, [safeUserId])
    : await db.query('SELECT COUNT(*)::int AS count FROM social_prompt_context');
  const socialPromptContextCount = clampNumber(contextCountResult.rows?.[0]?.count, 0, 0, 1000000);

  const metaMetadata = metaAccount?.metadata && typeof metaAccount.metadata === 'object' ? metaAccount.metadata : {};
  const facebookPages = Array.isArray(metaMetadata.facebookPages) ? metaMetadata.facebookPages : [];
  const instagramAccounts = Array.isArray(metaMetadata.instagramAccounts) ? metaMetadata.instagramAccounts : [];
  const metaPageSelected = facebookPages.length > 0 || instagramAccounts.some((entry) => entry?.pageId || entry?.pageName);
  const explicitAdsRestriction = metaMetadata.adsRestricted
    ?? metaMetadata.metaAdsRestricted
    ?? metaMetadata.adAccountRestricted
    ?? metaMetadata.ads_account_restricted;
  const metaAdsRestricted = typeof explicitAdsRestriction === 'boolean'
    ? explicitAdsRestriction
    : 'unknown';

  const youtubeIngestOk = youtubeConnected && youtubeItemsCount > 0 && Boolean(youtubeAccount?.lastIngestAt);
  const youtubeOAuthConnected = youtubeConnected;
  const youtubeReconnectRequired = youtubeAccount?.reconnectRequired === true;
  const youtubeCachedContextAvailable = youtubeItemsCount > 0;
  const socialPromptContextAvailable = socialPromptContextCount > 0 || youtubeItemsCount > 0 || soundCloudRssItemsCount > 0;
  const primaryCreativeSource = youtubeItemsCount > 0
    ? 'youtube'
    : soundCloudRssItemsCount > 0
      ? 'soundcloud_rss'
    : socialPromptContextCount > 0
      ? 'social_prompt_context'
      : metaConnected
        ? 'meta_connected_no_ingest_yet'
        : 'none';

  const limitations = [];
  if (!youtubeConfig.configured) limitations.push('youtube_oauth_not_configured');
  if (!youtubeConnected) limitations.push('youtube_not_connected');
  if (youtubeReconnectRequired) limitations.push('youtube_reconnect_required_cached_context_only');
  if (!youtubeOAuthConnected && youtubeCachedContextAvailable) limitations.push('youtube_context_served_from_cache_no_live_ingest');
  if (youtubeConnected && youtubeItemsCount <= 0) limitations.push('youtube_connected_but_no_ingested_items');
  if (youtubeConnected && !youtubeIngestOk) limitations.push('youtube_ingest_not_ready');
  if (!metaConfig.configured) limitations.push('meta_oauth_not_configured');
  if (metaConfig.configured && !metaConnected) limitations.push('meta_not_connected');
  if (!soundCloudConfig.configured) limitations.push('soundcloud_oauth_not_configured');
  if (!soundCloudConnected) limitations.push('soundcloud_not_connected');
  if (soundCloudRssConfigured && soundCloudRssItemsCount <= 0) limitations.push('soundcloud_rss_configured_but_no_items');
  if (metaConnected && !metaPageSelected) limitations.push('meta_connected_but_no_facebook_page_or_instagram_business_link_detected');
  if (metaConnected) limitations.push('meta_ingest_planned_only_for_now');
  if (metaAdsRestricted === 'unknown') limitations.push('meta_ads_status_not_checked_no_ads_scope');
  if (!socialPromptContextAvailable) limitations.push('social_prompt_context_empty');

  return {
    ok: true,
    schema: 'funesterie.social-autoprompt.status.v1',
    youtubeConnected,
    youtubeOAuthConnected,
    youtubeReconnectRequired,
    youtubeCachedContextAvailable,
    youtubeIngestOk,
    youtubeItemsCount,
    metaConfigured: metaConfig.configured === true,
    metaConnected,
    soundCloudConfigured: soundCloudConfig.configured === true,
    soundCloudConnected,
    soundCloudEnvTokenConfigured: soundCloudConfig.envTokenConfigured === true,
    soundCloudRssConfigured,
    soundCloudRssItemsCount,
    metaPageSelected,
    metaAdsRestricted,
    socialPromptContextAvailable,
    primaryCreativeSource,
    limitations: unique(limitations, 12),
  };
}

async function getSocialAccountWithTokens(db, { provider, userId = 'admin' } = {}, env = process.env) {
  await ensureSocialSchema(db);
  const normalizedProvider = normalizeProvider(provider);
  const result = await db.query(`
    SELECT *
    FROM social_accounts
    WHERE provider = $1 AND user_id = $2
    ORDER BY updated_at DESC
    LIMIT 1
  `, [normalizedProvider, cleanOneLine(userId, 'admin', 160)]);
  const row = result.rows[0];
  if (!row) return null;
  let tokens = null;
  try {
    tokens = openJson(row.token_sealed, accountAad(row), env);
  } catch (error) {
    await markReconnectRequired(db, row.id, 'token_decrypt_failed');
    return {
      row: {
        ...row,
        status: 'reconnect_required',
        reconnect_required: true,
      },
      tokens: null,
      vaultError: cleanOneLine(error?.message || 'token_decrypt_failed', 'token_decrypt_failed', 240),
    };
  }
  return { row, tokens };
}

async function markReconnectRequired(db, accountId, reason = '') {
  await db.query(`
    UPDATE social_accounts
    SET reconnect_required = TRUE, status = 'reconnect_required', metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
    WHERE id = $1
  `, [accountId, JSON.stringify({ lastError: cleanOneLine(reason, 'refresh_failed', 240) })]);
}

async function refreshYoutubeAccount(db, account, tokens = {}, env = process.env, fetchFn = globalThis.fetch) {
  const refreshToken = cleanText(tokens.refreshToken, 8000);
  if (!refreshToken) {
    await markReconnectRequired(db, account.id, 'refresh_token_missing');
    return { ok: false, reconnectRequired: true, error: 'refresh_token_missing' };
  }
  const config = resolveProviderConfig('youtube', { env });
  if (!config.configured) return { ok: false, error: 'youtube_oauth_not_configured', missing: config.missing };
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchFn(YOUTUBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await markReconnectRequired(db, account.id, data?.error_description || data?.error || `refresh_http_${response.status}`);
    return { ok: false, reconnectRequired: true, error: data?.error || `refresh_http_${response.status}` };
  }
  const mergedTokens = {
    ...tokens,
    access_token: data.access_token || tokens.accessToken,
    refresh_token: data.refresh_token || tokens.refreshToken,
    token_type: data.token_type || tokens.tokenType || 'Bearer',
    expires_in: data.expires_in,
    scope: data.scope || tokens.scope,
  };
  const updated = await upsertSocialAccount(db, {
    userId: account.user_id,
    provider: 'youtube',
    accountLabel: account.account_label,
    accountExternalId: account.account_external_id,
    scopes: account.scopes || splitScopes(mergedTokens.scope),
    tokens: mergedTokens,
    metadata: {
      ...(account.metadata_json || {}),
      refreshedAt: new Date().toISOString(),
    },
  }, env);
  await db.query('UPDATE social_accounts SET last_refresh_at = NOW() WHERE id = $1', [updated.id]);
  return { ok: true, account: redactAccount({ ...updated, last_refresh_at: new Date().toISOString() }) };
}

function getSoundCloudEnvTokenBundle({ userId = 'admin', env = process.env } = {}) {
  const accessToken = firstEnv(env, ['SOCIAL_SOUNDCLOUD_ACCESS_TOKEN', 'SOUNDCLOUD_ACCESS_TOKEN']);
  const refreshToken = firstEnv(env, ['SOCIAL_SOUNDCLOUD_REFRESH_TOKEN', 'SOUNDCLOUD_REFRESH_TOKEN']);
  if (!accessToken && !refreshToken) return null;
  return {
    envBacked: true,
    row: {
      id: 0,
      user_id: cleanOneLine(userId, 'admin', 160),
      provider: 'soundcloud',
      account_label: firstEnv(env, ['SOCIAL_SOUNDCLOUD_ACCOUNT_LABEL', 'SOUNDCLOUD_ACCOUNT_LABEL']) || 'SoundCloud',
      account_external_id: firstEnv(env, ['SOCIAL_SOUNDCLOUD_ACCOUNT_ID', 'SOUNDCLOUD_ACCOUNT_ID']) || 'env',
      scopes: splitScopes(firstEnv(env, ['SOCIAL_SOUNDCLOUD_SCOPES', 'SOUNDCLOUD_OAUTH_SCOPES'])),
      paused: false,
      reconnect_required: false,
      status: 'connected',
      metadata_json: { source: 'env' },
    },
    tokens: {
      provider: 'soundcloud',
      userId: cleanOneLine(userId, 'admin', 160),
      accessToken,
      refreshToken,
      tokenType: 'OAuth',
      scope: firstEnv(env, ['SOCIAL_SOUNDCLOUD_SCOPES', 'SOUNDCLOUD_OAUTH_SCOPES']),
      expiresAt: firstEnv(env, ['SOCIAL_SOUNDCLOUD_EXPIRES_AT', 'SOUNDCLOUD_EXPIRES_AT']),
      updatedAt: new Date().toISOString(),
    },
  };
}

async function refreshSoundCloudAccount(db, account, tokens = {}, env = process.env, fetchFn = globalThis.fetch) {
  const refreshToken = cleanText(tokens.refreshToken, 8000);
  if (!refreshToken) {
    if (account?.id) await markReconnectRequired(db, account.id, 'refresh_token_missing');
    return { ok: false, reconnectRequired: true, error: 'refresh_token_missing' };
  }
  const config = resolveProviderConfig('soundcloud', { env });
  if (!config.configured) return { ok: false, error: 'soundcloud_oauth_not_configured', missing: config.missing };
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });
  const response = await fetchFn(SOUNDCLOUD_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json; charset=utf-8' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (account?.id) await markReconnectRequired(db, account.id, data?.error_description || data?.error || `soundcloud_refresh_http_${response.status}`);
    return { ok: false, reconnectRequired: true, error: data?.error || `soundcloud_refresh_http_${response.status}` };
  }
  const mergedTokens = {
    ...tokens,
    access_token: data.access_token || tokens.accessToken,
    refresh_token: data.refresh_token || tokens.refreshToken,
    token_type: data.token_type || tokens.tokenType || 'OAuth',
    expires_in: data.expires_in,
    scope: data.scope || tokens.scope,
  };
  if (!account?.id) {
    return { ok: true, tokens: mergedTokens, envBacked: true };
  }
  const updated = await upsertSocialAccount(db, {
    userId: account.user_id,
    provider: 'soundcloud',
    accountLabel: account.account_label || 'SoundCloud',
    accountExternalId: account.account_external_id || 'soundcloud',
    scopes: account.scopes || splitScopes(mergedTokens.scope),
    tokens: mergedTokens,
    metadata: {
      ...(account.metadata_json || {}),
      refreshedAt: new Date().toISOString(),
    },
  }, env);
  await db.query('UPDATE social_accounts SET last_refresh_at = NOW() WHERE id = $1', [updated.id]);
  return { ok: true, account: redactAccount({ ...updated, last_refresh_at: new Date().toISOString() }) };
}

async function getFreshSocialTokens(db, { provider, userId = 'admin' } = {}, env = process.env, fetchFn = globalThis.fetch) {
  const normalizedProvider = normalizeProvider(provider);
  const account = await getSocialAccountWithTokens(db, { provider: normalizedProvider, userId }, env)
    || (normalizedProvider === 'soundcloud' ? getSoundCloudEnvTokenBundle({ userId, env }) : null);
  if (!account) return null;
  const expiresAt = account.tokens?.expiresAt ? new Date(account.tokens.expiresAt).getTime() : 0;
  const refreshWindowMs = 10 * 60 * 1000;
  if (expiresAt && expiresAt - Date.now() < refreshWindowMs && normalizedProvider === 'youtube') {
    const refreshed = await refreshYoutubeAccount(db, account.row, account.tokens, env, fetchFn);
    if (!refreshed.ok) return { ...account, refresh: refreshed };
    return getSocialAccountWithTokens(db, { provider: normalizedProvider, userId }, env);
  }
  if (expiresAt && expiresAt - Date.now() < refreshWindowMs && normalizedProvider === 'soundcloud') {
    if (account.envBacked) {
      return {
        ...account,
        refresh: {
          ok: false,
          reconnectRequired: true,
          error: 'soundcloud_env_token_expiring_reconnect_or_store_refresh_in_vault',
        },
      };
    }
    const refreshed = await refreshSoundCloudAccount(db, account.row, account.tokens, env, fetchFn);
    if (!refreshed.ok) return { ...account, refresh: refreshed };
    return getSocialAccountWithTokens(db, { provider: normalizedProvider, userId }, env);
  }
  return account;
}

async function youtubeApi(pathname, accessToken, query = {}, fetchFn = globalThis.fetch) {
  const url = new URL(`${YOUTUBE_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetchFn(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error_description || `youtube_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function soundCloudApi(pathname, accessToken, { method = 'GET', query = {}, body = undefined, headers = {} } = {}, fetchFn = globalThis.fetch) {
  const url = new URL(`${SOUNDCLOUD_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetchFn(url, {
    method,
    headers: {
      accept: 'application/json; charset=utf-8',
      authorization: `OAuth ${accessToken}`,
      ...headers,
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error_description || data?.error?.message || data?.message || data?.error || `soundcloud_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getSoundCloudAccountIdentity(accessToken, fetchFn = globalThis.fetch) {
  const data = await soundCloudApi('/me', accessToken, {}, fetchFn);
  return {
    accountExternalId: cleanText(data.id || data.urn || data.permalink || 'soundcloud', 180),
    accountLabel: cleanText(data.username || data.full_name || 'SoundCloud', 200),
    metadata: {
      soundCloudUserId: cleanText(data.id || '', 180),
      username: cleanText(data.username || '', 200),
      permalinkUrl: cleanText(data.permalink_url || data.uri || '', 500),
      connectedAt: new Date().toISOString(),
    },
  };
}

function contentTypeForAudioPath(audioPath = '') {
  const ext = String(audioPath || '').split('.').pop().toLowerCase();
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a' || ext === 'aac' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  return 'audio/wav';
}

async function uploadSoundCloudTrack({ accessToken, audioPath, title, description = '', sharing = 'private', genre = '', tagList = '', artworkPath = '' } = {}, fetchFn = globalThis.fetch) {
  if (!accessToken) throw new Error('soundcloud_access_token_missing');
  if (!audioPath) throw new Error('soundcloud_audio_path_missing');
  const fs = require('node:fs');
  const path = require('node:path');
  const audioBuffer = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append('track[title]', cleanOneLine(title || path.basename(audioPath).replace(/\.[^.]+$/, ''), 'Funesterie', 120));
  form.append('track[sharing]', ['public', 'private'].includes(String(sharing || '').toLowerCase()) ? String(sharing).toLowerCase() : 'private');
  if (description) form.append('track[description]', cleanText(description, 4000));
  if (genre) form.append('track[genre]', cleanOneLine(genre, '', 120));
  if (tagList) form.append('track[tag_list]', cleanText(tagList, 500));
  if (artworkPath && fs.existsSync(artworkPath)) {
    const artworkBuffer = fs.readFileSync(artworkPath);
    form.append('track[artwork_data]', new Blob([artworkBuffer]), path.basename(artworkPath));
  }
  form.append('track[asset_data]', new Blob([audioBuffer], { type: contentTypeForAudioPath(audioPath) }), path.basename(audioPath));
  const data = await soundCloudApi('/tracks', accessToken, {
    method: 'POST',
    body: form,
  }, fetchFn);
  return {
    ok: true,
    provider: 'soundcloud',
    id: data.id || data.urn || null,
    title: data.title || cleanOneLine(title, 'Funesterie', 120),
    permalinkUrl: data.permalink_url || data.uri || '',
    sharing: data.sharing || sharing,
    raw: {
      id: data.id,
      urn: data.urn,
      state: data.state,
      processingState: data.processing_state,
      permalinkUrl: data.permalink_url,
    },
  };
}

function youtubeWatchUrl(videoId = '') {
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '';
}

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCodePoint(number) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isFinite(number) ? String.fromCodePoint(number) : _;
    });
}

function extractXmlTag(block = '', tagName = '') {
  if (!tagName) return '';
  const match = String(block || '').match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return cleanText(decodeXmlEntities(match?.[1] || ''), 5000);
}

function extractXmlTagAttr(block = '', tagName = '', attrName = '') {
  if (!tagName || !attrName) return '';
  const tag = String(block || '').match(new RegExp(`<${tagName}\\b([^>]*)>`, 'i'))?.[1] || '';
  const attr = tag.match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
  return cleanText(decodeXmlEntities(attr), 1000);
}

function normalizeRssDate(value = '') {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function socialRssAllowedHosts(env = process.env) {
  return unique([
    ...DEFAULT_SOCIAL_RSS_ALLOWED_HOSTS,
    ...splitCsv(env.SOCIAL_RSS_ALLOWED_HOSTS || env.SOCIAL_SOUNDCLOUD_RSS_ALLOWED_HOSTS || ''),
  ], 40).map((host) => foldForLookup(host).replace(/^\.+|\.+$/g, ''));
}

function isPrivateHostname(hostname = '') {
  const host = foldForLookup(hostname).replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return true;
  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const octet = Number(match172[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
}

function assertAllowedSocialRssUrl(rawUrl = '', env = process.env) {
  const url = new URL(cleanText(rawUrl, 1000));
  if (url.protocol !== 'https:') throw new Error('social_rss_https_required');
  if (isPrivateHostname(url.hostname)) throw new Error('social_rss_private_host_denied');
  const host = foldForLookup(url.hostname);
  const allowed = socialRssAllowedHosts(env);
  if (!allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
    throw new Error(`social_rss_host_denied:${host}`);
  }
  return url;
}

async function fetchSocialRssXml(feedUrl = '', { fetchFn = globalThis.fetch, env = process.env, maxBytes = 2 * 1024 * 1024 } = {}) {
  let current = assertAllowedSocialRssUrl(feedUrl, env);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchFn(current, {
      redirect: 'manual',
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        'user-agent': 'Funesterie-A11-SocialRSS/1.0',
      },
    });
    const status = Number(response?.status || 0);
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers?.get?.('location') || response.headers?.location || '';
      if (!location) throw new Error('social_rss_redirect_without_location');
      current = assertAllowedSocialRssUrl(new URL(location, current).toString(), env);
      continue;
    }
    if (!response?.ok) throw new Error(`social_rss_http_${status || 'failed'}`);
    const contentType = cleanText(response.headers?.get?.('content-type') || response.headers?.['content-type'] || '', 160).toLowerCase();
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('social_rss_too_large');
    const head = text.slice(0, 800).toLowerCase();
    if (contentType.includes('html') || /^\s*<!doctype html/i.test(text) || /^\s*<html\b/i.test(text)) {
      throw new Error('social_rss_html_response_denied');
    }
    if (!/<(?:rss|feed)\b/i.test(text)) throw new Error('social_rss_xml_missing_feed_root');
    return { ok: true, url: current.toString(), xml: text };
  }
  throw new Error('social_rss_too_many_redirects');
}

function parseSocialRssItems(xml = '', { limit = 12 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const channelBlock = String(xml || '').match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1] || String(xml || '');
  const channel = {
    title: cleanOneLine(extractXmlTag(channelBlock, 'title'), 'SoundCloud RSS', 240),
    link: cleanText(extractXmlTag(channelBlock, 'link'), 500),
    description: cleanText(extractXmlTag(channelBlock, 'description'), 1000),
  };
  const rawItems = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1])
    .slice(0, safeLimit);
  const items = rawItems.map((block) => {
    const title = cleanOneLine(extractXmlTag(block, 'title'), 'Piste SoundCloud', 280);
    const description = cleanText(extractXmlTag(block, 'description'), 5000);
    const link = cleanText(extractXmlTag(block, 'link'), 700);
    const guid = cleanText(extractXmlTag(block, 'guid'), 700);
    const enclosureUrl = extractXmlTagAttr(block, 'enclosure', 'url');
    const enclosureType = extractXmlTagAttr(block, 'enclosure', 'type');
    const pubDate = normalizeRssDate(extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'published') || extractXmlTag(block, 'updated'));
    const stableSeed = guid || enclosureUrl || link || `${title}|${pubDate || ''}`;
    const digest = crypto.createHash('sha256').update(stableSeed).digest('hex').slice(0, 32);
    return {
      externalId: cleanText(guid || digest, 180),
      itemType: 'audio',
      title,
      description,
      url: link || enclosureUrl || channel.link,
      publishedAt: pubDate,
      stats: {},
      commentsSummary: enclosureType ? `Flux audio RSS SoundCloud (${enclosureType}).` : 'Flux audio RSS SoundCloud.',
      raw: {
        channel: {
          title: channel.title,
          link: channel.link,
        },
        guid,
        enclosure: {
          urlPresent: Boolean(enclosureUrl),
          type: enclosureType,
        },
      },
    };
  }).filter((item) => item.externalId && item.title);
  return { channel, items };
}

function normalizeYoutubeVideoItem(video = {}, fallback = {}) {
  const snippet = video.snippet || fallback.snippet || {};
  const id = cleanText(video.id || fallback.contentDetails?.videoId || fallback.snippet?.resourceId?.videoId, 120);
  const rawViewCount = cleanText(video.statistics?.viewCount, 40);
  const viewCount = /^\d+$/.test(rawViewCount) ? rawViewCount : '';
  return {
    externalId: id,
    itemType: 'video',
    title: cleanOneLine(snippet.title, 'Vidéo YouTube', 280),
    description: cleanText(snippet.description, 5000),
    url: youtubeWatchUrl(id),
    publishedAt: null,
    stats: viewCount ? { viewCount } : {},
    commentsSummary: '',
    raw: { id },
  };
}

function assertAllowedYoutubeFeedUrl(rawUrl = '', expectedChannelId = '') {
  const url = new URL(cleanText(rawUrl, 1000));
  if (url.protocol !== 'https:') throw new Error('youtube_public_feed_https_required');
  if (url.username || url.password || url.hash) throw new Error('youtube_public_feed_url_denied');
  if (url.port && url.port !== '443') throw new Error('youtube_public_feed_port_denied');
  const host = foldForLookup(url.hostname);
  if (!YOUTUBE_PUBLIC_FEED_HOSTS.includes(host) || url.pathname !== '/feeds/videos.xml') {
    throw new Error('youtube_public_feed_url_denied');
  }
  if ([...url.searchParams.keys()].some((key) => key !== 'channel_id')) {
    throw new Error('youtube_public_feed_query_denied');
  }
  const channelId = cleanText(url.searchParams.get('channel_id'), 180);
  if (!channelId || (expectedChannelId && channelId !== cleanText(expectedChannelId, 180))) {
    throw new Error('youtube_public_feed_channel_mismatch');
  }
  return url;
}

function parseYoutubeAtomVideoIds(xml = '', { limit = 12, expectedChannelId = '' } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const document = String(xml || '');
  const feedChannelId = extractXmlTag(document, 'yt:channelId');
  const safeExpectedChannelId = cleanText(expectedChannelId, 180);
  // Dans l'element racine, le flux YouTube omet historiquement le prefixe
  // `UC`; les entrees, elles, exposent l'identifiant complet. Accepter ces
  // deux representations seulement, puis laisser videos.list revalider chaque
  // item contre l'identifiant complet de channels.list.
  const feedChannelMatches = !safeExpectedChannelId
    || !feedChannelId
    || feedChannelId === safeExpectedChannelId
    || (safeExpectedChannelId.startsWith('UC') && feedChannelId === safeExpectedChannelId.slice(2));
  if (!feedChannelMatches) {
    throw new Error('youtube_public_feed_channel_mismatch');
  }
  const ids = [...document.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)]
    .map((match) => extractXmlTag(match[1], 'yt:videoId'))
    .filter(Boolean);
  return unique(ids, safeLimit);
}

async function fetchYoutubePublicFeedVideoIds(channelId, {
  limit = 12,
  fetchFn = globalThis.fetch,
  maxBytes = 1024 * 1024,
  timeoutMs = 15000,
} = {}) {
  const safeChannelId = cleanText(channelId, 180);
  const initial = new URL(YOUTUBE_PUBLIC_FEED_URL);
  initial.searchParams.set('channel_id', safeChannelId);
  let current = assertAllowedYoutubeFeedUrl(initial.toString(), safeChannelId);
  const safeMaxBytes = Math.max(1024, Math.min(4 * 1024 * 1024, Number(maxBytes) || 1024 * 1024));
  const safeTimeoutMs = Math.max(1000, Math.min(30000, Number(timeoutMs) || 15000));

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
    try {
      const response = await fetchFn(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
          'user-agent': 'Funesterie-A11-YouTubePublicFeed/1.0',
        },
      });
      const status = Number(response?.status || (response?.ok ? 200 : 0));
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers?.get?.('location') || response.headers?.location || '';
        if (!location) throw new Error('youtube_public_feed_redirect_without_location');
        current = assertAllowedYoutubeFeedUrl(new URL(location, current).toString(), safeChannelId);
        continue;
      }
      if (!response?.ok) throw new Error(`youtube_public_feed_http_${status || 'failed'}`);
      const contentLength = Number(response.headers?.get?.('content-length') || response.headers?.['content-length'] || 0);
      if (Number.isFinite(contentLength) && contentLength > safeMaxBytes) throw new Error('youtube_public_feed_too_large');
      const contentType = cleanText(response.headers?.get?.('content-type') || response.headers?.['content-type'] || '', 160).toLowerCase();
      const xml = await response.text();
      if (Buffer.byteLength(xml, 'utf8') > safeMaxBytes) throw new Error('youtube_public_feed_too_large');
      if (contentType.includes('html') || /^\s*<!doctype html/i.test(xml) || /^\s*<html\b/i.test(xml)) {
        throw new Error('youtube_public_feed_html_response_denied');
      }
      if (!/<feed\b/i.test(xml)) throw new Error('youtube_public_feed_xml_missing_feed_root');
      return {
        url: current.toString(),
        videoIds: parseYoutubeAtomVideoIds(xml, { limit, expectedChannelId: safeChannelId }),
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('youtube_public_feed_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('youtube_public_feed_too_many_redirects');
}

async function fetchYoutubePublicVideoItems(accessToken, { limit = 12, fetchFn = globalThis.fetch } = {}) {
  const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  const channels = await youtubeApi('/channels', accessToken, {
    part: 'snippet',
    mine: 'true',
    maxResults: 1,
    fields: 'items(id,snippet(title))',
  }, fetchFn);
  const channel = channels.items?.[0] || {};
  const channelId = cleanText(channel.id, 180);
  if (!channelId) {
    const error = new Error('youtube_channel_identity_missing');
    error.code = 'youtube_channel_identity_missing';
    throw error;
  }

  // Le flux Atom de la chaine n'utilise ni search.list ni la playlist privee
  // des uploads. Il fournit uniquement les identifiants des publications
  // publiques; videos.list sert ensuite de verification defensive et de source
  // minimale pour les metadonnees autorisees.
  const feed = await fetchYoutubePublicFeedVideoIds(channelId, { limit: boundedLimit, fetchFn });
  const ids = feed.videoIds;
  if (!ids.length) return { channel, channelId, items: [] };

  const videos = await youtubeApi('/videos', accessToken, {
    part: 'snippet,statistics,status',
    id: ids.join(','),
    maxResults: ids.length,
    fields: 'items(id,snippet(channelId,title,description),statistics(viewCount),status(privacyStatus))',
  }, fetchFn);
  const byId = new Map((videos.items || []).map((item) => [cleanText(item.id, 120), item]));
  const items = [];
  for (const id of ids) {
    const video = byId.get(id);
    if (!video) continue;
    if (cleanText(video.status?.privacyStatus, 20).toLowerCase() !== 'public') continue;
    if (cleanText(video.snippet?.channelId, 180) !== channelId) continue;
    items.push(normalizeYoutubeVideoItem(video));
  }
  return { channel, channelId, items };
}

async function upsertSocialItem(db, item = {}, account = {}) {
  const result = await db.query(`
    INSERT INTO social_items (
      user_id, account_id, provider, external_id, item_type, title, description, url,
      published_at, stats_json, comments_summary, raw_json, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,NOW(),NOW())
    ON CONFLICT (provider, external_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      account_id = EXCLUDED.account_id,
      item_type = EXCLUDED.item_type,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      url = EXCLUDED.url,
      published_at = EXCLUDED.published_at,
      stats_json = EXCLUDED.stats_json,
      comments_summary = EXCLUDED.comments_summary,
      raw_json = EXCLUDED.raw_json,
      updated_at = NOW()
    RETURNING id
  `, [
    account.user_id,
    account.id,
    account.provider,
    item.externalId,
    item.itemType || 'video',
    item.title,
    item.description,
    item.url,
    item.publishedAt,
    JSON.stringify(item.stats || {}),
    item.commentsSummary || '',
    JSON.stringify(item.raw || {}),
  ]);
  return result.rows[0]?.id || null;
}

async function clearYoutubeIngestCache(db, { userId = 'admin' } = {}) {
  const safeUserId = cleanOneLine(userId, 'admin', 160);
  await db.query("DELETE FROM social_items WHERE user_id = $1 AND provider = 'youtube'", [safeUserId]);
  await db.query("DELETE FROM social_context_snapshots WHERE user_id = $1 AND provider = 'youtube'", [safeUserId]);
}

async function ingestYoutubeAccount(db, { userId = 'admin', limit = 12, fetchFn = globalThis.fetch, env = process.env } = {}) {
  await ensureSocialSchema(db);
  const accountBundle = await getFreshSocialTokens(db, { provider: 'youtube', userId }, env, fetchFn);
  if (!accountBundle?.row || !accountBundle?.tokens?.accessToken) {
    return { ok: false, error: 'youtube_not_connected' };
  }
  if (accountBundle.row.paused === true) return { ok: false, skipped: true, reason: 'paused' };
  if (accountBundle.row.reconnect_required === true) return { ok: false, reconnectRequired: true, error: 'reconnect_required' };
  const account = accountBundle.row;
  const accessToken = accountBundle.tokens.accessToken;
  const youtubeData = await fetchYoutubePublicVideoItems(accessToken, { limit, fetchFn });
  const { channel, channelId, items: publicItems } = youtubeData;
  const sanitizedMetadata = { ...(account.metadata_json || {}) };
  delete sanitizedMetadata.channelDescription;
  delete sanitizedMetadata.channelStatistics;
  sanitizedMetadata.channelTitle = cleanOneLine(channel.snippet?.title, account.account_label || 'YouTube', 200);
  sanitizedMetadata.channelUrl = `https://www.youtube.com/channel/${channelId}`;
  const tokenPayload = {
    access_token: accountBundle.tokens.accessToken,
    refresh_token: accountBundle.tokens.refreshToken,
    token_type: accountBundle.tokens.tokenType || 'Bearer',
    scope: accountBundle.tokens.scope || splitScopes(account.scopes).join(' '),
    expires_at: accountBundle.tokens.expiresAt,
  };
  const updated = await upsertSocialAccount(db, {
    userId: account.user_id,
    provider: 'youtube',
    accountExternalId: channelId,
    accountLabel: cleanOneLine(channel.snippet?.title, account.account_label || 'YouTube', 200),
    scopes: account.scopes || splitScopes(accountBundle.tokens.scope),
    tokens: tokenPayload,
    metadata: sanitizedMetadata,
  }, env);
  account.id = updated.id || account.id;
  account.account_external_id = channelId;
  account.account_label = cleanOneLine(channel.snippet?.title, account.account_label || 'YouTube', 200);
  account.metadata_json = sanitizedMetadata;

  // Le nettoyage historique de social_prompt_context est une migration
  // globale ponctuelle dans ensureSocialSchema. Ici, seule la projection
  // YouTube courante est remplacee avant sa reconstruction.
  await clearYoutubeIngestCache(db, { userId: account.user_id });
  const savedIds = [];
  for (const item of publicItems) {
    const savedId = await upsertSocialItem(db, item, account);
    if (savedId) savedIds.push(savedId);
  }
  await db.query('UPDATE social_accounts SET last_ingest_at = NOW(), updated_at = NOW() WHERE id = $1', [account.id]);
  const context = await buildAndStoreSocialPromptContext(db, {
    userId: account.user_id,
    topic: '',
    kind: 'chanson',
    limit: 8,
  });
  await db.query(`
    INSERT INTO social_context_snapshots (user_id, provider, topic, summary_json, created_at)
    VALUES ($1, 'youtube', $2, $3::jsonb, NOW())
  `, [account.user_id, '', JSON.stringify(context)]);
  return { ok: true, provider: 'youtube', items: savedIds.length, sourceItemIds: savedIds, context };
}

function parseHashtags(...values) {
  const text = values.filter(Boolean).join('\n');
  const tags = [];
  for (const match of text.matchAll(/#[\p{L}\p{N}_-]{2,40}/gu)) tags.push(match[0]);
  return unique(tags, 24);
}

function sentenceCandidates(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+|[|•]+/g)
    .map((entry) => cleanText(entry, 220))
    .filter((entry) => entry.length >= 18 && entry.length <= 180);
}

function scorePhrase(phrase = '') {
  const folded = foldForLookup(phrase);
  let score = 0;
  if (/[!?]/.test(phrase)) score += 2;
  if (/\b(?:jamais|toujours|rêve|reve|peur|amour|nuit|machine|victoire|secret|vrai|mensonge|vivant|mort|danse|lumiere|lumière)\b/.test(folded)) score += 2;
  if (/\b(?:je|tu|nous|on)\b/.test(folded)) score += 1;
  score += Math.min(3, phrase.length / 60);
  return score;
}

function inferToneFromItems(items = []) {
  const text = foldForLookup(items.map((item) => `${item.title || ''} ${item.description || ''} ${item.comments_summary || ''}`).join('\n'));
  const signals = [
    ['électro lumineux, énergique et fédérateur', /\b(victoire|danse|soleil|lumiere|lumiere|reve|rêve|espoir|heureux|joie|fete|fête)\b/g],
    ['nocturne, nerveux et cinématique', /\b(nuit|neon|néon|poursuite|route|vitesse|sirene|sirène|danger|ombre|matrix)\b/g],
    ['humour français, absurde et complice', /\b(drole|drôle|humour|blague|paillard|quiproquo|malentendu|parodie|absurde)\b/g],
    ['intime, lucide et résilient', /\b(fatigue|doute|cicatrice|fragile|pilule|peur|rage|normal|vivant|tenir)\b/g],
    ['techno-poétique, machines et émotion', /\b(machine|machines|ia|code|robot|ecran|écran|logiciel|pixel|synth)\b/g],
  ];
  let best = { label: 'créatif, direct et ancré dans les références récentes', count: 0 };
  for (const [label, pattern] of signals) {
    const count = (text.match(pattern) || []).length;
    if (count > best.count) best = { label, count };
  }
  return best.label;
}

function topicKey(topic = '') {
  const key = foldForLookup(topic)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return key || 'general';
}

function itemMatchesTopic(item = {}, topic = '') {
  const foldedTopic = foldForLookup(topic);
  if (!foldedTopic) return true;
  const words = foldedTopic.split(/[^a-z0-9]+/g).filter((word) => word.length >= 3);
  if (!words.length) return true;
  const haystack = foldForLookup(`${item.title || ''} ${item.description || ''} ${item.comments_summary || ''}`);
  return words.some((word) => haystack.includes(word));
}

function buildSocialPromptContextFromItems(items = [], { topic = '', kind = 'chanson', limit = 6 } = {}) {
  const selected = items.filter((item) => itemMatchesTopic(item, topic)).slice(0, Math.max(1, Math.min(20, Number(limit) || 6)));
  const usable = selected.length ? selected : items.slice(0, Math.max(1, Math.min(20, Number(limit) || 6)));
  const titlePhrases = usable.map((item) => cleanOneLine(item.title, '', 180)).filter(Boolean);
  const descriptionPhrases = usable.flatMap((item) => sentenceCandidates(item.description).slice(0, 2));
  const commentPhrases = usable.flatMap((item) => sentenceCandidates(item.comments_summary).slice(0, 2));
  const strongPhrases = unique([...titlePhrases, ...commentPhrases, ...descriptionPhrases]
    .sort((a, b) => scorePhrase(b) - scorePhrase(a)), 8);
  const hashtags = unique([
    ...usable.flatMap((item) => parseHashtags(item.title, item.description, item.comments_summary)),
    '#Funesterie',
    '#Vivy',
  ], 12);
  const dominantTone = inferToneFromItems(usable);
  const visibleTopic = cleanOneLine(topic, 'le sujet demandé', 180);
  const creativeAngles = unique([
    `Relier "${visibleTopic}" au ton récent: ${dominantTone}.`,
    strongPhrases[0] ? `Transformer la phrase forte "${strongPhrases[0]}" en image de refrain, sans la recopier mot pour mot.` : '',
    'Chercher une scène concrète plutôt qu’un thème abstrait.',
    'Faire revenir une image du début avec un sens différent au dernier refrain.',
  ], 6);
  const clipIdeas = unique([
    `Clip: ouvrir sur un détail visuel lié à "${visibleTopic}", puis élargir vers l’univers Funesterie.`,
    'Prévoir un motif de refrain reconnaissable et réutilisable.',
    'Éviter les faux textes à l’écran; préférer objets, gestes, lumière et silhouettes.',
    dominantTone.includes('nocturne') ? 'Plans nocturnes, reflets, mouvement latéral, tension sans surcharger.' : '',
    dominantTone.includes('humour') ? 'Timing comique visuel: regard sérieux, conséquence absurde, chute propre.' : '',
  ], 6);
  const songPromptSeeds = unique([
    `${visibleTopic}, chanson originale nourrie par le ton social récent: ${dominantTone}.`,
    strongPhrases[0] ? `${visibleTopic}, refrain mémorable inspiré par l’énergie de "${strongPhrases[0]}", sans citation directe.` : '',
    `${visibleTopic}, couplets avec images concrètes, phrase forte, angle clip possible et final qui reste en tête.`,
  ], 6);
  const avoid = unique([
    'Ne pas citer de commentaire utilisateur mot pour mot si ce n’est pas nécessaire.',
    'Ne pas afficher de données privées, tokens, emails ou identifiants.',
    'Ne pas recycler mécaniquement les anciens titres: utiliser seulement le ton, les angles et les formes qui marchent.',
    'Ne pas transformer les statistiques en paroles.',
  ], 8);
  return {
    topic: cleanOneLine(topic, '', 240),
    kind: normalizeKind(kind),
    dominantTone,
    strongPhrases,
    creativeAngles,
    clipIdeas,
    songPromptSeeds,
    hashtags,
    avoid,
    sourceItems: usable.map((item) => ({
      id: item.id,
      provider: item.provider,
      itemType: item.item_type || item.itemType,
      title: cleanOneLine(item.title, '', 180),
      url: cleanOneLine(item.url, '', 500),
      publishedAt: item.published_at || item.publishedAt || null,
    })).slice(0, 10),
  };
}

async function buildAndStoreSocialPromptContext(db, { userId = '', topic = '', kind = 'chanson', limit = 6 } = {}) {
  await ensureSocialSchema(db);
  const cappedLimit = Math.max(1, Math.min(20, Number(limit) || 6));
  const safeUserId = cleanText(userId, 160);
  const storageUserId = safeUserId || '__global__';
  const result = safeUserId
    ? await db.query(`
      SELECT id, provider, item_type, title, description, url, published_at, stats_json, comments_summary, updated_at
      FROM social_items
      WHERE user_id = $1
      ORDER BY published_at DESC NULLS LAST, updated_at DESC
      LIMIT $2
    `, [safeUserId, Math.max(cappedLimit * 4, 12)])
    : await db.query(`
      SELECT id, provider, item_type, title, description, url, published_at, stats_json, comments_summary, updated_at
      FROM social_items
      ORDER BY published_at DESC NULLS LAST, updated_at DESC
      LIMIT $1
    `, [Math.max(cappedLimit * 4, 12)]);
  const context = buildSocialPromptContextFromItems(result.rows, { topic, kind, limit: cappedLimit });
  await db.query(`
    INSERT INTO social_prompt_context (
      user_id, topic_key, kind, dominant_tone, strong_phrases, creative_angles,
      clip_ideas, song_prompt_seeds, hashtags, avoid, source_item_ids, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,NOW(),NOW())
    ON CONFLICT (user_id, topic_key, kind) DO UPDATE SET
      dominant_tone = EXCLUDED.dominant_tone,
      strong_phrases = EXCLUDED.strong_phrases,
      creative_angles = EXCLUDED.creative_angles,
      clip_ideas = EXCLUDED.clip_ideas,
      song_prompt_seeds = EXCLUDED.song_prompt_seeds,
      hashtags = EXCLUDED.hashtags,
      avoid = EXCLUDED.avoid,
      source_item_ids = EXCLUDED.source_item_ids,
      updated_at = NOW()
  `, [
    storageUserId,
    topicKey(topic),
    normalizeKind(kind),
    context.dominantTone,
    JSON.stringify(context.strongPhrases),
    JSON.stringify(context.creativeAngles),
    JSON.stringify(context.clipIdeas),
    JSON.stringify(context.songPromptSeeds),
    JSON.stringify(context.hashtags),
    JSON.stringify(context.avoid),
    JSON.stringify(context.sourceItems.map((item) => item.id).filter(Boolean)),
  ]);
  return context;
}

function formatSocialContextForPrompt(context = {}) {
  if (!context || typeof context !== 'object') return '';
  const lines = [
    '[Contexte social créatif Funesterie - privé, non chantable]',
    context.dominantTone ? `Ton récent: ${context.dominantTone}` : '',
    Array.isArray(context.strongPhrases) && context.strongPhrases.length
      ? `Phrases fortes à transformer sans citer directement: ${context.strongPhrases.slice(0, 4).join(' | ')}`
      : '',
    Array.isArray(context.creativeAngles) && context.creativeAngles.length
      ? `Angles chanson possibles: ${context.creativeAngles.slice(0, 4).join(' | ')}`
      : '',
    Array.isArray(context.clipIdeas) && context.clipIdeas.length
      ? `Angles clip possibles: ${context.clipIdeas.slice(0, 3).join(' | ')}`
      : '',
    Array.isArray(context.hashtags) && context.hashtags.length
      ? `Hashtags utiles pour la publication, pas pour les paroles: ${context.hashtags.slice(0, 8).join(' ')}`
      : '',
    Array.isArray(context.avoid) && context.avoid.length
      ? `À éviter: ${context.avoid.slice(0, 4).join(' | ')}`
      : '',
    'Utilise ce bloc comme direction d’écriture et d’image seulement. Ne récite jamais ce bloc dans les paroles.',
  ].filter(Boolean);
  return lines.join('\n');
}

async function exchangeYoutubeCode({ code, req, env = process.env, fetchFn = globalThis.fetch } = {}) {
  const config = resolveProviderConfig('youtube', { env, req });
  if (!config.configured) {
    const error = new Error('youtube_oauth_not_configured');
    error.data = { missing: config.missing };
    throw error;
  }
  const body = new URLSearchParams({
    code: cleanText(code, 4000),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetchFn(YOUTUBE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error_description || data?.error || `youtube_oauth_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function exchangeMetaCode({ code, req, env = process.env, fetchFn = globalThis.fetch } = {}) {
  const config = resolveProviderConfig('meta', { env, req });
  if (!config.configured) {
    const error = new Error('meta_oauth_not_configured');
    error.data = { missing: config.missing };
    throw error;
  }

  const tokenUrl = new URL(META_TOKEN_URL);
  tokenUrl.searchParams.set('client_id', config.clientId);
  tokenUrl.searchParams.set('client_secret', config.clientSecret);
  tokenUrl.searchParams.set('redirect_uri', config.redirectUri);
  tokenUrl.searchParams.set('code', cleanText(code, 4000));
  const response = await fetchFn(tokenUrl, {
    headers: { accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error_description || data?.error || `meta_oauth_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  if (data?.access_token) {
    try {
      const longLivedUrl = new URL(META_TOKEN_URL);
      longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
      longLivedUrl.searchParams.set('client_id', config.clientId);
      longLivedUrl.searchParams.set('client_secret', config.clientSecret);
      longLivedUrl.searchParams.set('fb_exchange_token', data.access_token);
      const longLivedResponse = await fetchFn(longLivedUrl, {
        headers: { accept: 'application/json' },
      });
      const longLivedData = await longLivedResponse.json().catch(() => ({}));
      if (longLivedResponse.ok && longLivedData?.access_token) {
        return {
          ...data,
          ...longLivedData,
          scope: longLivedData.scope || data.scope,
        };
      }
    } catch {
      // A short-lived Meta token is still usable; the account will be marked
      // reconnect_required once Meta refuses it.
    }
  }

  return data;
}

async function ingestSoundCloudRssFeed(db, { userId = 'admin', feedUrl = '', limit = 12, fetchFn = globalThis.fetch, env = process.env } = {}) {
  await ensureSocialSchema(db);
  const configuredFeedUrl = cleanText(feedUrl || env.SOCIAL_SOUNDCLOUD_RSS_URL || env.SOUNDCLOUD_RSS_URL, 1000);
  if (!configuredFeedUrl) return { ok: false, error: 'soundcloud_rss_url_missing' };
  const fetched = await fetchSocialRssXml(configuredFeedUrl, { fetchFn, env });
  const parsed = parseSocialRssItems(fetched.xml, { limit });
  const account = await upsertSocialAccount(db, {
    userId,
    provider: 'soundcloud_rss',
    accountExternalId: crypto.createHash('sha256').update(fetched.url).digest('hex').slice(0, 24),
    accountLabel: parsed.channel.title || 'SoundCloud RSS',
    scopes: ['rss.read'],
    tokens: {},
    metadata: {
      feedUrl: fetched.url,
      channelLink: parsed.channel.link,
      channelDescription: parsed.channel.description,
    },
  }, env);
  const savedIds = [];
  for (const item of parsed.items) {
    const savedId = await upsertSocialItem(db, item, account);
    if (savedId) savedIds.push(savedId);
  }
  await db.query('UPDATE social_accounts SET last_ingest_at = NOW(), updated_at = NOW() WHERE id = $1', [account.id]);
  const context = await buildAndStoreSocialPromptContext(db, {
    userId: account.user_id,
    topic: '',
    kind: 'chanson',
    limit: 8,
  });
  await db.query(`
    INSERT INTO social_context_snapshots (user_id, provider, topic, summary_json, created_at)
    VALUES ($1, 'soundcloud_rss', $2, $3::jsonb, NOW())
  `, [account.user_id, '', JSON.stringify(context)]);
  return {
    ok: true,
    provider: 'soundcloud_rss',
    feedUrl: fetched.url,
    channel: parsed.channel.title,
    items: savedIds.length,
    sourceItemIds: savedIds,
    context,
  };
}

async function exchangeSoundCloudCode({ code, codeVerifier, req, env = process.env, fetchFn = globalThis.fetch } = {}) {
  const config = resolveProviderConfig('soundcloud', { env, req });
  if (!config.configured) {
    const error = new Error('soundcloud_oauth_not_configured');
    error.data = { missing: config.missing };
    throw error;
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: cleanText(codeVerifier, 4000),
    code: cleanText(code, 4000),
  });
  const response = await fetchFn(SOUNDCLOUD_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json; charset=utf-8' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error_description || data?.error || `soundcloud_oauth_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function buildProviderAuthUrl(provider, { state, req, env = process.env, codeChallenge = '' } = {}) {
  const normalized = normalizeProvider(provider);
  const config = resolveProviderConfig(normalized, { env, req });
  if (!config.configured) return { ok: false, provider: normalized, configured: false, missing: config.missing };
  if (normalized === 'youtube') {
    const url = new URL(YOUTUBE_AUTH_URL);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.scopes.join(' '));
    url.searchParams.set('access_type', 'offline');
    // Ne jamais agréger un ancien consentement Google plus large au jeton
    // social courant: ce flux reste strictement limité aux deux scopes YouTube.
    url.searchParams.set('include_granted_scopes', 'false');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return { ok: true, provider: normalized, url: url.toString(), scopes: config.scopes, redirectUri: config.redirectUri };
  }
  if (normalized === 'meta') {
    const url = new URL(META_AUTH_URL);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.scopes.join(','));
    url.searchParams.set('state', state);
    return { ok: true, provider: normalized, url: url.toString(), scopes: config.scopes, redirectUri: config.redirectUri };
  }
  if (normalized === 'soundcloud') {
    const url = new URL(SOUNDCLOUD_AUTH_URL);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    if (config.scopes?.length) url.searchParams.set('scope', config.scopes.join(' '));
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    url.searchParams.set('state', state);
    return { ok: true, provider: normalized, url: url.toString(), scopes: config.scopes, redirectUri: config.redirectUri };
  }
  return { ok: false, provider: normalized, configured: false, missing: ['provider_unsupported'] };
}

async function setSocialAccountPaused(db, { provider, userId = 'admin', paused = true } = {}) {
  await ensureSocialSchema(db);
  const result = await db.query(`
    UPDATE social_accounts
    SET paused = $3, updated_at = NOW()
    WHERE provider = $1 AND user_id = $2
    RETURNING id, user_id, provider, account_label, account_external_id, scopes, token_hash, expires_at,
      last_refresh_at, last_ingest_at, status, reconnect_required, paused, metadata_json, created_at, updated_at
  `, [normalizeProvider(provider), cleanOneLine(userId, 'admin', 160), paused === true]);
  return result.rows[0] ? redactAccount(result.rows[0]) : null;
}

async function disconnectSocialAccount(db, { provider, userId = 'admin' } = {}) {
  await ensureSocialSchema(db);
  const result = await db.query(`
    UPDATE social_accounts
    SET status = 'disconnected', token_sealed = NULL, token_hash = NULL,
        reconnect_required = FALSE, paused = FALSE, updated_at = NOW()
    WHERE provider = $1 AND user_id = $2
    RETURNING id, user_id, provider, account_label, account_external_id, scopes, token_hash, expires_at,
      last_refresh_at, last_ingest_at, status, reconnect_required, paused, metadata_json, created_at, updated_at
  `, [normalizeProvider(provider), cleanOneLine(userId, 'admin', 160)]);
  return result.rows[0] ? redactAccount(result.rows[0]) : null;
}

async function purgeSocialContext(db, { provider = '', userId = 'admin' } = {}) {
  await ensureSocialSchema(db);
  const normalizedProvider = normalizeProvider(provider);
  const params = [cleanOneLine(userId, 'admin', 160)];
  const providerWhere = normalizedProvider ? 'AND provider = $2' : '';
  if (normalizedProvider) params.push(normalizedProvider);
  const items = await db.query(`DELETE FROM social_items WHERE user_id = $1 ${providerWhere}`, params);
  const snapshots = await db.query(`DELETE FROM social_context_snapshots WHERE user_id = $1 ${providerWhere}`, params);
  const promptContext = await db.query('DELETE FROM social_prompt_context WHERE user_id = $1', [params[0]]);
  return {
    ok: true,
    deleted: {
      items: items.rowCount || 0,
      snapshots: snapshots.rowCount || 0,
      promptContext: promptContext.rowCount || 0,
    },
  };
}

module.exports = {
  DEFAULT_META_SCOPES,
  DEFAULT_SOUNDCLOUD_SCOPES,
  DEFAULT_YOUTUBE_SCOPES,
  SOCIAL_SCHEMA_VERSION,
  YOUTUBE_PUBLIC_CONTEXT_MIGRATION,
  buildAndStoreSocialPromptContext,
  buildProviderAuthUrl,
  buildSocialAutopromptRedactedStatus,
  buildSocialPromptContextFromItems,
  claimSocialPublicationRequest,
  cleanText,
  completeSocialPublicationRequest,
  exchangeMetaCode,
  exchangeSoundCloudCode,
  exchangeYoutubeCode,
  ensureSocialSchema,
  formatSocialContextForPrompt,
  getFreshSocialTokens,
  getSoundCloudAccountIdentity,
  fetchSocialRssXml,
  fetchYoutubePublicFeedVideoIds,
  fetchYoutubePublicVideoItems,
  ingestSoundCloudRssFeed,
  ingestYoutubeAccount,
  listSocialAccounts,
  normalizeKind,
  normalizeProvider,
  parseYoutubeAtomVideoIds,
  purgeSocialContext,
  redactAccount,
  refreshYoutubeAccount,
  refreshSoundCloudAccount,
  resolveProviderConfig,
  runSocialDataMigrations,
  setSocialAccountPaused,
  startSocialPublicationAttempt,
  disconnectSocialAccount,
  splitScopes,
  parseSocialRssItems,
  uploadSoundCloudTrack,
  upsertSocialAccount,
};

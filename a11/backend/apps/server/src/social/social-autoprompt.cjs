'use strict';

const crypto = require('node:crypto');

const SOCIAL_SCHEMA_VERSION = 'funesterie.social-autoprompt.v1';
const YOUTUBE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const META_AUTH_URL = 'https://www.facebook.com/v22.0/dialog/oauth';
const META_TOKEN_URL = 'https://graph.facebook.com/v22.0/oauth/access_token';

const DEFAULT_YOUTUBE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.readonly',
];

const DEFAULT_META_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
];

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
    const scopes = splitScopes(firstEnv(env, ['SOCIAL_YOUTUBE_SCOPES', 'YOUTUBE_OAUTH_SCOPES']))
      .concat(DEFAULT_YOUTUBE_SCOPES);
    const uniqueScopes = unique(scopes, 16);
    const clientId = firstEnv(env, ['SOCIAL_YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_ID', 'GOOGLE_CLIENT_ID', 'A11_GOOGLE_CLIENT_ID']);
    const clientSecret = firstEnv(env, ['SOCIAL_YOUTUBE_CLIENT_SECRET', 'YOUTUBE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET', 'A11_GOOGLE_CLIENT_SECRET']);
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
  return { ok: true };
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
  const youtubeConnected = isConnectedAccount(youtubeAccount);
  const metaConnected = isConnectedAccount(metaAccount);

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
  const socialPromptContextAvailable = socialPromptContextCount > 0 || youtubeItemsCount > 0;
  const primaryCreativeSource = youtubeItemsCount > 0
    ? 'youtube'
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

async function getFreshSocialTokens(db, { provider, userId = 'admin' } = {}, env = process.env, fetchFn = globalThis.fetch) {
  const account = await getSocialAccountWithTokens(db, { provider, userId }, env);
  if (!account) return null;
  const expiresAt = account.tokens?.expiresAt ? new Date(account.tokens.expiresAt).getTime() : 0;
  const refreshWindowMs = 10 * 60 * 1000;
  if (expiresAt && expiresAt - Date.now() < refreshWindowMs && normalizeProvider(provider) === 'youtube') {
    const refreshed = await refreshYoutubeAccount(db, account.row, account.tokens, env, fetchFn);
    if (!refreshed.ok) return { ...account, refresh: refreshed };
    return getSocialAccountWithTokens(db, { provider, userId }, env);
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

function youtubeWatchUrl(videoId = '') {
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '';
}

function normalizeYoutubeVideoItem(video = {}, fallback = {}) {
  const snippet = video.snippet || fallback.snippet || {};
  const stats = video.statistics || {};
  const id = cleanText(video.id || fallback.contentDetails?.videoId || fallback.snippet?.resourceId?.videoId, 120);
  return {
    externalId: id,
    itemType: 'video',
    title: cleanOneLine(snippet.title, 'Vidéo YouTube', 280),
    description: cleanText(snippet.description, 5000),
    url: youtubeWatchUrl(id),
    publishedAt: snippet.publishedAt || fallback.contentDetails?.videoPublishedAt || fallback.snippet?.publishedAt || null,
    stats,
    raw: {
      id,
      snippet: {
        title: snippet.title,
        channelTitle: snippet.channelTitle,
        publishedAt: snippet.publishedAt,
        tags: snippet.tags || [],
        categoryId: snippet.categoryId,
      },
      statistics: stats,
    },
  };
}

async function fetchYoutubeCommentSummary(videoId, accessToken, fetchFn = globalThis.fetch) {
  try {
    const data = await youtubeApi('/commentThreads', accessToken, {
      part: 'snippet',
      videoId,
      maxResults: 20,
      order: 'relevance',
      textFormat: 'plainText',
    }, fetchFn);
    const comments = (data.items || [])
      .map((item) => item?.snippet?.topLevelComment?.snippet?.textDisplay || item?.snippet?.topLevelComment?.snippet?.textOriginal)
      .map((entry) => cleanText(entry, 240))
      .filter(Boolean)
      .slice(0, 8);
    return comments.join(' | ');
  } catch {
    return '';
  }
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
  const channels = await youtubeApi('/channels', accessToken, {
    part: 'snippet,statistics,contentDetails',
    mine: 'true',
    maxResults: 5,
  }, fetchFn);
  const channel = channels.items?.[0] || {};
  const channelId = cleanText(channel.id || account.account_external_id, 180);
  const uploadsPlaylistId = cleanText(channel.contentDetails?.relatedPlaylists?.uploads, 180);
  if (channelId && channelId !== account.account_external_id) {
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
      metadata: {
        ...(account.metadata_json || {}),
        channelStatistics: channel.statistics || {},
        channelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : '',
      },
    }, env);
    account.id = updated.id || account.id;
    account.account_external_id = channelId;
    account.account_label = cleanOneLine(channel.snippet?.title, account.account_label || 'YouTube', 200);
    account.metadata_json = { ...(account.metadata_json || {}), channelStatistics: channel.statistics || {} };
  }

  let playlistItems = [];
  if (uploadsPlaylistId) {
    const playlist = await youtubeApi('/playlistItems', accessToken, {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: Math.max(1, Math.min(50, Number(limit) || 12)),
    }, fetchFn);
    playlistItems = playlist.items || [];
  } else {
    const search = await youtubeApi('/search', accessToken, {
      part: 'snippet',
      forMine: 'true',
      type: 'video',
      maxResults: Math.max(1, Math.min(50, Number(limit) || 12)),
    }, fetchFn);
    playlistItems = search.items || [];
  }
  const ids = unique(playlistItems.map((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || item.id?.videoId), 50);
  if (!ids.length) {
    await db.query('UPDATE social_accounts SET last_ingest_at = NOW(), updated_at = NOW() WHERE id = $1', [account.id]);
    return { ok: true, provider: 'youtube', items: 0, context: null };
  }
  const videos = await youtubeApi('/videos', accessToken, {
    part: 'snippet,statistics,contentDetails',
    id: ids.join(','),
    maxResults: ids.length,
  }, fetchFn);
  const byId = new Map((videos.items || []).map((item) => [cleanText(item.id, 120), item]));
  const savedIds = [];
  for (const fallback of playlistItems) {
    const id = cleanText(fallback.contentDetails?.videoId || fallback.snippet?.resourceId?.videoId || fallback.id?.videoId, 120);
    if (!id) continue;
    const item = normalizeYoutubeVideoItem(byId.get(id) || {}, fallback);
    item.commentsSummary = await fetchYoutubeCommentSummary(id, accessToken, fetchFn);
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

function buildProviderAuthUrl(provider, { state, req, env = process.env } = {}) {
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
    url.searchParams.set('include_granted_scopes', 'true');
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
  DEFAULT_YOUTUBE_SCOPES,
  SOCIAL_SCHEMA_VERSION,
  buildAndStoreSocialPromptContext,
  buildProviderAuthUrl,
  buildSocialAutopromptRedactedStatus,
  buildSocialPromptContextFromItems,
  cleanText,
  exchangeMetaCode,
  exchangeYoutubeCode,
  ensureSocialSchema,
  formatSocialContextForPrompt,
  getFreshSocialTokens,
  ingestYoutubeAccount,
  listSocialAccounts,
  normalizeKind,
  normalizeProvider,
  purgeSocialContext,
  redactAccount,
  refreshYoutubeAccount,
  resolveProviderConfig,
  setSocialAccountPaused,
  disconnectSocialAccount,
  splitScopes,
  upsertSocialAccount,
};

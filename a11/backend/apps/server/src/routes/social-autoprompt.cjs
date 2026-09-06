'use strict';

const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const { uploadVideo: uploadYoutubeVideo } = require('../social/youtube-upload.cjs');
const {
  resolveAccountTier,
} = require('../auth/account-connectors.cjs');
const {
  buildAndStoreSocialPromptContext,
  buildProviderAuthUrl,
  buildSocialAutopromptRedactedStatus,
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
  ingestYoutubeAccount,
  listSocialAccounts,
  normalizeKind,
  normalizeProvider,
  purgeSocialContext,
  resolveProviderConfig,
  setSocialAccountPaused,
  startSocialPublicationAttempt,
  disconnectSocialAccount,
  splitScopes,
  uploadSoundCloudTrack,
  upsertSocialAccount,
} = require('../social/social-autoprompt.cjs');

const SOCIAL_OAUTH_COOKIE = 'a11_social_oauth_state';
const SOCIAL_PKCE_COOKIE = 'a11_social_oauth_pkce';
const SOCIAL_ALLOWED_TIERS = new Set(['admin', 'admin_family', 'founder', 'family', 'premium']);
const GENERATED_VIDEO_PUBLIC_PREFIX = '/files/runtime/files/generated/videos/';
const VIDEO_FILE_PATTERN = /^[\w.-]+\.(?:mp4|mov|webm|mkv)$/i;
const YOUTUBE_SOURCE_FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const YOUTUBE_SOURCE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const YOUTUBE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DEFAULT_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H = 20;

// Verrou volontairement global au module: tous les routeurs du processus
// partagent la meme section critique telechargement + upload.
let youtubePublicationInFlight = false;

function boolEnv(name, fallback = false, env = process.env) {
  const raw = String(env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function getAdminUserId(req) {
  return cleanText(
    req?.user?.id
    || req?.user?.username
    || req?.user?.email
    || process.env.SOCIAL_CONTEXT_USER_ID
    || process.env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID
    || 'admin',
    160
  ) || 'admin';
}

function redactedProviderConfig(req, env = process.env) {
  return ['youtube', 'meta', 'soundcloud'].map((provider) => {
    const config = resolveProviderConfig(provider, { env, req });
    return {
      provider: config.provider,
      configured: config.configured,
      plannedOnly: config.plannedOnly === true,
      scopes: config.scopes || [],
      redirectUri: config.redirectUri || '',
      missing: config.missing || [],
    };
  });
}

function createOauthState({ provider, userId }) {
  const nonce = crypto.randomBytes(18).toString('base64url');
  return Buffer.from(JSON.stringify({
    provider,
    userId,
    nonce,
    issuedAt: Date.now(),
  })).toString('base64url');
}

function createPkcePair() {
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

function parseOauthState(value = '') {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.issuedAt || 0) > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setPkceCookie(res, payload = {}) {
  res.cookie(SOCIAL_PKCE_COOKIE, Buffer.from(JSON.stringify(payload)).toString('base64url'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 15 * 60 * 1000,
  });
}

function readPkceCookie(req) {
  try {
    const value = readCookie(req, SOCIAL_PKCE_COOKIE);
    if (!value) return null;
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - Number(parsed.issuedAt || 0) > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setOauthCookie(res, state) {
  res.cookie(SOCIAL_OAUTH_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 15 * 60 * 1000,
  });
}

function clearOauthCookie(res) {
  res.clearCookie(SOCIAL_OAUTH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  res.clearCookie(SOCIAL_PKCE_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function readCookie(req, name) {
  const parsed = req.cookies?.[name];
  if (parsed) return String(parsed);
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('=') || '');
  }
  return '';
}

function hasSocialConnectAccess(req, { isAdminRequest, env = process.env } = {}) {
  if (typeof isAdminRequest === 'function' && isAdminRequest(req)) return true;
  const tier = String(resolveAccountTier(req?.user || {}, env) || '').trim().toLowerCase();
  return SOCIAL_ALLOWED_TIERS.has(tier);
}

function resolveSocialContextUserId(env = process.env) {
  return cleanText(
    env.SOCIAL_CONTEXT_USER_ID
    || env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID
    || '',
    160
  );
}

function createRequireSocialConnectAccess({
  isAdminRequest,
  verifyJWT,
  env = process.env,
  buildForbiddenBody,
} = {}) {
  function sendForbidden(req, res) {
    const payload = typeof buildForbiddenBody === 'function'
      ? buildForbiddenBody(req, res)
      : {
          ok: false,
          error: 'social_connect_access_required',
          message: 'Accès réservé aux comptes Premium, Famille, Fondateur ou Admin.',
        };

    return res.status(403).json(payload);
  }

  return function requireSocialConnectAccess(req, res, next) {
    if (hasSocialConnectAccess(req, { isAdminRequest, env })) {
      return next();
    }

    if (typeof verifyJWT !== 'function') {
      return sendForbidden(req, res);
    }

    return verifyJWT(req, res, () => {
      if (hasSocialConnectAccess(req, { isAdminRequest, env })) {
        return next();
      }
      return sendForbidden(req, res);
    });
  };
}

async function getYoutubeChannelIdentity(accessToken, fetchFn = globalThis.fetch) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('fields', 'items(id,snippet(title))');
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout?.(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return {};
  const channel = data.items?.[0] || {};
  return {
    accountExternalId: cleanText(channel.id, 180) || 'youtube',
    accountLabel: cleanText(channel.snippet?.title, 200) || 'YouTube',
    metadata: {
      channelTitle: cleanText(channel.snippet?.title, 200),
      channelUrl: channel.id ? `https://www.youtube.com/channel/${channel.id}` : '',
    },
  };
}

function resolveSocialPublicationCapabilities(req, env = process.env) {
  const youtube = resolveProviderConfig('youtube', { req, env });
  const soundcloud = resolveProviderConfig('soundcloud', { req, env });
  const youtubePublicationEnabled = youtube.configured === true;
  const soundcloudPublicationEnabled = soundcloud.configured === true || soundcloud.envTokenConfigured === true;
  return {
    publicationEnabled: youtubePublicationEnabled || soundcloudPublicationEnabled,
    youtubePublicationEnabled,
    soundcloudPublicationEnabled,
  };
}

function resolveYoutubeUploadHttpError(error) {
  const code = cleanText(error?.code, 60);
  if (code === 'youtube_upload_source_too_large') {
    return {
      status: 413,
      body: {
        ok: false,
        error: code,
        message: 'La video source depasse la taille maximale autorisee.',
      },
    };
  }
  if (code === 'youtube_upload_source_timeout') {
    return {
      status: 504,
      body: {
        ok: false,
        error: code,
        message: "Le telechargement de la video source n'a pas termine a temps.",
      },
    };
  }
  if (code === 'youtube_upload_source_redirect_refused' || code === 'youtube_upload_source_fetch_failed') {
    return {
      status: 502,
      body: {
        ok: false,
        error: code,
        status: error?.upstreamStatus,
        message: code === 'youtube_upload_source_redirect_refused'
          ? 'La video source a tente une redirection refusee.'
          : 'La video source distante est indisponible.',
      },
    };
  }
  if (code === 'youtube_upload_scope_missing') {
    return {
      status: 403,
      body: {
        ok: false,
        error: code,
        reconnectRequired: true,
        message: "Le jeton ne porte pas youtube.upload. Reconnecter la chaine pour reconsentir: un jeton emis avant l'ajout du perimetre ne l'a pas.",
      },
    };
  }
  if (code === 'youtube_upload_quota_exceeded') {
    return {
      status: 429,
      body: {
        ok: false,
        error: code,
        message: 'Le quota YouTube API est epuise. Reessayer apres son renouvellement ou augmenter le quota du projet.',
      },
    };
  }
  if (code === 'youtube_upload_daily_limit_exceeded') {
    return {
      status: 429,
      body: {
        ok: false,
        error: code,
        message: 'La limite quotidienne YouTube API est atteinte. Reessayer apres son renouvellement.',
      },
    };
  }
  if (code === 'youtube_upload_limit_exceeded') {
    return {
      status: 429,
      body: {
        ok: false,
        error: code,
        message: "La chaine a atteint sa limite d'envoi YouTube. Reessayer apres la levee de cette limite.",
      },
    };
  }
  if (code === 'youtube_upload_forbidden') {
    return {
      status: 403,
      body: {
        ok: false,
        error: code,
        message: "YouTube a refuse cet envoi. Verifier les droits de la chaine et les restrictions applicables a la video.",
      },
    };
  }
  return null;
}

function normalizeYoutubeUploadIdempotencyKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'youtube_upload_idempotency_key_required' };
  }
  const key = value.trim();
  if (!YOUTUBE_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return { ok: false, error: 'youtube_upload_idempotency_key_invalid' };
  }
  return { ok: true, key };
}

function resolveYoutubeUploadAttemptLimit(env = process.env) {
  const parsed = Number(env?.SOCIAL_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H);
  if (!Number.isFinite(parsed)) return DEFAULT_YOUTUBE_UPLOAD_MAX_ATTEMPTS_24H;
  return Math.max(0, Math.min(10000, Math.floor(parsed)));
}

function tryAcquireYoutubePublicationLock() {
  if (youtubePublicationInFlight) return null;
  youtubePublicationInFlight = true;
  let released = false;
  return function releaseYoutubePublicationLock() {
    if (released) return;
    released = true;
    youtubePublicationInFlight = false;
  };
}

function youtubeSourceFingerprint(source = {}) {
  if (source.kind === 'file') {
    let stat = null;
    try { stat = fs.statSync(source.path); } catch { /* la route reverifiera en ouvrant */ }
    return {
      kind: 'file',
      canonicalPath: path.resolve(source.path || ''),
      bytes: stat?.size ?? null,
      modifiedMs: stat ? Math.trunc(stat.mtimeMs) : null,
    };
  }
  return {
    kind: source.kind === 'url' ? 'url' : 'unknown',
    canonicalUrl: source.kind === 'url' ? String(source.url || '') : '',
  };
}

function youtubeSourceFilename(source = {}) {
  if (source.kind === 'file') return path.basename(source.path || 'video.mp4');
  if (source.kind === 'url') {
    try { return path.posix.basename(new URL(source.url).pathname) || 'video.mp4'; } catch { return 'video.mp4'; }
  }
  return 'video.mp4';
}

function buildYoutubeUploadMetadata(body = {}, source = {}) {
  return {
    title: cleanText(body.title, 100) || youtubeSourceFilename(source).replace(/\.[^.]+$/, ''),
    description: cleanText(body.description, 5000),
    tags: Array.isArray(body.tags) ? body.tags.map((tag) => cleanText(tag, 100)).filter(Boolean) : [],
    categoryId: cleanText(body.categoryId, 8) || '10',
    privacyStatus: cleanText(body.privacyStatus, 20) || 'private',
    madeForKids: body.madeForKids === true,
    publishAt: cleanText(body.publishAt, 40),
  };
}

function buildYoutubePublicationRequestHash({ userId = '', source = {}, metadata = {} } = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    version: 1,
    userId: cleanText(userId, 160),
    provider: 'youtube',
    source: youtubeSourceFingerprint(source),
    metadata,
  })).digest('hex');
}

function resolveYoutubePublicationClaimHttpResponse(claim = {}) {
  if (claim.outcome === 'claimed') return null;
  if (claim.outcome === 'succeeded' && claim.request?.result) {
    return {
      status: 200,
      body: { ...claim.request.result, idempotentReplay: true },
    };
  }
  if (claim.outcome === 'mismatch') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'youtube_upload_idempotency_mismatch',
        message: 'Cette cle appartient a une autre source ou a d autres metadonnees. Abandonne explicitement la tentative avant d en creer une nouvelle.',
      },
    };
  }
  if (claim.outcome === 'failed') {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'youtube_upload_previous_attempt_failed',
        outcome: 'failed',
        previousError: claim.request?.errorCode || undefined,
        outcomeToVerify: true,
        message: 'Cette tentative ne sera pas relancee. Verifie la chaine, puis abandonne-la explicitement pour obtenir une nouvelle cle.',
      },
    };
  }
  if (claim.outcome === 'quota') {
    return {
      status: 429,
      retryAfterSeconds: claim.retryAfterSeconds,
      body: {
        ok: false,
        error: 'youtube_upload_attempt_quota_exceeded',
        used: claim.used,
        limit: claim.limit,
        windowSeconds: 24 * 60 * 60,
        message: 'La limite globale de tentatives YouTube sur 24 heures est atteinte.',
      },
    };
  }
  return {
    status: 409,
    body: {
      ok: false,
      error: 'youtube_upload_outcome_pending',
      outcome: 'pending',
      outcomeToVerify: true,
      message: 'Le resultat de cette tentative doit etre verifie sur la chaine. Elle ne sera pas relancee avec la meme cle.',
    },
  };
}

function normalizeMetaPageInstagramContext(pages = []) {
  const facebookPages = [];
  const instagramAccounts = [];
  const seenInstagramIds = new Set();
  for (const page of Array.isArray(pages) ? pages : []) {
    const pageId = cleanText(page?.id, 180);
    const pageName = cleanText(page?.name, 200);
    if (pageId || pageName) {
      facebookPages.push({
        id: pageId,
        name: pageName,
      });
    }

    const instagram = page?.instagram_business_account;
    const instagramId = cleanText(instagram?.id, 180);
    const username = cleanText(instagram?.username, 120);
    const name = cleanText(instagram?.name, 200);
    const dedupeKey = instagramId || username;
    if (!dedupeKey || seenInstagramIds.has(dedupeKey)) continue;
    seenInstagramIds.add(dedupeKey);
    instagramAccounts.push({
      id: instagramId,
      username,
      name,
      pageId,
      pageName,
    });
  }
  return {
    facebookPages: facebookPages.slice(0, 20),
    instagramAccounts: instagramAccounts.slice(0, 20),
    instagramDetected: instagramAccounts.length > 0,
  };
}

async function getMetaPageInstagramContext(accessToken, fetchFn = globalThis.fetch) {
  const url = new URL('https://graph.facebook.com/v22.0/me/accounts');
  url.searchParams.set('fields', 'id,name,instagram_business_account{id,username,name}');
  url.searchParams.set('limit', '25');
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout?.(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      facebookPages: [],
      instagramAccounts: [],
      instagramDetected: false,
      instagramLookupError: cleanText(data?.error?.message || data?.error_description || `meta_pages_http_${response.status}`, 240),
    };
  }
  return normalizeMetaPageInstagramContext(data?.data || []);
}

async function getMetaAccountIdentity(accessToken, fetchFn = globalThis.fetch) {
  const url = new URL('https://graph.facebook.com/v22.0/me');
  url.searchParams.set('fields', 'id,name');
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout?.(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.error_description || `meta_http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  let pageInstagramContext = {
    facebookPages: [],
    instagramAccounts: [],
    instagramDetected: false,
  };
  try {
    pageInstagramContext = await getMetaPageInstagramContext(accessToken, fetchFn);
  } catch (error) {
    pageInstagramContext = {
      facebookPages: [],
      instagramAccounts: [],
      instagramDetected: false,
      instagramLookupError: cleanText(error?.message || error, 240),
    };
  }
  return {
    accountExternalId: cleanText(data.id, 180) || 'meta',
    accountLabel: cleanText(data.name, 200) || 'Facebook / Instagram',
    metadata: {
      metaName: cleanText(data.name, 200),
      ...pageInstagramContext,
      connectedAt: new Date().toISOString(),
    },
  };
}

function resolveGeneratedAudioFile(filename = '', env = process.env) {
  const safe = path.basename(cleanText(filename, 260));
  if (!/^[\w.-]+\.(?:wav|flac|mp3|m4a|ogg)$/i.test(safe)) return '';
  const runtimeRoot = path.resolve(getCanonicalRuntimeRoot(env));
  const candidates = [
    path.join(runtimeRoot, 'double-harmonic-d40', safe),
    path.join(runtimeRoot, 'files', safe),
    path.join(runtimeRoot, 'files', 'uploads', safe),
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(runtimeRoot)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return '';
}

/**
 * Resout la source d'une video a publier: fichier genere local, ou URL R2.
 *
 * Le full clip envoie son rendu sur R2 puis SUPPRIME son workDir
 * (src/video/full-clip.cjs): la video n'existe donc souvent que comme URL. Il faut
 * accepter les deux, sinon la seule source reellement disponible est refusee.
 *
 * L'URL est bornee a la base publique R2 configuree. Telecharger une URL
 * arbitraire fournie par l'appelant ferait de cette route un relais SSRF: le
 * serveur irait chercher n'importe quelle adresse interne pour le compte de qui
 * appelle. La liste blanche n'est donc pas du zele, c'est la seule chose qui
 * empeche cet usage.
 */
function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveContainedRealFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isPathInside(resolvedRoot, resolvedCandidate)) {
    return { kind: 'invalid', reason: 'chemin video hors du runtime' };
  }
  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realCandidate = fs.realpathSync(resolvedCandidate);
    if (!isPathInside(realRoot, realCandidate)) {
      return { kind: 'invalid', reason: 'chemin video hors du runtime' };
    }
    if (!fs.statSync(realCandidate).isFile()) return { kind: 'missing' };
    return { kind: 'file', path: realCandidate };
  } catch {
    return { kind: 'missing' };
  }
}

function resolveGeneratedVideoFile(relativeInput = '', env = process.env) {
  let normalized = String(relativeInput || '').trim().replace(/\\/g, '/');
  try { normalized = decodeURIComponent(normalized); } catch { return { kind: 'invalid', reason: 'chemin video illisible' }; }

  if (normalized.startsWith(GENERATED_VIDEO_PUBLIC_PREFIX)) {
    normalized = normalized.slice(GENERATED_VIDEO_PUBLIC_PREFIX.length);
  } else if (normalized.startsWith('files/generated/videos/')) {
    normalized = normalized.slice('files/generated/videos/'.length);
  } else if (normalized.startsWith('generated/videos/')) {
    normalized = normalized.slice('generated/videos/'.length);
  }

  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    return { kind: 'invalid', reason: 'chemin video hors du runtime' };
  }
  if (!VIDEO_FILE_PATTERN.test(segments.at(-1))) {
    return { kind: 'invalid', reason: 'extension video attendue' };
  }

  const runtimeRoot = path.resolve(getCanonicalRuntimeRoot(env));
  const generatedRoot = path.resolve(runtimeRoot, 'files', 'generated', 'videos');
  const candidate = path.resolve(generatedRoot, ...segments);
  // Un lien symbolique place dans le runtime ne doit pas permettre de sortir de
  // l'arborescence canonique, meme si le chemin lexical parait correct.
  return resolveContainedRealFile(generatedRoot, candidate);
}

function configuredApplicationOrigins(env = process.env) {
  const values = [
    env.SOCIAL_PUBLIC_BASE_URL,
    env.PUBLIC_API_URL,
    env.VIVY_PUBLIC_BASE_URL,
    env.PUBLIC_APP_URL,
    env.APP_URL,
    env.API_URL,
    env.A11_SERVER_URL,
  ];
  const origins = new Set();
  for (const value of values) {
    try {
      const parsed = new URL(cleanText(value, 500));
      if (parsed.protocol === 'https:') origins.add(parsed.origin);
    } catch { /* variable absente ou invalide */ }
  }
  return origins;
}

function resolveGeneratedVideoSource(input = '', env = process.env) {
  const brut = cleanText(input, 600);
  if (!brut) return { kind: 'none' };

  if (/^https?:\/\//i.test(brut)) {
    const bases = [
      env.R2_PUBLIC_BASE_URL,
      env.A11_R2_PUBLIC_BASE_URL,
      env.R2_PUBLIC_URL,
    ].map((v) => cleanText(v, 300).replace(/\/+$/, '')).filter(Boolean);
    let url;
    try { url = new URL(brut); } catch { return { kind: 'invalid', reason: 'URL illisible' }; }
    if (url.protocol !== 'https:') return { kind: 'invalid', reason: 'https exige' };

    // La pipeline video renvoie cette URL exacte quand R2 n'est pas disponible.
    // On la mappe sur le fichier local au lieu de faire une requete HTTP vers
    // notre propre serveur. L'origine doit etre une origine applicative connue.
    if (
      configuredApplicationOrigins(env).has(url.origin)
      && url.pathname.startsWith(GENERATED_VIDEO_PUBLIC_PREFIX)
    ) {
      return resolveGeneratedVideoFile(url.pathname, env);
    }

    if (!bases.length) return { kind: 'invalid', reason: 'aucune base publique R2 configuree' };

    const autorisee = bases.some((base) => {
      let b;
      try { b = new URL(base); } catch { return false; }
      // Comparaison sur l'hote ET le chemin de base: un hote seul laisserait
      // passer un sous-chemin d'un autre locataire du meme domaine.
      return url.host === b.host && url.pathname.startsWith(b.pathname.replace(/\/+$/, '') + '/');
    });
    if (!autorisee) return { kind: 'invalid', reason: 'URL hors du stockage Funesterie' };
    if (!/\.(mp4|mov|webm|mkv)$/i.test(url.pathname)) {
      return { kind: 'invalid', reason: 'extension video attendue' };
    }
    return { kind: 'url', url: url.toString() };
  }

  // Forme relative/locale rendue par la pipeline:
  // /files/runtime/files/generated/videos/<job>/<fichier>.mp4
  if (
    brut.startsWith(GENERATED_VIDEO_PUBLIC_PREFIX)
    || brut.startsWith('files/generated/videos/')
    || brut.startsWith('generated/videos/')
    || brut.includes('/')
    || brut.includes('\\')
  ) {
    return resolveGeneratedVideoFile(brut, env);
  }

  // Fichier genere local: meme durcissement que resolveGeneratedAudioFile.
  const safe = path.basename(brut);
  if (!VIDEO_FILE_PATTERN.test(safe)) {
    return { kind: 'invalid', reason: 'nom de fichier video attendu' };
  }
  const runtimeRoot = path.resolve(getCanonicalRuntimeRoot(env));
  const candidats = [
    path.join(runtimeRoot, 'video', safe),
    path.join(runtimeRoot, 'files', safe),
    path.join(runtimeRoot, 'files', 'uploads', safe),
    path.join(runtimeRoot, 'files', 'generated', 'videos', safe),
  ];
  for (const candidat of candidats) {
    const resolved = resolveContainedRealFile(runtimeRoot, candidat);
    if (resolved.kind === 'file' || resolved.kind === 'invalid') return resolved;
  }
  return { kind: 'missing' };
}

function boundedPositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function youtubeSourceError(code, upstreamStatus = undefined) {
  const error = new Error(code);
  error.code = code;
  if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) {
    error.upstreamStatus = upstreamStatus;
  }
  return error;
}

async function downloadGeneratedVideoUrlToTemp({
  url,
  env = process.env,
  fetchImpl = globalThis.fetch,
  tempDir = os.tmpdir(),
  timeoutMs = undefined,
  maxBytes = undefined,
} = {}) {
  const effectiveTimeoutMs = boundedPositiveInteger(
    timeoutMs ?? env.SOCIAL_YOUTUBE_SOURCE_FETCH_TIMEOUT_MS,
    YOUTUBE_SOURCE_FETCH_TIMEOUT_MS,
    { min: 100, max: 60 * 60 * 1000 }
  );
  const effectiveMaxBytes = boundedPositiveInteger(
    maxBytes ?? env.SOCIAL_YOUTUBE_SOURCE_MAX_BYTES,
    YOUTUBE_SOURCE_MAX_BYTES,
    { max: 256 * 1024 * 1024 * 1024 }
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  let tempFile = '';

  try {
    let response;
    try {
      // Une redirection ne doit jamais contourner la validation de l'URL R2
      // effectuee avant cet appel.
      response = await fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw youtubeSourceError('youtube_upload_source_timeout');
      }
      throw youtubeSourceError('youtube_upload_source_fetch_failed');
    }

    if (response.status >= 300 && response.status < 400) {
      throw youtubeSourceError('youtube_upload_source_redirect_refused', response.status);
    }
    if (!response.ok) {
      throw youtubeSourceError('youtube_upload_source_fetch_failed', response.status);
    }
    if (!response.body) throw youtubeSourceError('youtube_upload_source_fetch_failed');

    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > effectiveMaxBytes) {
      throw youtubeSourceError('youtube_upload_source_too_large');
    }

    const extension = path.extname(new URL(url).pathname) || '.mp4';
    tempFile = path.join(tempDir, `yt-upload-${crypto.randomBytes(12).toString('hex')}${extension}`);
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > effectiveMaxBytes) {
          callback(youtubeSourceError('youtube_upload_source_too_large'));
          return;
        }
        callback(null, buffer);
      },
    });
    const destination = fs.createWriteStream(tempFile, { flags: 'wx', mode: 0o600 });

    try {
      await pipeline(response.body, limiter, destination, { signal: controller.signal });
    } catch (error) {
      if (error?.code === 'youtube_upload_source_too_large') throw error;
      if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw youtubeSourceError('youtube_upload_source_timeout');
      }
      throw youtubeSourceError('youtube_upload_source_fetch_failed');
    }

    return { path: tempFile, bytes };
  } catch (error) {
    if (tempFile) {
      try { fs.rmSync(tempFile, { force: true }); } catch { /* fichier partiel deja absent */ }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildSocialConnectHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Social Autoprompt - Funesterie</title>
  <style>
    :root { color-scheme: dark; --bg:#08060d; --panel:#14101f; --line:#392448; --text:#f7eafd; --muted:#bba7c8; --accent:#78e8ff; --pink:#f06adf; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:linear-gradient(135deg,#08060d,#160c1f 55%,#05070a); color:var(--text); font:15px/1.45 system-ui,Segoe UI,Arial,sans-serif; }
    main { width:min(1120px, calc(100vw - 32px)); margin:0 auto; padding:32px 0 48px; }
    h1 { margin:0 0 8px; font-size:clamp(30px,4vw,52px); letter-spacing:0; }
    h2 { margin:0 0 14px; font-size:18px; }
    p { color:var(--muted); max-width:820px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; margin-top:24px; }
    .card { border:1px solid var(--line); border-radius:8px; background:rgba(20,16,31,.86); padding:18px; box-shadow:0 18px 50px rgba(0,0,0,.22); }
    .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    button, a.button { border:1px solid #685078; background:#21162b; color:var(--text); padding:10px 13px; border-radius:6px; font-weight:700; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:8px; }
    button.primary, a.primary { border-color:var(--accent); color:#071014; background:var(--accent); }
    button.warn { border-color:#f5a4d9; color:#24101d; background:#f5a4d9; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    code, pre { background:#07050a; border:1px solid #2b1c38; border-radius:6px; }
    code { padding:2px 5px; }
    pre { overflow:auto; padding:14px; color:#d8f8ff; min-height:140px; }
    input, select, textarea { width:100%; border:1px solid var(--line); background:#09070d; color:var(--text); border-radius:6px; padding:10px; }
    textarea { min-height:100px; resize:vertical; }
    input[type="checkbox"] { width:auto; }
    label { display:block; margin:12px 0 6px; color:#d8cae8; font-weight:700; }
    .status { color:var(--accent); font-weight:800; }
    .muted { color:var(--muted); }
    .pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:4px 9px; color:#f5d8ff; background:#100b18; margin:2px; font-size:12px; }
  </style>
</head>
<body>
  <main>
    <h1>Social Autoprompt</h1>
    <p>Connexion admin pour nourrir Vivy avec le contexte autorisé de tes comptes. V1 lit les métadonnées publiques utiles, fabrique des fiches créatives redacted, et n'autorise aucune publication sans confirmation explicite.</p>

    <section class="grid">
      <article class="card">
        <h2>Connexions</h2>
        <div id="providers"></div>
      </article>
      <article class="card">
        <h2>Comptes reliés</h2>
        <div id="accounts" class="muted">Chargement...</div>
      </article>
    </section>

    <section class="card" style="margin-top:16px">
      <h2>Tester un contexte Vivy</h2>
      <div class="grid">
        <label>Sujet<input id="topic" value="La fille qui parlait aux machines"></label>
        <label>Usage<select id="kind"><option>chanson</option><option>clip</option><option>post</option><option>description</option><option>hashtag</option></select></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="build">Construire la fiche</button>
        <button id="refresh">Actualiser</button>
      </div>
      <pre id="output"></pre>
    </section>

    <section class="card" style="margin-top:16px">
      <h2>Démo de publication YouTube</h2>
      <p>Publie uniquement la vidéo générée indiquée, après deux confirmations humaines. Aucun envoi automatique. La confidentialité est privée par défaut.</p>
      <div class="grid">
        <label>Source vidéo générée (URL ou chemin)<input id="youtube-source" placeholder="/files/runtime/files/generated/videos/.../clip.mp4"></label>
        <label>Titre<input id="youtube-title" maxlength="100" placeholder="Titre de la vidéo"></label>
      </div>
      <label>Description<textarea id="youtube-description" maxlength="5000" placeholder="Description YouTube"></textarea></label>
      <label>Confidentialité<select id="youtube-privacy"><option value="private" selected>Privée (par défaut)</option><option value="unlisted">Non répertoriée</option><option value="public">Publique</option></select></label>
      <label class="row"><input id="youtube-confirm" type="checkbox"> Je confirme vouloir envoyer cette vidéo sur la chaîne YouTube connectée.</label>
      <div class="row" style="margin-top:12px">
        <button class="primary" id="youtube-upload" disabled>Envoyer sur YouTube</button>
        <button id="youtube-abandon" disabled>J'ai vérifié : abandonner la tentative</button>
      </div>
      <p class="muted">Après une erreur ou une réponse incertaine, la même clé est conservée. Vérifie la chaîne avant d'abandonner explicitement la tentative.</p>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }
    function providerLabel(provider) {
      return provider === 'meta' ? 'Facebook / Instagram' : provider === 'youtube' ? 'YouTube' : provider === 'soundcloud' ? 'SoundCloud' : provider;
    }
    async function api(path, options = {}) {
      const res = await fetch('/api/admin/social-connect' + path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.message || data.error || 'HTTP ' + res.status);
      return data;
    }
    function renderProviders(providers = []) {
      $('providers').innerHTML = providers.map((p) => {
        const ready = p.configured && !p.plannedOnly;
        const label = providerLabel(p.provider);
        const missing = p.missing?.length ? '<div class="muted">Manque: ' + escapeHtml(p.missing.join(', ')) + '</div>' : '';
        const hint = p.provider === 'meta'
          ? '<div class="muted">Instagram utilise le même bouton Meta. Il apparaît si le compte Instagram est relié à une page Facebook/professionnelle.</div>'
          : '';
        return '<div style="margin-bottom:16px"><div class="row"><strong>' + escapeHtml(label) + '</strong><span class="pill">' + (ready ? 'prêt' : p.plannedOnly ? 'prévu' : 'à configurer') + '</span></div>' +
          '<div class="muted">' + escapeHtml((p.scopes || []).slice(0, 4).join(' · ')) + '</div>' + hint + missing +
          '<div class="row" style="margin-top:10px"><a class="button ' + (ready ? 'primary' : '') + '" href="/api/admin/social-connect/' + encodeURIComponent(p.provider) + '/start">Connecter</a></div></div>';
      }).join('');
    }
    function renderAccounts(accounts = []) {
      if (!accounts.length) { $('accounts').textContent = 'Aucun compte connecté.'; return; }
      $('accounts').innerHTML = accounts.map((a) => {
        const metadata = a.metadata || {};
        const instagramAccounts = Array.isArray(metadata.instagramAccounts) ? metadata.instagramAccounts : [];
        const facebookPages = Array.isArray(metadata.facebookPages) ? metadata.facebookPages : [];
        const instagramLine = a.provider === 'meta'
          ? instagramAccounts.length
            ? '<div class="muted">Instagram détecté: ' + instagramAccounts.map((ig) => '@' + escapeHtml(ig.username || ig.name || ig.id || 'instagram')).join(', ') + '</div>'
            : '<div class="muted">Connexion Meta OK. Aucun Instagram lié détecté ici: il faut souvent un compte Instagram professionnel relié à une page Facebook, puis reconnecter.</div>'
          : '';
        const pageLine = a.provider === 'meta' && facebookPages.length
          ? '<div class="muted">Pages: ' + facebookPages.map((page) => escapeHtml(page.name || page.id || 'page')).slice(0, 5).join(', ') + '</div>'
          : '';
        const lookupLine = a.provider === 'meta' && metadata.instagramLookupError
          ? '<div class="muted">Lecture Instagram limitée: ' + escapeHtml(metadata.instagramLookupError) + '</div>'
          : '';
        return '<div class="card" style="margin:0 0 10px;padding:12px">' +
          '<div class="row"><strong>' + escapeHtml(a.accountLabel || providerLabel(a.provider)) + '</strong><span class="pill">' + escapeHtml(providerLabel(a.provider)) + '</span><span class="pill">' + escapeHtml(a.paused ? 'pause' : a.status) + '</span></div>' +
          '<div class="muted">Expire: ' + escapeHtml(a.expiresAt || 'inconnu') + ' · dernier ingest: ' + escapeHtml(a.lastIngestAt || 'jamais') + '</div>' +
          instagramLine + pageLine + lookupLine +
          '<div class="row" style="margin-top:10px">' +
          '<button data-action="refresh" data-provider="' + escapeHtml(a.provider) + '">Test refresh</button>' +
          '<button data-action="ingest" data-provider="' + escapeHtml(a.provider) + '">Ingest maintenant</button>' +
          '<button data-action="pause" data-provider="' + escapeHtml(a.provider) + '">' + (a.paused ? 'Reprendre' : 'Pause ingest') + '</button>' +
          '<button class="warn" data-action="purge" data-provider="' + escapeHtml(a.provider) + '">Purger contexte</button>' +
          '<button class="warn" data-action="disconnect" data-provider="' + escapeHtml(a.provider) + '">Se déconnecter</button>' +
          '</div></div>';
      }).join('');
    }
    async function load() {
      const status = await api('/status');
      renderProviders(status.providers || []);
      renderAccounts(status.accounts || []);
      $('output').textContent = JSON.stringify(status.summary || {}, null, 2);
    }
    document.addEventListener('click', async (event) => {
      const target = event.target.closest('button[data-action]');
      if (!target) return;
      const provider = target.dataset.provider;
      const action = target.dataset.action;
      target.disabled = true;
      try {
        if (action === 'refresh') $('output').textContent = JSON.stringify(await api('/' + provider + '/test-refresh', { method:'POST', body:'{}' }), null, 2);
        if (action === 'ingest') $('output').textContent = JSON.stringify(await api('/' + provider + '/ingest-now', { method:'POST', body:'{}' }), null, 2);
        if (action === 'pause') $('output').textContent = JSON.stringify(await api('/' + provider + '/pause', { method:'POST', body: JSON.stringify({ paused: target.textContent.includes('Pause') }) }), null, 2);
        if (action === 'purge' && confirm('Purger le contexte social local ?')) $('output').textContent = JSON.stringify(await api('/' + provider + '/purge-context', { method:'POST', body:'{}' }), null, 2);
        if (action === 'disconnect' && confirm('Déconnecter ce compte ? Le token sera supprimé; les items déjà ingérés restent en cache.')) $('output').textContent = JSON.stringify(await api('/' + provider + '/disconnect', { method:'POST', body:'{}' }), null, 2);
      } catch (e) { $('output').textContent = String(e.message || e); }
      finally { await load().catch(() => {}); target.disabled = false; }
    });
    $('refresh').onclick = () => load().catch((e) => $('output').textContent = String(e.message || e));
    $('build').onclick = async () => {
      try {
        const q = new URLSearchParams({ topic: $('topic').value, kind: $('kind').value, limit: '6' });
        $('output').textContent = JSON.stringify(await api('/context?' + q.toString()), null, 2);
      } catch (e) { $('output').textContent = String(e.message || e); }
    };
    const youtubeConfirm = $('youtube-confirm');
    const youtubeUpload = $('youtube-upload');
    const youtubeAbandon = $('youtube-abandon');
    const youtubeIdempotencyStorageKey = 'a11.youtubeUploadIdempotencyKey';
    let youtubeIdempotencyKey = localStorage.getItem(youtubeIdempotencyStorageKey) || '';
    youtubeAbandon.disabled = !youtubeIdempotencyKey;
    function clearYoutubeAttempt() {
      youtubeIdempotencyKey = '';
      localStorage.removeItem(youtubeIdempotencyStorageKey);
      youtubeAbandon.disabled = true;
    }
    youtubeAbandon.onclick = () => {
      if (!youtubeIdempotencyKey) return;
      if (!window.confirm('Confirme avoir vérifié la chaîne. Abandonner cette tentative et autoriser une nouvelle clé ?')) return;
      clearYoutubeAttempt();
      $('output').textContent = 'Tentative abandonnée. Le prochain envoi utilisera une nouvelle clé.';
    };
    youtubeConfirm.addEventListener('change', () => {
      youtubeUpload.disabled = !youtubeConfirm.checked;
    });
    youtubeUpload.onclick = async () => {
      if (!youtubeConfirm.checked) return;
      if (!window.confirm('Confirmer maintenant l’envoi de cette vidéo sur YouTube ?')) return;
      if (!youtubeIdempotencyKey) {
        youtubeIdempotencyKey = crypto.randomUUID();
        localStorage.setItem(youtubeIdempotencyStorageKey, youtubeIdempotencyKey);
      }
      youtubeUpload.disabled = true;
      youtubeAbandon.disabled = true;
      try {
        const resultat = await api('/youtube/upload-generated', {
          method: 'POST',
          body: JSON.stringify({
            videoUrl: $('youtube-source').value,
            title: $('youtube-title').value,
            description: $('youtube-description').value,
            privacyStatus: $('youtube-privacy').value,
            confirm: true,
            idempotencyKey: youtubeIdempotencyKey,
          }),
        });
        $('output').textContent = JSON.stringify(resultat, null, 2);
        clearYoutubeAttempt();
      } catch (e) {
        $('output').textContent = String(e.message || e);
        youtubeAbandon.disabled = false;
      } finally {
        youtubeConfirm.checked = false;
        youtubeUpload.disabled = true;
      }
    };
    load().catch((e) => $('output').textContent = String(e.message || e));
  </script>
</body>
</html>`;
}

function createSocialAutopromptApiRouter({ verifyJWT, isAdminRequest, db, env = process.env, fetchFn = globalThis.fetch } = {}) {
  const router = express.Router();
  const requireSocialConnect = createRequireSocialConnectAccess({ verifyJWT, isAdminRequest, env });

  router.get('/public-status', async (req, res) => {
    try {
      const status = await buildSocialAutopromptRedactedStatus(db, {
        userId: resolveSocialContextUserId(env),
        env,
        req,
      });
      return res.json(status);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        schema: 'funesterie.social-autoprompt.status.v1',
        error: 'social_status_unavailable',
        message: cleanText(error?.message || error, 240),
      });
    }
  });

  router.use(requireSocialConnect);
  router.use(express.json({ limit: '1mb' }));

  router.get('/status', async (req, res) => {
    const userId = getAdminUserId(req);
    try {
      await ensureSocialSchema(db);
      const accounts = await listSocialAccounts(db, { userId });
      const publication = resolveSocialPublicationCapabilities(req, env);
      res.json({
        ok: true,
        userId,
        providers: redactedProviderConfig(req, env),
        accounts,
        summary: {
          youtubeConfigured: resolveProviderConfig('youtube', { req, env }).configured,
          metaConfigured: resolveProviderConfig('meta', { req, env }).configured,
          ingestWorkerEnabled: boolEnv('SOCIAL_INGEST_WORKER_ENABLED', false, env),
          ...publication,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get('/:provider/start', (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    if (!['youtube', 'meta', 'soundcloud'].includes(provider)) {
      return res.status(400).json({ ok: false, error: 'social_provider_unsupported' });
    }
    const state = createOauthState({ provider, userId: getAdminUserId(req) });
    let pkce = null;
    if (provider === 'soundcloud') pkce = createPkcePair();
    const auth = buildProviderAuthUrl(provider, { state, req, env, codeChallenge: pkce?.codeChallenge || '' });
    if (!auth.ok) {
      return res.status(400).json({ ok: false, error: 'social_oauth_not_configured', provider, missing: auth.missing || [] });
    }
    setOauthCookie(res, state);
    if (pkce) {
      setPkceCookie(res, {
        provider,
        state,
        codeVerifier: pkce.codeVerifier,
        issuedAt: Date.now(),
      });
    }
    return res.redirect(auth.url);
  });

  router.get('/youtube/callback', async (req, res) => {
    const queryState = String(req.query.state || '');
    const cookieState = readCookie(req, SOCIAL_OAUTH_COOKIE);
    const parsedState = parseOauthState(queryState);
    clearOauthCookie(res);
    if (!parsedState || !cookieState || queryState !== cookieState || parsedState.provider !== 'youtube') {
      return res.status(400).send('OAuth YouTube invalide ou expiré.');
    }
    try {
      const tokens = await exchangeYoutubeCode({ code: req.query.code, req, env, fetchFn });
      const identity = await getYoutubeChannelIdentity(tokens.access_token, fetchFn);
      const account = await upsertSocialAccount(db, {
        userId: parsedState.userId || getAdminUserId(req),
        provider: 'youtube',
        accountLabel: identity.accountLabel || 'YouTube',
        accountExternalId: identity.accountExternalId || 'youtube',
        scopes: splitScopes(tokens.scope).length ? splitScopes(tokens.scope) : resolveProviderConfig('youtube', { req, env }).scopes,
        tokens,
        metadata: {
          ...(identity.metadata || {}),
          connectedAt: new Date().toISOString(),
        },
      }, env);
      return res.redirect(`/admin/social-connect?connected=youtube&account=${encodeURIComponent(account?.account_label || 'YouTube')}`);
    } catch (error) {
      return res.status(500).send(`Connexion YouTube échouée: ${String(error?.message || error)}`);
    }
  });

  router.get('/meta/callback', async (req, res) => {
    const queryState = String(req.query.state || '');
    const cookieState = readCookie(req, SOCIAL_OAUTH_COOKIE);
    const parsedState = parseOauthState(queryState);
    clearOauthCookie(res);
    if (!parsedState || !cookieState || queryState !== cookieState || parsedState.provider !== 'meta') {
      return res.status(400).send('OAuth Meta invalide ou expiré.');
    }
    try {
      const tokens = await exchangeMetaCode({ code: req.query.code, req, env, fetchFn });
      const identity = await getMetaAccountIdentity(tokens.access_token, fetchFn);
      const account = await upsertSocialAccount(db, {
        userId: parsedState.userId || getAdminUserId(req),
        provider: 'meta',
        accountLabel: identity.accountLabel || 'Facebook / Instagram',
        accountExternalId: identity.accountExternalId || 'meta',
        scopes: splitScopes(tokens.scope).length ? splitScopes(tokens.scope) : resolveProviderConfig('meta', { req, env }).scopes,
        tokens,
        metadata: identity.metadata || {},
      }, env);
      return res.redirect(`/admin/social-connect?connected=meta&account=${encodeURIComponent(account?.account_label || 'Facebook / Instagram')}`);
    } catch (error) {
      return res.status(500).send(`Connexion Meta échouée: ${String(error?.message || error)}`);
    }
  });

  router.get('/soundcloud/callback', async (req, res) => {
    const queryState = String(req.query.state || '');
    const cookieState = readCookie(req, SOCIAL_OAUTH_COOKIE);
    const parsedState = parseOauthState(queryState);
    const pkce = readPkceCookie(req);
    clearOauthCookie(res);
    if (
      !parsedState
      || !cookieState
      || queryState !== cookieState
      || parsedState.provider !== 'soundcloud'
      || !pkce
      || pkce.provider !== 'soundcloud'
      || pkce.state !== queryState
      || !pkce.codeVerifier
    ) {
      return res.status(400).send('OAuth SoundCloud invalide ou expiré.');
    }
    try {
      const tokens = await exchangeSoundCloudCode({
        code: req.query.code,
        codeVerifier: pkce.codeVerifier,
        req,
        env,
        fetchFn,
      });
      const identity = await getSoundCloudAccountIdentity(tokens.access_token, fetchFn);
      const account = await upsertSocialAccount(db, {
        userId: parsedState.userId || getAdminUserId(req),
        provider: 'soundcloud',
        accountLabel: identity.accountLabel || 'SoundCloud',
        accountExternalId: identity.accountExternalId || 'soundcloud',
        scopes: splitScopes(tokens.scope).length ? splitScopes(tokens.scope) : resolveProviderConfig('soundcloud', { req, env }).scopes,
        tokens,
        metadata: {
          ...(identity.metadata || {}),
          connectedAt: new Date().toISOString(),
        },
      }, env);
      return res.redirect(`/admin/social-connect?connected=soundcloud&account=${encodeURIComponent(account?.account_label || 'SoundCloud')}`);
    } catch (error) {
      return res.status(500).send(`Connexion SoundCloud échouée: ${String(error?.message || error)}`);
    }
  });

  router.post('/:provider/test-refresh', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    if (!['youtube', 'meta', 'soundcloud'].includes(provider)) return res.status(400).json({ ok: false, error: 'social_provider_unsupported' });
    try {
      const bundle = await getFreshSocialTokens(db, { provider, userId: getAdminUserId(req) }, env, fetchFn);
      if (provider === 'meta' && bundle?.tokens?.accessToken) {
        await getMetaAccountIdentity(bundle.tokens.accessToken, fetchFn);
      }
      if (provider === 'soundcloud' && bundle?.tokens?.accessToken) {
        await getSoundCloudAccountIdentity(bundle.tokens.accessToken, fetchFn);
      }
      return res.json({
        ok: Boolean(bundle?.row && bundle?.tokens?.accessToken),
        provider,
        reconnectRequired: bundle?.row?.reconnect_required === true || bundle?.refresh?.reconnectRequired === true,
        refresh: bundle?.refresh || null,
        account: bundle?.row ? {
          provider: bundle.row.provider,
          accountLabel: bundle.row.account_label,
          expiresAt: bundle.tokens?.expiresAt || bundle.row.expires_at || null,
        } : null,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/:provider/ingest-now', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    if (provider !== 'youtube') return res.status(501).json({ ok: false, error: 'provider_ingest_planned_only' });
    try {
      const result = await ingestYoutubeAccount(db, {
        userId: getAdminUserId(req),
        limit: Math.max(1, Math.min(50, Number(req.body?.limit || env.SOCIAL_YOUTUBE_INGEST_LIMIT || 12) || 12)),
        fetchFn,
        env,
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/soundcloud/upload-generated', async (req, res) => {
    try {
      if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
        return res.status(400).json({
          ok: false,
          error: 'soundcloud_upload_confirm_required',
          message: 'Publication externe verrouillée: renvoie confirm:true pour publier sur SoundCloud.',
        });
      }
      const filename = cleanText(
        req.body?.filename
        || req.body?.audioFilename
        || req.body?.doubleHarmonicFilename
        || '',
        260
      );
      const audioPath = resolveGeneratedAudioFile(filename, env);
      if (!audioPath) {
        return res.status(404).json({ ok: false, error: 'generated_audio_not_found', filename });
      }
      const bundle = await getFreshSocialTokens(db, { provider: 'soundcloud', userId: getAdminUserId(req) }, env, fetchFn);
      if (!bundle?.tokens?.accessToken) {
        return res.status(401).json({
          ok: false,
          error: 'soundcloud_not_connected',
          reconnectRequired: bundle?.refresh?.reconnectRequired === true,
          refresh: bundle?.refresh || null,
        });
      }
      const upload = await uploadSoundCloudTrack({
        accessToken: bundle.tokens.accessToken,
        audioPath,
        title: cleanText(req.body?.title, 120) || path.basename(audioPath).replace(/\.[^.]+$/, ''),
        description: cleanText(req.body?.description, 4000),
        sharing: cleanText(req.body?.sharing, 40) || 'private',
        genre: cleanText(req.body?.genre, 120),
        tagList: Array.isArray(req.body?.tags)
          ? req.body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean).join(' ')
          : cleanText(req.body?.tagList || req.body?.tags, 500),
      }, fetchFn);
      return res.json({
        ok: true,
        provider: 'soundcloud',
        uploaded: {
          id: upload.id,
          title: upload.title,
          permalinkUrl: upload.permalinkUrl,
          sharing: upload.sharing,
          raw: upload.raw,
        },
        source: {
          filename: path.basename(audioPath),
          bytes: fs.statSync(audioPath).size,
        },
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'soundcloud_upload_failed',
        status: error?.status || undefined,
        message: cleanText(error?.message || error, 500),
      });
    }
  });

  /**
   * Publie une video sur la chaine YouTube connectee.
   *
   * Meme verrou que SoundCloud: confirm:true obligatoire. Une publication externe
   * ne doit jamais partir d'un appel accidentel.
   *
   * Defaut deliberement `private`. Deux raisons, et la seconde n'est pas la notre:
   * un envoi depuis un projet API non audite est VERROUILLE en prive par YouTube
   * de toute facon. Demander `public` par defaut donnerait l'illusion d'un choix
   * et ferait chercher un bug chez nous. Le champ lockedPrivateLikely de la
   * reponse nomme ce cas quand il se produit.
  */
  router.post('/youtube/upload-generated', async (req, res) => {
    let tempFile = '';
    let releaseYoutubeLock = null;
    let publicationClaim = null;
    let publicationIdentity = null;
    let publicationTerminal = false;
    let youtubeInsertStarted = false;
    let claimAttempted = false;
    try {
      if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
        return res.status(400).json({
          ok: false,
          error: 'youtube_upload_confirm_required',
          message: 'Publication externe verrouillée: renvoie confirm:true pour publier sur YouTube.',
        });
      }

      const idempotency = normalizeYoutubeUploadIdempotencyKey(req.body?.idempotencyKey);
      if (!idempotency.ok) {
        return res.status(400).json({
          ok: false,
          error: idempotency.error,
          message: idempotency.error === 'youtube_upload_idempotency_key_required'
            ? 'idempotencyKey est obligatoire pour toute tentative YouTube.'
            : 'idempotencyKey doit contenir 8 a 128 caracteres surs.',
        });
      }

      const source = resolveGeneratedVideoSource(
        req.body?.videoUrl || req.body?.filename || req.body?.video || '',
        env
      );
      if (source.kind === 'none') {
        return res.status(400).json({ ok: false, error: 'youtube_upload_source_required', message: 'videoUrl ou filename requis.' });
      }
      if (source.kind === 'invalid') {
        return res.status(400).json({ ok: false, error: 'youtube_upload_source_invalid', message: source.reason });
      }
      if (source.kind === 'missing') {
        return res.status(404).json({ ok: false, error: 'generated_video_not_found' });
      }

      const userId = getAdminUserId(req);
      const metadata = buildYoutubeUploadMetadata(req.body || {}, source);
      const requestHash = buildYoutubePublicationRequestHash({ userId, source, metadata });
      publicationIdentity = {
        userId,
        provider: 'youtube',
        idempotencyKey: idempotency.key,
        requestHash,
      };
      claimAttempted = true;
      publicationClaim = await claimSocialPublicationRequest(db, publicationIdentity);
      const replayOrConflict = resolveYoutubePublicationClaimHttpResponse(publicationClaim);
      if (replayOrConflict) {
        if (replayOrConflict.retryAfterSeconds) {
          res.set('Retry-After', String(replayOrConflict.retryAfterSeconds));
        }
        return res.status(replayOrConflict.status).json(replayOrConflict.body);
      }

      const bundle = await getFreshSocialTokens(db, { provider: 'youtube', userId }, env, fetchFn);
      if (!bundle?.tokens?.accessToken) {
        await completeSocialPublicationRequest(db, {
          ...publicationIdentity,
          status: 'failed',
          errorCode: 'youtube_not_connected',
        });
        publicationTerminal = true;
        return res.status(401).json({
          ok: false,
          error: 'youtube_not_connected',
          reconnectRequired: bundle?.refresh?.reconnectRequired === true,
          refresh: bundle?.refresh || null,
        });
      }

      releaseYoutubeLock = tryAcquireYoutubePublicationLock();
      if (!releaseYoutubeLock) {
        await completeSocialPublicationRequest(db, {
          ...publicationIdentity,
          status: 'failed',
          errorCode: 'youtube_upload_busy',
        });
        publicationTerminal = true;
        return res.status(409).json({
          ok: false,
          error: 'youtube_upload_busy',
          message: 'Une autre video est deja en cours de transfert. Cette tentative ne sera pas relancee; abandonne-la explicitement apres verification.',
        });
      }

      // L'envoi reprenable relit le fichier par tranches, donc il lui faut un
      // fichier sur disque: une URL est d'abord rapatriee.
      let videoPath = source.path || '';
      if (source.kind === 'url') {
        const download = await downloadGeneratedVideoUrlToTemp({
          url: source.url,
          env,
          fetchImpl: fetchFn,
        });
        tempFile = download.path;
        videoPath = tempFile;
      }

      const attemptStart = await startSocialPublicationAttempt(db, {
        ...publicationIdentity,
        maxAttempts24h: resolveYoutubeUploadAttemptLimit(env),
      });
      if (attemptStart.outcome !== 'started') {
        const startResponse = resolveYoutubePublicationClaimHttpResponse(attemptStart);
        if (attemptStart.outcome === 'quota') {
          const failedRequest = await completeSocialPublicationRequest(db, {
            ...publicationIdentity,
            status: 'failed',
            errorCode: 'youtube_upload_attempt_quota_exceeded',
          });
          if (!failedRequest) {
            const error = new Error('youtube_upload_quota_outcome_not_persisted');
            error.code = 'youtube_upload_quota_outcome_not_persisted';
            throw error;
          }
          publicationTerminal = true;
        }
        if (startResponse?.retryAfterSeconds) {
          res.set('Retry-After', String(startResponse.retryAfterSeconds));
        }
        return res.status(startResponse?.status || 409).json(startResponse?.body || {
          ok: false,
          error: 'youtube_upload_attempt_not_started',
        });
      }

      // A partir d'ici, une reponse perdue peut cacher un videos.insert ayant
      // abouti. En cas d'exception, la ligne reste donc pending et tout replay
      // est bloque jusqu'a verification humaine.
      youtubeInsertStarted = true;
      const resultat = await uploadYoutubeVideo({
        accessToken: bundle.tokens.accessToken,
        filePath: videoPath,
        metadata,
        fetchImpl: fetchFn,
      });

      const responseBody = {
        ok: true,
        provider: 'youtube',
        uploaded: {
          videoId: resultat.videoId,
          url: resultat.url,
          privacyStatus: resultat.privacyStatus,
          lockedPrivateLikely: resultat.lockedPrivateLikely,
          uploadedBytes: resultat.uploadedBytes,
          resumes: resultat.resumes,
        },
        // Dit explicitement quoi faire quand YouTube a impose le prive, plutot
        // que de laisser l'appelant conclure a une panne.
        note: resultat.lockedPrivateLikely
          ? "YouTube a impose 'private': l'audit de conformite du projet API n'est pas obtenu. Passer la video en public a la main."
          : undefined,
      };
      const completed = await completeSocialPublicationRequest(db, {
        ...publicationIdentity,
        status: 'succeeded',
        result: responseBody,
      });
      if (!completed) {
        const error = new Error('youtube_upload_result_not_persisted');
        error.code = 'youtube_upload_result_not_persisted';
        throw error;
      }
      publicationTerminal = true;
      return res.json(responseBody);
    } catch (error) {
      const code = cleanText(error?.code, 60);
      if (
        publicationClaim?.outcome === 'claimed'
        && publicationIdentity
        && !publicationTerminal
        && !youtubeInsertStarted
      ) {
        try {
          await completeSocialPublicationRequest(db, {
            ...publicationIdentity,
            status: 'failed',
            errorCode: code || 'youtube_upload_preflight_failed',
          });
          publicationTerminal = true;
        } catch { /* la ligne pending bloque toujours tout replay */ }
      }
      if (claimAttempted && !publicationClaim) {
        return res.status(503).json({
          ok: false,
          error: 'youtube_upload_idempotency_store_unavailable',
          message: "Le journal d'idempotence est indisponible; aucun envoi YouTube n'a ete lance.",
        });
      }
      const erreurHttp = resolveYoutubeUploadHttpError(error);
      if (erreurHttp) {
        if (youtubeInsertStarted) erreurHttp.body.outcomeToVerify = true;
        return res.status(erreurHttp.status).json(erreurHttp.body);
      }
      return res.status(500).json({
        ok: false,
        error: 'youtube_upload_failed',
        code: code || undefined,
        status: error?.status || undefined,
        outcomeToVerify: youtubeInsertStarted || undefined,
        message: youtubeInsertStarted
          ? 'La reponse YouTube est incertaine. Verifie la chaine; cette tentative ne sera pas relancee.'
          : "L'envoi YouTube a echoue avant le debut de la publication.",
      });
    } finally {
      if (tempFile) { try { fs.rmSync(tempFile, { force: true }); } catch { /* deja parti */ } }
      if (releaseYoutubeLock) releaseYoutubeLock();
    }
  });

  router.post('/:provider/pause', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    try {
      const account = await setSocialAccountPaused(db, {
        provider,
        userId: getAdminUserId(req),
        paused: req.body?.paused !== false,
      });
      return res.json({ ok: Boolean(account), account });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/:provider/disconnect', async (req, res) => {
    const provider = normalizeProvider(req.params.provider);
    try {
      const account = await disconnectSocialAccount(db, {
        provider,
        userId: getAdminUserId(req),
      });
      if (!account) return res.status(404).json({ ok: false, error: 'social_account_not_found' });
      return res.json({ ok: true, account });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.post('/:provider/purge-context', async (req, res) => {
    try {
      const result = await purgeSocialContext(db, {
        provider: normalizeProvider(req.params.provider),
        userId: getAdminUserId(req),
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  router.get('/context', async (req, res) => {
    try {
      const context = await buildAndStoreSocialPromptContext(db, {
        userId: getAdminUserId(req),
        topic: cleanText(req.query.topic, 240),
        kind: normalizeKind(req.query.kind),
        limit: Math.max(1, Math.min(12, Number(req.query.limit || 6) || 6)),
      });
      return res.json({
        ok: true,
        context,
        promptBlock: formatSocialContextForPrompt(context),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  return router;
}

function createSocialAutopromptPageRouter({ verifyJWT, isAdminRequest } = {}) {
  const router = express.Router();
  const requireSocialConnect = createRequireSocialConnectAccess({ verifyJWT, isAdminRequest });
  router.get('/', requireSocialConnect, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(buildSocialConnectHtml());
  });
  return router;
}

module.exports = {
  _private: {
    buildYoutubePublicationRequestHash,
    buildYoutubeUploadMetadata,
    downloadGeneratedVideoUrlToTemp,
    normalizeYoutubeUploadIdempotencyKey,
    resolveGeneratedVideoSource,
    resolveSocialPublicationCapabilities,
    resolveYoutubePublicationClaimHttpResponse,
    resolveYoutubeUploadAttemptLimit,
    resolveYoutubeUploadHttpError,
    tryAcquireYoutubePublicationLock,
  },
  createSocialAutopromptApiRouter,
  createSocialAutopromptPageRouter,
  createRequireSocialConnectAccess,
  getAdminUserId,
  getMetaAccountIdentity,
  hasSocialConnectAccess,
  normalizeMetaPageInstagramContext,
};

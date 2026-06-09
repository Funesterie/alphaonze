const express = require('express');
const nodeCrypto = require('node:crypto');
const {
  normalizeEmail,
  isFullAccessEmail,
  hasFullAccess,
} = require('../auth/full-access.cjs');
const {
  getGoogleClientIds,
  verifyGoogleIdToken,
} = require('../auth/google-id-token.cjs');
const {
  extractRequestAuthToken,
  extractRequestAuthTokenCandidates,
  parseCookieHeader,
} = require('../middleware/jwt-auth.cjs');
const {
  createAuthSessionRegistry,
  normalizeSurface,
} = require('../auth/session-registry.cjs');
const {
  createIsAdminRequest,
} = require('../security/admin-access.cjs');
const {
  GOOGLE_CALLBACK_NAMES,
  GOOGLE_CLIENT_ID_NAMES,
  GOOGLE_CLIENT_SECRET_NAMES,
  MICROSOFT_CALLBACK_NAMES,
  MICROSOFT_CLIENT_ID_NAMES,
  MICROSOFT_CLIENT_SECRET_NAMES,
  buildAccountConnectorState,
  firstEnv,
  mergeOAuthConnectorState,
  normalizeOAuthConnectors,
  normalizeOAuthScopeList,
} = require('../auth/account-connectors.cjs');

const A11_SESSION_COOKIE = 'a11_session';
const GOOGLE_OAUTH_STATE_COOKIE = 'a11_google_oauth_state';
const MICROSOFT_OAUTH_STATE_COOKIE = 'a11_microsoft_oauth_state';
const MICROSOFT_OAUTH_PKCE_COOKIE = 'a11_microsoft_oauth_pkce';
const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_OAUTH_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const MICROSOFT_GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

function normalizeUsernameCandidate(value, fallback = 'user') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function stableHash(value, length = 12) {
  return nodeCrypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 96);
}

function titleizeDisplaySlug(value) {
  const words = String(value || '')
    .trim()
    .replace(/[-_.]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
    .slice(0, 96);
}

function stripGeneratedUsernameSuffix(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/[-_.][a-f0-9]{6,12}$/i, '') || text;
}

function resolvePublicDisplayName(user = {}, extra = {}) {
  const explicit = [
    extra.displayName,
    extra.display_name,
    extra.name,
    extra.fullName,
    extra.full_name,
    user.displayName,
    user.display_name,
    user.name,
    user.fullName,
    user.full_name,
  ].map(normalizeDisplayName).find(Boolean);
  if (explicit) {
    const readableExplicit = stripGeneratedUsernameSuffix(explicit);
    if (readableExplicit !== explicit) {
      return titleizeDisplaySlug(readableExplicit) || readableExplicit;
    }
    return explicit;
  }

  const username = normalizeDisplayName(
    extra.username
    || extra.preferred_username
    || user.username
    || user.preferred_username
  );
  if (username) {
    const readableUsername = stripGeneratedUsernameSuffix(username);
    if (readableUsername !== username) {
      return titleizeDisplaySlug(readableUsername) || readableUsername;
    }
    return username;
  }

  const email = normalizeEmail(
    extra.email
    || extra.mail
    || extra.userPrincipalName
    || user.email
    || user.mail
    || user.userPrincipalName
  );
  if (email) {
    return titleizeDisplaySlug(email.split('@')[0]) || email;
  }

  return 'Utilisateur';
}

function resolvePublicStorageScope(user = {}, extra = {}) {
  const explicit = String(
    extra.storageScope
    || extra.storage_scope
    || user.storageScope
    || user.storage_scope
    || ''
  ).trim();
  if (explicit) return explicit.slice(0, 96);

  const email = normalizeEmail(
    extra.email
    || extra.mail
    || extra.userPrincipalName
    || user.email
    || user.mail
    || user.userPrincipalName
  );
  if (email) return `email:${stableHash(email, 20)}`;

  const id = String(extra.id ?? extra.sub ?? extra.userId ?? extra.user_id ?? user.id ?? user.sub ?? user.userId ?? user.user_id ?? '').trim();
  if (id) return `user:${stableHash(id, 20)}`;

  const username = normalizeUsernameCandidate(
    extra.username
    || extra.preferred_username
    || user.username
    || user.preferred_username
    || '',
    ''
  );
  if (username) return `username:${stableHash(username.toLowerCase(), 20)}`;

  return '';
}

function resolveGoogleProfileDisplayName(profile = {}, email = '') {
  const fullName = [profile?.given_name, profile?.family_name].map(normalizeDisplayName).filter(Boolean).join(' ');
  return normalizeDisplayName(profile?.name || fullName)
    || titleizeDisplaySlug(String(email || '').split('@')[0])
    || '';
}

function resolveMicrosoftProfileDisplayName(profile = {}, email = '') {
  const fullName = [profile?.givenName, profile?.surname].map(normalizeDisplayName).filter(Boolean).join(' ');
  return normalizeDisplayName(profile?.displayName || profile?.name || fullName)
    || titleizeDisplaySlug(String(email || '').split('@')[0])
    || '';
}

function normalizeAccessPacks(user = {}, extra = {}) {
  const rawValues = [
    extra.accessPacks,
    extra.access_packs,
    user.accessPacks,
    user.access_packs,
    user.entitlements,
  ].flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(/[,\s]+/);
    return [];
  });
  const packs = new Set(
    rawValues
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (hasFullAccess({ ...user, ...extra })) {
    ['a11', 'k44', 'vivy', 'a11+vivy'].forEach((pack) => packs.add(pack));
  } else if (user.subscription_active === true || extra.subscription_active === true) {
    ['a11', 'k44', 'vivy'].forEach((pack) => packs.add(pack));
  }
  return Array.from(packs).sort();
}

function buildAuthClaims(user = {}, extra = {}) {
  const email = normalizeEmail(extra.email || user.email);
  const role = String(extra.role || user.role || '').trim();
  const claims = {
    id: extra.id ?? user.id,
    username: String(extra.username || user.username || '').trim(),
  };
  const displayName = resolvePublicDisplayName(user, extra);
  const storageScope = resolvePublicStorageScope(user, extra);

  if (email) claims.email = email;
  if (displayName) claims.displayName = displayName;
  if (storageScope) claims.storageScope = storageScope;
  if (role) claims.role = role;
  if (extra.localAuth || user.localAuth) claims.localAuth = true;
  if (extra.provider || user.provider || user.auth_provider) {
    claims.provider = String(extra.provider || user.provider || user.auth_provider);
  }
  {
    const oauthScopes = normalizeOAuthScopeList(
      extra.oauthScopes
      || extra.oauth_scopes
      || user.oauthScopes
      || user.oauth_scopes
      || user.scope
      || user.scopes
    );
    if (oauthScopes.length) claims.oauthScopes = oauthScopes;
  }
  {
    const oauthScopeProfile = String(
      extra.oauthScopeProfile
      || extra.oauth_scope_profile
      || user.oauthScopeProfile
      || user.oauth_scope_profile
      || ''
    ).trim().toLowerCase();
    if (oauthScopeProfile) claims.oauthScopeProfile = oauthScopeProfile.slice(0, 48);
  }
  {
    const oauthConnectors = normalizeOAuthConnectors(
      extra.oauthConnectors
      || extra.oauth_connectors
      || user.oauthConnectors
      || user.oauth_connectors
    );
    if (Object.keys(oauthConnectors).length) claims.oauthConnectors = oauthConnectors;
  }
  if (extra.oauthBridge === true || user.oauthBridge === true) {
    claims.oauthBridge = true;
  }
  if (extra.bridgeOrigin || user.bridgeOrigin) {
    const bridgeOrigin = String(extra.bridgeOrigin || user.bridgeOrigin || '').trim();
    if (bridgeOrigin) claims.bridgeOrigin = bridgeOrigin.slice(0, 128);
  }
  if (extra.sid || extra.sessionId || extra.session_id || user.sid || user.sessionId || user.session_id) {
    claims.sid = String(extra.sid || extra.sessionId || extra.session_id || user.sid || user.sessionId || user.session_id);
  }
  if (extra.surface || user.surface) {
    claims.surface = normalizeSurface(extra.surface || user.surface);
  }
  {
    const sessionGeneration = Number(
      extra.sessionGeneration
      ?? extra.sessionVersion
      ?? extra.sv
      ?? extra.session_generation
      ?? user.sessionGeneration
      ?? user.sessionVersion
      ?? user.sv
      ?? user.session_generation
      ?? 0
    );
    if (Number.isFinite(sessionGeneration) && sessionGeneration >= 0) {
      claims.sessionGeneration = Math.floor(sessionGeneration);
      claims.sv = Math.floor(sessionGeneration);
    }
  }
  const accessPacks = normalizeAccessPacks(user, extra);
  if (accessPacks.length) {
    claims.accessPacks = accessPacks;
  }
  if (hasFullAccess({ ...user, ...extra, email, role })) {
    claims.fullAccess = true;
  }

  return claims;
}

function buildPublicAuthUser(user = {}, extra = {}) {
  const claims = buildAuthClaims(user, extra);
  return {
    id: claims.id,
    username: claims.username,
    displayName: claims.displayName,
    email: claims.email || normalizeEmail(user.email),
    storageScope: claims.storageScope,
    role: claims.role || undefined,
    fullAccess: claims.fullAccess === true,
    provider: claims.provider || undefined,
    surface: claims.surface || undefined,
    oauthConnectors: claims.oauthConnectors || undefined,
    accessPacks: Array.isArray(claims.accessPacks) ? claims.accessPacks : [],
  };
}

function signUserToken({ jwt, jwtSecret, jwtExpiry, user, extra }) {
  return jwt.sign(buildAuthClaims(user, extra), jwtSecret, { expiresIn: jwtExpiry });
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isOAuthTraceEnabled() {
  return isTruthy(process.env.A11_AUTH_TRACE || process.env.A11_OAUTH_TRACE);
}

function resolveRequestOrigin(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim() || 'http';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

function isSecureRequest(req) {
  if (isTruthy(process.env.A11_DISABLE_SECURE_COOKIES)) return false;
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || '').toLowerCase();
  return req?.secure === true
    || proto.split(',').map((value) => value.trim()).includes('https')
    || process.env.NODE_ENV === 'production'
    || isTruthy(process.env.A11_FORCE_SECURE_COOKIES);
}

function normalizeSameSite(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['strict', 'lax', 'none'].includes(normalized)) return normalized;
  return '';
}

function resolveRequestPinnedFrontendUrl(req) {
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  const mapped = {
    'k44.funesterie.me': 'https://k44.funesterie.me',
    'kaen44.funesterie.me': 'https://kaen44.funesterie.me',
    'funesterie.me': 'https://funesterie.me',
    'www.funesterie.me': 'https://funesterie.me',
    'a11.funesterie.me': 'https://a11.funesterie.me',
    'cp.funesterie.me': 'https://cp.funesterie.me',
    'vivy.funesterie.me': 'https://vivy.funesterie.me',
    'music.funesterie.me': 'https://music.funesterie.me',
  };
  if (mapped[hostname]) return mapped[hostname];

  const origin = resolveRequestOrigin(req).replace(/\/+$/, '');
  if (!origin) return '';
  try {
    const parsed = new URL(origin);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return origin;
  } catch {}
  return '';
}

function resolveFrontendUrl(req, normalizePublicAppUrl) {
  const requestPinned = resolveRequestPinnedFrontendUrl(req);
  if (requestPinned) return requestPinned;

  const raw = process.env.FRONTEND_URL
    || process.env.PUBLIC_FRONTEND_URL
    || process.env.APP_URL
    || process.env.FRONT_URL
    || req?.headers?.origin
    || 'https://a11.funesterie.me';
  const normalized = typeof normalizePublicAppUrl === 'function'
    ? normalizePublicAppUrl(raw)
    : String(raw || '').trim().replace(/\/+$/, '');
  return normalized || 'https://a11.funesterie.me';
}

function resolvePublicApiOrigin(req, normalizePublicAppUrl) {
  const raw = process.env.PUBLIC_API_URL
    || process.env.API_URL
    || process.env.BASE_URL
    || process.env.BACKEND_URL
    || resolveRequestOrigin(req)
    || 'https://a11.funesterie.me';
  const normalized = typeof normalizePublicAppUrl === 'function'
    ? normalizePublicAppUrl(raw)
    : String(raw || '').trim().replace(/\/+$/, '');
  return normalized || resolveRequestOrigin(req) || 'https://a11.funesterie.me';
}

function resolveRequestHostname(req) {
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  return host.replace(/:\d+$/, '').toLowerCase();
}

function isPublicFunesterieOAuthHost(hostname) {
  return [
    'funesterie.me',
    'www.funesterie.me',
    'a11.funesterie.me',
    'cp.funesterie.me',
    'k44.funesterie.me',
    'kaen44.funesterie.me',
    'vivy.funesterie.me',
    'music.funesterie.me',
  ].includes(String(hostname || '').toLowerCase());
}

function isCentralFunesterieOAuthHost(hostname) {
  return ['funesterie.me', 'www.funesterie.me'].includes(String(hostname || '').toLowerCase());
}

function resolveOAuthSurfaceFromRequest(req) {
  const explicit = String(req?.query?.surface || req?.query?.persona || req?.headers?.['x-a11-surface'] || '').trim();
  if (explicit) return normalizeSurface(explicit);
  const hostname = resolveRequestHostname(req);
  if (['k44.funesterie.me', 'kaen44.funesterie.me'].includes(hostname)) return 'k44';
  if (['vivy.funesterie.me', 'music.funesterie.me'].includes(hostname)) return 'vivy';
  if (['a11.funesterie.me', 'cp.funesterie.me'].includes(hostname)) return 'a11';
  return 'funesterie';
}

function resolveHostPinnedOAuthCallback(req, provider) {
  const hostname = resolveRequestHostname(req);
  if (!isPublicFunesterieOAuthHost(hostname)) return '';
  return `https://funesterie.me/api/auth/${provider}/callback`;
}

function resolveExplicitGoogleCallbackUrl() {
  return firstEnv(process.env, GOOGLE_CALLBACK_NAMES);
}

function resolveGoogleCallbackUrl(req, normalizePublicAppUrl) {
  const hostPinned = resolveHostPinnedOAuthCallback(req, 'google');
  if (hostPinned) return hostPinned;
  const explicit = resolveExplicitGoogleCallbackUrl();
  if (explicit) return explicit;
  return `${resolvePublicApiOrigin(req, normalizePublicAppUrl).replace(/\/+$/, '')}/api/auth/google/callback`;
}

function getMicrosoftTenantId(env = process.env) {
  const forceTenantAuthority = ['1', 'true', 'yes', 'on'].includes(
    String(env.MICROSOFT_FORCE_TENANT_AUTHORITY || env.AZURE_FORCE_TENANT_AUTHORITY || '').trim().toLowerCase()
  );
  if (!forceTenantAuthority) {
    return String(
      env.MICROSOFT_PUBLIC_TENANT_ID
      || env.AZURE_PUBLIC_TENANT_ID
      || env.MICROSOFT_AUTHORITY_TENANT
      || 'common'
    ).trim() || 'common';
  }

  return String(
    env.MICROSOFT_TENANT_ID
    || env.AZURE_TENANT_ID
    || env.MS_TENANT_ID
    || env.MICROSOFT_AUTHORITY_TENANT
    || 'common'
  ).trim() || 'common';
}

function resolveExplicitMicrosoftCallbackUrl() {
  return firstEnv(process.env, MICROSOFT_CALLBACK_NAMES);
}

function resolveMicrosoftCallbackUrl(req, normalizePublicAppUrl) {
  const hostPinned = resolveHostPinnedOAuthCallback(req, 'microsoft');
  if (hostPinned) return hostPinned;
  const explicit = resolveExplicitMicrosoftCallbackUrl();
  if (explicit) return explicit;
  return `${resolvePublicApiOrigin(req, normalizePublicAppUrl).replace(/\/+$/, '')}/api/auth/microsoft/callback`;
}

function resolveCanonicalOAuthStartRedirect(req, provider, normalizePublicAppUrl) {
  const hostname = resolveRequestHostname(req);
  if (isPublicFunesterieOAuthHost(hostname) && !isCentralFunesterieOAuthHost(hostname)) {
    const target = new URL(`/api/auth/${provider}/start`, 'https://funesterie.me');
    for (const [key, value] of Object.entries(req?.query || {})) {
      if (Array.isArray(value)) {
        value.forEach((entry) => target.searchParams.append(key, String(entry)));
      } else if (value !== undefined && value !== null) {
        target.searchParams.set(key, String(value));
      }
    }
    if (!target.searchParams.get('surface')) {
      target.searchParams.set('surface', resolveOAuthSurfaceFromRequest(req));
    }
    return target.toString();
  }

  if (!hostname) return '';

  try {
    const callbackUrl = new URL(
      provider === 'microsoft'
        ? resolveMicrosoftCallbackUrl(req, normalizePublicAppUrl)
        : resolveGoogleCallbackUrl(req, normalizePublicAppUrl)
    );
    const callbackHost = callbackUrl.hostname.toLowerCase();
    if (!callbackHost || callbackHost === hostname) return '';
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return '';

    const target = new URL(`/api/auth/${provider}/start`, `${callbackUrl.protocol}//${callbackUrl.host}`);
    for (const [key, value] of Object.entries(req?.query || {})) {
      if (Array.isArray(value)) {
        value.forEach((entry) => target.searchParams.append(key, String(entry)));
      } else if (value !== undefined && value !== null) {
        target.searchParams.set(key, String(value));
      }
    }
    if (!target.searchParams.get('surface')) {
      target.searchParams.set('surface', resolveOAuthSurfaceFromRequest(req));
    }
    return target.toString();
  } catch {
    return '';
  }
}

function getMicrosoftOAuthBaseUrl(env = process.env) {
  return `https://login.microsoftonline.com/${encodeURIComponent(getMicrosoftTenantId(env))}/oauth2/v2.0`;
}

function createOAuthPkcePair(randomSource = nodeCrypto) {
  const codeVerifier = randomSource.randomBytes(48).toString('base64url');
  const codeChallenge = nodeCrypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

function isMicrosoftInvalidClientError(detail = '') {
  const normalized = String(detail || '').toLowerCase();
  return normalized.includes('invalid_client')
    || normalized.includes('aadsts7000215')
    || normalized.includes('aadsts7000222');
}

function shouldTryMicrosoftPublicClientFallback(env = process.env) {
  const raw = String(
    env.MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK
    || env.AZURE_OAUTH_PUBLIC_CLIENT_FALLBACK
    || env.A11_MICROSOFT_OAUTH_PUBLIC_CLIENT_FALLBACK
    || 'true'
  ).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function resolveSessionCookieDomain(req) {
  const explicit = String(process.env.A11_SESSION_COOKIE_DOMAIN || '').trim();
  if (explicit) return explicit;

  const hostname = resolveRequestHostname(req);
  if (hostname === 'funesterie.me' || hostname.endsWith('.funesterie.me')) {
    return '.funesterie.me';
  }
  return '';
}

function resolveCookieOptions(req, normalizePublicAppUrl, maxAge) {
  const secure = isSecureRequest(req);
  const explicitSameSite = normalizeSameSite(process.env.A11_SESSION_COOKIE_SAMESITE);
  let sameSite = explicitSameSite || 'lax';
  if (sameSite === 'none' && !secure) sameSite = 'lax';

  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  };
  if (Number.isFinite(maxAge) && maxAge > 0) {
    options.maxAge = maxAge;
  }

  const domain = resolveSessionCookieDomain(req);
  if (domain) options.domain = domain;
  return options;
}

function sanitizeOAuthTracePath(value) {
  const raw = String(value || '');
  if (!raw) return '';
  const redact = (input) => input.replace(
    /([?&](?:code|state|token|credential|id_token|access_token)=)[^&#\s]+/gi,
    '$1[redacted]'
  );
  try {
    const parsed = new URL(raw, 'https://trace.local');
    for (const key of ['code', 'state', 'token', 'credential', 'id_token', 'access_token']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return redact(raw);
  }
}

function buildOAuthTraceMeta(req, normalizePublicAppUrl, extra = {}) {
  const cookieOptions = resolveCookieOptions(req, normalizePublicAppUrl);
  const cookieHeader = String(req?.headers?.cookie || '');
  return {
    method: req?.method,
    path: sanitizeOAuthTracePath(req?.originalUrl || req?.url),
    host: String(req?.headers?.host || ''),
    forwardedHost: String(req?.headers?.['x-forwarded-host'] || ''),
    forwardedProto: String(req?.headers?.['x-forwarded-proto'] || ''),
    origin: String(req?.headers?.origin || ''),
    requestOrigin: resolveRequestOrigin(req),
    secureRequest: isSecureRequest(req),
    cookieSecure: cookieOptions.secure === true,
    cookieSameSite: cookieOptions.sameSite,
    cookieDomain: cookieOptions.domain || '',
    hasCookieHeader: Boolean(cookieHeader),
    ...extra,
  };
}

function logOAuthTrace(provider, event, req, normalizePublicAppUrl, extra = {}, level = 'info') {
  if (level === 'info' && !isOAuthTraceEnabled()) return;
  const meta = buildOAuthTraceMeta(req, normalizePublicAppUrl, extra);
  const logger = level === 'warn' ? console.warn : console.log;
  logger(`[AUTH][${provider}] ${event}:`, meta);
}

function safeFrontendRedirect(frontendUrl, pathOrUrl = '/auth/success') {
  const base = String(frontendUrl || 'https://a11.funesterie.me').replace(/\/+$/, '');
  const raw = String(pathOrUrl || '/auth/success').trim();
  if (!raw || raw.startsWith('//')) return `${base}/auth/success`;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const baseParsed = new URL(base);
      if (parsed.origin === baseParsed.origin) return parsed.toString();
    } catch {}
    return `${base}/auth/success`;
  }
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function isAllowedOAuthFrontendOrigin(origin) {
  const normalized = String(origin || '').trim().toLowerCase().replace(/\/+$/, '');
  if (!normalized) return false;
  if ([
    'https://a11.funesterie.me',
    'https://cp.funesterie.me',
    'https://funesterie.me',
    'https://www.funesterie.me',
    'https://k44.funesterie.me',
    'https://kaen44.funesterie.me',
    'https://vivy.funesterie.me',
    'https://music.funesterie.me',
  ].includes(normalized)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
      && ['3000', '3001', '5173', '4173'].includes(parsed.port || '');
  } catch {
    return false;
  }
}

function resolveOAuthRedirectUrl(frontendUrl, pathOrUrl = '/auth/success') {
  const base = String(frontendUrl || 'https://a11.funesterie.me').replace(/\/+$/, '');
  const raw = String(pathOrUrl || '/auth/success').trim();
  if (!raw || raw.startsWith('//')) return `${base}/auth/success`;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (isAllowedOAuthFrontendOrigin(parsed.origin)) return parsed.toString();
    } catch {}
    return `${base}/auth/success`;
  }

  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function appendOAuthTokenFragment(targetUrl, token, provider) {
  if (!token) return targetUrl;
  try {
    const parsed = new URL(targetUrl);
    const hashParams = new URLSearchParams(String(parsed.hash || '').replace(/^#/, ''));
    hashParams.set('a11_token', token);
    hashParams.set('provider', provider || 'oauth');
    parsed.hash = hashParams.toString();
    return parsed.toString();
  } catch {
    return targetUrl;
  }
}

function redirectOAuthSuccess(res, frontendUrl, returnTo, token, provider) {
  const target = resolveOAuthRedirectUrl(frontendUrl, returnTo || '/auth/success');
  let needsFragmentToken = false;
  try {
    const targetOrigin = new URL(target).origin;
    const frontendOrigin = new URL(String(frontendUrl || 'https://a11.funesterie.me')).origin;
    needsFragmentToken = targetOrigin !== frontendOrigin;
  } catch {
    needsFragmentToken = false;
  }
  return res.redirect(needsFragmentToken ? appendOAuthTokenFragment(target, token, provider) : target);
}

function resolveOAuthBridgeOrigin(frontendUrl, returnTo) {
  const target = resolveOAuthRedirectUrl(frontendUrl, returnTo || '/auth/success');
  try {
    const targetOrigin = new URL(target).origin;
    const frontendOrigin = new URL(String(frontendUrl || 'https://a11.funesterie.me')).origin;
    if (targetOrigin === frontendOrigin) return '';
    return isAllowedOAuthFrontendOrigin(targetOrigin) ? targetOrigin : '';
  } catch {
    return '';
  }
}

function buildCentralLoginRedirect(frontendUrl, returnTo, errorCode) {
  const target = new URL('/login', 'https://funesterie.me');
  const error = String(errorCode || '').trim();
  const safeReturnTo = String(returnTo || '').trim();
  if (safeReturnTo) {
    target.searchParams.set('returnTo', resolveOAuthRedirectUrl(frontendUrl, safeReturnTo));
  }
  if (error) target.searchParams.set('error', error);
  return target.toString();
}

function redirectOAuthErrorToReturnTo(res, frontendUrl, returnTo, errorCode) {
  const safeReturnTo = String(returnTo || '').trim();
  if (!safeReturnTo) return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, errorCode));
  return res.redirect(buildCentralLoginRedirect(frontendUrl, safeReturnTo, errorCode));
}

function redirectOAuthErrorWithState(res, frontendUrl, statePayload, errorCode) {
  return redirectOAuthErrorToReturnTo(res, frontendUrl, statePayload?.returnTo, errorCode);
}

function resolvePublicOAuthError(provider, error) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const code = String(error?.message || error || 'oauth_failed').trim().toLowerCase();

  if (normalizedProvider === 'google') {
    if (code === 'invalid_client') return 'google_invalid_client';
    if (code === 'invalid_grant') return 'google_invalid_grant';
    if (code === 'redirect_uri_mismatch') return 'google_redirect_uri_mismatch';
    if (code === 'access_denied') return 'google_access_denied';
  }

  if (normalizedProvider === 'microsoft') {
    if (
      code.includes('aadsts7000215')
      || code.includes('aadsts700016')
      || code.includes('invalid client secret')
      || code.includes('unauthorized_client')
      || code.includes('client does not exist')
      || code.includes('not enabled for consumers')
    ) return 'microsoft_invalid_client';
    if (
      code.includes('aadsts50020')
      || code.includes('does not exist in tenant')
      || code.includes('needs to be added as an external user')
    ) return 'microsoft_tenant_mismatch';
    if (code.includes('aadsts65001') || code.includes('consent_required')) return 'microsoft_consent_required';
    if (code.includes('access_denied')) return 'microsoft_access_denied';
    if (
      code.includes('invalid_grant')
      || code.includes('aadsts70000')
      || code.includes('authorization code')
      || code.includes('code is invalid')
      || code.includes('code is expired')
      || code.includes('malformed')
    ) return 'microsoft_invalid_grant';
  }

  return 'oauth_failed';
}

function readCookie(req, name) {
  return String(req?.cookies?.[name] || parseCookieHeader(req?.headers?.cookie)[name] || '').trim();
}

async function exchangeGoogleCodeForTokens({ code, callbackUrl, clientId, clientSecret }) {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `google_token_exchange_failed_${response.status}`);
  }
  return payload;
}

async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch(GOOGLE_OAUTH_USERINFO_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `google_userinfo_failed_${response.status}`);
  }
  return payload;
}

async function exchangeMicrosoftCodeForTokens({ code, callbackUrl, clientId, clientSecret, scope, codeVerifier }) {
  const tokenScope = normalizeOAuthScopeList(scope).join(' ') || 'openid profile email offline_access User.Read';
  const tokenUrl = `${getMicrosoftOAuthBaseUrl()}/token`;
  const baseParams = {
    code,
    client_id: clientId,
    redirect_uri: callbackUrl,
    grant_type: 'authorization_code',
    scope: tokenScope,
  };
  if (codeVerifier) baseParams.code_verifier = codeVerifier;

  async function postTokenRequest(extraParams = {}) {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...baseParams, ...extraParams }),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  const first = await postTokenRequest(clientSecret ? { client_secret: clientSecret } : {});
  if (first.response.ok) return first.payload;

  const firstDetail = [first.payload?.error, first.payload?.error_description]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(': ');

  if (
    clientSecret
    && codeVerifier
    && shouldTryMicrosoftPublicClientFallback()
    && isMicrosoftInvalidClientError(firstDetail)
  ) {
    const fallback = await postTokenRequest();
    if (fallback.response.ok) return fallback.payload;
  }

  if (!first.response.ok) {
    throw new Error(firstDetail || `microsoft_token_exchange_failed_${first.response.status}`);
  }
  return first.payload;
}

async function fetchMicrosoftUserInfo(accessToken) {
  const response = await fetch(MICROSOFT_GRAPH_ME_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || `microsoft_userinfo_failed_${response.status}`);
  }
  return payload;
}

async function activateFullAccessUser(db, user) {
  if (!db || !user?.id || !hasFullAccess(user) || user.subscription_active === true) {
    return user;
  }

  try {
    await db.query(
      'UPDATE users SET subscription_active=true, subscription_end_date=NULL, updated_at=NOW() WHERE id=$1',
      [user.id]
    );
    return { ...user, subscription_active: true, subscription_end_date: null };
  } catch (error) {
    console.warn('[AUTH] Full access activation failed:', error?.message);
    return user;
  }
}

function createAuthRouter({
  db,
  bcrypt,
  jwt,
  jwtSecret,
  jwtExpiry,
  registerIssuedToken,
  localAuthStore,
  defaultAdminUsername,
  defaultAdminEmail,
  defaultAdminPassword,
  emailService,
  crypto,
  normalizePublicAppUrl,
  authSessionRegistry,
  oauthTokenVault,
} = {}) {
  const router = express.Router();
  const sessionRegistry = authSessionRegistry || createAuthSessionRegistry({
    db,
    localAuthStore,
    logger: console,
  });
  const isAdminRequest = createIsAdminRequest({
    env: process.env,
    defaultAdminUsername,
    defaultAdminEmail,
  });

  function buildAdminAwarePublicUser(user = {}, extra = {}) {
    const publicUser = buildPublicAuthUser(user, extra);
    const adminCandidate = {
      ...user,
      ...extra,
      ...publicUser,
    };
    return {
      ...publicUser,
      isAdmin: isAdminRequest({ user: adminCandidate }),
    };
  }

  async function issueSessionCookie(req, res, user, extra = {}) {
    const surface = normalizeSurface(extra.surface || req?.query?.surface || resolveOAuthSurfaceFromRequest(req));
    const client = String(extra.client || req?.query?.client || 'web').trim().slice(0, 64) || 'web';
    const sessionInfo = await sessionRegistry.createSession({
      req,
      user: { ...user, ...extra },
      provider: extra.provider || user.provider || user.auth_provider || (extra.localAuth ? 'local' : ''),
      surface,
      client,
    });
    const sessionGeneration = Number(sessionInfo?.sessionGeneration ?? 0);
    const token = signUserToken({
      jwt,
      jwtSecret,
      jwtExpiry,
      user,
      extra: {
        ...extra,
        sid: sessionInfo?.sessionId || extra.sid,
        sessionGeneration,
        sv: sessionGeneration,
        surface,
        client,
      },
    });
    if (typeof registerIssuedToken === 'function') {
      registerIssuedToken(token);
    }
    res.cookie(
      A11_SESSION_COOKIE,
      token,
      resolveCookieOptions(req, normalizePublicAppUrl, Number(process.env.A11_SESSION_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000))
    );
    return token;
  }

  async function issueAuthResponse(req, res, user, extra = {}) {
    const token = await issueSessionCookie(req, res, user, extra);
    const decoded = jwt.decode(token) || {};
    return res.json({
      ok: true,
      success: true,
      token,
      expiresIn: jwtExpiry,
      user: buildAdminAwarePublicUser(user, decoded),
      session: {
        id: decoded.sid || null,
        version: decoded.sv ?? decoded.sessionGeneration ?? 0,
        surface: decoded.surface || undefined,
        provider: decoded.provider || undefined,
      },
    });
  }

  async function storeSessionOAuthTokens(sessionToken, provider, options = {}) {
    if (!oauthTokenVault || typeof oauthTokenVault.storeSessionProviderTokens !== 'function') return null;
    const decoded = typeof jwt.decode === 'function' ? (jwt.decode(sessionToken) || {}) : {};
    const sessionId = decoded.sid || decoded.sessionId || decoded.session_id;
    if (!sessionId) return null;
    try {
      return await oauthTokenVault.storeSessionProviderTokens({
        sessionId,
        provider,
        account: options.account,
        tokens: options.tokens || {},
        oauthScopes: options.oauthScopes,
        oauthScopeProfile: options.oauthScopeProfile,
      });
    } catch (error) {
      console.warn('[AUTH] OAuth token vault store failed:', error?.message);
      return null;
    }
  }

  function clearSessionCookies(req, res) {
    const options = resolveCookieOptions(req, normalizePublicAppUrl);
    res.clearCookie(A11_SESSION_COOKIE, options);
    res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, options);
    res.clearCookie(MICROSOFT_OAUTH_STATE_COOKIE, options);
    res.clearCookie(MICROSOFT_OAUTH_PKCE_COOKIE, options);
    if (options.domain) {
      const hostOnly = { ...options };
      delete hostOnly.domain;
      res.clearCookie(A11_SESSION_COOKIE, hostOnly);
      res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, hostOnly);
      res.clearCookie(MICROSOFT_OAUTH_STATE_COOKIE, hostOnly);
      res.clearCookie(MICROSOFT_OAUTH_PKCE_COOKIE, hostOnly);
    }
  }

  async function decodeRequestAuthClaims(req) {
    const tokenCandidates = extractRequestAuthTokenCandidates(req).ordered;
    if (!tokenCandidates.length) return null;

    let lastError = null;
    for (const token of tokenCandidates) {
      try {
        const decoded = jwt.verify(token, jwtSecret);
        await sessionRegistry.assertTokenCurrent(decoded);
        Object.defineProperty(decoded, '__authTokenUsed', {
          value: token,
          enumerable: false,
          configurable: true,
        });
        return decoded;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function mergeSessionOAuthConnector(req, provider, options = {}) {
    let existingConnectors = {};
    try {
      const currentClaims = await decodeRequestAuthClaims(req);
      existingConnectors = currentClaims?.oauthConnectors || currentClaims?.oauth_connectors || {};
      existingConnectors = mergeOAuthConnectorState(existingConnectors, currentClaims?.provider, {
        account: currentClaims?.email || currentClaims?.username,
        oauthScopes: currentClaims?.oauthScopes,
        oauthScopeProfile: currentClaims?.oauthScopeProfile,
        connectedAt: currentClaims?.iat ? new Date(Number(currentClaims.iat) * 1000).toISOString() : undefined,
      });
    } catch {
      existingConnectors = {};
    }
    return mergeOAuthConnectorState(existingConnectors, provider, options);
  }

  async function findOrCreateGoogleUser(profile) {
    const email = normalizeEmail(profile?.email);
    if (!email) {
      throw new Error('google_email_missing');
    }

    const existing = await db.query(
      'SELECT id, username, email, role, subscription_active, subscription_end_date FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1',
      [email]
    );
    if (existing.rows[0]) {
      return activateFullAccessUser(db, existing.rows[0]);
    }

    const seed = `${profile?.sub || ''}|${email}`;
    const localPart = email.split('@')[0] || 'google';
    const displayName = profile?.name || profile?.given_name || localPart;
    const baseUsername = normalizeUsernameCandidate(displayName, normalizeUsernameCandidate(localPart, 'google-user'));
    const hashSuffix = stableHash(seed, 10);
    const usernameCandidates = [
      baseUsername,
      `${baseUsername}-${hashSuffix.slice(0, 6)}`,
      `google-${hashSuffix}`,
    ];

    const randomSource = crypto && typeof crypto.randomBytes === 'function' ? crypto : nodeCrypto;
    const passwordHash = await bcrypt.hash(`google:${hashSuffix}:${randomSource.randomBytes(24).toString('hex')}`, 10);
    const fullAccess = isFullAccessEmail(email);

    for (const username of usernameCandidates) {
      try {
        const inserted = await db.query(
          `INSERT INTO users (username, email, password_hash, subscription_active)
           VALUES ($1, $2, $3, $4)
           RETURNING id, username, email, role, subscription_active, subscription_end_date`,
          [username, email, passwordHash, fullAccess]
        );
        return inserted.rows[0];
      } catch (error) {
        const combined = `${error?.message || ''} ${error?.detail || ''}`.toLowerCase();
        if (combined.includes('email')) {
          const reloaded = await db.query(
            'SELECT id, username, email, role, subscription_active, subscription_end_date FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1',
            [email]
          );
          if (reloaded.rows[0]) return activateFullAccessUser(db, reloaded.rows[0]);
        }
        if (!combined.includes('username') && !combined.includes('duplicate')) {
          throw error;
        }
      }
    }

    throw new Error('google_user_create_failed');
  }

  async function findOrCreateMicrosoftUser(profile) {
    const email = normalizeEmail(profile?.mail || profile?.userPrincipalName || profile?.email || profile?.preferred_username);
    if (!email) {
      throw new Error('microsoft_email_missing');
    }

    const existing = await db.query(
      'SELECT id, username, email, role, subscription_active, subscription_end_date FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1',
      [email]
    );
    if (existing.rows[0]) {
      return activateFullAccessUser(db, existing.rows[0]);
    }

    const seed = `${profile?.id || ''}|${email}`;
    const localPart = email.split('@')[0] || 'microsoft';
    const displayName = profile?.displayName || profile?.givenName || localPart;
    const baseUsername = normalizeUsernameCandidate(displayName, normalizeUsernameCandidate(localPart, 'microsoft-user'));
    const hashSuffix = stableHash(seed, 10);
    const usernameCandidates = [
      baseUsername,
      `${baseUsername}-${hashSuffix.slice(0, 6)}`,
      `microsoft-${hashSuffix}`,
    ];

    const randomSource = crypto && typeof crypto.randomBytes === 'function' ? crypto : nodeCrypto;
    const passwordHash = await bcrypt.hash(`microsoft:${hashSuffix}:${randomSource.randomBytes(24).toString('hex')}`, 10);
    const fullAccess = isFullAccessEmail(email);

    for (const username of usernameCandidates) {
      try {
        const inserted = await db.query(
          `INSERT INTO users (username, email, password_hash, subscription_active)
           VALUES ($1, $2, $3, $4)
           RETURNING id, username, email, role, subscription_active, subscription_end_date`,
          [username, email, passwordHash, fullAccess]
        );
        return inserted.rows[0];
      } catch (error) {
        const combined = `${error?.message || ''} ${error?.detail || ''}`.toLowerCase();
        if (combined.includes('email')) {
          const reloaded = await db.query(
            'SELECT id, username, email, role, subscription_active, subscription_end_date FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1',
            [email]
          );
          if (reloaded.rows[0]) return activateFullAccessUser(db, reloaded.rows[0]);
        }
        if (!combined.includes('username') && !combined.includes('duplicate')) {
          throw error;
        }
      }
    }

    throw new Error('microsoft_user_create_failed');
  }

  router.post('/api/auth/register', express.json(), async (req, res) => {
    const { username, email, password } = req.body || {};
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedUsername || !normalizedEmail || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (!db) {
      if (!localAuthStore || typeof localAuthStore.createUser !== 'function') {
        return res.status(503).json({ error: 'auth_store_unavailable' });
      }

      try {
        const hash = await bcrypt.hash(password, 10);
        const user = await localAuthStore.createUser({
          username: normalizedUsername,
          email: normalizedEmail,
          passwordHash: hash,
        });
        console.log('[AUTH] Local register:', normalizedUsername);
        return await issueAuthResponse(req, res, user, { localAuth: true });
      } catch (e) {
        console.warn('[AUTH] Local register failed:', e?.message);
        const code = String(e?.code || e?.message || '').trim();
        if (code === 'username_taken') return res.status(400).json({ error: 'username_taken' });
        if (code === 'email_taken') return res.status(400).json({ error: 'email_taken' });
        if (code === 'missing_fields') return res.status(400).json({ error: 'Missing fields' });
        return res.status(500).json({ error: 'local_auth_register_failed' });
      }
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      const fullAccess = isFullAccessEmail(normalizedEmail);
      const { rows } = await db.query(
        'INSERT INTO users (username, email, password_hash, subscription_active) VALUES ($1,$2,$3,$4) RETURNING id, username, email, role, subscription_active',
        [normalizedUsername, normalizedEmail, hash, fullAccess]
      );
      const user = rows[0];
      console.log('[AUTH] Register:', normalizedUsername);
      return await issueAuthResponse(req, res, user);
    } catch (e) {
      console.warn('[AUTH] Register failed:', e?.message);
      const message = String(e?.message || '');
      const detail = String(e?.detail || '');
      const combined = `${message} ${detail}`.toLowerCase();
      let error = 'User already exists';
      if (combined.includes('username')) error = 'username_taken';
      else if (combined.includes('email')) error = 'email_taken';
      return res.status(400).json({ error });
    }
  });

  router.post('/api/auth/login', express.json(), async (req, res) => {
    const { email, username, password } = req.body || {};
    const identifier = String(email || username || '').trim();
    const normalizedEmail = normalizeEmail(email);
    console.log('[AUTH] Login attempt received');

    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Missing credentials' });
    }

    if (!db) {
      if (localAuthStore && typeof localAuthStore.findUserByIdentifier === 'function') {
        try {
          const localUser = await localAuthStore.findUserByIdentifier(identifier);
          if (localUser?.password_hash) {
            const ok = await bcrypt.compare(password, localUser.password_hash);
            if (ok) {
              return await issueAuthResponse(req, res, localUser, { localAuth: true });
            }
          }
        } catch (e) {
          console.warn('[AUTH] Local login failed:', e?.message);
        }
      }

      const { username: fallbackUsername, password: fallbackPassword } = req.body || {};
      const normalizedFallbackUser = String(fallbackUsername || '').trim().toLowerCase();
      const fallbackDefaultAdmin = String(defaultAdminUsername || '').trim().toLowerCase();
      const isLegacyAdmin = normalizedFallbackUser === 'admin' && fallbackPassword === '1234';
      const isDefaultAdmin = normalizedFallbackUser === fallbackDefaultAdmin && fallbackPassword === defaultAdminPassword;
      if (isLegacyAdmin || isDefaultAdmin) {
        const resolvedUsername = isLegacyAdmin ? 'admin' : defaultAdminUsername;
        return await issueAuthResponse(
          req,
          res,
          { id: resolvedUsername.toLowerCase(), username: resolvedUsername, role: 'admin' },
          { role: 'admin', fullAccess: true }
        );
      }
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    try {
      const { rows } = await db.query(
        'SELECT * FROM users WHERE LOWER(email)=LOWER($1) OR username=$1 LIMIT 1',
        [normalizedEmail || identifier]
      );
      if (!rows.length) return res.status(401).json({ success: false, error: 'Invalid credentials' });
      const user = rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });
      const activatedUser = await activateFullAccessUser(db, user);
      console.log('[AUTH] Login ok');
      return await issueAuthResponse(req, res, activatedUser);
    } catch (e) {
      console.error('[AUTH] Login error:', e?.message);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  router.post('/api/auth/google', express.json(), async (req, res) => {
    const credential = String(req.body?.credential || req.body?.idToken || '').trim();
    const clientIds = getGoogleClientIds(process.env);
    if (clientIds.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'google_auth_not_configured',
        message: 'Connexion Google non configuree sur ce serveur.',
      });
    }

    try {
      const profile = await verifyGoogleIdToken({ idToken: credential, jwt, clientIds });
      const email = normalizeEmail(profile?.email);
      const emailVerified = profile?.email_verified === true || String(profile?.email_verified || '').toLowerCase() === 'true';
      if (!email || !emailVerified) {
        return res.status(401).json({
          success: false,
          error: 'google_email_not_verified',
        });
      }

      if (!db) {
        const googleUser = {
          id: `google-${stableHash(profile?.sub || email, 16)}`,
          username: normalizeUsernameCandidate(profile?.name || email.split('@')[0], 'google-user'),
          email,
          provider: 'google',
        };
        console.log('[AUTH] Google local login:', email);
        return await issueAuthResponse(req, res, googleUser, {
          provider: 'google',
          displayName: resolveGoogleProfileDisplayName(profile, email),
        });
      }

      const user = await findOrCreateGoogleUser({ ...profile, email });
      console.log('[AUTH] Google login:', email);
      return await issueAuthResponse(req, res, user, {
        provider: 'google',
        displayName: resolveGoogleProfileDisplayName(profile, email),
      });
    } catch (error) {
      const code = String(error?.message || 'google_auth_failed');
      const status = code === 'google_auth_not_configured' ? 503 : 401;
      console.warn('[AUTH] Google login failed:', code);
      return res.status(status).json({
        success: false,
        error: code,
        message: status === 503 ? 'Connexion Google non configuree sur ce serveur.' : 'Connexion Google impossible.',
      });
    }
  });

  function getGoogleOAuthConfig(req) {
    const clientIds = getGoogleClientIds(process.env);
    const clientId = firstEnv(process.env, GOOGLE_CLIENT_ID_NAMES) || clientIds[0] || '';
    const clientSecret = firstEnv(process.env, GOOGLE_CLIENT_SECRET_NAMES);
    const callbackUrl = resolveGoogleCallbackUrl(req, normalizePublicAppUrl);
    return { clientIds: clientIds.length ? clientIds : [clientId].filter(Boolean), clientId, clientSecret, callbackUrl };
  }

  function getMicrosoftOAuthConfig(req) {
    const clientId = firstEnv(process.env, MICROSOFT_CLIENT_ID_NAMES);
    const clientSecret = firstEnv(process.env, MICROSOFT_CLIENT_SECRET_NAMES);
    const callbackUrl = resolveMicrosoftCallbackUrl(req, normalizePublicAppUrl);
    return { clientId, clientSecret, callbackUrl };
  }

  function resolveOAuthScope(envNames, fallbackScope) {
    for (const envName of envNames) {
      const configured = String(process.env[envName] || '').trim();
      if (configured) {
        return configured
          .split(/[,\s]+/)
          .map((scope) => scope.trim())
          .filter(Boolean)
          .join(' ');
      }
    }
    return fallbackScope;
  }

  function resolveRequestedOAuthScopeProfile(req, envNames, fallbackProfile = 'basic') {
    const requestedProfile = String(
      req.query?.scopeProfile
      || req.query?.scope_profile
      || req.query?.intent
      || req.query?.scopeMode
      || ''
    ).trim().toLowerCase();
    const defaultProfile = envNames
      .map((name) => String(process.env[name] || '').trim().toLowerCase())
      .find(Boolean) || fallbackProfile;
    return requestedProfile || defaultProfile || fallbackProfile;
  }

  function resolveGoogleOAuthScopeProfile(req) {
    return resolveRequestedOAuthScopeProfile(
      req,
      ['GOOGLE_OAUTH_DEFAULT_PROFILE', 'A11_GOOGLE_OAUTH_DEFAULT_PROFILE'],
      'basic'
    );
  }

  function resolveMicrosoftOAuthScopeProfile(req) {
    return resolveRequestedOAuthScopeProfile(
      req,
      ['MICROSOFT_OAUTH_DEFAULT_PROFILE', 'A11_MICROSOFT_OAUTH_DEFAULT_PROFILE'],
      'basic'
    );
  }

  function resolveGoogleOAuthScope(req) {
    const profile = resolveGoogleOAuthScopeProfile(req);

    if (['drive', 'files', 'google-drive'].includes(profile)) {
      const allowDriveProfile = isTruthy(
        process.env.GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE
        || process.env.A11_GOOGLE_OAUTH_ALLOW_DRIVE_PROFILE
      );
      if (!allowDriveProfile) {
        return resolveOAuthScope(
          ['GOOGLE_OAUTH_LOGIN_SCOPES', 'A11_GOOGLE_OAUTH_LOGIN_SCOPES'],
          'openid email profile'
        );
      }
      return resolveOAuthScope(
        ['GOOGLE_OAUTH_DRIVE_SCOPES', 'A11_GOOGLE_OAUTH_DRIVE_SCOPES', 'GOOGLE_OAUTH_SCOPES', 'A11_GOOGLE_OAUTH_SCOPES'],
        'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly'
      );
    }

    return resolveOAuthScope(
      ['GOOGLE_OAUTH_LOGIN_SCOPES', 'A11_GOOGLE_OAUTH_LOGIN_SCOPES'],
      'openid email profile'
    );
  }

  function resolveMicrosoftOAuthScope(req) {
    const profile = resolveMicrosoftOAuthScopeProfile(req);

    if (['drive', 'files', 'onedrive', 'microsoft-drive'].includes(profile)) {
      return resolveOAuthScope(
        [
          'MICROSOFT_OAUTH_DRIVE_SCOPES',
          'AZURE_OAUTH_DRIVE_SCOPES',
          'A11_MICROSOFT_OAUTH_DRIVE_SCOPES',
          'MICROSOFT_OAUTH_SCOPES',
          'AZURE_OAUTH_SCOPES',
          'A11_MICROSOFT_OAUTH_SCOPES',
        ],
        'openid profile email offline_access User.Read Files.ReadWrite'
      );
    }

    return resolveOAuthScope(
      ['MICROSOFT_OAUTH_LOGIN_SCOPES', 'AZURE_OAUTH_LOGIN_SCOPES', 'A11_MICROSOFT_OAUTH_LOGIN_SCOPES'],
      'openid profile email offline_access User.Read'
    );
  }

  function redirectOAuthError(req, res, errorCode) {
    const frontendUrl = resolveFrontendUrl(req, normalizePublicAppUrl);
    const returnTo = String(req.query?.returnTo || '').trim();
    if (returnTo) return redirectOAuthErrorToReturnTo(res, frontendUrl, returnTo, errorCode);
    return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, errorCode));
  }

  router.get('/api/auth/google/start', (req, res) => {
    const canonicalStart = resolveCanonicalOAuthStartRedirect(req, 'google', normalizePublicAppUrl);
    if (canonicalStart) {
      logOAuthTrace('google', 'start_canonical_redirect', req, normalizePublicAppUrl, {
        canonicalStart,
      });
      return res.redirect(canonicalStart);
    }

    const { clientId, clientSecret, callbackUrl } = getGoogleOAuthConfig(req);
    if (!clientId || !clientSecret || !callbackUrl) {
      logOAuthTrace('google', 'start_not_configured', req, normalizePublicAppUrl, {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasCallbackUrl: Boolean(callbackUrl),
      }, 'warn');
      return redirectOAuthError(req, res, 'google_auth_not_configured');
    }

    const nonce = nodeCrypto.randomBytes(24).toString('base64url');
    const client = String(req.query?.client || 'web').trim().slice(0, 32) || 'web';
    const returnTo = String(req.query?.returnTo || '/auth/success').trim() || '/auth/success';
    const surface = resolveOAuthSurfaceFromRequest(req);
    const oauthScopeProfile = resolveGoogleOAuthScopeProfile(req);
    const oauthScope = resolveGoogleOAuthScope(req);
    const state = jwt.sign(
      {
        typ: 'google_oauth_state',
        nonce,
        client,
        returnTo,
        surface,
        oauthScopeProfile,
        oauthScopes: normalizeOAuthScopeList(oauthScope),
      },
      jwtSecret,
      { expiresIn: '10m' }
    );

    const stateCookieOptions = resolveCookieOptions(req, normalizePublicAppUrl, 10 * 60 * 1000);
    res.cookie(GOOGLE_OAUTH_STATE_COOKIE, state, stateCookieOptions);
    logOAuthTrace('google', 'start_redirect', req, normalizePublicAppUrl, {
      callbackUrl,
      hasClientId: true,
      stateCookieSecure: stateCookieOptions.secure === true,
      stateCookieSameSite: stateCookieOptions.sameSite,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: oauthScope,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: String(req.query?.prompt || 'select_account').trim() || 'select_account',
      state,
    });

    return res.redirect(`${GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`);
  });

  router.get('/api/auth/google/callback', async (req, res) => {
    const frontendUrl = resolveFrontendUrl(req, normalizePublicAppUrl);
    const error = String(req.query?.error || '').trim();
    if (error) {
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, error));
    }

    const code = String(req.query?.code || '').trim();
    const state = String(req.query?.state || '').trim();
    const stateCookie = readCookie(req, GOOGLE_OAUTH_STATE_COOKIE);
    if (!code || !state || !stateCookie || state !== stateCookie) {
      logOAuthTrace('google', 'callback_state_invalid', req, normalizePublicAppUrl, {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasStateCookie: Boolean(stateCookie),
        stateMatchesCookie: Boolean(state && stateCookie && state === stateCookie),
      }, 'warn');
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'oauth_state_invalid'));
    }

    let statePayload;
    try {
      statePayload = jwt.verify(state, jwtSecret);
      if (statePayload?.typ !== 'google_oauth_state') throw new Error('bad_state_type');
    } catch (stateError) {
      logOAuthTrace('google', 'callback_state_expired_or_bad', req, normalizePublicAppUrl, {
        stateError: String(stateError?.message || stateError || 'unknown_state_error'),
      }, 'warn');
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'oauth_state_expired'));
    }

    const { clientIds, clientId, clientSecret, callbackUrl } = getGoogleOAuthConfig(req);
    if (!clientId || !clientSecret || !callbackUrl) {
      logOAuthTrace('google', 'callback_not_configured', req, normalizePublicAppUrl, {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasCallbackUrl: Boolean(callbackUrl),
      }, 'warn');
      clearSessionCookies(req, res);
      return redirectOAuthErrorWithState(res, frontendUrl, statePayload, 'google_auth_not_configured');
    }

    try {
      const tokens = await exchangeGoogleCodeForTokens({ code, callbackUrl, clientId, clientSecret });
      const idTokenProfile = tokens?.id_token
        ? await verifyGoogleIdToken({ idToken: tokens.id_token, jwt, clientIds })
        : {};
      const userInfoProfile = tokens?.access_token
        ? await fetchGoogleUserInfo(tokens.access_token)
        : {};

      const email = normalizeEmail(idTokenProfile?.email || userInfoProfile?.email);
      const emailVerified = idTokenProfile?.email_verified === true
        || userInfoProfile?.verified_email === true
        || String(idTokenProfile?.email_verified || userInfoProfile?.verified_email || '').toLowerCase() === 'true';
      if (!email || !emailVerified) {
        clearSessionCookies(req, res);
        return redirectOAuthErrorWithState(res, frontendUrl, statePayload, 'google_email_not_verified');
      }

      const profile = {
        ...userInfoProfile,
        ...idTokenProfile,
        sub: idTokenProfile?.sub || userInfoProfile?.id || userInfoProfile?.sub,
        email,
        email_verified: emailVerified,
        provider: 'google',
      };

      const user = db
        ? await findOrCreateGoogleUser(profile)
        : {
            id: `google-${stableHash(profile?.sub || email, 16)}`,
            username: normalizeUsernameCandidate(profile?.name || email.split('@')[0], 'google-user'),
            email,
            provider: 'google',
          };

      const bridgeOrigin = resolveOAuthBridgeOrigin(frontendUrl, statePayload?.returnTo || '/auth/success');
      const oauthConnectors = await mergeSessionOAuthConnector(req, 'google', {
        account: email,
        oauthScopeProfile: statePayload?.oauthScopeProfile,
        oauthScopes: tokens?.scope || statePayload?.oauthScopes,
      });
      const sessionToken = await issueSessionCookie(req, res, user, {
        provider: 'google',
        displayName: resolveGoogleProfileDisplayName(profile, email),
        surface: statePayload?.surface,
        client: statePayload?.client,
        oauthScopeProfile: statePayload?.oauthScopeProfile,
        oauthScopes: tokens?.scope || statePayload?.oauthScopes,
        oauthConnectors,
        ...(bridgeOrigin ? { oauthBridge: true, bridgeOrigin } : {}),
      });
      await storeSessionOAuthTokens(sessionToken, 'google', {
        account: email,
        tokens,
        oauthScopeProfile: statePayload?.oauthScopeProfile,
        oauthScopes: tokens?.scope || statePayload?.oauthScopes,
      });
      res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, resolveCookieOptions(req, normalizePublicAppUrl));
      console.log('[AUTH] Google OAuth login:', email);
      return redirectOAuthSuccess(res, frontendUrl, statePayload?.returnTo || '/auth/success', sessionToken, 'google');
    } catch (callbackError) {
      clearSessionCookies(req, res);
      const publicError = resolvePublicOAuthError('google', callbackError);
      logOAuthTrace('google', 'callback_failed', req, normalizePublicAppUrl, {
        callbackUrl,
        error: String(callbackError?.message || callbackError || 'oauth_failed'),
        publicError,
      }, 'warn');
      return redirectOAuthErrorWithState(res, frontendUrl, statePayload, publicError);
    }
  });

  router.get('/api/auth/microsoft/start', (req, res) => {
    const canonicalStart = resolveCanonicalOAuthStartRedirect(req, 'microsoft', normalizePublicAppUrl);
    if (canonicalStart) {
      logOAuthTrace('microsoft', 'start_canonical_redirect', req, normalizePublicAppUrl, {
        canonicalStart,
      });
      return res.redirect(canonicalStart);
    }

    const { clientId, clientSecret, callbackUrl } = getMicrosoftOAuthConfig(req);
    if (!clientId || !clientSecret || !callbackUrl) {
      logOAuthTrace('microsoft', 'start_not_configured', req, normalizePublicAppUrl, {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasCallbackUrl: Boolean(callbackUrl),
      }, 'warn');
      return redirectOAuthError(req, res, 'microsoft_auth_not_configured');
    }

    const nonce = nodeCrypto.randomBytes(24).toString('base64url');
    const client = String(req.query?.client || 'web').trim().slice(0, 32) || 'web';
    const returnTo = String(req.query?.returnTo || '/auth/success').trim() || '/auth/success';
    const surface = resolveOAuthSurfaceFromRequest(req);
    const oauthScopeProfile = resolveMicrosoftOAuthScopeProfile(req);
    const oauthScope = resolveMicrosoftOAuthScope(req);
    const pkce = createOAuthPkcePair(crypto && typeof crypto.randomBytes === 'function' ? crypto : nodeCrypto);
    const state = jwt.sign(
      {
        typ: 'microsoft_oauth_state',
        nonce,
        client,
        returnTo,
        surface,
        oauthScopeProfile,
        oauthScopes: normalizeOAuthScopeList(oauthScope),
        pkce: true,
      },
      jwtSecret,
      { expiresIn: '10m' }
    );
    const pkceState = jwt.sign(
      {
        typ: 'microsoft_oauth_pkce',
        nonce,
        codeVerifier: pkce.codeVerifier,
      },
      jwtSecret,
      { expiresIn: '10m' }
    );

    const stateCookieOptions = resolveCookieOptions(req, normalizePublicAppUrl, 10 * 60 * 1000);
    res.cookie(MICROSOFT_OAUTH_STATE_COOKIE, state, stateCookieOptions);
    res.cookie(MICROSOFT_OAUTH_PKCE_COOKIE, pkceState, stateCookieOptions);
    logOAuthTrace('microsoft', 'start_redirect', req, normalizePublicAppUrl, {
      callbackUrl,
      hasClientId: true,
      stateCookieSecure: stateCookieOptions.secure === true,
      stateCookieSameSite: stateCookieOptions.sameSite,
      pkce: true,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      response_mode: 'query',
      scope: oauthScope,
      prompt: String(req.query?.prompt || 'select_account').trim() || 'select_account',
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });

    return res.redirect(`${getMicrosoftOAuthBaseUrl()}/authorize?${params.toString()}`);
  });

  router.get('/api/auth/microsoft/callback', async (req, res) => {
    const frontendUrl = resolveFrontendUrl(req, normalizePublicAppUrl);
    const error = String(req.query?.error || '').trim();
    if (error) {
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, error));
    }

    const code = String(req.query?.code || '').trim();
    const state = String(req.query?.state || '').trim();
    const stateCookie = readCookie(req, MICROSOFT_OAUTH_STATE_COOKIE);
    if (!code || !state || !stateCookie || state !== stateCookie) {
      logOAuthTrace('microsoft', 'callback_state_invalid', req, normalizePublicAppUrl, {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasStateCookie: Boolean(stateCookie),
        stateMatchesCookie: Boolean(state && stateCookie && state === stateCookie),
      }, 'warn');
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'oauth_state_invalid'));
    }

    let statePayload;
    try {
      statePayload = jwt.verify(state, jwtSecret);
      if (statePayload?.typ !== 'microsoft_oauth_state') throw new Error('bad_state_type');
    } catch (stateError) {
      logOAuthTrace('microsoft', 'callback_state_expired_or_bad', req, normalizePublicAppUrl, {
        stateError: String(stateError?.message || stateError || 'unknown_state_error'),
      }, 'warn');
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'oauth_state_expired'));
    }

    let microsoftCodeVerifier = '';
    if (statePayload?.pkce === true) {
      const pkceCookie = readCookie(req, MICROSOFT_OAUTH_PKCE_COOKIE);
      try {
        const pkcePayload = jwt.verify(pkceCookie, jwtSecret);
        if (
          pkcePayload?.typ !== 'microsoft_oauth_pkce'
          || pkcePayload?.nonce !== statePayload?.nonce
          || !pkcePayload?.codeVerifier
        ) {
          throw new Error('bad_pkce_state');
        }
        microsoftCodeVerifier = String(pkcePayload.codeVerifier);
      } catch (pkceError) {
        logOAuthTrace('microsoft', 'callback_pkce_invalid', req, normalizePublicAppUrl, {
          pkceError: String(pkceError?.message || pkceError || 'unknown_pkce_error'),
        }, 'warn');
        clearSessionCookies(req, res);
        res.clearCookie(MICROSOFT_OAUTH_PKCE_COOKIE, resolveCookieOptions(req, normalizePublicAppUrl));
        return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'oauth_state_expired'));
      }
    }

    const { clientId, clientSecret, callbackUrl } = getMicrosoftOAuthConfig(req);
    if (!clientId || !clientSecret || !callbackUrl) {
      logOAuthTrace('microsoft', 'callback_not_configured', req, normalizePublicAppUrl, {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasCallbackUrl: Boolean(callbackUrl),
      }, 'warn');
      clearSessionCookies(req, res);
      return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'microsoft_auth_not_configured'));
    }

    try {
      const tokens = await exchangeMicrosoftCodeForTokens({
        code,
        callbackUrl,
        clientId,
        clientSecret,
        scope: statePayload?.oauthScopes,
        codeVerifier: microsoftCodeVerifier,
      });
      const profile = await fetchMicrosoftUserInfo(tokens.access_token);
      const email = normalizeEmail(profile?.mail || profile?.userPrincipalName || profile?.email);
      if (!email) {
        clearSessionCookies(req, res);
        return res.redirect(buildCentralLoginRedirect(frontendUrl, frontendUrl, 'microsoft_email_missing'));
      }

      const user = db
        ? await findOrCreateMicrosoftUser(profile)
        : {
            id: `microsoft-${stableHash(profile?.id || email, 16)}`,
            username: normalizeUsernameCandidate(profile?.displayName || email.split('@')[0], 'microsoft-user'),
            email,
            provider: 'microsoft',
          };

      const bridgeOrigin = resolveOAuthBridgeOrigin(frontendUrl, statePayload?.returnTo || '/auth/success');
      const oauthConnectors = await mergeSessionOAuthConnector(req, 'microsoft', {
        account: email,
        oauthScopeProfile: statePayload?.oauthScopeProfile,
        oauthScopes: tokens?.scope || statePayload?.oauthScopes,
      });
      const sessionToken = await issueSessionCookie(req, res, user, {
        provider: 'microsoft',
        displayName: resolveMicrosoftProfileDisplayName(profile, email),
        surface: statePayload?.surface,
        client: statePayload?.client,
        oauthScopeProfile: statePayload?.oauthScopeProfile,
        oauthScopes: tokens?.scope || statePayload?.oauthScopes,
        oauthConnectors,
        ...(bridgeOrigin ? { oauthBridge: true, bridgeOrigin } : {}),
      });
      await storeSessionOAuthTokens(sessionToken, 'microsoft', {
        account: email,
        tokens,
        oauthScopeProfile: statePayload?.oauthScopeProfile,
        oauthScopes: tokens?.scope || statePayload?.oauthScopes,
      });
      res.clearCookie(MICROSOFT_OAUTH_STATE_COOKIE, resolveCookieOptions(req, normalizePublicAppUrl));
      res.clearCookie(MICROSOFT_OAUTH_PKCE_COOKIE, resolveCookieOptions(req, normalizePublicAppUrl));
      console.log('[AUTH] Microsoft OAuth login:', email);
      return redirectOAuthSuccess(res, frontendUrl, statePayload?.returnTo || '/auth/success', sessionToken, 'microsoft');
    } catch (callbackError) {
      clearSessionCookies(req, res);
      const publicError = resolvePublicOAuthError('microsoft', callbackError);
      logOAuthTrace('microsoft', 'callback_failed', req, normalizePublicAppUrl, {
        callbackUrl,
        error: String(callbackError?.message || callbackError || 'oauth_failed'),
        publicError,
      }, 'warn');
      return redirectOAuthErrorWithState(res, frontendUrl, statePayload, publicError);
    }
  });

  router.get('/api/auth/me', async (req, res) => {
    const token = extractRequestAuthToken(req);
    if (!token) {
      return res.json({ ok: true, authenticated: false, user: null });
    }

    try {
      const decoded = await decodeRequestAuthClaims(req);
      return res.json({
        ok: true,
        authenticated: true,
        token: decoded.__authTokenUsed || token,
        user: buildAdminAwarePublicUser(decoded, decoded),
        session: {
          id: decoded.sid || null,
          version: decoded.sv ?? decoded.sessionGeneration ?? 0,
          surface: decoded.surface || undefined,
          provider: decoded.provider || undefined,
          expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
        },
      });
    } catch (error) {
      if (error?.code === 'A11_SESSION_REVOKED') {
        clearSessionCookies(req, res);
        return res.status(401).json({
          ok: false,
          authenticated: false,
          error: 'A11_SESSION_REVOKED',
          message: 'Session révoquée. Reconnecte-toi.',
        });
      }
      return res.status(401).json({
        ok: false,
        authenticated: false,
        error: 'A11_JWT_Invalid',
        message: error?.message || 'Session invalide',
      });
    }
  });

  router.get('/api/auth/connectors', async (req, res) => {
    const token = extractRequestAuthToken(req);
    let decoded = null;
    if (token) {
      try {
        decoded = await decodeRequestAuthClaims(req);
      } catch (error) {
        if (error?.code === 'A11_SESSION_REVOKED') {
          clearSessionCookies(req, res);
          return res.status(401).json({
            ok: false,
            authenticated: false,
            error: 'A11_SESSION_REVOKED',
            message: 'Session révoquée. Reconnecte-toi.',
          });
        }
        return res.status(401).json({
          ok: false,
          authenticated: false,
          error: 'A11_JWT_Invalid',
          message: error?.message || 'Session invalide',
        });
      }
    }

    const state = buildAccountConnectorState({
      user: decoded || {},
      req,
      env: process.env,
      googleCallbackUrl: resolveGoogleCallbackUrl(req, normalizePublicAppUrl),
      microsoftCallbackUrl: resolveMicrosoftCallbackUrl(req, normalizePublicAppUrl),
    });
    return res.json({
      ...state,
      authenticated: Boolean(decoded),
      user: decoded ? buildAdminAwarePublicUser(decoded, decoded) : null,
    });
  });

  router.get('/api/auth/sessions', async (req, res) => {
    try {
      const decoded = await decodeRequestAuthClaims(req);
      if (!decoded) return res.status(401).json({ ok: false, error: 'A11_JWT_Missing' });
      const sessions = await sessionRegistry.listSessions(decoded);
      const currentVersion = await sessionRegistry.getSessionVersion(decoded);
      return res.json({
        ok: true,
        sessions,
        global: {
          version: currentVersion,
          canLogoutAll: true,
        },
      });
    } catch (error) {
      const code = error?.code === 'A11_SESSION_REVOKED' ? 'A11_SESSION_REVOKED' : 'A11_JWT_Invalid';
      if (code === 'A11_SESSION_REVOKED') clearSessionCookies(req, res);
      return res.status(401).json({
        ok: false,
        error: code,
        message: code === 'A11_SESSION_REVOKED' ? 'Session révoquée. Reconnecte-toi.' : 'Session invalide',
      });
    }
  });

  router.post('/api/auth/logout', async (req, res) => {
    try {
      const decoded = await decodeRequestAuthClaims(req);
      if (decoded) await sessionRegistry.revokeCurrentSession(decoded);
    } catch {
      // Logout stays best effort: clear the browser even if the token is stale.
    }
    clearSessionCookies(req, res);
    return res.json({ ok: true, allSessions: false, message: 'Session courante déconnectée.' });
  });

  router.delete('/api/auth/sessions/:sid', async (req, res) => {
    try {
      const decoded = await decodeRequestAuthClaims(req);
      if (!decoded) return res.status(401).json({ ok: false, error: 'A11_JWT_Missing' });
      const result = await sessionRegistry.revokeSession(decoded, req.params.sid);
      if (!result?.ok) {
        return res.status(404).json({ ok: false, error: result?.error || 'session_not_found' });
      }
      const currentSid = String(decoded.sid || decoded.sessionId || '').trim();
      if (currentSid && currentSid === String(req.params.sid || '').trim()) clearSessionCookies(req, res);
      return res.json({ ok: true, sessionId: result.sessionId, revokedAt: result.revokedAt });
    } catch (error) {
      const code = error?.code === 'A11_SESSION_REVOKED' ? 'A11_SESSION_REVOKED' : 'A11_JWT_Invalid';
      if (code === 'A11_SESSION_REVOKED') clearSessionCookies(req, res);
      return res.status(401).json({ ok: false, error: code });
    }
  });

  router.post('/api/auth/logout-all', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const decoded = await decodeRequestAuthClaims(req);
      if (!decoded) return res.status(401).json({ ok: false, error: 'A11_JWT_Missing' });
      const result = await sessionRegistry.revokeAllForUser(decoded);
      clearSessionCookies(req, res);
      return res.json({
        ok: result?.ok !== false,
        allSessions: true,
        version: result?.version ?? null,
        message: 'Toutes les sessions du compte sont déconnectées.',
      });
    } catch (error) {
      clearSessionCookies(req, res);
      const decoded = extractRequestAuthToken(req) && typeof jwt.decode === 'function'
        ? jwt.decode(extractRequestAuthToken(req))
        : null;
      if (decoded) {
        const result = await sessionRegistry.revokeAllForUser(decoded).catch(() => null);
        if (result?.ok) {
          return res.json({
            ok: true,
            allSessions: true,
            version: result.version ?? null,
            message: 'Toutes les sessions du compte sont déconnectées.',
          });
        }
      }
      return res.status(401).json({ ok: false, error: 'A11_JWT_Invalid' });
    }
  });

  router.post('/api/auth/connectors/:provider/disconnect', async (req, res) => {
    const provider = String(req.params?.provider || '').trim().toLowerCase();
    if (!['google', 'microsoft'].includes(provider)) {
      return res.status(400).json({ ok: false, error: 'invalid_provider' });
    }
    try {
      const decoded = await decodeRequestAuthClaims(req);
      if (!decoded) return res.status(401).json({ ok: false, error: 'A11_JWT_Missing' });
      const legacyProvider = String(decoded.provider || '').trim().toLowerCase();
      const oauthConnectors = normalizeOAuthConnectors(decoded.oauthConnectors || decoded.oauth_connectors);
      const connectorWasLinked = Boolean(oauthConnectors[provider]) || legacyProvider === provider;
      if (!connectorWasLinked) {
        return res.json({ ok: true, provider, message: `Connecteur ${provider} non lié à cette session.`, alreadyUnlinked: true });
      }
      delete oauthConnectors[provider];
      const strippedUser = {
        ...decoded,
        oauthConnectors: Object.keys(oauthConnectors).length ? oauthConnectors : undefined,
        oauth_connectors: undefined,
      };
      if (legacyProvider === provider) {
        strippedUser.provider = undefined;
        strippedUser.oauthScopes = undefined;
        strippedUser.oauthScopeProfile = undefined;
        strippedUser.oauthBridge = undefined;
        strippedUser.bridgeOrigin = undefined;
      }
      if (oauthTokenVault && typeof oauthTokenVault.deleteSessionProviderTokens === 'function') {
        await oauthTokenVault.deleteSessionProviderTokens({
          sessionId: decoded.sid || decoded.sessionId || decoded.session_id,
          provider,
        }).catch((vaultError) => {
          console.warn('[AUTH] OAuth token vault delete failed:', vaultError?.message);
        });
      }
      const newToken = signUserToken({ jwt, jwtSecret, jwtExpiry, user: strippedUser, extra: {} });
      res.cookie(
        A11_SESSION_COOKIE,
        newToken,
        resolveCookieOptions(req, normalizePublicAppUrl, Number(process.env.A11_SESSION_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000))
      );
      return res.json({ ok: true, provider, message: `Connecteur ${provider} délié de la session.` });
    } catch (error) {
      const code = error?.code === 'A11_SESSION_REVOKED' ? 'A11_SESSION_REVOKED' : 'A11_JWT_Invalid';
      if (code === 'A11_SESSION_REVOKED') clearSessionCookies(req, res);
      return res.status(401).json({ ok: false, error: code });
    }
  });

  const forgotPasswordHandler = async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database unavailable' });
    const { email } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ error: 'Missing email' });
    if (!emailService?.isConfigured?.()) {
      console.warn('[AUTH] Forgot requested but email transport is not configured');
      return res.json({ ok: true, mailEnabled: false });
    }

    try {
      const { rows } = await db.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [normalizedEmail]);
      if (!rows.length) {
        console.warn('[AUTH] Forgot requested for unknown email');
        return res.json({ ok: true });
      }

      const user = rows[0];
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await db.query(
        'UPDATE users SET reset_token=$1, reset_token_expires_at=$2 WHERE id=$3',
        [resetToken, expiresAt, user.id]
      );

      const appUrl = emailService.getStatus().appUrl
        || normalizePublicAppUrl(process.env.APP_URL || process.env.FRONT_URL || 'https://a11.funesterie.me');
      const link = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
      const mailResult = await emailService.sendPasswordResetEmail({
        to: user.email,
        link,
      });
      if (!mailResult?.ok) throw new Error(mailResult?.reason || 'mail_send_failed');
      console.log('[AUTH] Reset email sent');
      return res.json({ ok: true, mailEnabled: true });
    } catch (e) {
      console.error('[AUTH] Forgot error:', e?.message);
      return res.status(500).json({ error: 'Server error' });
    }
  };

  router.post('/api/auth/forgot', express.json(), forgotPasswordHandler);
  router.post('/api/auth/forgot-password', express.json(), forgotPasswordHandler);

  const resetPasswordHandler = async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database unavailable' });
    const { token, password, newPassword } = req.body || {};
    const effectivePassword = String(password || newPassword || '');
    if (!token || !effectivePassword) return res.status(400).json({ error: 'Missing fields' });

    try {
      const hash = await bcrypt.hash(effectivePassword, 10);
      const byResetToken = await db.query(
        'SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires_at > NOW() LIMIT 1',
        [token]
      );

      if (byResetToken.rows.length) {
        const userId = byResetToken.rows[0].id;
        await db.query(
          'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires_at=NULL WHERE id=$2',
          [hash, userId]
        );
        console.log('[AUTH] Password reset via DB token');
        return res.json({ ok: true });
      }

      const decoded = jwt.verify(token, jwtSecret);
      await db.query(
        'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires_at=NULL WHERE id=$2',
        [hash, decoded.id]
      );
      console.log('[AUTH] Password reset via JWT token');
      return res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] Reset error:', e?.message);
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
  };

  router.post('/api/auth/reset', express.json(), resetPasswordHandler);
  router.post('/api/auth/reset-password', express.json(), resetPasswordHandler);

  router.post('/api/auth/agent-token', express.json(), (req, res) => {
    const nezAdminToken = String(process.env.NEZ_ADMIN_TOKEN || '').trim();
    if (!nezAdminToken) {
      return res.status(503).json({ ok: false, error: 'agent_token_not_configured' });
    }

    const providedToken = String(req.body?.admin_token || req.headers?.['x-nez-admin-token'] || '').trim();
    if (!providedToken) {
      return res.status(400).json({ ok: false, error: 'admin_token_required' });
    }

    let tokensMatch = false;
    try {
      const a = Buffer.from(nezAdminToken.padEnd(64), 'utf8').slice(0, 64);
      const b = Buffer.from(providedToken.padEnd(64), 'utf8').slice(0, 64);
      tokensMatch = nodeCrypto.timingSafeEqual(a, b) && nezAdminToken === providedToken;
    } catch { tokensMatch = false; }

    if (!tokensMatch) {
      console.warn('[AUTH] agent-token: invalid admin_token');
      return res.status(401).json({ ok: false, error: 'invalid_admin_token' });
    }

    const rawAgentId = String(req.body?.agent_id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64);
    if (!rawAgentId) {
      return res.status(400).json({ ok: false, error: 'agent_id_required' });
    }

    const rawExpiry = String(req.body?.expiry || '30d').trim();
    const allowedExpiry = /^\d+[smhd]$/.test(rawExpiry) ? rawExpiry : '30d';

    const claims = { id: rawAgentId, username: rawAgentId, role: 'agent', typ: 'agent_token', agent: true };
    const token = jwt.sign(claims, jwtSecret, { expiresIn: allowedExpiry });
    const decoded = jwt.decode(token);
    const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null;

    console.log(`[AUTH] agent-token issued: ${rawAgentId} exp=${allowedExpiry}`);
    return res.json({ ok: true, token, agent_id: rawAgentId, expires_at: expiresAt, expiry: allowedExpiry });
  });

  return router;
}

module.exports = createAuthRouter;

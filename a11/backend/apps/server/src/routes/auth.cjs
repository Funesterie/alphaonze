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
  parseCookieHeader,
} = require('../middleware/jwt-auth.cjs');

const A11_SESSION_COOKIE = 'a11_session';
const GOOGLE_OAUTH_STATE_COOKIE = 'a11_google_oauth_state';
const MICROSOFT_OAUTH_STATE_COOKIE = 'a11_microsoft_oauth_state';
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

function buildAuthClaims(user = {}, extra = {}) {
  const email = normalizeEmail(extra.email || user.email);
  const role = String(extra.role || user.role || '').trim();
  const claims = {
    id: extra.id ?? user.id,
    username: String(extra.username || user.username || '').trim(),
  };

  if (email) claims.email = email;
  if (role) claims.role = role;
  if (extra.localAuth || user.localAuth) claims.localAuth = true;
  if (extra.provider || user.provider || user.auth_provider) {
    claims.provider = String(extra.provider || user.provider || user.auth_provider);
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
    email: claims.email || normalizeEmail(user.email),
    role: claims.role || undefined,
    fullAccess: claims.fullAccess === true,
    provider: claims.provider || undefined,
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

function resolveFrontendUrl(req, normalizePublicAppUrl) {
  const raw = process.env.FRONTEND_URL
    || process.env.PUBLIC_FRONTEND_URL
    || process.env.APP_URL
    || process.env.FRONT_URL
    || req?.headers?.origin
    || 'https://a11.funesterie.pro';
  const normalized = typeof normalizePublicAppUrl === 'function'
    ? normalizePublicAppUrl(raw)
    : String(raw || '').trim().replace(/\/+$/, '');
  return normalized || 'https://a11.funesterie.pro';
}

function resolvePublicApiOrigin(req, normalizePublicAppUrl) {
  const raw = process.env.PUBLIC_API_URL
    || process.env.API_URL
    || process.env.BASE_URL
    || process.env.BACKEND_URL
    || resolveRequestOrigin(req)
    || 'https://a11.funesterie.pro';
  const normalized = typeof normalizePublicAppUrl === 'function'
    ? normalizePublicAppUrl(raw)
    : String(raw || '').trim().replace(/\/+$/, '');
  return normalized || resolveRequestOrigin(req) || 'https://a11.funesterie.pro';
}

function resolveRequestHostname(req) {
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  return host.replace(/:\d+$/, '').toLowerCase();
}

function resolveHostPinnedOAuthCallback(req, provider) {
  const hostname = resolveRequestHostname(req);
  if (!['k44.funesterie.me', 'kaen44.funesterie.me', 'kaen44.funesterie.pro'].includes(hostname)) return '';
  const origin = resolveRequestOrigin(req).replace(/\/+$/, '');
  if (!origin) return '';
  const publicOrigin = origin.replace(/^http:\/\//i, 'https://');
  return `${publicOrigin}/api/auth/${provider}/callback`;
}

function resolveGoogleCallbackUrl(req, normalizePublicAppUrl) {
  const hostPinned = resolveHostPinnedOAuthCallback(req, 'google');
  if (hostPinned) return hostPinned;
  const explicit = String(
    process.env.GOOGLE_CALLBACK_URL
    || process.env.A11_GOOGLE_CALLBACK_URL
    || process.env.GOOGLE_REDIRECT_URI
    || ''
  ).trim();
  if (explicit) return explicit;
  return `${resolvePublicApiOrigin(req, normalizePublicAppUrl).replace(/\/+$/, '')}/api/auth/google/callback`;
}

function getMicrosoftTenantId(env = process.env) {
  return String(env.MICROSOFT_TENANT_ID || env.AZURE_TENANT_ID || env.MS_TENANT_ID || 'organizations').trim() || 'organizations';
}

function resolveMicrosoftCallbackUrl(req, normalizePublicAppUrl) {
  const hostPinned = resolveHostPinnedOAuthCallback(req, 'microsoft');
  if (hostPinned) return hostPinned;
  const explicit = String(
    process.env.MICROSOFT_REDIRECT_URI
    || process.env.MICROSOFT_CALLBACK_URL
    || process.env.AZURE_REDIRECT_URI
    || ''
  ).trim();
  if (explicit) return explicit;
  return `${resolvePublicApiOrigin(req, normalizePublicAppUrl).replace(/\/+$/, '')}/api/auth/microsoft/callback`;
}

function getMicrosoftOAuthBaseUrl(env = process.env) {
  return `https://login.microsoftonline.com/${encodeURIComponent(getMicrosoftTenantId(env))}/oauth2/v2.0`;
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

  const domain = String(process.env.A11_SESSION_COOKIE_DOMAIN || '').trim();
  if (domain) options.domain = domain;
  return options;
}

function buildOAuthTraceMeta(req, normalizePublicAppUrl, extra = {}) {
  const cookieOptions = resolveCookieOptions(req, normalizePublicAppUrl);
  const cookieHeader = String(req?.headers?.cookie || '');
  return {
    method: req?.method,
    path: req?.originalUrl || req?.url,
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
  const base = String(frontendUrl || 'https://a11.funesterie.pro').replace(/\/+$/, '');
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
    'https://a11.funesterie.pro',
    'https://alphaonze.funesterie.pro',
    'https://funesterie.pro',
    'https://www.funesterie.pro',
    'https://cockpit.funesterie.pro',
    'https://k44.funesterie.me',
    'https://kaen44.funesterie.me',
    'https://funesterie.me',
    'https://www.funesterie.me',
    'https://vivy.funesterie.pro',
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
  const base = String(frontendUrl || 'https://a11.funesterie.pro').replace(/\/+$/, '');
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
    const frontendOrigin = new URL(String(frontendUrl || 'https://a11.funesterie.pro')).origin;
    needsFragmentToken = targetOrigin !== frontendOrigin;
  } catch {
    needsFragmentToken = false;
  }
  return res.redirect(needsFragmentToken ? appendOAuthTokenFragment(target, token, provider) : target);
}

function redirectOAuthErrorToReturnTo(res, frontendUrl, returnTo, errorCode) {
  const error = encodeURIComponent(errorCode || 'oauth_failed');
  const safeReturnTo = String(returnTo || '').trim();
  if (!safeReturnTo) return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${error}`));

  try {
    const target = new URL(resolveOAuthRedirectUrl(frontendUrl, safeReturnTo));
    if (/^\/k44(?:\/|$)/i.test(target.pathname)) {
      target.pathname = '/k44/login';
    } else if (/^\/kaen44(?:\/|$)/i.test(target.pathname)) {
      target.pathname = '/kaen44/login';
    } else if (/^\/cockpit(?:\/|$)/i.test(target.pathname)) {
      target.pathname = '/cockpit';
    } else {
      target.pathname = '/login';
    }
    target.search = `?error=${error}`;
    target.hash = '';
    return res.redirect(target.toString());
  } catch {
    return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${error}`));
  }
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
    if (code.includes('aadsts7000215') || code.includes('invalid client secret')) return 'microsoft_invalid_client';
    if (code.includes('access_denied')) return 'microsoft_access_denied';
    if (code.includes('invalid_grant')) return 'microsoft_invalid_grant';
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

async function exchangeMicrosoftCodeForTokens({ code, callbackUrl, clientId, clientSecret }) {
  const response = await fetch(`${getMicrosoftOAuthBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
      scope: 'openid profile email offline_access User.Read',
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.error || `microsoft_token_exchange_failed_${response.status}`);
  }
  return payload;
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
  defaultAdminPassword,
  emailService,
  crypto,
  normalizePublicAppUrl,
} = {}) {
  const router = express.Router();

  function issueSessionCookie(req, res, user, extra = {}) {
    const token = signUserToken({ jwt, jwtSecret, jwtExpiry, user, extra });
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

  function issueAuthResponse(req, res, user, extra = {}) {
    const token = issueSessionCookie(req, res, user, extra);
    return res.json({
      ok: true,
      success: true,
      token,
      expiresIn: jwtExpiry,
      user: buildPublicAuthUser(user, extra),
    });
  }

  function clearSessionCookies(req, res) {
    const options = resolveCookieOptions(req, normalizePublicAppUrl);
    res.clearCookie(A11_SESSION_COOKIE, options);
    res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, options);
    res.clearCookie(MICROSOFT_OAUTH_STATE_COOKIE, options);
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
        return issueAuthResponse(req, res, user, { localAuth: true });
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
      return issueAuthResponse(req, res, user);
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
              return issueAuthResponse(req, res, localUser, { localAuth: true });
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
        return issueAuthResponse(
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
      return issueAuthResponse(req, res, activatedUser);
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
        return issueAuthResponse(req, res, googleUser, { provider: 'google' });
      }

      const user = await findOrCreateGoogleUser({ ...profile, email });
      console.log('[AUTH] Google login:', email);
      return issueAuthResponse(req, res, user, { provider: 'google' });
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
    const clientId = String(process.env.GOOGLE_CLIENT_ID || process.env.A11_GOOGLE_CLIENT_ID || clientIds[0] || '').trim();
    const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || process.env.A11_GOOGLE_CLIENT_SECRET || '').trim();
    const callbackUrl = resolveGoogleCallbackUrl(req, normalizePublicAppUrl);
    return { clientIds: clientIds.length ? clientIds : [clientId].filter(Boolean), clientId, clientSecret, callbackUrl };
  }

  function getMicrosoftOAuthConfig(req) {
    const clientId = String(process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '').trim();
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

  function resolveGoogleOAuthScope(req) {
    const requestedProfile = String(
      req.query?.scopeProfile
      || req.query?.scope_profile
      || req.query?.intent
      || req.query?.scopeMode
      || ''
    ).trim().toLowerCase();
    const defaultProfile = String(
      process.env.GOOGLE_OAUTH_DEFAULT_PROFILE
      || process.env.A11_GOOGLE_OAUTH_DEFAULT_PROFILE
      || 'basic'
    ).trim().toLowerCase();
    const profile = requestedProfile || defaultProfile;

    if (['drive', 'files', 'google-drive'].includes(profile)) {
      return resolveOAuthScope(
        ['GOOGLE_OAUTH_DRIVE_SCOPES', 'A11_GOOGLE_OAUTH_DRIVE_SCOPES', 'GOOGLE_OAUTH_SCOPES', 'A11_GOOGLE_OAUTH_SCOPES'],
        'openid email profile https://www.googleapis.com/auth/drive.readonly'
      );
    }

    return resolveOAuthScope(
      ['GOOGLE_OAUTH_LOGIN_SCOPES', 'A11_GOOGLE_OAUTH_LOGIN_SCOPES'],
      'openid email profile'
    );
  }

  function redirectOAuthError(req, res, errorCode) {
    const frontendUrl = resolveFrontendUrl(req, normalizePublicAppUrl);
    const returnTo = String(req.query?.returnTo || '').trim();
    if (returnTo) return redirectOAuthErrorToReturnTo(res, frontendUrl, returnTo, errorCode);
    return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${encodeURIComponent(errorCode)}`));
  }

  router.get('/api/auth/google/start', (req, res) => {
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
    const state = jwt.sign(
      {
        typ: 'google_oauth_state',
        nonce,
        client,
        returnTo,
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
      scope: resolveGoogleOAuthScope(req),
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
      return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${encodeURIComponent(error)}`));
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
      return res.redirect(safeFrontendRedirect(frontendUrl, '/login?error=oauth_state_invalid'));
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
      return res.redirect(safeFrontendRedirect(frontendUrl, '/login?error=oauth_state_expired'));
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

      const sessionToken = issueSessionCookie(req, res, user, { provider: 'google' });
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
      return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${encodeURIComponent(publicError)}`));
    }
  });

  router.get('/api/auth/microsoft/start', (req, res) => {
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
    const state = jwt.sign(
      {
        typ: 'microsoft_oauth_state',
        nonce,
        client,
        returnTo,
      },
      jwtSecret,
      { expiresIn: '10m' }
    );

    const stateCookieOptions = resolveCookieOptions(req, normalizePublicAppUrl, 10 * 60 * 1000);
    res.cookie(MICROSOFT_OAUTH_STATE_COOKIE, state, stateCookieOptions);
    logOAuthTrace('microsoft', 'start_redirect', req, normalizePublicAppUrl, {
      callbackUrl,
      hasClientId: true,
      stateCookieSecure: stateCookieOptions.secure === true,
      stateCookieSameSite: stateCookieOptions.sameSite,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      response_mode: 'query',
      scope: resolveOAuthScope(
        ['MICROSOFT_OAUTH_SCOPES', 'AZURE_OAUTH_SCOPES', 'A11_MICROSOFT_OAUTH_SCOPES'],
        'openid profile email offline_access User.Read'
      ),
      prompt: String(req.query?.prompt || 'select_account').trim() || 'select_account',
      state,
    });

    return res.redirect(`${getMicrosoftOAuthBaseUrl()}/authorize?${params.toString()}`);
  });

  router.get('/api/auth/microsoft/callback', async (req, res) => {
    const frontendUrl = resolveFrontendUrl(req, normalizePublicAppUrl);
    const error = String(req.query?.error || '').trim();
    if (error) {
      clearSessionCookies(req, res);
      return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${encodeURIComponent(error)}`));
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
      return res.redirect(safeFrontendRedirect(frontendUrl, '/login?error=oauth_state_invalid'));
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
      return res.redirect(safeFrontendRedirect(frontendUrl, '/login?error=oauth_state_expired'));
    }

    const { clientId, clientSecret, callbackUrl } = getMicrosoftOAuthConfig(req);
    if (!clientId || !clientSecret || !callbackUrl) {
      logOAuthTrace('microsoft', 'callback_not_configured', req, normalizePublicAppUrl, {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasCallbackUrl: Boolean(callbackUrl),
      }, 'warn');
      clearSessionCookies(req, res);
      return res.redirect(safeFrontendRedirect(frontendUrl, '/login?error=microsoft_auth_not_configured'));
    }

    try {
      const tokens = await exchangeMicrosoftCodeForTokens({ code, callbackUrl, clientId, clientSecret });
      const profile = await fetchMicrosoftUserInfo(tokens.access_token);
      const email = normalizeEmail(profile?.mail || profile?.userPrincipalName || profile?.email);
      if (!email) {
        clearSessionCookies(req, res);
        return res.redirect(safeFrontendRedirect(frontendUrl, '/login?error=microsoft_email_missing'));
      }

      const user = db
        ? await findOrCreateMicrosoftUser(profile)
        : {
            id: `microsoft-${stableHash(profile?.id || email, 16)}`,
            username: normalizeUsernameCandidate(profile?.displayName || email.split('@')[0], 'microsoft-user'),
            email,
            provider: 'microsoft',
          };

      issueSessionCookie(req, res, user, { provider: 'microsoft' });
      res.clearCookie(MICROSOFT_OAUTH_STATE_COOKIE, resolveCookieOptions(req, normalizePublicAppUrl));
      console.log('[AUTH] Microsoft OAuth login:', email);
      return res.redirect(safeFrontendRedirect(frontendUrl, statePayload?.returnTo || '/auth/success'));
    } catch (callbackError) {
      clearSessionCookies(req, res);
      const publicError = resolvePublicOAuthError('microsoft', callbackError);
      logOAuthTrace('microsoft', 'callback_failed', req, normalizePublicAppUrl, {
        callbackUrl,
        error: String(callbackError?.message || callbackError || 'oauth_failed'),
        publicError,
      }, 'warn');
      return res.redirect(safeFrontendRedirect(frontendUrl, `/login?error=${encodeURIComponent(publicError)}`));
    }
  });

  router.get('/api/auth/me', (req, res) => {
    const token = extractRequestAuthToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, authenticated: false, error: 'A11_JWT_Missing' });
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      return res.json({
        ok: true,
        authenticated: true,
        user: buildPublicAuthUser(decoded, decoded),
      });
    } catch (error) {
      return res.status(401).json({
        ok: false,
        authenticated: false,
        error: 'A11_JWT_Invalid',
        message: error?.message || 'Session invalide',
      });
    }
  });

  router.post('/api/auth/logout', (req, res) => {
    clearSessionCookies(req, res);
    return res.json({ ok: true, message: 'Deconnecte avec succes' });
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
        || normalizePublicAppUrl(process.env.APP_URL || process.env.FRONT_URL || 'https://alphaonze.funesterie.pro');
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

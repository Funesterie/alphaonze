'use strict';

const CP_SESSION_COOKIE = 'funesterie_cp_session';
const DEFAULT_ADMINS = [
  'cellaurojeffrey@gmail.com',
  'funesterie38@gmail.com',
];

function splitList(value) {
  return String(value || '')
    .split(/[,\s;]+/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getAdminEmails(env = process.env) {
  return new Set([
    ...DEFAULT_ADMINS,
    ...splitList(env.FUNESTERIE_COCKPIT_ADMINS),
    ...splitList(env.CP_FUNESTERIE_ADMINS),
  ]);
}

function getPublicUrl(env = process.env) {
  return String(env.FUNESTERIE_COCKPIT_URL || env.URL || 'https://cp.funesterie.me')
    .trim()
    .replace(/\/+$/, '') || 'https://cp.funesterie.me';
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_error) {
      cookies[key] = value;
    }
  }
  return cookies;
}

function pickHeader(headers = {}, name) {
  const wanted = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) return String(value || '');
  }
  return '';
}

function bearerTokenFromAuth(value) {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function redirect(location, statusCode = 302, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      Location: location,
      ...extraHeaders,
    },
    body: '',
  };
}

function html(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
      ...extraHeaders,
    },
    body,
  };
}

function buildGoogleLoginUrl(returnPath = '/auth/success') {
  const startUrl = new URL(process.env.A11_GOOGLE_START_URL || 'https://a11.funesterie.me/api/auth/google/start');
  const returnTo = new URL(returnPath, getPublicUrl()).toString();
  startUrl.searchParams.set('returnTo', returnTo);
  startUrl.searchParams.set('client', 'funesterie-cockpit');
  startUrl.searchParams.set('scopeProfile', 'basic');
  startUrl.searchParams.set('prompt', 'select_account');
  return startUrl.toString();
}

function isAllowedAdmin(user, env = process.env) {
  const email = String(user?.email || '').trim().toLowerCase();
  return Boolean(email && getAdminEmails(env).has(email));
}

async function fetchAuthMe(options = {}) {
  const authMeUrl = process.env.A11_AUTH_ME_URL || 'https://a11.funesterie.me/api/auth/me';
  const response = await fetch(authMeUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function verifyToken(token) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return { ok: false, statusCode: 401, reason: 'missing_token' };
  try {
    const { response, payload } = await fetchAuthMe({
      headers: { Authorization: `Bearer ${cleanToken}` },
    });
    if (!response.ok || payload?.authenticated !== true) {
      return { ok: false, statusCode: 401, reason: 'invalid_token' };
    }
    if (!isAllowedAdmin(payload.user)) {
      return { ok: false, statusCode: 403, reason: 'admin_required', user: payload.user || null };
    }
    return { ok: true, user: payload.user || null, token: cleanToken };
  } catch (_error) {
    return { ok: false, statusCode: 503, reason: 'auth_unavailable' };
  }
}

async function verifyCookieHeader(cookieHeader) {
  const cleanCookieHeader = String(cookieHeader || '').trim();
  if (!cleanCookieHeader) return { ok: false, statusCode: 401, reason: 'missing_cookie' };
  try {
    const { response, payload } = await fetchAuthMe({
      headers: { Cookie: cleanCookieHeader },
    });
    if (!response.ok || payload?.authenticated !== true) {
      return { ok: false, statusCode: 401, reason: 'invalid_cookie' };
    }
    if (!isAllowedAdmin(payload.user)) {
      return { ok: false, statusCode: 403, reason: 'admin_required', user: payload.user || null };
    }
    return { ok: true, user: payload.user || null };
  } catch (_error) {
    return { ok: false, statusCode: 503, reason: 'auth_unavailable' };
  }
}

async function verifyAdminFromEvent(event = {}) {
  const headers = event.headers || {};
  const cookieHeader = pickHeader(headers, 'cookie');
  const cookies = parseCookies(cookieHeader);
  const cpToken = cookies[CP_SESSION_COOKIE];
  if (cpToken) {
    const result = await verifyToken(cpToken);
    if (result.ok) return result;
    if (result.statusCode === 403) return result;
  }

  const bearer = bearerTokenFromAuth(pickHeader(headers, 'authorization'));
  if (bearer) {
    const result = await verifyToken(bearer);
    if (result.ok || result.statusCode === 403) return result;
  }

  if (cookieHeader) {
    const result = await verifyCookieHeader(cookieHeader);
    if (result.ok || result.statusCode === 403) return result;
  }

  return { ok: false, statusCode: 401, reason: 'auth_required' };
}

function sessionCookie(token) {
  return [
    `${CP_SESSION_COOKIE}=${encodeURIComponent(String(token || ''))}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=604800',
  ].join('; ');
}

function clearSessionCookie() {
  return [
    `${CP_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
}

function authBridgeHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion Funesterie</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050812;color:#f7f2ff;font-family:Inter,system-ui,sans-serif}
    main{width:min(520px,calc(100% - 32px));border:1px solid rgba(77,220,255,.35);border-radius:8px;padding:28px;background:rgba(13,18,32,.92)}
    p{color:#c8bed5;line-height:1.6}
    a{color:#49e4ff}
  </style>
</head>
<body>
  <main>
    <h1>Connexion...</h1>
    <p>Validation de l'acces admin Funesterie.</p>
    <p id="state">Lecture du jeton Google.</p>
  </main>
  <script>
    (async () => {
      const state = document.getElementById('state');
      const params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      const token = params.get('a11_token');
      if (!token) {
        state.textContent = 'Aucun jeton recu. Redirection vers Google.';
        location.replace('/');
        return;
      }
      try {
        const response = await fetch('/.netlify/functions/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          state.textContent = response.status === 403
            ? 'Compte Google non autorise pour ce cockpit.'
            : 'Session refusee. Reconnecte-toi.';
          return;
        }
        location.replace('/');
      } catch (_error) {
        state.textContent = 'Validation indisponible. Recharge la page dans un instant.';
      }
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  CP_SESSION_COOKIE,
  DEFAULT_ADMINS,
  authBridgeHtml,
  buildGoogleLoginUrl,
  clearSessionCookie,
  html,
  isAllowedAdmin,
  json,
  redirect,
  sessionCookie,
  verifyAdminFromEvent,
  verifyToken,
};

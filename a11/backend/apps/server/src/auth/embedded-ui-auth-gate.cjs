const { extractRequestAuthToken } = require('../middleware/jwt-auth.cjs');

function getHeader(req, name) {
  if (!req || typeof req.get !== 'function') {
    return String(req?.headers?.[String(name || '').toLowerCase()] || '').trim();
  }
  return String(req.get(name) || '').trim();
}

function getRequestHost(req) {
  return String(getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || '')
    .split(',')[0]
    .trim();
}

function isLocalRequestHost(host) {
  const hostname = String(host || '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function getRequestProtocol(req) {
  const forwardedProto = String(getHeader(req, 'x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .replace(/:$/, '');
  if (forwardedProto) return forwardedProto;

  const host = getRequestHost(req);
  if (host && !isLocalRequestHost(host)) return 'https';

  return String(req?.protocol || 'https')
    .split(',')[0]
    .trim()
    .replace(/:$/, '') || 'https';
}

function getRequestPathname(req) {
  return String(req?.path || req?.originalUrl || req?.url || '/')
    .split('?')[0]
    .trim() || '/';
}

function buildRequestReturnTo(req) {
  const host = getRequestHost(req) || 'funesterie.me';
  const proto = getRequestProtocol(req);
  const originalUrl = String(req?.originalUrl || req?.url || '/').trim() || '/';
  return `${proto}://${host}${originalUrl.startsWith('/') ? originalUrl : `/${originalUrl}`}`;
}

function buildCentralLoginRedirectUrl(req, centralLoginUrl = 'https://funesterie.me/login') {
  const target = new URL(String(centralLoginUrl || 'https://funesterie.me/login'));
  target.searchParams.set('returnTo', buildRequestReturnTo(req));
  return target.toString();
}

function isLikelyEmbeddedHtmlRequest(req) {
  const method = String(req?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  const pathname = getRequestPathname(req);
  if (/^\/api(?:\/|$)/i.test(pathname)) return false;
  if (/^\/(?:assets|icons|files|legacy|tts)(?:\/|$)/i.test(pathname)) return false;
  if (/^\/(?:favicon\.ico|manifest\.webmanifest|sw\.js|anonymous_code_placeholder\.js)$/i.test(pathname)) return false;

  const extensionMatch = pathname.match(/\/[^/?#]+\.(\w+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
  if (extension && extension !== 'html') return false;

  const accept = getHeader(req, 'accept').toLowerCase();
  if (accept.includes('text/html')) return true;
  return !extension || extension === 'html';
}

function createEmbeddedUiAuthGate({
  jwt,
  jwtSecret,
  authSessionRegistry,
  resolveSurface,
  protectedSurfaces = ['vivy'],
  centralLoginUrl = 'https://funesterie.me/login',
  logger = console,
} = {}) {
  if (!jwt || typeof jwt.verify !== 'function') {
    throw new Error('createEmbeddedUiAuthGate requires jwt.verify');
  }
  const resolvedSecret = String(jwtSecret || '').trim();
  if (!resolvedSecret) {
    throw new Error('createEmbeddedUiAuthGate requires jwtSecret');
  }
  if (typeof resolveSurface !== 'function') {
    throw new Error('createEmbeddedUiAuthGate requires resolveSurface');
  }

  const protectedSet = new Set(
    (Array.isArray(protectedSurfaces) ? protectedSurfaces : ['vivy'])
      .map((surface) => String(surface || '').trim().toLowerCase())
      .filter(Boolean)
  );

  return async function embeddedUiAuthGate(req, res, next) {
    const surface = String(resolveSurface(req) || '').trim().toLowerCase();
    if (!protectedSet.has(surface) || !isLikelyEmbeddedHtmlRequest(req)) {
      return next();
    }

    try {
      const token = extractRequestAuthToken(req);
      if (token) {
        const decoded = jwt.verify(token, resolvedSecret);
        if (authSessionRegistry && typeof authSessionRegistry.assertTokenCurrent === 'function') {
          await authSessionRegistry.assertTokenCurrent(decoded);
        }
        req.user = req.user || decoded;
        return next();
      }
    } catch (error) {
      logger?.warn?.('[A11] Embedded UI auth gate rejected session:', error?.code || error?.message || error);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie, Authorization');
    return res.redirect(302, buildCentralLoginRedirectUrl(req, centralLoginUrl));
  };
}

module.exports = {
  buildCentralLoginRedirectUrl,
  buildRequestReturnTo,
  createEmbeddedUiAuthGate,
  isLikelyEmbeddedHtmlRequest,
};

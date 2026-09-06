const crypto = require('node:crypto');

function getNezServiceTokens(env = process.env) {
  return [
    env.A11_NEZ_TOKEN,
    env.NEZ_TOKENS,
    env.NEZ_ALLOWED_TOKEN,
  ]
    .map((token) => String(token || '').trim())
    .filter(Boolean);
}

function timingSafeEqualStrings(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Identite service pour les appels server-to-server et l'outil MCP a11_chat.
// L'outil a11_chat envoie un X-NEZ-TOKEN (secret statique) a /api/chat, mais
// verifyJWT n'acceptait qu'un JWT HMAC: l'appel tombait en 401 A11_JWT_Missing
// alors que le moteur tournait. On accepte ici le token NEZ configure -- jamais
// le defaut faible 'nez:a11-client-funesterie-pro' -- exactement comme la route
// MCP publique, et on synthetise un req.user service marque isService/admin.
function resolveNezServiceIdentity(req, env = process.env) {
  const candidates = [
    String(req?.headers?.['x-nez-token'] || '').trim(),
    String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim(),
  ].filter(Boolean);
  if (!candidates.length) return null;
  const allowed = getNezServiceTokens(env);
  if (!allowed.length) return null;
  for (const token of candidates) {
    if (allowed.some((expected) => timingSafeEqualStrings(token, expected))) {
      return {
        token,
        mode: 'nez-service',
        user: {
          id: 'a11-mcp-service',
          username: 'a11-mcp',
          email: 'a11-mcp-service@funesterie.local',
          role: 'admin',
          permissions: ['admin'],
          isAdmin: true,
          fullAccess: true,
          isService: true,
          serviceMode: 'nez',
        },
      };
    }
  }
  return null;
}

function looksLikeJwtToken(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || '').trim());
}

function parseCookieHeader(headerValue) {
  const cookies = {};
  for (const part of String(headerValue || '').split(';')) {
    const [rawName, ...rawValueParts] = part.split('=');
    const name = String(rawName || '').trim();
    if (!name) continue;
    const rawValue = rawValueParts.join('=').trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function extractRequestAuthTokenCandidates(req) {
  const headerToken = String(req?.headers?.['x-nez-token'] || '').trim();
  const bearerToken = String(req?.headers?.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const cookieToken = String(
    req?.cookies?.a11_session
    || parseCookieHeader(req?.headers?.cookie).a11_session
    || ''
  ).trim();

  const ordered = [bearerToken, headerToken, cookieToken]
    .map((token) => String(token || '').trim())
    .filter((token, index, tokens) => token && looksLikeJwtToken(token) && tokens.indexOf(token) === index);

  if (!ordered.length) {
    const fallback = [bearerToken, headerToken, cookieToken]
      .map((token) => String(token || '').trim())
      .find(Boolean);
    if (fallback) ordered.push(fallback);
  }

  return {
    bearerToken,
    headerToken,
    cookieToken,
    ordered,
  };
}

function extractRequestAuthToken(req) {
  return extractRequestAuthTokenCandidates(req).ordered[0] || '';
}

function isLoopbackRequest(req) {
  const values = [
    req?.hostname,
    req?.ip,
    req?.socket?.remoteAddress,
    req?.connection?.remoteAddress,
  ].map((value) => String(value || '').trim().toLowerCase().replace(/^::ffff:/, ''));

  return values.some((value) => value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]');
}

function getRequestPathname(req) {
  return String(req?.originalUrl || req?.url || req?.path || '/')
    .split('?')[0]
    .trim() || '/';
}

function isPublicAuthRoute(req) {
  const method = String(req?.method || 'GET').trim().toUpperCase();
  const pathname = getRequestPathname(req).replace(/\/+$/, '') || '/';

  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') return false;

  if (method === 'GET' || method === 'HEAD') {
    return /^\/api\/auth\/(?:google|microsoft)\/(?:start|callback)$/i.test(pathname);
  }

  return /^\/api\/auth\/(?:login|register|reset|reset-password|forgot-password)$/i.test(pathname);
}

function shouldBypassJwtForLocalDev(req) {
  const securityMode = String(process.env.NEZ_SECURITY_MODE || '').trim().toLowerCase();
  const explicitBypass = ['true', '1', 'yes', 'on'].includes(
    String(process.env.A11_DISABLE_JWT_AUTH || process.env.A11_LOCAL_AUTH_BYPASS || '').trim().toLowerCase()
  );
  const browserBypass = ['true', '1', 'yes', 'on'].includes(
    String(req?.headers?.['x-a11-local-dev-bypass'] || '').trim().toLowerCase()
  );

  if (process.env.NODE_ENV === 'production') return false;
  if (explicitBypass) return true;
  if (browserBypass && isLoopbackRequest(req)) return true;
  return isLoopbackRequest(req) && securityMode === 'off';
}

function createVerifyJWT({ jwt, jwtSecret, logger = console, logSuccess = false, authSessionRegistry } = {}) {
  if (!jwt || typeof jwt.verify !== 'function') {
    throw new Error('createVerifyJWT requires jwt.verify');
  }

  const resolvedSecret = String(jwtSecret || '').trim();
  if (!resolvedSecret) {
    throw new Error('createVerifyJWT requires jwtSecret');
  }

  return async function verifyJWT(req, res, next) {
    if (isPublicAuthRoute(req)) {
      return next();
    }

    if (shouldBypassJwtForLocalDev(req)) {
      req.user = {
        id: 'local-dev',
        username: 'local-dev',
        email: 'local-dev@funesterie.local',
        role: 'admin',
        permissions: ['admin'],
        isAdmin: true,
        localBypass: true,
      };
      return next();
    }

    const tokenCandidates = extractRequestAuthTokenCandidates(req).ordered;

    if (!tokenCandidates.length) {
      logger?.warn?.('[JWT] No token provided');
      return res.status(401).json({
        error: 'A11_JWT_Missing',
        message: 'JWT token manquant',
      });
    }

    let lastError = null;
    for (const token of tokenCandidates) {
      try {
        const decoded = jwt.verify(token, resolvedSecret);
        if (authSessionRegistry && typeof authSessionRegistry.assertTokenCurrent === 'function') {
          await authSessionRegistry.assertTokenCurrent(decoded);
        }
        req.user = decoded;
        req.authToken = token;
        if (logSuccess) {
          logger?.log?.('[JWT] ✅ Token vérifié');
        }
        return next();
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError?.code === 'A11_SESSION_REVOKED') {
      logger?.warn?.('[JWT] Session revoked');
      return res.status(401).json({
        error: 'A11_SESSION_REVOKED',
        message: 'Session révoquée. Reconnecte-toi.',
      });
    }
    // Aucun JWT valide: dernier recours, l'identite service NEZ/MCP (outil
    // a11_chat et appels server-to-server). On ne l'accepte que si un token
    // NEZ est configure -- jamais le defaut faible -- pour ne pas laisser le
    // chat derriere une porte fermee (401 A11_JWT_Missing).
    const serviceIdentity = resolveNezServiceIdentity(req);
    if (serviceIdentity) {
      req.user = serviceIdentity.user;
      req.authToken = serviceIdentity.token;
      req.serviceAuth = { mode: serviceIdentity.mode };
      if (logSuccess) {
        logger?.log?.(`[JWT] ✅ Identité service ${serviceIdentity.mode} acceptée`);
      }
      return next();
    }
    logger?.warn?.('[JWT] Verification failed:', lastError?.message);
    return res.status(401).json({
      error: 'A11_JWT_Invalid',
      message: `JWT invalide ou expiré: ${lastError?.message}`,
    });
  };
}

module.exports = {
  looksLikeJwtToken,
  extractRequestAuthToken,
  extractRequestAuthTokenCandidates,
  parseCookieHeader,
  isPublicAuthRoute,
  shouldBypassJwtForLocalDev,
  createVerifyJWT,
  getNezServiceTokens,
  resolveNezServiceIdentity,
};

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

function extractRequestAuthToken(req) {
  const headerToken = String(req?.headers?.['x-nez-token'] || '').trim();
  const bearerToken = String(req?.headers?.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const cookieToken = String(
    req?.cookies?.a11_session
    || parseCookieHeader(req?.headers?.cookie).a11_session
    || ''
  ).trim();

  if (looksLikeJwtToken(bearerToken)) return bearerToken;
  if (looksLikeJwtToken(headerToken)) return headerToken;
  if (looksLikeJwtToken(cookieToken)) return cookieToken;
  return bearerToken || headerToken || cookieToken;
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

    const token = extractRequestAuthToken(req);

    if (!token) {
      logger?.warn?.('[JWT] No token provided');
      return res.status(401).json({
        error: 'A11_JWT_Missing',
        message: 'JWT token manquant',
      });
    }

    try {
      const decoded = jwt.verify(token, resolvedSecret);
      if (authSessionRegistry && typeof authSessionRegistry.assertTokenCurrent === 'function') {
        await authSessionRegistry.assertTokenCurrent(decoded);
      }
      req.user = decoded;
      if (logSuccess) {
        logger?.log?.('[JWT] ✅ Token vérifié');
      }
      return next();
    } catch (err) {
      if (err?.code === 'A11_SESSION_REVOKED') {
        logger?.warn?.('[JWT] Session revoked');
        return res.status(401).json({
          error: 'A11_SESSION_REVOKED',
          message: 'Session révoquée. Reconnecte-toi.',
        });
      }
      logger?.warn?.('[JWT] Verification failed:', err?.message);
      return res.status(401).json({
        error: 'A11_JWT_Invalid',
        message: `JWT invalide ou expiré: ${err?.message}`,
      });
    }
  };
}

module.exports = {
  looksLikeJwtToken,
  extractRequestAuthToken,
  parseCookieHeader,
  shouldBypassJwtForLocalDev,
  createVerifyJWT,
};

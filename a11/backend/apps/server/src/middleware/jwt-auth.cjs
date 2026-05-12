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

function createVerifyJWT({ jwt, jwtSecret, logger = console, logSuccess = false } = {}) {
  if (!jwt || typeof jwt.verify !== 'function') {
    throw new Error('createVerifyJWT requires jwt.verify');
  }

  const resolvedSecret = String(jwtSecret || '').trim();
  if (!resolvedSecret) {
    throw new Error('createVerifyJWT requires jwtSecret');
  }

  return function verifyJWT(req, res, next) {
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
      req.user = decoded;
      if (logSuccess) {
        logger?.log?.('[JWT] ✅ Token vérifié');
      }
      return next();
    } catch (err) {
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
  createVerifyJWT,
};

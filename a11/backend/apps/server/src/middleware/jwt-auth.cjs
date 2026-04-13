function looksLikeJwtToken(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || '').trim());
}

function extractRequestAuthToken(req) {
  const headerToken = String(req?.headers?.['x-nez-token'] || '').trim();
  const bearerToken = String(req?.headers?.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (looksLikeJwtToken(bearerToken)) return bearerToken;
  if (looksLikeJwtToken(headerToken)) return headerToken;
  return bearerToken || headerToken;
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
  createVerifyJWT,
};

function normalizeTokenValues(values = []) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, allValues) => allValues.indexOf(value) === index);
}

function collectConfiguredAdminTokens(env = process.env) {
  return normalizeTokenValues([
    env?.NEZ_ADMIN_TOKEN,
    env?.DRAGON_API_TOKEN,
    env?.QFLUSH_TOKEN,
    env?.NPZ_ADMIN_TOKEN,
  ]);
}

function extractAdminTokensFromRequest(req) {
  const bearerMatch = String(req?.headers?.authorization || '').match(/^Bearer\s+(.+)$/i);

  return normalizeTokenValues([
    req?.headers?.['x-nez-admin-token'],
    req?.headers?.['x-admin-token'],
    req?.headers?.['x-qflush-token'],
    req?.headers?.['x-dragon-token'],
    bearerMatch?.[1],
  ]);
}

function isVerifiedAdminUser(req, { defaultAdminUsername = '' } = {}) {
  const role = String(req?.user?.role || '').trim().toLowerCase();
  const userId = String(req?.user?.id || '').trim().toLowerCase();
  const username = String(req?.user?.username || '').trim().toLowerCase();
  const normalizedDefaultAdmin = String(defaultAdminUsername || '').trim().toLowerCase();
  const permissions = Array.isArray(req?.user?.permissions)
    ? req.user.permissions.map((value) => String(value || '').trim().toLowerCase())
    : [];

  return req?.user?.isAdmin === true
    || role === 'admin'
    || permissions.includes('admin')
    || userId === 'admin'
    || username === 'admin'
    || (normalizedDefaultAdmin && username === normalizedDefaultAdmin);
}

function createIsAdminRequest({ env = process.env, defaultAdminUsername = '' } = {}) {
  return function isAdminRequest(req) {
    const configuredAdminTokens = collectConfiguredAdminTokens(env);
    const requestTokens = extractAdminTokensFromRequest(req);

    if (configuredAdminTokens.length && requestTokens.some((value) => configuredAdminTokens.includes(value))) {
      return true;
    }

    return isVerifiedAdminUser(req, { defaultAdminUsername });
  };
}

function createRequireAdminAccess({
  isAdminRequest,
  verifyJWT,
  buildForbiddenBody,
} = {}) {
  if (typeof isAdminRequest !== 'function') {
    throw new Error('createRequireAdminAccess requires isAdminRequest');
  }

  function sendForbidden(req, res) {
    const payload = typeof buildForbiddenBody === 'function'
      ? buildForbiddenBody(req, res)
      : {
          ok: false,
          error: 'admin_required',
          message: 'Accès réservé à l’admin.',
        };

    return res.status(403).json(payload);
  }

  return function requireAdminAccess(req, res, next) {
    if (isAdminRequest(req)) {
      return next();
    }

    if (typeof verifyJWT !== 'function') {
      return sendForbidden(req, res);
    }

    return verifyJWT(req, res, () => {
      if (isAdminRequest(req)) {
        return next();
      }
      return sendForbidden(req, res);
    });
  };
}

module.exports = {
  collectConfiguredAdminTokens,
  extractAdminTokensFromRequest,
  isVerifiedAdminUser,
  createIsAdminRequest,
  createRequireAdminAccess,
};

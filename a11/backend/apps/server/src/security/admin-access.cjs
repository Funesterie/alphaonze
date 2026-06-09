function normalizeTokenValues(values = []) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, allValues) => allValues.indexOf(value) === index);
}

const DEFAULT_COCKPIT_ADMIN_EMAILS = Object.freeze([
  'cellaurojeffrey@gmail.com',
  'funesterie38@gmail.com',
  'cellaurojeffrey@funesterie.onmicrosoft.com',
]);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function splitEmailList(value) {
  return String(value || '')
    .split(/[,\s;]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

function collectConfiguredAdminTokens(env = process.env) {
  return normalizeTokenValues([
    env?.NEZ_ADMIN_TOKEN,
    env?.DRAGON_API_TOKEN,
    env?.QFLUSH_TOKEN,
    env?.NPZ_ADMIN_TOKEN,
  ]);
}

function collectConfiguredAdminEmails(env = process.env, defaultAdminEmail = '') {
  return Array.from(new Set([
    ...DEFAULT_COCKPIT_ADMIN_EMAILS,
    normalizeEmail(defaultAdminEmail),
    normalizeEmail(env?.DEFAULT_ADMIN_EMAIL),
    ...splitEmailList(env?.A11_ADMIN_EMAILS),
    ...splitEmailList(env?.FUNESTERIE_ADMIN_EMAILS),
    ...splitEmailList(env?.FUNESTERIE_COCKPIT_ADMINS),
    ...splitEmailList(env?.CP_FUNESTERIE_ADMINS),
    ...splitEmailList(env?.A11_MCP_COCKPIT_ADMINS),
  ].filter(Boolean)));
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

function isVerifiedAdminUser(req, { env = process.env, defaultAdminUsername = '', defaultAdminEmail = '' } = {}) {
  const role = String(req?.user?.role || '').trim().toLowerCase();
  const userId = String(req?.user?.id || '').trim().toLowerCase();
  const username = String(req?.user?.username || '').trim().toLowerCase();
  const email = normalizeEmail(req?.user?.email);
  const normalizedDefaultAdmin = String(defaultAdminUsername || '').trim().toLowerCase();
  const adminEmails = collectConfiguredAdminEmails(env, defaultAdminEmail);
  const permissions = Array.isArray(req?.user?.permissions)
    ? req.user.permissions.map((value) => String(value || '').trim().toLowerCase())
    : [];

  return Boolean(req?.user?.isAdmin === true
    || role === 'admin'
    || permissions.includes('admin')
    || userId === 'admin'
    || username === 'admin'
    || (normalizedDefaultAdmin ? username === normalizedDefaultAdmin : false)
    || (email ? adminEmails.includes(email) : false));
}

function createIsAdminRequest({ env = process.env, defaultAdminUsername = '', defaultAdminEmail = '' } = {}) {
  return function isAdminRequest(req) {
    const configuredAdminTokens = collectConfiguredAdminTokens(env);
    const requestTokens = extractAdminTokensFromRequest(req);

    if (configuredAdminTokens.length && requestTokens.some((value) => configuredAdminTokens.includes(value))) {
      return true;
    }

    return isVerifiedAdminUser(req, { env, defaultAdminUsername, defaultAdminEmail });
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
  DEFAULT_COCKPIT_ADMIN_EMAILS,
  collectConfiguredAdminTokens,
  collectConfiguredAdminEmails,
  extractAdminTokensFromRequest,
  isVerifiedAdminUser,
  createIsAdminRequest,
  createRequireAdminAccess,
};

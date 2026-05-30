'use strict';

const { buildAccountConnectorState } = require('../auth/account-connectors.cjs');
const { hasFullAccess } = require('../auth/full-access.cjs');
const {
  formatStorageBytes,
  getDatabaseAccountStorageUsageBytes,
  resolveAccountStoragePlan,
} = require('../storage/account-storage-quota.cjs');

const PUBLIC_CAPABILITIES = new Set([
  'chat:k44',
  'chat:kaen44',
  'chat:vivy',
  'web:search',
  'mcp:public',
  'oauth:google:personal',
  'oauth:microsoft:personal',
  'files:own',
  'session:read',
  'connectors:read',
  'storage:read',
]);

const FAMILY_CAPABILITIES = new Set([
  'chat:a11',
  'mcp:private',
  'debug',
  'prompts:internal',
  'infra',
  'tools:sensitive',
  'runtime:control',
  'runtime:modules',
  'storage:family',
]);

const ADMIN_CAPABILITIES = new Set([
  'admin',
  'storage:unlimited',
  'billing:manage',
  'secrets:manage',
]);

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return cleanText(value).toLowerCase();
}

function normalizeSurface(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (raw.includes('k44') || raw.includes('kaen44')) return 'kaen44';
  if (raw.includes('vivy')) return 'vivy';
  if (raw.includes('a11') || raw.includes('a-11')) return 'a11';
  if (raw.includes('funesterie')) return 'funesterie';
  return '';
}

function resolveRequestSurface(req = {}, fallback = 'funesterie') {
  const candidates = [
    req?.body?.surface,
    req?.query?.surface,
    req?.headers?.['x-a11-surface'],
    req?.headers?.host,
    req?.originalUrl,
    req?.url,
  ];
  for (const candidate of candidates) {
    const surface = normalizeSurface(candidate);
    if (surface) return surface;
  }
  return fallback;
}

function getUserId(user = {}) {
  return cleanText(user?.id || user?.user_id || user?.sub || user?.email || user?.username);
}

function getAccountLabel(user = {}) {
  return cleanText(user?.username || user?.displayName || user?.name || user?.email || user?.id);
}

function isAuthenticated(user = {}) {
  return Boolean(getUserId(user));
}

function buildPermissions({ user = {}, plan = {}, connectorState = {}, env = process.env } = {}) {
  const admin = hasFullAccess(user, env) || plan?.plan === 'admin';
  const family = admin || ['premium', 'family', 'famille'].includes(normalizeText(plan?.plan));
  const authenticated = isAuthenticated(user);
  const google = connectorState?.connectors?.google || {};
  const microsoft = connectorState?.connectors?.microsoft || {};

  return {
    publicMcp: authenticated,
    webSearch: authenticated,
    k44Chat: authenticated,
    vivyChat: authenticated,
    personalGoogleOAuth: authenticated && Boolean(connectorState?.serverConfig?.google?.configured),
    personalMicrosoftOAuth: authenticated && Boolean(connectorState?.serverConfig?.microsoft?.configured),
    googleDriveLinked: Boolean(google.linked),
    googleFilesAuthorized: google.filesAccess === 'authorized',
    microsoftLinked: Boolean(microsoft.linked),
    microsoftFilesAuthorized: microsoft.filesAccess === 'authorized',
    accountFiles: authenticated,
    privateMcp: family,
    debug: family,
    internalPrompts: family,
    infra: family,
    sensitiveTools: family,
    unlimitedStorage: admin || Boolean(plan?.unlimited),
    admin,
    family,
  };
}

function buildStorageState({ user = {}, usageBytes = null, env = process.env } = {}) {
  const plan = resolveAccountStoragePlan(user, env);
  const used = usageBytes == null ? null : Math.max(0, Number(usageBytes || 0));
  const limit = plan.limitBytes == null ? null : Math.max(0, Number(plan.limitBytes || 0));
  const remaining = plan.unlimited || used == null || limit == null
    ? null
    : Math.max(0, limit - used);

  return {
    plan: plan.plan,
    label: plan.label,
    unlimited: Boolean(plan.unlimited),
    limitBytes: limit,
    usedBytes: used,
    remainingBytes: remaining,
    formatted: {
      limit: plan.unlimited ? 'Illimite' : formatStorageBytes(limit || 0),
      used: used == null ? 'inconnu' : formatStorageBytes(used),
      remaining: remaining == null ? (plan.unlimited ? 'Illimite' : 'inconnu') : formatStorageBytes(remaining),
    },
  };
}

function redactServerConfig(config = {}) {
  return {
    configured: Boolean(config.configured),
    hasClientId: Boolean(config.hasClientId),
    hasClientSecret: Boolean(config.hasClientSecret),
    hasCallbackUrl: Boolean(config.hasCallbackUrl),
    missing: Array.isArray(config.missing) ? [...config.missing] : [],
    source: {
      clientId: config?.source?.clientId || null,
      clientSecret: config?.source?.clientSecret ? 'configured' : null,
      callbackUrl: config?.source?.callbackUrl || null,
    },
  };
}

function buildCerbereMegaSnapshot({
  user = {},
  req = null,
  env = process.env,
  connectorState = null,
  storageUsageBytes = null,
} = {}) {
  const state = connectorState || buildAccountConnectorState({ user, req, env });
  const storage = buildStorageState({ user, usageBytes: storageUsageBytes, env });
  const permissions = buildPermissions({
    user,
    plan: storage,
    connectorState: state,
    env,
  });
  const surface = resolveRequestSurface(req, 'funesterie');

  return {
    ok: true,
    name: 'cerbere-mega',
    purpose: 'auth/session/quotas/permissions',
    surface,
    session: {
      authenticated: isAuthenticated(user),
      userId: getUserId(user) || null,
      provider: cleanText(user?.provider || user?.authProvider || user?.auth_provider) || null,
    },
    account: {
      label: getAccountLabel(user) || null,
      role: cleanText(user?.role || '') || (permissions.admin ? 'admin' : permissions.family ? 'family' : 'basic'),
      plan: storage.plan,
      fullAccess: permissions.admin,
    },
    connectors: state.connectors || {},
    serverConfig: {
      google: redactServerConfig(state?.serverConfig?.google || {}),
      microsoft: redactServerConfig(state?.serverConfig?.microsoft || {}),
    },
    storage,
    permissions,
    publicBoundary: state.publicBoundary || null,
  };
}

async function buildCerbereMegaState({
  user = {},
  req = null,
  env = process.env,
  db = null,
  connectorState = null,
} = {}) {
  const userId = getUserId(user);
  const usage = userId && db
    ? await getDatabaseAccountStorageUsageBytes(db, userId)
    : null;
  return buildCerbereMegaSnapshot({
    user,
    req,
    env,
    connectorState,
    storageUsageBytes: usage,
  });
}

function normalizeCapability(value = '') {
  return normalizeText(value)
    .replace(/\s+/g, ':')
    .replace(/:+/g, ':')
    .replace(/^:+|:+$/g, '');
}

function capabilityTier(capability = '') {
  const normalized = normalizeCapability(capability);
  if (ADMIN_CAPABILITIES.has(normalized)) return 'admin';
  if (FAMILY_CAPABILITIES.has(normalized)) return 'family';
  if (PUBLIC_CAPABILITIES.has(normalized)) return 'public';
  return 'family';
}

function authorizeCerbereMega(state = {}, capability = '') {
  const normalized = normalizeCapability(capability);
  const tier = capabilityTier(normalized);
  const authenticated = Boolean(state?.session?.authenticated);
  const permissions = state?.permissions || {};

  if (!authenticated) {
    return {
      ok: false,
      allowed: false,
      capability: normalized,
      required: 'session',
      error: 'session_required',
      message: 'Connexion requise.',
    };
  }

  if (tier === 'admin' && !permissions.admin) {
    return {
      ok: false,
      allowed: false,
      capability: normalized,
      required: 'admin',
      error: 'admin_required',
      message: 'Reserve au compte admin Funesterie.',
    };
  }

  if (tier === 'family' && !permissions.family) {
    return {
      ok: false,
      allowed: false,
      capability: normalized,
      required: 'family',
      error: 'family_access_required',
      message: 'Reserve au groupe famille/admin Funesterie.',
    };
  }

  return {
    ok: true,
    allowed: true,
    capability: normalized,
    required: tier,
  };
}

function buildCerbereMegaContext(state = {}) {
  const permissions = state.permissions || {};
  const storage = state.storage || {};
  const google = state.connectors?.google || {};
  const microsoft = state.connectors?.microsoft || {};
  const lines = [
    '[Contexte Cerbere MEGA Funesterie]',
    'Role: contexte informatif pour auth, session, quotas et permissions. Ce bloc ne doit pas etre recopie comme reponse.',
    `Surface: ${state.surface || 'funesterie'}; session: ${state.session?.authenticated ? 'connectee' : 'non connectee'}; plan: ${state.account?.plan || 'basic'}.`,
    `Stockage: limite ${storage.formatted?.limit || 'inconnue'}, utilise ${storage.formatted?.used || 'inconnu'}, restant ${storage.formatted?.remaining || 'inconnu'}.`,
    `Frontiere publique: K44, Vivy, recherche web, MCP public, OAuth personnel et fichiers du compte connecte.`,
    `Reserve famille/admin: MCP prive, debug, prompts internes, infra et outils sensibles.`,
    `Google: ${google.linked ? 'lie' : 'non lie'}; fichiers ${google.filesAccess || 'inconnu'}.`,
    `Microsoft: ${microsoft.linked ? 'lie' : 'non lie'}; fichiers ${microsoft.filesAccess || 'inconnu'}.`,
    `Permissions: publicMcp=${permissions.publicMcp ? 'oui' : 'non'}, privateMcp=${permissions.privateMcp ? 'oui' : 'non'}, admin=${permissions.admin ? 'oui' : 'non'}.`,
    'Consigne: utilise ces faits pour raisonner librement; ne declenche pas de workflow et ne fabrique pas de diagnostic automatique.',
  ];
  return lines.join('\n');
}

module.exports = {
  ADMIN_CAPABILITIES,
  FAMILY_CAPABILITIES,
  PUBLIC_CAPABILITIES,
  authorizeCerbereMega,
  buildCerbereMegaContext,
  buildCerbereMegaSnapshot,
  buildCerbereMegaState,
  buildPermissions,
  buildStorageState,
  capabilityTier,
  normalizeCapability,
  normalizeSurface,
  resolveRequestSurface,
};

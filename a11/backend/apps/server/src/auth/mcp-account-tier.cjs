'use strict';

const {
  hasFullAccess,
  isFullAccessEmail,
  normalizeEmail,
} = require('./full-access.cjs');

const TIERS = Object.freeze({
  BASIC: 'basic',
  PREMIUM: 'premium',
  FOUNDER: 'founder',
  ADMIN_FAMILY: 'admin_family',
});

const TIER_RANK = Object.freeze({
  [TIERS.BASIC]: 10,
  [TIERS.PREMIUM]: 20,
  [TIERS.FOUNDER]: 30,
  [TIERS.ADMIN_FAMILY]: 40,
});

const TIER_LABELS = Object.freeze({
  [TIERS.BASIC]: 'Basic',
  [TIERS.PREMIUM]: 'Premium',
  [TIERS.FOUNDER]: 'Fondateur',
  [TIERS.ADMIN_FAMILY]: 'Admin famille',
});

const TIER_ORDER = Object.freeze([
  TIERS.BASIC,
  TIERS.PREMIUM,
  TIERS.FOUNDER,
  TIERS.ADMIN_FAMILY,
]);

const TIER_PRICING = Object.freeze({
  [TIERS.BASIC]: Object.freeze({ monthlyEur: 0, publicLabel: 'Basic' }),
  [TIERS.PREMIUM]: Object.freeze({ monthlyEur: 8.99, publicLabel: 'Premium' }),
  [TIERS.FOUNDER]: Object.freeze({ monthlyEur: 29.99, publicLabel: 'Fondateur' }),
  [TIERS.ADMIN_FAMILY]: Object.freeze({ monthlyEur: null, publicLabel: 'Admin famille' }),
});

const TIER_FEATURES = Object.freeze({
  [TIERS.BASIC]: Object.freeze([
    'MCP public en lecture',
    'connexion Google/Microsoft de session',
    'stockage du compte',
  ]),
  [TIERS.PREMIUM]: Object.freeze([
    'MCP public avance',
    'statut cockpit',
    'RomStation en lecture',
    'acces Discord communaute',
  ]),
  [TIERS.FOUNDER]: Object.freeze([
    'MCP prive dans la session',
    'RomStation controlee dans la session',
    'connecteurs GitHub/YouTube/Discord',
    'installation locale A11 guidee',
  ]),
  [TIERS.ADMIN_FAMILY]: Object.freeze([
    'outils famille/admin',
    'operations infra',
    'support cross-compte reserve',
  ]),
});

const DEFAULT_MCP_ADMIN_FAMILY_EMAILS = Object.freeze([
  'cellaurojeffrey@gmail.com',
  'funesterie38@gmail.com',
  'cellaurojeffrey@funesterie.onmicrosoft.com',
]);

const DEFAULT_PERMISSION_MATRIX = Object.freeze({
  [TIERS.BASIC]: Object.freeze({
    publicHealth: true,
    publicEndpoints: true,
    publicProxyRead: true,
    publicProxyCall: false,
    cockpitStatus: false,
    privateMcpStatus: false,
    privateMcpProxy: false,
    privateMcpTools: false,
    privateMcpCall: false,
    romstationState: false,
    romstationControl: false,
    sessionConnectors: true,
    googleConnect: true,
    microsoftConnect: true,
    githubConnect: false,
    youtubeConnect: false,
    discord321Access: false,
    localRuntimeInstall: false,
    localRuntimeControl: false,
    destructiveActions: false,
    crossAccountAccess: false,
  }),
  [TIERS.PREMIUM]: Object.freeze({
    publicHealth: true,
    publicEndpoints: true,
    publicProxyRead: true,
    publicProxyCall: true,
    cockpitStatus: true,
    privateMcpStatus: true,
    privateMcpProxy: false,
    privateMcpTools: false,
    privateMcpCall: false,
    romstationState: true,
    romstationControl: false,
    sessionConnectors: true,
    googleConnect: true,
    microsoftConnect: true,
    githubConnect: false,
    youtubeConnect: false,
    discord321Access: true,
    localRuntimeInstall: false,
    localRuntimeControl: false,
    destructiveActions: false,
    crossAccountAccess: false,
  }),
  [TIERS.FOUNDER]: Object.freeze({
    publicHealth: true,
    publicEndpoints: true,
    publicProxyRead: true,
    publicProxyCall: true,
    cockpitStatus: true,
    privateMcpStatus: true,
    privateMcpProxy: true,
    privateMcpTools: true,
    privateMcpCall: true,
    romstationState: true,
    romstationControl: true,
    sessionConnectors: true,
    googleConnect: true,
    microsoftConnect: true,
    githubConnect: true,
    youtubeConnect: true,
    discord321Access: true,
    localRuntimeInstall: true,
    localRuntimeControl: true,
    destructiveActions: false,
    crossAccountAccess: false,
  }),
  [TIERS.ADMIN_FAMILY]: Object.freeze({
    publicHealth: true,
    publicEndpoints: true,
    publicProxyRead: true,
    publicProxyCall: true,
    cockpitStatus: true,
    privateMcpStatus: true,
    privateMcpProxy: true,
    privateMcpTools: true,
    privateMcpCall: true,
    romstationState: true,
    romstationControl: true,
    sessionConnectors: true,
    googleConnect: true,
    microsoftConnect: true,
    githubConnect: true,
    youtubeConnect: true,
    discord321Access: true,
    localRuntimeInstall: true,
    localRuntimeControl: true,
    destructiveActions: true,
    crossAccountAccess: true,
  }),
});

function splitList(value) {
  return String(value || '')
    .split(/[,\s;]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

function hasEmail(email, emails) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (!emails) return false;
  if (emails instanceof Set) return emails.has(normalized);
  if (Array.isArray(emails)) return emails.map(normalizeEmail).includes(normalized);
  return false;
}

function envEmails(env, keys) {
  return new Set(keys.flatMap((key) => splitList(env?.[key])));
}

function isExpired(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date < now;
}

function normalizeTier(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (raw === TIERS.ADMIN_FAMILY || raw === 'admin' || raw === 'family_admin' || raw === 'famille_admin') {
    return TIERS.ADMIN_FAMILY;
  }
  if (
    raw === TIERS.FOUNDER
    || raw === 'fondateur'
    || raw === 'founder_30'
    || raw === 'fondateur_30'
    || raw === 'founder_2999'
    || raw === 'fondateur_2999'
    || raw === 'a11_founder'
    || raw === 'a11_fondateur'
    || raw === 'founding'
    || raw === 'god_like'
    || raw === 'godlike'
  ) {
    return TIERS.FOUNDER;
  }
  if (
    raw === TIERS.PREMIUM
    || raw === 'premium_5'
    || raw === 'premium_899'
    || raw === 'a11_premium'
    || raw === 'plus'
    || raw === 'studio'
    || raw === 'a11_studio'
    || raw === 'pro'
  ) {
    return TIERS.PREMIUM;
  }
  return TIERS.BASIC;
}

function mergeUserClaims(user = {}, dbUser = {}) {
  return {
    ...user,
    ...Object.fromEntries(Object.entries(dbUser || {}).filter(([, value]) => value !== undefined && value !== null)),
    email: normalizeEmail(dbUser?.email || user?.email),
    role: dbUser?.role || user?.role,
  };
}

function isSubscriptionActive(user = {}, now = new Date()) {
  const active = user?.subscription_active === true
    || user?.subscriptionActive === true
    || String(user?.subscription_active || user?.subscriptionActive || '').toLowerCase() === 'true';
  if (!active) return false;
  return !isExpired(user?.subscription_end_date || user?.subscriptionEndDate, now);
}

function buildMcpPermissionProfile(tier) {
  const normalizedTier = normalizeTier(tier);
  return {
    tier: normalizedTier,
    label: TIER_LABELS[normalizedTier],
    rank: TIER_RANK[normalizedTier],
    pricing: { ...TIER_PRICING[normalizedTier] },
    features: [...TIER_FEATURES[normalizedTier]],
    permissions: { ...DEFAULT_PERMISSION_MATRIX[normalizedTier] },
  };
}

function resolveMcpAccountProfileSync(user = {}, {
  env = process.env,
  dbUser = null,
  adminEmails = null,
  founderEmails = null,
  premiumEmails = null,
  now = new Date(),
} = {}) {
  const merged = mergeUserClaims(user, dbUser || {});
  const email = normalizeEmail(merged.email);
  const claimedTier = normalizeTier(
    merged.accountTier
    || merged.account_tier
    || merged.tier
    || merged.plan
    || merged.subscriptionPlan
    || merged.subscription_plan
  );
  const configuredAdminEmails = new Set([
    ...DEFAULT_MCP_ADMIN_FAMILY_EMAILS.map(normalizeEmail),
    ...splitList(env?.A11_MCP_ADMIN_FAMILY_EMAILS),
    ...splitList(env?.FUNESTERIE_FAMILY_ADMIN_EMAILS),
    ...splitList(env?.FUNESTERIE_COCKPIT_ADMINS),
    ...splitList(env?.CP_FUNESTERIE_ADMINS),
    ...splitList(env?.A11_MCP_COCKPIT_ADMINS),
  ]);
  const configuredFounderEmails = founderEmails || envEmails(env, [
    'A11_MCP_FOUNDER_EMAILS',
    'A11_FOUNDER_EMAILS',
    'FUNESTERIE_FOUNDER_EMAILS',
  ]);
  const configuredPremiumEmails = premiumEmails || envEmails(env, [
    'A11_MCP_PREMIUM_EMAILS',
    'A11_PREMIUM_EMAILS',
    'FUNESTERIE_PREMIUM_EMAILS',
  ]);

  let tier = TIERS.BASIC;
  let reason = 'default_basic';

  if (
    hasFullAccess(merged, env)
    || isFullAccessEmail(email, env)
    || hasEmail(email, adminEmails)
    || configuredAdminEmails.has(email)
  ) {
    tier = TIERS.ADMIN_FAMILY;
    reason = 'admin_family';
  } else if (
    hasEmail(email, configuredFounderEmails)
    || claimedTier === TIERS.FOUNDER
  ) {
    tier = TIERS.FOUNDER;
    reason = claimedTier === TIERS.FOUNDER ? 'founder_claim' : 'founder_email';
  } else if (
    hasEmail(email, configuredPremiumEmails)
    || isSubscriptionActive(merged, now)
    || claimedTier === TIERS.PREMIUM
  ) {
    tier = TIERS.PREMIUM;
    reason = isSubscriptionActive(merged, now) ? 'subscription' : 'premium_claim';
  }

  const profile = buildMcpPermissionProfile(tier);
  return {
    ...profile,
    ok: true,
    reason,
    authenticated: !!(merged.id || email),
    user: {
      id: merged.id || '',
      username: merged.username || (email ? email.split('@')[0] : ''),
      email,
      provider: merged.provider || '',
      role: merged.role || '',
    },
  };
}

async function queryDbUser(db, sql, params) {
  const result = await db.query(sql, params);
  return result?.rows?.[0] || null;
}

async function findDbUser(db, user = {}) {
  if (!db || typeof db.query !== 'function') return null;
  const id = user?.id;
  const email = normalizeEmail(user?.email);
  const extendedSelect = 'id, email, role, subscription_active, subscription_end_date, account_tier, subscription_plan, plan';
  const fallbackSelect = 'id, email, role, subscription_active, subscription_end_date';
  if (id) {
    try {
      const row = await queryDbUser(db, `SELECT ${extendedSelect} FROM users WHERE id = $1 LIMIT 1`, [id]);
      if (row) return row;
    } catch {
      try {
        const row = await queryDbUser(db, `SELECT ${fallbackSelect} FROM users WHERE id = $1 LIMIT 1`, [id]);
        if (row) return row;
      } catch {
        return null;
      }
    }
  }
  if (email) {
    try {
      const row = await queryDbUser(db, `SELECT ${extendedSelect} FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
      if (row) return row;
    } catch {
      try {
        const row = await queryDbUser(db, `SELECT ${fallbackSelect} FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
        if (row) return row;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function resolveMcpAccountProfile(reqOrUser, options = {}) {
  const user = reqOrUser?.user && typeof reqOrUser.user === 'object' ? reqOrUser.user : reqOrUser;
  const dbUser = options.dbUser || await findDbUser(options.db, user || {});
  return resolveMcpAccountProfileSync(user || {}, { ...options, dbUser });
}

function canUseMcpPermission(profile, permission) {
  return !!profile?.permissions?.[permission];
}

function minimumTierForPermission(permission) {
  for (const tier of TIER_ORDER) {
    if (DEFAULT_PERMISSION_MATRIX[tier]?.[permission]) return tier;
  }
  return TIERS.ADMIN_FAMILY;
}

function buildMcpPermissionDenied(permission, profile, message) {
  const minimumTier = minimumTierForPermission(permission);
  return {
    ok: false,
    error: 'mcp_permission_required',
    code: 'MCP_PERMISSION_REQUIRED',
    message: message || `Permission MCP requise: ${permission}`,
    account: profile || buildMcpPermissionProfile(TIERS.BASIC),
    required: {
      permission,
      minimumTier,
      minimumLabel: TIER_LABELS[minimumTier],
    },
  };
}

module.exports = {
  TIERS,
  TIER_FEATURES,
  TIER_LABELS,
  TIER_ORDER,
  TIER_PRICING,
  DEFAULT_PERMISSION_MATRIX,
  DEFAULT_MCP_ADMIN_FAMILY_EMAILS,
  buildMcpPermissionDenied,
  buildMcpPermissionProfile,
  canUseMcpPermission,
  minimumTierForPermission,
  normalizeTier,
  resolveMcpAccountProfile,
  resolveMcpAccountProfileSync,
};

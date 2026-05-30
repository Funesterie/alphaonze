'use strict';

const { hasFullAccess } = require('../auth/full-access.cjs');

const ONE_GIB = 1024 * 1024 * 1024;
const TEN_GIB = 10 * ONE_GIB;

function normalizeString(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeList(...values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(/[,\s]+/g);
    return [];
  }).map(normalizeString).filter(Boolean);
}

function isAdminStorageUser(user = {}) {
  const role = normalizeString(user.role || user.userRole || user.accountRole);
  if (['admin', 'owner', 'superadmin', 'root'].includes(role)) return true;
  if (user.isAdmin === true || user.admin === true || user.storageAdmin === true) return true;
  const permissions = normalizeList(user.permissions, user.scopes, user.accessPacks, user.access_packs);
  return permissions.some((permission) => (
    permission === 'admin'
    || permission === 'storage:admin'
    || permission === 'funesterie:admin'
  ));
}

function hasPremiumStorage(user = {}, env = process.env) {
  if (user.subscription_active === true || user.subscriptionActive === true) return true;
  if (user.fullAccess === true || user.full_access === true) return true;
  if (hasFullAccess(user, env)) return true;

  const plan = normalizeString(user.plan || user.tier || user.subscriptionPlan || user.subscription_plan);
  if (/(family|famille|premium|plus|pro|team|crew)/.test(plan)) return true;

  const packs = normalizeList(user.accessPacks, user.access_packs, user.entitlements);
  return packs.some((pack) => (
    pack === 'family'
    || pack === 'premium'
    || pack === 'plus'
    || pack === 'pro'
    || pack === 'team'
    || pack === 'a11'
    || pack === 'k44'
    || pack === 'vivy'
    || pack === 'a11+vivy'
  ));
}

function resolveAccountStoragePlan(user = {}, env = process.env) {
  if (isAdminStorageUser(user)) {
    return {
      plan: 'admin',
      label: 'Admin',
      unlimited: true,
      limitBytes: null,
    };
  }
  if (hasPremiumStorage(user, env)) {
    return {
      plan: 'premium',
      label: 'Famille/Premium',
      unlimited: false,
      limitBytes: TEN_GIB,
    };
  }
  return {
    plan: 'basic',
    label: 'Compte',
    unlimited: false,
    limitBytes: ONE_GIB,
  };
}

function formatStorageBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value >= ONE_GIB) return `${(value / ONE_GIB).toFixed(2)} Go`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
  if (value >= 1024) return `${Math.round(value / 1024)} Ko`;
  return `${Math.round(value)} o`;
}

function createStorageQuotaError(details = {}) {
  const error = new Error('account_storage_quota_exceeded');
  error.code = 'account_storage_quota_exceeded';
  error.status = 413;
  Object.assign(error, details);
  return error;
}

function assertAccountStorageQuota({ user, currentBytes = 0, incomingBytes = 0, subject = 'storage', env = process.env } = {}) {
  const plan = resolveAccountStoragePlan(user, env);
  const current = Math.max(0, Number(currentBytes || 0));
  const incoming = Math.max(0, Number(incomingBytes || 0));
  if (plan.unlimited) {
    return {
      ...plan,
      currentBytes: current,
      incomingBytes: incoming,
      remainingBytes: null,
      subject,
      allowed: true,
    };
  }

  const limit = Number(plan.limitBytes || 0);
  const remaining = Math.max(0, limit - current);
  if (current + incoming > limit) {
    throw createStorageQuotaError({
      plan: plan.plan,
      planLabel: plan.label,
      limitBytes: limit,
      currentBytes: current,
      incomingBytes: incoming,
      remainingBytes: remaining,
      subject,
    });
  }

  return {
    ...plan,
    currentBytes: current,
    incomingBytes: incoming,
    remainingBytes: Math.max(0, limit - current - incoming),
    subject,
    allowed: true,
  };
}

async function getDatabaseAccountStorageUsageBytes(db, userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || !db || typeof db.query !== 'function') return 0;

  try {
    const result = await db.query(`
      WITH account_objects AS (
        SELECT COALESCE(NULLIF(storage_key, ''), 'files:' || id::text) AS object_key,
               COALESCE(size_bytes, 0)::bigint AS size_bytes
          FROM files
         WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > NOW())
        UNION ALL
        SELECT COALESCE(NULLIF(storage_key, ''), 'user_files:' || id::text) AS object_key,
               COALESCE(size_bytes, 0)::bigint AS size_bytes
          FROM user_files
         WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > NOW())
        UNION ALL
        SELECT COALESCE(NULLIF(storage_key, ''), 'conversation_resources:' || id::text) AS object_key,
               COALESCE(size_bytes, 0)::bigint AS size_bytes
          FROM conversation_resources
         WHERE user_id=$1 AND (expires_at IS NULL OR expires_at > NOW())
      )
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes
        FROM (
          SELECT object_key, MAX(size_bytes) AS size_bytes
            FROM account_objects
           GROUP BY object_key
        ) deduplicated
    `, [normalizedUserId]);
    return Math.max(0, Number(result?.rows?.[0]?.total_bytes || 0));
  } catch (error) {
    console.warn('[STORAGE_QUOTA] usage lookup failed:', error?.message || error);
    return 0;
  }
}

function buildStorageQuotaPayload(error) {
  return {
    ok: false,
    error: 'account_storage_quota_exceeded',
    message: `Limite de stockage atteinte pour ce compte (${formatStorageBytes(error.limitBytes)}).`,
    plan: error.plan || 'basic',
    planLabel: error.planLabel || '',
    limitBytes: error.limitBytes ?? null,
    currentBytes: error.currentBytes ?? null,
    incomingBytes: error.incomingBytes ?? null,
    remainingBytes: error.remainingBytes ?? null,
    formatted: {
      limit: error.limitBytes == null ? 'Illimite' : formatStorageBytes(error.limitBytes),
      current: formatStorageBytes(error.currentBytes || 0),
      incoming: formatStorageBytes(error.incomingBytes || 0),
      remaining: formatStorageBytes(error.remainingBytes || 0),
    },
  };
}

module.exports = {
  ONE_GIB,
  TEN_GIB,
  assertAccountStorageQuota,
  buildStorageQuotaPayload,
  createStorageQuotaError,
  formatStorageBytes,
  getDatabaseAccountStorageUsageBytes,
  hasPremiumStorage,
  isAdminStorageUser,
  resolveAccountStoragePlan,
};

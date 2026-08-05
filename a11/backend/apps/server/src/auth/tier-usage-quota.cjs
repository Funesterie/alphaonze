'use strict';

/**
 * Quotas d'usage par tier (Codex, 2026-08-01, sur delegation Djeff).
 *
 * MODELE: on vend une technique, pas une machine a sons. Les users mettent LEURS
 * propres cles (Suno, Mureka, OpenAI, Grok, Claude, image) dans leur compte. Le
 * cout de generation est donc a l'UTILISATEUR, pas a Funesterie.
 *
 * Ce que Funesterie paie reellement (a caper contre le deficit):
 *  - le LLM par DEFAULT (gpt-oss:120b via Ollama Cloud) pour les users qui n'apportent
 *    pas leur propre cle LLM (basic/premium typiquement ; le fondateur apporte ses
 *    providers IA -> ~0 cout Funesterie sur le LLM),
 *  - le serveur Hetzner (cout fixe),
 *  - le stockage (Neo4j + fichiers, deja cappe: 1 Gio basic / 10 Gio premium).
 *
 * Les quotas ci-dessous capent les ressources FUNESTERIE-PAYEES (default LLM).
 * Les ressources a cle user (Suno/Mureka/OpenAI/image) = cout de l'user -> simples
 * limites de fair-use anti-abus, pas des quotas de deficit.
 *
 * Hypothese de cout (a tuner des qu'on a le vrai prix Ollama Cloud gpt-oss:120b):
 *  ~1-2 EUR / 1M tokens ; un echange chat ~2k tokens -> ~0,002 EUR/chat.
 *  Premium 20/jour -> ~1800/trim -> ~3,6 EUR/trim a 1 EUR/1M (marge ~5,4 EUR/trim pour le serveur).
 *  Founder 60/jour -> ~5400/trim -> ~10,8 EUR/trim a 1 EUR/1M (marge ~19 EUR/trim).
 *  Des qu'on a le vrai cout Ollama Cloud, reajuster defaultLlmMessagesPerDay.
 */

const { TIERS } = require('./mcp-account-tier.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;

// Quotas decides (Funesterie-paid default LLM + fair-use sur cles user + storage ref).
const TIER_USAGE_QUOTA = Object.freeze({
  [TIERS.BASIC]: Object.freeze({
    defaultLlmMessagesPerDay: 5,        // basic = surtout lecture seule (MCP public)
    sunoFairUsePerDay: 0,               // pas de Suno (permission false en basic)
    imageFairUsePerDay: 0,
    v11PanJobsPerAccount: 3,
    storageBytes: 1 * 1024 * 1024 * 1024,
  }),
  [TIERS.PREMIUM]: Object.freeze({
    defaultLlmMessagesPerDay: 20,       // LLM par defaut (Ollama Cloud) cappe
    sunoFairUsePerDay: 30,              // cle user: anti-abus seulement
    imageFairUsePerDay: 50,
    v11PanJobsPerAccount: 50,
    storageBytes: 10 * 1024 * 1024 * 1024,
  }),
  [TIERS.FOUNDER]: Object.freeze({
    defaultLlmMessagesPerDay: 60,       // si le fondateur n'apporte pas de cle LLM ; sinon ~0 (sa cle)
    sunoFairUsePerDay: 100,
    imageFairUsePerDay: 200,
    v11PanJobsPerAccount: 300,
    storageBytes: 10 * 1024 * 1024 * 1024,
  }),
  [TIERS.ADMIN_FAMILY]: Object.freeze({
    defaultLlmMessagesPerDay: Infinity,
    sunoFairUsePerDay: Infinity,
    imageFairUsePerDay: Infinity,
    v11PanJobsPerAccount: Infinity,
    storageBytes: Infinity,
  }),
});

// Compteur journalier en memoire (key: tier|userId|YYYY-MM-DD). Reset automatique par
// la date dans la cle. Suffisant pour un anti-deficit v1 ; pour le billing precis,
// passer en Postgres (table usage_counters).
const _daily = new Map();
const _account = new Map();
const _initializedQuotaDbs = new WeakSet();
const _DAY_KEY = () => new Date().toISOString().slice(0, 10);
function _counterKey(scope, userId) {
  return scope + '|' + String(userId || 'anon') + '|' + _DAY_KEY();
}
function _readCounter(scope, userId) {
  return Number(_daily.get(_counterKey(scope, userId)) || 0);
}
function _bumpCounter(scope, userId) {
  const k = _counterKey(scope, userId);
  _daily.set(k, Number(_daily.get(k) || 0) + 1);
}

function getTierUsageQuota(tier) {
  return TIER_USAGE_QUOTA[tier] || TIER_USAGE_QUOTA[TIERS.BASIC];
}

/**
 * Verifie le quota du LLM PAR DEFAULT (Funesterie-payé) pour un user/tier.
 * NE S'APPLIQUE PAS si l'user apporte sa propre cle LLM (fondateur: custom AI providers)
 * — dans ce cas l'appelant doit skipper ce check (cout = l'user).
 * @returns {{ ok: boolean, used: number, limit: number, remaining: number, scope: string }}
 */
function checkDefaultLlmQuota(user, tier) {
  const q = getTierUsageQuota(tier);
  const limit = Number(q.defaultLlmMessagesPerDay);
  const used = _readCounter('llm', user?.id || user?.email);
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - used) : Infinity;
  return { ok: used < limit, used, limit, remaining, scope: 'default_llm' };
}

/**
 * A appeler APRES un echat reussi sur le LLM par defaut, pour compter l'usage.
 * Ne pas appeler si l'user a utilise sa propre cle LLM.
 */
function recordDefaultLlmUsage(user, tier) {
  _bumpCounter('llm', user?.id || user?.email);
}

/** Fair-use sur les ressources a cle user (Suno/Mureka/image) : anti-abus. */
function checkFairUseQuota(scope, user, tier) {
  const q = getTierUsageQuota(tier);
  const limit = scope === 'suno' ? Number(q.sunoFairUsePerDay)
    : scope === 'image' ? Number(q.imageFairUsePerDay)
    : Infinity;
  const used = _readCounter(scope, user?.id || user?.email);
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - used) : Infinity;
  return { ok: used < limit, used, limit, remaining, scope };
}
function recordFairUse(scope, user) {
  _bumpCounter(scope, user?.id || user?.email);
}

function accountIdentity(user = {}) {
  return String(user?.id || user?.email || user?.username || '').trim().toLowerCase();
}

async function ensureAccountQuotaTable(db) {
  if (!db || typeof db.query !== 'function' || _initializedQuotaDbs.has(db)) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS account_feature_usage (
      user_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, feature)
    )
  `);
  _initializedQuotaDbs.add(db);
}

/**
 * Reserve atomiquement une utilisation V11Pan pour toute la vie du compte.
 * En production le compteur est durable dans Postgres. Le fallback mémoire ne sert
 * qu'aux tests et au développement local sans DATABASE_URL.
 */
async function reserveV11PanUsage({ db = null, user = {}, tier = TIERS.BASIC } = {}) {
  const limit = Number(getTierUsageQuota(tier).v11PanJobsPerAccount);
  const userId = accountIdentity(user);
  if (!userId) {
    return { ok: false, used: 0, limit, remaining: limit, scope: 'v11pan', period: 'account', error: 'account_identity_missing' };
  }
  if (!Number.isFinite(limit)) {
    return { ok: true, used: 0, limit: Infinity, remaining: Infinity, scope: 'v11pan', period: 'account' };
  }

  if (!db || typeof db.query !== 'function') {
    const key = `v11pan|${userId}`;
    const used = Number(_account.get(key) || 0);
    if (used >= limit) {
      return { ok: false, used, limit, remaining: 0, scope: 'v11pan', period: 'account' };
    }
    const nextUsed = used + 1;
    _account.set(key, nextUsed);
    return { ok: true, used: nextUsed, limit, remaining: Math.max(0, limit - nextUsed), scope: 'v11pan', period: 'account' };
  }

  await ensureAccountQuotaTable(db);
  const reserved = await db.query(`
    INSERT INTO account_feature_usage (user_id, feature, used_count)
    VALUES ($1, 'v11pan', 1)
    ON CONFLICT (user_id, feature) DO UPDATE
      SET used_count = account_feature_usage.used_count + 1,
          updated_at = NOW()
      WHERE account_feature_usage.used_count < $2
    RETURNING used_count
  `, [userId, limit]);
  const nextUsed = Number(reserved?.rows?.[0]?.used_count || 0);
  if (nextUsed > 0) {
    return { ok: true, used: nextUsed, limit, remaining: Math.max(0, limit - nextUsed), scope: 'v11pan', period: 'account' };
  }
  const current = await db.query(
    "SELECT used_count FROM account_feature_usage WHERE user_id = $1 AND feature = 'v11pan' LIMIT 1",
    [userId]
  );
  const used = Number(current?.rows?.[0]?.used_count || limit);
  return { ok: false, used, limit, remaining: 0, scope: 'v11pan', period: 'account' };
}

function buildQuotaExceededResponse(check, upgradeUrl) {
  const isAccountQuota = check?.period === 'account';
  return {
    ok: false,
    error: 'quota_exceeded',
    code: 'QUOTA_EXCEEDED',
    message: isAccountQuota
      ? 'Quota V11Pan du compte atteint. Passe au tier superieur pour augmenter la limite.'
      : 'Quota quotidien atteint pour ce tier. Reviens demain ou passe au tier superieur.',
    quota: { scope: check.scope, period: check.period || 'day', used: check.used, limit: check.limit, remaining: check.remaining },
    upgradeUrl: upgradeUrl || '/api/subscription/create-checkout',
  };
}

// Nettoyage periodique des entrees expirees ( > 48h ) pour garder la Map petite.
function pruneCounters() {
  const now = Date.now();
  for (const [k] of _daily) {
    const datePart = k.split('|').pop();
    const t = Date.parse(datePart);
    if (Number.isFinite(t) && now - t > 2 * DAY_MS) _daily.delete(k);
  }
}
setInterval(pruneCounters, 6 * 60 * 60 * 1000).unref?.();

module.exports = {
  TIER_USAGE_QUOTA,
  getTierUsageQuota,
  checkDefaultLlmQuota,
  recordDefaultLlmUsage,
  checkFairUseQuota,
  recordFairUse,
  reserveV11PanUsage,
  buildQuotaExceededResponse,
  pruneCounters,
};

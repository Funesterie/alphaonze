'use strict';

/**
 * karma-engine.cjs
 * Moteur de calcul du Karma pour A11 Autonomous Action System.
 *
 * Formule : base_karma + (tasks_success_rate × 2.0) - (tasks_error_rate × 1.5) - (consecutive_failures × 0.25)
 * Clamp : [0.0, 4.0]
 *
 * Exigences : 10.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */

const BASE_KARMA = 2.0;
const KARMA_MIN = 0.0;
const KARMA_MAX = 4.0;

/** Redis TTL pour les stats Karma (24h) */
const KARMA_STATS_TTL = 86400;

/** Deltas par type d'événement */
const KARMA_DELTAS = {
  task_done: +0.25,
  step_failed: -0.25,
  task_suspended: -0.5,
  artifact_produced: +0.1,
  timeout: -0.1,
};

// ---------------------------------------------------------------------------
// État en mémoire (fallback si Redis indisponible)
// ---------------------------------------------------------------------------

/** @type {import('./karma-engine.cjs').KarmaStats} */
let _inMemoryStats = {
  tasks_success_rate: 0.0,
  tasks_error_rate: 0.0,
  avg_step_latency_ms: 0,
  artifacts_produced: 0,
  tools_failed_count: 0,
  consecutive_failures: 0,
  window_start: new Date().toISOString(),
};

let _inMemoryKarma = BASE_KARMA;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp une valeur dans [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Retourne le client Redis si disponible via globalThis.__REDIS_CLIENT.
 * @returns {object|null}
 */
function getRedisClient() {
  try {
    if (globalThis.__REDIS_CLIENT && typeof globalThis.__REDIS_CLIENT.get === 'function') {
      return globalThis.__REDIS_CLIENT;
    }
  } catch (_) {
    // Redis indisponible
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fonctions publiques
// ---------------------------------------------------------------------------

/**
 * Calcule le Karma à partir des KarmaStats.
 *
 * Formule : base_karma + (tasks_success_rate × 2.0) - (tasks_error_rate × 1.5) - (consecutive_failures × 0.25)
 * Clampé dans [0.0, 4.0].
 *
 * @param {{ tasks_success_rate: number, tasks_error_rate: number, consecutive_failures: number }} stats
 * @returns {number} Karma dans [0.0, 4.0]
 */
function calculateFromStats(stats) {
  const raw =
    BASE_KARMA +
    (stats.tasks_success_rate * 2.0) -
    (stats.tasks_error_rate * 1.5) -
    (stats.consecutive_failures * 0.25);
  return clamp(raw, KARMA_MIN, KARMA_MAX);
}

/**
 * Applique un delta Karma selon le type d'événement.
 * Clamp après chaque application dans [0.0, 4.0].
 *
 * @param {{ type: string }} event - Événement Karma (type parmi task_done, step_failed, task_suspended, artifact_produced, timeout)
 * @returns {Promise<number>} Nouveau Karma après application du delta
 */
async function applyDelta(event) {
  const delta = KARMA_DELTAS[event.type];
  if (delta === undefined) {
    // Type d'événement inconnu : retourner le Karma courant sans modification
    return getCurrentKarma();
  }

  const current = await getCurrentKarma();
  const newKarma = clamp(current + delta, KARMA_MIN, KARMA_MAX);

  // Persister dans Redis si disponible, sinon en mémoire
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set('a11:karma:current', String(newKarma), { EX: KARMA_STATS_TTL });
    } catch (_) {
      _inMemoryKarma = newKarma;
    }
  } else {
    _inMemoryKarma = newKarma;
  }

  return newKarma;
}

/**
 * Recalcule le Karma depuis les KarmaStats courantes via calculateFromStats.
 *
 * @returns {Promise<number>} Karma recalculé dans [0.0, 4.0]
 */
async function recalculate() {
  const stats = await getStats();
  const karma = calculateFromStats(stats);

  // Mettre à jour le Karma courant
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set('a11:karma:current', String(karma), { EX: KARMA_STATS_TTL });
    } catch (_) {
      _inMemoryKarma = karma;
    }
  } else {
    _inMemoryKarma = karma;
  }

  return karma;
}

/**
 * Retourne les KarmaStats courantes.
 * Depuis Redis `a11:karma:stats` si disponible, sinon en mémoire.
 *
 * @returns {Promise<object>} KarmaStats
 */
async function getStats() {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get('a11:karma:stats');
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (_) {
      // Fallback en mémoire
    }
  }
  return { ..._inMemoryStats };
}

/**
 * Retourne le Karma courant.
 * Depuis Redis `a11:karma:current` si disponible, sinon recalcule depuis les stats en mémoire.
 *
 * @returns {Promise<number>} Karma courant dans [0.0, 4.0]
 */
async function getCurrentKarma() {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get('a11:karma:current');
      if (raw !== null && raw !== undefined) {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) {
          return clamp(parsed, KARMA_MIN, KARMA_MAX);
        }
      }
    } catch (_) {
      // Fallback : recalcul depuis les stats en mémoire
    }
  }

  // Pas de Redis ou valeur absente : retourner la valeur en mémoire
  return clamp(_inMemoryKarma, KARMA_MIN, KARMA_MAX);
}

/**
 * Persiste les KarmaStats dans Redis `a11:karma:stats` avec TTL 86400s.
 * Fallback silencieux si Redis indisponible.
 *
 * @returns {Promise<void>}
 */
async function persistStats() {
  const redis = getRedisClient();
  if (!redis) {
    // Pas de Redis : les stats restent en mémoire, rien à faire
    return;
  }

  try {
    const stats = await getStats();
    await redis.set('a11:karma:stats', JSON.stringify(stats), { EX: KARMA_STATS_TTL });
  } catch (_) {
    // Fallback silencieux
  }
}

module.exports = {
  calculateFromStats,
  applyDelta,
  recalculate,
  getStats,
  getCurrentKarma,
  persistStats,
  // Exposé pour les tests
  KARMA_DELTAS,
  KARMA_MIN,
  KARMA_MAX,
};

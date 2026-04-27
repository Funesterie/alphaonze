'use strict';

/**
 * a11-droid.cjs
 * Gestionnaire principal de la file de Tasks autonomes d'A11.
 *
 * Responsabilités :
 *  - Boucle de polling FIFO (startDroidLoop / stopDroidLoop)
 *  - Persistance duale : Redis (a11:droid:tasks) + fichier local (a11d-tasks.json)
 *  - Checkpoints & Rollback
 *  - Circuit breaker (10 erreurs / 60s → pause 30s)
 *  - Mise à jour updatedAt toutes les 5s pendant l'exécution
 *  - Validation Goal (≤ 2000 chars) et limite 10 tasks pending/running
 *
 * Exigences : 2.1, 2.7, 2.8, 2.9, 4.2, 4.3, 4.5, 4.7, 6.3, 7.1, 8.3, 8.4
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const DROID_VERSION = '1.0.0';
const ROOT = process.cwd();
const QFLUSH_DIR = path.join(ROOT, '.qflush');
const TASK_FILE = path.join(QFLUSH_DIR, 'a11d-tasks.json');
const CHECKPOINT_FILE = path.join(QFLUSH_DIR, 'a11d-checkpoints.json');

const REDIS_TASKS_KEY = 'a11:droid:tasks';
const REDIS_CHECKPOINTS_KEY = 'a11:droid:checkpoints';

const MAX_GOAL_LENGTH = 2000;
const MAX_PENDING_RUNNING = 10;

// Circuit breaker
const CB_ERROR_WINDOW_MS = 60 * 1000; // 60s
const CB_ERROR_THRESHOLD = 10;
const CB_PAUSE_MS = 30 * 1000; // 30s

// updatedAt heartbeat during execution
const HEARTBEAT_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------

let _loopRunning = false;
let _loopInterval = null;
let _lastRun = null;
let _processedCount = 0;

// Circuit breaker state
let _cbErrors = []; // timestamps des erreurs récentes
let _cbPaused = false;
let _cbPauseTimer = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {
    // ignore
  }
}

/**
 * Retourne le client Redis si disponible via globalThis.__REDIS_CLIENT.
 * @returns {object|null}
 */
function getRedisClient() {
  try {
    if (
      globalThis.__REDIS_CLIENT &&
      typeof globalThis.__REDIS_CLIENT.get === 'function'
    ) {
      return globalThis.__REDIS_CLIENT;
    }
  } catch (_e) {
    // Redis indisponible
  }
  return null;
}

/**
 * Écrit un log dans l'Audit_Trail (console + fichier si possible).
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} event
 * @param {object} [extra]
 */
function auditLog(level, event, extra = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    level,
    ...extra,
  };
  const line = JSON.stringify(entry);
  if (level === 'ERROR') {
    console.error('[A11][DROID]', line);
  } else if (level === 'WARN') {
    console.warn('[A11][DROID]', line);
  } else {
    console.log('[A11][DROID]', line);
  }
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

/**
 * Enregistre une erreur dans le circuit breaker.
 * Si ≥ 10 erreurs en 60s → pause la boucle 30s.
 */
function recordCircuitBreakerError() {
  const now = Date.now();
  // Purger les erreurs hors fenêtre
  _cbErrors = _cbErrors.filter((ts) => now - ts < CB_ERROR_WINDOW_MS);
  _cbErrors.push(now);

  if (!_cbPaused && _cbErrors.length >= CB_ERROR_THRESHOLD) {
    _cbPaused = true;
    auditLog('WARN', 'circuit_breaker_triggered', {
      errorCount: _cbErrors.length,
      windowMs: CB_ERROR_WINDOW_MS,
      pauseMs: CB_PAUSE_MS,
    });
    _cbPauseTimer = setTimeout(() => {
      _cbPaused = false;
      _cbErrors = [];
      auditLog('INFO', 'circuit_breaker_resumed');
    }, CB_PAUSE_MS);
  }
}

/**
 * Retourne true si le circuit breaker est en pause.
 * @returns {boolean}
 */
function isCircuitBreakerPaused() {
  return _cbPaused;
}

// ---------------------------------------------------------------------------
// Persistance — Tasks
// ---------------------------------------------------------------------------

/**
 * Charge les tasks depuis Redis (prioritaire) ou le fichier local.
 * @returns {Promise<object[]>}
 */
async function loadTasks() {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(REDIS_TASKS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_e) {
      auditLog('WARN', 'redis_load_tasks_failed_fallback_to_file');
    }
  }

  // Fallback fichier local
  try {
    if (!fs.existsSync(TASK_FILE)) return [];
    const raw = fs.readFileSync(TASK_FILE, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    auditLog('WARN', 'local_load_tasks_failed', { error: String(_e && _e.message) });
    return [];
  }
}

/**
 * Sauvegarde les tasks dans Redis ET le fichier local.
 * @param {object[]} tasks
 */
async function saveTasks(tasks) {
  const json = JSON.stringify(tasks, null, 2);

  // Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(REDIS_TASKS_KEY, json);
    } catch (_e) {
      auditLog('WARN', 'redis_save_tasks_failed_fallback_to_file');
    }
  }

  // Fichier local (toujours)
  try {
    ensureDir(QFLUSH_DIR);
    fs.writeFileSync(TASK_FILE, json, 'utf8');
  } catch (_e) {
    auditLog('ERROR', 'local_save_tasks_failed', { error: String(_e && _e.message) });
  }
}

// ---------------------------------------------------------------------------
// Persistance — Checkpoints
// ---------------------------------------------------------------------------

/**
 * Charge les checkpoints depuis Redis ou le fichier local.
 * @returns {Promise<object[]>}
 */
async function loadCheckpoints() {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(REDIS_CHECKPOINTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_e) {
      // fallback
    }
  }

  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return [];
    const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

/**
 * Sauvegarde les checkpoints dans Redis ET le fichier local.
 * @param {object[]} checkpoints
 */
async function saveCheckpoints(checkpoints) {
  const json = JSON.stringify(checkpoints, null, 2);

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(REDIS_CHECKPOINTS_KEY, json);
    } catch (_e) {
      // fallback silencieux
    }
  }

  try {
    ensureDir(QFLUSH_DIR);
    fs.writeFileSync(CHECKPOINT_FILE, json, 'utf8');
  } catch (_e) {
    auditLog('ERROR', 'local_save_checkpoints_failed', { error: String(_e && _e.message) });
  }
}

// ---------------------------------------------------------------------------
// API publique — Tasks
// ---------------------------------------------------------------------------

/**
 * Ajoute une Task dans la file.
 * Valide : Goal ≤ 2000 chars, max 10 tasks pending/running.
 *
 * @param {{ goal: string, meta?: object, userId?: string }} taskData
 * @returns {Promise<object>} Task créée
 */
async function addDroidTask(taskData) {
  const goal = String(taskData.goal || '').trim();

  if (goal.length > MAX_GOAL_LENGTH) {
    throw new Error(
      `Goal trop long : ${goal.length} caractères (max ${MAX_GOAL_LENGTH})`
    );
  }

  const tasks = await loadTasks();
  const activeCount = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'running'
  ).length;

  if (activeCount >= MAX_PENDING_RUNNING) {
    throw new Error(
      `Trop de Tasks actives : ${activeCount} (max ${MAX_PENDING_RUNNING})`
    );
  }

  const now = new Date().toISOString();
  const id = `task_${tasks.length + 1}_${Date.now()}`;

  const task = {
    id,
    goal,
    meta: taskData.meta || {},
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    userId: taskData.userId || null,
    checkpoints: [],
    stepRetries: {},
    consecutiveFailures: 0,
  };

  tasks.push(task);
  await saveTasks(tasks);

  auditLog('INFO', 'task_created', { taskId: id, goal: goal.slice(0, 100) });

  return task;
}

/**
 * Retourne une Task par son ID.
 * Cherche dans Redis puis fichier local.
 *
 * @param {string} taskId
 * @returns {Promise<object|null>}
 */
async function getTaskById(taskId) {
  const tasks = await loadTasks();
  return tasks.find((t) => t.id === taskId) || null;
}

/**
 * Liste les Tasks avec filtre optionnel.
 * Retourne dans l'ordre FIFO (createdAt croissant).
 *
 * @param {{ status?: string }} [filter]
 * @returns {Promise<object[]>}
 */
async function listTasks(filter) {
  const tasks = await loadTasks();
  let result = tasks.slice();

  if (filter && filter.status) {
    result = result.filter((t) => t.status === filter.status);
  }

  // Tri FIFO : createdAt croissant (ordre lexicographique ISO 8601)
  result.sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });

  return result;
}

/**
 * Annule une Task (statut → cancelled).
 * Ne pas interrompre le step en cours.
 *
 * @param {string} taskId
 * @returns {Promise<boolean>}
 */
async function cancelTask(taskId) {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskId);

  if (!task) return false;
  if (task.status === 'cancelled' || task.status === 'done') return false;

  task.status = 'cancelled';
  task.updatedAt = new Date().toISOString();

  await saveTasks(tasks);
  auditLog('INFO', 'task_cancelled', { taskId });

  return true;
}

/**
 * Rollback d'une Task depuis le Checkpoint le plus récent.
 * Repasse la Task au statut pending.
 *
 * @param {string} taskId
 * @returns {Promise<boolean>}
 */
async function rollbackTask(taskId) {
  const checkpoints = await loadCheckpoints();
  // Trouver le checkpoint le plus récent pour cette task
  const taskCheckpoints = checkpoints
    .filter((c) => c.taskId === taskId)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

  if (taskCheckpoints.length === 0) {
    auditLog('WARN', 'rollback_no_checkpoint', { taskId });
    return false;
  }

  const latest = taskCheckpoints[0];
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);

  if (idx === -1) return false;

  // Restaurer depuis le snapshot du checkpoint
  const restored = {
    ...latest.taskSnapshot,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };

  tasks[idx] = restored;
  await saveTasks(tasks);

  auditLog('INFO', 'task_rollback', { taskId, checkpointId: latest.id });

  return true;
}

/**
 * Crée un Checkpoint complet pour une Task.
 *
 * @param {string} taskId
 * @returns {Promise<object>} Checkpoint créé
 */
async function createCheckpoint(taskId) {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    throw new Error(`Task introuvable : ${taskId}`);
  }

  const checkpoints = await loadCheckpoints();
  const now = new Date().toISOString();
  const checkpointId = `cp_${taskId}_${Date.now()}`;

  const checkpoint = {
    id: checkpointId,
    taskId,
    createdAt: now,
    completedSteps: task.completedSteps || [],
    failedSteps: task.failedSteps || [],
    partialResults: task.partialResults || [],
    taskSnapshot: { ...task },
  };

  checkpoints.push(checkpoint);
  await saveCheckpoints(checkpoints);

  auditLog('INFO', 'checkpoint_created', { taskId, checkpointId });

  return checkpoint;
}

/**
 * Retourne l'état global du Droid.
 * @returns {Promise<object>}
 */
async function getDroidStatus() {
  const tasks = await loadTasks();

  const totals = {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    running: tasks.filter((t) => t.status === 'running').length,
    done: tasks.filter((t) => t.status === 'done').length,
    error: tasks.filter((t) => t.status === 'error').length,
    suspended: tasks.filter((t) => t.status === 'suspended').length,
    cancelled: tasks.filter((t) => t.status === 'cancelled').length,
  };

  return {
    loopRunning: _loopRunning,
    lastRun: _lastRun,
    processedCount: _processedCount,
    circuitBreakerPaused: _cbPaused,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Traitement des Tasks
// ---------------------------------------------------------------------------

/**
 * Traite la prochaine Task pending (FIFO).
 * Stub : sera enrichi en tâche 6 avec l'Executor.
 */
async function processNextTask() {
  if (isCircuitBreakerPaused()) {
    return;
  }

  const tasks = await loadTasks();
  // FIFO : première task pending par createdAt
  const pending = tasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const next = pending[0];
  if (!next) return;

  // Vérifier que la task n'a pas été annulée entre-temps
  if (next.status !== 'pending') return;

  next.status = 'running';
  next.updatedAt = new Date().toISOString();
  await saveTasks(tasks);

  auditLog('INFO', 'task_started', { taskId: next.id });

  // Heartbeat : mettre à jour updatedAt toutes les 5s pendant l'exécution
  let heartbeatInterval = null;
  heartbeatInterval = setInterval(async () => {
    try {
      const currentTasks = await loadTasks();
      const t = currentTasks.find((x) => x.id === next.id);
      if (t && t.status === 'running') {
        t.updatedAt = new Date().toISOString();
        await saveTasks(currentTasks);
      } else {
        clearInterval(heartbeatInterval);
      }
    } catch (_e) {
      // ignore heartbeat errors
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // TODO (tâche 6) : appeler a11-planner.cjs + a11-plan-executor.cjs ici
    console.log('[A11][DROID] processing task:', next.id, '-', next.goal);

    // Stub : simule un traitement minimal
    await new Promise((r) => setTimeout(r, 100));

    clearInterval(heartbeatInterval);

    // Recharger pour éviter les conflits d'écriture
    const freshTasks = await loadTasks();
    const freshTask = freshTasks.find((t) => t.id === next.id);

    if (freshTask && freshTask.status === 'running') {
      freshTask.status = 'done';
      freshTask.result = { ok: true, note: 'Traitement stub (à brancher sur Executor en tâche 6).' };
      freshTask.updatedAt = new Date().toISOString();
      await saveTasks(freshTasks);
    }

    _processedCount++;
    _lastRun = new Date().toISOString();

    auditLog('INFO', 'task_done', { taskId: next.id });
  } catch (err) {
    clearInterval(heartbeatInterval);

    recordCircuitBreakerError();

    auditLog('ERROR', 'task_error', {
      taskId: next.id,
      error: String(err && err.message),
    });

    // Créer un checkpoint sur erreur
    try {
      await createCheckpoint(next.id);
    } catch (_cpErr) {
      // ignore checkpoint error
    }

    const freshTasks = await loadTasks();
    const freshTask = freshTasks.find((t) => t.id === next.id);
    if (freshTask) {
      freshTask.status = 'error';
      freshTask.error = String(err && err.message) || String(err);
      freshTask.updatedAt = new Date().toISOString();
      await saveTasks(freshTasks);
    }
  }
}

// ---------------------------------------------------------------------------
// Boucle principale
// ---------------------------------------------------------------------------

/**
 * Démarre la boucle Droid.
 * @param {number} [intervalMs=15000]
 */
function startDroidLoop(intervalMs = 15000) {
  if (_loopRunning) {
    console.log('[A11][DROID] loop already running');
    return;
  }

  _loopRunning = true;
  auditLog('INFO', 'droid_loop_starting', { intervalMs, version: DROID_VERSION });

  // Connexion Redis / Qflush au démarrage
  _initRedisAndSupervisor();

  _loopInterval = setInterval(() => {
    if (isCircuitBreakerPaused()) return;

    processNextTask().catch((err) => {
      recordCircuitBreakerError();
      auditLog('ERROR', 'loop_error', { error: String(err && err.message) });
    });
  }, intervalMs);
}

/**
 * Arrête la boucle Droid proprement.
 */
function stopDroidLoop() {
  if (_loopInterval) {
    clearInterval(_loopInterval);
    _loopInterval = null;
  }
  if (_cbPauseTimer) {
    clearTimeout(_cbPauseTimer);
    _cbPauseTimer = null;
  }
  _loopRunning = false;
  auditLog('INFO', 'droid_loop_stopped');
}

// ---------------------------------------------------------------------------
// Initialisation Redis / Supervisor
// ---------------------------------------------------------------------------

/**
 * Initialise la connexion Redis et le supervisor Qflush au démarrage.
 * Publie l'événement a11:droid:started dans Redis.
 */
function _initRedisAndSupervisor() {
  // setupA11Supervisor — wrappé en try/catch, non bloquant
  try {
    const { setupA11Supervisor } = require('./src/qflush-integration.cjs');
    Promise.resolve(setupA11Supervisor())
      .then((supervisor) => {
        if (supervisor) {
          auditLog('INFO', 'supervisor_initialized');
        } else {
          auditLog('WARN', 'supervisor_init_returned_null');
        }
      })
      .catch((err) => {
        auditLog('WARN', 'supervisor_init_failed', {
          error: String(err && err.message),
        });
      });
  } catch (err) {
    auditLog('WARN', 'supervisor_require_failed', {
      error: String(err && err.message),
    });
  }

  // Publier a11:droid:started dans Redis
  const redis = getRedisClient();
  if (redis) {
    const event = JSON.stringify({
      event: 'a11:droid:started',
      timestamp: new Date().toISOString(),
      version: DROID_VERSION,
    });
    Promise.resolve(redis.publish('a11:droid:started', event)).catch((err) => {
      auditLog('WARN', 'redis_publish_started_failed', {
        error: String(err && err.message),
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  startDroidLoop,
  stopDroidLoop,
  addDroidTask,
  getDroidStatus,
  getTaskById,
  listTasks,
  cancelTask,
  rollbackTask,
  createCheckpoint,
  // Exposé pour les tests
  _loadTasks: loadTasks,
  _saveTasks: saveTasks,
  _recordCircuitBreakerError: recordCircuitBreakerError,
  _isCircuitBreakerPaused: isCircuitBreakerPaused,
  _resetCircuitBreaker: () => {
    _cbErrors = [];
    _cbPaused = false;
    if (_cbPauseTimer) {
      clearTimeout(_cbPauseTimer);
      _cbPauseTimer = null;
    }
  },
  CB_ERROR_THRESHOLD,
  CB_ERROR_WINDOW_MS,
  CB_PAUSE_MS,
};

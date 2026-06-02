'use strict';

/**
 * a11-plan-executor.cjs
 * Exécuteur séquentiel de steps d'un Plan pour A11 Autonomous Action System.
 *
 * Responsabilités :
 *  - Safety_Gate : vérification dangerLevel + WORKSPACE_ROOTS + allowedPrefixes
 *  - Rate_Limiter : 60 appels/min par session, 20 appels/min pour LLM
 *  - Dispatch via Horn.scream(skill, payload) avec fallback direct
 *  - Retry exponentiel : 2 tentatives supplémentaires (1s, 2s)
 *  - Compteur d'échecs consécutifs → suspension à > 3
 *  - Audit_Trail : fichier rotatif a11-droid.log (max 10 Mo, 7 fichiers)
 *  - Karma_Engine.applyDelta après chaque événement significatif
 *  - Écriture nœud Task dans Neo4j (fallback JSON local)
 *  - Entrée mémoire épisodique avec tag autonomous_action
 *
 * Exigences : 2.3, 2.4, 2.5, 2.6, 4.1, 4.4, 5.1, 5.2, 5.5, 6.1, 6.2, 6.4, 6.5, 6.7, 7.3, 7.5, 7.6, 10.6
 */

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Préfixes de skills autorisés */
const ALLOWED_PREFIXES = [
  'a11d.fs.',
  'a11d.shell.',
  'a11d.git.',
  'a11d.tests.',
  'a11d.vs.',
  'a11d.qf.',
  'a11d.ui.',
  'a11d.web.',
  'a11d.llm.',
];

/** Mots-clés déterminant le dangerLevel d'un skill */
const HIGH_DANGER_KEYWORDS = ['shell', 'git', 'email', 'send', 'delete', 'rm', 'drop'];
const MEDIUM_DANGER_KEYWORDS = ['write', 'create', 'update', 'post', 'put'];

/** WORKSPACE_ROOTS : depuis A11_WORKSPACE_ROOTS ou process.cwd() */
const WORKSPACE_ROOTS = (() => {
  const env = process.env.A11_WORKSPACE_ROOTS;
  if (env && env.trim()) {
    // Supporte séparateurs : ou ;
    const roots = env.split(/[:;]/).map((r) => r.trim()).filter(Boolean);
    if (roots.length > 0) return roots;
  }
  return [process.cwd()];
})();

/** Rate limiter : 60 appels/min par session */
const RATE_LIMIT_PER_MIN = 60;
/** Rate limiter LLM : 20 appels/min */
const RATE_LIMIT_LLM_PER_MIN = 20;
const RATE_WINDOW_MS = 60 * 1000;

/** Retry exponentiel */
const RETRY_DELAYS_MS = [1000, 2000];
const MAX_RETRIES = 2;

/** Suspension après N échecs consécutifs */
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/** Audit_Trail log rotation */
const LOG_FILE_NAME = 'a11-droid.log';
const LOG_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo
const LOG_MAX_FILES = 7;

// ---------------------------------------------------------------------------
// État Rate_Limiter (par session)
// ---------------------------------------------------------------------------

/** Map<sessionId, { calls: number[], llmCalls: number[] }> */
const _rateLimiterState = new Map();

// ---------------------------------------------------------------------------
// Audit_Trail
// ---------------------------------------------------------------------------

const _logDir = (() => {
  // Chercher un dossier logs/ à côté du fichier courant
  const candidate = path.join(__dirname, 'logs');
  try {
    if (!fs.existsSync(candidate)) fs.mkdirSync(candidate, { recursive: true });
  } catch (_e) {
    // ignore
  }
  return candidate;
})();

const _logFilePath = path.join(_logDir, LOG_FILE_NAME);

/**
 * Rotation du fichier de log si taille > LOG_MAX_SIZE_BYTES.
 * Renomme .log → .1.log, .1.log → .2.log, etc. (max LOG_MAX_FILES)
 */
function _rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(_logFilePath)) return;
    const stat = fs.statSync(_logFilePath);
    if (stat.size < LOG_MAX_SIZE_BYTES) return;

    // Supprimer le fichier le plus ancien si on atteint la limite
    const oldest = `${_logFilePath}.${LOG_MAX_FILES}`;
    if (fs.existsSync(oldest)) {
      try { fs.unlinkSync(oldest); } catch (_e) { /* ignore */ }
    }

    // Décaler les fichiers existants
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const src = `${_logFilePath}.${i}`;
      const dst = `${_logFilePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        try { fs.renameSync(src, dst); } catch (_e) { /* ignore */ }
      }
    }

    // Renommer le fichier courant en .1
    try { fs.renameSync(_logFilePath, `${_logFilePath}.1`); } catch (_e) { /* ignore */ }
  } catch (_e) {
    // Rotation silencieuse
  }
}

/**
 * Écrit un événement dans l'Audit_Trail (fichier rotatif + console).
 *
 * @param {object} event - AuditEvent
 * @param {string} event.timestamp
 * @param {string} event.taskId
 * @param {string} event.event
 * @param {string} [event.skill]
 * @param {string} [event.payload]
 * @param {string} [event.result]
 * @param {'INFO'|'WARN'|'ERROR'} event.level
 */
function _auditTrailLog(event) {
  // Tronquer payload et result à 500 chars
  const sanitized = {
    timestamp: event.timestamp || new Date().toISOString(),
    taskId: event.taskId || '',
    event: event.event || '',
    level: event.level || 'INFO',
  };

  if (event.skill !== undefined) sanitized.skill = event.skill;
  if (event.payload !== undefined) {
    sanitized.payload = String(event.payload).slice(0, 500);
  }
  if (event.result !== undefined) {
    sanitized.result = String(event.result).slice(0, 500);
  }

  const line = JSON.stringify(sanitized) + '\n';

  // Console
  if (sanitized.level === 'ERROR') {
    console.error('[A11][EXECUTOR]', line.trim());
  } else if (sanitized.level === 'WARN') {
    console.warn('[A11][EXECUTOR]', line.trim());
  } else {
    console.log('[A11][EXECUTOR]', line.trim());
  }

  // Fichier rotatif
  try {
    _rotateLogIfNeeded();
    fs.appendFileSync(_logFilePath, line, 'utf8');
  } catch (_e) {
    // Fallback silencieux si le fichier n'est pas accessible
  }

  return sanitized;
}

/**
 * AuditTrail public — retourne l'événement enregistré (pour les tests).
 */
const _auditTrail = {
  /**
   * @param {object} event
   * @returns {object} événement sanitisé
   */
  log(event) {
    return _auditTrailLog(event);
  },
};

// ---------------------------------------------------------------------------
// Karma_Engine
// ---------------------------------------------------------------------------

function _getKarmaEngine() {
  try {
    return require('./lib/karma-engine.cjs');
  } catch (_e) {
    return null;
  }
}

async function _applyKarmaDelta(eventType) {
  try {
    const ke = _getKarmaEngine();
    if (ke && typeof ke.applyDelta === 'function') {
      await ke.applyDelta({ type: eventType });
    }
  } catch (_e) {
    // Karma non bloquant
  }
}

// ---------------------------------------------------------------------------
// Neo4j / Mémoire épisodique
// ---------------------------------------------------------------------------

/**
 * Écrit un nœud Task dans Neo4j (fallback JSON local si indisponible).
 */
async function _writeTaskNodeNeo4j(task, plan, duration) {
  const taskNode = {
    taskId: task.id,
    goal: task.goal,
    stepsCount: plan.steps ? plan.steps.length : 0,
    duration,
    completedAt: new Date().toISOString(),
    skills: plan.steps ? plan.steps.map((s) => s.skill) : [],
  };

  // Tenter Neo4j via globalThis.__NEO4J_DRIVER
  try {
    const driver = globalThis.__NEO4J_DRIVER;
    if (driver && typeof driver.session === 'function') {
      const session = driver.session();
      try {
        await session.run(
          `MERGE (t:Task { taskId: $taskId })
           SET t.goal = $goal,
               t.stepsCount = $stepsCount,
               t.duration = $duration,
               t.completedAt = $completedAt
           RETURN t`,
          taskNode
        );
        // Relations USED_SKILL
        for (const skill of taskNode.skills) {
          await session.run(
            `MATCH (t:Task { taskId: $taskId })
             MERGE (s:Skill { name: $skill })
             MERGE (t)-[:USED_SKILL]->(s)`,
            { taskId: task.id, skill }
          );
        }
      } finally {
        await session.close();
      }
      return;
    }
  } catch (_e) {
    // Fallback JSON local
  }

  // Fallback JSON local: runtime/ d'abord, ancien fichier repo en lecture de migration.
  try {
    const runtimeRoot = path.resolve(
      process.env.A11_RUNTIME_DIR
      || process.env.A11_RUNTIME_ROOT
      || process.env.RUNTIME_DIR
      || path.join(__dirname, 'runtime')
    );
    const kgDir = path.join(runtimeRoot, 'knowledge-graph');
    if (!fs.existsSync(kgDir)) fs.mkdirSync(kgDir, { recursive: true });
    const kgFile = path.join(kgDir, 'tasks.json');
    const legacyKgFile = path.join(__dirname, 'knowledge-graph', 'tasks.json');
    let existing = [];
    if (fs.existsSync(kgFile)) {
      try { existing = JSON.parse(fs.readFileSync(kgFile, 'utf8')); } catch (_e) { existing = []; }
    } else if (fs.existsSync(legacyKgFile)) {
      try { existing = JSON.parse(fs.readFileSync(legacyKgFile, 'utf8')); } catch (_e) { existing = []; }
    }
    existing.push(taskNode);
    fs.writeFileSync(kgFile, JSON.stringify(existing, null, 2), 'utf8');
  } catch (_e) {
    // Silencieux
  }
}

/**
 * Crée une entrée mémoire épisodique avec tag autonomous_action.
 */
async function _writeEpisodicMemory(task, result, auditTrailEvents) {
  try {
    const memDir = path.join(__dirname, '..', '..', '..', '..', 'a11_memory', 'conversations');
    if (!fs.existsSync(memDir)) return;

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const memFile = path.join(memDir, `${today}.jsonl`);

    const entry = {
      timestamp: new Date().toISOString(),
      tag: 'autonomous_action',
      taskId: task.id,
      goal: task.goal,
      result: result ? String(result).slice(0, 500) : null,
      stepsCount: auditTrailEvents.filter((e) => e.event === 'step_ok').length,
      a11_perspective: `Task "${task.goal}" exécutée avec ${auditTrailEvents.filter((e) => e.event === 'step_ok').length} steps réussis.`,
    };

    fs.appendFileSync(memFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch (_e) {
    // Silencieux
  }
}

// ---------------------------------------------------------------------------
// Safety_Gate
// ---------------------------------------------------------------------------

/**
 * Détermine le dangerLevel d'un skill.
 *
 * @param {string} skill
 * @returns {'high'|'medium'|'low'}
 */
function _getDangerLevel(skill) {
  if (typeof skill !== 'string') return 'low';
  const lower = skill.toLowerCase();

  for (const kw of HIGH_DANGER_KEYWORDS) {
    if (lower.includes(kw)) return 'high';
  }
  for (const kw of MEDIUM_DANGER_KEYWORDS) {
    if (lower.includes(kw)) return 'medium';
  }
  return 'low';
}

/**
 * Vérifie qu'un chemin filesystem est contenu dans l'un des WORKSPACE_ROOTS.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function _isPathInWorkspaceRoots(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;

  let resolved;
  try {
    resolved = path.resolve(filePath);
  } catch (_e) {
    return false;
  }

  return WORKSPACE_ROOTS.some((root) => {
    try {
      const resolvedRoot = path.resolve(root);
      // Le chemin doit commencer par le root (avec séparateur pour éviter les faux positifs)
      return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    } catch (_e) {
      return false;
    }
  });
}

/**
 * Safety_Gate : vérifie si un step peut être exécuté.
 *
 * @param {{ skill: string, payload?: object }} step
 * @param {{ sessionId?: string, showcaseMode?: boolean }} [options]
 * @returns {{ allowed: boolean, reason?: string }}
 */
function _safetyGate(step, options = {}) {
  const skill = step.skill || '';

  // 1. Vérifier la whitelist allowedPrefixes
  const isAllowed = ALLOWED_PREFIXES.some((prefix) => skill.startsWith(prefix));
  if (!isAllowed) {
    return {
      allowed: false,
      reason: `skill "${skill}" n'appartient à aucun préfixe autorisé`,
    };
  }

  // 2. Vérifier le dangerLevel
  const dangerLevel = _getDangerLevel(skill);
  if (dangerLevel === 'high') {
    // Autorisation globale de session ?
    if (globalThis.__A11_ALLOW_HIGH_DANGER === true) {
      // Autorisé globalement
    } else {
      return {
        allowed: false,
        reason: `step bloqué : dangerLevel "high" pour skill "${skill}" — confirmation utilisateur requise`,
      };
    }
  }

  // 3. Vérifier le chemin filesystem si applicable
  const payload = step.payload || {};
  const fsPathKeys = ['path', 'filePath', 'file', 'dir', 'directory', 'src', 'dest', 'destination'];
  for (const key of fsPathKeys) {
    if (typeof payload[key] === 'string' && payload[key].length > 0) {
      const fsPath = payload[key];
      // Vérifier seulement si le chemin ressemble à un chemin absolu ou relatif avec /
      if (path.isAbsolute(fsPath) || fsPath.includes('/') || fsPath.includes('\\')) {
        if (!_isPathInWorkspaceRoots(fsPath)) {
          return {
            allowed: false,
            reason: `chemin filesystem "${fsPath}" hors des WORKSPACE_ROOTS`,
          };
        }
      }
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Rate_Limiter
// ---------------------------------------------------------------------------

/**
 * Vérifie et enregistre un appel dans le Rate_Limiter.
 *
 * @param {string} sessionId
 * @param {boolean} isLlm
 * @returns {{ allowed: boolean, reason?: string }}
 */
function _rateLimiter(sessionId, isLlm = false) {
  const id = sessionId || 'default';
  const now = Date.now();

  if (!_rateLimiterState.has(id)) {
    _rateLimiterState.set(id, { calls: [], llmCalls: [] });
  }

  const state = _rateLimiterState.get(id);

  // Purger les appels hors fenêtre
  state.calls = state.calls.filter((ts) => now - ts < RATE_WINDOW_MS);
  state.llmCalls = state.llmCalls.filter((ts) => now - ts < RATE_WINDOW_MS);

  // Vérifier limite LLM
  if (isLlm && state.llmCalls.length >= RATE_LIMIT_LLM_PER_MIN) {
    return { allowed: false, reason: 'rate_limit_exceeded (LLM: 20/min)' };
  }

  // Vérifier limite globale
  if (state.calls.length >= RATE_LIMIT_PER_MIN) {
    return { allowed: false, reason: 'rate_limit_exceeded (60/min)' };
  }

  // Enregistrer l'appel
  state.calls.push(now);
  if (isLlm) state.llmCalls.push(now);

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Horn dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch via Horn.scream(skill, payload) si Qflush disponible.
 * Fallback : appel direct au tools-dispatcher.
 *
 * Supporte un mock injectable via globalThis.__A11_HORN_MOCK pour les tests.
 *
 * @param {string} skill
 * @param {object} payload
 * @returns {Promise<any>}
 */
async function _hornDispatch(skill, payload) {
  // Mock injectable pour les tests (prioritaire)
  if (typeof globalThis.__A11_HORN_MOCK === 'function') {
    return await globalThis.__A11_HORN_MOCK(skill, payload);
  }

  // Tenter Horn si Qflush disponible
  if (globalThis.__QFLUSH_AVAILABLE === true) {
    try {
      const { runQflushSkill } = require('./src/qflush-integration.cjs');
      if (typeof runQflushSkill === 'function') {
        return await runQflushSkill(skill, payload);
      }
    } catch (_e) {
      // Fallback si Horn échoue
    }
  }

  // Fallback : appel direct au tools-dispatcher
  return await _directDispatch(skill, payload);
}

/**
 * Dispatch direct (fallback sans Horn).
 * Tente d'appeler le tools-dispatcher local.
 *
 * @param {string} skill
 * @param {object} payload
 * @returns {Promise<any>}
 */
async function _directDispatch(skill, payload) {
  // Tenter le tools-dispatcher si disponible
  try {
    const dispatcher = require('./tools/tools-dispatcher.cjs');
    if (typeof dispatcher.dispatch === 'function') {
      return await dispatcher.dispatch(skill, payload);
    }
    if (typeof dispatcher === 'function') {
      return await dispatcher(skill, payload);
    }
  } catch (_e) {
    // Dispatcher non disponible
  }

  // Dernier recours : retourner un résultat stub
  return { ok: true, skill, payload, note: 'direct_dispatch_stub' };
}

// ---------------------------------------------------------------------------
// Retry exponentiel
// ---------------------------------------------------------------------------

/**
 * Exécute un step avec retry exponentiel.
 * Pas de retry pour les steps high danger.
 *
 * @param {string} skill
 * @param {object} payload
 * @param {'high'|'medium'|'low'} dangerLevel
 * @returns {Promise<{ success: boolean, result?: any, error?: string, attempts: number }>}
 */
async function _executeWithRetry(skill, payload, dangerLevel) {
  const maxAttempts = dangerLevel === 'high' ? 1 : 1 + MAX_RETRIES;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // Délai exponentiel
      const delay = RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      await _sleep(delay);
    }

    try {
      const result = await _hornDispatch(skill, payload);
      return { success: true, result, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
    }
  }

  return {
    success: false,
    error: String(lastError && lastError.message ? lastError.message : lastError),
    attempts: maxAttempts,
  };
}

function _sleep(ms) {
  // Mock injectable pour les tests (évite les délais réels)
  if (typeof globalThis.__A11_SLEEP_MOCK === 'function') {
    return globalThis.__A11_SLEEP_MOCK(ms);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// executePlan — fonction principale
// ---------------------------------------------------------------------------

/**
 * Exécute un Plan pour une Task donnée.
 *
 * @param {{ id: string, goal: string }} task
 * @param {{ steps: Array<{ skill: string, payload: object, id?: string }> }} plan
 * @param {{ showcaseMode?: boolean, sessionId?: string }} [options]
 * @returns {Promise<{ status: 'done'|'suspended'|'error', auditTrail: object[], result?: any }>}
 */
async function executePlan(task, plan, options = {}) {
  const sessionId = options.sessionId || 'default';
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const auditEvents = [];
  const startTime = Date.now();

  /**
   * Helper : log un événement dans l'Audit_Trail et le push dans auditEvents.
   */
  function logEvent(eventType, extra = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      taskId: task.id,
      event: eventType,
      level: extra.level || 'INFO',
      ...extra,
    };
    // Supprimer level de extra pour éviter la duplication
    delete event.level;
    event.level = extra.level || 'INFO';

    const sanitized = _auditTrail.log(event);
    auditEvents.push(sanitized);
    return sanitized;
  }

  // Événement task_started
  logEvent('task_started', { level: 'INFO' });

  let consecutiveFailures = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const skill = step.skill || '';
    const payload = step.payload || {};
    const stepId = step.id || `step_${i}`;

    // --- Safety_Gate ---
    const gateResult = _safetyGate(step, options);
    if (!gateResult.allowed) {
      const isSecurityViolation = gateResult.reason && gateResult.reason.includes('hors des WORKSPACE_ROOTS');
      const eventType = isSecurityViolation ? 'security_violation' : 'step_blocked';
      logEvent(eventType, {
        skill,
        payload: JSON.stringify(payload),
        result: gateResult.reason,
        level: 'WARN',
      });

      // Les violations de sécurité comptent comme échecs consécutifs
      consecutiveFailures++;
      if (consecutiveFailures > CONSECUTIVE_FAILURE_THRESHOLD) {
        logEvent('task_suspended', { level: 'WARN', reason: 'too_many_consecutive_failures' });
        await _applyKarmaDelta('task_suspended');
        try {
          const { createCheckpoint } = require('./a11-droid.cjs');
          await createCheckpoint(task.id);
        } catch (_e) { /* ignore */ }
        return { status: 'suspended', auditTrail: auditEvents };
      }
      continue;
    }

    // --- Rate_Limiter ---
    const isLlm = skill.includes('llm');
    const rateResult = _rateLimiter(sessionId, isLlm);
    if (!rateResult.allowed) {
      logEvent('rate_limit_exceeded', {
        skill,
        result: rateResult.reason,
        level: 'WARN',
      });
      consecutiveFailures++;
      if (consecutiveFailures > CONSECUTIVE_FAILURE_THRESHOLD) {
        logEvent('task_suspended', { level: 'WARN', reason: 'too_many_consecutive_failures' });
        await _applyKarmaDelta('task_suspended');
        return { status: 'suspended', auditTrail: auditEvents };
      }
      continue;
    }

    // --- Exécution du step ---
    const dangerLevel = _getDangerLevel(skill);
    logEvent('step_start', {
      skill,
      payload: JSON.stringify(payload),
      level: 'INFO',
    });

    const execResult = await _executeWithRetry(skill, payload, dangerLevel);

    if (execResult.success) {
      logEvent('step_ok', {
        skill,
        result: JSON.stringify(execResult.result),
        level: 'INFO',
      });
      await _applyKarmaDelta('step_ok');
      consecutiveFailures = 0; // Reset sur succès
    } else {
      // Log les retries si > 1 tentative
      if (execResult.attempts > 1) {
        for (let r = 1; r < execResult.attempts; r++) {
          logEvent('step_retry', {
            skill,
            result: `retry ${r}/${execResult.attempts - 1}`,
            level: 'WARN',
          });
        }
      }

      logEvent('step_failed', {
        skill,
        result: execResult.error,
        level: 'ERROR',
      });
      await _applyKarmaDelta('step_failed');

      consecutiveFailures++;

      // Suspension si > 3 échecs consécutifs
      if (consecutiveFailures > CONSECUTIVE_FAILURE_THRESHOLD) {
        logEvent('task_suspended', {
          level: 'WARN',
          reason: `${consecutiveFailures} échecs consécutifs`,
        });
        await _applyKarmaDelta('task_suspended');

        // Créer un checkpoint
        try {
          const { createCheckpoint } = require('./a11-droid.cjs');
          await createCheckpoint(task.id);
        } catch (_e) { /* ignore */ }

        return { status: 'suspended', auditTrail: auditEvents };
      }
    }
  }

  // Tous les steps traités → done
  const duration = Date.now() - startTime;
  logEvent('task_done', { level: 'INFO', duration });
  await _applyKarmaDelta('task_done');

  // Écrire nœud Task dans Neo4j
  await _writeTaskNodeNeo4j(task, plan, duration);

  // Entrée mémoire épisodique
  await _writeEpisodicMemory(task, 'done', auditEvents);

  return {
    status: 'done',
    auditTrail: auditEvents,
    result: { duration, stepsExecuted: steps.length },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  executePlan,
  // Exposé pour les tests
  _safetyGate,
  _getDangerLevel,
  _isPathInWorkspaceRoots,
  _rateLimiter,
  _auditTrail,
  ALLOWED_PREFIXES,
  WORKSPACE_ROOTS,
};

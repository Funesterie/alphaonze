'use strict';

/**
 * ollama-queue.cjs
 *
 * File d'attente pour les requêtes Ollama.
 * Évite les timeouts clients quand plusieurs requêtes arrivent en même temps.
 *
 * Fonctionnement :
 *   - MAX_CONCURRENT requêtes s'exécutent en parallèle (aligné sur OLLAMA_NUM_PARALLEL)
 *   - Les suivantes attendent dans la queue (max MAX_QUEUE_SIZE)
 *   - Si la queue est pleine → 503 immédiat (pas de timeout silencieux)
 *   - Chaque requête a un timeout global (QUEUE_TIMEOUT_MS)
 *
 * Usage :
 *   const { withOllamaQueue } = require('../core/ollama-queue.cjs');
 *   const result = await withOllamaQueue(() => callOllama(message));
 */

const MAX_CONCURRENT  = Number(process.env.OLLAMA_BACKEND_PARALLEL  || 2);
const MAX_QUEUE_SIZE  = Number(process.env.OLLAMA_BACKEND_QUEUE_SIZE || 8);
const QUEUE_TIMEOUT_MS = Number(process.env.OLLAMA_BACKEND_TIMEOUT_MS || process.env.A11_LOCAL_CHAT_TIMEOUT_MS || 20_000);

let active = 0;
const queue = [];

/**
 * Exécute fn() en respectant la limite de concurrence.
 * @param {() => Promise<any>} fn  Fonction async à exécuter
 * @param {string} [label]         Label pour les logs
 * @returns {Promise<any>}
 */
function withOllamaQueue(fn, label = 'ollama') {
  return new Promise((resolve, reject) => {
    // Queue pleine → refus immédiat
    if (queue.length >= MAX_QUEUE_SIZE) {
      const err = new Error('ollama_queue_full');
      err.statusCode = 503;
      err.retryAfter = 10;
      return reject(err);
    }

    let timeoutHandle = null;

    const task = () => {
      active++;
      if (timeoutHandle) clearTimeout(timeoutHandle);

      Promise.resolve()
        .then(() => fn())
        .then((result) => {
          active--;
          _drain();
          resolve(result);
        })
        .catch((err) => {
          active--;
          _drain();
          reject(err);
        });
    };

    // Slot disponible → exécution immédiate
    if (active < MAX_CONCURRENT) {
      task();
      return;
    }

    // Sinon → mise en queue avec timeout
    timeoutHandle = setTimeout(() => {
      const idx = queue.indexOf(task);
      if (idx !== -1) queue.splice(idx, 1);
      const err = new Error(`ollama_queue_timeout after ${QUEUE_TIMEOUT_MS}ms`);
      err.statusCode = 504;
      reject(err);
    }, QUEUE_TIMEOUT_MS);

    queue.push(task);
    console.log(`[ollama-queue] ${label} en attente (active=${active} queue=${queue.length}/${MAX_QUEUE_SIZE})`);
  });
}

function _drain() {
  if (queue.length > 0 && active < MAX_CONCURRENT) {
    const next = queue.shift();
    next();
  }
}

/** Stats pour monitoring */
function getQueueStats() {
  return {
    active,
    queued: queue.length,
    maxConcurrent: MAX_CONCURRENT,
    maxQueueSize: MAX_QUEUE_SIZE,
    timeoutMs: QUEUE_TIMEOUT_MS,
  };
}

module.exports = { withOllamaQueue, getQueueStats };

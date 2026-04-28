'use strict';
/**
 * Module Loader — Chargement dynamique de modules pour A11
 *
 * Permet à A11 de charger, recharger et décharger des modules
 * sans redémarrer le serveur.
 *
 * Un module A11 est un fichier .cjs dans runtime/modules/ qui exporte :
 * {
 *   name: string,
 *   version: string,
 *   description: string,
 *   init: async (context) => void,    // appelé au chargement
 *   destroy: async () => void,        // appelé au déchargement
 *   routes: (app, context) => void,   // routes Express optionnelles
 *   tools: { [name]: async (args) => any }  // outils disponibles pour A11
 * }
 */

const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'module-loader' });

const MODULES_DIR = path.resolve(
  process.env.A11_MODULES_ROOT || path.resolve(__dirname, '../../../runtime/modules')
);

const _registry = new Map(); // name → { module, meta, loadedAt }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureModulesDir() {
  try {
    fs.mkdirSync(MODULES_DIR, { recursive: true });
  } catch {}
}

function clearRequireCache(filePath) {
  const resolved = require.resolve(filePath);
  delete require.cache[resolved];
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async function loadModule(filePath, context = {}) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Module not found: ${resolved}`);
  }

  // Clear cache pour permettre le rechargement
  clearRequireCache(resolved);

  let mod;
  try {
    mod = require(resolved);
  } catch (err) {
    throw new Error(`Failed to require module ${resolved}: ${err.message}`);
  }

  const name = mod.name || path.basename(resolved, '.cjs');

  // Décharger l'ancienne version si elle existe
  if (_registry.has(name)) {
    await unloadModule(name);
  }

  // Initialiser
  if (typeof mod.init === 'function') {
    try {
      await mod.init(context);
    } catch (err) {
      throw new Error(`Module ${name} init failed: ${err.message}`);
    }
  }

  _registry.set(name, {
    module: mod,
    filePath: resolved,
    loadedAt: new Date().toISOString(),
    meta: {
      name,
      version: mod.version || '0.0.1',
      description: mod.description || '',
      hasRoutes: typeof mod.routes === 'function',
      tools: Object.keys(mod.tools || {}),
    },
  });

  logger.info('Module loaded', { name, version: mod.version });
  return _registry.get(name);
}

async function unloadModule(name) {
  const entry = _registry.get(name);
  if (!entry) return false;

  if (typeof entry.module.destroy === 'function') {
    try {
      await entry.module.destroy();
    } catch (err) {
      logger.warn('Module destroy error', { name, error: err.message });
    }
  }

  clearRequireCache(entry.filePath);
  _registry.delete(name);
  logger.info('Module unloaded', { name });
  return true;
}

async function loadAllFromDir(context = {}) {
  ensureModulesDir();

  const files = fs.readdirSync(MODULES_DIR)
    .filter(f => f.endsWith('.cjs') && !f.startsWith('_'));

  const results = [];
  for (const file of files) {
    try {
      const entry = await loadModule(path.join(MODULES_DIR, file), context);
      results.push({ ok: true, name: entry.meta.name });
    } catch (err) {
      logger.warn('Failed to load module', { file, error: err.message });
      results.push({ ok: false, file, error: err.message });
    }
  }

  return results;
}

function getModule(name) {
  return _registry.get(name)?.module || null;
}

function listModules() {
  return Array.from(_registry.values()).map(e => ({
    ...e.meta,
    loadedAt: e.loadedAt,
    filePath: e.filePath,
  }));
}

function getAllTools() {
  const tools = {};
  for (const [name, entry] of _registry) {
    if (entry.module.tools) {
      for (const [toolName, fn] of Object.entries(entry.module.tools)) {
        tools[`${name}.${toolName}`] = fn;
      }
    }
  }
  return tools;
}

function mountRoutes(app, context = {}) {
  for (const [name, entry] of _registry) {
    if (typeof entry.module.routes === 'function') {
      try {
        entry.module.routes(app, context);
        logger.info('Module routes mounted', { name });
      } catch (err) {
        logger.warn('Module routes mount failed', { name, error: err.message });
      }
    }
  }
}

// ─── Watcher (hot reload en dev) ──────────────────────────────────────────────

let _watcher = null;

function watchModulesDir(context = {}) {
  if (process.env.NODE_ENV === 'production') return;
  ensureModulesDir();

  _watcher = fs.watch(MODULES_DIR, { persistent: false }, async (event, filename) => {
    if (!filename?.endsWith('.cjs')) return;
    const filePath = path.join(MODULES_DIR, filename);

    if (event === 'change' && fs.existsSync(filePath)) {
      logger.info('Module changed, reloading', { filename });
      try {
        await loadModule(filePath, context);
      } catch (err) {
        logger.warn('Hot reload failed', { filename, error: err.message });
      }
    }
  });

  logger.info('Watching modules directory for changes', { dir: MODULES_DIR });
}

function stopWatcher() {
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
}

module.exports = {
  loadModule,
  unloadModule,
  loadAllFromDir,
  getModule,
  listModules,
  getAllTools,
  mountRoutes,
  watchModulesDir,
  stopWatcher,
  MODULES_DIR,
};

'use strict';
/**
 * Routes mémoire unifiées pour A11
 *
 * GET  /api/agent/memory/status       — état de tous les systèmes mémoire
 * POST /api/agent/memory/consolidate  — déclencher une consolidation manuelle
 * GET  /api/agent/memory/modules      — liste des modules chargés
 * POST /api/agent/memory/modules/load — charger un module depuis runtime/modules/
 * DELETE /api/agent/memory/modules/:name — décharger un module
 */

const path = require('node:path');
const fs = require('node:fs');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');

const RUNTIME_ROOT = getCanonicalRuntimeRoot(process.env);

module.exports = function registerAgentMemoryRoutes({ app, consolidator, moduleLoader, verifyJWT }) {

  // ── Status global mémoire ──────────────────────────────────────────────────
  app.get('/api/agent/memory/status', async (req, res) => {
    try {
      const status = {
        ok: true,
        timestamp: new Date().toISOString(),
        consolidator: consolidator ? consolidator.getStatus() : { active: false, message: 'not initialized' },
        modules: moduleLoader ? moduleLoader.listModules() : [],
        storage: {
          conversations: countFiles(path.join(RUNTIME_ROOT, '../a11_memory/conversations'), '.jsonl'),
          memos: countFiles(path.join(RUNTIME_ROOT, '../a11_memory/memos'), '.json'),
          visionMemory: countFiles(path.join(RUNTIME_ROOT, 'vision-memory'), '.vision.json'),
          vectorMemory: countFiles(path.join(RUNTIME_ROOT, 'vector-memory'), '.jsonl'),
          episodicMemory: countFiles(path.join(RUNTIME_ROOT, '../a11_memory/episodic'), '.json'),
          knowledgeGraph: countFiles(path.join(RUNTIME_ROOT, 'knowledge-graph'), '.json'),
          watchdogSnapshots: countFiles(path.join(RUNTIME_ROOT, 'watchdog-snapshots'), '.json'),
        },
      };
      return res.json(status);
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Consolidation manuelle ─────────────────────────────────────────────────
  app.post('/api/agent/memory/consolidate', async (req, res) => {
    if (!consolidator) {
      return res.status(503).json({ ok: false, error: 'consolidator_not_initialized' });
    }
    try {
      await consolidator.runNow();
      return res.json({ ok: true, message: 'Consolidation triggered', status: consolidator.getStatus() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Liste des modules ──────────────────────────────────────────────────────
  app.get('/api/agent/memory/modules', (req, res) => {
    if (!moduleLoader) {
      return res.json({ ok: true, modules: [], message: 'module loader not initialized' });
    }
    return res.json({ ok: true, modules: moduleLoader.listModules() });
  });

  // ── Charger un module ──────────────────────────────────────────────────────
  app.post('/api/agent/memory/modules/load', async (req, res) => {
    if (!moduleLoader) {
      return res.status(503).json({ ok: false, error: 'module_loader_not_initialized' });
    }
    const { filename } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ ok: false, error: 'filename required' });
    }
    // Sécurité : seulement depuis runtime/modules/
    const safeName = path.basename(filename);
    const filePath = path.join(moduleLoader.MODULES_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: `Module not found: ${safeName}` });
    }
    try {
      const entry = await moduleLoader.loadModule(filePath);
      return res.json({ ok: true, module: entry.meta });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Décharger un module ────────────────────────────────────────────────────
  app.delete('/api/agent/memory/modules/:name', async (req, res) => {
    if (!moduleLoader) {
      return res.status(503).json({ ok: false, error: 'module_loader_not_initialized' });
    }
    const { name } = req.params;
    try {
      const unloaded = await moduleLoader.unloadModule(name);
      if (!unloaded) {
        return res.status(404).json({ ok: false, error: `Module not found: ${name}` });
      }
      return res.json({ ok: true, message: `Module ${name} unloaded` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Outils disponibles (tous modules) ─────────────────────────────────────
  app.get('/api/agent/memory/tools', (req, res) => {
    if (!moduleLoader) {
      return res.json({ ok: true, tools: [] });
    }
    const tools = moduleLoader.getAllTools();
    return res.json({ ok: true, tools: Object.keys(tools) });
  });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countFiles(dir, ext) {
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter(f => !ext || f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

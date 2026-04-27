'use strict';
/**
 * Qflush Flow Route — /api/qflush
 *
 * Donne à A11 un accès direct aux flows Qflush depuis le chat ou le MCP.
 * A11 peut déclencher n'importe quel flow built-in sans passer par le daemon HTTP.
 *
 * Flows disponibles :
 *   a11.chat.v1              — proxifie vers le backend LLM configuré
 *   a11.memory.summary.v1   — résumé de mémoire conversationnelle
 *   a11.memory.ephemeral.v1 — mémoire clé-valeur éphémère (set/get/list/delete/clear)
 *   web_fetch                — fetch HTTP d'une URL
 *   fs.search                — recherche de fichiers dans le workspace
 *
 * Endpoints :
 *   POST /api/qflush/run          — exécuter un flow (public)
 *   POST /api/qflush/admin/run    — exécuter un flow admin (JWT requis)
 *   GET  /api/qflush/status       — état du daemon et des flows disponibles
 *   GET  /api/qflush/memory/ephemeral/list  — lister la mémoire éphémère
 *   POST /api/qflush/memory/ephemeral       — set/get/delete mémoire éphémère
 *
 * Accès workspace étendu :
 *   POST /api/qflush/workspace/search  — recherche dans tout le workspace
 *   POST /api/qflush/workspace/read    — lire un fichier du workspace
 *   POST /api/qflush/workspace/list    — lister un dossier du workspace
 */

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { getLogger } = require('../../lib/structured-logger.cjs');

const logger = getLogger({ component: 'qflush-flow' });

// ─── Chargement de runFlow depuis @funeste38/qflush ───────────────────────────

let _runFlow = null;
let _qflushLoadError = null;

async function getRunFlow() {
  if (_runFlow) return _runFlow;
  if (_qflushLoadError) throw _qflushLoadError;

  try {
    // @funeste38/qflush est un module ESM — on utilise import() dynamique
    const mod = await import('@funeste38/qflush');
    const fn = mod?.runFlow || mod?.run || mod?.default?.runFlow || mod?.default?.run;
    if (typeof fn !== 'function') {
      throw new Error('runFlow non trouvé dans @funeste38/qflush');
    }
    _runFlow = fn;
    logger.info('Qflush runFlow chargé depuis @funeste38/qflush');
    return _runFlow;
  } catch (err) {
    _qflushLoadError = err;
    logger.warn('Qflush runFlow non disponible', { error: err.message });
    throw err;
  }
}

// ─── Flows publics (sans token) ───────────────────────────────────────────────
const PUBLIC_FLOWS = new Set([
  'a11.chat.v1',
  'a11.memory.summary.v1',
  'a11.memory.ephemeral.v1',
  'web_fetch',
  'fs.search',
]);

// ─── Sécurité workspace ───────────────────────────────────────────────────────

/**
 * Résout un chemin dans le workspace et vérifie qu'il reste dans les limites autorisées.
 * Autorise : workspace root, runtime root.
 * Bloque : chemins système, node_modules, .git, .env.
 */
function resolveWorkspacePath(workspaceRoot, runtimeRoot, relativePath) {
  const raw = String(relativePath || '').trim();
  if (!raw) throw new Error('Chemin vide');

  const resolved = path.resolve(workspaceRoot, raw);

  // Vérifier que le chemin est dans le workspace ou le runtime
  const inWorkspace = resolved.startsWith(path.normalize(workspaceRoot + path.sep)) || resolved === workspaceRoot;
  const inRuntime = runtimeRoot && (resolved.startsWith(path.normalize(runtimeRoot + path.sep)) || resolved === runtimeRoot);

  if (!inWorkspace && !inRuntime) {
    throw new Error(`Accès refusé : chemin hors du workspace (${resolved})`);
  }

  // Bloquer les chemins sensibles
  const normalized = resolved.replace(/\\/g, '/');
  const blocked = [
    '/node_modules/',
    '/.git/',
    '/.env',
    '/secrets',
    '/.kiro/settings/mcp.json',
  ];
  for (const b of blocked) {
    if (normalized.includes(b)) {
      throw new Error(`Accès refusé : chemin sensible bloqué (${b})`);
    }
  }

  return resolved;
}

// ─── Router factory ───────────────────────────────────────────────────────────

function createQflushFlowRouter({ workspaceRoot, runtimeRoot } = {}) {
  const router = express.Router();

  function getWorkspaceRoot() {
    return workspaceRoot
      || process.env.A11_WORKSPACE_ROOT
      || path.resolve(__dirname, '..', '..', '..', '..', '..');
  }

  function getRuntimeRoot() {
    return runtimeRoot
      || process.env.A11_RUNTIME_ROOT
      || path.join(getWorkspaceRoot(), 'runtime');
  }

  // ── GET /api/qflush/status ────────────────────────────────────────────────
  router.get('/status', async (_req, res) => {
    let qflushAvailable = false;
    let qflushError = null;
    try {
      await getRunFlow();
      qflushAvailable = true;
    } catch (err) {
      qflushError = err.message;
    }

    return res.json({
      ok: true,
      qflushAvailable,
      qflushError,
      flows: {
        public: [...PUBLIC_FLOWS],
        description: {
          'a11.chat.v1': 'Proxifie vers le backend LLM configuré',
          'a11.memory.summary.v1': 'Résumé de mémoire conversationnelle',
          'a11.memory.ephemeral.v1': 'Mémoire clé-valeur éphémère (set/get/list/delete/clear)',
          'web_fetch': 'Fetch HTTP d\'une URL',
          'fs.search': 'Recherche de fichiers dans le workspace',
        },
      },
      workspace: {
        root: getWorkspaceRoot(),
        runtime: getRuntimeRoot(),
      },
    });
  });

  // ── POST /api/qflush/run ──────────────────────────────────────────────────
  router.post('/run', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const { flow, payload } = req.body || {};
      const normalizedFlow = String(flow || '').trim();

      if (!normalizedFlow) {
        return res.status(400).json({ ok: false, error: 'missing_flow' });
      }

      if (!PUBLIC_FLOWS.has(normalizedFlow)) {
        return res.status(403).json({
          ok: false,
          error: 'flow_not_allowed',
          flow: normalizedFlow,
          publicFlows: [...PUBLIC_FLOWS],
        });
      }

      const runFlow = await getRunFlow();
      const result = await runFlow(normalizedFlow, payload || {});

      logger.info('Qflush flow executed', { flow: normalizedFlow, ok: result?.ok });
      return res.json(result);

    } catch (err) {
      logger.error('Qflush run error', { error: err.message });
      if (err.message.includes('runFlow non disponible') || err.message.includes('non trouvé')) {
        return res.status(503).json({ ok: false, error: 'qflush_unavailable', message: err.message });
      }
      return res.status(500).json({ ok: false, error: 'flow_failed', message: err.message });
    }
  });

  // ── POST /api/qflush/admin/run ────────────────────────────────────────────
  // JWT déjà vérifié par le middleware monté dans server.cjs
  router.post('/admin/run', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const { flow, payload } = req.body || {};
      const normalizedFlow = String(flow || '').trim();

      if (!normalizedFlow) {
        return res.status(400).json({ ok: false, error: 'missing_flow' });
      }

      const runFlow = await getRunFlow();
      const result = await runFlow(normalizedFlow, payload || {});

      logger.info('Qflush admin flow executed', { flow: normalizedFlow, userId: req.user?.id });
      return res.json(result);

    } catch (err) {
      logger.error('Qflush admin run error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'flow_failed', message: err.message });
    }
  });

  // ── POST /api/qflush/memory/ephemeral ─────────────────────────────────────
  router.post('/memory/ephemeral', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const runFlow = await getRunFlow();
      const result = await runFlow('a11.memory.ephemeral.v1', req.body || {});
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'ephemeral_memory_failed', message: err.message });
    }
  });

  // ── GET /api/qflush/memory/ephemeral/list ─────────────────────────────────
  router.get('/memory/ephemeral/list', async (req, res) => {
    try {
      const runFlow = await getRunFlow();
      const result = await runFlow('a11.memory.ephemeral.v1', {
        op: 'list',
        namespace: req.query?.namespace,
        scope: req.query?.scope,
        prefix: req.query?.prefix,
        limit: req.query?.limit ? Number(req.query.limit) : undefined,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'ephemeral_list_failed', message: err.message });
    }
  });

  // ── POST /api/qflush/workspace/search ─────────────────────────────────────
  // Recherche dans tout le workspace (pas seulement le runtime)
  router.post('/workspace/search', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const { pattern, path: searchPath, limit } = req.body || {};
      const q = String(pattern || req.body?.query || '').trim().toLowerCase();
      if (!q) return res.status(400).json({ ok: false, error: 'missing_pattern' });

      const wsRoot = getWorkspaceRoot();
      const rtRoot = getRuntimeRoot();

      // Résoudre le chemin de recherche (workspace ou runtime)
      let resolvedRoot;
      if (searchPath) {
        try {
          resolvedRoot = resolveWorkspacePath(wsRoot, rtRoot, searchPath);
        } catch (err) {
          return res.status(403).json({ ok: false, error: 'access_denied', message: err.message });
        }
      } else {
        resolvedRoot = wsRoot;
      }

      const maxResults = Math.min(100, Math.max(1, Number(limit || 50)));
      const matches = [];
      const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.codex-tmp', 'venv', '__pycache__']);

      function visit(dir, depth = 0) {
        if (matches.length >= maxResults || depth > 8) return;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (matches.length >= maxResults) return;
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            visit(path.join(dir, entry.name), depth + 1);
          } else if (entry.name.toLowerCase().includes(q)) {
            const full = path.join(dir, entry.name);
            matches.push({
              path: path.relative(wsRoot, full).replace(/\\/g, '/'),
              name: entry.name,
              dir: path.relative(wsRoot, dir).replace(/\\/g, '/'),
            });
          }
        }
      }

      visit(resolvedRoot);

      return res.json({ ok: true, pattern: q, count: matches.length, items: matches });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'search_failed', message: err.message });
    }
  });

  // ── POST /api/qflush/workspace/read ───────────────────────────────────────
  router.post('/workspace/read', express.json({ limit: '256kb' }), (req, res) => {
    try {
      const filePath = String(req.body?.path || '').trim();
      if (!filePath) return res.status(400).json({ ok: false, error: 'missing_path' });

      const wsRoot = getWorkspaceRoot();
      const rtRoot = getRuntimeRoot();

      let resolved;
      try {
        resolved = resolveWorkspacePath(wsRoot, rtRoot, filePath);
      } catch (err) {
        return res.status(403).json({ ok: false, error: 'access_denied', message: err.message });
      }

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ ok: false, error: 'not_found', path: filePath });
      }

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return res.status(400).json({ ok: false, error: 'is_directory', message: 'Utilise /workspace/list pour les dossiers' });
      }

      // Limiter la taille de lecture
      const maxBytes = 500 * 1024; // 500 KB
      if (stat.size > maxBytes) {
        return res.status(413).json({
          ok: false,
          error: 'file_too_large',
          size: stat.size,
          maxBytes,
          message: `Fichier trop grand (${stat.size} bytes, max ${maxBytes})`,
        });
      }

      const content = fs.readFileSync(resolved, 'utf8');
      return res.json({
        ok: true,
        path: path.relative(wsRoot, resolved).replace(/\\/g, '/'),
        size: stat.size,
        content,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'read_failed', message: err.message });
    }
  });

  // ── POST /api/qflush/workspace/list ───────────────────────────────────────
  router.post('/workspace/list', express.json({ limit: '256kb' }), (req, res) => {
    try {
      const dirPath = String(req.body?.path || '.').trim();
      const wsRoot = getWorkspaceRoot();
      const rtRoot = getRuntimeRoot();

      let resolved;
      try {
        resolved = resolveWorkspacePath(wsRoot, rtRoot, dirPath);
      } catch (err) {
        return res.status(403).json({ ok: false, error: 'access_denied', message: err.message });
      }

      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ ok: false, error: 'not_found', path: dirPath });
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return res.status(400).json({ ok: false, error: 'not_a_directory' });
      }

      const entries = fs.readdirSync(resolved, { withFileTypes: true }).map(dirent => {
        const full = path.join(resolved, dirent.name);
        let size = null, mtime = null;
        try { const s = fs.statSync(full); size = s.size; mtime = s.mtime.toISOString(); } catch {}
        return {
          name: dirent.name,
          type: dirent.isDirectory() ? 'directory' : 'file',
          path: path.relative(wsRoot, full).replace(/\\/g, '/'),
          size,
          mtime,
        };
      });

      return res.json({
        ok: true,
        path: path.relative(wsRoot, resolved).replace(/\\/g, '/') || '.',
        entries,
        total: entries.length,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'list_failed', message: err.message });
    }
  });

  return router;
}

module.exports = createQflushFlowRouter;

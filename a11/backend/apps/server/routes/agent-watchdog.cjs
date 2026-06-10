'use strict';
/**
 * Routes Watchdog — Auto-save mémoire A11 + status Cerbère
 *
 * POST /api/agent/memory/auto-save  — Déclenche un snapshot mémoire
 * GET  /api/agent/watchdog/status   — Statut du watchdog
 * GET  /api/agent/watchdog/snapshots — Liste des snapshots
 */

const path = require('node:path');
const fs = require('node:fs');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');

const RUNTIME_ROOT = getCanonicalRuntimeRoot(process.env);

const SNAPSHOTS_DIR = path.join(RUNTIME_ROOT, 'watchdog-snapshots');
const LOGS_DIR = path.join(RUNTIME_ROOT, 'logs');

// État interne du watchdog (partagé via globalThis si watchdog tourne)
function getWatchdogState() {
  return globalThis.__cerbereWatchdogState || null;
}

module.exports = function registerWatchdogRoutes({ app }) {
  /**
   * POST /api/agent/memory/auto-save
   * Déclenche un snapshot de la mémoire A11
   */
  app.post('/api/agent/memory/auto-save', async (req, res) => {
    try {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

      const snapshot = {
        savedAt: new Date().toISOString(),
        source: req.body?.source || 'api',
        trigger: req.body?.trigger || 'manual',
        server: {
          pid: process.pid,
          uptime: process.uptime(),
          memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          nodeVersion: process.version,
        },
        env: {
          nodeEnv: process.env.NODE_ENV || 'development',
          port: process.env.PORT || 3000,
          llmProvider: process.env.A11_LLM_PROVIDER || 'unknown',
          enableSd: process.env.ENABLE_SD === 'true',
          enableQflush: process.env.A11_ENABLE_QFLUSH === '1',
        },
        watchdog: getWatchdogState(),
      };

      const filename = `snapshot_${Date.now()}.json`;
      const filepath = path.join(SNAPSHOTS_DIR, filename);
      fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf8');

      // Mettre à jour le snapshot "latest"
      const latestPath = path.join(SNAPSHOTS_DIR, 'latest.json');
      fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2), 'utf8');

      // Nettoyer les vieux snapshots (garder 20)
      cleanOldSnapshots();

      console.log(`[A11][watchdog] Auto-save → ${filename}`);

      return res.json({
        ok: true,
        savedAt: snapshot.savedAt,
        filename,
        filepath,
        memoryMB: snapshot.server.memoryMB,
        uptime: snapshot.server.uptime,
      });
    } catch (err) {
      console.error('[A11][watchdog] Auto-save error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/agent/watchdog/status
   * Statut du watchdog Cerbère
   */
  app.get('/api/agent/watchdog/status', (req, res) => {
    const watchdogState = getWatchdogState();
    const latestPath = path.join(SNAPSHOTS_DIR, 'latest.json');

    let latestSnapshot = null;
    try {
      if (fs.existsSync(latestPath)) {
        latestSnapshot = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      }
    } catch {}

    return res.json({
      ok: true,
      server: {
        pid: process.pid,
        uptime: process.uptime(),
        uptimeHuman: formatUptime(process.uptime()),
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      },
      watchdog: watchdogState || {
        active: false,
        message: 'Watchdog non actif (démarré sans cerbere-watchdog.cjs)',
        tip: 'Lance avec: npm run start:watchdog',
      },
      latestSnapshot: latestSnapshot ? {
        savedAt: latestSnapshot.savedAt,
        source: latestSnapshot.source,
      } : null,
    });
  });

  /**
   * GET /api/agent/watchdog/snapshots
   * Liste des snapshots disponibles
   */
  app.get('/api/agent/watchdog/snapshots', (req, res) => {
    try {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

      const files = fs.readdirSync(SNAPSHOTS_DIR)
        .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 20);

      const snapshots = files.map(filename => {
        try {
          const content = JSON.parse(
            fs.readFileSync(path.join(SNAPSHOTS_DIR, filename), 'utf8')
          );
          return {
            filename,
            savedAt: content.savedAt,
            source: content.source,
            memoryMB: content.server?.memoryMB,
            uptime: content.server?.uptime,
          };
        } catch {
          return { filename, error: 'unreadable' };
        }
      });

      return res.json({
        ok: true,
        count: snapshots.length,
        dir: SNAPSHOTS_DIR,
        snapshots,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/agent/watchdog/logs
   * Dernières lignes du log Cerbère
   */
  app.get('/api/agent/watchdog/logs', (req, res) => {
    const lines = parseInt(req.query.lines || '50', 10);
    const logFile = path.join(LOGS_DIR, 'cerbere-watchdog.log');

    try {
      if (!fs.existsSync(logFile)) {
        return res.json({ ok: true, lines: [], message: 'Pas encore de logs Cerbère' });
      }

      const content = fs.readFileSync(logFile, 'utf8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const lastLines = allLines.slice(-lines).map(line => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });

      return res.json({
        ok: true,
        total: allLines.length,
        lines: lastLines,
        logFile,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanOldSnapshots() {
  try {
    const files = fs.readdirSync(SNAPSHOTS_DIR)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files.slice(20)) {
      fs.unlinkSync(path.join(SNAPSHOTS_DIR, file));
    }
  } catch {}
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

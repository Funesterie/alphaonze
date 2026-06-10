#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CERBÈRE WATCHDOG — "L'eau qui ranime Luffy contre Crocodile"   ║
 * ║                                                                  ║
 * ║  Surveille le backend A11 et le relance automatiquement         ║
 * ║  si il crash — comme Cerbère qui ranime A11 avec son sang.      ║
 * ║                                                                  ║
 * ║  Fonctionnalités :                                               ║
 * ║  - Watchdog : relance server.cjs si crash (max 5 tentatives)    ║
 * ║  - Auto-save : snapshot mémoire A11 toutes les 5 minutes        ║
 * ║  - Health check : vérifie /health toutes les 30 secondes        ║
 * ║  - Karma : log les crashes et résurrections                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { getCanonicalRuntimeRoot } = require('./lib/runtime-root.cjs');

const RUNTIME_ROOT = getCanonicalRuntimeRoot(process.env);

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Serveur à surveiller
  serverScript: path.resolve(__dirname, 'server.cjs'),
  serverCwd: __dirname,

  // Health check
  healthUrl: `http://127.0.0.1:${process.env.PORT || 3000}/health`,
  healthIntervalMs: 30_000,       // Vérifier toutes les 30s
  healthTimeoutMs: 5_000,         // Timeout 5s
  healthGracePeriodMs: 15_000,    // Attendre 15s après démarrage avant de checker

  // Watchdog
  maxRestarts: 10,                // Max 10 relances
  restartDelayMs: 3_000,          // Attendre 3s avant relance
  restartBackoffMs: 5_000,        // +5s par tentative (backoff)
  restartWindowMs: 60_000,        // Fenêtre de comptage des crashes (1 min)
  maxCrashesInWindow: 5,          // Max 5 crashes par minute → abandon

  // Auto-save mémoire
  autoSaveIntervalMs: 5 * 60_000, // Toutes les 5 minutes
  autoSaveDir: path.join(RUNTIME_ROOT, 'watchdog-snapshots'),

  // Logs
  logFile: path.join(RUNTIME_ROOT, 'logs/cerbere-watchdog.log'),
};

// ─── État interne ─────────────────────────────────────────────────────────────

const state = {
  serverProcess: null,
  restartCount: 0,
  crashTimestamps: [],
  isShuttingDown: false,
  startedAt: new Date().toISOString(),
  lastHealthOk: null,
  lastCrashAt: null,
  lastSaveAt: null,
  karma: 5, // Cœurs de vie (style Zelda)
};

// ─── Logging ──────────────────────────────────────────────────────────────────

function ensureLogDir() {
  try {
    fs.mkdirSync(path.dirname(CONFIG.logFile), { recursive: true });
  } catch {}
}

function log(level, msg, extra = {}) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, msg, ...extra });

  // Console avec couleurs
  const colors = {
    INFO:    '\x1b[36m',  // Cyan
    WARN:    '\x1b[33m',  // Jaune
    ERROR:   '\x1b[31m',  // Rouge
    SUCCESS: '\x1b[32m',  // Vert
    REVIVE:  '\x1b[35m',  // Magenta — résurrection !
    SAVE:    '\x1b[34m',  // Bleu — auto-save
    RESET:   '\x1b[0m',
  };
  const color = colors[level] || colors.INFO;
  console.log(`${color}[CERBÈRE][${level}] ${ts} — ${msg}\x1b[0m`);

  // Fichier log
  try {
    ensureLogDir();
    fs.appendFileSync(CONFIG.logFile, line + '\n', 'utf8');
  } catch {}
}

// ─── Auto-Save Mémoire A11 ────────────────────────────────────────────────────

async function autoSaveMemory() {
  try {
    fs.mkdirSync(CONFIG.autoSaveDir, { recursive: true });

    const snapshot = {
      savedAt: new Date().toISOString(),
      watchdog: {
        restartCount: state.restartCount,
        karma: state.karma,
        startedAt: state.startedAt,
        lastHealthOk: state.lastHealthOk,
        lastCrashAt: state.lastCrashAt,
        serverPid: state.serverProcess?.pid || null,
        serverAlive: state.serverProcess ? !state.serverProcess.killed : false,
      },
      config: {
        healthUrl: CONFIG.healthUrl,
        maxRestarts: CONFIG.maxRestarts,
        autoSaveIntervalMs: CONFIG.autoSaveIntervalMs,
      },
    };

    // Snapshot horodaté
    const filename = `snapshot_${Date.now()}.json`;
    const filepath = path.join(CONFIG.autoSaveDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), 'utf8');

    // Snapshot "latest" (écrasé à chaque fois)
    const latestPath = path.join(CONFIG.autoSaveDir, 'latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2), 'utf8');

    state.lastSaveAt = snapshot.savedAt;

    // Nettoyer les vieux snapshots (garder les 20 derniers)
    cleanOldSnapshots();

    log('SAVE', `Mémoire A11 sauvegardée → ${filename}`, {
      restartCount: state.restartCount,
      karma: state.karma,
    });

    // Appel API auto-save si le serveur tourne
    await callAutoSaveApi().catch(() => {});

  } catch (err) {
    log('WARN', `Auto-save échoué: ${err.message}`);
  }
}

async function callAutoSaveApi() {
  return new Promise((resolve) => {
    const url = new URL(CONFIG.healthUrl);
    const saveUrl = `http://${url.hostname}:${url.port}/api/agent/memory/auto-save`;

    const req = http.request(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 3000,
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(JSON.stringify({ source: 'cerbere-watchdog', ts: new Date().toISOString() }));
    req.end();
  });
}

function cleanOldSnapshots() {
  try {
    const files = fs.readdirSync(CONFIG.autoSaveDir)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .sort()
      .reverse();

    // Garder les 20 derniers
    for (const file of files.slice(20)) {
      fs.unlinkSync(path.join(CONFIG.autoSaveDir, file));
    }
  } catch {}
}

// ─── Health Check ─────────────────────────────────────────────────────────────

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(CONFIG.healthUrl, { timeout: CONFIG.healthTimeoutMs }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        resolve({ ok, status: res.statusCode, body });
      });
    });

    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

// ─── Démarrage du Serveur ─────────────────────────────────────────────────────

function startServer() {
  if (state.isShuttingDown) return;

  log('INFO', `Démarrage de server.cjs (tentative #${state.restartCount + 1})`, {
    script: CONFIG.serverScript,
  });

  const env = { ...process.env };

  const child = spawn('node', [CONFIG.serverScript], {
    cwd: CONFIG.serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  state.serverProcess = child;

  // Pipe stdout/stderr avec préfixe
  child.stdout.on('data', (data) => {
    process.stdout.write(`\x1b[90m[A11-SERVER] ${data}\x1b[0m`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`\x1b[31m[A11-SERVER][ERR] ${data}\x1b[0m`);
  });

  child.on('exit', (code, signal) => {
    if (state.isShuttingDown) return;

    state.lastCrashAt = new Date().toISOString();
    state.karma = Math.max(0, state.karma - 1); // Perte d'un cœur

    log('ERROR', `💀 A11 est tombé ! (code=${code}, signal=${signal}) — Karma: ${state.karma}/5`, {
      code,
      signal,
      restartCount: state.restartCount,
    });

    // Enregistrer le crash
    state.crashTimestamps.push(Date.now());

    // Nettoyer les vieux crashes hors fenêtre
    const windowStart = Date.now() - CONFIG.restartWindowMs;
    state.crashTimestamps = state.crashTimestamps.filter(t => t > windowStart);

    // Trop de crashes dans la fenêtre ?
    if (state.crashTimestamps.length >= CONFIG.maxCrashesInWindow) {
      log('ERROR', `🚨 ${state.crashTimestamps.length} crashes en ${CONFIG.restartWindowMs / 1000}s — Abandon !`, {
        crashes: state.crashTimestamps.length,
      });
      process.exit(1);
    }

    // Max restarts atteint ?
    if (state.restartCount >= CONFIG.maxRestarts) {
      log('ERROR', `🚨 Max restarts (${CONFIG.maxRestarts}) atteint — Abandon !`);
      process.exit(1);
    }

    // Sauvegarder avant relance
    autoSaveMemory().finally(() => {
      scheduleRestart();
    });
  });

  child.on('error', (err) => {
    log('ERROR', `Erreur de démarrage: ${err.message}`);
  });

  log('SUCCESS', `✅ A11 démarré (PID ${child.pid})`);
}

// ─── Relance avec Backoff ─────────────────────────────────────────────────────

function scheduleRestart() {
  if (state.isShuttingDown) return;

  state.restartCount++;
  const delay = CONFIG.restartDelayMs + (state.restartCount - 1) * CONFIG.restartBackoffMs;

  log('REVIVE', `🩸 CERBÈRE RANIME A11 dans ${delay / 1000}s... (comme Luffy contre Crocodile)`, {
    attempt: state.restartCount,
    delay,
    karma: state.karma,
  });

  setTimeout(() => {
    if (state.isShuttingDown) return;

    state.karma = Math.min(5, state.karma + 0.5); // Regain partiel
    log('REVIVE', `💧 A11 se relève ! Karma: ${state.karma}/5`);

    startServer();
  }, delay);
}

// ─── Boucle de Health Check ───────────────────────────────────────────────────

let healthCheckTimer = null;

function startHealthCheckLoop() {
  // Attendre la période de grâce avant le premier check
  setTimeout(() => {
    healthCheckTimer = setInterval(async () => {
      if (state.isShuttingDown) return;
      if (!state.serverProcess || state.serverProcess.killed) return;

      const result = await checkHealth();

      if (result.ok) {
        state.lastHealthOk = new Date().toISOString();
        // Log discret (pas à chaque fois)
      } else {
        log('WARN', `Health check échoué: ${result.error || result.status}`, {
          url: CONFIG.healthUrl,
        });
      }
    }, CONFIG.healthIntervalMs);
  }, CONFIG.healthGracePeriodMs);
}

// ─── Boucle d'Auto-Save ───────────────────────────────────────────────────────

function startAutoSaveLoop() {
  // Premier save après 1 minute
  setTimeout(() => {
    autoSaveMemory();

    setInterval(() => {
      autoSaveMemory();
    }, CONFIG.autoSaveIntervalMs);
  }, 60_000);
}

// ─── Arrêt Propre ─────────────────────────────────────────────────────────────

function shutdown(signal) {
  if (state.isShuttingDown) return;
  state.isShuttingDown = true;

  log('INFO', `Signal ${signal} reçu — Arrêt propre de Cerbère...`);

  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }

  if (state.serverProcess && !state.serverProcess.killed) {
    log('INFO', `Arrêt de A11 (PID ${state.serverProcess.pid})...`);
    state.serverProcess.kill('SIGTERM');

    // Force kill après 5s
    setTimeout(() => {
      if (state.serverProcess && !state.serverProcess.killed) {
        state.serverProcess.kill('SIGKILL');
      }
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// ─── Démarrage ────────────────────────────────────────────────────────────────

function main() {
  log('INFO', '═══════════════════════════════════════════════════════');
  log('INFO', '  CERBÈRE WATCHDOG — Gardien d\'A11');
  log('INFO', '  "L\'eau qui ranime Luffy contre Crocodile"');
  log('INFO', '═══════════════════════════════════════════════════════');
  log('INFO', `  Script    : ${CONFIG.serverScript}`);
  log('INFO', `  Health    : ${CONFIG.healthUrl} (/${CONFIG.healthIntervalMs / 1000}s)`);
  log('INFO', `  Auto-save : ${CONFIG.autoSaveDir} (/${CONFIG.autoSaveIntervalMs / 60000}min)`);
  log('INFO', `  Max relances : ${CONFIG.maxRestarts}`);
  log('INFO', `  Karma initial : ${state.karma}/5 ❤️`);
  log('INFO', '═══════════════════════════════════════════════════════');

  // Créer les dossiers nécessaires
  fs.mkdirSync(CONFIG.autoSaveDir, { recursive: true });
  ensureLogDir();

  // Démarrer le serveur
  startServer();

  // Démarrer les boucles
  startHealthCheckLoop();
  startAutoSaveLoop();

  log('SUCCESS', '🐺 Cerbère est en veille. A11 est protégé.');
}

main();

/**
 * Agent Shell Route — /api/agent/shell
 *
 * Permet à A11 (via MCP ou pipeline chat) d'exécuter des commandes shell
 * dans le workspace Funesterie. Protégé par JWT + liste blanche stricte.
 *
 * Sécurité :
 * - JWT requis (monté dans server.cjs via app.use('/api/agent', verifyJWT))
 * - Liste blanche de commandes autorisées (ALLOWED_COMMANDS)
 * - Timeout configurable (défaut 30s)
 * - Pas d'accès root, pas de rm -rf, pas de commandes destructives
 */

'use strict';

const express = require('express');
const { execFile, spawn } = require('node:child_process');
const path = require('node:path');

// ─── Liste blanche des commandes autorisées ──────────────────────────────────
// Clé = binaire autorisé, valeur = regex sur les args (null = tous args OK)
const ALLOWED_COMMANDS = {
  // Node / npm
  node:        null,
  npm:         /^(install|ci|run|list|outdated|audit|pack|publish|version|info|view)/,
  npx:         null,
  // Git (lecture + opérations sûres)
  git:         /^(status|log|diff|show|branch|tag|fetch|pull|clone|checkout|stash|add|commit|push|remote|describe|rev-parse|ls-files|shortlog)/,
  // Fichiers (lecture seule)
  cat:         null,
  ls:          null,
  dir:         null,
  find:        null,
  grep:        null,
  // Build / test
  tsc:         null,
  vitest:      null,
  jest:        null,
  // PowerShell / cmd utilitaires
  pwsh:        /^(-File|-Command|-c)\s/i,
  powershell:  /^(-File|-Command|-c)\s/i,
  // Utilitaires divers
  echo:        null,
  type:        null,
  ping:        /^(localhost|127\.0\.0\.1)/,
};

// Commandes explicitement interdites (même si dans la liste blanche)
const BLOCKED_PATTERNS = [
  /rm\s+-rf/i,
  /rmdir\s+\/s/i,
  /format\s+[a-z]:/i,
  /del\s+\/[sf]/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  /dd\s+if=/i,
  />\s*\/dev\/(sd|hd|nvme)/i,
  /curl.*\|\s*(bash|sh|pwsh)/i,
  /wget.*\|\s*(bash|sh|pwsh)/i,
];

function isCommandAllowed(command, args) {
  const bin = path.basename(command).replace(/\.exe$/i, '').toLowerCase();

  // Vérifier les patterns bloqués sur la commande complète
  const fullCmd = [command, ...args].join(' ');
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCmd)) return { ok: false, reason: `blocked_pattern: ${pattern}` };
  }

  // Vérifier la liste blanche
  if (!(bin in ALLOWED_COMMANDS)) {
    return { ok: false, reason: `command_not_whitelisted: ${bin}` };
  }

  const argsStr = args.join(' ');
  const argsPattern = ALLOWED_COMMANDS[bin];
  if (argsPattern && !argsPattern.test(argsStr)) {
    return { ok: false, reason: `args_not_allowed for ${bin}: ${argsStr}` };
  }

  return { ok: true };
}

function createAgentShellRouter({ workspaceRoot } = {}) {
  const router = express.Router();

  const DEFAULT_CWD = workspaceRoot || process.env.A11_WORKSPACE_ROOT || process.cwd();
  const DEFAULT_TIMEOUT = 30_000;
  const MAX_TIMEOUT = 120_000;
  const MAX_OUTPUT = 50_000; // chars

  /**
   * POST /api/agent/shell
   * Body: { command: string, args?: string[], cwd?: string, timeout?: number }
   */
  router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const rawCommand = String(req.body?.command || '').trim();
      if (!rawCommand) return res.status(400).json({ ok: false, error: 'missing_command' });

      // Parser la commande : soit tableau args, soit string à splitter
      let bin, args;
      if (Array.isArray(req.body?.args)) {
        bin = rawCommand;
        args = req.body.args.map(String);
      } else {
        // Split simple (pas de gestion des quotes complexes)
        const parts = rawCommand.split(/\s+/);
        bin = parts[0];
        args = parts.slice(1);
      }

      // Vérification liste blanche
      const check = isCommandAllowed(bin, args);
      if (!check.ok) {
        console.warn(`[AGENT-SHELL] Blocked by policy — user=${userId} reason=${check.reason}`);
        return res.status(403).json({
          ok: false,
          error: 'command_not_allowed',
          reason: check.reason,
        });
      }

      // Résoudre le cwd
      const requestedCwd = req.body?.cwd ? String(req.body.cwd).trim() : null;
      const cwd = requestedCwd
        ? path.resolve(DEFAULT_CWD, requestedCwd)
        : DEFAULT_CWD;

      // Timeout
      const timeout = Math.min(
        MAX_TIMEOUT,
        Math.max(1000, Number(req.body?.timeout || DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT)
      );

      console.info(`[AGENT-SHELL] user=${userId} cmd=${bin} args=${args.join(' ')} cwd=${cwd}`);

      // Exécution
      const result = await new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const proc = spawn(bin, args, {
          cwd,
          shell: true,
          env: { ...process.env },
          windowsHide: true,
        });

        proc.stdout.on('data', (d) => {
          stdout += d.toString();
          if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(-MAX_OUTPUT);
        });

        proc.stderr.on('data', (d) => {
          stderr += d.toString();
          if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(-MAX_OUTPUT);
        });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
        }, timeout);

        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr, timedOut });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, timedOut: false });
        });
      });

      return res.json({
        ok: result.code === 0,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        command: `${bin} ${args.join(' ')}`.trim(),
        cwd,
      });

    } catch (error) {
      console.error('[AGENT-SHELL] error:', error.message);
      return res.status(500).json({ ok: false, error: 'shell_error', message: error.message });
    }
  });

  /**
   * GET /api/agent/shell/whitelist
   * Retourne la liste des commandes autorisées
   */
  router.get('/whitelist', (req, res) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

    return res.json({
      ok: true,
      allowedCommands: Object.keys(ALLOWED_COMMANDS),
      blockedPatterns: BLOCKED_PATTERNS.map(p => p.toString()),
    });
  });

  return router;
}

module.exports = createAgentShellRouter;

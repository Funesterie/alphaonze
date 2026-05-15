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
const { runQflushFlow } = require('../qflush-integration.cjs');
const {
  getGamepadStatus,
  queueGamepadCommand,
  queueGamepadPilot,
  queueKeyboardCommand,
  queueKeyboardPilot,
  queueMouseCommand,
  readJsonlTail,
} = require('../qflush-gamepad-bus.cjs');

const logger = getLogger({ component: 'qflush-flow' });

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

function isLoopbackAddress(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === '127.0.0.1'
    || raw === '::1'
    || raw === 'localhost'
    || raw === '::ffff:127.0.0.1'
    || raw.startsWith('127.');
}

function assertLocalGamepadAccess(req) {
  if (process.env.QFLUSH_GAMEPAD_ALLOW_REMOTE === '1') return;

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
    forwardedFor,
  ];

  if (candidates.some(isLoopbackAddress)) return;

  const err = new Error('gamepad_local_only');
  err.statusCode = 403;
  throw err;
}

async function maybeDispatchGamepadFlow(payload) {
  const flow = String(process.env.QFLUSH_GAMEPAD_FLOW || '').trim();
  if (!flow) return null;
  try {
    return await runQflushFlow(flow, payload, { admin: true });
  } catch (err) {
    return {
      ok: false,
      error: 'qflush_gamepad_flow_failed',
      flow,
      message: err.message,
    };
  }
}

// ─── Router factory ───────────────────────────────────────────────────────────

const TERMINAL_HELP_LINES = [
  'Qflush portable terminal',
  'help',
  'status',
  'tail gamepad|keyboard|mouse [limit]',
  'pad <buttons> [--target romstation] [--player 1|2] [--hold 65] [--wait 0]',
  'key <buttons> [--layout azerty|wasd|numpad] [--target romstation]',
  'pilot <wake|advance_menu|demo_fight|beast_combo|safe_idle|reset_soft> [--loops 1]',
  'keyboard-pilot <intent> [--layout azerty|wasd|numpad] [--loops 1]',
  'mouse click|double_click|move [x y] [--button left|right|middle] [--mode window-normalized]',
].join('\n');

function splitTerminalCommand(value = '') {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = re.exec(String(value || ''))) !== null) {
    tokens.push(String(match[1] ?? match[2] ?? match[3] ?? '').trim());
  }
  return tokens.filter(Boolean);
}

function terminalOption(tokens = [], names = [], fallback = '') {
  const aliases = Array.isArray(names) ? names : [names];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = String(tokens[index] || '').trim();
    for (const name of aliases) {
      const flag = `--${name}`;
      if (token === flag) return String(tokens[index + 1] || fallback).trim();
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1).trim();
    }
  }
  return fallback;
}

function terminalArgsBeforeFlags(tokens = []) {
  const args = [];
  for (const token of tokens) {
    if (String(token || '').startsWith('--')) break;
    args.push(token);
  }
  return args;
}

function summarizeTail(kind, items = []) {
  if (!items.length) return `${kind}: aucun evenement recent.`;
  return items.map((item, index) => {
    const label = item.rawButtons || item.rawKeys || item.action || item.intent || item.id || 'event';
    const at = item.at ? String(item.at) : 'no-date';
    return `${index + 1}. ${at} ${label}`;
  }).join('\n');
}

async function runQflushTerminalCommand(commandLine = '', { runtimeRoot }) {
  const command = String(commandLine || '').trim();
  if (!command) {
    return { ok: false, error: 'missing_command', output: TERMINAL_HELP_LINES };
  }

  const tokens = splitTerminalCommand(command);
  const verb = String(tokens[0] || '').toLowerCase();
  const rest = tokens.slice(1);
  const status = () => getGamepadStatus(runtimeRoot);

  if (['help', '?', 'h'].includes(verb)) {
    return { ok: true, mode: 'help', output: TERMINAL_HELP_LINES };
  }

  if (['status', 'st'].includes(verb) || (verb === 'gamepad' && String(rest[0] || '').toLowerCase() === 'status')) {
    const payload = status();
    return {
      ok: true,
      mode: 'status',
      output: [
        `target: ${payload.targetDefault}`,
        `buttons: ${payload.allowedButtons.join(', ')}`,
        `intents: ${payload.intents.join(', ')}`,
        `bus: ${payload.files.busDir}`,
      ].join('\n'),
      payload,
    };
  }

  if (['tail', 'logs', 'log'].includes(verb)) {
    const kind = String(rest[0] || 'gamepad').toLowerCase();
    const limit = Number(rest[1] || terminalOption(rest, ['limit', 'n'], '20')) || 20;
    const files = status().files;
    const file = kind === 'keyboard'
      ? files.keyboardCommands
      : (kind === 'mouse' ? files.mouseCommands : files.gamepadCommands);
    const items = readJsonlTail(file, limit);
    return {
      ok: true,
      mode: 'tail',
      kind,
      output: summarizeTail(kind, items),
      items,
      file,
    };
  }

  if (['pad', 'gamepad', 'press'].includes(verb)) {
    const effectiveRest = verb === 'gamepad' && String(rest[0] || '').toLowerCase() === 'press'
      ? rest.slice(1)
      : rest;
    const buttonArgs = terminalArgsBeforeFlags(effectiveRest);
    const result = queueGamepadCommand({
      buttons: buttonArgs.join(' '),
      target: terminalOption(rest, ['target', 't'], 'romstation'),
      player: terminalOption(rest, ['player', 'p'], '1'),
      holdMs: terminalOption(rest, ['hold', 'hold-ms'], '65'),
      waitMs: terminalOption(rest, ['wait', 'wait-ms'], '0'),
      from: 'qflush-terminal',
      note: `portable terminal: ${command.slice(0, 120)}`,
    }, { runtimeRoot });
    const flowResult = await maybeDispatchGamepadFlow(result.command);
    return {
      ok: true,
      mode: 'gamepad_command',
      output: `queued gamepad: ${result.command.rawButtons} -> ${result.command.target}`,
      result: { ...result, flowResult },
    };
  }

  if (['key', 'keys', 'keyboard'].includes(verb)) {
    const effectiveRest = verb === 'keyboard' && String(rest[0] || '').toLowerCase() === 'press'
      ? rest.slice(1)
      : rest;
    const keyArgs = terminalArgsBeforeFlags(effectiveRest);
    const result = queueKeyboardCommand({
      buttons: keyArgs.join(' '),
      layout: terminalOption(rest, ['layout', 'l'], 'azerty'),
      target: terminalOption(rest, ['target', 't'], 'romstation'),
      player: terminalOption(rest, ['player', 'p'], '1'),
      holdMs: terminalOption(rest, ['hold', 'hold-ms'], '55'),
      waitMs: terminalOption(rest, ['wait', 'wait-ms'], '0'),
      from: 'qflush-terminal',
      note: `portable terminal: ${command.slice(0, 120)}`,
    }, { runtimeRoot });
    const flowResult = await maybeDispatchGamepadFlow(result.command);
    return {
      ok: true,
      mode: 'keyboard_command',
      output: `queued keyboard: ${result.command.rawKeys} (${result.command.layout})`,
      result: { ...result, flowResult },
    };
  }

  if (verb === 'pilot') {
    const intent = String(rest[0] || 'demo_fight').trim();
    const result = queueGamepadPilot({
      intent,
      loops: terminalOption(rest, ['loops', 'loop'], '1'),
      target: terminalOption(rest, ['target', 't'], 'romstation'),
      player: terminalOption(rest, ['player', 'p'], '1'),
      from: 'qflush-terminal',
    }, { runtimeRoot });
    const flowResult = await maybeDispatchGamepadFlow({
      schema: 'funesterie.gamepad_pilot.v1',
      intent: result.intent,
      plan: result.plan,
      queued: result.queued,
    });
    return {
      ok: true,
      mode: 'gamepad_pilot',
      output: `queued pilot: ${result.intent} (${result.queued.length} steps)`,
      result: { ...result, flowResult },
    };
  }

  if (verb === 'keyboard-pilot' || verb === 'key-pilot') {
    const intent = String(rest[0] || 'demo_fight').trim();
    const result = queueKeyboardPilot({
      intent,
      loops: terminalOption(rest, ['loops', 'loop'], '1'),
      layout: terminalOption(rest, ['layout', 'l'], 'azerty'),
      target: terminalOption(rest, ['target', 't'], 'romstation'),
      player: terminalOption(rest, ['player', 'p'], '1'),
      from: 'qflush-terminal',
    }, { runtimeRoot });
    const flowResult = await maybeDispatchGamepadFlow({
      schema: 'funesterie.keyboard_pilot.v1',
      intent: result.intent,
      layout: result.layout,
      plan: result.plan,
      queued: result.queued,
    });
    return {
      ok: true,
      mode: 'keyboard_pilot',
      output: `queued keyboard pilot: ${result.intent} (${result.queued.length} steps, ${result.layout})`,
      result: { ...result, flowResult },
    };
  }

  if (verb === 'mouse') {
    const action = String(rest[0] || 'click').trim();
    const numericArgs = rest.slice(1).filter((entry) => /^-?\d+(?:\.\d+)?$/.test(String(entry || ''))).slice(0, 2);
    const result = queueMouseCommand({
      action,
      x: numericArgs[0] ?? terminalOption(rest, ['x'], '0.5'),
      y: numericArgs[1] ?? terminalOption(rest, ['y'], '0.5'),
      button: terminalOption(rest, ['button', 'b'], 'left'),
      coordinateMode: terminalOption(rest, ['mode', 'coordinate-mode'], 'window-normalized'),
      target: terminalOption(rest, ['target', 't'], 'romstation'),
      from: 'qflush-terminal',
      note: `portable terminal: ${command.slice(0, 120)}`,
    }, { runtimeRoot });
    const flowResult = await maybeDispatchGamepadFlow(result.command);
    return {
      ok: true,
      mode: 'mouse_command',
      output: `queued mouse: ${result.command.action} ${result.command.button} @ ${result.command.x},${result.command.y}`,
      result: { ...result, flowResult },
    };
  }

  if (verb === 'json') {
    const payload = status();
    return {
      ok: true,
      mode: 'json_status',
      output: JSON.stringify(payload, null, 2),
      payload,
    };
  }

  return {
    ok: false,
    error: 'unknown_terminal_command',
    command,
    output: `Commande inconnue: ${verb}\n\n${TERMINAL_HELP_LINES}`,
  };
}

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
    const qflushAvailable = Boolean(
      globalThis.__QFLUSH_AVAILABLE
      || process.env.QFLUSH_URL
      || process.env.QFLUSH_REMOTE_URL
      || process.env.QFLUSH_BASE_URL
      || process.env.QFLUSH_MODULE_DIR
    );

    return res.json({
      ok: true,
      qflushAvailable,
      qflushError: qflushAvailable ? null : 'qflush_not_configured',
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
  router.get('/terminal/status', (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const gamepad = getGamepadStatus(getRuntimeRoot());
      return res.json({
        ok: true,
        terminal: {
          name: 'Qflush portable terminal',
          shell: false,
          localOnly: process.env.QFLUSH_GAMEPAD_ALLOW_REMOTE !== '1',
          help: TERMINAL_HELP_LINES,
        },
        gamepad,
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
  });

  router.post('/terminal/run', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const command = String(req.body?.command || req.body?.input || '').trim();
      const result = await runQflushTerminalCommand(command, {
        runtimeRoot: getRuntimeRoot(),
      });
      return res.status(result.ok === false ? 400 : 200).json({
        command,
        ...result,
      });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

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

      const result = await runQflushFlow(normalizedFlow, payload || {}, { admin: false });

      logger.info('Qflush flow executed', { flow: normalizedFlow, ok: result?.ok });
      return res.json(result);

    } catch (err) {
      logger.error('Qflush run error', { error: err.message });
      if (
        err.message.includes('runFlow non disponible')
        || err.message.includes('non trouvé')
        || err.message.includes('compatible module')
      ) {
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

      const result = await runQflushFlow(normalizedFlow, payload || {}, { admin: true });

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
      const result = await runQflushFlow('a11.memory.ephemeral.v1', req.body || {}, { admin: true });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'ephemeral_memory_failed', message: err.message });
    }
  });

  // ── GET /api/qflush/memory/ephemeral/list ─────────────────────────────────
  router.get('/memory/ephemeral/list', async (req, res) => {
    try {
      const result = await runQflushFlow('a11.memory.ephemeral.v1', {
        op: 'list',
        namespace: req.query?.namespace,
        scope: req.query?.scope,
        prefix: req.query?.prefix,
        limit: req.query?.limit ? Number(req.query.limit) : undefined,
      }, { admin: true });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'ephemeral_list_failed', message: err.message });
    }
  });

  // ── POST /api/qflush/workspace/search ─────────────────────────────────────
  // Recherche dans tout le workspace (pas seulement le runtime)
  // -- Qflush virtual gamepad -------------------------------------------------
  // Local-only control plane for demo/game automation. The route writes bounded
  // append-only commands to the agent bus; the ViGEm bridge consumes them.
  router.get('/gamepad/status', (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      return res.json(getGamepadStatus(getRuntimeRoot()));
    } catch (err) {
      return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
  });

  router.get('/gamepad/commands', (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const status = getGamepadStatus(getRuntimeRoot());
      const limit = req.query?.limit ? Number(req.query.limit) : 50;
      return res.json({
        ok: true,
        file: status.files.gamepadCommands,
        items: readJsonlTail(status.files.gamepadCommands, limit),
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
  });

  router.post('/gamepad/command', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const result = queueGamepadCommand(req.body || {}, { runtimeRoot: getRuntimeRoot() });
      const flowResult = await maybeDispatchGamepadFlow(result.command);
      logger.info('Qflush gamepad command queued', {
        target: result.command.target,
        player: result.command.player,
        buttons: result.command.rawButtons,
        legacy: Boolean(result.legacy),
      });
      return res.json({ ...result, flowResult });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.post('/gamepad/pilot', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const result = queueGamepadPilot(req.body || {}, { runtimeRoot: getRuntimeRoot() });
      const flowResult = await maybeDispatchGamepadFlow({
        schema: 'funesterie.gamepad_pilot.v1',
        intent: result.intent,
        plan: result.plan,
        queued: result.queued,
      });
      logger.info('Qflush gamepad pilot queued', {
        intent: result.intent,
        count: result.queued.length,
        legacyCount: result.legacyQueued.length,
      });
      return res.json({ ...result, flowResult });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.get('/gamepad/keyboard/commands', (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const status = getGamepadStatus(getRuntimeRoot());
      const limit = req.query?.limit ? Number(req.query.limit) : 50;
      return res.json({
        ok: true,
        file: status.files.keyboardCommands,
        items: readJsonlTail(status.files.keyboardCommands, limit),
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
  });

  router.post('/gamepad/keyboard/command', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const result = queueKeyboardCommand(req.body || {}, { runtimeRoot: getRuntimeRoot() });
      const flowResult = await maybeDispatchGamepadFlow(result.command);
      logger.info('Qflush keyboard command queued', {
        target: result.command.target,
        layout: result.command.layout,
        player: result.command.player,
        keys: result.command.rawKeys,
      });
      return res.json({ ...result, flowResult });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.post('/gamepad/keyboard/pilot', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const result = queueKeyboardPilot(req.body || {}, { runtimeRoot: getRuntimeRoot() });
      const flowResult = await maybeDispatchGamepadFlow({
        schema: 'funesterie.keyboard_pilot.v1',
        intent: result.intent,
        layout: result.layout,
        plan: result.plan,
        queued: result.queued,
      });
      logger.info('Qflush keyboard pilot queued', {
        intent: result.intent,
        layout: result.layout,
        count: result.queued.length,
      });
      return res.json({ ...result, flowResult });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.get('/mouse/commands', (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const status = getGamepadStatus(getRuntimeRoot());
      const limit = req.query?.limit ? Number(req.query.limit) : 50;
      return res.json({
        ok: true,
        file: status.files.mouseCommands,
        items: readJsonlTail(status.files.mouseCommands, limit),
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
    }
  });

  router.post('/mouse/command', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const result = queueMouseCommand(req.body || {}, { runtimeRoot: getRuntimeRoot() });
      const flowResult = await maybeDispatchGamepadFlow(result.command);
      logger.info('Qflush mouse command queued', {
        target: result.command.target,
        action: result.command.action,
        button: result.command.button,
        coordinateMode: result.command.coordinateMode,
        x: result.command.x,
        y: result.command.y,
      });
      return res.json({ ...result, flowResult });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.post('/mouse/click', express.json({ limit: '128kb' }), async (req, res) => {
    try {
      assertLocalGamepadAccess(req);
      const result = queueMouseCommand({ ...(req.body || {}), action: req.body?.action || 'click' }, { runtimeRoot: getRuntimeRoot() });
      const flowResult = await maybeDispatchGamepadFlow(result.command);
      return res.json({ ...result, flowResult });
    } catch (err) {
      const status = err.statusCode || (err.message === 'gamepad_local_only' ? 403 : 400);
      return res.status(status).json({ ok: false, error: err.message });
    }
  });

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

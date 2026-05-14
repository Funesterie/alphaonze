'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GAMEPAD_SCHEMA = 'funesterie.gamepad_command.v1';
const KEYBOARD_SCHEMA = 'funesterie.keyboard_command.v1';
const MOUSE_SCHEMA = 'funesterie.mouse_command.v1';
const LEGACY_BR_SCHEMA = 'funesterie.br_play.v1';
const DEFAULT_TARGET = 'romstation';

const KEYBOARD_LAYOUTS = {
  'bloody-roar-keyboard-azerty': {
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    a: 'A',
    b: 'Z',
    x: 'E',
    y: 'R',
    z: 'S',
    l: 'D',
    r: 'F',
    start: 'Enter',
    select: 'Backspace',
  },
  'bloody-roar-keyboard-wasd': {
    up: 'W',
    down: 'S',
    left: 'A',
    right: 'D',
    a: 'J',
    b: 'K',
    x: 'U',
    y: 'I',
    z: 'O',
    l: 'Q',
    r: 'E',
    start: 'Enter',
    select: 'Backspace',
  },
  'bloody-roar-keyboard-numpad': {
    up: 'Numpad8',
    down: 'Numpad5',
    left: 'Numpad4',
    right: 'Numpad6',
    a: 'Numpad1',
    b: 'Numpad2',
    x: 'Numpad7',
    y: 'Numpad9',
    z: 'Numpad3',
    l: 'Numpad0',
    r: 'NumpadDecimal',
    start: 'Enter',
    select: 'Backspace',
  },
};

const KEYBOARD_LAYOUT_ALIASES = new Map([
  ['br-azerty', 'bloody-roar-keyboard-azerty'],
  ['azerty', 'bloody-roar-keyboard-azerty'],
  ['br-wasd', 'bloody-roar-keyboard-wasd'],
  ['wasd', 'bloody-roar-keyboard-wasd'],
  ['br-numpad', 'bloody-roar-keyboard-numpad'],
  ['numpad', 'bloody-roar-keyboard-numpad'],
]);

const BUTTON_ALIASES = new Map([
  ['arrowup', 'up'],
  ['arrowdown', 'down'],
  ['arrowleft', 'left'],
  ['arrowright', 'right'],
  ['dpadup', 'up'],
  ['dpaddown', 'down'],
  ['dpadleft', 'left'],
  ['dpadright', 'right'],
  ['confirm', 'a'],
  ['cancel', 'b'],
  ['beast', 'r'],
  ['guard', 'z'],
  ['lb', 'l'],
  ['lt', 'l'],
  ['rb', 'z'],
  ['rt', 'r'],
  ['back', 'select'],
  ['menu', 'start'],
]);

const ALLOWED_BUTTONS = new Set([
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'x',
  'y',
  'z',
  'l',
  'r',
  'start',
  'select',
]);

const BLOODY_ROAR_BUTTONS = new Set([
  'up',
  'down',
  'left',
  'right',
  'a',
  'b',
  'x',
  'y',
  'z',
  'l',
  'r',
  'start',
]);

const PILOT_PLANS = {
  wake: [
    { buttons: 'start', waitMs: 500, note: 'wake title/menu' },
    { buttons: 'a', waitMs: 650, note: 'confirm current screen' },
  ],
  advance_menu: [
    { buttons: 'start', waitMs: 650, note: 'start from title' },
    { buttons: 'a', waitMs: 650, note: 'confirm menu item' },
    { buttons: 'right', waitMs: 260, note: 'move selection' },
    { buttons: 'a', waitMs: 900, note: 'confirm selection' },
  ],
  demo_fight: [
    { buttons: 'right', waitMs: 90, note: 'walk forward' },
    { buttons: 'right a', waitMs: 160, note: 'poke while advancing' },
    { buttons: 'b', waitMs: 140, note: 'secondary strike' },
    { buttons: 'x', waitMs: 150, note: 'heavy strike' },
    { buttons: 'r', waitMs: 180, note: 'beast/trigger action' },
    { buttons: 'left b', waitMs: 150, note: 'retreat counter' },
    { buttons: 'down a', waitMs: 160, note: 'low attack' },
    { buttons: 'z', waitMs: 180, note: 'guard/grab variant' },
  ],
  beast_combo: [
    { buttons: 'r', waitMs: 180, note: 'beast/trigger action' },
    { buttons: 'x', waitMs: 140, note: 'heavy strike' },
    { buttons: 'y', waitMs: 140, note: 'alternate strike' },
    { buttons: 'right a', waitMs: 170, note: 'forward hit' },
    { buttons: 'b', waitMs: 160, note: 'finisher tap' },
  ],
  safe_idle: [],
  reset_soft: [
    { buttons: 'start', waitMs: 450, note: 'pause/toggle menu' },
    { buttons: 'start', waitMs: 450, note: 'return/toggle menu' },
    { buttons: 'a', waitMs: 450, note: 'confirm if needed' },
  ],
};

function safeId(value, fallback = 'unknown') {
  const id = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9_.:-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return id || fallback;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function getGamepadBusDir(runtimeRoot) {
  const configured = process.env.QFLUSH_GAMEPAD_BUS_DIR
    || process.env.AGENT_STATE_DIR
    || process.env.A11_AGENT_BUS_DIR;

  if (configured) return path.resolve(configured);

  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) return path.join(home, 'OneDrive', 'a11_memory', 'agent-bus');

  return path.join(runtimeRoot || process.cwd(), 'agent-bus');
}

function getGamepadFiles(runtimeRoot) {
  const busDir = getGamepadBusDir(runtimeRoot);
  return {
    busDir,
    gamepadCommands: path.join(busDir, 'gamepad-commands.jsonl'),
    keyboardCommands: path.join(busDir, 'keyboard-commands.jsonl'),
    mouseCommands: path.join(busDir, 'mouse-commands.jsonl'),
    bloodyRoarCommands: path.join(busDir, 'br-commands.jsonl'),
  };
}

function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function normalizeButtons(value) {
  const raw = Array.isArray(value) ? value.join(' ') : String(value || '');
  const tokens = raw
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => BUTTON_ALIASES.get(token) || token);

  if (tokens.length === 0) throw new Error('buttons is empty.');
  if (tokens.length > 6) throw new Error(`max 6 buttons per command, got ${tokens.length}.`);

  for (const button of tokens) {
    if (!ALLOWED_BUTTONS.has(button)) {
      throw new Error(`Button "${button}" is not allowed. Allowed: ${[...ALLOWED_BUTTONS].join(', ')}.`);
    }
  }

  return tokens;
}

function isBloodyRoarTarget(target) {
  const normalized = String(target || '').trim().toLowerCase();
  return normalized === 'bloody-roar-extreme'
    || normalized === 'bloody-roar'
    || normalized === 'br'
    || normalized === 'romstation-bloody-roar';
}

function buildGamepadCommand(input = {}) {
  const at = new Date().toISOString();
  const buttons = normalizeButtons(input.buttons ?? input.keys ?? input.rawButtons ?? input.rawKeys);
  const target = safeId(input.target || DEFAULT_TARGET, DEFAULT_TARGET).toLowerCase();
  const player = Number(input.player) === 2 ? 2 : 1;

  return {
    schema: GAMEPAD_SCHEMA,
    id: `pad-${at.replace(/[:.]/g, '')}-${crypto.randomUUID().slice(0, 8)}`,
    at,
    from: safeId(input.from || 'qflush'),
    target,
    route: safeId(input.route || 'qflush.gamepad.v1', 'qflush.gamepad.v1'),
    controller: safeId(input.controller || 'xbox360', 'xbox360'),
    player,
    buttons,
    rawButtons: buttons.join(' '),
    holdMs: clampInt(input.holdMs, 65, 15, 500),
    waitMs: clampInt(input.waitMs, 0, 0, 3000),
    note: input.note ? String(input.note).trim().slice(0, 160) : undefined,
    appendOnly: true,
    consumed: false,
  };
}

function normalizeKeyboardLayout(value) {
  const raw = safeId(value || 'azerty', 'azerty').toLowerCase();
  const layout = KEYBOARD_LAYOUT_ALIASES.get(raw) || raw;
  if (!Object.prototype.hasOwnProperty.call(KEYBOARD_LAYOUTS, layout)) {
    throw new Error(`Unknown keyboard layout "${value}". Available: ${Object.keys(KEYBOARD_LAYOUTS).join(', ')}.`);
  }
  return layout;
}

function buildKeyboardCommand(input = {}) {
  const at = new Date().toISOString();
  const buttons = normalizeButtons(input.buttons ?? input.keys ?? input.rawButtons ?? input.rawKeys);
  const layout = normalizeKeyboardLayout(input.layout);
  const mapping = KEYBOARD_LAYOUTS[layout];
  const target = safeId(input.target || DEFAULT_TARGET, DEFAULT_TARGET).toLowerCase();
  const keyboardKeys = buttons.map((button) => mapping[button]);

  if (keyboardKeys.some((key) => !key)) {
    throw new Error(`Keyboard layout "${layout}" cannot map every button in "${buttons.join(' ')}".`);
  }

  return {
    schema: KEYBOARD_SCHEMA,
    id: `kbd-${at.replace(/[:.]/g, '')}-${crypto.randomUUID().slice(0, 8)}`,
    at,
    from: safeId(input.from || 'qflush'),
    target,
    route: safeId(input.route || 'qflush.keyboard.v1', 'qflush.keyboard.v1'),
    layout,
    targetWindow: String(input.targetWindow || process.env.QFLUSH_KEYBOARD_TARGET_WINDOW || 'RomStation').slice(0, 120),
    player: Number(input.player) === 2 ? 2 : 1,
    sourceButtons: buttons,
    keys: keyboardKeys,
    rawKeys: keyboardKeys.join(' '),
    holdMs: clampInt(input.holdMs, 55, 15, 500),
    waitMs: clampInt(input.waitMs, 0, 0, 3000),
    note: input.note ? String(input.note).trim().slice(0, 160) : undefined,
    appendOnly: true,
    consumed: false,
  };
}

function toLegacyBloodyRoarCommand(command) {
  const keys = command.buttons.filter((button) => BLOODY_ROAR_BUTTONS.has(button));
  if (keys.length === 0) return null;

  return {
    schema: LEGACY_BR_SCHEMA,
    id: `${command.id}-br`,
    at: command.at,
    from: command.from,
    player: command.player,
    keys,
    rawKeys: keys.join(' '),
    holdMs: command.holdMs,
    waitMs: command.waitMs,
    note: command.note || `qflush gamepad -> ${command.target}`,
    consumed: false,
  };
}

function queueGamepadCommand(input = {}, options = {}) {
  const files = getGamepadFiles(options.runtimeRoot);
  const command = buildGamepadCommand(input);
  appendJsonl(files.gamepadCommands, command);

  let legacy = null;
  if (isBloodyRoarTarget(command.target)) {
    legacy = toLegacyBloodyRoarCommand(command);
    if (legacy) appendJsonl(files.bloodyRoarCommands, legacy);
  }

  return {
    ok: true,
    command,
    legacy,
    files,
  };
}

function queueKeyboardCommand(input = {}, options = {}) {
  const files = getGamepadFiles(options.runtimeRoot);
  const command = buildKeyboardCommand(input);
  appendJsonl(files.keyboardCommands, command);

  return {
    ok: true,
    command,
    files,
  };
}

function repeatPlan(steps, loops) {
  const count = clampInt(loops, 1, 1, 5);
  return Array.from({ length: count }, () => steps).flat();
}

function buildGamepadPilotPlan(intent = 'auto', loops = 1) {
  const normalized = String(intent || 'auto').trim().toLowerCase();
  const effective = normalized === 'auto' ? 'demo_fight' : normalized;
  if (!Object.prototype.hasOwnProperty.call(PILOT_PLANS, effective)) {
    throw new Error(`Unknown gamepad intent "${intent}".`);
  }
  if (effective === 'demo_fight' || effective === 'beast_combo') {
    return repeatPlan(PILOT_PLANS[effective], loops);
  }
  return [...PILOT_PLANS[effective]];
}

function queueGamepadPilot(input = {}, options = {}) {
  const plan = buildGamepadPilotPlan(input.intent || 'auto', input.loops || 1);
  const queued = plan.map((step) => queueGamepadCommand({
    ...input,
    buttons: step.buttons,
    waitMs: step.waitMs,
    note: `${input.intent || 'auto'}: ${step.note}`,
  }, options));

  return {
    ok: true,
    intent: String(input.intent || 'auto'),
    plan,
    queued: queued.map((item) => item.command),
    legacyQueued: queued.map((item) => item.legacy).filter(Boolean),
    files: queued[0]?.files || getGamepadFiles(options.runtimeRoot),
  };
}

function queueKeyboardPilot(input = {}, options = {}) {
  const plan = buildGamepadPilotPlan(input.intent || 'auto', input.loops || 1);
  const queued = plan.map((step) => queueKeyboardCommand({
    ...input,
    buttons: step.buttons,
    waitMs: step.waitMs,
    note: `${input.intent || 'auto'}: ${step.note}`,
  }, options));

  return {
    ok: true,
    intent: String(input.intent || 'auto'),
    layout: normalizeKeyboardLayout(input.layout),
    plan,
    queued: queued.map((item) => item.command),
    files: queued[0]?.files || getGamepadFiles(options.runtimeRoot),
  };
}

function normalizeMouseAction(value) {
  const action = safeId(value || 'click', 'click').toLowerCase();
  if (!['click', 'double_click', 'move'].includes(action)) {
    throw new Error('mouse action must be click, double_click, or move.');
  }
  return action;
}

function normalizeMouseButton(value) {
  const button = safeId(value || 'left', 'left').toLowerCase();
  if (!['left', 'right', 'middle'].includes(button)) {
    throw new Error('mouse button must be left, right, or middle.');
  }
  return button;
}

function normalizeMouseCoordinateMode(value) {
  const mode = safeId(value || 'window-normalized', 'window-normalized').toLowerCase();
  if (mode === 'absolute-screen' && process.env.QFLUSH_MOUSE_ALLOW_ABSOLUTE !== '1') {
    throw new Error('absolute-screen mouse mode is disabled. Use window-normalized or window-pixels.');
  }
  if (!['window-normalized', 'window-pixels', 'absolute-screen'].includes(mode)) {
    throw new Error('coordinateMode must be window-normalized, window-pixels, or absolute-screen.');
  }
  return mode;
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function buildMouseCommand(input = {}) {
  const at = new Date().toISOString();
  const action = normalizeMouseAction(input.action);
  const coordinateMode = normalizeMouseCoordinateMode(input.coordinateMode);
  const target = safeId(input.target || DEFAULT_TARGET, DEFAULT_TARGET).toLowerCase();
  const xRaw = input.xPct ?? input.x;
  const yRaw = input.yPct ?? input.y;
  const maxCoord = coordinateMode === 'window-normalized' ? 1 : 10000;

  return {
    schema: MOUSE_SCHEMA,
    id: `mouse-${at.replace(/[:.]/g, '')}-${crypto.randomUUID().slice(0, 8)}`,
    at,
    from: safeId(input.from || 'qflush'),
    target,
    route: safeId(input.route || 'qflush.mouse.v1', 'qflush.mouse.v1'),
    action,
    button: normalizeMouseButton(input.button),
    targetWindow: String(input.targetWindow || process.env.QFLUSH_MOUSE_TARGET_WINDOW || 'RomStation').slice(0, 120),
    coordinateMode,
    x: clampNumber(xRaw, 0.5, 0, maxCoord),
    y: clampNumber(yRaw, 0.5, 0, maxCoord),
    clicks: action === 'double_click' ? 2 : clampInt(input.clicks, 1, 1, 2),
    holdMs: clampInt(input.holdMs, 35, 10, 500),
    waitMs: clampInt(input.waitMs, 0, 0, 3000),
    note: input.note ? String(input.note).trim().slice(0, 160) : undefined,
    appendOnly: true,
    consumed: false,
  };
}

function queueMouseCommand(input = {}, options = {}) {
  const files = getGamepadFiles(options.runtimeRoot);
  const command = buildMouseCommand(input);
  appendJsonl(files.mouseCommands, command);

  return {
    ok: true,
    command,
    files,
  };
}

function readJsonlTail(file, limit = 50) {
  if (!fs.existsSync(file)) return [];
  const max = clampInt(limit, 50, 1, 200);
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean).slice(-max);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parseError: true, line: line.slice(0, 500) };
    }
  });
}

function getGamepadStatus(runtimeRoot) {
  const files = getGamepadFiles(runtimeRoot);
  return {
    ok: true,
    schema: GAMEPAD_SCHEMA,
    keyboardSchema: KEYBOARD_SCHEMA,
    mouseSchema: MOUSE_SCHEMA,
    targetDefault: DEFAULT_TARGET,
    allowedButtons: [...ALLOWED_BUTTONS],
    keyboardLayouts: KEYBOARD_LAYOUTS,
    keyboardLayoutAliases: Object.fromEntries(KEYBOARD_LAYOUT_ALIASES),
    recommendedKeyboardLayouts: Object.keys(KEYBOARD_LAYOUTS),
    mouseActions: ['click', 'double_click', 'move'],
    mouseButtons: ['left', 'right', 'middle'],
    mouseCoordinateModes: ['window-normalized', 'window-pixels'],
    intents: ['auto', ...Object.keys(PILOT_PLANS)],
    files,
    recent: readJsonlTail(files.gamepadCommands, 10),
    recentKeyboard: readJsonlTail(files.keyboardCommands, 10),
    recentMouse: readJsonlTail(files.mouseCommands, 10),
  };
}

module.exports = {
  GAMEPAD_SCHEMA,
  KEYBOARD_SCHEMA,
  MOUSE_SCHEMA,
  queueGamepadCommand,
  queueGamepadPilot,
  queueKeyboardCommand,
  queueKeyboardPilot,
  queueMouseCommand,
  getGamepadStatus,
  readJsonlTail,
};

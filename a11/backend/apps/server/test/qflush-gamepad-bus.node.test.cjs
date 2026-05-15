const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  queueGamepadCommand,
  queueGamepadPilot,
  getGamepadStatus,
  readJsonlTail,
} = require('../src/qflush-gamepad-bus.cjs');

function withTempRuntime(fn) {
  const previous = {
    QFLUSH_GAMEPAD_BUS_DIR: process.env.QFLUSH_GAMEPAD_BUS_DIR,
    AGENT_STATE_DIR: process.env.AGENT_STATE_DIR,
    A11_AGENT_BUS_DIR: process.env.A11_AGENT_BUS_DIR,
  };

  delete process.env.QFLUSH_GAMEPAD_BUS_DIR;
  delete process.env.AGENT_STATE_DIR;
  delete process.env.A11_AGENT_BUS_DIR;

  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qflush-gamepad-'));
  process.env.QFLUSH_GAMEPAD_BUS_DIR = path.join(runtimeRoot, 'agent-bus');
  try {
    return fn(runtimeRoot);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

test('queueGamepadCommand writes generic and Bloody Roar compatibility commands', () => withTempRuntime((runtimeRoot) => {
  const result = queueGamepadCommand({
    from: 'codex',
    target: 'bloody-roar-extreme',
    player: 2,
    buttons: 'arrowright confirm',
    holdMs: 80,
    waitMs: 160,
    note: 'test poke',
  }, { runtimeRoot });

  assert.equal(result.ok, true);
  assert.deepEqual(result.command.buttons, ['right', 'a']);
  assert.equal(result.command.player, 2);
  assert.equal(result.command.holdMs, 80);
  assert.equal(result.legacy.schema, 'funesterie.br_play.v1');
  assert.deepEqual(result.legacy.keys, ['right', 'a']);

  const genericItems = readJsonlTail(result.files.gamepadCommands, 10);
  const legacyItems = readJsonlTail(result.files.bloodyRoarCommands, 10);

  assert.equal(genericItems.length, 1);
  assert.equal(legacyItems.length, 1);
  assert.equal(genericItems[0].schema, 'funesterie.gamepad_command.v1');
  assert.equal(legacyItems[0].schema, 'funesterie.br_play.v1');
}));

test('queueGamepadCommand writes only generic commands for non-Bloody-Roar targets', () => withTempRuntime((runtimeRoot) => {
  const result = queueGamepadCommand({
    from: 'a11',
    target: 'qflush-demo-pad',
    buttons: 'left b',
  }, { runtimeRoot });

  assert.equal(result.ok, true);
  assert.equal(result.legacy, null);
  assert.equal(readJsonlTail(result.files.gamepadCommands, 10).length, 1);
  assert.equal(readJsonlTail(result.files.bloodyRoarCommands, 10).length, 0);
}));

test('queueGamepadCommand rejects invalid or oversized button commands', () => withTempRuntime((runtimeRoot) => {
  assert.throws(
    () => queueGamepadCommand({ from: 'codex', buttons: 'left turbo' }, { runtimeRoot }),
    /not allowed/
  );

  assert.throws(
    () => queueGamepadCommand({ from: 'codex', buttons: 'up down left right a b x' }, { runtimeRoot }),
    /max 6 buttons/
  );
}));

test('queueGamepadPilot queues bounded intent plans and exposes status', () => withTempRuntime((runtimeRoot) => {
  const result = queueGamepadPilot({
    from: 'grok',
    target: 'bloody-roar-extreme',
    intent: 'beast_combo',
    loops: 2,
  }, { runtimeRoot });

  assert.equal(result.ok, true);
  assert.equal(result.intent, 'beast_combo');
  assert.equal(result.queued.length, 10);
  assert.equal(result.legacyQueued.length, 10);

  const status = getGamepadStatus(runtimeRoot);
  assert.equal(status.ok, true);
  assert.equal(status.recent.length, 10);
  assert.ok(status.allowedButtons.includes('start'));
  assert.ok(status.intents.includes('demo_fight'));
}));

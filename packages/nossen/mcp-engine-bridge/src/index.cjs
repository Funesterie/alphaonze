'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TARGETS = new Set(['unity', 'unreal']);
const ACTIONS = new Set(['status', 'apply', 'open', 'save', 'play', 'stop', 'build']);

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function assertInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (target !== base && !target.startsWith(prefix)) {
    const error = new Error('engine_bridge_path_escape');
    error.code = 'ENGINE_BRIDGE_PATH_ESCAPE';
    throw error;
  }
  return target;
}

function createEngineCommand(input = {}, options = {}) {
  const target = clean(input.target, 24).toLowerCase();
  const action = clean(input.action, 32).toLowerCase();
  if (!TARGETS.has(target)) throw new Error('engine_bridge_target_invalid');
  if (!ACTIONS.has(action)) throw new Error('engine_bridge_action_invalid');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const ttlSeconds = Math.max(10, Math.min(900, Number(input.ttlSeconds || 120) || 120));
  const id = clean(input.id, 120) || `eng-${crypto.randomUUID()}`;
  const command = {
    schema: 'nossen.engine-command.v1',
    id,
    target,
    action,
    issuer: clean(input.issuer || 'unknown', 80),
    project: clean(input.project, 160),
    resource: clean(input.resource, 240),
    correlationId: clean(input.correlationId, 160),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
  };
  const bytes = Buffer.byteLength(JSON.stringify(command));
  const maxBytes = Math.max(1024, Math.min(65536, Number(options.maxBytes || 16384) || 16384));
  if (bytes > maxBytes) {
    const error = new Error('engine_bridge_command_too_large');
    error.code = 'ENGINE_BRIDGE_COMMAND_TOO_LARGE';
    throw error;
  }
  return command;
}

function validateEngineCommand(command = {}, options = {}) {
  if (command.schema !== 'nossen.engine-command.v1') return { ok: false, error: 'schema' };
  if (!TARGETS.has(String(command.target || '').toLowerCase())) return { ok: false, error: 'target' };
  if (!ACTIONS.has(String(command.action || '').toLowerCase())) return { ok: false, error: 'action' };
  const expiresAt = Date.parse(command.expiresAt || '');
  if (!Number.isFinite(expiresAt) || (options.now || Date.now()) >= expiresAt) return { ok: false, error: 'expired' };
  return { ok: true, command };
}

function appendEngineCommand(filePath, command, options = {}) {
  const root = options.root || path.dirname(filePath);
  const resolved = assertInside(root, filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(command)}\n`, { encoding: 'utf8', mode: 0o600 });
  return resolved;
}

function createEngineResult(command, input = {}) {
  return {
    schema: 'nossen.engine-result.v1',
    commandId: clean(command?.id, 120),
    target: clean(command?.target, 24).toLowerCase(),
    action: clean(command?.action, 32).toLowerCase(),
    ok: Boolean(input.ok),
    status: clean(input.status || (input.ok ? 'completed' : 'failed'), 40),
    summary: clean(input.summary, 1000),
    artifact: clean(input.artifact, 500),
    completedAt: new Date(input.now || Date.now()).toISOString(),
  };
}

module.exports = {
  ACTIONS,
  TARGETS,
  appendEngineCommand,
  createEngineCommand,
  createEngineResult,
  validateEngineCommand,
};

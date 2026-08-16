'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  createEngineCommand,
  createEngineResult,
  validateEngineCommand,
} = require('../src/index.cjs');

test('creates a bounded Unity command', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const command = createEngineCommand({
    id: 'eng-test',
    target: 'unity',
    action: 'status',
    issuer: 'test',
    ttlSeconds: 60,
  }, { now });
  assert.equal(command.schema, 'nossen.engine-command.v1');
  assert.equal(command.target, 'unity');
  assert.equal(validateEngineCommand(command, { now: now.getTime() + 1000 }).ok, true);
  assert.equal(validateEngineCommand(command, { now: now.getTime() + 61000 }).error, 'expired');
});

test('rejects arbitrary targets and actions', () => {
  assert.throws(() => createEngineCommand({ target: 'shell', action: 'apply' }));
  assert.throws(() => createEngineCommand({ target: 'unreal', action: 'exec' }));
});

test('creates correlated result', () => {
  const command = createEngineCommand({ id: 'eng-42', target: 'unreal', action: 'save' });
  const result = createEngineResult(command, { ok: true, summary: 'saved' });
  assert.equal(result.commandId, 'eng-42');
  assert.equal(result.target, 'unreal');
  assert.equal(result.status, 'completed');
});

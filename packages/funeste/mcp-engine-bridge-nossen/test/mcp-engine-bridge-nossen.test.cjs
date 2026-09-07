'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { queueVivyEngineCommand } = require('../src/index.cjs');

test('queues bounded Vivy engine command inside configured bus root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-bridge-'));
  const accepted = queueVivyEngineCommand({
    id: 'eng-test',
    target: 'unity',
    action: 'status',
  }, { root });
  assert.equal(accepted.accepted, true);
  const line = fs.readFileSync(path.join(root, 'engine-commands.jsonl'), 'utf8').trim();
  const command = JSON.parse(line);
  assert.equal(command.issuer, 'vivy');
  assert.equal(command.target, 'unity');
  fs.rmSync(root, { recursive: true, force: true });
});

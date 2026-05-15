'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseTasksFromMarkdown,
} = require('../scripts/task-dispatcher.cjs');

test('task dispatcher parses UTF-8 checklist tasks used by worker launch flow', () => {
  const tasks = parseTasksFromMarkdown([
    '\uFEFF- [ ] 1 Tester le worker Archiviste',
    '- [ ] 2. Verifier le worker orchestrator',
    '- [ ] 3.1 Sous tache avec id decimal',
  ].join('\n'));

  assert.deepEqual(tasks.map((task) => task.id), ['1', '2', '3.1']);
  assert.equal(tasks[0].status, 'not_started');
  assert.ok(tasks[1].keywords.includes('shell'));
});

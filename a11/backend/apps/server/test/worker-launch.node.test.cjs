'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractToolPayload,
  getLocalWorkerAgents,
  matchAgentToTask,
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

test('task dispatcher reads MCP structuredContent and prefixed JSON text payloads', () => {
  const structured = extractToolPayload({
    result: {
      structuredContent: {
        presence: {
          agents: [{ name: 'codex', active: true }],
        },
      },
      content: [{ text: 'not json' }],
    },
  });
  assert.equal(structured.presence.agents[0].name, 'codex');

  const fromText = extractToolPayload({
    result: {
      content: [{ text: 'Agent presence read.\n\n{"presence":{"agents":[{"name":"a11","active":true}]}}' }],
    },
  });
  assert.equal(fromText.presence.agents[0].name, 'a11');
});

test('task dispatcher can route corpus tasks to local worker fallback', () => {
  const agent = matchAgentToTask(getLocalWorkerAgents(), ['corpus', 'neo4j']);
  assert.equal(agent.name, 'identity-archivist-worker');
});

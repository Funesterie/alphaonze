'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  planA11Request,
  prepareA11Request,
} = require('../src/chat/request-planner.cjs');

test('request planner sends simple greetings through the fast path without heavy tools', () => {
  const plan = planA11Request({
    message: 'Salut ca va ?',
    traceId: 'req-fast-1',
  });

  assert.equal(plan.traceId, 'req-fast-1');
  assert.equal(plan.mode, 'fast');
  assert.equal(plan.needs.llm, true);
  assert.equal(plan.needs.memory, false);
  assert.equal(plan.needs.mcp, false);
  assert.equal(plan.needs.neo4j, false);
  assert.equal(plan.needs.nez, false);
  assert.equal(plan.latencyBudgetMs, 3000);
  assert.deepEqual(plan.toolsRequired, ['llm.chat']);
  assert.ok(plan.toolsForbidden.includes('mcp.full'));
  assert.ok(plan.toolsForbidden.includes('neo4j.query'));
  assert.ok(plan.backgroundJobs.includes('log_message'));
});

test('request planner routes architecture diagnostics through the deep path', () => {
  const plan = planA11Request({
    message: 'Analyse mon architecture MCP NEZ Redis Neo4j et explique pourquoi ca timeout',
    traceId: 'req-deep-1',
  });

  assert.equal(plan.traceId, 'req-deep-1');
  assert.equal(plan.mode, 'deep');
  assert.equal(plan.needs.llm, true);
  assert.equal(plan.needs.memory, true);
  assert.equal(plan.needs.mcp, true);
  assert.equal(plan.needs.neo4j, true);
  assert.equal(plan.needs.nez, true);
  assert.equal(plan.needs.redis, true);
  assert.equal(plan.latencyBudgetMs, 60000);
  assert.ok(plan.toolsOptional.includes('mcp.context'));
  assert.ok(plan.toolsOptional.includes('nez.context'));
  assert.ok(plan.toolsOptional.includes('neo4j.memory'));
  assert.ok(plan.toolsOptional.includes('redis.cache'));
  assert.ok(plan.backgroundJobs.includes('save_summary'));
  assert.ok(plan.backgroundJobs.includes('mcp_trace_log'));
});

test('secret intake replaces tokens before prompts, logs, memory or MCP can receive them', () => {
  const rawToken = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD';
  const prepared = prepareA11Request({
    body: {
      message: `Utilise ce token GitHub ${rawToken} pour verifier le repo`,
      messages: [
        { role: 'user', content: `Utilise ce token GitHub ${rawToken} pour verifier le repo` },
      ],
    },
    traceId: 'req-secret-1',
    vaultSecret: 'unit-test-secret',
    now: () => new Date('2026-06-14T12:00:00.000Z'),
  });

  const serialized = JSON.stringify(prepared);
  assert.equal(serialized.includes(rawToken), false);
  assert.match(prepared.latestUserMessage, /secret:\/\/nez\/github\/[a-f0-9]{12}/);
  assert.equal(prepared.secretIntake.detected, true);
  assert.equal(prepared.secretIntake.secrets.length, 1);
  assert.equal(prepared.secretIntake.secrets[0].provider, 'github');
  assert.equal(prepared.secretIntake.secrets[0].envelope.alg, 'aes-256-gcm');
  assert.equal(prepared.secretIntake.secrets[0].envelope.ciphertext.includes(rawToken), false);
});

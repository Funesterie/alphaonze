'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyStep,
  formatReducedPlan,
  logicReduce,
  parseSteps
} = require('../src/index.cjs');

test('parseSteps splits common handoff separators', () => {
  assert.deepEqual(
    parseSteps('scan repo + retry timeout deploy -> patch file; run test').map((step) => step.text),
    ['scan repo', 'retry timeout deploy', 'patch file', 'run test']
  );
});

test('logicReduce drops known detours but keeps the direct path', () => {
  const result = logicReduce(
    'open five dashboards + retry timeout deploy + patch exact file + run targeted test',
    { objective: 'fix route' }
  );

  assert.equal(result.objective, 'fix route');
  assert.deepEqual(result.directPath, [
    'open five dashboards',
    'patch exact file',
    'run targeted test'
  ]);
  assert.deepEqual(result.dropped.map((item) => item.text), ['retry timeout deploy']);
});

test('safety guards win over noise words', () => {
  const step = classifyStep({ index: 0, text: 'verify auth failure before publish' });
  assert.equal(step.action, 'keep');
  assert.equal(step.reason, 'safety-guard-overrides-noise');
});

test('formatReducedPlan emits a readable handoff', () => {
  const text = formatReducedPlan(logicReduce('A + failed detour + verify + C'));
  assert.match(text, /Summary: kept 3\/4 steps; dropped 1 detour/);
  assert.match(text, /Direct path:/);
  assert.match(text, /Dropped:/);
});

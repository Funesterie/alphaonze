'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildShiryuV2Plan,
  getShiryuV2Spec,
  normalizeHeads,
  DEFAULT_HEADS,
} = require('../src/shiryu-v2-planner.cjs');

const NOW = '2026-07-07T00:00:00.000Z';

test('builds a fan-out plan with jobs, heads and waves', () => {
  const plan = buildShiryuV2Plan(
    {
      currentMessage: 'traduis ce texte en anglais',
      history: [{ role: 'user', content: 'salut' }],
      payload: { data: [1, 2, 3] },
      intent: 'translate',
      accountTier: 'founder',
    },
    { now: NOW }
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.schema, 'nossen.shiryu.v2_fanout.v1');
  assert.ok(plan.jobCount >= 3, 'at least current + payload + intent lanes');
  assert.ok(Array.isArray(plan.jobs) && plan.jobs.length === plan.jobCount);
  assert.ok(Array.isArray(plan.waves) && plan.waves.length >= 1);
  // every job has an assigned head from the pool
  const headIds = new Set(plan.heads.map((h) => h.id));
  for (const job of plan.jobs) assert.ok(headIds.has(job.head), `job head ${job.head} in pool`);
});

test('orchestration lane (A / intent) runs in the first wave', () => {
  const plan = buildShiryuV2Plan(
    { currentMessage: 'fais un truc', payload: { x: 1 }, intent: 'compose.plan' },
    { now: NOW }
  );
  const firstWave = plan.waves[0];
  assert.equal(firstWave.phase, 'orchestrate');
  const orchestrateJobs = plan.jobs.filter((j) => j.task === 'orchestrate');
  assert.ok(orchestrateJobs.length >= 1);
  // orchestrate job id is in the first wave
  assert.ok(firstWave.parallel.includes(orchestrateJobs[0].id));
  // and it is first in the merge order
  assert.equal(plan.mergeOrder[0], orchestrateJobs[0].id);
});

test('explicit translate intent drives the conversation (R) lane task', () => {
  const plan = buildShiryuV2Plan(
    { currentMessage: 'bonjour le monde', intent: 'translate' },
    { now: NOW }
  );
  const rJob = plan.jobs.find((j) => j.lane === 'R');
  assert.ok(rJob, 'a conversation lane job exists');
  assert.equal(rJob.task, 'translate');
});

test('waves respect maxConcurrency', () => {
  const heads = Array.from({ length: 3 }, (_, i) => ({ id: `h${i}`, strength: 'high', speed: 'fast' }));
  const plan = buildShiryuV2Plan(
    {
      currentMessage: 'a',
      history: [{ role: 'user', content: 'b' }],
      payload: { c: 1 },
      intent: 'prompt',
    },
    { heads, maxConcurrency: 2, now: NOW }
  );
  for (const wave of plan.waves) {
    if (wave.phase === 'fanout') assert.ok(wave.parallel.length <= 2, 'fanout wave <= maxConcurrency');
  }
});

test('deterministic: same input yields same plan (minus timestamp)', () => {
  const input = { currentMessage: 'hello', payload: { a: 1 }, intent: 'summarize' };
  const a = buildShiryuV2Plan(input, { now: NOW });
  const b = buildShiryuV2Plan(input, { now: NOW });
  assert.deepEqual(a.jobs, b.jobs);
  assert.deepEqual(a.mergeOrder, b.mergeOrder);
});

test('normalizeHeads falls back to defaults and caps fields', () => {
  const d = normalizeHeads(null);
  assert.equal(d.length, DEFAULT_HEADS.length);
  const custom = normalizeHeads([{ id: 'x', maxConcurrent: 999, speed: 'bogus' }]);
  assert.equal(custom[0].id, 'x');
  assert.ok(custom[0].maxConcurrent <= 32);
  assert.equal(custom[0].speed, 'medium'); // bogus -> default
});

test('spec is exposed', () => {
  const spec = getShiryuV2Spec();
  assert.equal(spec.schema, 'nossen.shiryu.v2_fanout.v1');
  assert.ok(Array.isArray(spec.defaultHeads) && spec.defaultHeads.length >= 1);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildShiryuV2Plan } = require('../src/shiryu-v2-planner.cjs');
const { runShiryuV2Plan, runJobWithFailover, verifyBlade } = require('../src/shiryu-v2-runner.cjs');

const NOW = '2026-07-07T00:00:00.000Z';

function makePlan() {
  return buildShiryuV2Plan(
    { currentMessage: 'traduis et compose', history: [{ role: 'user', content: 'x' }], payload: { a: 1 }, intent: 'translate' },
    { now: NOW }
  );
}

test('runs every wave and merges lane results (mock executor, all ok)', async () => {
  const plan = makePlan();
  const seenWavesOrder = [];
  const execute = async (job) => {
    seenWavesOrder.push(job.lane);
    return { ok: true, output: `${job.task}:${job.lane}@${job.head}` };
  };
  const run = await runShiryuV2Plan(plan, { execute, now: NOW });
  assert.equal(run.ok, true);
  assert.equal(run.verify.failed, 0);
  assert.equal(run.results.length, plan.jobCount);
  // orchestration (A) is executed first
  assert.equal(seenWavesOrder[0], 'A');
  // merged sequence is orchestration-first
  assert.equal(run.merged.sequence[0].lane, 'A');
  assert.ok(run.merged.sequence.length === plan.jobCount);
});

test('head failover: a job failing on its head succeeds on another head', async () => {
  const plan = makePlan();
  const badHead = plan.jobs[0].head;
  const execute = async (job) => {
    if (job.head === badHead) return { ok: false, error: 'head_down' };
    return { ok: true, output: 'recovered' };
  };
  const run = await runShiryuV2Plan(plan, { execute, now: NOW });
  assert.equal(run.ok, true, 'overall ok thanks to failover');
  const recovered = run.results.find((r) => r.failovers > 0);
  assert.ok(recovered, 'at least one job failed over to another head');
  assert.notEqual(recovered.head, badHead);
});

test('verify blade fails when a job exhausts every head', async () => {
  const plan = makePlan();
  const target = plan.jobs.find((j) => j.lane === 'R') || plan.jobs[1];
  const execute = async (job) => {
    if (job.id === target.id) return { ok: false, error: 'always_down' };
    return { ok: true, output: 'ok' };
  };
  const run = await runShiryuV2Plan(plan, { execute, now: NOW });
  assert.equal(run.ok, false);
  assert.equal(run.verify.ok, false);
  assert.ok(run.verify.failures.some((f) => f.jobId === target.id));
  assert.ok(run.verify.confidence < 1);
});

test('runJobWithFailover stops at maxAttempts', async () => {
  const calls = [];
  const job = { id: 'j1', lane: 'R', task: 'translate', head: 'h1' };
  const r = await runJobWithFailover(job, {
    execute: async (j) => { calls.push(j.head); return { ok: false, error: 'no' }; },
    heads: ['h1', 'h2', 'h3'],
    maxAttempts: 2,
  });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 2, 'only 2 attempts');
});

test('throws without an executor', async () => {
  await assert.rejects(() => runShiryuV2Plan(makePlan(), {}), /execute/);
});

test('verifyBlade requires the orchestration lane to succeed', () => {
  const plan = { jobs: [{ id: 'a', lane: 'A' }, { id: 'r', lane: 'R' }] };
  const bad = verifyBlade([{ jobId: 'a', lane: 'A', ok: false }, { jobId: 'r', lane: 'R', ok: true }], plan);
  assert.equal(bad.orchestrationOk, false);
  assert.equal(bad.ok, false);
});

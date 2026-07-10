'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { buildShiryuV2Plan } = require('../src/shiryu-v2-planner.cjs');
const { runShiryuV2Plan } = require('../src/shiryu-v2-runner.cjs');
const { prepareCubeCuda } = require('../src/cube-to-cuda.cjs');
const { runShiryuV2Observed, prepareCubeCudaObserved } = require('../src/shiryu-v2-observed.cjs');
const otel = require('../src/telemetry/otel-instrument.cjs');

const NOW = '2026-07-07T00:00:00.000Z';
const INPUT = { currentMessage: 'traduis', history: [{ role: 'user', content: 'x' }], payload: { a: 1 }, intent: 'translate' };
const okExec = async (job) => ({ ok: true, output: `${job.task}@${job.head}` });

test('observed run matches the pure run (same result, plus telemetry)', async () => {
  const plan = buildShiryuV2Plan(INPUT, { now: NOW });
  const pure = await runShiryuV2Plan(plan, { execute: okExec, now: NOW });
  const observed = await runShiryuV2Observed(plan, { execute: okExec, now: NOW });
  assert.equal(observed.ok, pure.ok);
  assert.equal(observed.results.length, pure.results.length);
  assert.deepEqual(observed.mergeOrder ?? null, pure.mergeOrder ?? null);
  assert.equal(observed.verify.confidence, pure.verify.confidence);
});

test('observed run preserves failover behaviour', async () => {
  const plan = buildShiryuV2Plan(INPUT, { now: NOW });
  const badHead = plan.jobs[0].head;
  const run = await runShiryuV2Observed(plan, {
    execute: async (job) => (job.head === badHead ? { ok: false, error: 'down' } : { ok: true, output: 'ok' }),
    now: NOW,
  });
  assert.equal(run.ok, true);
  assert.ok(run.results.some((r) => r.failovers > 0));
});

test('prepareCubeCudaObserved matches the pure encoder', () => {
  const pure = prepareCubeCuda(INPUT, { op: 'sculpt', now: NOW });
  const observed = prepareCubeCudaObserved(INPUT, { op: 'sculpt', now: NOW });
  assert.equal(observed.atomCount, pure.atomCount);
  assert.equal(observed.op, pure.op);
  assert.equal(observed.cudaAvailable, pure.cudaAvailable);
});

test('instrumentation helpers are safe no-ops without a live SDK', () => {
  // no exporter registered in tests -> telemetry not "active", but nothing throws
  assert.equal(typeof otel.isTelemetryActive(), 'boolean');
  const c = otel.counter('t.count', 'x'); c.add(1);
  const h = otel.histogram('t.hist', 'x'); h.record(5);
  assert.doesNotThrow(() => otel.withSpanSync('t.span', {}, (s) => { s.setAttribute('k', 1); return 1; }));
});

test('observed run requires an executor', async () => {
  const plan = buildShiryuV2Plan(INPUT, { now: NOW });
  await assert.rejects(() => runShiryuV2Observed(plan, {}), /execute/);
});

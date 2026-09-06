'use strict';

/**
 * Shiryu V2 — runner. Executes the fan-out plan from {@link buildShiryuV2Plan}.
 *
 * Waves run in order (orchestration first), jobs inside a wave run in parallel.
 * Each job is dispatched through an INJECTABLE executor — locally the Cerbère
 * provider chain, later a k8s worker pod. This module is pure orchestration:
 * with a deterministic executor it is deterministic, and it makes NO calls of
 * its own, so it is safe and unit-testable with mocks.
 *
 * Two extra blades on top of the plain runner:
 *   - head failover: a job that fails on its assigned head retries on the other
 *     capable heads (resilience, like the provider fallback chain).
 *   - verify blade: an adversarial self-check that refuses to declare success if
 *     a critical (orchestration) lane failed or any lane exhausted every head.
 */

function nowIso(options) {
  return String((options && options.now) || new Date().toISOString());
}

async function runJobWithFailover(job, options) {
  const execute = options.execute;
  const allHeads = Array.isArray(options.heads) ? options.heads : [];
  const order = [job.head, ...allHeads.filter((h) => h && h !== job.head)];
  const maxAttempts = Math.max(1, Math.min(order.length, Number(options.maxAttempts) || order.length));
  const attempts = [];

  for (const head of order.slice(0, maxAttempts)) {
    try {
      const out = await execute({ ...job, head }, { attempt: attempts.length + 1 });
      if (out && out.ok !== false) {
        return {
          jobId: job.id,
          lane: job.lane,
          laneName: job.laneName,
          task: job.task,
          head,
          ok: true,
          output: Object.prototype.hasOwnProperty.call(out, 'output') ? out.output : out,
          attempts: attempts.length + 1,
          failovers: attempts.length,
        };
      }
      attempts.push({ head, error: (out && out.error) || 'not_ok' });
    } catch (error) {
      attempts.push({ head, error: (error && error.message) || String(error) });
    }
  }
  return {
    jobId: job.id,
    lane: job.lane,
    laneName: job.laneName,
    task: job.task,
    ok: false,
    error: 'all_heads_failed',
    attempts: attempts.length,
    attemptDetail: attempts,
  };
}

function mergeLaneResults(results, plan) {
  const byId = new Map(results.map((r) => [r.jobId, r]));
  const ordered = (Array.isArray(plan.mergeOrder) ? plan.mergeOrder : [])
    .map((id) => byId.get(id))
    .filter(Boolean);
  const lanes = { A: [], R: [], G: [], B: [] };
  for (const r of ordered) {
    if (r.ok && lanes[r.lane]) lanes[r.lane].push({ task: r.task, head: r.head, output: r.output });
  }
  return {
    orchestration: lanes.A.map((x) => x.output),
    lanes,
    // priority-ordered, orchestration-first sequence a composer (Vivy) consumes
    sequence: ordered.filter((r) => r.ok).map((r) => ({ lane: r.lane, task: r.task, head: r.head, output: r.output })),
  };
}

function verifyBlade(results, plan) {
  const total = results.length;
  const successful = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const orchestrationJobIds = (plan.jobs || []).filter((j) => j.lane === 'A').map((j) => j.id);
  const orchestrationOk = orchestrationJobIds.length === 0
    || results.some((r) => orchestrationJobIds.includes(r.jobId) && r.ok);
  const confidence = total ? Math.round((successful / total) * 100) / 100 : 1;
  return {
    ok: orchestrationOk && failed.length === 0,
    orchestrationOk,
    successful,
    failed: failed.length,
    total,
    confidence,
    failures: failed.map((f) => ({ jobId: f.jobId, lane: f.lane, task: f.task, error: f.error })),
  };
}

/**
 * Run a Shiryu V2 fan-out plan.
 * @param {object} plan  output of buildShiryuV2Plan
 * @param {object} options { execute(job, ctx): Promise<{ok?,output?,error?}>, maxAttempts?, now? }
 */
async function runShiryuV2Plan(plan, options = {}) {
  if (!plan || !Array.isArray(plan.waves) || !Array.isArray(plan.jobs)) {
    throw new Error('runShiryuV2Plan: a valid plan (waves + jobs) is required');
  }
  if (typeof options.execute !== 'function') {
    throw new Error('runShiryuV2Plan: options.execute (async runner) is required');
  }
  const heads = Array.isArray(plan.heads) ? plan.heads.map((h) => h.id) : [];
  const jobsById = new Map(plan.jobs.map((j) => [j.id, j]));
  const runOptions = { execute: options.execute, heads, maxAttempts: options.maxAttempts };

  const results = new Map();
  for (const wave of plan.waves) {
    const settled = await Promise.all(
      (wave.parallel || [])
        .map((id) => jobsById.get(id))
        .filter(Boolean)
        .map((job) => runJobWithFailover(job, runOptions))
    );
    for (const r of settled) results.set(r.jobId, r);
  }

  const resultList = [...results.values()];
  const merged = mergeLaneResults(resultList, plan);
  const verify = verifyBlade(resultList, plan);

  return {
    ok: verify.ok,
    schema: 'nossen.shiryu.v2_run.v1',
    blade: 'nine-blades',
    jobCount: plan.jobCount,
    waveCount: plan.waveCount,
    results: resultList,
    merged,
    verify,
    createdAt: nowIso(options),
  };
}

module.exports = {
  runShiryuV2Plan,
  runJobWithFailover,
  mergeLaneResults,
  verifyBlade,
};

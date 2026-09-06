'use strict';

/**
 * Telemetry-observed Shiryu V2 + cube-to-cuda.
 *
 * Same results as the pure modules, plus OpenTelemetry spans + metrics to
 * Application Insights (the Entra telemetry). This makes "Robin Mil Fleurs"
 * observable: every parallel lane/job is a span, and the atoms encoded toward
 * CUDA (V3) are counted. Inert when telemetry is off (helpers no-op).
 *
 * Spans:  shiryu.v2.run  ->  shiryu.job (per lane/head)  ;  cube.to.cuda
 * Metrics: shiryu.jobs, shiryu.failovers, shiryu.atoms (Robin flowers)
 */

const { runShiryuV2Plan } = require('./shiryu-v2-runner.cjs');
const { prepareCubeCuda } = require('./cube-to-cuda.cjs');
const otel = require('./telemetry/otel-instrument.cjs');

const jobCounter = otel.counter('shiryu.jobs', 'Shiryu V2 lane jobs executed');
const failoverHist = otel.histogram('shiryu.failovers', 'Head failovers per Shiryu run');
const atomCounter = otel.counter('shiryu.atoms', 'Cube atoms encoded toward CUDA (Robin Mil Fleurs)');

/** Wrap a user executor so each job call becomes a `shiryu.job` span. */
function instrumentExecutor(execute) {
  return (job, ctx) => otel.withSpan(
    'shiryu.job',
    {
      'shiryu.lane': job.lane,
      'shiryu.task': job.task,
      'shiryu.head': job.head,
      'shiryu.attempt': (ctx && ctx.attempt) || 1,
    },
    async (span) => {
      const out = await execute(job, ctx);
      span.setAttribute('shiryu.ok', !(out && out.ok === false));
      return out;
    }
  );
}

/** runShiryuV2Plan wrapped in a parent span + run-level metrics. */
async function runShiryuV2Observed(plan, options = {}) {
  if (!plan || typeof options.execute !== 'function') {
    throw new Error('runShiryuV2Observed: a plan and options.execute are required');
  }
  return otel.withSpan(
    'shiryu.v2.run',
    {
      'shiryu.jobCount': plan.jobCount,
      'shiryu.waveCount': plan.waveCount,
      'shiryu.maxConcurrency': plan.maxConcurrency,
    },
    async (span) => {
      const run = await runShiryuV2Plan(plan, { ...options, execute: instrumentExecutor(options.execute) });
      const failovers = run.results.reduce((sum, r) => sum + (r.failovers || 0), 0);
      jobCounter.add(run.results.length, { 'shiryu.ok': String(run.ok) });
      failoverHist.record(failovers);
      span.setAttribute('shiryu.ok', run.ok);
      span.setAttribute('shiryu.confidence', run.verify.confidence);
      span.setAttribute('shiryu.failovers', failovers);
      span.setAttribute('shiryu.failed', run.verify.failed);
      return run;
    }
  );
}

/** prepareCubeCuda wrapped in a span + the Robin-flowers atom counter. */
function prepareCubeCudaObserved(input, options = {}) {
  return otel.withSpanSync(
    'cube.to.cuda',
    { 'cuda.op': (options && options.op) || 'identity' },
    (span) => {
      const out = prepareCubeCuda(input, options);
      span.setAttribute('cuda.atomCount', out.atomCount);
      span.setAttribute('cuda.available', out.cudaAvailable);
      span.setAttribute('cuda.executedOn', out.executedOn);
      atomCounter.add(out.atomCount || 0, { 'cuda.op': out.op });
      return out;
    }
  );
}

module.exports = {
  runShiryuV2Observed,
  prepareCubeCudaObserved,
  instrumentExecutor,
};

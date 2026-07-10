'use strict';

/**
 * Safe, lazy OpenTelemetry instrumentation helpers.
 *
 * No-op when @opentelemetry/api is absent OR no SDK is registered — so modules
 * stay pure in tests and inert when telemetry is off. When Azure Monitor OTel is
 * started ({@link ../telemetry/otel-bootstrap.cjs}), spans + metrics flow to
 * Application Insights (the Entra telemetry). @opentelemetry/api ships as a
 * transitive dep of @azure/monitor-opentelemetry.
 */

let api = null;
try {
  // eslint-disable-next-line global-require
  api = require('@opentelemetry/api');
} catch {
  api = null;
}

const SCOPE = 'funesterie.shiryu';

const NOOP_SPAN = Object.freeze({
  setAttribute() {}, setAttributes() {}, addEvent() {},
  recordException() {}, setStatus() {}, end() {}, isRecording() { return false; },
});
const NOOP_COUNTER = Object.freeze({ add() {} });
const NOOP_HISTOGRAM = Object.freeze({ record() {} });

function getTracer() {
  return api ? api.trace.getTracer(SCOPE) : null;
}
function getMeter() {
  return api ? api.metrics.getMeter(SCOPE) : null;
}

/** True only when a real, recording SDK is registered (i.e. telemetry is live). */
function isTelemetryActive() {
  const tracer = getTracer();
  if (!tracer) return false;
  try {
    const span = tracer.startSpan('probe');
    const recording = typeof span.isRecording === 'function' ? span.isRecording() : false;
    span.end();
    return recording;
  } catch {
    return false;
  }
}

async function withSpan(name, attributes, fn) {
  const tracer = getTracer();
  if (!tracer) return fn(NOOP_SPAN);
  const span = tracer.startSpan(name, { attributes: attributes || {} });
  try {
    const result = await fn(span);
    span.setStatus({ code: api.SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: api.SpanStatusCode.ERROR, message: (error && error.message) || String(error) });
    throw error;
  } finally {
    span.end();
  }
}

function withSpanSync(name, attributes, fn) {
  const tracer = getTracer();
  if (!tracer) return fn(NOOP_SPAN);
  const span = tracer.startSpan(name, { attributes: attributes || {} });
  try {
    const result = fn(span);
    span.setStatus({ code: api.SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: api.SpanStatusCode.ERROR, message: (error && error.message) || String(error) });
    throw error;
  } finally {
    span.end();
  }
}

function counter(name, description) {
  const meter = getMeter();
  if (!meter) return NOOP_COUNTER;
  try {
    return meter.createCounter(name, { description });
  } catch {
    return NOOP_COUNTER;
  }
}

function histogram(name, description) {
  const meter = getMeter();
  if (!meter) return NOOP_HISTOGRAM;
  try {
    return meter.createHistogram(name, { description });
  } catch {
    return NOOP_HISTOGRAM;
  }
}

module.exports = {
  SCOPE,
  withSpan,
  withSpanSync,
  counter,
  histogram,
  getTracer,
  getMeter,
  isTelemetryActive,
};

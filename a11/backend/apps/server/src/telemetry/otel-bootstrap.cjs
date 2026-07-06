'use strict';
/**
 * OpenTelemetry -> Azure Monitor (Application Insights) bootstrap.
 *
 * Sends traces / logs / metrics to Application Insights via the Azure Monitor
 * OpenTelemetry distro. Designed to be required as early as possible in server
 * startup (before other instrumented modules) so auto-instrumentation attaches.
 *
 * Safety:
 *   - INERT unless APPLICATIONINSIGHTS_CONNECTION_STRING is set.
 *   - Lazy-loads @azure/monitor-opentelemetry inside try/catch, so a missing
 *     optional dependency degrades gracefully instead of crashing the server.
 *   - Never logs the connection string or instrumentation key (only a masked prefix).
 *
 * Env:
 *   APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
 *   OTEL_SERVICE_NAME=a11-server
 *   OTEL_SERVICE_VERSION=<git sha / semver>
 *   OTEL_DEPLOYMENT_ENVIRONMENT=prod
 *   OTEL_SDK_DISABLED=1   -> force off even if a connection string is present
 */

const fs = require('node:fs');
const path = require('node:path');

let started = false;

function flagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/**
 * Resolve the App Insights connection string from a secret FILE first (so it can live
 * in a mounted secret / Key Vault CSI file, never in git), then fall back to the env var.
 */
function resolveConnectionString(env = process.env) {
  const fileCandidates = [
    env.APPLICATIONINSIGHTS_CONNECTION_STRING_FILE,
    '/app/runtime/secrets/applicationinsights_connection_string',
  ].filter(Boolean);
  for (const candidate of fileCandidates) {
    try {
      const value = fs.readFileSync(path.resolve(candidate), 'utf8').trim();
      if (value) return value;
    } catch {
      // secret file is optional
    }
  }
  return String(env.APPLICATIONINSIGHTS_CONNECTION_STRING || '').trim();
}

function maskConnectionString(connectionString) {
  const value = String(connectionString || '');
  const keyMatch = /InstrumentationKey=([0-9a-fA-F-]+)/.exec(value);
  const endpointMatch = /IngestionEndpoint=([^;]+)/.exec(value);
  return {
    instrumentationKey: keyMatch ? `${keyMatch[1].slice(0, 8)}…` : '(none)',
    ingestionEndpoint: endpointMatch ? endpointMatch[1] : '(default)',
  };
}

function isTelemetryConfigured(env = process.env) {
  if (flagEnabled(env.OTEL_SDK_DISABLED)) return false;
  return Boolean(resolveConnectionString(env));
}

/**
 * Initialise telemetry once. Safe to call unconditionally: it no-ops when not
 * configured and returns a small status object describing what happened.
 */
function startTelemetry(env = process.env) {
  if (started) return { ok: true, alreadyStarted: true };
  if (!isTelemetryConfigured(env)) return { ok: false, skipped: 'not_configured' };

  let useAzureMonitor;
  try {
    ({ useAzureMonitor } = require('@azure/monitor-opentelemetry'));
  } catch {
    console.warn('[telemetry] @azure/monitor-opentelemetry not installed — telemetry disabled (run: npm i @azure/monitor-opentelemetry)');
    return { ok: false, skipped: 'dependency_missing' };
  }

  try {
    const serviceName = String(env.OTEL_SERVICE_NAME || 'a11-server').trim();
    const serviceVersion = String(env.OTEL_SERVICE_VERSION || '').trim();
    const deploymentEnvironment = String(
      env.OTEL_DEPLOYMENT_ENVIRONMENT || env.NODE_ENV || 'development'
    ).trim();

    // The distro derives the OTel Resource from these env vars — set them if unset
    // so we avoid pulling in @opentelemetry/resources just to build a Resource.
    if (!env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = serviceName;
    if (!env.OTEL_RESOURCE_ATTRIBUTES) {
      const attrs = [`service.name=${serviceName}`, `deployment.environment=${deploymentEnvironment}`];
      if (serviceVersion) attrs.push(`service.version=${serviceVersion}`);
      process.env.OTEL_RESOURCE_ATTRIBUTES = attrs.join(',');
    }

    useAzureMonitor({
      azureMonitorExporterOptions: {
        connectionString: resolveConnectionString(env),
      },
    });

    started = true;
    const masked = maskConnectionString(resolveConnectionString(env));
    console.log(
      `[telemetry] Azure Monitor OpenTelemetry started service=${serviceName}${serviceVersion ? `@${serviceVersion}` : ''} env=${deploymentEnvironment} ik=${masked.instrumentationKey} endpoint=${masked.ingestionEndpoint}`
    );
    return { ok: true, service: serviceName, environment: deploymentEnvironment };
  } catch (error) {
    console.warn('[telemetry] failed to start Azure Monitor:', String((error && error.message) || error));
    return { ok: false, error: String((error && error.message) || error) };
  }
}

/** Masked, secret-free view for startup diagnostics. */
function describeTelemetryConfig(env = process.env) {
  const configured = isTelemetryConfigured(env);
  return {
    configured,
    started,
    serviceName: String(env.OTEL_SERVICE_NAME || 'a11-server').trim(),
    serviceVersion: String(env.OTEL_SERVICE_VERSION || '(unset)').trim(),
    environment: String(env.OTEL_DEPLOYMENT_ENVIRONMENT || env.NODE_ENV || 'development').trim(),
    ...(configured ? maskConnectionString(resolveConnectionString(env)) : {}),
  };
}

module.exports = {
  startTelemetry,
  isTelemetryConfigured,
  describeTelemetryConfig,
  maskConnectionString,
};

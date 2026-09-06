'use strict';
/**
 * One-line masked startup diagnostics for the Azure/Entra integration.
 *
 * Prints ONLY masked identifiers and booleans — never secrets, connection strings,
 * or tokens. Stays silent when nothing Azure-related is configured, so it adds no
 * noise to deployments that do not use it.
 */

const { describeTelemetryConfig } = require('./telemetry/otel-bootstrap.cjs');
const { describeEntraMcpConfig } = require('./mcp-oauth/entra-auth.cjs');
const { describeAzureGraphConfig } = require('./auth/azure-graph-client.cjs');

function logAzureStartupDiagnostics(env = process.env) {
  let telemetry; let entra; let graph;
  try { telemetry = describeTelemetryConfig(env); } catch { telemetry = { configured: false }; }
  try { entra = describeEntraMcpConfig(env); } catch { entra = { configured: false }; }
  try { graph = describeAzureGraphConfig(env); } catch { graph = { configured: false }; }

  if (!telemetry.configured && !entra.configured && !graph.configured) return null;

  console.log('[azure] startup diagnostics (masked):');
  console.log(
    `[azure]   telemetry: configured=${telemetry.configured} service=${telemetry.serviceName || '(unset)'}`
    + ` env=${telemetry.environment || '(unset)'} ik=${telemetry.instrumentationKey || '(none)'}`
  );
  console.log(
    `[azure]   mcp-entra: configured=${entra.configured} provider=${entra.provider}`
    + ` tenant=${entra.tenantId} audience=${entra.audience} scope=${entra.scope}`
    + ` allowedClients=${Array.isArray(entra.allowedClientIds) ? entra.allowedClientIds.length : 0}`
    + ` devBypass=${entra.devBypass === true}`
  );
  console.log(
    `[azure]   graph:     configured=${graph.configured} tenant=${graph.tenantId}`
    + ` client=${graph.clientId} secret=${graph.secretPresent === true} scope=${graph.scope}`
  );
  return { telemetry, entra, graph };
}

module.exports = { logAzureStartupDiagnostics };

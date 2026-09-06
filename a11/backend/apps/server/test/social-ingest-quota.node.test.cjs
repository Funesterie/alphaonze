'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workerPath = path.resolve(__dirname, '../scripts/social-ingest-worker.cjs');
const deployScriptPath = path.resolve(__dirname, '../../../../ops/deploy-a11-prod-finland-2.ps1');
const envExamplePath = path.resolve(__dirname, '../.env.example');
const socialDocPath = path.resolve(__dirname, '../../../../docs/VIVY_SOCIAL_AUTOPROMPT.md');

function read(pathname) {
  return fs.readFileSync(pathname, 'utf8');
}

test('social ingest worker defaults to and enforces a 30 minute interval', () => {
  const worker = read(workerPath);

  assert.match(
    worker,
    /intEnv\('SOCIAL_INGEST_INTERVAL_MS', 30 \* 60 \* 1000, 30 \* 60 \* 1000, 24 \* 60 \* 60 \* 1000\)/
  );
});

test('prod deploy defaults every local representation to 30 minutes', () => {
  const script = read(deployScriptPath);
  const prodEnvLine = script.split(/\r?\n/).find((line) => line.includes('SOCIAL_INGEST_INTERVAL_MS = $('));

  assert.match(script, /SOCIAL_INGEST_INTERVAL_MS: \$\{SOCIAL_INGEST_INTERVAL_MS:-1800000\}/);
  assert.ok(prodEnvLine, 'ProdEnv must define SOCIAL_INGEST_INTERVAL_MS');
  assert.match(prodEnvLine, /else \{ "1800000" \}\)$/);
});

test('remote secret reuse replaces a preserved legacy interval with 30 minutes', () => {
  const script = read(deployScriptPath);
  const managedKeysLine = script.split(/\r?\n/).find((line) => line.startsWith("managed_keys='"));

  assert.ok(managedKeysLine, 'managed key pattern must exist');
  assert.match(managedKeysLine, /\|SOCIAL_INGEST_INTERVAL_MS\|/);
  assert.match(script, /printf 'SOCIAL_INGEST_INTERVAL_MS=1800000\\n' >> "\$tmp_build"/);
});

test('documented social ingest interval is 30 minutes', () => {
  const envExample = read(envExamplePath);
  const socialDoc = read(socialDocPath);

  assert.match(envExample, /^SOCIAL_INGEST_INTERVAL_MS=1800000$/m);
  assert.doesNotMatch(envExample, /^SOCIAL_INGEST_INTERVAL_MS=900000$/m);
  assert.match(socialDoc, /^SOCIAL_INGEST_INTERVAL_MS=1800000$/m);
  assert.doesNotMatch(socialDoc, /^SOCIAL_INGEST_INTERVAL_MS=900000$/m);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildManifest,
  summarizeManifest,
  toCypher,
} = require('../scripts/sync-runtime-hooks-neo4j.cjs');

test('runtime hooks manifest maps the expected A11 modules', () => {
  const manifest = buildManifest();
  const ids = new Set(manifest.modules.map((item) => item.id));

  for (const expected of ['cortex', 'spyder', 'telemetry', 'rome', 'corpus', 'agent-domain-pack', 'piccolo', 'doctor', 'qflush']) {
    assert.equal(ids.has(expected), true, `${expected} should be present`);
  }

  const doctor = manifest.modules.find((item) => item.id === 'doctor');
  assert.deepEqual(doctor.aliases, ['docteur']);
  assert.ok(manifest.links.some((link) => link.from === 'runtime-hooks' && link.to === 'neo4j'));
  assert.ok(manifest.links.some((link) => link.from === 'agent-domain-pack' && link.to === 'neo4j'));
});

test('runtime hooks summary and cypher are usable without Neo4j', () => {
  const manifest = buildManifest();
  const summary = summarizeManifest(manifest);
  const cypher = toCypher(manifest);

  assert.equal(summary.modules, 9);
  assert.ok(summary.links >= 20);
  assert.match(cypher, /A11RuntimeHook/);
  assert.match(cypher, /MERGE \(n:A11RuntimeHook/);
  assert.match(cypher, /HAS_ROUTE_NODE/);
});

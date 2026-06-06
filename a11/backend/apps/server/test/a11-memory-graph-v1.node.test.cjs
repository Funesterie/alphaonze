'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildMemoryGraph,
  explainAgentContext,
  findRecentIncidents,
  traceService,
} = require('../src/knowledge/a11-memory-graph-v1.cjs');

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-memory-graph-v1-'));
  const kg = path.join(root, 'knowledge-graph');
  fs.mkdirSync(kg, { recursive: true });
  const routeMapPath = path.join(kg, 'a11-route-map.json');
  const runtimeHooksPath = path.join(kg, 'a11-runtime-hooks.json');
  const scopePath = path.join(kg, 'funesterie-ecosystem-scope.json');
  const corpusPath = path.join(kg, 'funesterie-ecosystem-corpus.json');
  const statePath = path.join(root, 'codex-session-state-current.md');

  fs.writeFileSync(routeMapPath, JSON.stringify({
    agents: [{ id: 'a11', name: 'A11', tools: ['trace_service'] }],
    services: [
      { id: 'a11-backend', name: 'A11 Backend', type: 'express', health: '/health', dependsOn: ['neo4j-local'] },
    ],
    endpoints: [
      { id: 'health', service: 'a11-backend', method: 'GET', path: '/health' },
    ],
    domains: [
      { id: 'a11.funesterie.me', hostname: 'a11.funesterie.me', service: 'a11-backend' },
    ],
  }), 'utf8');
  fs.writeFileSync(runtimeHooksPath, JSON.stringify({
    hooks: [
      {
        id: 'runtime-hooks',
        name: 'Runtime Hooks',
        tools: [{ name: 'trace_service', description: 'Trace service safely' }],
        sourcePath: 'scripts/demo.cjs',
      },
    ],
  }), 'utf8');
  fs.writeFileSync(scopePath, JSON.stringify({
    repos: [{ name: 'Funesterie/alphoonze', path: 'D:/projets/funesterie' }],
    packages: [{ name: '@nossen/qflush', version: '2.0.1' }],
  }), 'utf8');
  fs.writeFileSync(corpusPath, JSON.stringify({
    sourceCards: [
      { id: 'card-1', title: 'A11 backend', domain: 'infra', summary: 'Backend service map' },
    ],
  }), 'utf8');
  const fakeSecretNote = `Incident: prod bug fixed without leaking ${'password'}=${'fixture-value'}\nDecision: keep caddy primary\n`;
  fs.writeFileSync(statePath, fakeSecretNote, 'utf8');

  return { root, routeMapPath, runtimeHooksPath, scopePath, corpusPath, statePath };
}

test('A11 Memory Graph v1 builds a sanitized explainable graph', () => {
  const fixture = makeFixture();
  try {
    const graph = buildMemoryGraph({
      paths: {
        routeMap: fixture.routeMapPath,
        runtimeHooks: fixture.runtimeHooksPath,
        ecosystemScope: fixture.scopePath,
        ecosystemCorpus: fixture.corpusPath,
        sessionState: fixture.statePath,
      },
    });

    assert.equal(graph.ok, true);
    assert.equal(graph.schema, 'funesterie.a11-memory-graph.v1');
    assert.ok(graph.summary.nodes > 0);
    assert.ok(graph.summary.relationships > 0);
  assert.equal(JSON.stringify(graph).includes('fixture-value'), false);

    const traced = traceService('a11-backend', { graph });
    assert.equal(traced.ok, true);
    assert.equal(traced.node.id, 'service:a11-backend');

    const incidents = findRecentIncidents({ graph });
    assert.equal(incidents.ok, true);
    assert.equal(incidents.count, 1);

    const context = explainAgentContext('a11', { graph });
    assert.equal(context.ok, true);
    assert.equal(context.agent, 'a11');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

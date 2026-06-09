'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createEmptyState,
  deleteCaseData,
  exportReport,
  getEntityLinks,
  getSourcesForEntity,
  getTimeline,
  importDocument,
  lexicalSearch,
  runAllowedQuery,
  seedDemoCase,
  semanticSearch,
  validateSensitiveNode
} = require('../backend/src/domain');

const sample = fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'fake-pv-001.txt'), 'utf8');

function ctx(role = 'enqueteur', tenantId = 'tenant-demo', caseId = 'case-demo-001', isAgent = false) {
  return {
    userId: `${role}-user`,
    role,
    tenantId,
    caseId,
    allowedCases: [caseId],
    isAgent,
    requestId: `${role}-${caseId}`
  };
}

function preparedState() {
  const state = createEmptyState();
  seedDemoCase(state, sample);
  return state;
}

test('prevents leakage between cases', () => {
  const state = preparedState();
  const secondContext = ctx('enqueteur', 'tenant-demo', 'case-demo-002');
  importDocument(state, secondContext, {
    tenantId: 'tenant-demo',
    caseId: 'case-demo-002',
    sourceId: 'fake-pv-002',
    sourceType: 'proces_verbal_fictif',
    text: sample.replaceAll('Camille Durand', 'Iris Volney')
  });

  const results = lexicalSearch(state, ctx('analyste'), 'Iris');
  assert.equal(results.length, 0);
});

test('forbids access to another tenant', () => {
  const state = createEmptyState();
  assert.throws(
    () =>
      importDocument(state, ctx('enqueteur', 'tenant-a', 'case-a'), {
        tenantId: 'tenant-b',
        caseId: 'case-a',
        sourceId: 'fake-pv-cross-tenant',
        sourceType: 'proces_verbal_fictif',
        text: sample
      }),
    /Tenant access denied/
  );
});

test('rejects Cypher injection attempts', () => {
  const state = preparedState();
  assert.throws(() => lexicalSearch(state, ctx('analyste'), 'MATCH (n) RETURN n'), /Cypher/);
  assert.throws(
    () =>
      runAllowedQuery(state, ctx('analyste'), {
        queryId: 'search_lexical',
        cypher: 'MATCH (n) RETURN n',
        query: 'Camille'
      }),
    /Cypher/
  );
});

test('forbids administrator access from an AI agent', () => {
  const state = preparedState();
  assert.throws(
    () => exportReport(state, ctx('administrateur_technique', 'tenant-demo', 'case-demo-001', true)),
    /administrator credentials must never be used by an AI agent/
  );
});

test('rejects sensitive nodes without source', () => {
  assert.throws(
    () =>
      validateSensitiveNode({
        id: 'bad-node',
        information_kind: 'fact',
        source_type: 'proces_verbal_fictif',
        created_at: new Date().toISOString(),
        classification: 'restricted',
        confidence: 0.5,
        tenant_id: 'tenant-demo',
        case_id: 'case-demo-001',
        visibility: 'case',
        verified_by: null,
        verification_status: 'unverified'
      }),
    /source_id/
  );
});

test('rejects invalid classification', () => {
  assert.throws(
    () =>
      validateSensitiveNode({
        id: 'bad-node',
        information_kind: 'fact',
        source_id: 'fake-pv-001',
        source_type: 'proces_verbal_fictif',
        created_at: new Date().toISOString(),
        classification: 'secret-without-policy',
        confidence: 0.5,
        tenant_id: 'tenant-demo',
        case_id: 'case-demo-001',
        visibility: 'case',
        verified_by: null,
        verification_status: 'unverified'
      }),
    /Invalid classification/
  );
});

test('deletes all case data', () => {
  const state = preparedState();
  const deletion = deleteCaseData(state, ctx('superviseur'), 'tenant-demo', 'case-demo-001');
  assert.equal(deletion.after.documents, 0);
  assert.equal(deletion.after.nodes, 0);
  assert.equal(deletion.after.relations, 0);
  assert.equal(state.documents.length, 0);
  assert.equal(state.nodes.size, 0);
  assert.equal(state.relations.length, 0);
});

test('audits every consultation', () => {
  const state = preparedState();
  const analyste = ctx('analyste');
  const before = state.audit.length;

  const results = lexicalSearch(state, analyste, 'Camille');
  assert.ok(results.length > 0);
  semanticSearch(state, analyste, 'vehicule blanc proche du garage');
  getTimeline(state, analyste);
  getSourcesForEntity(state, analyste, results[0].id);
  getEntityLinks(state, analyste, results[0].id);
  exportReport(state, analyste);

  assert.equal(state.audit.length, before + 6);
});

test('rejects over-broad queries', () => {
  const state = preparedState();
  assert.throws(() => lexicalSearch(state, ctx('analyste'), '*'), /too broad/);
  assert.throws(() => semanticSearch(state, ctx('analyste'), 'all'), /too broad/);
});


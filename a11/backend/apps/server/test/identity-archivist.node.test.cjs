'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEcosystemCorpus } = require('../src/knowledge/ecosystem-corpus.cjs');
const { buildEcosystemScope } = require('../src/knowledge/ecosystem-scope.cjs');
const {
  applyArchivistPatchesToCorpus,
  buildIdentityArchivistReport,
  toIdentityTagsCypher,
  toIdentityTagsMarkdown,
} = require('../src/knowledge/identity-archivist.cjs');

test('identity archivist builds three hashtag families for every entity', () => {
  const scope = buildEcosystemScope({ generatedAt: '2026-05-15T00:00:00.000Z' });
  const corpus = buildEcosystemCorpus(scope, { generatedAt: '2026-05-15T00:00:00.000Z' });
  const report = buildIdentityArchivistReport(scope, corpus, { generatedAt: '2026-05-15T00:00:00.000Z' });

  assert.equal(report.worker.id, 'identity-archivist-worker');
  assert.ok(report.proposals.length >= corpus.sourceCards.length);
  assert.equal(report.summary.needsReview, 0);
  for (const proposal of report.proposals) {
    assert.ok(proposal.families.functional.length > 0, proposal.entityId);
    assert.ok(proposal.families.narrative.length > 0, proposal.entityId);
    assert.ok(proposal.families.visual.length > 0, proposal.entityId);
  }

  const qflush = report.proposals.find((proposal) => proposal.entityId === 'qflush-runtime');
  assert.equal(qflush.identityType, 'runtime');
  assert.ok(qflush.families.visual.includes('#not-human-character'));

  const nossen = report.proposals.find((proposal) => proposal.entityId === 'repo:nossen');
  assert.equal(nossen.identityType, 'universe');
  assert.match(nossen.representationRule, /Univers/);
});

test('identity archivist exports corpus patches and Neo4j identity tag cypher', () => {
  const scope = buildEcosystemScope({ generatedAt: '2026-05-15T00:00:00.000Z' });
  const corpus = buildEcosystemCorpus(scope, { generatedAt: '2026-05-15T00:00:00.000Z' });
  const report = buildIdentityArchivistReport(scope, corpus, { generatedAt: '2026-05-15T00:00:00.000Z' });
  const patched = applyArchivistPatchesToCorpus(corpus, report);
  const markdown = toIdentityTagsMarkdown(report);
  const cypher = toIdentityTagsCypher(report);

  assert.equal(patched.identityArchivist.workerId, 'identity-archivist-worker');
  assert.ok(patched.sourceCards.every((card) => Array.isArray(card.visualHashtags)));
  assert.match(markdown, /Functional/);
  assert.match(cypher, /HAS_IDENTITY_TAG/);
  assert.match(cypher, /FunesterieIdentityTag/);
});

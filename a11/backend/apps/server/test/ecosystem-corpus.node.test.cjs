'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEcosystemScope } = require('../src/knowledge/ecosystem-scope.cjs');
const {
  buildEcosystemCorpus,
  summarizeCorpus,
  toCypher,
  toMarkdown,
} = require('../src/knowledge/ecosystem-corpus.cjs');

const githubRepos = [
  {
    name: 'alphaonze',
    description: 'AlphaOnze monorepo',
    visibility: 'PRIVATE',
    url: 'https://github.com/Funesterie/alphaonze',
    defaultBranchRef: { name: 'master' },
    isArchived: false,
  },
  {
    name: 'funesterie',
    description: '',
    visibility: 'PUBLIC',
    url: 'https://github.com/Funesterie/funesterie',
    defaultBranchRef: { name: '' },
    isArchived: false,
  },
  {
    name: 'secret',
    description: '',
    visibility: 'PRIVATE',
    url: 'https://github.com/Funesterie/secret',
    defaultBranchRef: { name: 'main' },
    isArchived: false,
  },
];

test('ecosystem corpus builds source cards, briefs, domains and boundaries', () => {
  const scope = buildEcosystemScope({
    generatedAt: '2026-05-15T00:00:00.000Z',
    githubRepos,
  });
  const corpus = buildEcosystemCorpus(scope, {
    generatedAt: '2026-05-15T01:00:00.000Z',
  });

  assert.equal(corpus.schema, 'funesterie.ecosystem-corpus.v1');
  assert.ok(corpus.sourceCards.length > githubRepos.length);
  assert.equal(corpus.repoBriefs.length, githubRepos.length);
  assert.ok(corpus.domains.some((domain) => domain.id === 'orchestration'));
  assert.ok(corpus.boundaries.some((boundary) => boundary.id === 'restricted-vault'));

  const secret = corpus.sourceCards.find((card) => card.subjectId === 'repo:secret');
  assert.equal(secret.boundary, 'restricted-vault');
  assert.equal(secret.domains.includes('restricted'), true);
  assert.ok(secret.identityHashtags.includes('#metadata-node') || secret.identityHashtags.includes('#restricted'));

  const publicRepo = corpus.sourceCards.find((card) => card.subjectId === 'repo:funesterie');
  assert.equal(publicRepo.boundary, 'public-summary');
  assert.ok(publicRepo.identityHashtags.includes('#ecosystem-nexus'));

  const a11 = corpus.sourceCards.find((card) => card.subjectId === 'repo:alphaonze');
  assert.match(a11.identityPrompt, /Do not represent this entity as a human character/);
});

test('ecosystem corpus exports summaries and cypher without secrets', () => {
  const scope = buildEcosystemScope({
    generatedAt: '2026-05-15T00:00:00.000Z',
    githubRepos,
  });
  const corpus = buildEcosystemCorpus(scope, {
    generatedAt: '2026-05-15T01:00:00.000Z',
  });
  const summary = summarizeCorpus(corpus);
  const markdown = toMarkdown(corpus);
  const cypher = toCypher(corpus);

  assert.equal(summary.repoCards, 3);
  assert.ok(summary.restrictedCards >= 1);
  assert.match(markdown, /Repository Briefs/);
  assert.match(markdown, /Identity Hashtags/);
  assert.match(markdown, /Boundary:/);
  assert.match(cypher, /FunesterieSourceCard/);
  assert.match(cypher, /FunesterieIdentityProfile/);
  assert.equal(/token\s*[:=]|password\s*[:=]|bearer\s+/i.test(markdown), false);
});

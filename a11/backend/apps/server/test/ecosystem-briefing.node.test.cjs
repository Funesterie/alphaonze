'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildEcosystemScope } = require('../src/knowledge/ecosystem-scope.cjs');
const { buildEcosystemCorpus } = require('../src/knowledge/ecosystem-corpus.cjs');
const {
  buildEcosystemBriefing,
  summarizeBriefing,
  toArchitectureMarkdown,
  toBriefingHtml,
  toExecutiveMarkdown,
} = require('../src/knowledge/ecosystem-briefing.cjs');

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
    name: 'a11mcp',
    description: 'Shared MCP bridge',
    visibility: 'PRIVATE',
    url: 'https://github.com/Funesterie/a11mcp',
    defaultBranchRef: { name: 'main' },
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

test('ecosystem briefing builds executive and architecture views', () => {
  const scope = buildEcosystemScope({
    generatedAt: '2026-05-15T00:00:00.000Z',
    githubRepos,
  });
  const corpus = buildEcosystemCorpus(scope, {
    generatedAt: '2026-05-15T01:00:00.000Z',
  });
  const briefing = buildEcosystemBriefing(scope, corpus, {
    generatedAt: '2026-05-15T02:00:00.000Z',
  });

  assert.equal(briefing.schema, 'funesterie.ecosystem-briefing.v1');
  assert.equal(briefing.architecture.pageCount, 10);
  assert.equal(briefing.repoMatrix.length, 3);
  assert.ok(briefing.domainStats.length > 0);
  assert.ok(briefing.boundaryMatrix.some((row) => row.id === 'restricted-vault'));
  assert.ok(briefing.identityMatrix.some((row) => row.id === 'identity:a11'));
  assert.ok(briefing.identityMatrix.some((row) => row.id === 'identity:nossen'));
  assert.ok(briefing.moduleInventory.summary.localModules > 0);
  assert.ok(briefing.moduleInventory.summary.semanticTools > 0);

  const summary = summarizeBriefing(briefing);
  assert.equal(summary.scopeRepos, 3);
  assert.equal(summary.architecturePages, 10);
  assert.ok(summary.identityProfiles > 0);
  assert.ok(summary.totalModuleEntries > 0);
  assert.equal(typeof summary.hash, 'string');
});

test('ecosystem briefing exports shareable text without secret-looking values', () => {
  const scope = buildEcosystemScope({
    generatedAt: '2026-05-15T00:00:00.000Z',
    githubRepos,
  });
  const corpus = buildEcosystemCorpus(scope, {
    generatedAt: '2026-05-15T01:00:00.000Z',
  });
  const briefing = buildEcosystemBriefing(scope, corpus, {
    generatedAt: '2026-05-15T02:00:00.000Z',
  });

  const executive = toExecutiveMarkdown(briefing);
  const architecture = toArchitectureMarkdown(briefing);
  const html = toBriefingHtml(briefing);

  assert.match(executive, /Vue executive/);
  assert.match(executive, /Langage identitaire/);
  assert.match(architecture, /Page 8 - Modele graphe Neo4j/);
  assert.match(architecture, /Matrice identites/);
  assert.match(architecture, /Inventaire complet des modules/);
  assert.match(html, /Briefing ecosysteme Funesterie/);

  const all = [executive, architecture, html].join('\n');
  assert.equal(/bearer\s+[a-z0-9._~+/=-]{16,}|hf_[a-z0-9]{16,}|sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9_]{20,}|api[_-]?key\s*[:=]|token\s*[:=]|password\s*[:=]/i.test(all), false);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildEcosystemScope,
  summarizeScope,
  toCypher,
  toMarkdown,
} = require('../src/knowledge/ecosystem-scope.cjs');

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
    description: 'MCP bridge',
    visibility: 'PRIVATE',
    url: 'https://github.com/Funesterie/a11mcp',
    defaultBranchRef: { name: 'main' },
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
];

test('ecosystem scope maps repos modules contracts and access profiles', () => {
  const scope = buildEcosystemScope({
    generatedAt: '2026-05-15T00:00:00.000Z',
    githubRepos,
  });

  assert.equal(scope.schema, 'funesterie.ecosystem-scope.v1');
  assert.equal(scope.github.repoCount, 3);
  assert.equal(scope.summary.privateRepos, 2);
  assert.equal(scope.summary.publicRepos, 1);
  assert.equal(scope.summary.curatedRepoProfiles >= 2, true);
  assert.ok(scope.localModules.some((item) => item.id === 'a11mcp-bridge'));
  assert.ok(scope.contracts.some((item) => item.id === 'ecosystem-scope-json'));
  assert.ok(scope.semanticTools.some((item) => item.id === 'ecosystem-scope'));
  assert.ok(scope.accessProfiles.some((item) => item.id === 'a11mcp-chatgpt-public'));
  assert.ok(scope.identityLayer.profiles.some((item) => item.id === 'identity:a11'));
  assert.ok(scope.identityLayer.profiles.some((item) => item.id === 'identity:nossen'));
  assert.ok(scope.github.repos.find((repo) => repo.name === 'alphaonze').identityHashtags.includes('#multimodal-core'));
  assert.match(scope.github.repos.find((repo) => repo.name === 'alphaonze').profile.technicalRole, /Main application monorepo/);
  assert.ok(scope.links.some((link) => link.from === 'codex-local-github-cli' && link.type === 'CAN_INDEX'));
  assert.ok(scope.links.some((link) => link.type === 'HAS_IDENTITY_PROFILE'));
});

test('ecosystem scope exports compact summaries and cypher', () => {
  const scope = buildEcosystemScope({
    generatedAt: '2026-05-15T00:00:00.000Z',
    githubRepos,
  });
  const summary = summarizeScope(scope);
  const markdown = toMarkdown(scope);
  const cypher = toCypher(scope);

  assert.equal(summary.repos, 3);
  assert.match(markdown, /Funesterie Ecosystem Scope/);
  assert.match(markdown, /A11MCP HTTP JSON-RPC/);
  assert.match(markdown, /Identity Hashtags/);
  assert.match(markdown, /#multimodal-core/);
  assert.match(cypher, /FunesterieEcosystemScope/);
  assert.match(cypher, /FunesterieRepository/);
  assert.match(cypher, /FunesterieIdentityProfile/);
});

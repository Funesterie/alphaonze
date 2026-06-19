'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAgentDomainPack,
  summarizePack,
  toCypher,
  toMarkdown,
} = require('../src/knowledge/agent-domain-pack.cjs');
const {
  buildGraphTriplets,
} = require('../scripts/seed-agent-domain-pack.cjs');

test('agent domain pack covers A11, K44 and Vivy with broad domains', () => {
  const pack = buildAgentDomainPack({
    generatedAt: '2026-05-14T00:00:00.000Z',
    sfxAssets: [
      {
        id: 'sfx:notify',
        fileName: 'notify.wav',
        tags: ['sfx', 'status', 'accessibility'],
        assignedAgents: ['a11', 'vivy', 'kaen44'],
        sourceRoots: ['test'],
        pathHashes: ['hash'],
        usage: 'attention cue',
      },
    ],
  });

  const agents = new Set(pack.agents.map((agent) => agent.id));
  assert.deepEqual(agents, new Set(['a11', 'kaen44', 'vivy']));

  const domains = new Set(pack.domains.map((domain) => domain.id));
  for (const expected of [
    'sfx',
    'coding',
    'language',
    'philosophy',
    'culture',
    'cinema',
    'manga-anime',
    'music',
    'books',
    'knowledge-graph',
    'education',
  ]) {
    assert.equal(domains.has(expected), true, `${expected} should be present`);
  }

  const vivy = pack.agents.find((agent) => agent.id === 'vivy');
  assert.ok(vivy.tools.includes('vivy-studio'));
  assert.ok(vivy.domains.includes('music'));
  assert.ok(vivy.sfxPalette.includes('sfx:notify'));
  assert.ok(vivy.identityHashtags.includes('#voice-core'));
  assert.match(vivy.identityPrompt, /pink-violet/);

  const graphDomain = pack.domains.find((domain) => domain.id === 'knowledge-graph');
  assert.ok(graphDomain.hookChain.includes('neo4j'));
  assert.ok(graphDomain.hookChain.includes('rome'));
});

test('agent domain pack exports markdown, cypher and graph triplets', () => {
  const pack = buildAgentDomainPack({
    generatedAt: '2026-05-14T00:00:00.000Z',
    sfxAssets: [],
  });
  const summary = summarizePack(pack);
  const markdown = toMarkdown(pack);
  const cypher = toCypher(pack);
  const triplets = buildGraphTriplets(pack);

  assert.equal(summary.agents, 3);
  assert.equal(summary.identityProfiles, 3);
  assert.ok(summary.domains >= 15);
  assert.ok(summary.tools >= 20);
  assert.match(markdown, /Vivy/);
  assert.match(markdown, /#multimodal-core/);
  assert.match(markdown, /Source Policy/);
  assert.match(cypher, /A11DomainPack/);
  assert.match(cypher, /FunesterieIdentityProfile/);
  assert.match(cypher, /A11KnowledgeDomain/);
  assert.ok(triplets.some((triplet) => triplet.subject === 'Vivy' && triplet.predicate === 'has_domain'));
  assert.ok(triplets.some((triplet) => triplet.predicate === 'teaches'));
});

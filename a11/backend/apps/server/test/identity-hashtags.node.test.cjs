'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildIdentityLayer,
  buildIdentityPromptFragment,
  compactIdentityProfile,
  identityLinksForEntity,
  resolveIdentityProfile,
} = require('../src/knowledge/identity-hashtags.cjs');

test('identity hashtags define stable agent and universe archetypes', () => {
  const a11 = resolveIdentityProfile('a11');
  const kaen = resolveIdentityProfile('k44');
  const nossen = resolveIdentityProfile('nossen');

  assert.equal(a11.identityType, 'agent');
  assert.ok(a11.hashtags.includes('#multimodal-core'));
  assert.ok(a11.visualHashtags.includes('#not-human-character'));
  assert.equal(a11.visualIdentity.humanRepresentationAllowed, false);

  assert.equal(kaen.id, 'kaen44');
  assert.ok(kaen.hashtags.includes('#field-agent'));
  assert.ok(kaen.visualHashtags.includes('#human-character'));
  assert.equal(kaen.visualIdentity.humanRepresentationAllowed, true);

  assert.equal(nossen.identityType, 'universe');
  assert.ok(nossen.hashtags.includes('#universe-nexus'));
  assert.match(buildIdentityPromptFragment('nossen'), /living .*universe\/nexus/);
});

test('technical module fallback stays non-human and graph-linkable', () => {
  const identity = resolveIdentityProfile('custom-worker', {
    kind: 'worker-runtime',
    name: 'Custom Worker',
    domains: ['runtime', 'orchestration'],
  });
  const layer = buildIdentityLayer([{ id: 'custom-worker', identity }]);
  const links = identityLinksForEntity('custom-worker', compactIdentityProfile(identity));

  assert.equal(identity.visualIdentity.humanRepresentationAllowed, false);
  assert.ok(identity.hashtags.includes('#runtime'));
  assert.ok(layer.summary.profiles >= 1);
  assert.ok(links.some((link) => link.type === 'HAS_IDENTITY_PROFILE'));
  assert.ok(links.some((link) => link.type === 'HAS_IDENTITY_HASHTAG'));
  assert.ok(links.some((link) => link.type === 'HAS_IDENTITY_TAG'));
});

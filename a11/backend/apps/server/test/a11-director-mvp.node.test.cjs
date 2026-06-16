const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planA11DirectorMvp,
} = require('../src/video/a11-director-mvp.cjs');

test('planA11DirectorMvp builds 50cc Director plan without web or LLM', async () => {
  const plan = await planA11DirectorMvp({
    prompt: 'Clip nocturne Beta AM6 50cc carbu OKO powerjet pot Metrakit passage bas radiateurs lateraux plaque phare',
    request: { sourceImageUrl: 'https://files.example.com/beta.png' },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.providerUsed, 'heuristic');
  assert.ok(plan.objectCards.some((card) => /OKO/i.test(card.term)));
  assert.ok(plan.objectCards.some((card) => /Metrakit/i.test(card.term)));
  assert.ok(plan.spatialLocks.some((lock) => /adult-size|50cc|supermoto/i.test(lock.positiveModel)));
  assert.ok(plan.referenceBoard.roleSeparationRules.some((rule) => /style references never replace/i.test(rule)));
  assert.ok(plan.regenerationPolicy.positiveRestatementOrder.join(' ').includes('vehicle identity'));
  assert.ok(plan.storyboardBeats.some((beat) => /garage/i.test(beat.label)));
  assert.ok(plan.storyboardBeats.some((beat) => /macro/i.test(beat.label)));
  assert.ok(plan.plannerLocks.some((entry) => /radiators|radiateurs/i.test(entry)));
  assert.ok(plan.plannerNegativeFragments.some((entry) => /front radiator|radiateur frontal/i.test(entry)));
});

test('planA11DirectorMvp keeps positive structure when web context helper throws', async () => {
  const plan = await planA11DirectorMvp({
    prompt: '50cc AM6 OKO powerjet',
    lookupWebContext: async () => {
      throw new Error('network_down');
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.providerUsed, 'heuristic');
  assert.equal(plan.fallbackReason, 'research_failed');
  assert.ok(plan.objectCards.length > 0);
  assert.ok(plan.spatialLocks.length > 0);
  assert.ok(plan.referenceBoard.roleSeparationRules.length > 0);
});

test('planA11DirectorMvp accepts injected reference pack without mixing style and identity roles', async () => {
  const plan = await planA11DirectorMvp({
    prompt: '50cc AM6 OKO powerjet Metrakit passage bas neon pluie',
    resolveReferencePack: async () => ({
      references: [
        {
          role: 'vehicle_identity',
          label: 'Beta RR 50 side view',
          imageUrl: 'https://images.example.com/beta-side.jpg',
          sourceUrl: 'https://example.com/beta',
        },
        {
          role: 'art_direction',
          label: 'neon wet parking',
          imageUrl: 'https://images.example.com/neon.jpg',
          sourceUrl: 'https://example.com/neon',
        },
      ],
    }),
  });

  assert.equal(plan.referenceBoard.identityReferences[0].role, 'vehicle_identity');
  assert.equal(plan.referenceBoard.styleReferences[0].role, 'art_direction');
  assert.notEqual(plan.referenceBoard.identityReferences[0].imageUrl, plan.referenceBoard.styleReferences[0].imageUrl);
});

test('planA11DirectorMvp does not call reference composite helper unless explicitly enabled', async () => {
  let compositeCalls = 0;
  const plan = await planA11DirectorMvp({
    prompt: '50cc AM6 OKO powerjet Metrakit passage bas neon pluie',
    resolveReferencePack: async () => ({
      references: [{ role: 'vehicle_identity', label: 'Beta RR 50 side view' }],
    }),
    buildReferenceComposite: async () => {
      compositeCalls += 1;
      return { imageUrl: 'https://images.example.com/composite.jpg' };
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(compositeCalls, 0);
  assert.equal(plan.referenceBoard.compositeImageUrl, '');
});

test('planA11DirectorMvp returns disabled for unrelated prompt', async () => {
  const plan = await planA11DirectorMvp({
    prompt: 'video de nuages abstraits',
  });

  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.objectCards, []);
  assert.deepEqual(plan.plannerLocks, []);
});

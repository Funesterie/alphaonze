const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDirectorPlannerContext,
  normalizeDirectorPlan,
} = require('../src/video/a11-director-contract.cjs');

test('normalizeDirectorPlan clamps and preserves Director arrays', () => {
  const plan = normalizeDirectorPlan({
    enabled: true,
    providerUsed: 'heuristic',
    fallbackReason: '',
    creativeBrief: { rawPrompt: '  test  ' },
    extractedTerms: [{ term: 'OKO', confidence: 2, evidence: ['prompt'] }],
    objectCards: [{ term: 'OKO', confidence: 0.9, mustShow: ['carburetor'] }],
    spatialLocks: [{
      subject: '50cc',
      positiveModel: 'adult-size European 50cc supermoto',
      confidence: -1,
      stableGeometry: ['headlight plate'],
      zones: { front: ['headlight plate'], side: ['lateral radiators'] },
    }],
    referenceBoard: {
      identityReferences: [{ role: 'vehicle_identity', confidence: 2 }],
      spatialReferences: [],
      styleReferences: [],
      roleSeparationRules: ['style references never replace vehicle identity references'],
    },
    storyboardBeats: [{ label: 'garage', sceneGoal: 'prep' }],
    verificationChecklist: { id: 'v', mustPass: ['ok'], rejectIf: ['bad'] },
    regenerationPolicy: {
      errorSignals: ['front_radiator_replaced_headlight'],
      correctionHintsByError: {
        front_radiator_replaced_headlight: ['front headlight plate visible first'],
      },
      positiveRestatementOrder: ['vehicle identity', 'front zone', 'side radiator zone'],
      negativeGuardrails: ['no huge front radiator'],
      maxAttempts: 2,
    },
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.creativeBrief.rawPrompt, 'test');
  assert.equal(plan.extractedTerms[0].confidence, 1);
  assert.equal(plan.spatialLocks[0].confidence, 0);
  assert.deepEqual(plan.spatialLocks[0].zones.front, ['headlight plate']);
  assert.equal(plan.referenceBoard.identityReferences[0].confidence, 1);
  assert.deepEqual(plan.verificationChecklist.rejectIf, ['bad']);
  assert.equal(plan.regenerationPolicy.maxAttempts, 2);
});

test('buildDirectorPlannerContext appends compact facts without changing base prompt', () => {
  const context = buildDirectorPlannerContext({
    enabled: true,
    plannerFacts: ['OKO is a small carburetor near engine intake'],
    plannerLocks: ['radiators stay lateral behind shrouds'],
    plannerNegativeFragments: ['no huge front radiator'],
  }, {
    compiledBasePrompt: 'clip 50cc nocturne',
    existingVisualContext: 'wet garage',
    existingSubjectFacts: ['same rider'],
  });

  assert.equal(context.compiledBasePrompt, 'clip 50cc nocturne');
  assert.match(context.compiledVisualContext, /wet garage/);
  assert.match(context.compiledVisualContext, /radiators stay lateral/);
  assert.ok(context.subjectFacts.includes('same rider'));
  assert.ok(context.subjectFacts.some((entry) => /OKO is a small carburetor/i.test(entry)));
});

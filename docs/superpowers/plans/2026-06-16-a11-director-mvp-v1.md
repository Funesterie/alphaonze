# A11 Director MVP V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight A11 Director layer that runs before the current video sequence planner, adds semantic/object/spatial guidance for video prompts, and falls back cleanly without changing the public video route contract.

**Architecture:** Add small CommonJS modules under `src/video/` for the Director contract, 50cc motorcycle domain heuristics, and MVP orchestration. The Director is a semantic-to-spatial compiler, not a negative-prompt engine: it builds positive object identity, spatial placement, reference grounding, and verifier criteria before the existing planner runs. `video-generate-runtime.cjs` calls the Director once after reference analysis and before `planVideoSequence`, then passes enriched context through existing request fields already consumed by the planner.

**Tech Stack:** Node.js CommonJS, `node:test`, existing A11 video runtime, optional injected LLM/research helpers, no real video generation, no secrets, no heavy jobs.

---

## Scope Boundaries

This plan implements MVP V1 only.

In scope:

- Structured Director plan for video generation.
- Local deterministic 50cc motorcycle domain resolver.
- Optional injected web/LLM enrichment with bounded fallbacks.
- Positive spatial model first; negative fragments only as final guardrails.
- Minimal reference board metadata that separates identity references from style references.
- Regeneration policy metadata based on verifier errors, without running regeneration yet.
- Runtime integration before `video-sequence-planner`.
- Unit tests using stubs only.

Out of scope:

- Real video generation.
- Async job queue implementation.
- Production deploy.
- Secret reads.
- Refactor of existing video planner internals.
- Broad provider changes.

## File Structure

Create:

- `a11/backend/apps/server/src/video/a11-director-contract.cjs`  
  Owns data shapes, normalization, and prompt-context compilation for Director output.

- `a11/backend/apps/server/src/video/a11-director-motorcycle-domain.cjs`  
  Owns deterministic 50cc/mecanoboite term extraction and spatial facts. This keeps the first mandatory test case independent from LLM/research.

- `a11/backend/apps/server/src/video/a11-director-mvp.cjs`  
  Owns MVP orchestration: creative brief -> extracted terms -> optional research -> object cards -> spatial locks -> reference board -> storyboard beats -> verification checklist -> regeneration policy.

- `a11/backend/apps/server/test/a11-director-contract.node.test.cjs`  
  Tests contract normalization and planner context output.

- `a11/backend/apps/server/test/a11-director-motorcycle-domain.node.test.cjs`  
  Tests the required 50cc mappings.

- `a11/backend/apps/server/test/a11-director-mvp.node.test.cjs`  
  Tests MVP orchestration, existing reference-module handoff, positive structure, and fallbacks with injected stubs.

- `a11/backend/apps/server/test/video-generate-runtime-a11-director.node.test.cjs`  
  Tests runtime branch point without real video generation.

Modify:

- `a11/backend/apps/server/src/video/video-generate-runtime.cjs:25`  
  Import `planA11DirectorMvp` and `buildDirectorPlannerContext`.

- `a11/backend/apps/server/src/video/video-generate-runtime.cjs:3124`  
  Call Director after `compiledBasePrompt` is created and before `planVideoSequence`.

- `a11/backend/apps/server/src/video/video-generate-runtime.cjs:3640`  
  Add optional `a11Director` metadata under `sequencePlanning`, keeping existing response fields unchanged.

Do not modify:

- `a11/backend/apps/server/src/video/video-sequence-planner.cjs` for MVP V1.
- Public route files.
- Provider credentials or env files.
- Deployment scripts.

Reference-module integration in MVP V1:

- Do not call real web by default.
- Do not generate composites by default.
- Prepare a normalized `referenceBoard` that can consume results from existing modules later:
  - `a11/backend/apps/server/src/knowledge/image-hint-web-context.cjs`
  - `a11/backend/apps/server/src/knowledge/image-reference-pack.cjs`
  - `a11/backend/apps/server/src/knowledge/image-reference-composite.cjs`
- The MVP orchestrator accepts injected helpers named `lookupWebContext`, `resolveReferencePack`, and `buildReferenceComposite`. Tests stub these helpers. Production wiring can stay disabled until validation.
- Separate reference roles strictly: vehicle identity, front/headlight plate, engine/carburetor, exhaust, radiator/shroud, and art direction. A style reference must not replace an identity or spatial reference.

## Planned Interfaces

Use JSDoc typedefs in `a11-director-contract.cjs` because this server code is CommonJS.

```js
/**
 * @typedef {Object} A11DirectorCreativeBrief
 * @property {string} rawPrompt
 * @property {string} normalizedPrompt
 * @property {string[]} lyricsFragments
 * @property {string[]} referenceImageUrls
 * @property {string[]} referenceImagePaths
 * @property {string[]} styleHints
 * @property {string[]} userForbidden
 */

/**
 * @typedef {Object} A11DirectorExtractedTerm
 * @property {string} term
 * @property {string} normalized
 * @property {string} domain
 * @property {string} category
 * @property {number} confidence
 * @property {string[]} evidence
 * @property {string[]} ambiguity
 */

/**
 * @typedef {Object} A11DirectorObjectCard
 * @property {string} term
 * @property {string} domain
 * @property {string} resolvedMeaning
 * @property {number} confidence
 * @property {string} visualRole
 * @property {string} spatialRole
 * @property {string[]} mustShow
 * @property {string[]} forbidden
 * @property {string[]} queriesUsed
 * @property {string[]} sourceFacts
 * @property {string} clipUse
 */

/**
 * @typedef {Object} A11DirectorSpatialLock
 * @property {string} subject
 * @property {string} positiveModel
 * @property {string[]} stableGeometry
 * @property {Object.<string,string[]>} zones
 * @property {string[]} placements
 * @property {string[]} forbiddenPlacements
 * @property {string[]} negativePromptFragments
 * @property {number} confidence
 */

/**
 * @typedef {Object} A11DirectorReferenceBoardItem
 * @property {string} role
 * @property {string} label
 * @property {string} query
 * @property {string} sourceUrl
 * @property {string} imageUrl
 * @property {string[]} facts
 * @property {number} confidence
 */

/**
 * @typedef {Object} A11DirectorReferenceBoard
 * @property {A11DirectorReferenceBoardItem[]} identityReferences
 * @property {A11DirectorReferenceBoardItem[]} spatialReferences
 * @property {A11DirectorReferenceBoardItem[]} styleReferences
 * @property {string[]} roleSeparationRules
 * @property {string|null} compositeImageUrl
 */

/**
 * @typedef {Object} A11DirectorStoryboardBeat
 * @property {string} label
 * @property {string} sceneGoal
 * @property {string[]} requiredObjects
 * @property {string[]} spatialLocks
 * @property {string[]} cameraHints
 * @property {string[]} negativeConstraints
 * @property {string[]} verifierFocus
 */

/**
 * @typedef {Object} A11DirectorVerificationChecklist
 * @property {string} id
 * @property {string[]} mustPass
 * @property {string[]} rejectIf
 * @property {string[]} regenerationHints
 */

/**
 * @typedef {Object} A11DirectorRegenerationPolicy
 * @property {string[]} errorSignals
 * @property {Object.<string,string[]>} correctionHintsByError
 * @property {string[]} positiveRestatementOrder
 * @property {string[]} negativeGuardrails
 * @property {number} maxAttempts
 */

/**
 * @typedef {Object} A11DirectorPlan
 * @property {boolean} enabled
 * @property {string} providerUsed
 * @property {string|null} fallbackReason
 * @property {A11DirectorCreativeBrief} creativeBrief
 * @property {A11DirectorExtractedTerm[]} extractedTerms
 * @property {A11DirectorObjectCard[]} objectCards
 * @property {A11DirectorSpatialLock[]} spatialLocks
 * @property {A11DirectorReferenceBoard} referenceBoard
 * @property {A11DirectorStoryboardBeat[]} storyboardBeats
 * @property {A11DirectorVerificationChecklist} verificationChecklist
 * @property {A11DirectorRegenerationPolicy} regenerationPolicy
 * @property {string[]} plannerFacts
 * @property {string[]} plannerLocks
 * @property {string[]} plannerNegativeFragments
 */
```

Runtime integration will use this shape:

```js
const directorPlan = await planA11DirectorMvp({
  request,
  prompt: compiledBasePrompt,
  sourceImagePath,
  sourceImageUrl,
  fetchImpl,
  lookupWebContext,
  resolveReferencePack,
  buildReferenceComposite,
});

const directorContext = buildDirectorPlannerContext(directorPlan, {
  compiledBasePrompt,
  existingVisualContext: request.compiledVisualContext,
  existingSubjectFacts: request.subjectFacts,
});

request.a11Director = directorPlan;
request.compiledVisualContext = directorContext.compiledVisualContext;
request.subjectFacts = directorContext.subjectFacts;
```

`planVideoSequence` stays unchanged. It already reads `request.compiledVisualContext`, `request.subjectFacts`, reference dimensions, and source image fields.

## Fallback Behavior

Research failure:

- Return deterministic heuristic object cards and spatial locks.
- Set `providerUsed` to `heuristic`.
- Set `fallbackReason` to `research_failed`.
- Do not fail video generation.
- Keep `referenceBoard` role slots empty but preserve role separation rules.

LLM failure:

- Keep deterministic extraction and domain cards.
- Set `fallbackReason` to `llm_failed`.
- Keep planner inputs short and safe.
- Do not throw from Director.

Reference image failure:

- Keep textual spatial locks.
- Leave `referenceImageUrls` and `referenceImagePaths` normalized but empty if unusable.
- Do not call Janus or image fetch from the Director in MVP V1.
- Let existing `resolveVideoReferenceAnalysis` and `planVideoSequence` handle reference image analysis as they already do.
- Keep reference board metadata; mark missing reference facts by omission rather than inventing a source.

Empty or unrelated prompt:

- Return `enabled: false`, empty arrays, and no planner enrichment.
- `video-generate-runtime.cjs` continues exactly as before.

Unexpected Director exception:

- Catch in runtime integration.
- Log a short non-sensitive warning.
- Continue with original `compiledBasePrompt` and original `request` fields.

Bad generation in future verifier:

- Do not react by repeating long denial lists.
- Diagnose the failing structure, then restate the positive model first.
- Use negative fragments only as short final guardrails derived from the observed error.
- Example: if a huge radiator replaces the front, restate "front headlight plate visible; radiators lateral behind side shrouds" before adding "no huge front radiator".

## Task 1: Director Contract Module

**Files:**

- Create: `a11/backend/apps/server/src/video/a11-director-contract.cjs`
- Test: `a11/backend/apps/server/test/a11-director-contract.node.test.cjs`

- [ ] **Step 1: Write failing contract tests**

Add tests for:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDirectorPlan,
  buildDirectorPlannerContext,
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
```

- [ ] **Step 2: Run contract test and confirm failure**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\a11-director-contract.node.test.cjs
```

Expected: FAIL because `a11-director-contract.cjs` does not exist.

- [ ] **Step 3: Implement contract normalization**

Create exports:

```js
module.exports = {
  buildDirectorPlannerContext,
  normalizeDirectorPlan,
};
```

  Required behavior:

- Normalize strings by trimming whitespace.
- Clamp confidence values to `0..1`.
- Normalize missing arrays to empty arrays.
- Normalize `referenceBoard` to `{ identityReferences, spatialReferences, styleReferences, roleSeparationRules, compositeImageUrl }`.
- Normalize `regenerationPolicy` to `{ errorSignals, correctionHintsByError, positiveRestatementOrder, negativeGuardrails, maxAttempts }`.
- Preserve only compact strings, max 12 entries for planner facts/locks/negative fragments.
- Return `compiledBasePrompt` unchanged from input.
- Append Director facts/locks to `compiledVisualContext` and `subjectFacts`.

- [ ] **Step 4: Run contract test and confirm pass**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\a11-director-contract.node.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit contract task**

```powershell
git add a11/backend/apps/server/src/video/a11-director-contract.cjs a11/backend/apps/server/test/a11-director-contract.node.test.cjs
git commit -m "feat(video): add A11 Director contract"
```

## Task 2: 50cc Motorcycle Domain Resolver

**Files:**

- Create: `a11/backend/apps/server/src/video/a11-director-motorcycle-domain.cjs`
- Test: `a11/backend/apps/server/test/a11-director-motorcycle-domain.node.test.cjs`

- [ ] **Step 1: Write failing 50cc domain tests**

Add tests:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMotorcycleDirectorDomain,
} = require('../src/video/a11-director-motorcycle-domain.cjs');

test('resolves OKO powerjet as small carburetor near engine intake', () => {
  const result = resolveMotorcycleDirectorDomain('Beta AM6 50cc avec carbu OKO powerjet');
  const oko = result.objectCards.find((card) => /OKO/i.test(card.term));

  assert.ok(oko);
  assert.match(oko.resolvedMeaning, /carburetor|carbu/i);
  assert.match(oko.spatialRole, /engine intake|admission|moteur/i);
  assert.ok(oko.forbidden.some((entry) => /front object|frontal|reactor/i.test(entry)));
});

test('resolves Metrakit passage bas as low 2-stroke exhaust', () => {
  const result = resolveMotorcycleDirectorDomain('pot Metrakit passage bas sur AM6 50cc');
  const metrakit = result.objectCards.find((card) => /Metrakit/i.test(card.term));

  assert.ok(metrakit);
  assert.match(metrakit.resolvedMeaning, /exhaust|echappement|2-stroke|2T/i);
  assert.match(metrakit.spatialRole, /low|bas|under|sous/i);
});

test('locks lateral radiators and preserves front headlight plate', () => {
  const result = resolveMotorcycleDirectorDomain('50cc supermotard avec radiateurs lateraux et plaque phare');
  const lock = result.spatialLocks[0];
  const lockText = JSON.stringify(result.spatialLocks);

  assert.match(lock.positiveModel, /50cc|supermoto|mecaboite|moped/i);
  assert.deepEqual(lock.zones.front, ['headlight plate or number plate mask', 'high front fender']);
  assert.ok(lock.zones.side.some((entry) => /radiator|radiateur/i.test(entry)));
  assert.match(lockText, /radiators? (are )?side|radiateurs? lateraux/i);
  assert.match(lockText, /headlight plate|plaque phare/i);
  assert.match(lockText, /never replace|jamais remplacer|front radiator/i);
});

test('uses negative guardrails only after positive structure', () => {
  const result = resolveMotorcycleDirectorDomain('clip 50cc mecaboite street stunt');
  const positiveOrder = result.regenerationPolicy.positiveRestatementOrder.join(' ');
  const rejectText = result.verificationChecklist.rejectIf.join(' ');

  assert.match(positiveOrder, /vehicle identity/i);
  assert.match(positiveOrder, /front zone/i);
  assert.match(positiveOrder, /side radiator/i);
  assert.match(rejectText, /big road bike|gros cube|superbike/i);
  assert.match(rejectText, /pocket bike/i);
  assert.match(rejectText, /scooter/i);
  assert.match(rejectText, /huge front radiator|radiateur frontal/i);
});
```

- [ ] **Step 2: Run 50cc domain test and confirm failure**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\a11-director-motorcycle-domain.node.test.cjs
```

Expected: FAIL because resolver file does not exist.

- [ ] **Step 3: Implement deterministic resolver**

Export:

```js
module.exports = {
  resolveMotorcycleDirectorDomain,
};
```

Required behavior:

- Detect 50cc context from `50cc`, `AM6`, `Beta`, `Derbi`, `Rieju`, `mecaboite`, `supermotard`, `Oko`, `Metrakit`, `powerjet`.
- Return extracted terms for OKO, powerjet, Metrakit, AM6, radiators, headlight plate when present.
- Return object cards:
  - OKO/powerjet -> small carburetor near engine intake.
  - Metrakit passage bas -> low-passage 2-stroke exhaust.
  - AM6 -> 50cc 2-stroke engine family context.
  - radiators -> lateral side radiators behind shrouds.
  - plaque phare -> front headlight plate or number plate mask.
- Return one spatial lock for adult-size European 50cc supermoto geometry with explicit zones:
  - `front`: headlight plate or number plate mask, high front fender.
  - `side`: side shrouds, lateral radiators.
  - `engineArea`: AM6-style compact 2-stroke engine, OKO carburetor near intake, fuel hose.
  - `lowerFrame`: Metrakit-style low-passage 2T exhaust.
- Return a role-separated reference board seed:
  - `vehicle_identity`
  - `front_headlight_plate`
  - `engine_carburetor`
  - `low_exhaust`
  - `side_radiator_shroud`
  - `art_direction`
- Return verification checklist rejecting big road bike, superbike, pocket bike, scooter, muddy motocross when street context is requested, and huge front radiator.
- Return regeneration policy that restates positive identity and zones before short negative guardrails.

- [ ] **Step 4: Run 50cc domain test and confirm pass**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\a11-director-motorcycle-domain.node.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit 50cc resolver task**

```powershell
git add a11/backend/apps/server/src/video/a11-director-motorcycle-domain.cjs a11/backend/apps/server/test/a11-director-motorcycle-domain.node.test.cjs
git commit -m "feat(video): add 50cc Director domain resolver"
```

## Task 3: MVP Director Orchestrator

**Files:**

- Create: `a11/backend/apps/server/src/video/a11-director-mvp.cjs`
- Test: `a11/backend/apps/server/test/a11-director-mvp.node.test.cjs`

- [ ] **Step 1: Write failing MVP orchestration tests**

Add tests:

```js
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

test('planA11DirectorMvp returns disabled for unrelated prompt', async () => {
  const plan = await planA11DirectorMvp({
    prompt: 'video de nuages abstraits',
  });

  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.objectCards, []);
  assert.deepEqual(plan.plannerLocks, []);
});
```

- [ ] **Step 2: Run MVP test and confirm failure**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\a11-director-mvp.node.test.cjs
```

Expected: FAIL because `a11-director-mvp.cjs` does not exist.

- [ ] **Step 3: Implement MVP orchestration**

Export:

```js
module.exports = {
  planA11DirectorMvp,
};
```

Required behavior:

- Build creative brief from prompt and source image fields.
- Call `resolveMotorcycleDirectorDomain(prompt)`.
- If no terms/object cards are found, return a normalized disabled plan.
- If optional `lookupWebContext` is provided, call it with at most 3 deterministic queries from object cards. This is the future integration point for `image-hint-web-context.cjs`.
- If optional `resolveReferencePack` is provided, call it with a role-aware request derived from object cards and spatial locks. This is the future integration point for `image-reference-pack.cjs`.
- If optional `buildReferenceComposite` is provided, call it only when `resolveReferencePack` returns references and an explicit config flag enables composite building. This is the future integration point for `image-reference-composite.cjs`; default MVP behavior keeps it disabled.
- Convert reference pack entries into `referenceBoard.identityReferences`, `referenceBoard.spatialReferences`, and `referenceBoard.styleReferences`.
- Never let an `art_direction` or style reference satisfy `vehicle_identity`, `front_headlight_plate`, `engine_carburetor`, `low_exhaust`, or `side_radiator_shroud`.
- On research error, keep heuristic output and set `fallbackReason: 'research_failed'`.
- Do not call real web by default.
- Do not fetch or inspect images in MVP V1.
- Build `regenerationPolicy` from verifier risks, with positive restatement order before negative guardrails.
- Normalize final output through `normalizeDirectorPlan`.

- [ ] **Step 4: Run MVP test and confirm pass**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\a11-director-mvp.node.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit MVP orchestrator task**

```powershell
git add a11/backend/apps/server/src/video/a11-director-mvp.cjs a11/backend/apps/server/test/a11-director-mvp.node.test.cjs
git commit -m "feat(video): add A11 Director MVP planner"
```

## Task 4: Branch Director Before Video Sequence Planner

**Files:**

- Modify: `a11/backend/apps/server/src/video/video-generate-runtime.cjs:25`
- Modify: `a11/backend/apps/server/src/video/video-generate-runtime.cjs:3124`
- Modify: `a11/backend/apps/server/src/video/video-generate-runtime.cjs:3640`
- Test: `a11/backend/apps/server/test/video-generate-runtime-a11-director.node.test.cjs`

- [ ] **Step 1: Write failing runtime integration test**

Create a test that stubs generation and checks metadata only:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createGenerateVideoHandler,
} = require('../src/video/video-generate-runtime.cjs');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64'
);

test('video runtime attaches A11 Director metadata before sequence planning without real video generation', async () => {
  const previousPlannerEnv = process.env.A11_VIDEO_SEQUENCE_PLANNER;
  process.env.A11_VIDEO_SEQUENCE_PLANNER = 'heuristic';

  try {
    const generateVideo = createGenerateVideoHandler({
      generateSd: async ({ body }) => ({
        ok: true,
        image_url: `https://files.example.com/frame-${body.width}x${body.height}.png`,
      }),
      fetch: async () => ({
        ok: true,
        async arrayBuffer() {
          return TINY_PNG;
        },
      }),
      uploadBufferToR2: async ({ filename, buffer }) => ({
        url: `https://files.example.com/${filename}`,
        filename,
        sizeBytes: buffer.length,
      }),
      buildCanonicalImageMaskFromText: async () => ({
        rawMask: {
          version: 'mask-1',
          intent: 'image.generate',
          raw: '50cc AM6 OKO',
        },
      }),
      compileMaskImageGenerateRuntime: async () => ({
        sdBody: {
          prompt: '50cc AM6 OKO powerjet Metrakit passage bas radiateurs lateraux plaque phare',
        },
      }),
      runFfmpeg: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, Buffer.from('fake-video'));
      },
    });

    const result = await generateVideo({
      req: { headers: {}, body: {} },
      prompt: '50cc AM6 OKO powerjet Metrakit passage bas radiateurs lateraux plaque phare',
      body: {
        prompt: '50cc AM6 OKO powerjet Metrakit passage bas radiateurs lateraux plaque phare',
        durationSeconds: 1,
        fps: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.sequencePlanning.providerUsed, 'heuristic');
    assert.equal(result.sequencePlanning.a11Director.enabled, true);
    assert.ok(result.sequencePlanning.a11Director.objectCards.some((card) => /OKO/i.test(card.term)));
    assert.ok(result.sequencePlanning.a11Director.spatialLocks.some((lock) => /adult-size|50cc|supermoto/i.test(lock.positiveModel)));
    assert.ok(result.sequencePlanning.a11Director.referenceBoard.roleSeparationRules.some((rule) => /style references never replace/i.test(rule)));
    assert.ok(result.sequencePlanning.a11Director.regenerationPolicy.positiveRestatementOrder.join(' ').includes('vehicle identity'));
    assert.ok(result.sequencePlanning.a11Director.verificationChecklist.rejectIf.some((entry) => /front radiator|radiateur frontal/i.test(entry)));
  } finally {
    if (previousPlannerEnv === undefined) delete process.env.A11_VIDEO_SEQUENCE_PLANNER;
    else process.env.A11_VIDEO_SEQUENCE_PLANNER = previousPlannerEnv;
  }
});
```

- [ ] **Step 2: Run runtime integration test and confirm failure**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\video-generate-runtime-a11-director.node.test.cjs
```

Expected: FAIL because runtime does not expose `sequencePlanning.a11Director`.

- [ ] **Step 3: Modify runtime import**

At `video-generate-runtime.cjs:25`, add imports:

```js
const {
  buildDirectorPlannerContext,
} = require('./a11-director-contract.cjs');
const {
  planA11DirectorMvp,
} = require('./a11-director-mvp.cjs');
```

- [ ] **Step 4: Modify runtime branch point**

At the block after:

```js
const compiledBasePrompt = String(request.prompt).trim();
```

insert Director planning with exception fallback:

```js
let a11DirectorPlan = null;
let effectiveCompiledBasePrompt = compiledBasePrompt;
try {
  a11DirectorPlan = await planA11DirectorMvp({
    request,
    prompt: compiledBasePrompt,
    sourceImagePath: String(
      effectiveInitialReference.initImagePath
      || request.sourceImagePath
      || (request.sourceType === 'image' ? request.sourcePath : '')
      || ''
    ).trim(),
    sourceImageUrl: String(
      effectiveInitialReference.initImageUrl
      || request.sourceImageUrl
      || (request.sourceType === 'image' ? request.sourceUrl : '')
      || ''
    ).trim(),
    fetchImpl,
  });

  const directorContext = buildDirectorPlannerContext(a11DirectorPlan, {
    compiledBasePrompt,
    existingVisualContext: request.compiledVisualContext,
    existingSubjectFacts: request.subjectFacts,
  });
  effectiveCompiledBasePrompt = directorContext.compiledBasePrompt;
  request.compiledVisualContext = directorContext.compiledVisualContext;
  request.subjectFacts = directorContext.subjectFacts;
} catch (directorError) {
  console.warn(`[A11][video-director] fallback: ${String(directorError?.message || directorError)}`);
  a11DirectorPlan = null;
}
```

Then pass:

```js
compiledBasePrompt: effectiveCompiledBasePrompt,
```

to `planVideoSequence`.

- [ ] **Step 5: Add optional metadata**

Under `sequencePlanning`, add:

```js
a11Director: a11DirectorPlan && typeof a11DirectorPlan === 'object'
  ? JSON.parse(JSON.stringify(a11DirectorPlan))
  : null,
```

This is additive metadata. Do not remove or rename existing fields.

- [ ] **Step 6: Run runtime integration test and confirm pass**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\video-generate-runtime-a11-director.node.test.cjs
```

Expected: PASS.

- [ ] **Step 7: Run existing video metadata test**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\video-generate-runtime.node.test.cjs --test-name-pattern "sequencePlanning metadata"
```

Expected: PASS. Existing `sequencePlanning` fields still exist.

- [ ] **Step 8: Commit runtime branch task**

```powershell
git add a11/backend/apps/server/src/video/video-generate-runtime.cjs a11/backend/apps/server/test/video-generate-runtime-a11-director.node.test.cjs
git commit -m "feat(video): branch A11 Director before sequence planner"
```

## Task 5: Focused Regression Suite

**Files:**

- Modify: no source files expected if earlier tasks pass
- Test: `a11/backend/apps/server/test/a11-director-motorcycle-domain.node.test.cjs`
- Test: `a11/backend/apps/server/test/a11-director-mvp.node.test.cjs`
- Test: `a11/backend/apps/server/test/video-generate-runtime-a11-director.node.test.cjs`
- Test: `a11/backend/apps/server/test/video-sequence-planner.node.test.cjs`

- [ ] **Step 1: Run Director tests together**

Run:

```powershell
node --test `
  D:\projets\funesterie\a11\backend\apps\server\test\a11-director-contract.node.test.cjs `
  D:\projets\funesterie\a11\backend\apps\server\test\a11-director-motorcycle-domain.node.test.cjs `
  D:\projets\funesterie\a11\backend\apps\server\test\a11-director-mvp.node.test.cjs `
  D:\projets\funesterie\a11\backend\apps\server\test\video-generate-runtime-a11-director.node.test.cjs
```

Expected: PASS.

- [ ] **Step 2: Run planner tests**

Run:

```powershell
node --test D:\projets\funesterie\a11\backend\apps\server\test\video-sequence-planner.node.test.cjs
```

Expected: PASS.

- [ ] **Step 3: Run relevant route/runtime tests**

Run:

```powershell
node --test `
  D:\projets\funesterie\a11\backend\apps\server\test\video-generate-runtime.node.test.cjs `
  D:\projets\funesterie\a11\backend\apps\server\test\video-generate-route.node.test.cjs
```

Expected: PASS. These are stubbed tests and must not generate real videos.

- [ ] **Step 4: Commit verification fixes if any were required**

Only commit if previous steps required test or implementation fixes:

```powershell
git add a11/backend/apps/server/src/video a11/backend/apps/server/test
git commit -m "test(video): cover A11 Director MVP integration"
```

If no fixes were required, skip this commit.

## Task 6: Documentation And Session Handoff

**Files:**

- Modify: `docs/superpowers/specs/a11-director-clip-director.md`
- Modify: `D:\projets\funesterie\a11\runtime\codex-session-state-current.md`
- Modify: `D:\projets\funesterie\a11\runtime\codex-session-state-2026-06-16.md`

- [ ] **Step 1: Add implementation note to spec**

Append a short "MVP V1 implementation status" section to `docs/superpowers/specs/a11-director-clip-director.md` after code is implemented:

```markdown
## MVP V1 Implementation Status

- Director contract, 50cc domain resolver, MVP orchestrator, and video runtime branch are implemented.
- The public video route contract is unchanged.
- Director enrichment runs before `video-sequence-planner` and falls back to the existing behavior on error.
- Tests cover OKO/powerjet, Metrakit passage bas, lateral radiators, plaque phare, positive spatial model, reference role separation, regeneration policy, big-bike rejection, and runtime metadata.
```

- [ ] **Step 2: Refresh Funesterie state**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Djeff\.codex\skills\funesterie-autostart\scripts\Update-CodexSessionState.ps1
```

Expected: JSON output with `"ok": true`.

- [ ] **Step 3: Add state note**

Append a short non-sensitive note to both state files:

```markdown
## 2026-06-16 A11 Director MVP V1 Implementation

- A11 Director MVP V1 implemented before `video-sequence-planner`.
- Public video route contract unchanged.
- New modules: `a11-director-contract.cjs`, `a11-director-motorcycle-domain.cjs`, `a11-director-mvp.cjs`.
- Tests cover mandatory 50cc mecanoboite case and runtime fallback.
- No secrets, no real video generation, no production deploy in this implementation pass.
```

- [ ] **Step 4: Commit docs and session note**

```powershell
git add docs/superpowers/specs/a11-director-clip-director.md D:\projets\funesterie\a11\runtime\codex-session-state-current.md D:\projets\funesterie\a11\runtime\codex-session-state-2026-06-16.md
git commit -m "docs: record A11 Director MVP status"
```

## Self-Review

Spec coverage:

- Exact files to create/modify are listed in File Structure and each task.
- Creative brief, extracted terms, object cards, spatial locks, reference board, storyboard beats, verification checklist, and regeneration policy interfaces are defined.
- The plan explicitly treats A11 Director as a semantic-to-spatial compiler, not a negative-prompt engine.
- The plan links future integration points to `image-hint-web-context.cjs`, `image-reference-pack.cjs`, and `image-reference-composite.cjs` through injected helpers that remain disabled by default in MVP V1.
- Runtime branch before `video-sequence-planner` is specified at the existing call site.
- Fallback behavior covers research, LLM, reference image, unrelated prompt, and unexpected exceptions.
- Mandatory 50cc tests cover OKO/powerjet, Metrakit passage bas, lateral radiators, plaque phare, positive structure, reference role separation, correction order, and rejection of big bike, pocket bike, scooter, and huge front radiator.
- Constraints are preserved: no real video generation, no heavy jobs, no secrets, no massive refactor.

Placeholder scan:

- No unresolved placeholders or undefined file path markers are present.

Type consistency:

- The plan consistently uses `A11DirectorCreativeBrief`, `A11DirectorExtractedTerm`, `A11DirectorObjectCard`, `A11DirectorSpatialLock`, `A11DirectorReferenceBoard`, `A11DirectorStoryboardBeat`, `A11DirectorVerificationChecklist`, `A11DirectorRegenerationPolicy`, and `A11DirectorPlan`.
- Runtime metadata name is consistently `sequencePlanning.a11Director`.

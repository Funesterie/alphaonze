const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyImageReferenceDecisionToMask,
  buildAutomaticImageReferenceFallbackDecision,
  extractRequestImageReferences,
  resolveImageReferenceDecision,
} = require('../src/image/janus-image-manifest.cjs');

test('extractRequestImageReferences collects scalar, array, and message image references without duplicates', () => {
  const references = extractRequestImageReferences({
    body: {
      sourceImageUrl: 'https://images.example.com/identity.png',
      referenceImages: [
        { imageId: 'style-1', url: 'https://images.example.com/style.png', roleHint: 'style_reference' },
        { imageId: 'style-1', url: 'https://images.example.com/style.png', roleHint: 'style_reference' },
      ],
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            imageId: 'pose-1',
            image_url: { url: 'https://images.example.com/pose.png' },
          },
        ],
      },
    ],
  });

  assert.equal(references.length, 3);
  assert.equal(references[0].locator, 'https://images.example.com/identity.png');
  assert.equal(references[1].declared_role, 'style_reference');
  assert.equal(references[2].image_id, 'pose-1');
});

test('resolveImageReferenceDecision prefers identity references and marks conflicting identity roles as ambiguous', () => {
  const decision = resolveImageReferenceDecision({
    references: [
      { image_id: 'img-a', locator: 'https://images.example.com/a.png', source_hint: 'sourceImages' },
      { image_id: 'img-b', locator: 'https://images.example.com/b.png', source_hint: 'sourceImages' },
      { image_id: 'img-c', locator: 'https://images.example.com/c.png', source_hint: 'referenceImages', declared_role: 'style_reference' },
    ],
    manifests: [
      {
        image_id: 'img-a',
        detected_content: 'front portrait of the same person',
        probable_role: 'identity',
        confidence: 0.84,
        quality_flags: [],
      },
      {
        image_id: 'img-b',
        detected_content: 'three-quarter portrait of the same person',
        probable_role: 'identity',
        confidence: 0.78,
        quality_flags: [],
      },
      {
        image_id: 'img-c',
        detected_content: 'green purple grungy cinematic color board',
        probable_role: 'style_reference',
        confidence: 0.95,
        quality_flags: ['composite'],
      },
    ],
  });

  assert.equal(decision.primary_image_id, 'img-a');
  assert.equal(decision.primary_role, 'identity');
  assert.equal(decision.clarification_required, true);
  assert.equal(Array.isArray(decision.conflicts), true);
  assert.equal(decision.conflicts.length, 1);
});

test('resolveImageReferenceDecision stays automatic when the top identity image has a clear policy lead', () => {
  const decision = resolveImageReferenceDecision({
    references: [
      { image_id: 'img-a', locator: 'https://images.example.com/a.png', source_hint: 'sourceImageUrl' },
      { image_id: 'img-b', locator: 'https://images.example.com/b.png', source_hint: 'sourceImages' },
    ],
    manifests: [
      {
        image_id: 'img-a',
        detected_content: 'front portrait of the same person',
        probable_role: 'identity',
        confidence: 0.66,
        quality_flags: [],
      },
      {
        image_id: 'img-b',
        detected_content: 'portrait of the same person',
        probable_role: 'identity',
        confidence: 0.62,
        quality_flags: [],
      },
    ],
  });

  assert.equal(decision.primary_image_id, 'img-a');
  assert.equal(decision.clarification_required, false);
  assert.equal(decision.decision_source, 'janus_manifest');
  assert.equal(decision.selection_mode, 'auto_primary');
});

test('applyImageReferenceDecisionToMask stores manifests, promotes the primary image, and turns secondary roles into A11-owned hints', () => {
  const mask = {
    intent: 'image.generate',
    inputs: {
      subject: ['reference subject'],
      environment: [],
      style: [],
      composition: [],
      lighting: [],
      palette: [],
    },
    meta: {
      promptInstructions: [],
    },
  };

  const nextMask = applyImageReferenceDecisionToMask(mask, {
    manifests: [
      {
        image_id: 'identity-1',
        detected_content: 'same man holding a bat over the shoulders with a wrapped left hand',
        probable_role: 'identity',
        confidence: 0.9,
        quality_flags: ['crop_needed'],
      },
      {
        image_id: 'style-1',
        detected_content: 'dirty green purple clown-noir palette',
        probable_role: 'style_reference',
        confidence: 0.88,
        quality_flags: ['composite'],
      },
      {
        image_id: 'prop-1',
        detected_content: 'custom decorated baseball bat',
        probable_role: 'accessory',
        confidence: 0.81,
        quality_flags: [],
      },
    ],
    primary_image_id: 'identity-1',
    primary_role: 'identity',
    primary_confidence: 0.9,
    clarification_required: false,
    conflicts: [],
  }, [
    { image_id: 'identity-1', locator: 'https://images.example.com/identity.png' },
    { image_id: 'style-1', locator: 'https://images.example.com/style.png' },
    { image_id: 'prop-1', locator: 'https://images.example.com/bat.png' },
  ]);

  assert.equal(nextMask.meta.init_image_url, 'https://images.example.com/identity.png');
  assert.equal(nextMask.meta.webImageDraft.imageReferenceRole, 'identity');
  assert.equal(nextMask.meta.imageReferenceDecision.primaryImageId, 'identity-1');
  assert.match(String(nextMask.meta.promptInstructions.join(', ') || ''), /focus on the main subject from the primary reference image/i);
  assert.match(String(nextMask.meta.promptInstructions.join(', ') || ''), /preserve these distinctive visible cues from the reference image: same man holding a bat over the shoulders with a wrapped hand on the same side as in the reference image/i);
  assert.match(String(nextMask.meta.promptInstructions.join(', ') || ''), /preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image/i);
  assert.match(String(nextMask.meta.promptInstructions.join(', ') || ''), /include uploaded accessory reference details: custom decorated baseball bat/i);
  assert.match(String(nextMask.inputs.style.join(', ') || ''), /style reference: dirty green purple clown-noir palette/i);
});

test('buildAutomaticImageReferenceFallbackDecision keeps A11 in charge when Janus is unavailable', () => {
  const references = [
    { image_id: 'identity-1', locator: 'https://images.example.com/identity.png' },
    { image_id: 'style-1', locator: 'https://images.example.com/style.png' },
  ];
  const decision = buildAutomaticImageReferenceFallbackDecision({
    references,
    reason: 'janus_unavailable',
  });
  const nextMask = applyImageReferenceDecisionToMask({
    intent: 'image.generate',
    inputs: {
      subject: ['reference subject'],
      environment: [],
      style: [],
      composition: [],
      lighting: [],
      palette: [],
    },
    meta: {
      promptInstructions: [],
    },
  }, decision, references);

  assert.equal(decision.primary_image_id, 'identity-1');
  assert.equal(decision.clarification_required, false);
  assert.equal(decision.decision_source, 'a11_fallback');
  assert.equal(decision.selection_mode, 'fallback_first_reference');
  assert.equal(decision.fallback_reason, 'janus_unavailable');
  assert.equal(nextMask.meta.imageReferenceDecision.primaryImageId, 'identity-1');
  assert.equal(nextMask.meta.imageReferenceDecision.primaryRole, '');
  assert.equal(nextMask.meta.imageReferenceDecision.decisionSource, 'a11_fallback');
  assert.equal(nextMask.meta.imageReferenceDecision.fallbackReason, 'janus_unavailable');
  assert.equal(nextMask.meta.webImageDraft.imageReferenceRole, '');
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifyGeneratedImageWithLlmJudge,
} = require('../src/image/verify-generated-image-with-llm.cjs');

const PIXEL_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnF9J0AAAAASUVORK5CYII=';

test('verifyGeneratedImageWithLlmJudge keeps only candidate hints returned by the vision model', async () => {
  const result = await verifyGeneratedImageWithLlmJudge({
    imageUrl: 'https://files.example.com/rabbit.png',
    requestId: 'req-image-1',
    prompt: 'Demande : lapin avec carotte',
    mask: {
      raw: 'genere une image d un lapin avec une carotte dans la bouche',
      inputs: {
        subject: ['lapin'],
        composition: ['un seul animal complet', 'accessoire bien visible'],
        environment: ['décor simple et lisible'],
        style: ['illustration nette'],
      },
      meta: {
        promptInstructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
        subjectProfile: { type: 'single_animal' },
        semantic: {
          accessories: [{ key: 'carotte', label: 'carotte' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
      },
    },
    callStructuredVisionJson: async () => ({
      subject_ok: true,
      composition_ok: true,
      reason: 'ok',
      confidence: 0.88,
      working_hints: [
        'accessoire bien visible',
        'Montrer clairement une carotte dans la bouche du sujet principal.',
        'hint inventé',
      ],
      failing_hints: [
        'décor simple et lisible',
        'autre hint inventé',
      ],
      observation: 'Le lapin et la carotte sont clairement visibles.',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision.accepted, true);
  assert.deepEqual(result.workingHints, {
    composition_hints: ['accessoire bien visible'],
    environment_hints: [],
    style_hints: [],
    prompt_instructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
  });
  assert.deepEqual(result.failingHints, {
    composition_hints: [],
    environment_hints: ['décor simple et lisible'],
    style_hints: [],
    prompt_instructions: [],
  });
});

test('verifyGeneratedImageWithLlmJudge returns a skipped result when disabled', async () => {
  const result = await verifyGeneratedImageWithLlmJudge({
    imageUrl: 'https://files.example.com/rabbit.png',
    enabled: false,
    mask: {
      inputs: {
        subject: ['lapin'],
      },
      meta: {},
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'vision_llm_disabled');
});

test('verifyGeneratedImageWithLlmJudge can use the local Janus provider path', async () => {
  const result = await verifyGeneratedImageWithLlmJudge({
    imageUrl: PIXEL_PNG_DATA_URL,
    requestId: 'req-image-janus-1',
    prompt: 'Demande : lapin avec carotte',
    visionProvider: 'janus',
    mask: {
      raw: 'genere une image d un lapin avec une carotte dans la bouche',
      inputs: {
        subject: ['lapin'],
        composition: ['un seul animal complet', 'accessoire bien visible'],
        environment: ['décor simple et lisible'],
        style: ['illustration nette'],
      },
      meta: {
        promptInstructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
        subjectProfile: { type: 'single_animal' },
        semantic: {
          accessories: [{ key: 'carotte', label: 'carotte' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
      },
    },
    callLocalVisionText: async () => `\`\`\`json
{
  "subject_ok": true,
  "composition_ok": true,
  "reason": "ok",
  "confidence": 0.91,
  "working_hints": [
    "accessoire bien visible",
    "Montrer clairement une carotte dans la bouche du sujet principal."
  ],
  "failing_hints": [],
  "observation": "Le sujet principal est lisible."
}
\`\`\``,
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision.accepted, true);
  assert.deepEqual(result.workingHints.composition_hints, ['accessoire bien visible']);
  assert.deepEqual(result.workingHints.prompt_instructions, ['Montrer clairement une carotte dans la bouche du sujet principal.']);
});

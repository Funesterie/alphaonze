const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runImageAtelier,
} = require('../src/mask/image-atelier-runtime.cjs');

function createMask({
  subject = 'sujet',
  raw = 'genere une image',
  composition = [],
  environment = [],
  style = ['haute qualité'],
  palette = [],
  subjectProfile = null,
} = {}) {
  return {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-fr', version: '1.0' },
    inputs: {
      subject: [subject],
      environment,
      style,
      composition,
      lighting: [],
      palette,
    },
    options: {
      width: 768,
      height: 768,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: [],
    meta: subjectProfile ? { subjectProfile } : {},
    raw,
  };
}

function createRoundResult({
  imageUrl = 'https://files.example.com/generated.png',
  verification = null,
} = {}) {
  return {
    mask: createMask(),
    compiledPayload: { prompt: 'Prompt de test', prompt_language: 'fr' },
    compiled: { kind: 'image.generate', state: 'ready', value: {} },
    sdBody: { prompt: 'Prompt de test', prompt_language: 'fr', width: 768, height: 768, num_inference_steps: 40, guidance_scale: 8 },
    sdResult: {
      ok: true,
      tool: 'generate_image',
      artifact_type: 'image',
      image_url: imageUrl,
      filename: 'generated.png',
    },
    imageGuard: {
      requestId: 'img-test',
      enabled: true,
      compiledPromptHash: 'hash',
      expected: verification?.expected || null,
      verification,
      retries: [],
      attempts: [],
    },
  };
}

test('runImageAtelier stops immediately when the first round is accepted', async () => {
  let calls = 0;
  const result = await runImageAtelier({
    req: { headers: {} },
    rawMask: createMask({
      subject: 'dragon bleu',
      raw: 'genere une image de dragon bleu',
      subjectProfile: { type: 'mythic_creature' },
    }),
    generateFromMask: async () => {
      calls += 1;
      return createRoundResult({
        imageUrl: 'https://files.example.com/dragon.png',
        verification: {
          ok: true,
          expected: { subject_count: 1, subject_type: 'dragon', subject_label: 'dragon', allow_group: false },
          observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.92 },
          decision: { retry: false, reason: 'ok', notes: '' },
          raw: { components: [{ minX: 30, minY: 18, maxX: 166, maxY: 176 }] },
        },
      });
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.atelier.rounds, 1);
  assert.equal(result.atelier.stop_reason, 'accepted');
  assert.equal(result.atelier.summary.accepted_round, 1);
  assert.equal(result.atelier.summary.profile_type, 'mythic_creature');
  assert.equal(Array.isArray(result.atelier.trace.rounds), true);
  assert.equal(result.atelier.trace.rounds.length, 1);
});

test('runImageAtelier applies a positive object refinement after object_not_isolated judgement', async () => {
  let calls = 0;
  const baseMask = createMask({
    subject: 'pomme',
    raw: 'genere une image de pomme',
    composition: [],
    environment: [],
    subjectProfile: { type: 'simple_food_object' },
  });

  const result = await runImageAtelier({
    req: { headers: {} },
    rawMask: baseMask,
    max_rounds: 2,
    generateFromMask: async () => {
      calls += 1;
      if (calls === 1) {
        return createRoundResult({
          imageUrl: 'https://files.example.com/apple-1.png',
          verification: {
            ok: true,
            expected: { subject_count: 1, subject_type: 'pomme', subject_label: 'pomme', allow_group: false },
            observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.88 },
            decision: { retry: true, reason: 'multiple_subjects_detected', notes: 'local_heuristic fg_ratio=0.950 components=1 peaks=11 busy_full_frame_scene=1' },
            raw: { notes: 'local_heuristic fg_ratio=0.950 components=1 peaks=11 busy_full_frame_scene=1', components: [{ minX: 0, minY: 0, maxX: 195, maxY: 195 }] },
          },
        });
      }
      return createRoundResult({
        imageUrl: 'https://files.example.com/apple-2.png',
        verification: {
          ok: true,
          expected: { subject_count: 1, subject_type: 'pomme', subject_label: 'pomme', allow_group: false },
          observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.9 },
          decision: { retry: false, reason: 'ok', notes: '' },
          raw: { components: [{ minX: 28, minY: 20, maxX: 170, maxY: 175 }] },
        },
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.atelier.summary.accepted_round, 2);
  assert.equal(result.atelier.trace.rounds[0].judgement.primary_reason, 'object_not_isolated');
  assert.equal(Array.isArray(result.atelier.trace.rounds[1].refinements_applied), true);
  assert.ok(result.atelier.trace.rounds[1].refinements_applied.length > 0);
  assert.ok(result.atelier.trace.rounds[1].mask_snapshot.inputs.environment.includes('fond neutre simple'));
  assert.ok(result.atelier.trace.rounds[1].mask_snapshot.inputs.composition.includes('objet unique isolé'));
});

test('runImageAtelier applies a character refinement after character_not_unique judgement', async () => {
  let calls = 0;
  const baseMask = createMask({
    subject: 'gohan',
    raw: 'genere une image de gohan',
    composition: [],
    environment: [],
    subjectProfile: { type: 'reference_character' },
  });

  const result = await runImageAtelier({
    req: { headers: {} },
    rawMask: baseMask,
    max_rounds: 2,
    generateFromMask: async () => {
      calls += 1;
      if (calls === 1) {
        return createRoundResult({
          imageUrl: 'https://files.example.com/gohan-1.png',
          verification: {
            ok: true,
            expected: { subject_count: 1, subject_type: 'gohan', subject_label: 'gohan', allow_group: false },
            observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: true, subject_match: true, confidence: 0.93 },
            decision: { retry: true, reason: 'fusion_detected', notes: 'local_heuristic fg_ratio=0.820 components=1 peaks=9' },
            raw: { notes: 'local_heuristic fg_ratio=0.820 components=1 peaks=9', components: [{ minX: 10, minY: 15, maxX: 184, maxY: 188 }] },
          },
        });
      }
      return createRoundResult({
        imageUrl: 'https://files.example.com/gohan-2.png',
        verification: {
          ok: true,
          expected: { subject_count: 1, subject_type: 'gohan', subject_label: 'gohan', allow_group: false },
          observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.91 },
          decision: { retry: false, reason: 'ok', notes: '' },
          raw: { components: [{ minX: 35, minY: 18, maxX: 165, maxY: 180 }] },
        },
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.atelier.summary.accepted_round, 2);
  assert.equal(result.atelier.trace.rounds[0].judgement.primary_reason, 'character_not_unique');
  assert.ok(result.atelier.trace.rounds[1].mask_snapshot.inputs.composition.includes('un seul personnage complet'));
  assert.ok(result.atelier.trace.rounds[1].mask_snapshot.inputs.composition.includes('visage unique bien lisible'));
  assert.ok(result.atelier.trace.rounds[1].mask_snapshot.inputs.environment.includes('fond simple cohérent avec le personnage'));
});

test('runImageAtelier respects max_rounds strictly', async () => {
  let calls = 0;
  const result = await runImageAtelier({
    req: { headers: {} },
    rawMask: createMask({
      subject: 'lapin',
      raw: 'genere une image de lapin',
      subjectProfile: { type: 'single_animal' },
    }),
    max_rounds: 2,
    generateFromMask: async () => {
      calls += 1;
      return createRoundResult({
        imageUrl: `https://files.example.com/rabbit-${calls}.png`,
        verification: {
          ok: true,
          expected: { subject_count: 1, subject_type: 'lapin', subject_label: 'lapin', allow_group: false },
          observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.86 },
          decision: { retry: true, reason: 'multiple_subjects_detected', notes: '' },
          raw: { components: [{ minX: 12, minY: 10, maxX: 180, maxY: 185 }] },
        },
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.atelier.rounds, 2);
  assert.equal(result.atelier.stop_reason, 'max_rounds_reached');
  assert.equal(result.atelier.summary.accepted_round, null);
});

test('runImageAtelier exposes a detailed trace for each round', async () => {
  const result = await runImageAtelier({
    req: { headers: {} },
    rawMask: createMask({
      subject: 'faucon gris',
      raw: 'genere une image de faucon gris',
      subjectProfile: { type: 'single_animal' },
    }),
    generateFromMask: async () => createRoundResult({
      imageUrl: 'https://files.example.com/falcon.png',
      verification: {
        ok: true,
        expected: { subject_count: 1, subject_type: 'faucon', subject_label: 'faucon', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.94 },
        decision: { retry: false, reason: 'ok', notes: '' },
        raw: { components: [{ minX: 33, minY: 12, maxX: 168, maxY: 187 }] },
      },
    }),
  });

  const round = result.atelier.trace.rounds[0];
  assert.equal(typeof round.compiled_prompt, 'string');
  assert.equal(typeof round.sd_body, 'object');
  assert.equal(round.image_url, 'https://files.example.com/falcon.png');
  assert.equal(typeof round.judgement, 'object');
  assert.equal(Array.isArray(round.refinements_applied), true);
  assert.equal(typeof round.duration_ms, 'number');
});

test('runImageAtelier builds a coherent atelier mask from message text', async () => {
  const result = await runImageAtelier({
    req: { headers: {} },
    message: 'genere une image de pomme',
    generateFromMask: async ({ rawMask }) => createRoundResult({
      imageUrl: 'https://files.example.com/apple-message.png',
      verification: {
        ok: true,
        expected: { subject_count: 1, subject_type: 'pomme', subject_label: 'pomme', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.91 },
        decision: { retry: false, reason: 'ok', notes: '' },
        raw: { components: [{ minX: 40, minY: 22, maxX: 160, maxY: 172 }] },
      },
      mask: rawMask,
    }),
  });

  assert.equal(result.atelier.summary.profile_type, 'simple_food_object');
  assert.ok(result.atelier.trace.rounds[0].mask_snapshot.inputs.environment.includes('fond neutre simple'));
  assert.ok(result.atelier.trace.rounds[0].mask_snapshot.inputs.composition.includes('objet unique isolé'));
});

test('runImageAtelier builds character and creature masks from message text', async () => {
  const gohanResult = await runImageAtelier({
    req: { headers: {} },
    message: 'genere une image de gohan',
    generateFromMask: async ({ rawMask }) => createRoundResult({
      imageUrl: 'https://files.example.com/gohan-message.png',
      verification: {
        ok: true,
        expected: { subject_count: 1, subject_type: 'gohan', subject_label: 'gohan', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.93 },
        decision: { retry: false, reason: 'ok', notes: '' },
        raw: { components: [{ minX: 34, minY: 20, maxX: 166, maxY: 181 }] },
      },
      mask: rawMask,
    }),
  });

  const dragonResult = await runImageAtelier({
    req: { headers: {} },
    message: 'genere une image de dragon bleu',
    generateFromMask: async ({ rawMask }) => createRoundResult({
      imageUrl: 'https://files.example.com/dragon-message.png',
      verification: {
        ok: true,
        expected: { subject_count: 1, subject_type: 'dragon', subject_label: 'dragon', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.94 },
        decision: { retry: false, reason: 'ok', notes: '' },
        raw: { components: [{ minX: 25, minY: 18, maxX: 170, maxY: 180 }] },
      },
      mask: rawMask,
    }),
  });

  assert.equal(gohanResult.atelier.summary.profile_type, 'reference_character');
  assert.ok(gohanResult.atelier.trace.rounds[0].mask_snapshot.inputs.composition.includes('un seul personnage complet'));
  assert.ok(gohanResult.atelier.trace.rounds[0].mask_snapshot.inputs.environment.includes('fond simple cohérent avec le personnage'));

  assert.equal(dragonResult.atelier.summary.profile_type, 'mythic_creature');
  assert.ok(dragonResult.atelier.trace.rounds[0].mask_snapshot.inputs.composition.includes('créature unique complète'));
  assert.ok(dragonResult.atelier.trace.rounds[0].mask_snapshot.inputs.environment.includes('décor simple cohérent avec le sujet'));
});

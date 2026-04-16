const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdRequestBody,
  generateImageFromMask,
  resolveImageCompilerCompartment,
  resolveImageRequestMode,
  toImageChatProxyPayload,
} = require('../src/mask/image-chat-runtime.cjs');

async function withImagePipelineMode(mode, fn) {
  const previous = process.env.A11_IMAGE_PIPELINE_MODE;
  process.env.A11_IMAGE_PIPELINE_MODE = mode;
  try {
    return await fn();
  } finally {
    process.env.A11_IMAGE_PIPELINE_MODE = previous;
  }
}

test('buildSdRequestBody marks compiled prompts as prebuilt to avoid double enrichment', () => {
  const sdBody = buildSdRequestBody(
    {
      raw: "genere une image d'un lapin rose",
      options: { width: 768, height: 768, steps: 30, guidance_scale: 7.5 },
    },
    {
      prompt: 'a pink rabbit, exactly one pink rabbit only',
      prompt_language: 'fr',
      negative_prompt: 'duplicate rabbits, crowd',
      width: 1024,
      height: 1024,
      steps: 40,
      guidance_scale: 8,
    }
  );

  assert.equal(sdBody.prompt_prebuilt, true);
  assert.equal(sdBody.prompt, 'a pink rabbit, exactly one pink rabbit only');
  assert.equal(sdBody.prompt_language, 'fr');
  assert.equal(sdBody.negative_prompt, 'duplicate rabbits, crowd');
  assert.equal(sdBody.negative_prompt_prebuilt, true);
});

test('buildSdRequestBody forwards web draft init image settings from the mask runtime meta', () => {
  const sdBody = buildSdRequestBody(
    {
      raw: "genere une image de zelda",
      meta: {
        webImageDraft: {
          initImageUrl: 'https://images.example.com/zelda-ref.png',
          strength: 0.42,
        },
      },
      options: { width: 768, height: 768, steps: 30, guidance_scale: 7.5 },
    },
    {
      prompt: 'princesse zelda heroique',
      prompt_language: 'fr',
    }
  );

  assert.equal(sdBody.init_image_url, 'https://images.example.com/zelda-ref.png');
  assert.equal(sdBody.strength, 0.42);
});

test('toImageChatProxyPayload synthesizes a png filename when the image URL has no extension', () => {
  const payload = toImageChatProxyPayload({
    sdResult: {
      ok: true,
      artifact_type: 'image',
      image_url: 'https://files.example.com/generated/linux-image',
      contentType: 'image/png',
    },
    mask: { intent: 'image.generate' },
    compiled: {},
    sdBody: {},
  });

  assert.equal(payload.imagePath, 'https://files.example.com/generated/linux-image');
  assert.equal(payload.mode, 'generate_image');
  assert.equal(payload.tool, 'generate_image');
  assert.match(String(payload.choices?.[0]?.message?.content || ''), /\[ouvrir l'image\]/i);
});

test('generateImageFromMask compiles canonical masks into a french image prompt by default', async () => {
  const calls = [];

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      inputs: {
        subject: ['herisson'],
        environment: [],
        style: ['high quality', 'detailed'],
        composition: ['single main subject', 'clear centered composition', 'simple clean background'],
        lighting: [],
        palette: ['green'],
      },
      options: {
        width: 768,
        height: 768,
        steps: 30,
        guidance_scale: 7.5,
      },
      constraints: {
        safe_mode: true,
        no_text: true,
      },
      ambiguities: [],
      raw: 'genere un herisson vert',
    },
    generateImage: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/herisson.png',
        filename: 'herisson.png',
        mode: 'openai-image',
        tool: 'generate_image',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  });

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /un herisson vert/i);
  assert.match(String(calls[0]?.prompt || ''), /high quality, detailed/i);
  assert.match(String(calls[0]?.prompt || ''), /single main subject, clear centered composition, simple clean background/i);
  assert.match(String(calls[0]?.prompt || ''), /couleurs green/i);
  assert.match(String(calls[0]?.prompt || ''), /un seul sujet principal/i);
  assert.match(String(calls[0]?.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(calls[0]?.negative_prompt || ''), /watermark/i);
  assert.doesNotMatch(String(calls[0]?.prompt || ''), /\bNe pas\b|\bdo not\b/i);
  assert.equal(calls[0]?.prompt_language, 'fr');
  assert.equal(result.sdResult.mode, 'openai-image');
});

test('generateImageFromMask retries once when the verifier detects multiple subjects', async () => {
  const calls = [];
  const rawMask = {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['lapin rose'],
      environment: [],
      style: ['high quality'],
      composition: [],
      lighting: [],
      palette: ['pink'],
    },
    options: {
      width: 768,
      height: 768,
      steps: 30,
      guidance_scale: 7.5,
      seed: 100,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: [],
    raw: "genere une image d'un lapin rose",
  };

  const result = await withImagePipelineMode('smart', () => generateImageFromMask({
    req: { headers: {} },
    rawMask,
    imageVerificationEnabled: true,
    maxVerificationRetries: 1,
    generateSd: async ({ body }) => {
      calls.push({
        prompt: body.prompt,
        has_negative_prompt: Object.prototype.hasOwnProperty.call(body, 'negative_prompt'),
        seed: body.seed,
      });
      return {
        ok: true,
        image_url: `https://files.example.com/rabbit-${calls.length}.png`,
        filename: `rabbit-${calls.length}.png`,
      };
    },
    verifyImageCardinality: async ({ imageUrl }) => {
      if (String(imageUrl).includes('rabbit-1.png')) {
        return {
          ok: true,
          expected: { subject_count: 1, subject_type: 'lapin', subject_label: 'lapin', allow_group: false },
          observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.91 },
          decision: { retry: true, reason: 'multiple_subjects_detected', notes: '' },
        };
      }
      return {
        ok: true,
        expected: { subject_count: 1, subject_type: 'lapin', subject_label: 'lapin', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.94 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  }));

  assert.equal(calls.length, 2);
  assert.match(String(calls[1]?.prompt || ''), /montrer un seul lapin/i);
  assert.match(String(calls[1]?.prompt || ''), /silhouette claire et lisible/i);
  assert.equal(calls[1]?.has_negative_prompt, true);
  assert.equal(calls[1]?.seed, 197);
  assert.equal(result.sdResult.image_url, 'https://files.example.com/rabbit-2.png');
  assert.equal(result.imageGuard?.retries?.length, 1);
  assert.equal(result.imageGuard?.verification?.decision?.retry, false);
});

test('generateImageFromMask does not auto-retry by default even when verification suggests a retry', async () => {
  let callCount = 0;

  const result = await withImagePipelineMode('smart', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['dragon obsidien'],
        environment: [],
        style: ['high quality'],
        composition: [],
        lighting: [],
        palette: ['black'],
      },
      options: {
        width: 768,
        height: 768,
        steps: 30,
        guidance_scale: 7.5,
      },
      constraints: {
        safe_mode: true,
        no_text: true,
      },
      ambiguities: [],
      raw: "genere une image de dragon obsidien",
    },
    imageVerificationEnabled: true,
    generateSd: async () => {
      callCount += 1;
      return {
        ok: true,
        image_url: 'https://files.example.com/dragon-1.png',
        filename: 'dragon-1.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: true,
      expected: { subject_count: 1, subject_type: 'dragon', subject_label: 'dragon', allow_group: false },
      observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: true, subject_match: true, confidence: 0.88 },
      decision: { retry: true, reason: 'fusion_detected', notes: '' },
    }),
  }));

  assert.equal(callCount, 1);
  assert.equal(result.imageGuard?.retries?.length, 0);
  assert.equal(result.imageGuard?.verification?.decision?.retry, true);
});

test('generateImageFromMask skips retry when image verification is unavailable', async () => {
  let callCount = 0;
  const rawMask = {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['ours jaune'],
      environment: [],
      style: ['high quality'],
      composition: [],
      lighting: [],
      palette: ['yellow'],
    },
    options: {
      width: 768,
      height: 768,
      steps: 30,
      guidance_scale: 7.5,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: [],
    raw: "genere une image d'un ours jaune",
  };

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask,
    imageVerificationEnabled: true,
    generateSd: async () => {
      callCount += 1;
      return {
        ok: true,
        image_url: 'https://files.example.com/bear-1.png',
        filename: 'bear-1.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  });

  assert.equal(callCount, 1);
  assert.equal(result.imageGuard?.verification?.reason, 'vision_unavailable');
  assert.equal(result.imageGuard?.retries?.length, 0);
});

test('generateImageFromMask enables image cardinality verification by default', async () => {
  let verificationCalls = 0;

  const result = await withImagePipelineMode('smart', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['lapin bleu'],
        environment: [],
        style: ['high quality'],
        composition: [],
        lighting: [],
        palette: ['blue'],
      },
      options: {
        width: 768,
        height: 768,
        steps: 30,
        guidance_scale: 7.5,
      },
      constraints: {
        safe_mode: true,
        no_text: true,
      },
      ambiguities: [],
      raw: "genere une image d'un lapin bleu",
    },
    generateSd: async () => ({
      ok: true,
      image_url: 'https://files.example.com/blue-rabbit.png',
      filename: 'blue-rabbit.png',
    }),
    verifyImageCardinality: async () => {
      verificationCalls += 1;
      return {
        ok: true,
        expected: { subject_count: 1, subject_type: 'rabbit', subject_label: 'rabbit', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.93 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  }));

  assert.equal(verificationCalls, 1);
  assert.equal(result.imageGuard?.enabled, true);
  assert.equal(result.imageGuard?.verification?.decision?.retry, false);
});

test('generateImageFromMask rejects invalid solid-black generations before returning success', async () => {
  await assert.rejects(
    () => withImagePipelineMode('smart', () => generateImageFromMask({
      req: { headers: {} },
      rawMask: {
        version: 'mask-1',
        intent: 'image.generate',
        task: { domain: 'image', action: 'generate' },
        compiler: { target: 'sd-payload', version: '1.0' },
        inputs: {
          subject: ['vegeta'],
          environment: [],
          style: ['high quality'],
          composition: [],
          lighting: [],
          palette: ['pink'],
        },
        options: {
          width: 768,
          height: 768,
          steps: 30,
          guidance_scale: 7.5,
        },
        constraints: {
          safe_mode: true,
          no_text: true,
        },
        ambiguities: [],
        raw: "genere une image de vegeta",
      },
      generateSd: async () => ({
        ok: true,
        image_url: 'https://files.example.com/black.png',
        filename: 'black.png',
      }),
      inspectGeneratedImageResult: async () => ({
        ok: false,
        reason: 'solid_black_image_detected',
        imageUrl: 'https://files.example.com/black.png',
        metadata: { width: 768, height: 768, channels: 4, sizeBytes: 1795 },
      }),
    })),
    (error) => {
      assert.equal(error?.statusCode, 502);
      assert.equal(error?.payload?.error, 'image_generation_invalid');
      assert.equal(error?.payload?.details?.reason, 'solid_black_image_detected');
      return true;
    }
  );
});

test('resolveImageCompilerCompartment keeps simple object prompts on the standard compiler in creative mode', () => {
  const decision = resolveImageCompilerCompartment({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    inputs: {
      subject: ['pomme'],
      environment: ['fond neutre simple'],
      style: ['haute qualité'],
      composition: ['objet unique isolé'],
      lighting: [],
      palette: [],
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
    meta: {
      semantic: {
        confidence: 0.91,
        scenes: [],
        elements: [],
        accessories: [],
        metiers: [],
      },
      subjectProfile: { type: 'simple_food_object' },
    },
    raw: 'genere une image de pomme',
  });

  assert.equal(decision.compartment, 'standard');
  assert.equal(decision.shouldBypassCache, false);
  assert.equal(decision.candidate, false);
  assert.equal(decision.pipelineMode, 'auto');
});

test('resolveImageRequestMode defaults simple image prompts to raw', () => {
  const decision = resolveImageRequestMode({
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      inputs: {
        subject: ['pomme'],
        environment: [],
        style: ['haute qualité'],
        composition: [],
        lighting: [],
        palette: [],
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
      meta: {
        subjectProfile: { type: 'simple_food_object' },
      },
      ambiguities: [],
      raw: 'genere une image de pomme',
    },
  });

  assert.equal(decision.mode, 'raw');
  assert.equal(decision.explicit, false);
});

test('resolveImageRequestMode promotes mythic creature prompts to smart for model safety', () => {
  const decision = resolveImageRequestMode({
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      inputs: {
        subject: ['licorne'],
        environment: [],
        style: ['haute qualité'],
        composition: [],
        lighting: [],
        palette: [],
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
      meta: {
        subjectProfile: { type: 'mythic_creature' },
      },
      ambiguities: [],
      raw: 'genere une image de licorne',
    },
  });

  assert.equal(decision.mode, 'smart');
  assert.equal(decision.reason, 'model_sensitive_profile');
});

test('resolveImageRequestMode promotes named character wearable prompts to smart', () => {
  const decision = resolveImageRequestMode({
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      inputs: {
        subject: ['Princesse Zelda'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['illustration fantasy nette'],
        composition: ['un seul personnage complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.86,
          accessories: [{ label: 'bikini', family: 'wearable' }],
        },
        subjectProfile: { type: 'reference_character' },
      },
      ambiguities: [],
      raw: 'genere une image de zelda en bikini',
    },
  });

  assert.equal(decision.mode, 'smart');
  assert.equal(decision.reason, 'reference_character_variation');
});

test('generateImageFromMask applies the special compiler for complex prompts with positive llm hints', async () => {
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['lapin'],
        environment: ['décor naturel simple'],
        style: ['haute qualité'],
        composition: ['un seul animal complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.52,
          accessories: [{ key: 'carotte', label: 'carotte', family: 'food_prop' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
        promptInstructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
        subjectProfile: { type: 'single_animal' },
      },
      ambiguities: [],
      raw: 'genere une image d un lapin avec une carotte dans la bouche',
    },
    specialCompilerCallStructuredLlmJson: async () => ({
      composition_hints: ['accessoire bien visible'],
      environment_hints: ['décor simple et lisible'],
      style_hints: ['illustration nette'],
      prompt_instructions: ['Montrer clairement la carotte attachée au sujet principal.'],
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: '',
        filename: 'rabbit.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  }));

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /accessoire bien visible/i);
  assert.match(String(calls[0]?.prompt || ''), /lapin avec une carotte dans la bouche/i);
  assert.equal(result.mask?.meta?.compilerCompartment, 'special');
  assert.equal(result.specialCompiler?.selection?.compartment, 'special');
  assert.equal(result.mask?.meta?.specialCompilerAppliedHintsCount, 4);
});

test('generateImageFromMask stays on the special compiler when llm hints are empty', async () => {
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['guerriere'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['haute qualité'],
        composition: ['une seule personne complète'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.4,
          accessories: [],
          elements: [],
          metiers: [{ key: 'guerrier', label: 'guerrier', family: 'human_role' }],
          scenes: [],
        },
        subjectProfile: { type: 'single_human_figure' },
      },
      ambiguities: [],
      raw: 'génère une image de guerriere nordique',
    },
    specialCompilerCallStructuredLlmJson: async () => ({
      composition_hints: [],
      environment_hints: [],
      style_hints: [],
      prompt_instructions: [],
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: '',
        filename: 'warrior.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  }));

  assert.equal(calls.length, 1);
  assert.equal(result.mask?.meta?.compilerCompartment, 'special');
  assert.equal(result.specialCompiler?.fallbackReason, 'empty_or_invalid_hints');
  assert.doesNotMatch(String(calls[0]?.prompt || ''), /special/i);
});

test('generateImageFromMask injects an operational seed even when the request did not provide one', async () => {
  const calls = [];

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['licorne'],
        environment: ['forêt magique simple'],
        style: ['haute qualité'],
        composition: ['créature unique complète'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.88,
          accessories: [],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: { type: 'mythic_creature' },
      },
      ambiguities: [],
      raw: 'genere une image de licorne',
    },
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/unicorn.png',
        filename: 'unicorn.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
  });

  assert.equal(calls.length, 1);
  assert.equal(Number.isInteger(calls[0]?.seed), true);
  assert.ok(calls[0]?.seed > 0);
  assert.equal(result.sdBody?.seed, calls[0]?.seed);
  assert.equal(result.imageGuard?.attempts?.[0]?.seed, calls[0]?.seed);
});

test('generateImageFromMask raw mode never retries even when the verifier would request one', async () => {
  const calls = [];

  const result = await generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['pomme'],
        environment: [],
        style: ['haute qualité'],
        composition: [],
        lighting: [],
        palette: [],
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
      meta: {
        subjectProfile: { type: 'simple_food_object' },
      },
      ambiguities: [],
      raw: 'genere une image de pomme',
    },
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/apple-raw.png',
        filename: 'apple-raw.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: true,
      expected: { subject_count: 1, subject_type: 'pomme', subject_label: 'pomme', allow_group: false },
      observed: { subject_count: 2, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.93 },
      decision: { retry: true, reason: 'multiple_subjects_detected', notes: '' },
    }),
  });

  assert.equal(calls.length, 1);
  assert.equal(result.imageRequestMode?.mode, 'raw');
  assert.equal(result.imageGuard?.enabled, false);
  assert.equal(result.imageGuard?.retries?.length, 0);
  assert.equal(result.imageGuard?.verification?.decision?.retry, true);
});

test('generateImageFromMask reuses remembered hint memory for complex prompts', async () => {
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['lapin'],
        environment: ['décor naturel simple'],
        style: ['haute qualité'],
        composition: ['un seul animal complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.49,
          accessories: [{ key: 'carotte', label: 'carotte', family: 'food_prop' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: { type: 'single_animal' },
      },
      ambiguities: [],
      raw: 'genere une image d un lapin avec une carotte dans la bouche',
    },
    readPreferredImageHintMemory: async () => ({
      available: true,
      hints: {
        composition_hints: ['accessoire bien visible'],
        environment_hints: ['décor simple et lisible'],
        style_hints: ['illustration nette'],
        prompt_instructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
      },
    }),
    specialCompilerCallStructuredLlmJson: async () => ({
      composition_hints: [],
      environment_hints: [],
      style_hints: [],
      prompt_instructions: [],
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/rabbit-memory.png',
        filename: 'rabbit-memory.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
    verifyImageWithLlmJudge: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    }),
  }));

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /accessoire bien visible/i);
  assert.match(String(calls[0]?.prompt || ''), /lapin avec une carotte dans la bouche/i);
  assert.equal(result.mask?.meta?.compilerCompartment, 'special');
  assert.equal(result.mask?.meta?.specialCompilerMemoryHintsAppliedCount, 4);
  assert.equal(result.specialCompiler?.fallbackReason, 'empty_or_invalid_hints');
});

test('generateImageFromMask stores working hints when the llm image judge validates the result', async () => {
  let storedPayload = null;

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['guerriere'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['haute qualité'],
        composition: ['une seule personne complète'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.45,
          accessories: [{ key: 'epee', label: 'épée', family: 'weapon' }],
          elements: [],
          metiers: [{ key: 'guerrier', label: 'guerrier', family: 'human_role' }],
          scenes: [],
        },
        subjectProfile: { type: 'single_human_figure' },
        promptInstructions: ['Montrer clairement l épée tenue par le personnage principal.'],
      },
      ambiguities: [],
      raw: 'génère une image de guerriere nordique avec une épée',
    },
    specialCompilerCallStructuredLlmJson: async () => ({
      composition_hints: ['silhouette héroïque lisible'],
      environment_hints: ['décor sobre et lisible'],
      style_hints: [],
      prompt_instructions: [],
    }),
    generateSd: async () => ({
      ok: true,
      image_url: 'https://files.example.com/warrior.png',
      filename: 'warrior.png',
    }),
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
    verifyImageWithLlmJudge: async () => ({
      ok: true,
      available: true,
      decision: {
        accepted: true,
        subject_ok: true,
        composition_ok: true,
        reason: 'ok',
        confidence: 0.84,
      },
      workingHints: {
        composition_hints: ['une seule personne complète'],
        environment_hints: ['fond simple cohérent avec le personnage'],
        style_hints: [],
        prompt_instructions: ['Montrer clairement l épée tenue par le personnage principal.'],
      },
      failingHints: {
        composition_hints: [],
        environment_hints: [],
        style_hints: [],
        prompt_instructions: [],
      },
      observation: 'Le personnage principal est unique et lisible.',
    }),
    recordSuccessfulImageHintMemory: async (payload) => {
      storedPayload = payload;
      return {
        ok: true,
        addedCount: 3,
      };
    },
  }));

  assert.ok(storedPayload);
  assert.deepEqual(storedPayload.workingHints, {
    composition_hints: ['une seule personne complète'],
    environment_hints: ['fond simple cohérent avec le personnage'],
    style_hints: [],
    prompt_instructions: ['Montrer clairement l épée tenue par le personnage principal.'],
  });
  assert.equal(result.imageLlmJudge?.decision?.accepted, true);
  assert.equal(result.hintMemory?.ok, true);
});

test('generateImageFromMask provides web hint context to the special compiler and avoids unsafe draft anchoring for transformed reference prompts', async () => {
  let llmPayloadText = '';
  const calls = [];

  await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['Bugs Bunny'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['dessin animé classique', 'haute qualité'],
        composition: ['un seul personnage complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.42,
          accessories: [{ key: 'cigarette', label: 'cigarette', family: 'smoking_prop' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: {
          type: 'reference_character',
          promptInstruction: 'Représenter un seul personnage de lapin de dessin animé gris et blanc, avec de longues oreilles et un visage reconnaissable.',
        },
      },
      ambiguities: [],
      raw: 'génère une image de bugsbunny avec une cigarette',
    },
    lookupImageHintWebContext: async () => ({
      query: 'Bugs Bunny cigarette',
      title: 'Bugs Bunny',
      summary: 'Bugs Bunny est un lapin de dessin animé gris et blanc avec de longues oreilles.',
      sourceDomain: 'wikipedia.org',
      imageTitle: 'Bugs Bunny cartoon rabbit',
      imageUrl: 'https://images.example.com/bugs-bunny-ref.png',
      imageSourceUrl: 'https://example.com/bugs-bunny',
      hintFacts: [
        'Sujet recherché : Bugs Bunny',
        'Contexte web : Bugs Bunny est un lapin de dessin animé gris et blanc avec de longues oreilles.',
      ],
    }),
    specialCompilerCallStructuredLlmJson: async ({ text }) => {
      llmPayloadText = String(text || '');
      return {
        composition_hints: ['oreilles longues bien visibles'],
        environment_hints: [],
        style_hints: ['dessin animé fidèle'],
        prompt_instructions: ['Montrer clairement un lapin de dessin animé gris et blanc.'],
      };
    },
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/bugs.png',
        filename: 'bugs.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
    verifyImageWithLlmJudge: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    }),
  }));

  assert.match(llmPayloadText, /canonical_subject/i);
  assert.match(llmPayloadText, /lapin de dessin animé gris et blanc/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init_image_url, undefined);
  assert.equal(calls[0]?.strength, undefined);
  assert.match(String(calls[0]?.prompt || ''), /oreilles longues bien visibles/i);
  assert.match(String(calls[0]?.prompt || ''), /bugsbunny avec une cigarette/i);
});

test('generateImageFromMask injects the temporary entity scratchpad before special compilation', async () => {
  let llmPayloadText = '';
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['john 117'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['haute qualité'],
        composition: ['un seul personnage complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.41,
          accessories: [{ key: 'armure', label: 'armure', family: 'wearable' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: {
          type: 'reference_character',
        },
      },
      ambiguities: [],
      raw: 'génère une image de john 117 en armure bleue',
    },
    resolveImageEntityContext: async () => ({
      canonicalSubject: 'Master Chief',
      description: "personnage de fiction de l'univers Halo",
      summary: 'Super-soldat fictif de la franchise Halo.',
      universe: 'Halo',
      entityType: 'fictional_character',
    }),
    lookupImageHintWebContext: async () => null,
    specialCompilerCallStructuredLlmJson: async ({ text }) => {
      llmPayloadText = String(text || '');
      return {
        composition_hints: ['armure complète bien lisible'],
        environment_hints: [],
        style_hints: ['illustration science-fiction nette'],
        prompt_instructions: [],
      };
    },
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/master-chief.png',
        filename: 'master-chief.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
    verifyImageWithLlmJudge: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    }),
  }));

  assert.equal(result.mask?.meta?.imageScratchpad?.canonicalSubject, 'Master Chief');
  assert.match(llmPayloadText, /canonical_subject/i);
  assert.match(llmPayloadText, /Master Chief/i);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /john 117 en armure bleue/i);
});

test('generateImageFromMask carries gentle scratchpad embellishment into the special compiler for basic mario kart prompts', async () => {
  let llmPayloadText = '';
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['Mario'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['illustration nette'],
        composition: ['un seul personnage complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.86,
          accessories: [],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: {
          type: 'reference_character',
          canonicalSubject: 'Mario',
        },
      },
      ambiguities: [],
      raw: 'génère une image de mario kart',
    },
    resolveImageEntityContext: async () => ({
      canonicalSubject: 'Mario',
      description: 'personnage de jeu vidéo Nintendo',
      summary: 'Pilote emblématique de la série Mario Kart.',
      universe: 'Mario Kart',
      entityType: 'fictional_character',
    }),
    lookupImageHintWebContext: async () => null,
    specialCompilerCallStructuredLlmJson: async ({ text }) => {
      llmPayloadText = String(text || '');
      return {
        composition_hints: ['vitesse lisible'],
        environment_hints: ['virage dynamique lisible'],
        style_hints: [],
        prompt_instructions: [],
      };
    },
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/mario-kart.png',
        filename: 'mario-kart.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
    verifyImageWithLlmJudge: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    }),
  }));

  assert.equal(result.mask?.meta?.compilerCompartment, 'special');
  assert.equal(result.mask?.meta?.imageScratchpad?.embellishment?.family, 'racing_arcade');
  assert.match(llmPayloadText, /prompt_instructions/i);
  assert.match(llmPayloadText, /dérapage visible/i);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /dérapage visible/i);
  assert.match(String(calls[0]?.prompt || ''), /action dynamique lisible|énergie arcade nette/i);
});

test('generateImageFromMask applies image-request director enrichments before final compilation', async () => {
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['Boruto'],
        environment: ['fond simple cohérent avec le personnage'],
        style: ['illustration nette'],
        composition: ['un seul personnage complet'],
        lighting: [],
        palette: [],
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
      meta: {
        semantic: {
          confidence: 0.48,
          accessories: [{ label: 'cigarette', family: 'smoking_prop' }],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: {
          type: 'reference_character',
        },
      },
      ambiguities: [],
      raw: 'génère une image de boruto en train de fumer',
    },
    directImageRequest: async ({ mask }) => ({
      skipped: false,
      director: {
        action_candidates: ['cigarette visible près de la bouche', 'personnage unique complet'],
        web_queries: ['Boruto Uzumaki character art'],
        web_contexts: [],
        summary_facts: ['Action utile : cigarette visible près de la bouche'],
      },
      mask: {
        ...mask,
        meta: {
          ...(mask.meta || {}),
          promptInstructions: [
            ...(Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions : []),
            'Montrer clairement Boruto en train de fumer avec cigarette visible près de la bouche.',
          ],
          imageRequestDirector: {
            actionCandidates: ['cigarette visible près de la bouche', 'personnage unique complet'],
            webQueries: ['Boruto Uzumaki character art'],
            summaryFacts: ['Action utile : cigarette visible près de la bouche'],
          },
        },
      },
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/boruto.png',
        filename: 'boruto.png',
      };
    },
    verifyImageCardinality: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_unavailable',
    }),
    verifyImageWithLlmJudge: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    }),
  }));

  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.prompt || ''), /Boruto en train de fumer/i);
  assert.doesNotMatch(String(calls[0]?.prompt || ''), /Action utile : cigarette visible près de la bouche/i);
  assert.deepEqual(result.imageRequestDirector?.action_candidates, ['cigarette visible près de la bouche', 'personnage unique complet']);
});

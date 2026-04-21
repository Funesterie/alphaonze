const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdRequestBody,
  buildImageVerificationRequestId,
  compileMaskImageGenerateRuntime,
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

test('buildImageVerificationRequestId uses the explicit pair label when available', () => {
  const requestId = buildImageVerificationRequestId({
    mask: {
      inputs: {
        subject: ['Princesse Zelda'],
      },
      raw: 'crée une image de Princesse Zelda et Mario',
    },
  }, {
    enabled: true,
    subjectCount: 2,
    mode: 'pair',
    subjectLabel: 'Princesse Zelda et Mario',
  });

  assert.match(requestId, /^img-princesse-zelda-et-mario-\d+$/);
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

test('buildSdRequestBody injects face-protection negatives for img2img web drafts', () => {
  const sdBody = buildSdRequestBody(
    {
      raw: 'genere un portrait de zelda',
      meta: {
        webImageDraft: {
          initImageUrl: 'https://images.example.com/zelda-ref.png',
          strength: 0.34,
          faceProtectionNegativeHints: ['visage fusionne', 'visage duplique'],
        },
      },
      options: { width: 896, height: 1344, steps: 30, guidance_scale: 7.5 },
    },
    {
      prompt: 'portrait heroique de zelda',
      prompt_language: 'fr',
      negative_prompt: 'texte, watermark',
    }
  );

  assert.match(String(sdBody.negative_prompt || ''), /texte, watermark/i);
  assert.match(String(sdBody.negative_prompt || ''), /visage fusionne/i);
  assert.match(String(sdBody.negative_prompt || ''), /visage duplique/i);
});

test('compileMaskImageGenerateRuntime recalculates img2img technique from the final refined prompt', async () => {
  const draftCalls = [];

  const result = await withImagePipelineMode('orchestrated', () => compileMaskImageGenerateRuntime({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: ['portrait homme'],
      environment: ['fond simple'],
      style: ['haute qualité'],
      composition: ['portrait propre'],
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
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
    ambiguities: [],
    raw: 'fais une variation à partir de cette image de référence',
  }, {
    callStructuredLlmJson: async ({ systemPrompt }) => {
      if (/multilingual prompt-context translator/i.test(String(systemPrompt || ''))) {
        return {
          target_language: 'english',
          raw_request: 'make a variation from this reference image',
          current_prompt: 'the same person from the reference image, clean portrait, simple background, high quality',
          current_negative_prompt: 'text, watermark',
          reference_init_image: 'https://images.example.com/portrait-ref.png',
          global_strength_profile: 'balanced',
          global_strength_reason: 'reference_subject_scene_rewrite',
          scene_type: '',
          strength_components: {
            identity: { profile: 'preserve', reason: 'identity_lock', strength: 0.22 },
            background: { profile: 'restyle', reason: 'scene_rewrite', strength: 0.72 },
          },
          guidance_positive_hints: [
            'keep exactly the same face and identity',
            'dramatically redesign the background and atmosphere',
          ],
          guidance_negative_hints: [
            'different identity',
          ],
        };
      }
      if (/réécrivain final/i.test(String(systemPrompt || ''))) {
        return {
          prompt: 'the same person from the reference image, James Bond 007 inspired style, silenced pistol, film-intro backdrop, simple clear composition',
          negative_prompt: 'text, watermark',
        };
      }
      if (/directeur final/i.test(String(systemPrompt || ''))) {
        return {
          prompt: 'the same person from the reference image, keep exactly the same face and identity, dramatically redesigned 007 backdrop, silenced pistol clearly visible, simple clear composition',
          negative_prompt: 'different identity, different person, text, watermark',
        };
      }
      return {
        composition_hints: [],
        environment_hints: [],
        style_hints: [],
        prompt_instructions: [],
      };
    },
    lookupImageHintWebContext: async () => ({
      imageUrl: 'https://images.example.com/portrait-ref.png',
      imageTitle: 'portrait reference',
      sourceUrl: 'https://example.com/portrait-ref',
      sourceDomain: 'example.com',
      imageSelectionScore: 12,
      imageWidth: 768,
      imageHeight: 1024,
    }),
    resolveImageReferencePack: async () => null,
    resolveImageWebDraft: async ({ mask }) => {
      draftCalls.push(String(mask?.meta?.techniqueAnalysisPrompt || '').trim());
      return {
        mode: 'web-image-draft',
        reason: 'explicit_reference_anchor',
        initImageUrl: 'https://images.example.com/portrait-ref.png',
        sourceUrl: 'https://example.com/portrait-ref',
        sourceDomain: 'example.com',
        width: 768,
        height: 1024,
      };
    },
  }));

  assert.equal(draftCalls.length, 2);
  assert.equal(draftCalls[0], '');
  assert.match(draftCalls[1], /James Bond 007/i);
  assert.match(String(result.mask?.meta?.techniqueAnalysisPrompt || ''), /James Bond 007/i);
  assert.equal(result.mask?.meta?.webImageDraft?.strengthProfile, 'balanced');
  assert.equal(result.mask?.meta?.webImageDraft?.strengthReason, 'reference_subject_scene_rewrite');
  assert.ok(Number(result.mask?.meta?.webImageDraft?.strengthValue || 0) >= 0.6);
  assert.equal(result.mask?.meta?.webImageDraft?.strengthComponents?.identity?.profile, 'preserve');
  assert.equal(result.mask?.meta?.webImageDraft?.strengthComponents?.background?.profile, 'restyle');
  assert.equal(result.sdBody?.strength, 'auto');
  assert.equal(result.sdBody?.strength_profile, 'balanced');
  assert.equal(result.sdBody?.strength_reason, 'reference_subject_scene_rewrite');
  assert.equal(result.sdBody?.strength_value, undefined);
  assert.equal(result.sdBody?.strength_components?.identity?.profile, 'preserve');
  assert.equal(result.sdBody?.strength_components?.background?.profile, 'restyle');
  assert.equal(result.techniqueReconciler?.promptGuidance?.reason, 'component_strength_llm_director');
  assert.equal(result.sdBody?.prompt_language, 'en');
  assert.match(String(result.sdBody?.prompt || ''), /keep exactly the same face and identity/i);
  assert.match(String(result.sdBody?.prompt || ''), /dramatically redesigned 007 backdrop/i);
  assert.match(String(result.sdBody?.negative_prompt || ''), /different identity/i);
});

test('compileMaskImageGenerateRuntime keeps prompt llm refinement enabled for short init-image prompts', async () => {
  let refinerCalls = 0;

  const result = await withImagePipelineMode('orchestrated', () => compileMaskImageGenerateRuntime({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: ['portrait homme'],
      environment: ['fond simple'],
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
      webImageDraft: {
        initImageUrl: 'https://images.example.com/portrait-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
    ambiguities: [],
    raw: 'portrait propre',
  }, {
    callStructuredLlmJson: async ({ systemPrompt }) => {
      if (/multilingual prompt-context translator/i.test(String(systemPrompt || ''))) {
        return {
          target_language: 'english',
          raw_request: 'clean portrait',
          current_prompt: 'the same person from the reference image, clean portrait, simple background, high quality',
          current_negative_prompt: 'text, watermark',
          subject: ['male portrait'],
          environment: ['simple background'],
          style: ['high quality'],
          composition: [],
          lighting: [],
          palette: [],
          prompt_instructions: [],
          subject_profile_type: 'single_human_figure',
          canonical_subject: '',
          universe: '',
          reference_init_image: 'https://images.example.com/portrait-ref.png',
          web_reference_pack: null,
        };
      }
      if (/réécrivain final/i.test(String(systemPrompt || ''))) {
        refinerCalls += 1;
        return {
          prompt: 'the same person from the reference image, clean portrait, dark suit, clear composition',
          negative_prompt: 'text, watermark',
        };
      }
      return {
        composition_hints: [],
        environment_hints: [],
        style_hints: [],
        prompt_instructions: [],
      };
    },
    lookupImageHintWebContext: async () => null,
    resolveImageReferencePack: async () => null,
  }));

  assert.equal(refinerCalls, 1);
  assert.equal(result.promptRefiner?.applied, true);
  assert.equal(result.promptRefiner?.reason, 'llm_refined');
  assert.equal(result.sdBody?.prompt_language, 'en');
  assert.match(String(result.sdBody?.prompt || ''), /clean portrait/i);
});

test('compileMaskImageGenerateRuntime asks the prompt refiner to stay in english for sd payload prompts', async () => {
  let capturedSystemPrompt = '';
  let capturedText = '';
  let capturedTranslatorPrompt = '';
  let capturedTranslatorText = '';

  const result = await withImagePipelineMode('orchestrated', () => compileMaskImageGenerateRuntime({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: ['portrait homme'],
      environment: ['decor sombre'],
      style: ['haute qualité'],
      composition: ['portrait propre'],
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
      webImageDraft: {
        initImageUrl: 'https://images.example.com/portrait-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
    ambiguities: [],
    raw: 'utilise ma photo comme reference et transforme moi en joker cinematographique',
  }, {
    callStructuredLlmJson: async ({ systemPrompt, text }) => {
      if (/multilingual prompt-context translator/i.test(String(systemPrompt || ''))) {
        capturedTranslatorPrompt = String(systemPrompt || '');
        capturedTranslatorText = String(text || '');
        return {
          target_language: 'english',
          raw_request: 'use my reference photo and transform me into a cinematic Joker-inspired character',
          current_prompt: 'the same person from the reference image, dark decor, high quality, clean portrait',
          current_negative_prompt: 'text, watermark',
          subject: ['male portrait'],
          environment: ['dark decor'],
          style: ['high quality'],
          composition: ['clean portrait'],
          lighting: [],
          palette: [],
          prompt_instructions: [
            'keep exactly the same face and identity',
            'preserve the silhouette and main outfit',
            'make the lighting and effects clearly visible',
          ],
          subject_profile_type: 'single_human_figure',
          canonical_subject: '',
          universe: '',
          reference_init_image: 'https://images.example.com/portrait-ref.png',
          web_reference_pack: null,
        };
      }
      if (/réécrivain final/i.test(String(systemPrompt || ''))) {
        capturedSystemPrompt = String(systemPrompt || '');
        capturedText = String(text || '');
        return {
          prompt: 'the same person from the reference image, cinematic Joker-inspired character, keep exactly the same face and identity, preserve the silhouette and main outfit, make the lighting and effects clearly visible',
          negative_prompt: 'text, watermark',
        };
      }
      return {
        composition_hints: [],
        environment_hints: [],
        style_hints: [],
        prompt_instructions: [],
      };
    },
    lookupImageHintWebContext: async () => null,
    resolveImageReferencePack: async () => null,
  }));

  assert.match(capturedTranslatorPrompt, /multilingual prompt-context translator/i);
  assert.match(capturedTranslatorText, /utilise ma photo comme reference/i);
  assert.match(capturedSystemPrompt, /english only/i);
  assert.match(capturedText, /"target_language": "english"/i);
  assert.match(capturedText, /"raw_request": "use my reference photo and transform me into a cinematic Joker-inspired character"/i);
  assert.equal(result.sdBody?.prompt_language, 'en');
  assert.match(String(result.sdBody?.prompt || ''), /the same person from the reference image/i);
  assert.match(String(result.sdBody?.prompt || ''), /keep exactly the same face and identity/i);
  assert.match(String(result.sdBody?.prompt || ''), /preserve the silhouette and main outfit/i);
  assert.match(String(result.sdBody?.prompt || ''), /make the lighting and effects clearly visible/i);
  assert.doesNotMatch(String(result.sdBody?.prompt || ''), /\bgarder\b|\bvisage\b|\btenue\b/i);
  assert.doesNotMatch(String(result.sdBody?.negative_prompt || ''), /\btexte\b/i);
});

test('compileMaskImageGenerateRuntime preserves a rich final prompt instead of compressing it again', async () => {
  let llmCalls = 0;

  const result = await withImagePipelineMode('orchestrated', () => compileMaskImageGenerateRuntime({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: ['portrait homme'],
      environment: [
        'decor urbain inspire de Harlem',
        'rue brute avec graffitis et immeubles uses',
        'ambiance de quartier tendue et realiste',
      ],
      style: [
        'portrait live action sombre et credible',
        'cinematographique',
        'contrastes marques',
      ],
      composition: [
        'sujet unique personnage entier visible',
        'batte custom clairement visible',
        'composition propre et puissante',
      ],
      lighting: [
        'lumiere dramatique',
        'reflets de neons violets et verts',
      ],
      palette: [
        'violet',
        'vert',
        'rouge sale',
      ],
    },
    options: {
      width: 768,
      height: 1024,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    meta: {
      promptInstructions: [
        'conserver strictement le meme visage',
        'garder la meme corpulence et la meme posture',
        'costume joker elegant mais chaotique',
        'maquillage de clown inquietant mais credible',
        'la batte custom doit etre visible et theatrale',
        'le decor doit rester secondaire mais immersif',
      ],
      webImageDraft: {
        initImageUrl: 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png',
        mode: 'image_url',
        fromChatSourceImage: true,
        width: 768,
        height: 1024,
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
      semantic: {
        accessories: [{ label: 'batte custom joker', family: 'weapon' }],
        elements: [{ label: 'maquillage de clown', family: 'makeup' }],
        scenes: [{ label: 'quartier urbain inspire de Harlem', family: 'urban_scene' }],
      },
    },
    ambiguities: [],
    raw: 'Utilise ma photo comme reference d identite et transforme moi en personnage inspire du Joker dans un decor urbain sombre a la Harlem avec une vraie batte custom visible, lumiere dramatique, ambiance tendue, tenue theatrale et rendu live action credible.',
  }, {
    callStructuredLlmJson: async ({ systemPrompt }) => {
      if (/réécrivain final|directeur final/i.test(String(systemPrompt || ''))) {
        llmCalls += 1;
        return {
          prompt: 'Character inspired by the Joker with a recognizable face and a personalized baton.',
          negative_prompt: 'text, watermark',
        };
      }
      return {
        composition_hints: [],
        environment_hints: [],
        style_hints: [],
        prompt_instructions: [],
      };
    },
    lookupImageHintWebContext: async () => null,
    resolveImageReferencePack: async () => null,
    directImageRequest: async ({ mask }) => ({
      mask,
      director: null,
    }),
  }));

  assert.equal(llmCalls, 0);
  assert.equal(result.promptRefiner?.applied, false);
  assert.equal(result.mask?.meta?.webImageDraft?.initImageUrl, 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png');
  assert.equal(result.techniqueReconciler?.promptGuidance?.preservedRichPrompt, true);
  assert.ok(String(result.sdBody?.prompt || '').length >= 260);
  assert.match(String(result.sdBody?.prompt || ''), /Harlem|graffiti|batte|joker/i);
});

test('generateImageFromMask preserves the source ratio for web init images instead of forcing a square fallback', async () => {
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {}, body: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['Sanji'],
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
        subjectProfile: {
          type: 'reference_character',
        },
      },
      ambiguities: [],
      raw: 'génère une image de sanji',
    },
    lookupImageHintWebContext: async () => null,
    resolveImageWebDraft: async () => ({
      mode: 'web-image-draft',
      initImageUrl: 'https://images.example.com/sanji-ref.png',
      width: 757,
      height: 1055,
      strength: 0.45,
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/sanji.png',
        filename: 'sanji.png',
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
  assert.equal(calls[0]?.init_image_url, 'https://images.example.com/sanji-ref.png');
  assert.equal(calls[0]?.width, 960);
  assert.equal(calls[0]?.height, 1344);
  assert.equal(calls[0]?.size_source, 'web_init_image');
  assert.equal(calls[0]?.size_reason, 'preserve_init_image_ratio');
  assert.equal(result.mask?.meta?.renderSizing?.resolvedWidth, 960);
  assert.equal(result.mask?.meta?.renderSizing?.resolvedHeight, 1344);
});

test('generateImageFromMask keeps the uploaded chat source image as init image instead of replacing it with a web accessory preview', async () => {
  const calls = [];
  let verificationExpected = null;

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['sujet de reference'],
        environment: ['decor urbain sombre'],
        style: ['portrait live action credible'],
        composition: ['personnage entier visible'],
        lighting: ['lumiere dramatique'],
        palette: ['violet', 'vert'],
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
        init_image_url: 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png',
        reference_image_url: 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png',
        webImageDraft: {
          initImageUrl: 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png',
          mode: 'image_url',
          sourceUsed: 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png',
          fromChatSourceImage: true,
          width: 768,
          height: 1024,
        },
        subjectProfile: {
          type: 'single_human_figure',
        },
        semantic: {
          accessories: [{ label: 'batte custom joker', family: 'weapon' }],
        },
      },
      ambiguities: [],
      raw: 'utilise ma photo comme reference et transforme moi en joker avec une batte custom visible',
    },
    lookupImageHintWebContext: async () => ({
      imageUrl: 'https://stem.example.com/resources/previews/golden-and-purple-baton-with-joker-mask-free-png.png',
      imageTitle: 'golden and purple baton with joker mask free png',
      sourceUrl: 'https://stem.example.com/resources/previews/joker-baton',
      sourceDomain: 'stem.example.com',
      imageWidth: 980,
      imageHeight: 980,
      imageSelectionScore: 11,
    }),
    resolveImageReferencePack: async () => null,
    directImageRequest: async ({ mask }) => ({
      mask,
      director: null,
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/joker-source.png',
        filename: 'joker-source.png',
      };
    },
    verifyImageCardinality: async ({ expected }) => {
      verificationExpected = expected;
      return {
        ok: true,
        expected: {
          subject_count: Number(expected?.subjectCount || 0) || 1,
          subject_type: expected?.subjectType || 'subject',
          subject_label: expected?.subjectLabel || 'joker',
          allow_group: false,
        },
        observed: {
          subject_count: 1,
          duplicate_subjects: false,
          fusion_detected: false,
          subject_match: true,
          confidence: 0.94,
        },
        decision: {
          retry: false,
          reason: 'single_subject_confirmed',
        },
      };
    },
    verifyImageWithLlmJudge: async () => ({
      ok: false,
      skipped: true,
      reason: 'vision_llm_unavailable',
    }),
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init_image_url, 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png');
  assert.doesNotMatch(String(calls[0]?.init_image_url || ''), /joker-mask-free-png/i);
  assert.equal(result.mask?.meta?.webImageDraft?.fromChatSourceImage, true);
  assert.equal(result.mask?.meta?.webImageDraft?.initImageUrl, 'http://127.0.0.1:3000/files/runtime/files/uploads/joker-source.png');
  assert.notEqual(result.mask?.meta?.webImageDraft?.sceneType, 'duo/groupe');
  assert.equal(Number(verificationExpected?.subjectCount || 0), 1);
  assert.equal(String(verificationExpected?.mode || ''), 'single');
  assert.equal(String(verificationExpected?.subjectLabel || ''), 'joker');
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

test('generateImageFromMask retries once by default when verification suggests a retry', async () => {
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
    generateSd: async ({ body }) => {
      callCount += 1;
      if (callCount === 2) {
        assert.match(String(body?.prompt || ''), /show a single dragon|montrer un seul dragon/i);
        assert.match(String(body?.prompt || ''), /clean distinct subject shapes|formes du sujet nettes et distinctes/i);
      }
      return {
        ok: true,
        image_url: `https://files.example.com/dragon-${callCount}.png`,
        filename: `dragon-${callCount}.png`,
      };
    },
    verifyImageCardinality: async ({ imageUrl }) => {
      if (String(imageUrl).includes('dragon-1.png')) {
        return {
          ok: true,
          expected: { subject_count: 1, subject_type: 'dragon', subject_label: 'dragon', allow_group: false },
          observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: true, subject_match: true, confidence: 0.88 },
          decision: { retry: true, reason: 'fusion_detected', notes: '' },
        };
      }
      return {
        ok: true,
        expected: { subject_count: 1, subject_type: 'dragon', subject_label: 'dragon', allow_group: false },
        observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.93 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  }));

  assert.equal(callCount, 2);
  assert.equal(result.imageGuard?.retries?.length, 1);
  assert.equal(result.imageGuard?.verification?.decision?.retry, false);
});

test('generateImageFromMask relaxes fusion retries for automatic web init drafts', async () => {
  let callCount = 0;

  const result = await withImagePipelineMode('smart', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['brook'],
        environment: ['concert rock'],
        style: ['illustration anime nette'],
        composition: [],
        lighting: [],
        palette: [],
      },
      options: {
        width: 1344,
        height: 1024,
        steps: 30,
        guidance_scale: 7.5,
      },
      constraints: {
        safe_mode: true,
        no_text: true,
      },
      meta: {
        webImageDraft: {
          initImageUrl: 'https://images.example.com/brook-bad-ref.jpg',
          strength: 0.45,
          reason: 'automatic_web_anchor',
          compositeRisk: true,
        },
      },
      ambiguities: [],
      raw: 'genere une image de brook dans un concert rock',
    },
    imageVerificationEnabled: true,
    generateSd: async () => {
      callCount += 1;
      return {
        ok: true,
        image_url: `https://files.example.com/brook-${callCount}.png`,
        filename: `brook-${callCount}.png`,
      };
    },
    verifyImageCardinality: async () => ({
      ok: true,
      expected: { subject_count: 1, subject_type: 'brook', subject_label: 'brook', allow_group: false },
      observed: { subject_count: 1, duplicate_subjects: false, fusion_detected: true, subject_match: true, confidence: 0.9 },
      decision: { retry: true, reason: 'fusion_detected', notes: '' },
    }),
  }));

  assert.equal(callCount, 1);
  assert.equal(result.imageGuard?.retries?.length, 0);
  assert.equal(result.imageGuard?.verification?.decision?.retry, false);
  assert.equal(result.imageGuard?.verification?.decision?.reason, 'fusion_detected_web_init_tolerated');
});

test('generateImageFromMask retries duo prompts when verification detects extra characters', async () => {
  let callCount = 0;

  const result = await withImagePipelineMode('smart', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['zelda', 'mario'],
        environment: [],
        style: ['illustration fantasy nette'],
        composition: [],
        lighting: [],
        palette: [],
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
      raw: 'crée une image de Zelda et Mario',
    },
    imageVerificationEnabled: true,
    generateSd: async ({ body }) => {
      callCount += 1;
      if (callCount === 2) {
        assert.match(String(body?.prompt || ''), /exactement deux personnages distincts/i);
        assert.match(String(body?.prompt || ''), /une seule occurrence de chaque personnage/i);
        assert.match(String(body?.negative_prompt || ''), /collage|montage|mosaïque/i);
      }
      return {
        ok: true,
        image_url: `https://files.example.com/pair-${callCount}.png`,
        filename: `pair-${callCount}.png`,
      };
    },
    verifyImageCardinality: async ({ imageUrl }) => {
      if (String(imageUrl).includes('pair-1.png')) {
        return {
          ok: true,
          expected: { subject_count: 2, subject_type: 'character', subject_label: 'zelda et mario', allow_group: false },
          observed: { subject_count: 3, duplicate_subjects: true, fusion_detected: false, subject_match: true, confidence: 0.87 },
          decision: { retry: true, reason: 'multiple_subjects_detected', notes: '' },
        };
      }
      return {
        ok: true,
        expected: { subject_count: 2, subject_type: 'character', subject_label: 'zelda et mario', allow_group: false },
        observed: { subject_count: 2, duplicate_subjects: false, fusion_detected: false, subject_match: true, confidence: 0.92 },
        decision: { retry: false, reason: 'ok', notes: '' },
      };
    },
  }));

  assert.equal(callCount, 2);
  assert.equal(result.imageGuard?.retries?.length, 1);
  assert.equal(result.imageGuard?.verification?.observed?.subject_count, 2);
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
    resolveImageReferencePack: async () => null,
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

test('generateImageFromMask forwards multi-part web references to the special compiler context', async () => {
  const llmCalls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['Luffy'],
        environment: ['fond simple'],
        style: ['anime propre'],
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
          confidence: 0.44,
          accessories: [
            { label: 'grand sombrero mexicain', family: 'wearable' },
            { label: 'cigarette', family: 'smoking_prop' },
          ],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: {
          type: 'reference_character',
        },
      },
      ambiguities: [],
      raw: 'génère une image de luffy avec un grand sombrero mexicain et une cigarette visible près de la bouche',
    },
    resolveImageReferencePack: async () => ({
      subject: 'Luffy',
      universe: 'One Piece',
      summaryFacts: [
        'Référence accessory grand sombrero mexicain : anime outfit reference',
        'Référence accessory cigarette : mouth smoking pose anime',
      ],
      references: [
        {
          role: 'subject',
          label: 'Luffy',
          family: 'reference_character',
          placement: '',
          query: 'Luffy One Piece character art',
          title: 'Luffy official character art',
          sourceDomain: 'example.com',
          selectionScore: 11,
        },
        {
          role: 'accessory',
          label: 'grand sombrero mexicain',
          family: 'wearable',
          placement: 'head_or_body',
          query: 'Luffy grand sombrero mexicain wearing headwear anime reference',
          title: 'Luffy sombrero reference',
          sourceDomain: 'example.com',
          selectionScore: 10,
        },
        {
          role: 'accessory',
          label: 'cigarette',
          family: 'smoking_prop',
          placement: 'mouth',
          query: 'Luffy cigarette mouth smoking pose anime',
          title: 'Luffy smoking pose reference',
          sourceDomain: 'example.com',
          selectionScore: 9,
        },
      ],
    }),
    specialCompilerCallStructuredLlmJson: async ({ text }) => {
      llmCalls.push(text);
      if (/references_web/.test(String(text || ''))) {
        assert.match(String(text), /Luffy sombrero reference/i);
        assert.match(String(text), /Luffy smoking pose reference/i);
        return {
          composition_hints: ['accessoires lisibles'],
          environment_hints: [],
          style_hints: [],
          prompt_instructions: ['Montrer clairement le sombrero et la cigarette près de la bouche.'],
        };
      }
      return {
        prompt: 'Luffy avec un grand sombrero mexicain et une cigarette visible près de la bouche, anime propre, fond simple',
        negative_prompt: 'texte, watermark',
      };
    },
    generateSd: async () => ({
      ok: true,
      image_url: 'https://files.example.com/luffy.png',
      filename: 'luffy.png',
    }),
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

  assert.ok(llmCalls.length >= 1);
  assert.ok(result.mask?.meta?.webReferencePack);
  assert.match(String(result.sdBody?.prompt || ''), /sombrero mexicain/i);
  assert.match(String(result.sdBody?.prompt || ''), /cigarette visible près de la bouche/i);
});

test('generateImageFromMask uses a local reference composite as init image when no single web draft is available', async () => {
  const calls = [];

  const result = await withImagePipelineMode('orchestrated', () => generateImageFromMask({
    req: { headers: {} },
    rawMask: {
      version: 'mask-1',
      intent: 'image.generate',
      task: { domain: 'image', action: 'generate' },
      compiler: { target: 'sd-payload', version: '1.0' },
      inputs: {
        subject: ['Luffy'],
        environment: ['fond simple'],
        style: ['anime propre'],
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
          confidence: 0.44,
          accessories: [
            { label: 'grand sombrero mexicain', family: 'wearable' },
          ],
          elements: [],
          metiers: [],
          scenes: [],
        },
        subjectProfile: {
          type: 'reference_character',
        },
      },
      ambiguities: [],
      raw: 'génère une image de luffy avec un grand sombrero mexicain',
    },
    resolveImageWebDraft: async () => null,
    resolveImageReferencePack: async () => ({
      subject: 'Luffy',
      universe: 'One Piece',
      summaryFacts: [],
      references: [
        {
          role: 'subject',
          label: 'Luffy',
          imageUrl: 'https://images.example.com/luffy.png',
          width: 768,
          height: 1024,
        },
        {
          role: 'accessory',
          label: 'grand sombrero mexicain',
          placement: 'head',
          imageUrl: 'https://images.example.com/hat.png',
          width: 512,
          height: 384,
        },
      ],
    }),
    buildImageReferenceComposite: async () => ({
      mode: 'web-reference-composite',
      reason: 'reference_pack_composite',
      initImagePath: 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\reference-composites\\luffy-hat.png',
      initImageUrl: 'D:\\funesterie\\a11\\backend\\apps\\server\\tmp\\generated\\reference-composites\\luffy-hat.png',
      width: 1024,
      height: 1344,
      strength: 0.28,
    }),
    generateSd: async ({ body }) => {
      calls.push(body);
      return {
        ok: true,
        image_url: 'https://files.example.com/luffy-hat.png',
        filename: 'luffy-hat.png',
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
  assert.match(String(calls[0]?.init_image_url || ''), /reference-composites\\luffy-hat\.png$/i);
  assert.equal(calls[0]?.width, 1024);
  assert.equal(calls[0]?.height, 1344);
  assert.equal(calls[0]?.size_source, 'web_init_image');
  assert.equal(calls[0]?.size_reason, 'preserve_init_image_ratio');
  assert.equal(result.mask?.meta?.webImageDraft?.mode, 'web-reference-composite');
});

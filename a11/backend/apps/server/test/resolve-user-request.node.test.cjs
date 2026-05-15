const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createIntentResolver,
} = require('../src/resolve-user-request.cjs');
const textToWazaa = require('../src/mask/text-to-wazaa.cjs');
const wazaaToMask = require('../src/mask/wazaa-to-mask.cjs');
const {
  smoothRequestTextSync,
} = require('../src/knowledge/request-text-smoother.cjs');
const {
  translateImagePromptToEnglish,
} = require('../src/mask/build-sd-prompt-bundle.cjs');
const {
  normalizeIntentType,
} = require('../src/mask/semantic/semantic-utils.cjs');
const validateMaskUnified = require('../src/mask/validate-mask-unified.cjs');

async function withImagePipelineMode(mode, fn) {
  const previous = process.env.A11_IMAGE_PIPELINE_MODE;
  process.env.A11_IMAGE_PIPELINE_MODE = mode;
  try {
    return await fn();
  } finally {
    process.env.A11_IMAGE_PIPELINE_MODE = previous;
  }
}

function buildTestCanonicalizedImageRequest(rawUserInput = '') {
  const sourceText = String(rawUserInput || '').trim();
  const smoothing = smoothRequestTextSync(sourceText, {
    source: 'resolve-user-request-test',
    enableLlm: false,
  });
  const heuristicWazaa = typeof textToWazaa.sync === 'function'
    ? textToWazaa.sync(smoothing.text, {
      source: 'resolve-user-request-test',
      requestTextSmootherResult: smoothing,
    })
    : null;
  const mask = wazaaToMask(heuristicWazaa, {
    intentType: 'image.generate',
    sourceText: smoothing.text,
  }) || {
    inputs: {
      subject: [],
      environment: [],
      style: [],
      composition: [],
      lighting: [],
      palette: [],
    },
    constraints: {
      no_text: true,
      safe_mode: true,
    },
    meta: {},
  };
  const toTestEnglish = (value = '') => String(translateImagePromptToEnglish(value) || value || '')
    .replace(/\bcolors?\s+lisibles?\b/gi, 'clear colors')
    .replace(/\bbien\s+lisible\b/gi, 'clearly readable')
    .replace(/\blisible\b/gi, 'readable')
    .replace(/\bclaire\b/gi, 'clear')
    .replace(/\bclair\b/gi, 'clear')
    .replace(/\bcreature unique complete\b/gi, 'full single creature')
    .replace(/\bpersonnage complet\b/gi, 'full character')
    .replace(/\barmor complete\b/gi, 'full armor')
    .replace(/\bpose clear and readable\b/gi, 'clear readable pose')
    .replace(/\s+/g, ' ')
    .trim();
  const translateList = (values = []) => values
    .map((entry) => toTestEnglish(entry))
    .filter(Boolean);
  const palette = translateList(mask?.inputs?.palette || []);
  let subject = translateList(mask?.inputs?.subject || []);
  if (subject.length === 1 && palette.length === 1 && !new RegExp(`\\b${palette[0]}\\b`, 'i').test(subject[0])) {
    subject = [`${subject[0]} ${palette[0]}`.trim()];
  }
  return {
    canonicalEnglishInput: toTestEnglish(smoothing.text) || smoothing.text,
    structuredFields: {
      subject,
      environment: translateList(mask?.inputs?.environment || []),
      style: translateList(mask?.inputs?.style || []),
      composition: translateList(mask?.inputs?.composition || []),
      lighting: translateList(mask?.inputs?.lighting || []),
      palette,
      constraints: {
        promptInstructions: translateList(mask?.meta?.promptInstructions || []),
        negativeHints: [],
        noText: mask?.constraints?.no_text !== false,
        safeMode: mask?.constraints?.safe_mode !== false,
      },
    },
    scenePolicy: {
      subjectMode: subject.length === 2 ? 'pair' : 'single',
      explicitSubjectCount: Math.max(1, subject.length || 1),
    },
    audit: {
      rawUserInput: sourceText,
    },
  };
}

function createTestIntentResolver(overrides = {}) {
  return createIntentResolver({
    canonicalizeImageGenerateRequest: async (rawUserInput, options = {}) => {
      const request = buildTestCanonicalizedImageRequest(rawUserInput);
      if (options.referenceImagePresent === true) {
        request.structuredFields.subject = ['reference subject'];
      }
      return request;
    },
    classifyReferenceImages: async () => ({
      skipped: true,
      reason: 'test_default_disabled',
      manifests: [],
    }),
    ...overrides,
  });
}

test('semantic intent aliases normalize to canonical source-of-truth intents', () => {
  assert.equal(normalizeIntentType('code.generate'), 'code.python.generate');
  assert.equal(normalizeIntentType('text.answer'), 'chat.reply');
  assert.equal(normalizeIntentType('action.run'), 'chat.reply');
  assert.equal(normalizeIntentType('memory.recall'), 'chat.reply');
  assert.equal(normalizeIntentType('ui.display'), 'chat.reply');
});

test('resolveUserRequest clarifies ambiguous image requests versus web image search', async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'affiche un dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'clarification');
  assert.equal(resolution.clarification.shouldClarify, true);
  assert.match(
    String(resolution.clarification.question || ''),
    /genere une image|cherche une image existante sur le web/i
  );
});

test('resolveUserRequest emits a valid mask-1 image.generate mask and compiles it', async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.intent, 'image.generate');
  assert.equal(resolution.mask.version, 'mask-1');
  assert.equal(validateMaskUnified(resolution.mask).valid, true);
  assert.ok(Array.isArray(resolution.mask.inputs.environment));
  assert.ok(resolution.mask.inputs.environment.length >= 1);
  assert.equal(resolution.compiled.target, 'image-prompt-en');
  assert.equal(typeof resolution.compiled.value.prompt, 'string');
  assert.match(String(resolution.compiled.value.prompt || ''), /dragon blue/i);
  assert.match(String(resolution.compiled.value.prompt || ''), /single clearly visible main subject/i);
});

test('resolveUserRequest surfaces canonicalizer clarification before image runtime when the canonical english state is ambiguous', async () => {
  const resolver = createTestIntentResolver({
    canonicalizeImageGenerateRequest: async (rawUserInput) => ({
      needsClarification: true,
      clarificationQuestion: 'Do you want a single subject or multiple subjects in the image?',
      canonicalEnglishInput: '',
      structuredFields: {
        subject: [],
        environment: [],
        style: [],
        composition: [],
        lighting: [],
        palette: [],
        constraints: {
          promptInstructions: [],
          negativeHints: [],
          noText: true,
          safeMode: true,
        },
      },
      scenePolicy: {
        subjectMode: 'unspecified',
        explicitSubjectCount: null,
      },
      audit: {
        rawUserInput,
      },
    }),
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'clarification');
  assert.equal(resolution.clarification.shouldClarify, true);
  assert.match(String(resolution.clarification.question || ''), /single subject or multiple subjects/i);
});

test('resolveUserRequest surfaces a visible canonicalizer diagnostic instead of throwing when english-only validation fails twice', async () => {
  const resolver = createTestIntentResolver({
    canonicalizeImageGenerateRequest: async () => {
      const error = new Error('image_request_canonicalizer_failed');
      error.code = 'image_request_canonicalizer_failed';
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'image_request_canonicalizer_failed',
        message: 'image_request_canonicalizer_failed',
        details: {
          stage: 'resolve-user-request',
          reasons: [
            'provided_structured_llm:canonicalized_request_not_english_only',
            'provided_structured_llm_retry:canonicalized_request_not_english_only',
          ],
          policy: 'llm_only_no_heuristic_fallback',
          rejectedPayloads: [
            {
              attempt: 'provided_structured_llm_retry',
              reason: 'canonicalized_request_not_english_only',
              payload: {
                canonicalEnglishInput: 'femme en tenue theatrale',
              },
            },
          ],
        },
      };
      throw error;
    },
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de femme en tenue theatrale',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate.diagnostic');
  assert.equal(resolution.responsePayload?.mode, 'image_canonicalizer_diagnostic');
  assert.match(String(resolution.responsePayload?.assistant || ''), /requete image a ete comprise/i);
  assert.match(String(resolution.responsePayload?.assistant || ''), /diagnostic\.rejectedPayloads/i);
  assert.deepEqual(
    resolution.responsePayload?.diagnostic?.reasons,
    [
      'provided_structured_llm:canonicalized_request_not_english_only',
      'provided_structured_llm_retry:canonicalized_request_not_english_only',
    ]
  );
  assert.equal(
    resolution.responsePayload?.diagnostic?.summary?.failedBecause,
    'english_only_validation_failed_after_retry'
  );
  assert.equal(
    resolution.responsePayload?.diagnostic?.rejectedPayloads?.[0]?.payload?.canonicalEnglishInput,
    'femme en tenue theatrale'
  );
});

test('resolveUserRequest emits canonical code.python.generate masks that compile to python', async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'ecris un script python qui trie des png',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'code.python.generate');
  assert.equal(resolution.mask.intent, 'code.python.generate');
  assert.equal(resolution.mask.version, 'mask-1');
  assert.equal(validateMaskUnified(resolution.mask).valid, true);
  assert.equal(resolution.compiled.target, 'python');
  assert.match(String(resolution.code || resolution.compiled.value || ''), /def main|Path/);
});

test("resolveUserRequest keeps image troubleshooting requests in text mode", async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: "explique le probleme avec le generateur d'image",
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'chat.reply');
  assert.equal(resolution.mask.intent, 'chat.reply');
});

test("resolveUserRequest keeps non-conforming drawing questions in text mode", async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'pourquoi le dessin de truc pas conforme ?',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'chat.reply');
  assert.equal(resolution.mask.intent, 'chat.reply');
});

test("resolveUserRequest keeps archive lookups about Render in text mode", async () => {
  const resolver = createTestIntentResolver({
    detectIntentWithLlm: async () => ({
      intent: 'chat.reply',
      confidence: 0.5,
      reason: 'test_low_confidence_text_reply',
      subject: '',
    }),
  });
  const resolution = await resolver.resolveUserRequest({
    userText: 'Dans nos archives locales, retrouve la conversation ou on reparait Render et donne juste son titre.',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'chat.reply');
  assert.equal(resolution.mask.intent, 'chat.reply');
});

test('resolveUserRequest enriches doubtful image prompts with concise web definition context', async () => {
  const fakeTextToWazaa = async (text) => ({
    wazaa: '1.1',
    meta: {
      source: 'test',
      timestamp: 1,
      sourceText: text,
    },
    signal: { confidence: 0.41 },
    hierarchy: {},
    entities: [],
    relations: [],
    intents: [{ type: 'image.generate', score: 0.51, label: 'Generer une image' }],
    ambiguities: [],
    intent: {
      type: 'image.generate',
      confidence: 0.41,
    },
  });
  fakeTextToWazaa.sync = (text) => ({
    wazaa: '1.1',
    meta: {
      source: 'test',
      timestamp: 1,
      sourceText: text,
    },
    signal: { confidence: 0.41 },
    hierarchy: {},
    entities: [],
    relations: [],
    intents: [{ type: 'image.generate', score: 0.51, label: 'Generer une image' }],
    ambiguities: [],
    intent: {
      type: 'image.generate',
      confidence: 0.41,
    },
  });

  const lookupCalls = [];
  const resolver = createTestIntentResolver({
    textToWazaa: fakeTextToWazaa,
    lookupDefinitionContext: async ({ query }) => {
      lookupCalls.push(query);
      return {
        term: query,
        title: 'qilin',
        summary: 'Créature mythique chinoise proche du dragon, souvent représentée comme un être noble et fantastique.',
        url: 'https://example.com/qilin',
        source: 'test',
        language: 'fr',
      };
    },
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de qilin violet',
    executeRuntime: false,
  });

  assert.equal(lookupCalls.length, 1);
  assert.equal(lookupCalls[0], 'qilin');
  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.meta.definitionLookup.title, 'qilin');
  assert.match(String(resolution.compiled.value.prompt || ''), /qilin violet/i);
  assert.doesNotMatch(String(resolution.compiled.value.prompt || ''), /Contexte utile :/i);
});

test('resolveUserRequest attaches a temporary image scratchpad when an entity is resolved', async () => {
  const resolver = createTestIntentResolver({
    resolveImageEntityContext: async () => ({
      canonicalSubject: 'Master Chief',
      description: "personnage de fiction de l'univers Halo",
      summary: 'Super-soldat fictif de la franchise Halo.',
      universe: 'Halo',
      entityType: 'fictional_character',
    }),
  });

  const resolution = await withImagePipelineMode('smart', () => resolver.resolveUserRequest({
    userText: 'genere une image de john 117 en armure bleue',
    executeRuntime: false,
  }));

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.meta.imageEntityContext.canonicalSubject, 'Master Chief');
  assert.equal(resolution.mask.meta.imageScratchpad.canonicalSubject, 'Master Chief');
  assert.match(String(resolution.compiled.value.prompt || ''), /master chief.*blue/i);
  assert.match(String(resolution.compiled.value.prompt || ''), /full armor clearly readable|full armor/i);
  assert.doesNotMatch(String(resolution.compiled.value.prompt || ''), /Ardoise utile :/i);
});

test('resolveUserRequest marks simple single-subject prompts as raw by default', async () => {
  const resolver = createTestIntentResolver({
    resolveImageEntityContext: async () => ({
      canonicalSubject: 'Master Chief',
      description: "personnage de fiction de l'univers Halo",
      summary: 'Super-soldat fictif de la franchise Halo.',
      universe: 'Halo',
      entityType: 'fictional_character',
    }),
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de pomme',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.imageRequestMode, 'raw');
  assert.equal(resolution.mask.meta.imageRequestMode, 'raw');
  assert.equal(resolution.mask.meta.imageScratchpad, undefined);
});

test('resolveUserRequest promotes mythic creature prompts to smart mode', async () => {
  const resolver = createTestIntentResolver();

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de licorne',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.imageRequestMode, 'smart');
  assert.equal(resolution.mask.meta.imageRequestMode, 'smart');
  assert.equal(resolution.mask.meta.subjectProfile?.type, 'mythic_creature');
});

test('resolveUserRequest promotes named character wardrobe prompts to smart mode', async () => {
  const resolver = createTestIntentResolver();

  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de zelda en bikini',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.imageRequestMode, 'smart');
  assert.equal(resolution.mask.meta.imageRequestMode, 'smart');
  assert.equal(resolution.mask.meta.subjectProfile?.type, 'reference_character');
});

test('resolveUserRequest keeps noisy image requests untouched locally before canonicalization', async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une imag de pikachuu bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.requestText.changed, false);
  assert.equal(resolution.requestText.original, 'genere une imag de pikachuu bleu');
  assert.equal(String(resolution.requestText.smoothed || ''), 'genere une imag de pikachuu bleu');
  assert.equal(resolution.mask.meta.audit.rawUserInput, 'genere une imag de pikachuu bleu');
  assert.match(String(resolution.mask.meta.originalSourceText || ''), /pikachuu blue|an imag de pikachuu blue/i);
  assert.match(String(resolution.mask.meta.requestTextSmoother?.smoothedText || ''), /pikachuu blue|an imag de pikachuu blue/i);
  assert.match(String(resolution.mask.inputs.subject?.[0] || ''), /pikachuu/i);
});

test('resolveUserRequest injects sourceImageUrl into image masks for direct img2img requests', async () => {
  const resolver = createTestIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une photo de ce fichier au theme dragon ball z',
    body: {
      sourceImageUrl: 'http://127.0.0.1:3000/files/runtime/files/uploads/demo.png',
    },
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.imageRequestMode, 'smart');
  assert.equal(resolution.mask.meta.init_image_url, 'http://127.0.0.1:3000/files/runtime/files/uploads/demo.png');
  assert.equal(resolution.mask.meta.reference_image_url, 'http://127.0.0.1:3000/files/runtime/files/uploads/demo.png');
  assert.equal(resolution.mask.meta.webImageDraft.initImageUrl, 'http://127.0.0.1:3000/files/runtime/files/uploads/demo.png');
  assert.equal(resolution.mask.meta.webImageDraft.mode, 'image_url');
  assert.equal(resolution.mask.meta.webImageDraft.fromChatSourceImage, true);
  assert.equal(Array.isArray(resolution.mask.inputs.subject), true);
  assert.deepEqual(resolution.mask.inputs.subject, ['reference subject']);
});

test('resolveUserRequest lets A11 promote the Janus-selected primary image instead of blindly keeping the first reference', async () => {
  const resolver = createTestIntentResolver({
    canonicalizeImageGenerateRequest: async () => ({
      needsClarification: false,
      clarificationQuestion: '',
      canonicalEnglishInput: 'use these reference images to transform the same person into a Joker-style version',
      structuredFields: {
        subject: ['reference subject'],
        environment: [],
        style: ['joker-style transformation'],
        composition: [],
        lighting: [],
        palette: [],
        constraints: {
          promptInstructions: [],
          negativeHints: [],
          noText: true,
          safeMode: true,
        },
      },
      scenePolicy: {
        subjectMode: 'single',
        explicitSubjectCount: 1,
      },
      audit: {
        rawUserInput: 'utilise ces images pour transformer la personne en joker',
      },
    }),
    classifyReferenceImages: async ({ references }) => ({
      skipped: false,
      manifests: [
        {
          image_id: references[0].image_id,
          detected_content: 'human portrait with mobile UI overlay',
          probable_role: 'style_reference',
          confidence: 0.58,
          quality_flags: ['screenshot_ui'],
        },
        {
          image_id: references[1].image_id,
          detected_content: 'close portrait of the same person',
          probable_role: 'identity',
          confidence: 0.91,
          quality_flags: [],
        },
      ],
      primary_image_id: references[1].image_id,
      primary_role: 'identity',
      primary_confidence: 0.91,
      clarification_required: false,
      clarification_question: '',
      conflicts: [],
    }),
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'utilise ces images pour transformer la personne en joker',
    body: {
      sourceImages: [
        { imageId: 'shot-a', url: 'https://images.example.com/style-board.png' },
        { imageId: 'shot-b', url: 'https://images.example.com/identity-shot.png' },
      ],
    },
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.meta.init_image_url, 'https://images.example.com/identity-shot.png');
  assert.equal(resolution.mask.meta.reference_image_url, 'https://images.example.com/identity-shot.png');
  assert.equal(resolution.mask.meta.webImageDraft.initImageUrl, 'https://images.example.com/identity-shot.png');
  assert.equal(resolution.mask.meta.webImageDraft.imageReferenceRole, 'identity');
  assert.equal(resolution.mask.meta.imageReferenceDecision.primaryImageId, 'shot-b');
  assert.equal(resolution.mask.meta.imageReferenceDecision.primaryRole, 'identity');
  assert.match(
    String((resolution.mask.inputs.style || []).join(', ') || ''),
    /style reference: human portrait with mobile ui overlay/i
  );
});

test('resolveUserRequest falls back to an A11 auto decision when Janus is unavailable', async () => {
  const resolver = createTestIntentResolver({
    canonicalizeImageGenerateRequest: async () => ({
      needsClarification: false,
      clarificationQuestion: '',
      canonicalEnglishInput: 'use these reference images to transform the same person into a Joker-style version',
      structuredFields: {
        subject: ['reference subject'],
        environment: [],
        style: ['joker-style transformation'],
        composition: [],
        lighting: [],
        palette: [],
        constraints: {
          promptInstructions: [],
          negativeHints: [],
          noText: true,
          safeMode: true,
        },
      },
      scenePolicy: {
        subjectMode: 'single',
        explicitSubjectCount: 1,
      },
      audit: {
        rawUserInput: 'utilise ces images pour transformer la personne en joker',
      },
    }),
    classifyReferenceImages: async () => ({
      skipped: true,
      reason: 'janus_unavailable',
      manifests: [],
    }),
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'utilise ces images pour transformer la personne en joker',
    body: {
      sourceImages: [
        { imageId: 'shot-a', url: 'https://images.example.com/identity-shot.png' },
        { imageId: 'shot-b', url: 'https://images.example.com/style-board.png' },
      ],
    },
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.meta.init_image_url, 'https://images.example.com/identity-shot.png');
  assert.equal(resolution.mask.meta.imageReferenceDecision.primaryImageId, 'shot-a');
  assert.equal(resolution.mask.meta.imageReferenceDecision.primaryRole, '');
  assert.equal(resolution.mask.meta.imageReferenceDecision.decisionSource, 'a11_fallback');
  assert.equal(resolution.mask.meta.imageReferenceDecision.selectionMode, 'fallback_first_reference');
  assert.equal(resolution.mask.meta.imageReferenceDecision.fallbackReason, 'janus_unavailable');
  assert.equal(resolution.imageReferenceResolution.fallback_reason, 'janus_unavailable');
});

test('resolveUserRequest asks for clarification when Janus finds multiple competing identity references', async () => {
  const resolver = createTestIntentResolver({
    canonicalizeImageGenerateRequest: async () => ({
      needsClarification: false,
      clarificationQuestion: '',
      canonicalEnglishInput: 'use these two reference photos for a Joker-style transformation of the same person',
      structuredFields: {
        subject: ['reference subject'],
        environment: [],
        style: ['joker-style transformation'],
        composition: [],
        lighting: [],
        palette: [],
        constraints: {
          promptInstructions: [],
          negativeHints: [],
          noText: true,
          safeMode: true,
        },
      },
      scenePolicy: {
        subjectMode: 'single',
        explicitSubjectCount: 1,
      },
      audit: {
        rawUserInput: 'utilise ces deux photos pour une transformation joker',
      },
    }),
    classifyReferenceImages: async ({ references }) => ({
      skipped: false,
      manifests: [
        {
          image_id: references[0].image_id,
          detected_content: 'front portrait',
          probable_role: 'identity',
          confidence: 0.83,
          quality_flags: [],
        },
        {
          image_id: references[1].image_id,
          detected_content: 'three-quarter portrait',
          probable_role: 'identity',
          confidence: 0.79,
          quality_flags: [],
        },
      ],
      primary_image_id: references[0].image_id,
      primary_role: 'identity',
      primary_confidence: 0.83,
      clarification_required: true,
      clarification_question: 'J’ai trouvé plusieurs images qui ressemblent à des références d’identité. Laquelle doit rester l’image principale ?',
      conflicts: [
        {
          image_id: references[1].image_id,
          probable_role: 'identity',
          confidence: 0.79,
        },
      ],
    }),
  });

  const resolution = await resolver.resolveUserRequest({
    userText: 'utilise ces deux photos pour une transformation joker',
    body: {
      sourceImages: [
        { imageId: 'face-a', url: 'https://images.example.com/face-a.png' },
        { imageId: 'face-b', url: 'https://images.example.com/face-b.png' },
      ],
    },
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'clarification');
  assert.equal(resolution.clarification.shouldClarify, true);
  assert.match(String(resolution.clarification.question || ''), /références d’identité/i);
});

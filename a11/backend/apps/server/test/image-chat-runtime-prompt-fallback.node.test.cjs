const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyStrengthComponentPromptGuidance,
  compileMaskImageGenerateRuntime,
} = require('../src/mask/image-chat-runtime.cjs');

async function withImagePipelineMode(value, fn) {
  const previous = process.env.A11_IMAGE_PIPELINE_MODE;
  process.env.A11_IMAGE_PIPELINE_MODE = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.A11_IMAGE_PIPELINE_MODE;
    else process.env.A11_IMAGE_PIPELINE_MODE = previous;
  }
}

test('compileMaskImageGenerateRuntime preserves rich original reference details when refinement compresses them', async () => {
  let fieldRepairCalls = 0;
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
      composition: ['portrait propre'],
      lighting: [],
      palette: [],
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
      originalSourceText: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker dans un style sombre, cinematographique et realiste tout en conservant le meme visage, la meme structure faciale, la meme corpulence, la meme posture et la meme presence generale. Remplace la tenue par un costume Joker complet en violet et vert use, ajoute un maquillage de clown inquietant, rends la batte custom clairement visible et transforme le decor en rue brute inspiree de Harlem avec graffitis, immeuble use, sol sale, reflets de neons et lumiere dramatique. Sujet unique, personnage entier visible, haute qualite, aucun texte lisible.',
      webImageDraft: {
        initImageUrl: 'https://images.example.com/joker-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
    ambiguities: [],
    raw: 'transforme moi en joker',
  }, {
    callStructuredLlmJson: async ({ systemPrompt }) => {
      if (/multilingual prompt-context translator/i.test(String(systemPrompt || ''))) {
        return {
          target_language: 'english',
          raw_request: 'Transform the person into a dark Joker-inspired character with the same face and a visible custom bat.',
          current_prompt: 'the same person from the reference image, joker portrait, custom bat visible',
          current_negative_prompt: 'text, watermark',
          subject: ['male portrait'],
          environment: ['simple background'],
          style: ['high quality'],
          composition: ['clean portrait'],
          lighting: [],
          palette: [],
          prompt_instructions: [],
          subject_profile_type: 'single_human_figure',
          canonical_subject: '',
          universe: '',
          reference_init_image: 'https://images.example.com/joker-ref.png',
          web_reference_pack: null,
        };
      }
      if (/single image-generation prompt field/i.test(String(systemPrompt || ''))) {
        fieldRepairCalls += 1;
        return {
          translated_text: 'Use the input image as an identity, pose, and framing reference. Transform the person into a dark, cinematic, realistic live-action Joker-inspired character while preserving the same recognizable face, the same facial structure, the same build, the same posture, and the same overall presence as in the original photo. Replace the outfit with a full Joker-themed suit in worn purple and green tones, add unsettling clown makeup, make the custom decorated bat clearly visible, and stage the scene in a raw Harlem-inspired street with graffiti, worn building textures, dirty pavement, neon reflections, dramatic lighting, and a tense noir comic-book atmosphere. Subject only, full body visible, high quality, no readable text.',
        };
      }
      if (/réécrivain final/i.test(String(systemPrompt || ''))) {
        refinerCalls += 1;
        return {
          prompt: 'A character inspired by the Joker with a recognizable face and a custom bat.',
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

  assert.ok(fieldRepairCalls >= 1);
  assert.ok(refinerCalls <= 1);
  assert.ok(
    result.promptRefiner?.applied === false
    || String(result.promptRefiner?.reason || '') === 'promoted_translated_raw_request'
  );
  assert.match(String(result.promptRefiner?.reason || ''), /disabled_or_not_needed|overcompressed_response|promoted_translated_raw_request/i);
  assert.equal(result.localEnglishPromptFallback?.applied, false);
  assert.equal(result.sdBody?.prompt_language, 'en');
  assert.match(String(result.sdBody?.prompt || ''), /the exact same person from the reference image/i);
  assert.match(String(result.sdBody?.prompt || ''), /Joker-style transformation|Joker-style character/i);
  assert.match(String(result.sdBody?.prompt || ''), /same recognizable face|same facial structure/i);
  assert.match(String(result.sdBody?.prompt || ''), /full body visible/i);
  assert.doesNotMatch(String(result.sdBody?.prompt || ''), /\b(?:transforme|garde|decor|lumiere)\b/i);
});

test('compileMaskImageGenerateRuntime no longer promotes a local english fallback when no prompt refiner LLM is available', async () => {
  const result = await withImagePipelineMode('orchestrated', () => compileMaskImageGenerateRuntime({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: ['portrait homme'],
      environment: ['decor urbain inspire de Harlem', 'rue brute avec graffitis'],
      style: ['portrait live action sombre et credible', 'cinematographique', 'haute qualité'],
      composition: ['personnage entier visible', 'batte custom clairement visible', 'composition propre'],
      lighting: ['lumiere dramatique', 'reflets de neons violets et verts'],
      palette: ['violet', 'vert', 'rouge'],
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
      originalSourceText: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker dans un style sombre, cinematographique et realiste tout en conservant le meme visage, la meme structure faciale, la meme corpulence, la meme posture et la meme presence generale. Remplace la batte en bois par une batte custom visible et theatrale, et transforme le decor en rue brute inspiree de Harlem avec graffitis, immeubles uses, sol sale, reflets de neons et lumiere dramatique.',
      webImageDraft: {
        initImageUrl: 'https://images.example.com/joker-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
      promptInstructions: [
        'costume joker elegant mais chaotique',
        'maquillage de clown inquietant mais credible',
        'la batte custom doit etre bien visible',
      ],
    },
    ambiguities: [],
    raw: 'transforme moi en joker',
  }, {
    lookupImageHintWebContext: async () => null,
    resolveImageReferencePack: async () => null,
    directImageRequest: async ({ mask }) => ({
      mask,
      director: null,
    }),
  }));

  assert.equal(result.promptRefiner?.applied, false);
  assert.equal(result.localEnglishPromptFallback?.applied, false);
  assert.equal(result.localEnglishPromptFallback?.reason, 'disabled');
  assert.equal(result.finalPromptGuard?.applied, true);
  assert.equal(result.finalPromptGuard?.reason, 'translated_current_prompt_to_canonical_english');
  assert.match(String(result.sdBody?.prompt || ''), /the exact same person from the reference image/i);
  assert.match(String(result.sdBody?.prompt || ''), /Joker-style transformation/i);
  assert.match(String(result.sdBody?.prompt || ''), /color palette: violet/i);
  assert.doesNotMatch(String(result.sdBody?.prompt || ''), /\b(?:homme|vert|rouge|maquillage|batte)\b/i);
});

test('applyStrengthComponentPromptGuidance refuses to localize a non-english base prompt locally', () => {
  const compiledState = {
    mask: {
      compiler: { target: 'image-prompt-en' },
      meta: {},
    },
    compiledPayload: {
      prompt: 'Transforme la personne en personnage inspire du Joker, garde le meme visage, la meme identite, et rends la batte custom clairement visible avec une lumiere dramatique.',
      negative_prompt: 'texte, watermark, logo',
      prompt_language: 'en',
    },
    compiled: {
      prompt: 'Transforme la personne en personnage inspire du Joker, garde le meme visage, la meme identite, et rends la batte custom clairement visible avec une lumiere dramatique.',
      negative_prompt: 'texte, watermark, logo',
      prompt_language: 'en',
    },
    sdBody: {
      prompt: 'Transforme la personne en personnage inspire du Joker, garde le meme visage, la meme identite, et rends la batte custom clairement visible avec une lumiere dramatique.',
      negative_prompt: 'texte, watermark, logo',
      prompt_language: 'en',
    },
  };

  const mask = {
    compiler: { target: 'image-prompt-en' },
    meta: {
      webImageDraft: {
        strengthComponents: {
          identity: { profile: 'preserve', strength: 0.2 },
          props: { profile: 'restyle', strength: 0.74 },
        },
      },
    },
  };

  const result = applyStrengthComponentPromptGuidance(compiledState, mask);
  const prompt = String(result.compiledState?.sdBody?.prompt || '');
  const negativePrompt = String(result.compiledState?.sdBody?.negative_prompt || '');

  assert.equal(result.promptGuidance?.applied, false);
  assert.equal(result.promptGuidance?.reason, 'base_prompt_not_canonical_english');
  assert.equal(result.compiledState?.sdBody?.prompt_language, 'en');
  assert.match(prompt, /\bTransforme la personne\b/i);
  assert.match(negativePrompt, /\btexte\b/i);
});

test('applyStrengthComponentPromptGuidance reinforces facial anchors and same-side laterality for reference-human transforms', () => {
  const compiledState = {
    mask: {
      compiler: { target: 'image-prompt-en' },
      meta: {},
    },
    compiledPayload: {
      prompt: 'the exact same person from the reference image in a Joker-style transformation, dark Harlem-inspired street, custom bat clearly visible',
      negative_prompt: 'readable text, watermark',
      prompt_language: 'en',
    },
    compiled: {
      prompt: 'the exact same person from the reference image in a Joker-style transformation, dark Harlem-inspired street, custom bat clearly visible',
      negative_prompt: 'readable text, watermark',
      prompt_language: 'en',
    },
    sdBody: {
      prompt: 'the exact same person from the reference image in a Joker-style transformation, dark Harlem-inspired street, custom bat clearly visible',
      negative_prompt: 'readable text, watermark',
      prompt_language: 'en',
      strength_components: {
        identity: { profile: 'preserve', strength: 0.16 },
        anatomy: { profile: 'preserve', strength: 0.22 },
        outfit: { profile: 'balanced', strength: 0.58 },
        background: { profile: 'restyle', strength: 0.76 },
        effects: { profile: 'balanced', strength: 0.62 },
        props: { profile: 'restyle', strength: 0.72 },
      },
    },
  };

  const mask = {
    compiler: { target: 'image-prompt-en' },
    meta: {
      webImageDraft: {
        initImageUrl: 'https://images.example.com/joker-ref.png',
        fromChatSourceImage: true,
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
  };

  const result = applyStrengthComponentPromptGuidance(compiledState, mask);
  const prompt = String(result.compiledState?.sdBody?.prompt || '');
  const negativePrompt = String(result.compiledState?.sdBody?.negative_prompt || '');

  assert.equal(result.promptGuidance?.applied, true);
  assert.match(prompt, /keep the same eyes, eyebrows, nose, jawline, and smile from the reference image/i);
  assert.match(prompt, /preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image/i);
  assert.match(prompt, /ignore any mobile screenshot interface or overlay caption from the reference image/i);
  assert.match(negativePrompt, /different face/i);
  assert.match(negativePrompt, /different identity/i);
  assert.match(negativePrompt, /different person/i);
});

test('compileMaskImageGenerateRuntime canonicalizes a mixed final prompt before the canonical final guard rejects it', async () => {
  const result = await withImagePipelineMode('orchestrated', () => compileMaskImageGenerateRuntime({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['reference subject'],
      environment: ['foret et ville'],
      style: ['hyperrealiste et picturale', 'peinture'],
      composition: [
        'presence spectrale complete et lisible',
        'couronne portee par le sujet principal',
        'accessoire baton bien visible',
      ],
      lighting: [],
      palette: ['violet', 'vert', 'blanc', 'rouge', 'noir'],
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
      webImageDraft: {
        initImageUrl: 'https://images.example.com/reference-subject.png',
      },
      subjectProfile: {
        type: 'reference_character',
        canonicalSubject: 'Reference Subject',
      },
      promptInstructions: [
        'inclure clairement une vraie personnalite visuelle',
        'cadre en plan moyen mettant accent sur le personnage principal',
        'en valeur la profondeur de champ',
      ],
    },
    ambiguities: [],
    raw: 'genere une image du sujet de reference avec une presence spectrale, une couronne, un baton, et un decor foret ville',
  }, {
    callStructuredLlmJson: async ({ systemPrompt, text }) => {
      if (/single image-generation prompt field/i.test(String(systemPrompt || ''))) {
        const sourceText = String(text || '');
        if (/presence spectrale|couronne|baton|foret et ville/i.test(sourceText) && sourceText.length > 220) {
          return {
            translated_text: 'the same subject as in the reference image, show clearly a full readable spectral presence, show clearly the crown worn by the main subject, clearly include the baton accessory with the main subject, clearly include a strong visual identity with the main subject, medium shot focused on the main character, highlighted depth of field, fused forest and city environment, hyperrealistic painterly style, high quality painting, color palette: violet, green, white, red, black, single well-framed subject, clear silhouette, full shape visible, accessory clearly visible, single clearly visible main subject, no readable text. keep exactly the same face and identity. preserve the silhouette and main outfit. clearly redesign the background and atmosphere. make the lighting and effects clearly visible',
          };
        }
        return {
          translated_text: '',
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

  assert.equal(result.sdBody?.prompt_language, 'en');
  assert.equal(result.finalPromptGuard?.applied, true);
  assert.match(String(result.finalPromptGuard?.reason || ''), /translated_(?:current|rebuilt)_prompt_to_canonical_english/i);
  assert.match(String(result.sdBody?.prompt || ''), /spectral presence/i);
  assert.match(String(result.sdBody?.prompt || ''), /crown worn by the main subject/i);
  assert.match(String(result.sdBody?.prompt || ''), /color palette: violet/i);
  assert.doesNotMatch(
    String(result.sdBody?.prompt || ''),
    /\b(?:spectrale|couronne|foret|ville|inclure|vraie|personnalite|profondeur|plan moyen|mettant accent)\b/i
  );
});

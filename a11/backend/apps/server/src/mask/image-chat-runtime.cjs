const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');
const validateMaskImageGenerate = require('./validate-mask-image-generate.cjs');
const compileMaskToSD = require('./compile-mask-to-sd.cjs');
const compileMaskToImagePrompt = require('./compile-mask-to-image-prompt.cjs');
const {
  enrichMaskForSpecialImageCompiler,
  resolveImageCompilerCompartment,
  isImageOrchestratorEnabled,
} = require('./compile-mask-to-image-prompt-special.cjs');
const adaptMaskToFreelandValue = require('./adapt-mask-to-freeland-value.cjs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  inferExpectedImageContract,
  verifyGeneratedImageCardinality,
  buildRetrySdBody,
} = require('../image/verify-generated-image-cardinality.cjs');
const {
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
} = require('../image/image-hint-memory.cjs');
const {
  verifyGeneratedImageWithLlmJudge,
} = require('../image/verify-generated-image-with-llm.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('./resolve-image-mask-from-text.cjs');
const {
  lookupImageHintWebContext: defaultLookupImageHintWebContext,
  resolveImageWebDraft: defaultResolveImageWebDraft,
} = require('../knowledge/image-hint-web-context.cjs');
const {
  resolveImageReferencePack: defaultResolveImageReferencePack,
} = require('../knowledge/image-reference-pack.cjs');
const {
  buildImageReferenceComposite: defaultBuildImageReferenceComposite,
} = require('../knowledge/image-reference-composite.cjs');
const {
  resolveImageEntityContext: defaultResolveImageEntityContext,
} = require('../knowledge/image-entity-resolver.cjs');
const {
  directImageRequest: defaultDirectImageRequest,
} = require('../knowledge/image-request-director.cjs');
const {
  lookupDefinitionContext: defaultLookupDefinitionContext,
} = require('../knowledge/definition-context.cjs');
const {
  duckduckgoImageSearch: defaultDuckduckgoImageSearch,
} = require('../../lib/image-search.cjs');
const {
  enrichImageMaskWithScratchpad,
} = require('./image-scratchpad.cjs');
const {
  compileCharacterCountConstraints,
} = require('./build-sd-prompt-bundle.cjs');
const resolveImageDimensionConfig = normalizeMaskImageGenerate.resolveImageDimensionConfig;

let sharpLib;

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundDimensionToMultiple(value, multiple = 64) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(multiple, Math.round(numeric / multiple) * multiple);
}

function clampRenderDimension(value, max = 2048) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(64, Math.min(max, roundDimensionToMultiple(numeric, 64)));
}

function promptMentionsExplicitCanvas(raw = '') {
  return /\b\d{3,4}\s*[xX]\s*\d{3,4}\b/.test(String(raw || '').trim());
}

function resolveWebDraftCanvasPlan(mask = {}, webImageDraft = {}, env = process.env) {
  const sourceWidth = Number(webImageDraft?.width || 0);
  const sourceHeight = Number(webImageDraft?.height || 0);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const imageConfig = typeof resolveImageDimensionConfig === 'function'
    ? resolveImageDimensionConfig(env)
    : { maxRenderSide: 2048 };
  const maxRenderSide = Number(imageConfig?.maxRenderSide || 2048) || 2048;
  const currentWidth = Number(mask?.options?.width || 0);
  const currentHeight = Number(mask?.options?.height || 0);
  const sourceLongestSide = Math.max(sourceWidth, sourceHeight, 1);
  const currentLongestSide = Math.max(currentWidth, currentHeight, 0);
  const preferredLongestSide = Number(process.env.A11_IMAGE_WEB_DRAFT_TARGET_SIDE || 1344) || 1344;
  const targetLongestSide = Math.min(
    maxRenderSide,
    Math.max(sourceLongestSide, currentLongestSide, preferredLongestSide)
  );
  const scale = targetLongestSide / sourceLongestSide;

  return {
    source: 'web_init_image',
    reason: 'preserve_init_image_ratio',
    requestedWidth: sourceWidth,
    requestedHeight: sourceHeight,
    width: clampRenderDimension(Math.max(64, Math.floor(sourceWidth * scale)), maxRenderSide),
    height: clampRenderDimension(Math.max(64, Math.floor(sourceHeight * scale)), maxRenderSide),
  };
}

function applyWebDraftCanvasToMask(mask = {}, webImageDraft = {}) {
  if (!webImageDraft || typeof webImageDraft !== 'object') return mask;
  if (promptMentionsExplicitCanvas(mask?.raw || '')) return mask;

  const canvasPlan = resolveWebDraftCanvasPlan(mask, webImageDraft, process.env);
  if (!canvasPlan) return mask;

  return {
    ...(mask && typeof mask === 'object' ? mask : {}),
    options: {
      ...((mask && mask.options && typeof mask.options === 'object') ? mask.options : {}),
      width: canvasPlan.width,
      height: canvasPlan.height,
    },
    meta: {
      ...((mask && mask.meta && typeof mask.meta === 'object') ? mask.meta : {}),
      renderSizing: {
        source: canvasPlan.source,
        reason: canvasPlan.reason,
        requestedWidth: canvasPlan.requestedWidth,
        requestedHeight: canvasPlan.requestedHeight,
        resolvedWidth: canvasPlan.width,
        resolvedHeight: canvasPlan.height,
        maxRenderSide: Number(resolveImageDimensionConfig(process.env)?.maxRenderSide || 2048) || 2048,
      },
    },
  };
}

function shouldRelaxWebInitFusionRetry(mask = {}, verification = {}) {
  const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
    ? mask.meta.webImageDraft
    : null;
  if (!webImageDraft) return false;

  const fusionDetected = verification?.observed?.fusion_detected === true
    || String(verification?.decision?.reason || '').trim() === 'fusion_detected';
  if (!fusionDetected) return false;

  return (
    webImageDraft.compositeRisk === true
    || (
      webImageDraft.explicitReferenceAnchor !== true
      && String(webImageDraft.reason || '').trim() === 'automatic_web_anchor'
    )
  );
}

function relaxVerificationForWebInit(mask = {}, verification = {}) {
  if (!verification || typeof verification !== 'object') return verification;
  if (!shouldRelaxWebInitFusionRetry(mask, verification)) return verification;

  return {
    ...verification,
    decision: {
      ...(verification.decision && typeof verification.decision === 'object' ? verification.decision : {}),
      retry: false,
      reason: 'fusion_detected_web_init_tolerated',
      notes: [
        String(verification?.decision?.notes || '').trim(),
        'web_init_relaxed=1',
      ].filter(Boolean).join(' ').trim(),
    },
    raw: {
      ...(verification.raw && typeof verification.raw === 'object' ? verification.raw : {}),
      fusion_retry_relaxed: true,
    },
  };
}

function getSharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = require('sharp');
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

function extractLatestUserMessage(body = {}) {
  if (typeof body?.message === 'string' && body.message.trim()) return body.message.trim();
  if (typeof body?.prompt === 'string' && body.prompt.trim()) return body.prompt.trim();

  if (Array.isArray(body?.messages)) {
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const entry = body.messages[index];
      if (String(entry?.role || '').trim().toLowerCase() !== 'user') continue;

      if (typeof entry?.content === 'string' && entry.content.trim()) {
        return entry.content.trim();
      }

      if (Array.isArray(entry?.content)) {
        const text = entry.content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
            return '';
          })
          .join(' ')
          .trim();
        if (text) return text;
      }
    }
  }

  return '';
}

function normalizeImageRequestModeValue(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'creative') return 'raw';
  if (raw === 'orchestrated' || raw === 'orchestrateur') return 'smart';
  if (['raw', 'smart', 'auto'].includes(raw)) return raw;
  return '';
}

function countImageSemanticFamilies(mask = {}) {
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  return (
    (Array.isArray(semantic?.accessories) ? semantic.accessories.length : 0)
    + (Array.isArray(semantic?.elements) ? semantic.elements.length : 0)
    + (Array.isArray(semantic?.metiers) ? semantic.metiers.length : 0)
    + (Array.isArray(semantic?.scenes) ? semantic.scenes.length : 0)
  );
}

function getImageSubjectProfileType(mask = {}) {
  const directType = String(mask?.meta?.subjectProfile?.type || '').trim();
  if (directType) return directType;
  return String(mask?.meta?.semantic?.subjectProfile?.type || '').trim();
}

function getImageAccessoryFamilies(mask = {}) {
  const accessories = Array.isArray(mask?.meta?.semantic?.accessories)
    ? mask.meta.semantic.accessories
    : [];
  return new Set(
    accessories
      .map((entry) => String(entry?.family || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function isModelSensitiveImageProfile(profileType = '') {
  return [
    'reference_character',
    'single_human_figure',
    'pokemon_creature',
    'mythic_creature',
    'phoenix_creature',
  ].includes(String(profileType || '').trim());
}

function inferAutoImageRequestMode(rawMask = {}) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const rawText = String(mask?.raw || '').trim();
  const normalizedText = rawText.toLowerCase();
  const tokenCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const subjectProfileType = getImageSubjectProfileType(mask);
  const accessoryFamilies = getImageAccessoryFamilies(mask);
  const hasPair = Boolean(compileCharacterCountConstraints(rawText));
  const hasInitImage = Boolean(
    String(mask?.meta?.webImageDraft?.initImageUrl || mask?.meta?.webImageDraft?.initImagePath || '').trim()
    || String(mask?.meta?.reference_image_url || mask?.meta?.init_image_url || '').trim()
  );
  const hasWorkflowSignal = /\b(web|internet|cherche|recherche|reference|référence|variation|variante|version|corrige|corriger|ameliore|améliore|retravaille|retouche|upscale|memoire|mémoire|workflow|plusieurs etapes|plusieurs étapes|edition|édition|edit)\b/i.test(rawText);
  const hasRichPromptState = Boolean(
    mask?.meta?.llmEnriched === true
    || (mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object')
    || (mask?.meta?.imageEntityContext && typeof mask.meta.imageEntityContext === 'object')
    || (Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 3)
    || countImageSemanticFamilies(mask) >= 3
  );
  const hasSceneAttachment = /\b(avec|dans|sur|sous|tenant|portant|en train de|devant|derriere|derrière)\b/i.test(rawText);
  const hasHumanFigureAccessory = (
    ['reference_character', 'single_human_figure'].includes(subjectProfileType)
    && ['wearable', 'weapon', 'smoking_prop'].some((family) => accessoryFamilies.has(family))
  );
  const hasNamedCharacterVariation = (
    subjectProfileType === 'reference_character'
    && (hasSceneAttachment || accessoryFamilies.size > 0 || tokenCount >= 5)
  );

  if (hasInitImage || hasWorkflowSignal || hasPair) {
    return {
      mode: 'smart',
      reason: hasInitImage ? 'init_image_requested' : (hasPair ? 'multiple_subjects_requested' : 'workflow_signal'),
      explicit: false,
    };
  }

  if (hasNamedCharacterVariation || hasHumanFigureAccessory) {
    return {
      mode: 'smart',
      reason: hasNamedCharacterVariation ? 'reference_character_variation' : 'human_figure_accessory_variation',
      explicit: false,
    };
  }

  if (isModelSensitiveImageProfile(subjectProfileType)) {
    return {
      mode: 'smart',
      reason: 'model_sensitive_profile',
      explicit: false,
    };
  }

  if (hasRichPromptState) {
    return {
      mode: 'smart',
      reason: 'rich_prompt_state',
      explicit: false,
    };
  }

  if (tokenCount <= 16 && !hasSceneAttachment) {
    return {
      mode: 'raw',
      reason: 'simple_single_subject_prompt',
      explicit: false,
    };
  }

  return {
    mode: 'raw',
    reason: 'default_raw',
    explicit: false,
  };
}

function resolveImageRequestMode({ rawMask = {}, req = null, explicitMode = '' } = {}) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const reqMode = normalizeImageRequestModeValue(
    explicitMode
    || req?.body?.mode
    || req?.body?.image_mode
    || ''
  );
  const maskMode = normalizeImageRequestModeValue(
    mask?.meta?.imageRequestMode
    || mask?.meta?.imagePipelineMode
    || ''
  );
  const envMode = normalizeImageRequestModeValue(process.env.A11_IMAGE_PIPELINE_MODE || '');
  const selected = reqMode || maskMode || envMode;
  if (selected === 'raw' || selected === 'smart') {
    return {
      mode: selected,
      reason: `${selected}_explicit`,
      explicit: true,
    };
  }

  return inferAutoImageRequestMode(mask);
}

function buildSdRequestBody(mask, compiledPayload) {
  const payload = compiledPayload && typeof compiledPayload === 'object'
    ? compiledPayload
    : {};
  const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
    ? mask.meta.webImageDraft
    : {};
  const initImage = String(
    payload.init_image
    || payload.initImage
    || payload.init_image_url
    || payload.initImageUrl
    || webImageDraft.initImagePath
    || webImageDraft.initImageUrl
    || ''
  ).trim();
  const strength = payload.strength !== undefined
    ? Number(payload.strength)
    : Number(webImageDraft.strength);

  const IMAGE_MAX_SIZE = Number(process.env.A11_IMAGE_MAX_SIZE || 2048);
  const IMAGE_MIN_SIZE = 64;
  function clampDimension(val, fallback) {
    let n = Number(val);
    if (!Number.isFinite(n)) n = fallback;
    n = Math.round(n);
    if (n > 1 && n % 2 !== 0) n = n - 1;
    return Math.max(IMAGE_MIN_SIZE, Math.min(IMAGE_MAX_SIZE, n));
  }
  const requestedWidth = Number(payload.width || mask?.options?.width);
  const requestedHeight = Number(payload.height || mask?.options?.height);
  const width = clampDimension(requestedWidth, IMAGE_MAX_SIZE);
  const height = clampDimension(requestedHeight, IMAGE_MAX_SIZE);
  const renderSizing = mask?.meta?.renderSizing && typeof mask.meta.renderSizing === 'object'
    ? mask.meta.renderSizing
    : null;
  if (requestedWidth !== undefined && width !== requestedWidth) {
    console.warn(`[A11][image-chat-runtime] width requested=${requestedWidth} effective=${width} (clamp)`);
  }
  if (requestedHeight !== undefined && height !== requestedHeight) {
    console.warn(`[A11][image-chat-runtime] height requested=${requestedHeight} effective=${height} (clamp)`);
  }
  return {
    prompt: String(payload.prompt || mask?.raw || '').trim(),
    prompt_prebuilt: true,
    ...(payload.prompt_language ? { prompt_language: String(payload.prompt_language).trim() } : {}),
    ...(String(payload.negative_prompt || '').trim()
      ? {
          negative_prompt: String(payload.negative_prompt).trim(),
          negative_prompt_prebuilt: true,
        }
      : {}),
    width,
    height,
    num_inference_steps: Number(payload.steps || mask?.options?.steps || 30),
    guidance_scale: Number(payload.guidance_scale || mask?.options?.guidance_scale || 7.5),
    ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
    ...(payload.sampler ? { sampler: payload.sampler } : {}),
    ...(initImage ? { init_image_url: initImage } : {}),
    ...(Number.isFinite(strength) ? { strength } : {}),
    ...(renderSizing ? {
      size_source: renderSizing.source,
      size_reason: renderSizing.reason,
      requested_width: renderSizing.requestedWidth,
      requested_height: renderSizing.requestedHeight,
    } : {}),
  };
}

const IMAGE_PROMPT_REFINER_SYSTEM_PROMPT = `Tu es un réécrivain final de prompt Stable Diffusion pour A11.
Tu reçois une demande image riche avec beaucoup de contexte interne.
Ta mission est de produire un prompt FINAL court, propre et cohérent pour le générateur d'image.

Règles strictes :
- conserver exactement le sujet principal, le nombre de sujets, la relation entre eux, les couleurs importantes, le style demandé et les contraintes essentielles
- ne jamais ajouter un nouveau personnage, un nouvel objet principal, une nouvelle action ou un nouveau décor important
- supprimer biographies, contexte encyclopédique, redondances, répétitions, formulations bavardes et méta-instructions
- produire un prompt positif court, fluide, orienté rendu image
- produire aussi un negative prompt court et utile
- français uniquement

Réponds uniquement en JSON strict :
{
  "prompt": "prompt final concis",
  "negative_prompt": "negative prompt concis"
}`;

function resolveImagePromptRefinerEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = String(process.env.A11_IMAGE_PROMPT_REFINER || '').trim().toLowerCase();
  if (!envValue) return true;
  if (['0', 'false', 'no', 'off'].includes(envValue)) return false;
  if (['1', 'true', 'yes', 'on'].includes(envValue)) return true;
  return true;
}

function shouldRefineCompiledImagePrompt(compiledState = {}, options = {}) {
  if (!resolveImagePromptRefinerEnabled(options.imagePromptRefinerEnabled)) return false;
  if (typeof options.callStructuredLlmJson !== 'function') return false;
  if (String(compiledState?.imageRequestMode?.mode || '').trim().toLowerCase() === 'raw') return false;

  const prompt = String(compiledState?.sdBody?.prompt || '').trim();
  if (!prompt) return false;

  return (
    prompt.length >= 160
    || compiledState?.specialCompiler?.selection?.candidate === true
    || (Array.isArray(compiledState?.mask?.meta?.promptInstructions) && compiledState.mask.meta.promptInstructions.length > 2)
    || Boolean(compiledState?.mask?.meta?.imageScratchpad)
    || Boolean(compiledState?.mask?.meta?.definitionLookup)
    || Boolean(compiledState?.mask?.meta?.webReferencePack)
  );
}

function buildImagePromptRefinerInput(compiledState = {}) {
  const mask = compiledState?.mask || {};
  return JSON.stringify({
    raw_request: String(mask?.raw || '').trim(),
    current_prompt: String(compiledState?.sdBody?.prompt || '').trim(),
    current_negative_prompt: String(compiledState?.sdBody?.negative_prompt || '').trim(),
    subject: Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : [],
    environment: Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : [],
    style: Array.isArray(mask?.inputs?.style) ? mask.inputs.style : [],
    composition: Array.isArray(mask?.inputs?.composition) ? mask.inputs.composition : [],
    lighting: Array.isArray(mask?.inputs?.lighting) ? mask.inputs.lighting : [],
    palette: Array.isArray(mask?.inputs?.palette) ? mask.inputs.palette : [],
    prompt_instructions: Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions.slice(0, 6) : [],
    subject_profile_type: String(mask?.meta?.subjectProfile?.type || '').trim(),
    canonical_subject: String(mask?.meta?.canonicalSubject || mask?.meta?.imageScratchpad?.canonicalSubject || '').trim(),
    universe: String(mask?.meta?.imageScratchpad?.universe || '').trim(),
    reference_init_image: String(
      mask?.meta?.webImageDraft?.initImageUrl
      || mask?.meta?.webImageDraft?.initImagePath
      || mask?.meta?.reference_image_url
      || mask?.meta?.init_image_url
      || ''
    ).trim(),
    web_reference_pack: mask?.meta?.webReferencePack && typeof mask.meta.webReferencePack === 'object'
      ? {
          subject: String(mask.meta.webReferencePack.subject || '').trim(),
          universe: String(mask.meta.webReferencePack.universe || '').trim(),
          summary_facts: Array.isArray(mask.meta.webReferencePack.summaryFacts)
            ? mask.meta.webReferencePack.summaryFacts.slice(0, 6)
            : [],
          references: Array.isArray(mask.meta.webReferencePack.references)
            ? mask.meta.webReferencePack.references.slice(0, 6).map((entry) => ({
                role: String(entry?.role || '').trim(),
                label: String(entry?.label || '').trim(),
                family: String(entry?.family || '').trim(),
                placement: String(entry?.placement || '').trim(),
                query: String(entry?.query || '').trim(),
                title: String(entry?.title || '').trim(),
                source_domain: String(entry?.sourceDomain || '').trim(),
              }))
            : [],
        }
      : null,
  }, null, 2);
}

async function refineCompiledImagePromptWithLlm(compiledState = {}, options = {}) {
  if (!shouldRefineCompiledImagePrompt(compiledState, options)) {
    return {
      compiledState,
      promptRefiner: {
        applied: false,
        reason: 'disabled_or_not_needed',
      },
    };
  }

  try {
    const response = await options.callStructuredLlmJson({
      text: buildImagePromptRefinerInput(compiledState),
      systemPrompt: IMAGE_PROMPT_REFINER_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 320,
      timeoutMs: Number(process.env.A11_IMAGE_PROMPT_REFINER_TIMEOUT_MS || 6000),
    });

    const nextPrompt = normalizeText(response?.prompt || '');
    const nextNegativePrompt = normalizeText(response?.negative_prompt || '');

    if (!nextPrompt) {
      return {
        compiledState,
        promptRefiner: {
          applied: false,
          reason: 'empty_response',
        },
      };
    }

    const nextCompiledState = {
      ...compiledState,
      compiledPayload: {
        ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object' ? compiledState.compiledPayload : {}),
        prompt: nextPrompt,
        ...(nextNegativePrompt
          ? { negative_prompt: nextNegativePrompt }
          : {}),
      },
      compiled: (
        compiledState?.compiled && typeof compiledState.compiled === 'object'
          ? {
              ...compiledState.compiled,
              prompt: nextPrompt,
              ...(nextNegativePrompt
                ? { negative_prompt: nextNegativePrompt }
                : {}),
            }
          : compiledState.compiled
      ),
      sdBody: {
        ...(compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {}),
        prompt: nextPrompt,
        ...(nextNegativePrompt
          ? { negative_prompt: nextNegativePrompt }
          : {}),
      },
    };

    return {
      compiledState: nextCompiledState,
      promptRefiner: {
        applied: true,
        reason: 'llm_refined',
        originalPrompt: String(compiledState?.sdBody?.prompt || '').trim(),
        refinedPrompt: nextPrompt,
        refinedNegativePrompt: nextNegativePrompt || String(compiledState?.sdBody?.negative_prompt || '').trim(),
      },
    };
  } catch (error_) {
    return {
      compiledState,
      promptRefiner: {
        applied: false,
        reason: 'llm_refine_failed',
        message: String(error_?.message || error_),
      },
    };
  }
}

function compileMaskImageGenerate(rawMask) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const validation = validateMaskImageGenerate(mask);
  if (!validation.valid) {
    const error = new Error('invalid_mask');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'invalid_mask',
      details: validation.errors,
      mask,
    };
    throw error;
  }

  const compilerTarget = String(mask?.compiler?.target || 'image-prompt-fr').trim() || 'image-prompt-fr';
  const compiledPayload = compilerTarget === 'sd-payload'
    ? compileMaskToSD(mask)
    : compileMaskToImagePrompt(mask);
  const compiled = adaptMaskToFreelandValue(mask, compiledPayload);
  // Aligner width/height sur la politique globale
  const IMAGE_MAX_SIZE = Number(process.env.A11_IMAGE_MAX_SIZE || 2048);
  const IMAGE_MIN_SIZE = 64;
  function clampDimension(val, fallback) {
    let n = Number(val);
    if (!Number.isFinite(n)) n = fallback;
    n = Math.round(n);
    if (n > 1 && n % 2 !== 0) n = n - 1;
    return Math.max(IMAGE_MIN_SIZE, Math.min(IMAGE_MAX_SIZE, n));
  }
  const requestedWidth = Number(compiledPayload?.width || mask?.options?.width);
  const requestedHeight = Number(compiledPayload?.height || mask?.options?.height);
  const width = clampDimension(requestedWidth, IMAGE_MAX_SIZE);
  const height = clampDimension(requestedHeight, IMAGE_MAX_SIZE);
  const renderSizing = mask?.meta?.renderSizing && typeof mask.meta.renderSizing === 'object'
    ? mask.meta.renderSizing
    : null;
  if (requestedWidth !== undefined && width !== requestedWidth) {
    console.warn(`[A11][image-chat-runtime] width requested=${requestedWidth} effective=${width} (clamp)`);
  }
  if (requestedHeight !== undefined && height !== requestedHeight) {
    console.warn(`[A11][image-chat-runtime] height requested=${requestedHeight} effective=${height} (clamp)`);
  }
  if (renderSizing) {
    console.log(
      `[A11][image-size] source=${renderSizing.source || 'unknown'}`
      + ` reason=${renderSizing.reason || 'n/a'}`
      + ` requested=${renderSizing.requestedWidth || 'auto'}x${renderSizing.requestedHeight || 'auto'}`
      + ` resolved=${width}x${height}`
    );
  }
  const sdBody = compilerTarget === 'sd-payload'
    ? buildSdRequestBody(mask, compiledPayload)
    : {
        ...compiledPayload,
        width,
        height,
        ...(renderSizing ? {
          size_source: renderSizing.source,
          size_reason: renderSizing.reason,
          requested_width: renderSizing.requestedWidth,
          requested_height: renderSizing.requestedHeight,
        } : {}),
        num_inference_steps: Number(compiledPayload?.num_inference_steps || mask?.options?.steps || 30),
        guidance_scale: Number(compiledPayload?.guidance_scale || mask?.options?.guidance_scale || 7.5),
        ...(compiledPayload?.seed !== undefined ? { seed: compiledPayload.seed } : {}),
        ...(() => {
          const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
            ? mask.meta.webImageDraft
            : {};
          const initImage = String(
            compiledPayload?.init_image
            || compiledPayload?.initImage
            || compiledPayload?.init_image_url
            || compiledPayload?.initImageUrl
            || webImageDraft.initImagePath
            || webImageDraft.initImageUrl
            || ''
          ).trim();
          const strength = compiledPayload?.strength !== undefined
            ? Number(compiledPayload.strength)
            : Number(webImageDraft.strength);
          return {
            ...(initImage ? { init_image_url: initImage } : {}),
            ...(Number.isFinite(strength) ? { strength } : {}),
          };
        })(),
      };

  return {
    mask,
    compiledPayload,
    compiled,
    sdBody,
  };
}

async function compileMaskImageGenerateRuntime(rawMask, options = {}) {
  const imageRequestMode = resolveImageRequestMode({
    rawMask,
    req: options.req,
    explicitMode: options.imageRequestMode,
  });
  if (imageRequestMode.mode === 'raw') {
    const rawModeMask = normalizeMaskImageGenerate(rawMask);
    rawModeMask.meta = rawModeMask.meta && typeof rawModeMask.meta === 'object' ? rawModeMask.meta : {};
    rawModeMask.meta.imageRequestMode = 'raw';
    rawModeMask.meta.imagePipelineMode = 'raw';
    rawModeMask.meta.compilerCompartment = 'standard';
    rawModeMask.meta.specialCompilerReason = imageRequestMode.reason;

    const compiledState = compileMaskImageGenerate(rawModeMask);
    compiledState.imageRequestMode = imageRequestMode;
    compiledState.imageRequestDirector = null;
    compiledState.specialCompiler = {
      selection: {
        compartment: 'standard',
        candidate: false,
        reasons: [imageRequestMode.reason],
        llmAvailable: false,
        shouldBypassCache: false,
        aggressive: false,
        pipelineMode: 'raw',
      },
      appliedHints: null,
      fallbackReason: 'raw_mode',
      preferredHintMemory: null,
    };
    return compiledState;
  }

  const baseSelection = resolveImageCompilerCompartment(rawMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    pipelineMode: 'smart',
  });
  const orchestratorEnabled = isImageOrchestratorEnabled(baseSelection.pipelineMode);
  let preferredHintMemory = null;
  if (orchestratorEnabled) {
    try {
      preferredHintMemory = typeof options.readPreferredImageHintMemory === 'function'
        ? await options.readPreferredImageHintMemory(rawMask)
        : await readPreferredImageHintMemory(rawMask);
    } catch (error_) {
      preferredHintMemory = {
        available: false,
        skipped: true,
        reason: 'hint_memory_read_failed',
        message: String(error_?.message || error_),
        hints: {
          composition_hints: [],
          environment_hints: [],
          style_hints: [],
          prompt_instructions: [],
        },
      };
    }
  }
  const selection = orchestratorEnabled
    ? resolveImageCompilerCompartment(rawMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
      pipelineMode: 'smart',
    })
    : baseSelection;
  let runtimeMask = rawMask;
  if (typeof options.resolveImageEntityContext === 'function') {
    try {
      const imageEntityContext = await options.resolveImageEntityContext({
        mask: runtimeMask,
        selection,
      });
      if (imageEntityContext && typeof imageEntityContext === 'object') {
        runtimeMask = enrichImageMaskWithScratchpad(runtimeMask, { entityContext: imageEntityContext });
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageEntityContextError: String(error_?.message || error_),
        },
      };
    }
  }
  let webHintContext = null;
  if (orchestratorEnabled && typeof options.lookupImageHintWebContext === 'function') {
    try {
      webHintContext = await options.lookupImageHintWebContext({
        mask: runtimeMask,
        selection,
      });
      if (webHintContext && typeof webHintContext === 'object') {
        runtimeMask = {
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webHintContext,
          },
        };
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webHintContextError: String(error_?.message || error_),
        },
      };
    }
  }
  if (orchestratorEnabled && typeof options.resolveImageReferencePack === 'function') {
    try {
      const webReferencePack = await options.resolveImageReferencePack({
        mask: runtimeMask,
        selection,
        duckduckgoImageSearch: options.duckduckgoImageSearch,
      });
      if (webReferencePack && typeof webReferencePack === 'object') {
        runtimeMask = {
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webReferencePack,
          },
        };
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webReferencePackError: String(error_?.message || error_),
        },
      };
    }
  }
  if (orchestratorEnabled && typeof options.resolveImageWebDraft === 'function') {
    try {
      const webImageDraft = await options.resolveImageWebDraft({
        mask: runtimeMask,
        selection,
        webHintContext,
      });
      if (webImageDraft && typeof webImageDraft === 'object') {
        runtimeMask = applyWebDraftCanvasToMask({
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webImageDraft,
          },
        }, webImageDraft);
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webImageDraftError: String(error_?.message || error_),
        },
      };
    }
  }
  const existingInitImage = String(
    runtimeMask?.meta?.webImageDraft?.initImageUrl
    || runtimeMask?.meta?.webImageDraft?.initImagePath
    || ''
  ).trim();
  if (
    orchestratorEnabled
    && !existingInitImage
    && typeof options.buildImageReferenceComposite === 'function'
  ) {
    try {
      const referenceCompositeDraft = await options.buildImageReferenceComposite({
        mask: runtimeMask,
        referencePack: runtimeMask?.meta?.webReferencePack || null,
      });
      if (referenceCompositeDraft && typeof referenceCompositeDraft === 'object') {
        runtimeMask = applyWebDraftCanvasToMask({
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webImageDraft: referenceCompositeDraft,
          },
        }, referenceCompositeDraft);
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageReferenceCompositeError: String(error_?.message || error_),
        },
      };
    }
  }
  let director = null;
  if (orchestratorEnabled && typeof options.directImageRequest === 'function') {
    try {
      const directed = await options.directImageRequest({
        mask: runtimeMask,
        selection,
        callStructuredLlm: options.callStructuredLlmJson,
        lookupDefinitionContext: options.lookupDefinitionContext,
        duckduckgoImageSearch: options.duckduckgoImageSearch,
      });
      if (directed && typeof directed === 'object') {
        director = directed.director || null;
        if (directed.mask && typeof directed.mask === 'object') {
          runtimeMask = directed.mask;
        }
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageRequestDirectorError: String(error_?.message || error_),
        },
      };
    }
  }
  const enriched = await enrichMaskForSpecialImageCompiler(runtimeMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    preferredHints: preferredHintMemory?.hints || {},
    pipelineMode: 'smart',
  });
  const enrichedMask = enriched?.mask || runtimeMask;
  const compiledState = compileMaskImageGenerate(enrichedMask);
  compiledState.imageRequestMode = imageRequestMode;
  compiledState.imageRequestDirector = director;
  compiledState.specialCompiler = {
    selection: enriched?.selection || resolveImageCompilerCompartment(runtimeMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
      pipelineMode: 'smart',
    }),
    appliedHints: enriched?.appliedHints || null,
    fallbackReason: String(enriched?.fallbackReason || '').trim(),
    preferredHintMemory: preferredHintMemory || null,
  };
  const promptRefined = await refineCompiledImagePromptWithLlm(compiledState, options);
  promptRefined.compiledState.promptRefiner = promptRefined.promptRefiner;
  return promptRefined.compiledState;
}

function slugifyImageVerificationLabel(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image';
}

function buildImageVerificationRequestId(compiledState = {}, expectedImageContract = null) {
  const contractLabel = String(expectedImageContract?.subjectLabel || '').trim();
  const subject = String(
    contractLabel
    || compiledState?.mask?.inputs?.subject?.[0]
    || compiledState?.mask?.raw
    || 'image'
  ).trim();
  const slug = slugifyImageVerificationLabel(subject);
  return `img-${slug}-${Date.now()}`;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isFalsyEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function isLocalImageRuntime(env = process.env) {
  return isTruthyEnv(env?.A11_LOCAL_MODE)
    || String(env?.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local';
}

function isImageVerificationEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_CARDINALITY_GUARD
    || process.env.A11_IMAGE_VERIFY_CARDINALITY
    || '';
  if (!String(envValue).trim()) return true;
  if (isFalsyEnv(envValue)) return false;
  return isTruthyEnv(envValue);
}

function resolveMaxVerificationRetries(explicitValue) {
  if (explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
    const numeric = Number(explicitValue);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  }
  const fallbackRetries = isLocalImageRuntime(process.env) ? 0 : 1;
  const fromEnv = Number(
    process.env.A11_IMAGE_CARDINALITY_MAX_RETRIES
    || process.env.A11_IMAGE_VERIFY_MAX_RETRIES
    || fallbackRetries
  );
  return Number.isFinite(fromEnv) ? Math.max(0, Math.floor(fromEnv)) : 0;
}

function buildCompiledPromptHash(sdBody = {}) {
  return crypto
    .createHash('sha1')
    .update(String(sdBody?.prompt || '').trim())
    .digest('hex')
    .slice(0, 16);
}

function deriveOperationalSeed({ mask = {}, sdBody = {} } = {}) {
  const existingSeed = Number(sdBody?.seed);
  if (Number.isFinite(existingSeed)) {
    return Math.max(1, Math.floor(existingSeed));
  }

  const payload = [
    String(sdBody?.prompt || '').trim(),
    String(mask?.raw || '').trim(),
    String(mask?.inputs?.subject?.join('|') || '').trim(),
    String(mask?.meta?.canonicalSubject || mask?.meta?.imageScratchpad?.canonicalSubject || '').trim(),
    String(mask?.meta?.subjectProfile?.type || '').trim(),
  ].join('\n');

  const digest = crypto.createHash('sha1').update(payload).digest();
  const derived = digest.readUInt32BE(0) & 0x7fffffff;
  return Math.max(1, derived || 1);
}

function ensureOperationalSdBody(sdBody = {}, mask = {}) {
  return {
    ...sdBody,
    seed: deriveOperationalSeed({ mask, sdBody }),
  };
}

async function inspectGeneratedImage(sdResult) {
  const imageUrl = resolveGeneratedImageUrl(sdResult);
  if (!imageUrl) {
    return { ok: true, skipped: true, reason: 'missing_image_url' };
  }

  const sharp = getSharp();
  if (!sharp || typeof globalThis.fetch !== 'function') {
    return { ok: true, skipped: true, reason: 'image_probe_unavailable' };
  }

  try {
    const response = await globalThis.fetch(imageUrl);
    if (!response.ok) {
      return {
        ok: true,
        skipped: true,
        reason: 'image_probe_unavailable',
        message: `image_probe_http_${response.status}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const probe = sharp(buffer, { failOn: 'none' });
    const [metadata, stats] = await Promise.all([
      probe.metadata(),
      probe.stats(),
    ]);
    const rgbChannels = Array.isArray(stats?.channels) ? stats.channels.slice(0, 3) : [];
    const solidBlack = rgbChannels.length >= 3 && rgbChannels.every((channel) => (
      Number(channel?.max || 0) <= 2 && Number(channel?.mean || 0) <= 2
    ));

    if (solidBlack) {
      return {
        ok: false,
        reason: 'solid_black_image_detected',
        imageUrl,
        metadata: {
          width: Number(metadata?.width || 0),
          height: Number(metadata?.height || 0),
          channels: Number(metadata?.channels || 0),
          sizeBytes: buffer.length,
        },
      };
    }

    return {
      ok: true,
      imageUrl,
      metadata: {
        width: Number(metadata?.width || 0),
        height: Number(metadata?.height || 0),
        channels: Number(metadata?.channels || 0),
        sizeBytes: buffer.length,
      },
    };
  } catch (error_) {
    return {
      ok: true,
      skipped: true,
      reason: 'image_probe_failed',
      message: String(error_?.message || error_),
    };
  }
}

async function generateImageFromMask({
  req,
  rawMask,
  generateImage,
  generateSd,
  specialCompilerCallStructuredLlmJson,
  verifyImageCardinality = verifyGeneratedImageCardinality,
  verifyImageWithLlmJudge = verifyGeneratedImageWithLlmJudge,
  inspectGeneratedImageResult = inspectGeneratedImage,
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
  callStructuredVisionJudgeJson,
  resolveImageEntityContext = defaultResolveImageEntityContext,
  directImageRequest = defaultDirectImageRequest,
  lookupDefinitionContext = defaultLookupDefinitionContext,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
  lookupImageHintWebContext = defaultLookupImageHintWebContext,
  resolveImageReferencePack = defaultResolveImageReferencePack,
  buildImageReferenceComposite = defaultBuildImageReferenceComposite,
  resolveImageWebDraft = defaultResolveImageWebDraft,
  imageVerificationEnabled,
  maxVerificationRetries,
}) {
  const compiledState = await compileMaskImageGenerateRuntime(rawMask, {
    req,
    callStructuredLlmJson: specialCompilerCallStructuredLlmJson,
    readPreferredImageHintMemory,
    resolveImageEntityContext,
    directImageRequest,
    lookupDefinitionContext,
    duckduckgoImageSearch,
    lookupImageHintWebContext,
    resolveImageReferencePack,
    buildImageReferenceComposite,
    resolveImageWebDraft,
  });
  const imageGenerator = typeof generateImage === 'function'
    ? generateImage
    : generateSd;

  if (typeof imageGenerator !== 'function') {
    const error = new Error('generateImage handler unavailable');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'image_engine_unavailable',
      message: 'generateImage handler unavailable',
    };
    throw error;
  }

  const expectedImageContract = inferExpectedImageContract({
    mask: compiledState.mask,
    compiledState,
  });
  const requestId = buildImageVerificationRequestId(compiledState, expectedImageContract);
  const imageRequestMode = compiledState.imageRequestMode?.mode || 'smart';
  const guardEnabled = isImageVerificationEnabled(imageVerificationEnabled);
  const resolvedMaxVerificationRetries = resolveMaxVerificationRetries(maxVerificationRetries);
  const attempts = [];

  let activeSdBody = ensureOperationalSdBody(compiledState.sdBody, compiledState.mask);
  let compiledPromptHash = buildCompiledPromptHash(activeSdBody);
  const expectedSubjectCount = Number(expectedImageContract?.subjectCount || 0) || 0;
  const expectedMode = String(expectedImageContract?.mode || expectedImageContract?.reason || 'none').trim() || 'none';
  const expectedLabel = String(expectedImageContract?.subjectLabel || '').trim() || '-';
  console.log(
    `[A11][image-guard] start requestId=${requestId} enabled=${guardEnabled} promptHash=${compiledPromptHash} seed=${activeSdBody.seed ?? 'none'} expected=${expectedSubjectCount || 'none'} mode=${expectedMode} label=${expectedLabel}`
  );
  let sdResult = await imageGenerator({
    req,
    prompt: activeSdBody.prompt,
    body: activeSdBody,
  });
  attempts.push({
    attempt: 1,
    prompt_hash: compiledPromptHash,
    prompt: String(activeSdBody.prompt || '').trim(),
    seed: activeSdBody.seed,
    image_url: resolveGeneratedImageUrl(sdResult),
  });

  let verification = null;
  const retryHistory = [];
  if (imageRequestMode === 'raw') {
    if (typeof verifyImageCardinality === 'function' && expectedImageContract?.enabled) {
      try {
        verification = await verifyImageCardinality({
          imageUrl: resolveGeneratedImageUrl(sdResult),
          expected: expectedImageContract,
          requestId,
          prompt: String(activeSdBody.prompt || '').trim(),
          seed: activeSdBody.seed,
        });
      } catch (error_) {
        verification = {
          ok: false,
          skipped: true,
          reason: 'raw_non_blocking_verify_failed',
          message: String(error_?.message || error_),
        };
      }
      console.log(
        `[A11][image-guard] raw requestId=${requestId} promptHash=${compiledPromptHash} reason=${verification?.decision?.reason || verification?.reason || 'skipped'}`
      );
    } else {
      verification = {
        ok: false,
        skipped: true,
        reason: 'raw_mode_no_blocking_check',
      };
    }
  } else if (guardEnabled && typeof verifyImageCardinality === 'function' && expectedImageContract?.enabled) {
    try {
      verification = await verifyImageCardinality({
        imageUrl: resolveGeneratedImageUrl(sdResult),
        expected: expectedImageContract,
        requestId,
        prompt: String(activeSdBody.prompt || '').trim(),
        seed: activeSdBody.seed,
      });
      verification = relaxVerificationForWebInit(compiledState.mask, verification);
    } catch (error_) {
      verification = {
        ok: false,
        skipped: true,
        reason: 'vision_verify_failed',
        message: String(error_?.message || error_),
      };
    }
    console.log(
      `[A11][image-guard] verify requestId=${requestId} promptHash=${compiledPromptHash} status=${verification?.ok ? 'ok' : 'skip'} reason=${verification?.decision?.reason || verification?.reason || 'unknown'}`
    );

    let retryCount = 0;
    while (
      retryCount < resolvedMaxVerificationRetries
      && verification?.ok
      && verification?.decision?.retry === true
    ) {
      retryCount += 1;
      console.log(
        `[A11][image-guard] retry=${retryCount} requestId=${requestId} reason=${verification.decision.reason} observed=${verification.observed?.subject_count} expected=${verification.expected?.subject_count}`
      );
      retryHistory.push({
        retry: retryCount,
        reason: String(verification?.decision?.reason || '').trim() || 'verification_retry',
        observed_subject_count: Number(verification?.observed?.subject_count || 0),
        confidence: Number(verification?.observed?.confidence || 0),
      });

      activeSdBody = buildRetrySdBody(activeSdBody, verification, {
        seed: Date.now(),
      });
      compiledPromptHash = buildCompiledPromptHash(activeSdBody);
      sdResult = await imageGenerator({
        req,
        prompt: activeSdBody.prompt,
        body: activeSdBody,
      });
      attempts.push({
        attempt: retryCount + 1,
        prompt_hash: compiledPromptHash,
        prompt: String(activeSdBody.prompt || '').trim(),
        seed: activeSdBody.seed,
        image_url: resolveGeneratedImageUrl(sdResult),
      });

      try {
        verification = await verifyImageCardinality({
          imageUrl: resolveGeneratedImageUrl(sdResult),
          expected: expectedImageContract,
          requestId,
          prompt: String(activeSdBody.prompt || '').trim(),
          seed: activeSdBody.seed,
        });
        verification = relaxVerificationForWebInit(compiledState.mask, verification);
      } catch (error_) {
        verification = {
          ok: false,
          skipped: true,
          reason: 'vision_verify_failed',
          message: String(error_?.message || error_),
        };
        break;
      }
      console.log(
        `[A11][image-guard] verify requestId=${requestId} promptHash=${compiledPromptHash} status=${verification?.ok ? 'ok' : 'skip'} reason=${verification?.decision?.reason || verification?.reason || 'unknown'}`
      );
    }
  }

  const imageInspection = typeof inspectGeneratedImageResult === 'function'
    ? await inspectGeneratedImageResult(sdResult)
    : { ok: true, skipped: true, reason: 'image_probe_disabled' };
  if (imageInspection?.ok === false && imageRequestMode !== 'raw') {
    const error = new Error('Generated image is invalid');
    error.statusCode = 502;
    error.payload = {
      ok: false,
      error: 'image_generation_invalid',
      message: "Le backend image a renvoye une image invalide.",
      details: imageInspection,
      result: sdResult,
    };
    throw error;
  }

  const imageUrl = resolveGeneratedImageUrl(sdResult);
  const shouldRunLlmJudge = Boolean(
    imageRequestMode !== 'raw'
    && imageUrl
    && typeof verifyImageWithLlmJudge === 'function'
    && (
      compiledState?.specialCompiler?.selection?.candidate === true
      || compiledState?.specialCompiler?.selection?.compartment === 'special'
      || retryHistory.length > 0
    )
  );
  const imageLlmJudge = shouldRunLlmJudge
    ? await verifyImageWithLlmJudge({
      imageUrl,
      mask: compiledState.mask,
      requestId,
      prompt: String(activeSdBody.prompt || '').trim(),
      seed: activeSdBody.seed,
      callStructuredVisionJson: callStructuredVisionJudgeJson,
    })
    : {
      ok: false,
      skipped: true,
      reason: imageRequestMode === 'raw' ? 'raw_mode_no_llm_judge' : 'vision_llm_not_needed',
    };

  let hintMemory = null;
  if (
    imageLlmJudge?.ok === true
    && imageLlmJudge?.decision?.accepted === true
    && typeof recordSuccessfulImageHintMemory === 'function'
  ) {
    try {
      hintMemory = await recordSuccessfulImageHintMemory({
        mask: compiledState.mask,
        workingHints: imageLlmJudge.workingHints,
        judgeResult: imageLlmJudge,
      });
    } catch (error_) {
      hintMemory = {
        ok: false,
        skipped: true,
        reason: 'hint_memory_record_failed',
        message: String(error_?.message || error_),
      };
    }
  }

  return {
    ...compiledState,
    sdBody: activeSdBody,
    sdResult,
    imageInspection,
    imageLlmJudge,
    hintMemory,
    imageGuard: {
      requestId,
      enabled: imageRequestMode === 'raw' ? false : guardEnabled,
      mode: imageRequestMode,
      compiledPromptHash: attempts[0]?.prompt_hash || compiledPromptHash,
      expected: expectedImageContract,
      verification,
      retries: retryHistory,
      attempts,
    },
  };
}

async function generateImageFromText({ req, text, generateSd, ...rest }) {
  const message = String(text || '').trim();
  if (!message) {
    const error = new Error('missing_message');
    error.statusCode = 400;
    error.payload = { ok: false, error: 'missing_message' };
    throw error;
  }

  const maskResolution = await buildCanonicalImageMaskFromText(message, {
    allowCompatFallback: true,
  });

  return generateImageFromMask({
    req,
    rawMask: maskResolution.rawMask,
    generateSd,
    ...rest,
  });
}

function resolveGeneratedImageUrl(sdResult) {
  return String(
    sdResult?.image_url
    || sdResult?.url
    || sdResult?.imagePath
    || sdResult?.public_url
    || sdResult?.file?.downloadUrl
    || sdResult?.file?.url
    || sdResult?.conversationResource?.downloadUrl
    || sdResult?.conversationResource?.url
    || sdResult?.result?.image_url
    || ''
  ).trim();
}

function inferImageFilename(imageUrl = '') {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  try {
    const pathname = new URL(raw).pathname || '';
    const candidate = path.basename(decodeURIComponent(pathname));
    return String(candidate || '').trim();
  } catch {
    const candidate = raw.split('?')[0].split('#')[0].split('/').pop();
    return String(candidate || '').trim();
  }
}

function ensureImageFilename(filename, imageUrl, contentType = '', artifactType = '') {
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  const normalizedArtifactType = String(artifactType || '').trim().toLowerCase();
  const candidate = String(filename || '').trim() || inferImageFilename(imageUrl);
  if (/\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(candidate)) {
    return candidate;
  }
  if (normalizedContentType === 'image/jpeg') return `${candidate || 'image'}.jpg`;
  if (normalizedContentType === 'image/webp') return `${candidate || 'image'}.webp`;
  if (normalizedContentType === 'image/gif') return `${candidate || 'image'}.gif`;
  if (normalizedContentType.startsWith('image/') || normalizedArtifactType.includes('image')) {
    return `${candidate || 'image'}.png`;
  }
  return candidate;
}

function buildImageAssistantMessage({ imageUrl, filename }) {
  if (imageUrl && filename) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  if (imageUrl) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  return "C'est fait. L'image a été générée.";
}

function toImageChatProxyPayload({
  sdResult,
  mask,
  compiled,
  sdBody,
  imageGuard,
  imageLlmJudge,
  hintMemory,
  imageRequestDirector,
}) {
  const imageUrl = resolveGeneratedImageUrl(sdResult);
  const filename = ensureImageFilename(
    sdResult?.filename || sdResult?.conversationResource?.filename || sdResult?.file?.filename,
    imageUrl,
    sdResult?.content_type || sdResult?.contentType || sdResult?.conversationResource?.contentType || sdResult?.file?.contentType,
    sdResult?.artifact_type
  );
  const content = buildImageAssistantMessage({ imageUrl, filename });

  return {
    ok: sdResult?.ok !== false,
    id: `a11-img-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'a11-mask-image',
    mode: 'generate_image',
    tool: sdResult?.tool || 'generate_image',
    engine: sdResult?.mode || null,
    artifact_type: sdResult?.artifact_type || 'image',
    image_url: imageUrl || null,
    imagePath: imageUrl || null,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    a11Agent: {
      imagePath: imageUrl || null,
      imageDraft: mask?.meta?.webImageDraft || null,
      webReferencePack: mask?.meta?.webReferencePack || null,
      imageRequestDirector: imageRequestDirector || mask?.meta?.imageRequestDirector || null,
      imageGuard: imageGuard || null,
      imageLlmJudge: imageLlmJudge || null,
      hintMemory: hintMemory || null,
      results: [
        {
          action: sdResult?.tool || 'generate_image',
          ok: sdResult?.ok !== false,
          result: sdResult,
        },
      ],
    },
    result: sdResult,
    mask,
    compiled,
    sdBody,
  };
}

module.exports = {
  extractLatestUserMessage,
  buildSdRequestBody,
  buildImageVerificationRequestId,
  compileMaskImageGenerate,
  compileMaskImageGenerateRuntime,
  resolveMaxVerificationRetries,
  resolveImageRequestMode,
  generateImageFromMask,
  generateImageFromText,
  resolveGeneratedImageUrl,
  inspectGeneratedImage,
  resolveImageCompilerCompartment,
  toImageChatProxyPayload,
};

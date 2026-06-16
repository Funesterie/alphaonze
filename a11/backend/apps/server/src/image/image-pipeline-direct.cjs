// image-pipeline-direct.cjs
// Pipeline image direct : 1 appel LLM → prompt SD → génération.
// Pas de canonicalizer, pas de wazaa, pas de mask intermédiaire.
// Le LLM reçoit le message brut avec accents et produit directement
// le prompt SD en anglais + les paramètres de génération.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');
const {
  resolveImageDimensionConfig,
} = require('../mask/normalize-mask-image-generate.cjs');
const {
  translateImagePromptToEnglish,
} = require('../mask/build-sd-prompt-bundle.cjs');

const IMAGE_PIPELINE_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'image_generation_request',
    strict: true,
    schema: {
      type: 'object',
      required: ['prompt', 'negative_prompt', 'subject', 'style', 'width', 'height'],
      properties: {
        prompt: { type: 'string' },
        negative_prompt: { type: 'string' },
        subject: { type: 'string' },
        style: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        has_reference_image: { type: 'boolean' },
        preserve_identity: { type: 'boolean' },
        transformation_description: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
});

const IMAGE_PIPELINE_SYSTEM_PROMPT = `You are a visual concept interpreter and image prompt engineer for A11.

You receive a user request (may be in French or any language). Your job is NOT to translate word-by-word. Your job is to understand the VISUAL INTENT and ATMOSPHERE, then describe what the final image should look and feel like.

Think like a film director: what does the scene actually look like? What is the lighting, the environment, the mood, the visual effects?

Examples of visual interpretation (do not copy these literally):
- "fantôme" → translucent ethereal body, ghostly glow, semi-transparent silhouette with spectral light
- "dojo" → traditional Japanese martial arts hall, polished wooden floor, wall mirrors, dim lighting, minimalist decor
- "far west" → desert landscape, dry earth, wooden saloon, warm sunset light, dust in the air
- "monde inspiré de Atlantis" → underwater ancient ruins, bioluminescent light, coral and stone architecture, deep blue atmosphere
- "en magenta" → change the color to deep magenta/fuchsia, NOT change anything else

Your output fields:
- prompt: the final image description in English. Visual, concrete, atmospheric. What would an artist paint? Include: subject appearance, action, environment details, lighting, mood, color palette. No meta-instructions.
- negative_prompt: rendering defects only (blurry, deformed, watermark). Empty string if nothing specific.
- subject: main subject, one short phrase.
- style: visual style, one short phrase.
- width/height: pixels. Default 1024x1024. Portrait (768x1024) for people, landscape (1024x768) for scenes.
- has_reference_image: true if user references "this person/photo/image", "cette personne/photo/image", "ce X", etc.
- preserve_identity: true if user wants the same face/person from the reference (almost always true when has_reference_image is true).
- transformation_description: when has_reference_image is true, write a concise English editing instruction describing ALL changes to apply. Structure:
  1. Background/environment change (describe the full visual scene)
  2. Object replacements ("replace the [current object] in subject's hand/on subject with [new object]")
  3. Visual effects or transformations on the subject itself (ghostly, color change, costume, etc.)
  Be specific and visual. Do not be literal — interpret the intent.

Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveImageDimensions(width, height, env = process.env) {
  const config = resolveImageDimensionConfig(env);
  const requestedWidth = Number(width) > 0 ? Number(width) : config.defaultWidth;
  const requestedHeight = Number(height) > 0 ? Number(height) : config.defaultHeight;
  const maxSide = Number(config.maxRenderSide || 0) || Math.max(requestedWidth, requestedHeight);
  const scale = Math.min(1, maxSide / Math.max(requestedWidth, requestedHeight, 1));
  const resolvedWidth = Math.max(64, Math.round((requestedWidth * scale) / 8) * 8);
  const resolvedHeight = Math.max(64, Math.round((requestedHeight * scale) / 8) * 8);
  return { width: resolvedWidth, height: resolvedHeight };
}

function resolveDirectImageDimensions(width, height, env = process.env) {
  const fallbackMaxSide = 512;
  const config = resolveImageDimensionConfig(env);
  const directMaxSide = Math.max(
    256,
    Math.min(
      Number(config.maxRenderSide || fallbackMaxSide) || fallbackMaxSide,
      Number(env.A11_IMAGE_DIRECT_MAX_RENDER_SIDE || fallbackMaxSide) || fallbackMaxSide
    )
  );
  const requestedWidth = Number(width) > 0 ? Number(width) : Math.min(config.defaultWidth || directMaxSide, directMaxSide);
  const requestedHeight = Number(height) > 0 ? Number(height) : Math.min(config.defaultHeight || directMaxSide, directMaxSide);
  const scale = Math.min(1, directMaxSide / Math.max(requestedWidth, requestedHeight, 1));
  return {
    width: Math.max(64, Math.round((requestedWidth * scale) / 8) * 8),
    height: Math.max(64, Math.round((requestedHeight * scale) / 8) * 8),
  };
}

function resolveDirectImageSteps(env = process.env) {
  const raw = Number(env.A11_IMAGE_DIRECT_STEPS || env.A11_SD_STEPS || 8);
  if (!Number.isFinite(raw) || raw <= 0) return 8;
  return Math.max(1, Math.min(50, Math.round(raw)));
}

function buildFallbackImageSdPayload({
  userMessage = '',
  hasReference = false,
  referenceImageUrl = '',
  referenceImagePath = '',
  imageContextCarryover = null,
  env = process.env,
  reason = 'structured_llm_unavailable',
} = {}) {
  const sourceText = normalizeText(userMessage);
  const carryoverSummary = normalizeText(imageContextCarryover?.summary || '');
  const translated = normalizeText(translateImagePromptToEnglish(sourceText) || sourceText);
  const prompt = normalizeText(
    hasReference
      ? `${translated}. ${carryoverSummary ? `Reference vision analysis: ${carryoverSummary}. ` : ''}Preserve the reference image identity and visual coherence.`
      : translated
  ) || sourceText;
  const { width, height } = resolveDirectImageDimensions(1024, 1024, env);
  console.warn(`[A11][image-direct] using prompt fallback reason=${String(reason || 'fallback')}`);
  return {
    prompt,
    negative_prompt: 'blurry, deformed, distorted, watermark, text artifacts',
    subject: sourceText,
    style: '',
    width,
    height,
    hasReferenceImage: hasReference,
    preserveIdentity: hasReference,
    transformationDescription: '',
    prompt_prebuilt: true,
    num_inference_steps: resolveDirectImageSteps(env),
    guidance_scale: 7.0,
    seed: undefined,
    init_image_url: referenceImageUrl || undefined,
    init_image_path: referenceImagePath || undefined,
    imageContextCarryover: imageContextCarryover || null,
    fallback: true,
    fallbackReason: String(reason || 'structured_llm_unavailable'),
  };
}

async function buildImageSdPayload({
  userMessage = '',
  referenceImageUrl = '',
  referenceImagePath = '',
  imageContextCarryover = null,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 25000,
  env = process.env,
} = {}) {
  if (!userMessage) {
    throw new Error('missing_user_message');
  }

  const hasReference = Boolean(referenceImageUrl || referenceImagePath);

  if (typeof callStructuredLlmJson !== 'function') {
    return buildFallbackImageSdPayload({
      userMessage,
      hasReference,
      referenceImageUrl,
      referenceImagePath,
      imageContextCarryover,
      env,
      reason: 'llm_unavailable',
    });
  }

  const input = JSON.stringify({
    user_request: userMessage,
    has_reference_image: hasReference,
    reference_image_url: referenceImageUrl || null,
    image_context_carryover: imageContextCarryover || null,
  });

  let response = null;
  try {
    response = await callStructuredLlmJson({
      text: input,
      systemPrompt: IMAGE_PIPELINE_SYSTEM_PROMPT,
      temperature: 0.2,
      maxTokens: 600,
      timeoutMs: Math.max(5000, Number(timeoutMs) || 25000),
      responseFormat: IMAGE_PIPELINE_RESPONSE_FORMAT,
      stage: 'image_pipeline_direct',
    });
  } catch (error) {
    return buildFallbackImageSdPayload({
      userMessage,
      hasReference,
      referenceImageUrl,
      referenceImagePath,
      imageContextCarryover,
      env,
      reason: error?.code || error?.message || 'structured_llm_error',
    });
  }

  if (!response || typeof response !== 'object') {
    return buildFallbackImageSdPayload({
      userMessage,
      hasReference,
      referenceImageUrl,
      referenceImagePath,
      imageContextCarryover,
      env,
      reason: 'structured_prompt_fallback',
    });
  }

  const prompt = normalizeText(response.prompt);
  if (!prompt) {
    return buildFallbackImageSdPayload({
      userMessage,
      hasReference,
      referenceImageUrl,
      referenceImagePath,
      imageContextCarryover,
      env,
      reason: 'llm_empty_prompt',
    });
  }

  const { width, height } = resolveDirectImageDimensions(response.width, response.height, env);

  console.log(
    `[A11][image-direct] subject="${normalizeText(response.subject || '')}"` +
    ` style="${normalizeText(response.style || '')}"` +
    ` size=${width}x${height}` +
    ` has_ref=${hasReference}` +
    ` preserve_identity=${response.preserve_identity === true}`
  );

  return {
    prompt,
    negative_prompt: normalizeText(response.negative_prompt || ''),
    subject: normalizeText(response.subject || ''),
    style: normalizeText(response.style || ''),
    width,
    height,
    hasReferenceImage: hasReference,
    preserveIdentity: response.preserve_identity === true,
    transformationDescription: normalizeText(response.transformation_description || ''),
    // Champs SD3 multi-prompt — le prompt principal va dans prompt_1
    // prompt_2 et prompt_3 sont construits par le translator vidéo/image
    prompt_prebuilt: true,
    num_inference_steps: resolveDirectImageSteps(env),
    guidance_scale: 7.0,
    seed: undefined,
    init_image_url: referenceImageUrl || undefined,
    init_image_path: referenceImagePath || undefined,
    imageContextCarryover: imageContextCarryover || null,
  };
}

async function executeDirectImagePipeline({
  userMessage = '',
  referenceImageUrl = '',
  referenceImagePath = '',
  imageContextCarryover = null,
  req = null,
  generateSd,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 25000,
  env = process.env,
} = {}) {
  if (typeof generateSd !== 'function') {
    const error = new Error('generateSd handler unavailable');
    error.statusCode = 500;
    error.payload = { ok: false, error: 'image_engine_unavailable' };
    throw error;
  }

  const sdPayload = await buildImageSdPayload({
    userMessage,
    referenceImageUrl,
    referenceImagePath,
    imageContextCarryover,
    callStructuredLlmJson,
    timeoutMs,
    env,
  });

  const sdBody = {
    prompt: sdPayload.prompt,
    negative_prompt: sdPayload.negative_prompt || undefined,
    width: sdPayload.width,
    height: sdPayload.height,
    num_inference_steps: sdPayload.num_inference_steps,
    guidance_scale: sdPayload.guidance_scale,
    prompt_prebuilt: true,
    // Contexte édition Kontext : message brut + description de transformation du LLM
    userMessage: userMessage || undefined,
    transformationDescription: sdPayload.transformationDescription || undefined,
    ...(sdPayload.init_image_url ? { init_image_url: sdPayload.init_image_url } : {}),
    ...(sdPayload.init_image_path ? { init_image_path: sdPayload.init_image_path } : {}),
    ...(sdPayload.imageContextCarryover ? { image_context_carryover: sdPayload.imageContextCarryover } : {}),
    ...(sdPayload.imageContextCarryover?.strengthProfile ? { strength_profile: sdPayload.imageContextCarryover.strengthProfile } : {}),
    ...(sdPayload.imageContextCarryover?.strengthReason ? { strength_reason: sdPayload.imageContextCarryover.strengthReason } : {}),
    ...(sdPayload.imageContextCarryover?.strengthComponents ? { strength_components: sdPayload.imageContextCarryover.strengthComponents } : {}),
  };

  const result = await generateSd({ req, body: sdBody, prompt: sdPayload.prompt });
  const imageUrl = result?.image_url || result?.url || null;
  const ok = result?.ok !== false && Boolean(imageUrl);

  return {
    ok,
    ...(ok ? {} : {
      error: result?.error || 'image_url_unavailable',
      message: result?.message || 'La generation image n a pas fourni de lien exploitable.',
    }),
    artifact_type: 'image',
    image_url: imageUrl,
    url: imageUrl,
    filename: result?.filename || null,
    prompt: sdPayload.prompt,
    subject: sdPayload.subject,
    style: sdPayload.style,
    width: sdPayload.width,
    height: sdPayload.height,
    pipeline: 'direct',
    sdResult: result,
  };
}

module.exports = {
  buildImageSdPayload,
  executeDirectImagePipeline,
  IMAGE_PIPELINE_SYSTEM_PROMPT,
  IMAGE_PIPELINE_RESPONSE_FORMAT,
};

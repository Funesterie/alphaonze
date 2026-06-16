// image-pipeline-direct.cjs
// Pipeline image direct : 1 appel LLM → prompt SD → génération.
// Pas de canonicalizer, pas de wazaa, pas de mask intermédiaire.
// Le LLM reçoit le message brut avec accents et produit directement
// le prompt SD en anglais + les paramètres de génération.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

// Direct Groq call — only when A11_IMAGE_DIRECT_GROQ_ENABLED=1 is explicitly set.
// Also activates when A11_TRANSLATION_BASE_URL already points to Groq (consistent with compose config).
function shouldUseGroqDirect(env = process.env) {
  const explicit = String(env.A11_IMAGE_DIRECT_GROQ_ENABLED || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(explicit)) return true;
  const translationBase = String(env.A11_TRANSLATION_BASE_URL || '').trim();
  return /groq\.com/i.test(translationBase);
}

function buildGroqCallStructuredLlmJson(env = process.env) {
  if (!shouldUseGroqDirect(env)) return null;
  const groqKey = String(env.GROQ_API_KEY || '').trim();
  if (!groqKey) return null;
  const groqModel = String(env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
  const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
  return async function callGroqStructuredJson({ text, systemPrompt, maxTokens = 600, temperature = 0.2, responseFormat, timeoutMs = 25000, stage = 'image_pipeline_groq' } = {}) {
    const body = {
      model: groqModel,
      temperature: Number(temperature) || 0.2,
      max_tokens: Number(maxTokens) || 600,
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(text || '') },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), Math.max(5000, Number(timeoutMs) || 25000));
    try {
      console.log(`[A11][image-direct] groq-direct stage=${stage} model=${groqModel}`);
      const res = await fetch(groqUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data?.error?.message || `groq_error_${res.status}`);
        err.statusCode = res.status;
        throw err;
      }
      const content = String(data?.choices?.[0]?.message?.content || '').trim();
      try { return JSON.parse(content); } catch { return null; }
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  };
}
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

## PROP RESEARCH RULE

When any specific prop, badge, weapon, tool, or accessory is mentioned, use your visual knowledge to describe what it actually looks like. Describe it concretely (material, shape, size, color, texture, engravings). Never describe a prop by its name alone — always describe its visible physical appearance.

Three critical rules for props on clothing:
- "étoile de shérif" is a physical 3D metal star BADGE — gold or silver, 5-to-6-pointed, ~2.5 inches, with "SHERIFF" engraved, pinned onto the chest fabric. It is a SEPARATE OBJECT on top of the clothing, NOT text printed on the fabric, NOT a design on the shirt. Never write anything on clothing to represent a badge.
- Any badge, pin, brooch, or medal is always a physical 3D metallic object resting on top of the clothing, catching light. Do NOT alter the clothing fabric itself.
- The existing clothing (t-shirt print, logos, text, colors) must be preserved exactly as-is. Only add or replace objects that are held, worn separately, or pinned on top.
- When replacing an object in a hand, describe the replacement object in full visual detail (material, shape, size, color, texture, engravings).

## SCENE & ATMOSPHERE INTERPRETATION

Examples (do not copy literally — use as visual reasoning examples):
- "fantôme" → translucent ethereal body, ghostly glow, semi-transparent silhouette with spectral light
- "dojo" → traditional Japanese martial arts hall, polished wooden floor, wall mirrors, dim lighting, minimalist decor
- "far west" → desert landscape, dry earth, wooden frontier cabin or saloon, warm orange sunset light, dust in the air
- "monde inspiré de l'Atlantide" → underwater ancient ruins, bioluminescent light, coral and stone architecture, deep blue atmosphere
- "en magenta" → change the color to deep magenta/fuchsia, NOT change anything else

## OUTPUT FIELDS

- prompt: the final image description in English. Visual, concrete, atmospheric. What would an artist paint? Include: subject appearance, action, environment, lighting, mood, color palette. No meta-instructions.
- negative_prompt: rendering defects only (blurry, deformed, watermark). Empty string if nothing specific.
- subject: main subject, one short phrase.
- style: visual style, one short phrase.
- width/height: pixels. Default 1024x1024. Portrait (768x1024) for people, landscape (1024x768) for scenes.
- has_reference_image: true if user references "this person/photo/image", "cette personne/photo/image", "ce X", etc.
- preserve_identity: true if user wants the same face/person from the reference (almost always true when has_reference_image is true).
- transformation_description: when has_reference_image is true, write a detailed English editing instruction:
  1. Background/environment change (full visual scene)
  2. Object replacements: "Replace the [existing object] in subject's [location] with [FULL VISUAL DESCRIPTION of the new object — material, shape, size, color, engravings, style]"
  3. New items to ADD on the subject (describe exactly: where, what it looks like)
  4. Any visual effects or style changes on the subject itself
  Rule: never refer to a prop by name only — describe what it looks like well enough that an artist could render it without knowing the name.

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
  const carryoverClause = carryoverSummary ? `Reference vision analysis: ${carryoverSummary}. ` : '';
  const referencePrompt = `${translated}. ${carryoverClause}Preserve the reference image identity and visual coherence.`;
  const prompt = normalizeText(hasReference ? referencePrompt : translated) || sourceText;
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
    guidance_scale: 7,
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

  // Prefer direct Groq 70B over whatever A11_TRANSLATION_BASE_URL points to.
  const groqCallFn = buildGroqCallStructuredLlmJson(env);
  const effectiveCallLlm = groqCallFn || callStructuredLlmJson;

  if (typeof effectiveCallLlm !== 'function') {
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
    response = await effectiveCallLlm({
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
    // Force preserveIdentity when reference image is present — never trust LLM to decide this.
    preserveIdentity: hasReference || response.preserve_identity === true,
    transformationDescription: normalizeText(response.transformation_description || ''),
    // Champs SD3 multi-prompt — le prompt principal va dans prompt_1
    // prompt_2 et prompt_3 sont construits par le translator vidéo/image
    prompt_prebuilt: true,
    num_inference_steps: resolveDirectImageSteps(env),
    guidance_scale: 7,
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
    has_reference_image: sdPayload.hasReferenceImage || undefined,
    preserve_identity: sdPayload.preserveIdentity || undefined,
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
  shouldUseGroqDirect,
  IMAGE_PIPELINE_SYSTEM_PROMPT,
  IMAGE_PIPELINE_RESPONSE_FORMAT,
};

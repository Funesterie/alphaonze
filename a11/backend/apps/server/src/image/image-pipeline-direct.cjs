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

const IMAGE_PIPELINE_SYSTEM_PROMPT = `You are a Stable Diffusion 3.5 prompt engineer for A11.

You receive a user request (may be in French or any language) and produce a generation-ready SD3.5 prompt in English.

Your output:
- prompt: the positive SD3.5 prompt in English. Be descriptive, visual, concrete. Include subject, action, environment, style, lighting. No meta-instructions, no "generate", no "create".
- negative_prompt: only real rendering defects to avoid (blurry, deformed, watermark, text). Empty string if nothing specific.
- subject: the main subject in English, one short phrase.
- style: the visual style in English, one short phrase.
- width/height: image dimensions in pixels. Default 1024x1024. Use portrait (768x1024) for people, landscape (1024x768) for scenes.
- has_reference_image: true if the user mentions "this person", "this photo", "cette personne", "ce garçon", etc.
- preserve_identity: true if the user wants to keep the same face/identity from a reference image.
- transformation_description: if the user wants to transform the reference subject, describe the transformation in English.

Rules:
- Write the prompt as if describing a painting or photograph to an artist. Be specific and visual.
- Keep the user's exact intent. Do not add elements they did not request.
- Do not add "no text", "no watermark" to negative_prompt unless the user asked for it.
- For fantasy/action scenes, describe the scene vividly with atmosphere and energy.
- For portraits with reference images, note what should be preserved vs transformed.

Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveImageDimensions(width, height, env = process.env) {
  const config = resolveImageDimensionConfig(env);
  const resolvedWidth = Number(width) > 0 ? Number(width) : config.defaultWidth;
  const resolvedHeight = Number(height) > 0 ? Number(height) : config.defaultHeight;
  return { width: resolvedWidth, height: resolvedHeight };
}

async function buildImageSdPayload({
  userMessage = '',
  referenceImageUrl = '',
  referenceImagePath = '',
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 25000,
  env = process.env,
} = {}) {
  if (!userMessage) {
    throw new Error('missing_user_message');
  }

  if (typeof callStructuredLlmJson !== 'function') {
    throw new Error('llm_unavailable');
  }

  const hasReference = Boolean(referenceImageUrl || referenceImagePath);

  const input = JSON.stringify({
    user_request: userMessage,
    has_reference_image: hasReference,
    reference_image_url: referenceImageUrl || null,
  });

  const response = await callStructuredLlmJson({
    text: input,
    systemPrompt: IMAGE_PIPELINE_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 600,
    timeoutMs: Math.max(5000, Number(timeoutMs) || 25000),
    responseFormat: IMAGE_PIPELINE_RESPONSE_FORMAT,
    stage: 'image_pipeline_direct',
  });

  if (!response || typeof response !== 'object') {
    throw new Error('llm_invalid_response');
  }

  const prompt = normalizeText(response.prompt);
  if (!prompt) {
    throw new Error('llm_empty_prompt');
  }

  const { width, height } = resolveImageDimensions(response.width, response.height, env);

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
    num_inference_steps: 28,
    guidance_scale: 7.0,
    seed: undefined,
    init_image_url: referenceImageUrl || undefined,
    init_image_path: referenceImagePath || undefined,
  };
}

async function executeDirectImagePipeline({
  userMessage = '',
  referenceImageUrl = '',
  referenceImagePath = '',
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
    ...(sdPayload.init_image_url ? { init_image_url: sdPayload.init_image_url } : {}),
    ...(sdPayload.init_image_path ? { init_image_path: sdPayload.init_image_path } : {}),
  };

  const result = await generateSd({ req, body: sdBody, prompt: sdPayload.prompt });

  return {
    ok: true,
    artifact_type: 'image',
    image_url: result?.image_url || result?.url || null,
    url: result?.image_url || result?.url || null,
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

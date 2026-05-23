const textToWazaa = require('./text-to-wazaa.cjs');
const wazaaToMask = require('./wazaa-to-mask.cjs');
const {
  applyCanonicalizedImageGenerateRequestToMask,
  buildCanonicalizedRequestTextSmootherResult,
  canonicalizeImageGenerateRequest: defaultCanonicalizeImageGenerateRequest,
} = require('./canonicalize-image-generate-request.cjs');

function toNumberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function applyImageMaskOverrides(rawMask, maskOptions = {}) {
  if (!rawMask || typeof rawMask !== 'object') return rawMask;

  const nextMask = {
    ...rawMask,
    options: {
      ...(rawMask.options && typeof rawMask.options === 'object' ? rawMask.options : {}),
    },
  };

  if (maskOptions.width !== undefined) {
    nextMask.options.width = toNumberOr(maskOptions.width, nextMask.options.width);
  }
  if (maskOptions.height !== undefined) {
    nextMask.options.height = toNumberOr(maskOptions.height, nextMask.options.height);
  }
  if (maskOptions.steps !== undefined) {
    nextMask.options.steps = toNumberOr(maskOptions.steps, nextMask.options.steps);
  }
  if (maskOptions.guidance_scale !== undefined) {
    nextMask.options.guidance_scale = toNumberOr(maskOptions.guidance_scale, nextMask.options.guidance_scale);
  }
  if (maskOptions.seed !== undefined && maskOptions.seed !== null && maskOptions.seed !== '') {
    nextMask.options.seed = toNumberOr(maskOptions.seed, nextMask.options.seed);
  }

  return nextMask;
}

async function buildCanonicalImageMaskFromText(text, opts = {}) {
  const rawUserInput = String(text || '').trim();
  if (!rawUserInput) return null;
  const canonicalizeImageGenerateRequest = opts.canonicalizeImageGenerateRequest || defaultCanonicalizeImageGenerateRequest;
  let canonicalizedRequest = null;
  try {
    canonicalizedRequest = await canonicalizeImageGenerateRequest(rawUserInput, {
      stage: 'resolve-image-mask-from-text',
      callStructuredLlmJson: opts.callStructuredLlmJson,
      referenceImagePresent: Boolean(
        opts.referenceImageUrl
        || opts.sourceImageUrl
        || opts.body?.referenceImageUrl
        || opts.body?.reference_image_url
        || opts.body?.sourceImageUrl
        || opts.body?.source_image_url
      ),
      referenceImageUrl: String(
        opts.referenceImageUrl
        || opts.sourceImageUrl
        || opts.body?.referenceImageUrl
        || opts.body?.reference_image_url
        || opts.body?.sourceImageUrl
        || opts.body?.source_image_url
        || ''
      ).trim(),
    });
  } catch (error_) {
    throw error_;
  }

  if (canonicalizedRequest?.needsClarification === true) {
    const error = new Error('image_generate_clarification_required');
    error.statusCode = 409;
    error.payload = {
      ok: false,
      error: 'image_generate_clarification_required',
      question: canonicalizedRequest.clarificationQuestion || 'Please clarify the image request before generation.',
    };
    throw error;
  }

  const requestTextSmootherResult = buildCanonicalizedRequestTextSmootherResult(canonicalizedRequest);
  const effectiveSourceText = String(canonicalizedRequest?.canonicalEnglishInput || '').trim();
  if (!effectiveSourceText) {
    const error = new Error('image_request_canonicalization_failed');
    error.statusCode = 422;
    error.payload = {
      ok: false,
      error: 'image_request_canonicalization_failed',
    };
    throw error;
  }

  let wazaa = null;
  let rawMask = null;
  let errorMessage = '';

  try {
    wazaa = await textToWazaa(effectiveSourceText, {
      ...opts,
      canonicalizedRequest,
      requestTextSmootherResult,
    });
  } catch (error_) {
    if (!errorMessage) errorMessage = String(error_?.message || error_);
  }

  if (wazaa) {
    rawMask = wazaaToMask(wazaa, {
      intentType: 'image.generate',
      sourceText: effectiveSourceText,
      semanticAnalysis: opts.analysis || null,
    });
  }

  if (!rawMask || rawMask.intent !== 'image.generate') {
    const error = new Error(errorMessage || 'invalid_mask');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'invalid_mask',
      message: 'Impossible de construire un MASK image.generate a partir du texte fourni.',
    };
    throw error;
  }

  rawMask = applyCanonicalizedImageGenerateRequestToMask(rawMask, canonicalizedRequest);

  return {
    rawMask: applyImageMaskOverrides(rawMask, opts.maskOptions || {}),
    wazaa,
    fallbackUsed: null,
    source: 'canonical-wazaa',
    requestTextSmootherResult,
    canonicalizedRequest,
  };
}

module.exports = {
  applyImageMaskOverrides,
  buildCanonicalImageMaskFromText,
};

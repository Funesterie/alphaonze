const buildMaskImageGenerateFromText = require('./text-to-mask-image-generate.cjs');
const textToWazaa = require('./text-to-wazaa.cjs');
const wazaaToMask = require('./wazaa-to-mask.cjs');

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
  const sourceText = String(text || '').trim();
  if (!sourceText) return null;

  let heuristicWazaa = null;
  let wazaa = null;
  let rawMask = null;
  let fallbackUsed = null;
  let errorMessage = '';

  try {
    heuristicWazaa = typeof textToWazaa.sync === 'function'
      ? textToWazaa.sync(sourceText, opts)
      : null;
  } catch (error_) {
    errorMessage = String(error_?.message || error_);
  }

  try {
    wazaa = await textToWazaa(sourceText, opts);
  } catch (error_) {
    if (!errorMessage) errorMessage = String(error_?.message || error_);
  }

  const effectiveWazaa = wazaa || heuristicWazaa;
  if (effectiveWazaa) {
    rawMask = wazaaToMask(effectiveWazaa, {
      intentType: 'image.generate',
      sourceText,
    });
  }

  if ((!rawMask || rawMask.intent !== 'image.generate') && opts.allowCompatFallback !== false) {
    rawMask = buildMaskImageGenerateFromText(sourceText, opts.maskOptions || {});
    if (rawMask) {
      fallbackUsed = 'text-to-mask-image-generate';
    }
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

  return {
    rawMask: applyImageMaskOverrides(rawMask, opts.maskOptions || {}),
    wazaa: effectiveWazaa,
    fallbackUsed,
    source: fallbackUsed ? 'compat' : 'wazaa',
  };
}

module.exports = {
  applyImageMaskOverrides,
  buildCanonicalImageMaskFromText,
};

const {
  generateImageFromMask,
} = require('../mask/image-chat-runtime.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('../mask/resolve-image-mask-from-text.cjs');

async function executeGenerateImagePlan({ req, canonicalIntent, generateSd }) {
  const sourceText = String(
    canonicalIntent?.sourceText
    || canonicalIntent?.normalizedText
    || canonicalIntent?.subject?.prompt
    || canonicalIntent?.subject?.display
    || canonicalIntent?.subject?.entity
    || ''
  ).trim();
  const maskResolution = await buildCanonicalImageMaskFromText(sourceText, {
    maskOptions: {
      width: canonicalIntent?.execution?.width,
      height: canonicalIntent?.execution?.height,
      steps: canonicalIntent?.execution?.steps,
      guidance_scale: canonicalIntent?.execution?.guidanceScale,
    },
  });
  const imageResult = await generateImageFromMask({
    req,
    rawMask: maskResolution.rawMask,
    generateSd,
  });

  return {
    imageResult,
    rawMask: maskResolution.rawMask,
    wazaa: maskResolution.wazaa,
    fallbackUsed: maskResolution.fallbackUsed,
  };
}

async function executeWebImageSearchPlan({ canonicalIntent, duckduckgoImageSearch }) {
  if (typeof duckduckgoImageSearch !== 'function') {
    const error = new Error('web_image_search_unavailable');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'web_image_search_unavailable',
      message: 'duckduckgoImageSearch handler unavailable',
    };
    throw error;
  }

  const subject = String(
    canonicalIntent?.subject?.searchQuery
    || canonicalIntent?.subject?.display
    || canonicalIntent?.subject?.entity
    || ''
  ).trim();

  if (!subject) {
    const error = new Error('missing_subject');
    error.statusCode = 400;
    error.payload = { ok: false, error: 'missing_subject' };
    throw error;
  }

  const result = await duckduckgoImageSearch(subject);
  return {
    subject,
    result,
  };
}

module.exports = {
  executeGenerateImagePlan,
  executeWebImageSearchPlan,
};

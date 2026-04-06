const {
  generateImageFromMask,
} = require('../mask/image-chat-runtime.cjs');
const { buildMaskFromCanonicalImageIntent } = require('./mask-first.cjs');

async function executeGenerateImagePlan({ req, canonicalIntent, generateSd }) {
  const rawMask = buildMaskFromCanonicalImageIntent(canonicalIntent);
  const imageResult = await generateImageFromMask({
    req,
    rawMask,
    generateSd,
  });

  return {
    imageResult,
    rawMask,
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

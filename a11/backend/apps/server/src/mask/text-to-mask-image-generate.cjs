const textToWazaa = require('./text-to-wazaa.cjs');
const wazaaToMask = require('./wazaa-to-mask.cjs');
const {
  applyCanonicalizedImageGenerateRequestToMask,
  buildCanonicalizedRequestTextSmootherResult,
} = require('./canonicalize-image-generate-request.cjs');

function buildMaskImageGenerateFromText(message, opts = {}) {
  const canonicalizedRequest = opts.canonicalizedRequest || null;
  const sourceText = String(
    canonicalizedRequest?.canonicalEnglishInput
    || message
    || ''
  ).trim();
  if (!sourceText) return null;
  const requestTextSmootherResult = opts.requestTextSmootherResult
    || buildCanonicalizedRequestTextSmootherResult(canonicalizedRequest || {
      canonicalEnglishInput: sourceText,
    });

  const wazaa = typeof textToWazaa.sync === 'function'
    ? textToWazaa.sync(sourceText, {
      ...opts,
      requestTextSmootherResult,
    })
    : null;
  const mask = wazaaToMask(wazaa, {
    intentType: 'image.generate',
    sourceText,
    semanticAnalysis: opts.analysis || null,
  });

  if (!mask || mask.intent !== 'image.generate') return null;
  return canonicalizedRequest
    ? applyCanonicalizedImageGenerateRequestToMask(mask, canonicalizedRequest)
    : mask;
}

module.exports = buildMaskImageGenerateFromText;

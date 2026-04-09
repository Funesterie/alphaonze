const textToWazaa = require('./text-to-wazaa.cjs');
const wazaaToMask = require('./wazaa-to-mask.cjs');
const {
  smoothRequestTextSync,
} = require('../knowledge/request-text-smoother.cjs');

function buildMaskImageGenerateFromText(message, opts = {}) {
  const sourceText = String(message || '').trim();
  if (!sourceText) return null;
  const requestTextSmootherResult = opts.requestTextSmootherResult || smoothRequestTextSync(sourceText, {
    source: 'text-to-mask-image-generate',
    enableLlm: false,
  });
  const effectiveSourceText = String(requestTextSmootherResult?.text || sourceText).trim();

  const wazaa = typeof textToWazaa.sync === 'function'
    ? textToWazaa.sync(effectiveSourceText, {
      ...opts,
      requestTextSmootherResult,
    })
    : null;
  const mask = wazaaToMask(wazaa, {
    intentType: 'image.generate',
    sourceText: effectiveSourceText,
    semanticAnalysis: opts.analysis || null,
  });

  if (!mask || mask.intent !== 'image.generate') return null;
  return mask;
}

module.exports = buildMaskImageGenerateFromText;

const textToWazaa = require('./text-to-wazaa.cjs');
const wazaaToMask = require('./wazaa-to-mask.cjs');

function buildMaskImageGenerateFromText(message, opts = {}) {
  const sourceText = String(message || '').trim();
  if (!sourceText) return null;

  const wazaa = typeof textToWazaa.sync === 'function'
    ? textToWazaa.sync(sourceText, opts)
    : null;
  const mask = wazaaToMask(wazaa, {
    intentType: 'image.generate',
    sourceText,
    semanticAnalysis: opts.analysis || null,
  });

  if (!mask || mask.intent !== 'image.generate') return null;
  return mask;
}

module.exports = buildMaskImageGenerateFromText;

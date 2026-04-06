// text-to-mask-image-generate.cjs
// Transforme un message utilisateur en MASK image.generate strict

const { analyzeImagePrompt } = require('./build-sd-prompt-bundle.cjs');

function toUniqueList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

/**
 * Construit un MASK image.generate à partir d'un message utilisateur.
 * @param {string} message
 * @param {object} [opts] Options additionnelles (style, dimensions, etc.)
 * @returns {object} MASK image.generate
 */
function buildMaskImageGenerateFromText(message, opts = {}) {
  if (typeof message !== 'string' || !message.trim()) return null;
  const analysis = analyzeImagePrompt(message, {
    preferLiteralColor: true,
  });
  const subject = analysis?.subjectText || message.trim();
  const style = toUniqueList([...toArray(opts.style), ...(analysis?.styleHints || ['high quality', 'detailed'])]);
  const composition = toUniqueList([...toArray(opts.composition), ...(analysis?.compositionHints || [])]);
  const environment = toUniqueList([...toArray(opts.environment), ...toArray(opts.background)]);
  const palette = toUniqueList([...toArray(opts.palette), ...(analysis?.palette || [])]);
  const width = opts.width || 768;
  const height = opts.height || 768;
  const steps = opts.steps || 40;
  const guidance_scale = opts.guidance_scale || 8;
  return {
    version: "mask-1",
    intent: "image.generate",
    task: { domain: "image", action: "generate" },
    compiler: { target: "python", version: "1.0" },
    inputs: {
      subject: [subject],
      environment,
      style,
      composition,
      lighting: [],
      palette
    },
    options: {
      width,
      height,
      steps,
      guidance_scale
    },
    constraints: {
      safe_mode: true,
      no_text: true
    },
    ambiguities: [],
    raw: message
  };
}

module.exports = buildMaskImageGenerateFromText;

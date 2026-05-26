// Compat wrapper for historical canonicalIntent -> MASK conversions.
// The canonical image path is now:
// text-to-wazaa -> wazaa-to-mask -> validate/normalize -> compile/runtime

const { mergeUniqueStrings } = require('./prompt-builder.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('../mask/resolve-image-mask-from-text.cjs');

function extractColorAttributes(subject = {}) {
  const attributes = Array.isArray(subject?.attributes) ? subject.attributes : [];
  return attributes
    .filter((entry) => String(entry?.type || '').trim().toLowerCase() === 'color')
    .map((entry) => String(entry?.value || '').trim())
    .filter(Boolean);
}

function buildMaskFromCanonicalImageIntent(intent = {}) {
  const subjectEntity = String(intent?.subject?.entity || intent?.subject?.display || '').trim();
  const subjectDescriptor = String(intent?.subject?.prompt || '').trim();
  const subject = subjectDescriptor || subjectEntity || String(intent?.sourceText || '').trim();
  const palette = mergeUniqueStrings([
    ...extractColorAttributes(intent.subject),
    ...(Array.isArray(intent?.style?.palette) ? intent.style.palette : []),
  ]);

  return {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: subject ? [subject] : [],
      environment: mergeUniqueStrings([
        String(intent?.scene?.description || '').trim(),
      ]),
      style: mergeUniqueStrings([
        String(intent?.style?.render || '').trim(),
        ...(Array.isArray(intent?.style?.modifiers) ? intent.style.modifiers : []),
        ...(Array.isArray(intent?.style?.references) ? intent.style.references : []),
      ]),
      composition: mergeUniqueStrings(intent?.composition || []),
      lighting: mergeUniqueStrings(intent?.lighting || []),
      palette,
    },
    options: {
      width: Number(intent?.execution?.width || 768),
      height: Number(intent?.execution?.height || 768),
      steps: Number(intent?.execution?.steps || 40),
      guidance_scale: Number(intent?.execution?.guidanceScale || 8),
    },
    constraints: {
      safe_mode: intent?.constraints?.safeMode !== false,
      no_text: intent?.constraints?.noText !== false,
    },
    ambiguities: Array.isArray(intent?.ambiguities) ? intent.ambiguities : [],
    raw: String(intent?.sourceText || '').trim(),
  };
}

async function buildMaskFromCanonicalImageIntentCompat(intent = {}, opts = {}) {
  const sourceText = String(
    intent?.sourceText
    || intent?.normalizedText
    || intent?.subject?.prompt
    || intent?.subject?.display
    || intent?.subject?.entity
    || ''
  ).trim();

  if (!sourceText) {
    return buildMaskFromCanonicalImageIntent(intent);
  }

  const resolution = await buildCanonicalImageMaskFromText(sourceText, {
    maskOptions: {
      width: intent?.execution?.width ?? opts.width,
      height: intent?.execution?.height ?? opts.height,
      steps: intent?.execution?.steps ?? opts.steps,
      guidance_scale: intent?.execution?.guidanceScale ?? opts.guidance_scale,
      seed: opts.seed,
    },
  });

  return resolution?.rawMask || buildMaskFromCanonicalImageIntent(intent);
}

module.exports = {
  buildMaskFromCanonicalImageIntent,
  buildMaskFromCanonicalImageIntentCompat,
};

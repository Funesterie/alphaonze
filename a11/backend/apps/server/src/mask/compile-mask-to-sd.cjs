// compile-mask-to-sd.cjs
// Compile MASK image.generate -> raw Stable Diffusion payload (prompt + params)

const {
  translateImagePromptToEnglish,
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  bindSemanticAtoms,
} = require('./build-sd-prompt-bundle.cjs');

/**
 * Compile a validated MASK (image.generate) to a raw SD payload
 * @param {object} mask
 * @returns {object} Raw SD payload (prompt, width, height, steps, guidance_scale, etc.)
 */
function identityPrompt(value = '') {
  return String(value || '').trim();
}

function joinField(arr, label, normalizeValue = identityPrompt) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  const normalizedValues = arr
    .map((value) => normalizeValue(String(value || '').trim()))
    .filter(Boolean);
  if (normalizedValues.length === 0) return '';
  return label ? `${label}: ${normalizedValues.join(', ')}` : normalizedValues.join(', ');
}

function shouldUseSemanticPromptCompiler(mask) {
  return Boolean(
    String(mask?.meta?.promptCompiler || '').trim() === 'a11-semantic'
    || mask?.meta?.llmEnriched === true
    || String(mask?.meta?.translatedText || '').trim()
  );
}

function buildPromptCompilerContext(mask) {
  const semanticCompiler = shouldUseSemanticPromptCompiler(mask);
  const normalizeValue = semanticCompiler ? identityPrompt : translateImagePromptToEnglish;
  const rawPrompt = String(mask?.raw || '').trim();
  const translatedText = String(mask?.meta?.translatedText || '').trim();
  const compilerSeedPrompt = semanticCompiler
    ? (translatedText || String(mask?.meta?.promptSeedText || '').trim() || rawPrompt)
    : rawPrompt;

  return {
    semanticCompiler,
    normalizeValue,
    rawPrompt,
    compilerSeedPrompt,
  };
}

function canonicalizePaletteValues(values = [], normalizeValue = identityPrompt) {
  const unique = new Map();
  for (const entry of Array.isArray(values) ? values : []) {
    const raw = String(entry || '').trim();
    if (!raw) continue;
    const normalized = normalizeValue(raw);
    const canonical = translateImagePromptToEnglish(normalized || raw);
    const key = String(canonical || normalized || raw).trim().toLowerCase();
    if (!key || unique.has(key)) continue;
    unique.set(key, String(canonical || normalized || raw).trim());
  }
  return [...unique.values()];
}

function buildPrimaryPromptLead({ semanticBinding, subjectText, paletteValues = [] }) {
  const promptLead = String(semanticBinding?.promptLead || '').trim();
  const fallbackSubject = String(subjectText || '').trim();
  const subject = promptLead || fallbackSubject;
  if (!subject) return '';

  const leadLower = subject.toLowerCase();
  const firstPalette = String((Array.isArray(paletteValues) ? paletteValues[0] : '') || '').trim();
  if (!firstPalette) return subject;

  const paletteLower = firstPalette.toLowerCase();
  if (leadLower.includes(paletteLower)) return subject;
  if (/\b(?:pokemon|character|creature|animal|rabbit|bear|cat|dog|dragon|unicorn|bicycle|bike)\b/i.test(subject)) {
    return `${firstPalette} ${subject}`.trim();
  }
  return subject;
}

function compileMaskToSD(mask) {
  if (mask?.intent !== 'image.generate') {
    throw new Error('MASK intent must be image.generate');
  }
  const compilerContext = buildPromptCompilerContext(mask);
  const rawPrompt = compilerContext.rawPrompt;
  const promptSeed = compilerContext.compilerSeedPrompt || rawPrompt;
  const translatedSubject = joinField(mask.inputs?.subject, '', compilerContext.normalizeValue);
  const translatedEnvironment = joinField(mask.inputs?.environment, '', compilerContext.normalizeValue);
  const translatedStyleHints = (Array.isArray(mask.inputs?.style) ? mask.inputs.style : [])
    .map((value) => compilerContext.normalizeValue(String(value || '').trim()))
    .filter(Boolean);
  const translatedCompositionHints = (Array.isArray(mask.inputs?.composition) ? mask.inputs.composition : [])
    .map((value) => compilerContext.normalizeValue(String(value || '').trim()))
    .filter(Boolean);
  const characterCountConstraints = compileCharacterCountConstraints(promptSeed);
  const singleSubjectConstraints = characterCountConstraints
    ? null
    : compileSingleSubjectConstraints(promptSeed, translatedSubject);
  const semanticBinding = bindSemanticAtoms({
    rawPrompt: promptSeed,
    subjectPromptEnglish: translatedSubject,
    styleHints: translatedStyleHints,
    compositionHints: translatedCompositionHints,
    characterCountConstraints,
    singleSubjectConstraints,
    translatePrompt: compilerContext.normalizeValue,
  });
  const canonicalPalette = canonicalizePaletteValues(mask.inputs?.palette, compilerContext.normalizeValue);
  const promptSections = [
    buildPrimaryPromptLead({
      semanticBinding,
      subjectText: translatedSubject,
      paletteValues: canonicalPalette,
    }),
    ...((semanticBinding.relationAtoms || [])),
    translatedEnvironment,
    (semanticBinding.styleAtoms || translatedStyleHints).join(', '),
    (semanticBinding.structuralAtoms || []).join(', '),
    joinField(mask.inputs?.lighting, '', compilerContext.normalizeValue),
    canonicalPalette.length
      ? `color palette: ${canonicalPalette.join(', ')}`
      : '',
    canonicalPalette.length ? 'the requested color applies to the main subject itself, not to the background, foreground, props, or decorative elements' : '',
    'literal interpretation, apply the requested colors to the main subject only, keep a coherent single scene, do not add extra props or decorative elements unless requested',
  ].filter(s => typeof s === 'string' && s.length > 0);
  const prompt = promptSections.join('. ');

  const sdPayload = {
    prompt,
    width: mask.options?.width,
    height: mask.options?.height,
    steps: mask.options?.steps,
    guidance_scale: mask.options?.guidance_scale,
  };
  if (typeof mask.options?.seed === 'number') sdPayload.seed = mask.options.seed;
  if (typeof mask.options?.sampler === 'string') sdPayload.sampler = mask.options.sampler;

  return sdPayload;
}

module.exports = compileMaskToSD;

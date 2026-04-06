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
 * @returns {object} Raw SD payload (prompt, negative_prompt, width, height, steps, guidance_scale, etc.)
 */
function joinField(arr, label) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  const normalizedValues = arr
    .map((value) => translateImagePromptToEnglish(String(value || '').trim()))
    .filter(Boolean);
  if (normalizedValues.length === 0) return '';
  return label ? `${label}: ${normalizedValues.join(', ')}` : normalizedValues.join(', ');
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const ANIMAL_SUBJECT_PATTERN = /\b(rabbit|bunny|hare|fox|sheep|ram|ewe|lamb|bear|cow|bull|dog|cat|wolf|tiger|lion|horse|pony|donkey|pig|boar|monkey|gorilla|panda|deer|bird|owl|eagle|duck|goose|chicken|hen|rooster|goat|camel|elephant|giraffe|zebra|whale|dolphin|shark|frog|turtle|snake|lizard)\b/;

function asSingleSubjectLead(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^one\b/i.test(text)) return text;
  if (/^an?\b/i.test(text)) return text.replace(/^an?\b/i, 'one');
  if (/^the\b/i.test(text)) return text.replace(/^the\b/i, 'one');
  return `one ${text}`;
}

function includesAny(text, patterns = []) {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => pattern.test(normalized));
}

function compileMaskToSD(mask) {
  if (mask?.intent !== 'image.generate') {
    throw new Error('MASK intent must be image.generate');
  }
  const rawPrompt = String(mask?.raw || '').trim();
  const translatedSubject = joinField(mask.inputs?.subject);
  const translatedEnvironment = joinField(mask.inputs?.environment);
  const translatedStyleHints = (Array.isArray(mask.inputs?.style) ? mask.inputs.style : [])
    .map((value) => translateImagePromptToEnglish(String(value || '').trim()))
    .filter(Boolean);
  const translatedCompositionHints = (Array.isArray(mask.inputs?.composition) ? mask.inputs.composition : [])
    .map((value) => translateImagePromptToEnglish(String(value || '').trim()))
    .filter(Boolean);
  const normalizedSubject = normalizeText(translatedSubject || rawPrompt);
  const animalLikeSubject = ANIMAL_SUBJECT_PATTERN.test(normalizedSubject);
  const sheepLikeSubject = /\bsheep\b/.test(normalizedSubject);
  const characterCountConstraints = compileCharacterCountConstraints(rawPrompt);
  const singleSubjectConstraints = characterCountConstraints
    ? null
    : compileSingleSubjectConstraints(rawPrompt, translatedSubject);
  const semanticBinding = bindSemanticAtoms({
    rawPrompt,
    subjectPromptEnglish: translatedSubject,
    styleHints: translatedStyleHints,
    compositionHints: translatedCompositionHints,
    characterCountConstraints,
    singleSubjectConstraints,
    translatePrompt: translateImagePromptToEnglish,
  });
  const structuralAtoms = Array.isArray(semanticBinding?.structuralAtoms)
    ? [...semanticBinding.structuralAtoms]
    : [];
  if (animalLikeSubject) {
    structuralAtoms.push('only one animal in frame', 'no other animals visible');
  }
  if (sheepLikeSubject) {
    const filteredSheepAtoms = structuralAtoms.filter(
      (value) => !/subject fills the frame|balanced negative space/i.test(String(value || ''))
    );
    structuralAtoms.length = 0;
    structuralAtoms.push(...filteredSheepAtoms, 'entire animal visible', 'single sheep standing alone', 'isolated sheep', 'no flock', 'no herd', 'no background sheep');
  }
  const promptLead = sheepLikeSubject
    ? `full body view of ${asSingleSubjectLead(translatedSubject || semanticBinding.promptLead || 'sheep')} standing alone`
    : (semanticBinding.promptLead || translatedSubject);
  const promptSections = [
    promptLead,
    ...((semanticBinding.relationAtoms || [])),
    translatedEnvironment,
    (semanticBinding.styleAtoms || translatedStyleHints).join(', '),
    structuralAtoms.join(', '),
    joinField(mask.inputs?.lighting),
    mask.inputs?.palette?.length ? `color palette: ${mask.inputs.palette.join(', ')}` : '',
    mask.inputs?.palette?.length ? 'the requested color applies to the main subject itself, not to the background, foreground, props, or decorative elements' : '',
    'literal interpretation, apply the requested colors to the main subject only, keep a coherent single scene, do not add extra props or decorative elements unless requested',
  ].filter(s => typeof s === 'string' && s.length > 0);
  const prompt = promptSections.join('. ');

  const negativePromptParts = [
    'blurry',
    'abstract',
    'deformed',
    'bad anatomy',
    'low quality',
    'collage',
    'repeated pattern',
    'wallpaper',
    'background clutter',
    'random props',
  ];
  if (mask.constraints?.no_text) {
    negativePromptParts.push('text', 'letters', 'watermark', 'signature', 'logo');
  }
  if (!includesAny(rawPrompt, [/\bfleur/, /\bbouquet\b/, /\bpetale\b/, /\bpetal\b/, /\bfloral\b/, /\bflowers?\b/])) {
    negativePromptParts.push('flowers', 'bouquet', 'rose petals', 'floral background', 'floral pattern', 'foreground flowers', 'decorative foreground objects');
  }
  if (!includesAny(rawPrompt, [/\bplusieurs\b/, /\bdes\b/, /\bmany\b/, /\bmultiple\b/, /\bcrowd\b/, /\bgroup\b/, /\bgroupe\b/])) {
    negativePromptParts.push('extra character', 'duplicate subject', 'multiple subjects', 'multiple characters', 'multiple animals', 'crowd', 'group shot', 'clones', 'twins', 'duplicate body', 'duplicate face', 'extra heads');
  }
  if (animalLikeSubject) {
    negativePromptParts.push('animal family', 'pack', 'cub', 'pup', 'baby animal', 'second animal');
  }
  if (sheepLikeSubject) {
    negativePromptParts.push('flock', 'herd', 'background sheep', 'other sheep', 'surrounding sheep', 'sheep in background', 'extra sheep head', 'extra sheep face', 'multiple necks', 'multiple muzzles', 'cropped sheep');
  }
  if (Array.isArray(semanticBinding?.blockedDuplicates)) {
    negativePromptParts.push(...semanticBinding.blockedDuplicates);
  }
  const negativePrompt = [...new Set(negativePromptParts)].join(', ');

  const sdPayload = {
    prompt,
    negative_prompt: negativePrompt,
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

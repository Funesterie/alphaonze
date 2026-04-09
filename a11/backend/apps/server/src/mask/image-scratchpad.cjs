const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .toLowerCase();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function extractSemanticLabels(values = []) {
  return toUniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((entry) => entry?.label || entry?.key || entry)
  );
}

function buildImageScratchpad(mask = {}, entityContext = null) {
  const normalizedMask = normalizeMaskImageGenerate(mask);
  const semantic = normalizedMask?.meta?.semantic && typeof normalizedMask.meta.semantic === 'object'
    ? normalizedMask.meta.semantic
    : {};
  const subjectProfileType = normalizeText(normalizedMask?.meta?.subjectProfile?.type || '');
  const canonicalSubject = normalizeText(
    entityContext?.canonicalSubject
    || normalizedMask?.meta?.canonicalSubject
    || normalizedMask?.meta?.subjectProfile?.canonicalSubject
    || normalizedMask?.inputs?.subject?.[0]
    || ''
  );
  const universe = normalizeText(entityContext?.universe || '');
  const accessories = extractSemanticLabels(semantic?.accessories);
  const elements = extractSemanticLabels(semantic?.elements);
  const metiers = extractSemanticLabels(semantic?.metiers);
  const scenes = extractSemanticLabels(semantic?.scenes);
  const styles = toUniqueStrings([
    ...(Array.isArray(normalizedMask?.inputs?.style) ? normalizedMask.inputs.style : []),
  ]).slice(0, 5);

  const facts = toUniqueStrings([
    canonicalSubject ? `Sujet canonique : ${canonicalSubject}` : '',
    normalizeText(entityContext?.description || '') ? `Repère d'entité : ${normalizeText(entityContext.description)}` : '',
    normalizeText(entityContext?.summary || '') ? `Contexte encyclopédique : ${normalizeText(entityContext.summary)}` : '',
    universe ? `Univers probable : ${universe}` : '',
    accessories.length ? `Accessoires demandés : ${accessories.join(', ')}` : '',
    elements.length ? `Éléments demandés : ${elements.join(', ')}` : '',
    metiers.length ? `Rôle demandé : ${metiers.join(', ')}` : '',
    scenes.length ? `Décor demandé : ${scenes.join(', ')}` : '',
  ]);

  return {
    canonicalSubject,
    subjectProfileType,
    entityType: normalizeText(entityContext?.entityType || ''),
    universe,
    accessories,
    elements,
    metiers,
    scenes,
    styles,
    facts,
    promptFacts: facts.slice(0, 4),
    draftAllowed: [
      'reference_character',
      'pokemon_creature',
      'single_human_figure',
      'single_animal',
      'mythic_creature',
      'phoenix_creature',
    ].includes(subjectProfileType),
  };
}

function buildScratchpadPromptInstructions(scratchpad = {}, mask = {}) {
  const currentSubject = normalizeText(mask?.inputs?.subject?.[0] || '');
  const canonicalSubject = normalizeText(scratchpad?.canonicalSubject || '');
  const universe = normalizeText(scratchpad?.universe || '');
  const subjectProfileType = normalizeText(scratchpad?.subjectProfileType || '');
  const instructions = [];

  if (canonicalSubject && canonicalSubject.toLowerCase() !== currentSubject.toLowerCase()) {
    instructions.push(`Rester fidèle au sujet canonique nommé ${canonicalSubject}.`);
  }

  if (universe && subjectProfileType === 'reference_character') {
    instructions.push(`Rester cohérent avec l univers ${universe}.`);
  }

  return toUniqueStrings(instructions).slice(0, 2);
}

function looksLikeNoisySubject(value = '') {
  const normalized = normalizeLookup(value);
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  return /^(?:d|de|du|des|la|le|les|un|une|truc|chose)$/.test(normalized);
}

function shouldPromoteEntityCanonicalSubject(mask = {}, entityContext = null) {
  const canonicalSubject = normalizeText(entityContext?.canonicalSubject || '');
  if (!canonicalSubject) return false;

  const currentSubject = normalizeText(mask?.inputs?.subject?.[0] || '');
  if (!currentSubject) return true;
  if (canonicalSubject.toLowerCase() === currentSubject.toLowerCase()) return false;

  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  if (subjectProfileType === 'reference_character') return true;
  if (/\d/.test(String(mask?.raw || ''))) return true;
  return looksLikeNoisySubject(currentSubject);
}

function enrichImageMaskWithScratchpad(rawMask = {}, {
  entityContext = null,
  scratchpad = null,
} = {}) {
  const mask = deepClone(normalizeMaskImageGenerate(rawMask));
  mask.meta = mask.meta && typeof mask.meta === 'object' ? mask.meta : {};

  if (entityContext && typeof entityContext === 'object') {
    mask.meta.imageEntityContext = entityContext;
  }

  const nextScratchpad = scratchpad && typeof scratchpad === 'object'
    ? scratchpad
    : buildImageScratchpad(mask, entityContext);

  if (nextScratchpad && typeof nextScratchpad === 'object') {
    mask.meta.imageScratchpad = nextScratchpad;
  }

  const extraInstructions = buildScratchpadPromptInstructions(nextScratchpad, mask);
  if (extraInstructions.length) {
    mask.meta.promptInstructions = toUniqueStrings([
      ...(Array.isArray(mask.meta.promptInstructions) ? mask.meta.promptInstructions : []),
      ...extraInstructions,
    ]);
  }

  if (shouldPromoteEntityCanonicalSubject(mask, entityContext)) {
    const canonicalSubject = normalizeText(entityContext?.canonicalSubject || '');
    if (canonicalSubject) {
      mask.meta.canonicalSubject = canonicalSubject;
      mask.inputs.subject = [canonicalSubject];
    }
  }

  return mask;
}

module.exports = {
  buildImageScratchpad,
  buildScratchpadPromptInstructions,
  enrichImageMaskWithScratchpad,
};

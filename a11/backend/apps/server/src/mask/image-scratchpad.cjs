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

function shouldPromoteUniverseInstruction(value = '') {
  const normalized = normalizeLookup(value);
  if (!normalized) return false;
  if (normalized.split(/\s+/).filter(Boolean).length > 5) return false;
  return !/\b(cree|creee|created|developpe|developed|publie|published|shigeru|miyamoto|personnage|fiction|wikipedia)\b/.test(normalized);
}

function countEntries(values = []) {
  return (Array.isArray(values) ? values : []).filter(Boolean).length;
}

function extractCoreImageRequestText(mask = {}) {
  return normalizeText(
    mask?.meta?.canonicalizedRequest?.audit?.rawUserInput
    || mask?.meta?.promptCanonicalization?.rawUserInput
    || mask?.meta?.originalSourceText
    || mask?.raw
    || ''
  )
    .replace(/^(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+/i, '')
    .replace(/^que\s+tu\s+/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche)\s+(?:moi\s+)?/i, '')
    .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait)\s+(?:de|du|de la|de l['’]?|d['’])?\s*/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

function hasExplicitSceneRelation(value = '') {
  return /\b(avec|dans|sur|sous|tenant|portant|devant|derriere|derrière|au milieu de|au bord de|pres de|près de|en train de)\b/i.test(String(value || ''));
}

function buildScratchpadEmbellishment(scratchpad = {}, mask = {}) {
  const coreRequestText = extractCoreImageRequestText(mask);
  const normalizedCoreRequest = normalizeLookup(coreRequestText);
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const subjectProfileType = normalizeText(scratchpad?.subjectProfileType || mask?.meta?.subjectProfile?.type || '');
  const hasPromptInstructions = Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 0;
  const semanticComplexity = (
    countEntries(semantic?.accessories)
    + countEntries(semantic?.elements)
    + countEntries(semantic?.metiers)
    + countEntries(semantic?.scenes)
  );
  const tokenCount = normalizedCoreRequest.split(/\s+/).filter(Boolean).length;
  const isBasicRequest = Boolean(
    normalizedCoreRequest
    && tokenCount > 0
    && tokenCount <= 4
    && !hasExplicitSceneRelation(coreRequestText)
    && semanticComplexity === 0
    && !hasPromptInstructions
  );

  if (!isBasicRequest) return null;

  const lookupText = normalizeLookup([
    coreRequestText,
    scratchpad?.canonicalSubject,
    scratchpad?.universe,
    scratchpad?.entityType,
    ...(Array.isArray(scratchpad?.facts) ? scratchpad.facts : []),
  ].filter(Boolean).join(' '));

  const racingArcadeRequest = /\b(mario kart|kart|circuit|course|racing|race|drift|derapage)\b/.test(lookupText);
  if (racingArcadeRequest) {
    return {
      family: 'racing_arcade',
      reason: 'basic_racing_request',
      composition: [
        'action dynamique lisible',
        'dérapage visible',
        'kart bien lisible',
      ],
      environment: [
        'virage de circuit lisible',
        'circuit coloré cohérent avec l univers',
      ],
      style: [
        'énergie arcade nette',
      ],
      promptInstructions: [
        'Montrer le sujet en pleine course sur un circuit cohérent, simple et lisible.',
        'Ajouter un dérapage visible avec légère fumée sur les pneus et de petites flammes à l échappement.',
      ],
    };
  }

  if (subjectProfileType === 'reference_character' || subjectProfileType === 'single_human_figure') {
    return {
      family: 'character_simple',
      reason: 'basic_character_request',
      composition: [
        'pose dynamique simple',
        'présence héroïque lisible',
      ],
      environment: [
        'décor cohérent avec l univers',
      ],
      style: [
        'mise en scène nette',
      ],
      promptInstructions: [
        'Ajouter une petite énergie visuelle cohérente avec le personnage, tout en gardant une scène simple et lisible.',
      ],
    };
  }

  if ([
    'pokemon_creature',
    'single_animal',
    'mythic_creature',
    'phoenix_creature',
  ].includes(subjectProfileType)) {
    return {
      family: 'living_subject_simple',
      reason: 'basic_living_subject_request',
      composition: [
        'élan vivant mais lisible',
      ],
      environment: [
        'ambiance simple cohérente avec le sujet',
      ],
      style: [
        'touche artistique légère',
      ],
      promptInstructions: [
        'Donner au sujet une petite fibre artistique avec un mouvement léger et naturel, sans surcharger la scène.',
      ],
    };
  }

  if ([
    'simple_food_object',
    'container_object',
    'single_plant_object',
  ].includes(subjectProfileType)) {
    return {
      family: 'still_life_simple',
      reason: 'basic_object_request',
      composition: [
        'mise en scène sobre et élégante',
      ],
      environment: [
        'arrière-plan propre et harmonieux',
      ],
      style: [
        'lumière douce',
      ],
      promptInstructions: [
        'Ajouter une touche artistique simple par la lumière et la composition, sans surcharger la scène.',
      ],
    };
  }

  return null;
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
  const embellishment = buildScratchpadEmbellishment({
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
  }, normalizedMask);

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
    embellishment,
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

  if (universe && subjectProfileType === 'reference_character' && shouldPromoteUniverseInstruction(universe)) {
    instructions.push(`Rester cohérent avec l univers ${universe}.`);
  }

  if (scratchpad?.embellishment && typeof scratchpad.embellishment === 'object') {
    instructions.push(...toUniqueStrings(scratchpad.embellishment.promptInstructions || []));
  }

  return toUniqueStrings(instructions).slice(0, 3);
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
  mask.inputs = mask.inputs && typeof mask.inputs === 'object' ? mask.inputs : {};

  if (entityContext && typeof entityContext === 'object') {
    mask.meta.imageEntityContext = entityContext;
  }

  const nextScratchpad = scratchpad && typeof scratchpad === 'object'
    ? scratchpad
    : buildImageScratchpad(mask, entityContext);

  if (nextScratchpad && typeof nextScratchpad === 'object') {
    mask.meta.imageScratchpad = nextScratchpad;
    if (nextScratchpad.embellishment && typeof nextScratchpad.embellishment === 'object') {
      mask.inputs.composition = toUniqueStrings([
        ...(Array.isArray(mask.inputs.composition) ? mask.inputs.composition : []),
        ...toUniqueStrings(nextScratchpad.embellishment.composition || []),
      ]);
      mask.inputs.environment = toUniqueStrings([
        ...(Array.isArray(mask.inputs.environment) ? mask.inputs.environment : []),
        ...toUniqueStrings(nextScratchpad.embellishment.environment || []),
      ]);
      mask.inputs.style = toUniqueStrings([
        ...(Array.isArray(mask.inputs.style) ? mask.inputs.style : []),
        ...toUniqueStrings(nextScratchpad.embellishment.style || []),
      ]);
    }
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

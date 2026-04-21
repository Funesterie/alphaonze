const {
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  detectPromptLanguageProfile,
  isMultiSubjectSceneRequest,
  normalizeImagePromptLiteral,
  translateImagePromptToEnglish,
} = require('./build-sd-prompt-bundle.cjs');
const { resolveSubjectProfile } = require('./semantic/subject-profile-library.cjs');

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

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function sanitizePositivePromptHint(value = '') {
  const text = normalizeText(value);
  if (!text) return '';

  const lookup = normalizeLookup(text);
  if (!lookup) return '';
  if (/\b(ne pas|pas de|sans|eviter|do not|don t|avoid)\b/.test(lookup)) return '';
  if (/negative prompt/.test(lookup)) return '';

  return text;
}

function normalizePositivePromptHints(values = []) {
  return normalizeList(
    (Array.isArray(values) ? values : [values])
      .map((entry) => sanitizePositivePromptHint(entry))
      .filter(Boolean)
  );
}

function localizeList(values = []) {
  return normalizeList(Array.isArray(values) ? values : [values]);
}

function hasSemanticElementFamily(mask = {}, family = '') {
  const normalizedFamily = normalizeText(family).toLowerCase();
  if (!normalizedFamily) return false;
  const elements = Array.isArray(mask?.meta?.semantic?.elements) ? mask.meta.semantic.elements : [];
  return elements.some((entry) => normalizeText(entry?.family || entry?.key || entry?.label || entry).toLowerCase() === normalizedFamily);
}

function hasAnimateSubjectProfile(mask = {}) {
  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '').toLowerCase();
  return [
    'single_animal',
    'single_human_figure',
    'reference_character',
    'pokemon_creature',
    'phoenix_creature',
    'mythic_creature',
  ].includes(subjectProfileType);
}

function limitWords(value = '', maxWords = 10) {
  const words = normalizeText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, Math.max(1, maxWords)).join(' ');
}

function trimPromptFragment(value = '', maxWords = 10) {
  return limitWords(
    normalizeText(String(value || '')
      .replace(/^(?:sujet principal|environnement|style|composition|lumi[eè]re|couleurs?)\s*:\s*/i, '')
      .replace(/^(?:cr[eé]er une image fid[eè]le [^.]+|composer une sc[eè]ne [^.]+)\.?\s*/i, '')
      .replace(/[.。]+$/g, '')),
    maxWords
  );
}

function takeCompactHints(values = [], options = {}) {
  const {
    maxItems = 3,
    maxWords = 8,
    exclude = [],
  } = options;
  const blocked = exclude.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean);
  const results = [];

  for (const value of normalizeList(values)) {
    const compact = trimPromptFragment(value, maxWords);
    if (!compact) continue;
    const lowered = compact.toLowerCase();
    if (blocked.includes(lowered)) continue;
    if (results.some((entry) => entry.toLowerCase() === lowered)) continue;
    if (results.some((entry) => entry.toLowerCase().includes(lowered) || lowered.includes(entry.toLowerCase()))) {
      continue;
    }
    results.push(compact);
    if (results.length >= maxItems) break;
  }

  return results;
}

function filterConflictingCompositionHints(values = [], options = {}) {
  const { pair = null } = options;
  const entries = normalizeList(values);
  if (pair?.count !== 2) return entries;
  return entries.filter((entry) => !/\b(unique|un seul|sujet unique|personnage unique)\b/i.test(entry));
}

function isSoloCompositionHint(value = '') {
  const entry = normalizeText(value).toLowerCase();
  if (!entry) return false;
  return [
    /sujet unique bien cadr[eé]/i,
    /silhouette lisible/i,
    /forme compl[eè]te visible/i,
    /un seul sujet principal/i,
    /personnage complet et reconnaissable/i,
    /corps entier dans le cadre/i,
    /un seul personnage complet/i,
    /une seule personne compl[eè]te/i,
    /visage unique bien lisible/i,
    /corps complet bien visible/i,
    /cr[eé]ature unique compl[eè]te/i,
    /cr[eé]ature compl[eè]te et lisible/i,
  ].some((pattern) => pattern.test(entry));
}

function filterSceneCompositionHints(values = [], options = {}) {
  const { pair = null, multiSubjectScene = false } = options;
  const entries = filterConflictingCompositionHints(values, { pair });
  if (!multiSubjectScene) return entries;
  return entries.filter((entry) => !isSoloCompositionHint(entry));
}

function joinPromptFragments(values = [], maxChars = 420) {
  const fragments = normalizeList(values);
  if (!fragments.length) return '';

  const kept = [];
  for (const fragment of fragments) {
    const next = kept.length ? `${kept.join(', ')}, ${fragment}` : fragment;
    if (next.length > maxChars) break;
    kept.push(fragment);
  }

  return kept.join(', ');
}

function splitPromptFragments(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function resolvePromptLanguage(mask = {}) {
  const compilerTarget = String(mask?.compiler?.target || '').trim().toLowerCase();
  const deferEnglishLocalization = mask?.meta?.deferEnglishPromptLocalization === true;
  if (deferEnglishLocalization && compilerTarget === 'image-prompt-en') {
    const languageSample = normalizeText([
      mask?.raw,
      ...(Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : []),
      ...(Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : []),
      ...(Array.isArray(mask?.inputs?.style) ? mask.inputs.style : []),
      ...(Array.isArray(mask?.inputs?.composition) ? mask.inputs.composition : []),
      ...(Array.isArray(mask?.inputs?.lighting) ? mask.inputs.lighting : []),
      ...(Array.isArray(mask?.inputs?.palette) ? mask.inputs.palette : []),
    ].filter(Boolean).join(' '));
    const profile = typeof detectPromptLanguageProfile === 'function'
      ? detectPromptLanguageProfile(languageSample)
      : { dominant: 'unknown' };
    return profile?.dominant === 'en' ? 'en' : 'fr';
  }
  return ['image-prompt-en', 'sd-payload'].includes(compilerTarget) ? 'en' : 'fr';
}

function localizePromptFragment(value = '', language = 'fr') {
  return language === 'en'
    ? translateImagePromptToEnglish(value)
    : normalizeText(value);
}

function localizePromptList(values = [], language = 'fr') {
  return normalizeList(Array.isArray(values) ? values : [values])
    .map((entry) => localizePromptFragment(entry, language))
    .filter(Boolean);
}

function resolveImageOptionNumber(value, {
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  fallback = 0,
  integer = false,
} = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = integer ? Math.round(numeric) : numeric;
  return Math.max(min, Math.min(max, normalized));
}

function resolveOptionalSeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(4294967295, Math.round(numeric)));
}

function buildFallbackImagePrompt(mask = {}, language = 'fr') {
  const subjectFallback = normalizeList(mask?.inputs?.subject || [])[0];
  if (subjectFallback) {
    return localizePromptFragment(subjectFallback, language);
  }

  const rawFallback = normalizeImagePromptLiteral(mask?.raw || '');
  if (rawFallback) {
    return localizePromptFragment(rawFallback, language);
  }

  return language === 'en' ? 'coherent detailed scene' : 'scene cohérente détaillée';
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveCanonicalLeadSubject(mask = {}) {
  return normalizeText(
    mask?.meta?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.imageEntityContext?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || ''
  );
}

function resolveCanonicalLeadAliases(mask = {}, canonicalSubject = '') {
  const aliases = normalizeList([
    mask?.inputs?.subject?.[0],
    ...(Array.isArray(mask?.meta?.imageEntityContext?.aliases) ? mask.meta.imageEntityContext.aliases : []),
    canonicalSubject.split(/\s+/).length >= 2 ? canonicalSubject.split(/\s+/).slice(-1)[0] : '',
  ]);
  const canonicalLookup = normalizeLookup(canonicalSubject);
  return aliases.filter((entry) => normalizeLookup(entry) !== canonicalLookup);
}

function promoteCanonicalLeadSubject(lead = '', mask = {}) {
  const cleanedLead = normalizeText(lead);
  if (!cleanedLead) return '';

  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  if (subjectProfileType !== 'reference_character') return cleanedLead;

  const canonicalSubject = resolveCanonicalLeadSubject(mask);
  if (!canonicalSubject) return cleanedLead;
  if (normalizeLookup(cleanedLead).startsWith(normalizeLookup(canonicalSubject))) {
    return cleanedLead;
  }

  for (const alias of resolveCanonicalLeadAliases(mask, canonicalSubject)) {
    const pattern = new RegExp(`^${escapeRegex(alias)}(?=\\b|\\s|,)`, 'i');
    if (pattern.test(cleanedLead)) {
      return normalizeText(cleanedLead.replace(pattern, canonicalSubject));
    }
  }

  return cleanedLead;
}

function hasReferenceInitImage(mask = {}) {
  return Boolean(normalizeText(
    mask?.meta?.reference_image_url
    || mask?.meta?.init_image_url
    || mask?.meta?.webImageDraft?.initImageUrl
    || mask?.meta?.webImageDraft?.initImagePath
    || ''
  ));
}

function hasChatSourceReference(mask = {}) {
  return mask?.meta?.webImageDraft?.fromChatSourceImage === true;
}

function resolveInitImageLeadAnchor(mask = {}) {
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  return (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'single_human_figure'
  )
    ? 'la même personne que sur l image de référence'
    : 'le même sujet que sur l image de référence';
}

function shouldPrefixInitImageLead(lead = '', subject = [], mask = {}) {
  if (!hasReferenceInitImage(mask)) return false;

  const normalizedLead = normalizeLookup(lead);
  if (!normalizedLead) return true;
  if (/\b(meme|same|reference|photo de reference|image de reference|personne de reference|sujet de reference)\b/i.test(normalizedLead)) {
    return false;
  }

  return normalizeList(subject).length === 0;
}

function buildPromptLead(rawPrompt = '', subject = [], mask = {}) {
  const cleanedPrompt = normalizeImagePromptLiteral(rawPrompt);
  const baseLead = cleanedPrompt
    ? promoteCanonicalLeadSubject(cleanedPrompt, mask)
    : normalizeList(subject).join(' et ');

  if (shouldPrefixInitImageLead(baseLead, subject, mask)) {
    return normalizeText(
      [resolveInitImageLeadAnchor(mask), baseLead]
        .filter(Boolean)
        .join(', ')
    );
  }

  return baseLead;
}

function buildCompactDirectives(mask = {}, options = {}) {
  const {
    pair = null,
    single = null,
    subjectProfileType = '',
    multiSubjectScene = false,
  } = options;
  const directives = [];

  if (pair?.count === 2) {
    directives.push('deux sujets distincts et lisibles');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'pokemon_creature'
      || subjectProfileType === 'single_human_figure'
    ) {
      directives.push('deux personnages complets et reconnaissables');
    }
  } else if (single?.count === 1 && !multiSubjectScene) {
    directives.push('un seul sujet principal');
  }

  if (
    !multiSubjectScene
    && !pair?.count
    && (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'pokemon_creature'
    || subjectProfileType === 'single_human_figure'
    )
  ) {
    directives.push('personnage complet et reconnaissable');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      directives.push('corps entier dans le cadre');
    }
  }

  if (
    !multiSubjectScene
    && !pair?.count
    && (
      subjectProfileType === 'single_animal'
      || subjectProfileType === 'mythic_creature'
      || subjectProfileType === 'phoenix_creature'
    )
  ) {
    directives.push('créature complète et lisible');
  }

  if (hasSemanticElementFamily(mask, 'fire') && hasAnimateSubjectProfile(mask)) {
    directives.push('flammes nettes autour du sujet');
  }

  if (mask?.constraints?.no_text === true) {
    directives.push('sans texte lisible');
  }

  return takeCompactHints(directives, { maxItems: 4, maxWords: 6 });
}

function buildPositiveInstructionHints(mask = {}, options = {}) {
  const {
    maxItems = 2,
    maxWords = 14,
    exclude = [],
  } = options;

  const profileInstruction = sanitizePositivePromptHint(mask?.meta?.subjectProfile?.promptInstruction || '');
  const promptInstructions = normalizePositivePromptHints(mask?.meta?.promptInstructions || []);
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const referencePreservationHints = hasReferenceInitImage(mask)
    ? (
        subjectProfileType === 'reference_character'
        || subjectProfileType === 'single_human_figure'
      )
      ? [
          'garder le même visage et la même coiffure',
          'préserver la silhouette et la tenue principale',
        ]
      : [
          'préserver le sujet de référence',
        ]
    : [];

  return takeCompactHints(
    [
      profileInstruction,
      ...referencePreservationHints,
      ...promptInstructions,
    ],
    {
      maxItems,
      maxWords,
      exclude,
    }
  );
}

function buildNegativePrompt(mask = {}) {
  const subject = localizeList(mask?.inputs?.subject || []);
  const environment = localizeList(mask?.inputs?.environment || []);
  const composition = localizeList(mask?.inputs?.composition || []);
  const resolvedSubjectProfile = mask?.meta?.subjectProfile || resolveSubjectProfile({
    subject: subject.join(' '),
    definitionSummary: String(mask?.meta?.definitionLookup?.summary || mask?.meta?.definitionContext?.summary || '').trim(),
    sourceText: String(mask?.raw || '').trim(),
  });
  const subjectProfileType = normalizeText(resolvedSubjectProfile?.type || '');
  const rawPrompt = normalizeText(mask?.raw || '');
  const pair = rawPrompt ? compileCharacterCountConstraints(rawPrompt) : null;
  const single = pair ? null : (rawPrompt ? compileSingleSubjectConstraints(rawPrompt) : null);
  const multiSubjectScene = Boolean(pair?.count >= 2) || isMultiSubjectSceneRequest(rawPrompt);
  const hints = [];

  if (mask?.constraints?.no_text === true) {
    hints.push('texte lisible', 'watermark', 'logo', 'signature');
  }

  if (hasReferenceInitImage(mask)) {
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      hints.push('autre personne', 'visage différent', 'identité différente');
    } else {
      hints.push('sujet différent');
    }
  }

  if (hasChatSourceReference(mask)) {
    hints.push(
      'texte incrusté',
      'date incrustée',
      'capture d écran',
      'interface mobile',
      'barre de statut',
      'icônes de téléphone',
      'cadre de smartphone'
    );
  }

  if (pair?.count === 2) {
    hints.push('troisième sujet', 'personnage supplémentaire', 'foule');
    if (Array.isArray(pair?.negativeHints)) {
      hints.push(...pair.negativeHints);
    }
  } else if (!multiSubjectScene && (single?.count === 1 || subject.length <= 1)) {
    hints.push('plusieurs sujets', 'doublon du sujet', 'foule');
  }

  if (
    !multiSubjectScene
    && (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'pokemon_creature'
    || subjectProfileType === 'single_human_figure'
    )
  ) {
    hints.push('visages dupliqués', 'personnage coupé');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      hints.push('hors cadre', 'gros plan', 'plan poitrine');
    }
  }

  if (
    !multiSubjectScene
    && (
      subjectProfileType === 'single_animal'
      || subjectProfileType === 'mythic_creature'
      || subjectProfileType === 'phoenix_creature'
    )
  ) {
    hints.push('créatures multiples', 'anatomie fusionnée');
  }

  if (subjectProfileType === 'phoenix_creature') {
    hints.push('plusieurs têtes', 'ailes supplémentaires', 'forme de fleur', 'plante');
  }

  if (subjectProfileType === 'simple_food_object' || subjectProfileType === 'container_object') {
    hints.push('objets multiples', 'décor encombré', 'arrière-plan chargé');
  }

  if (subjectProfileType === 'single_plant_object') {
    hints.push('plusieurs plantes', 'forêt dense', 'arrière-plan chargé');
  }

  const mergedSceneHints = [...environment, ...composition].join(' ');
  if (/(fond neutre simple|fond simple|décor simple|objet centré|sujet centré)/i.test(mergedSceneHints)) {
    hints.push('arrière-plan chargé', 'décor encombré');
  }
  if (
    !multiSubjectScene
    && /(forme complète visible|corps complet|sujet unique bien cadré|silhouette lisible|sujet centré|objet centré)/i.test(mergedSceneHints)
  ) {
    hints.push('sujet coupé', 'hors cadre');
  }

  const extraNegativeHints = normalizeList([
    ...(Array.isArray(mask?.meta?.promptNegativeHints) ? mask.meta.promptNegativeHints : []),
    ...(Array.isArray(mask?.meta?.negativeHints) ? mask.meta.negativeHints : []),
    ...splitPromptFragments(mask?.meta?.negative_prompt || mask?.meta?.negativePrompt || ''),
  ]);

  const finalHints = normalizeList([...hints, ...extraNegativeHints]).slice(0, 12);
  return finalHints.length ? finalHints.join(', ') : '';
}

function compileMaskToImagePrompt(mask = {}) {
  const promptLanguage = resolvePromptLanguage(mask);
  const rawPrompt = normalizeText(mask?.raw || '');
  const subject = localizeList(mask?.inputs?.subject || []);
  const environment = localizeList(mask?.inputs?.environment || []);
  const style = localizeList(mask?.inputs?.style || []);
  const composition = localizeList(mask?.inputs?.composition || []);
  const lighting = localizeList(mask?.inputs?.lighting || []);
  const palette = localizeList(mask?.inputs?.palette || []);
  const pair = rawPrompt ? compileCharacterCountConstraints(rawPrompt) : null;
  const single = pair ? null : (rawPrompt ? compileSingleSubjectConstraints(rawPrompt) : null);
  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  const multiSubjectScene = Boolean(pair?.count >= 2) || isMultiSubjectSceneRequest(rawPrompt);

  const promptLead = buildPromptLead(rawPrompt, subject, mask);
  const styleHints = takeCompactHints(style, { maxItems: 2, maxWords: 6 });
  const environmentHints = takeCompactHints(environment, { maxItems: 1, maxWords: 8 });
  const compositionHints = takeCompactHints(filterSceneCompositionHints(composition, { pair, multiSubjectScene }), {
    maxItems: 3,
    maxWords: 6,
  });
  const lightingHints = takeCompactHints(lighting, { maxItems: 1, maxWords: 5 });
  const paletteHints = palette.length ? [`couleurs ${palette.slice(0, 3).join(', ')}`] : [];
  const directives = buildCompactDirectives(mask, {
    pair,
    single,
    subjectProfileType,
    multiSubjectScene,
  });
  const instructionHints = buildPositiveInstructionHints(mask, {
    maxItems: 2,
    maxWords: 14,
    exclude: [
      promptLead,
      ...styleHints,
      ...environmentHints,
      ...compositionHints,
      ...lightingHints,
      ...paletteHints,
      ...directives,
    ],
  });

  const prompt = joinPromptFragments(localizePromptList([
    promptLead,
    ...instructionHints,
    ...styleHints,
    ...environmentHints,
    ...compositionHints,
    ...lightingHints,
    ...paletteHints,
    ...directives,
  ], promptLanguage)) || buildFallbackImagePrompt(mask, promptLanguage);
  const negativePrompt = localizePromptList(
    splitPromptFragments(buildNegativePrompt(mask)),
    promptLanguage
  ).join(', ');
  const width = resolveImageOptionNumber(mask?.options?.width, {
    min: 64,
    max: 4096,
    fallback: 768,
    integer: true,
  });
  const height = resolveImageOptionNumber(mask?.options?.height, {
    min: 64,
    max: 4096,
    fallback: 768,
    integer: true,
  });
  const numInferenceSteps = resolveImageOptionNumber(mask?.options?.steps, {
    min: 1,
    max: 150,
    fallback: 40,
    integer: true,
  });
  const guidanceScale = resolveImageOptionNumber(mask?.options?.guidance_scale, {
    min: 0,
    max: 30,
    fallback: 8,
  });
  const seed = resolveOptionalSeed(mask?.options?.seed);

  return {
    prompt,
    prompt_language: promptLanguage,
    prompt_prebuilt: true,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    width,
    height,
    num_inference_steps: numInferenceSteps,
    guidance_scale: guidanceScale,
    ...(seed !== undefined ? { seed } : {}),
  };
}

module.exports = compileMaskToImagePrompt;

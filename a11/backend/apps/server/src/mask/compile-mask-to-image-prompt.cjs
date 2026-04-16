const {
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  normalizeImagePromptLiteral,
} = require('./build-sd-prompt-bundle.cjs');
const { resolveSubjectProfile } = require('./semantic/subject-profile-library.cjs');

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
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

function buildPromptLead(rawPrompt = '', subject = []) {
  const cleanedPrompt = normalizeImagePromptLiteral(rawPrompt);
  if (cleanedPrompt) return cleanedPrompt;
  return normalizeList(subject).join(' et ');
}

function buildCompactDirectives(mask = {}, options = {}) {
  const {
    pair = null,
    single = null,
    subjectProfileType = '',
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
  } else if (single?.count === 1) {
    directives.push('un seul sujet principal');
  }

  if (
    !pair?.count
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
    subjectProfileType === 'single_animal'
    || subjectProfileType === 'mythic_creature'
    || subjectProfileType === 'phoenix_creature'
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
  const hints = [];

  if (mask?.constraints?.no_text === true) {
    hints.push('texte lisible', 'watermark', 'logo', 'signature');
  }

  if (pair?.count === 2) {
    hints.push('troisième sujet', 'personnage supplémentaire', 'foule');
    if (Array.isArray(pair?.negativeHints)) {
      hints.push(...pair.negativeHints);
    }
  } else if (single?.count === 1 || subject.length <= 1) {
    hints.push('plusieurs sujets', 'doublon du sujet', 'foule');
  }

  if (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'pokemon_creature'
    || subjectProfileType === 'single_human_figure'
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
    subjectProfileType === 'single_animal'
    || subjectProfileType === 'mythic_creature'
    || subjectProfileType === 'phoenix_creature'
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
  if (/(forme complète visible|corps complet|sujet unique bien cadré|silhouette lisible|sujet centré|objet centré)/i.test(mergedSceneHints)) {
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

  const promptLead = buildPromptLead(rawPrompt, subject);
  const styleHints = takeCompactHints(style, { maxItems: 2, maxWords: 6 });
  const environmentHints = takeCompactHints(environment, { maxItems: 1, maxWords: 8 });
  const compositionHints = takeCompactHints(filterConflictingCompositionHints(composition, { pair }), {
    maxItems: 3,
    maxWords: 6,
  });
  const lightingHints = takeCompactHints(lighting, { maxItems: 1, maxWords: 5 });
  const paletteHints = palette.length ? [`couleurs ${palette.slice(0, 3).join(', ')}`] : [];
  const directives = buildCompactDirectives(mask, {
    pair,
    single,
    subjectProfileType,
  });

  const prompt = joinPromptFragments([
    promptLead,
    ...styleHints,
    ...environmentHints,
    ...compositionHints,
    ...lightingHints,
    ...paletteHints,
    ...directives,
  ]);
  const negativePrompt = buildNegativePrompt(mask);

  return {
    prompt,
    prompt_language: 'fr',
    prompt_prebuilt: true,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    width: Number(mask?.options?.width || 768),
    height: Number(mask?.options?.height || 768),
    num_inference_steps: Number(mask?.options?.steps || 40),
    guidance_scale: Number(mask?.options?.guidance_scale || 8),
    ...(mask?.options?.seed !== undefined ? { seed: Number(mask.options.seed) } : {}),
  };
}

module.exports = compileMaskToImagePrompt;

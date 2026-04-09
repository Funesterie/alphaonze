const {
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
} = require('./build-sd-prompt-bundle.cjs');
const { resolveSubjectProfile } = require('./semantic/subject-profile-library.cjs');

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function localizeList(values = []) {
  return normalizeList(Array.isArray(values) ? values : [values]);
}

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function joinPromptSections(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((entry) => normalizeText(String(entry || '').replace(/[.。\s]+$/g, '')))
    .filter(Boolean)
    .join('. ');
}

function joinSection(label, values = []) {
  const entries = normalizeList(values);
  if (!entries.length) return '';
  return `${label} : ${entries.join(', ')}`;
}

function buildLiteralInstructions(mask = {}) {
  const instructions = [
    'Créer une image fidèle à la demande.',
    'Composer une scène claire, lisible et naturelle autour du sujet principal.',
  ];
  const subjectProfileInstruction = normalizeText(mask?.meta?.subjectProfile?.promptInstruction || '');
  const extraPromptInstructions = normalizeList(mask?.meta?.promptInstructions || []);

  if (Array.isArray(mask?.inputs?.palette) && mask.inputs.palette.length > 0) {
    instructions.push("Utiliser les couleurs demandées sur le sujet principal.");
  }

  if (subjectProfileInstruction) {
    instructions.push(subjectProfileInstruction);
  }

  if (extraPromptInstructions.length) {
    instructions.push(...extraPromptInstructions);
  }

  if (mask?.constraints?.no_text === true) {
    instructions.push("Garder l'image visuelle, sans texte lisible.");
  }

  return instructions.join(' ');
}

function splitPromptFragments(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
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
  } else if (single?.count === 1 || subject.length <= 1) {
    hints.push('plusieurs sujets', 'doublon du sujet', 'foule');
  }

  if (subjectProfileType === 'reference_character' || subjectProfileType === 'pokemon_creature') {
    hints.push('plusieurs personnages', 'visages dupliqués', 'personnage coupé');
  }

  if (
    subjectProfileType === 'single_animal'
    || subjectProfileType === 'mythic_creature'
    || subjectProfileType === 'phoenix_creature'
  ) {
    hints.push('animaux multiples', 'créatures multiples', 'anatomie fusionnée');
  }

  if (subjectProfileType === 'simple_food_object' || subjectProfileType === 'container_object') {
    hints.push('objets multiples', 'décor encombré', 'arrière-plan chargé');
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

  const finalHints = normalizeList([...hints, ...extraNegativeHints]);
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
  const definitionContext = normalizeText(
    mask?.meta?.definitionLookup?.summary
    || mask?.meta?.definitionContext?.summary
    || ''
  );

  const promptSections = [
    rawPrompt ? `Demande : ${rawPrompt}` : '',
    joinSection('Sujet principal', subject),
    joinSection('Environnement', environment),
    joinSection('Style', style),
    joinSection('Composition', composition),
    joinSection('Lumière', lighting),
    joinSection('Couleurs', palette),
    definitionContext ? `Contexte utile : ${definitionContext}` : '',
    buildLiteralInstructions(mask),
  ].filter(Boolean);

  const negativePrompt = buildNegativePrompt(mask);

  return {
    prompt: joinPromptSections(promptSections),
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

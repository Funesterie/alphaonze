function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXACT_FRENCH_EQUIVALENTS = new Map([
  ['high quality', 'haute qualité'],
  ['detailed', 'détaillé'],
  ['anime illustration', 'illustration anime'],
  ['manga art', 'style manga'],
  ['clean linework', 'traits nets'],
  ['cel shading', 'cel shading'],
  ['fantasy illustration', 'illustration fantastique'],
  ['cinematic lighting', 'lumière cinématographique'],
  ['photorealistic', 'photoréaliste'],
  ['natural textures', 'textures naturelles'],
  ['single main subject', 'un seul sujet principal'],
  ['solo subject', 'sujet seul'],
  ['one subject only', 'un seul sujet'],
  ['clear centered composition', 'composition centrée claire'],
  ['clear subject focus', 'sujet principal bien mis en avant'],
  ['portrait framing', 'cadrage portrait'],
  ['single character focus', 'focus sur un seul personnage'],
  ['clear riding pose', 'pose de conduite lisible'],
  ['single bicycle', 'un seul vélo'],
  ['clear action pose', "pose d'action lisible"],
  ['simple clean background', 'fond simple et propre'],
  ['two distinct subjects', 'deux sujets distincts'],
  ['balanced two-subject composition', 'composition équilibrée à deux sujets'],
  ['solo composition', 'composition solo'],
  ['single isolated subject', 'sujet isolé'],
  ['clean non-repeated composition', 'composition nette sans répétition'],
  ['no duplicate instances', 'pas de doublons'],
  ['one instance only', 'un seul exemplaire'],
]);

const TOKEN_FRENCH_EQUIVALENTS = new Map([
  ['pink', 'rose'],
  ['purple', 'violet'],
  ['green', 'vert'],
  ['blue', 'bleu'],
  ['red', 'rouge'],
  ['yellow', 'jaune'],
  ['orange', 'orange'],
  ['white', 'blanc'],
  ['black', 'noir'],
  ['brown', 'marron'],
  ['gray', 'gris'],
  ['grey', 'gris'],
  ['gold', 'or'],
  ['golden', 'doré'],
  ['silver', 'argent'],
  ['hedgehog', 'hérisson'],
  ['hedgehogs', 'hérissons'],
  ['rabbit', 'lapin'],
  ['rabbits', 'lapins'],
  ['cat', 'chat'],
  ['cats', 'chats'],
  ['dog', 'chien'],
  ['dogs', 'chiens'],
  ['fox', 'renard'],
  ['foxes', 'renards'],
  ['bear', 'ours'],
  ['bears', 'ours'],
  ['grizzly bear', 'ours grizzli'],
  ['grizzly bears', 'ours grizzlis'],
  ['unicorn', 'licorne'],
  ['unicorns', 'licornes'],
  ['bicycle', 'vélo'],
  ['cyclist', 'cycliste'],
  ['character', 'personnage'],
  ['characters', 'personnages'],
  ['hero', 'heros'],
  ['heroes', 'heros'],
  ['princess', 'princesse'],
  ['princesses', 'princesses'],
  ['magician hat', 'chapeau de magicien'],
  ['wizard hat', 'chapeau de sorcier'],
  ['forest', 'forêt'],
  ['river', 'rivière'],
  ['mountain', 'montagne'],
  ['mountains', 'montagnes'],
  ['sky', 'ciel'],
  ['moon', 'lune'],
  ['cloud', 'nuage'],
  ['clouds', 'nuages'],
  ['star', 'étoile'],
  ['stars', 'étoiles'],
]);

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localizeFrenchEntry(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';

  const exact = EXACT_FRENCH_EQUIVALENTS.get(normalizeLookup(raw));
  if (exact) return exact;

  let out = raw;
  const replacements = [...TOKEN_FRENCH_EQUIVALENTS.entries()]
    .sort((left, right) => right[0].length - left[0].length);

  for (const [token, replacement] of replacements) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), replacement);
  }

  return normalizeText(out);
}

function localizeList(values = []) {
  return normalizeList((Array.isArray(values) ? values : [values]).map(localizeFrenchEntry));
}

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function joinSection(label, values = []) {
  const entries = normalizeList(values);
  if (!entries.length) return '';
  return `${label} : ${entries.join(', ')}`;
}

function mentionsExplicitFloralElements(mask = {}) {
  const haystack = normalizeText([
    mask?.raw || '',
    ...(Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : []),
    ...(Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : []),
  ].join(' ')).toLowerCase();

  return /\b(fleur|fleurs|bouquet|p[eé]tale|p[eé]tales|floral|rose petals?|flowers?|petals?)\b/.test(haystack);
}

function buildLiteralInstructions(mask = {}) {
  const instructions = [
    'Interprétation littérale de la demande.',
    'Respecter exactement le sujet principal, les couleurs, le style et la composition demandés.',
    'Garder une scène simple, cohérente et lisible.',
    "Ne pas ajouter d'accessoires, d'objets, de décorations ou de personnages supplémentaires non demandés.",
  ];

  if (Array.isArray(mask?.inputs?.palette) && mask.inputs.palette.length > 0) {
    instructions.push("Les couleurs demandées s'appliquent au sujet principal lui-même, pas au fond ni aux éléments secondaires.");
  }

  if (mask?.constraints?.no_text === true) {
    instructions.push('Ne pas générer de texte lisible, de lettres, de logo, de signature ni de watermark.');
  }

  return instructions.join(' ');
}

function buildFrenchNegativePrompt(mask = {}) {
  const negativeHints = [
    'flou',
    'abstrait',
    'difforme',
    'mauvaise anatomie',
    'basse qualité',
    'collage',
    'motif répété',
    'papier peint',
    'fond encombré',
    'accessoires aléatoires',
    'texte',
    'lettres',
    'watermark',
    'signature',
    'logo',
  ];

  if (!mentionsExplicitFloralElements(mask)) {
    negativeHints.push(
      'fleurs',
      'bouquet',
      'fond floral',
      'motif floral',
      'objets décoratifs au premier plan'
    );
  }

  if (mask?.constraints?.no_text === true) {
    negativeHints.push('texte lisible');
  }

  const normalizedComposition = normalizeList(mask?.inputs?.composition || []).join(' ').toLowerCase();
  const explicitMultiSubject = /\b(deux|trois|plusieurs|groupe|duo|pair|multiple|crowd|group)\b/.test(normalizedComposition);
  if (!explicitMultiSubject) {
    negativeHints.push(
      'plusieurs sujets',
      'deuxième sujet',
      'foule',
      'prise de groupe',
      'anatomie fusionnée',
      'membres fusionnés'
    );
  }

  return normalizeList(negativeHints).join(', ');
}

function compileMaskToImagePrompt(mask = {}) {
  const rawPrompt = normalizeText(mask?.raw || '');
  const subject = localizeList(mask?.inputs?.subject || []);
  const environment = localizeList(mask?.inputs?.environment || []);
  const style = localizeList(mask?.inputs?.style || []);
  const composition = localizeList(mask?.inputs?.composition || []);
  const lighting = localizeList(mask?.inputs?.lighting || []);
  const palette = localizeList(mask?.inputs?.palette || []);

  const promptSections = [
    rawPrompt ? `Demande utilisateur : ${rawPrompt}` : '',
    joinSection('Sujet principal', subject),
    joinSection('Environnement', environment),
    joinSection('Style', style),
    joinSection('Composition', composition),
    joinSection('Lumière', lighting),
    joinSection('Palette', palette),
    buildLiteralInstructions(mask),
  ].filter(Boolean);

  return {
    prompt: promptSections.join('. '),
    negative_prompt: buildFrenchNegativePrompt(mask),
    prompt_language: 'fr',
    prompt_prebuilt: true,
    negative_prompt_prebuilt: true,
    width: Number(mask?.options?.width || 768),
    height: Number(mask?.options?.height || 768),
    num_inference_steps: Number(mask?.options?.steps || 40),
    guidance_scale: Number(mask?.options?.guidance_scale || 8),
    ...(mask?.options?.seed !== undefined ? { seed: Number(mask.options.seed) } : {}),
  };
}

module.exports = compileMaskToImagePrompt;

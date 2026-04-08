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
  ['no duplicate instances', 'sujet unique bien distinct'],
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
  ['soda can', 'canette de soda'],
  ['soft drink can', 'canette de boisson gazeuse'],
  ['aluminum can', 'canette en aluminium'],
  ['aluminium can', 'canette en aluminium'],
  ['soda', 'soda'],
  ['cola', 'cola'],
  ['canette', 'canette'],
  ['canettes', 'canettes'],
  ['boisson gazeuse', 'boisson gazeuse'],
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

function buildSubjectSpecificInstructions(mask = {}) {
  const source = normalizeLookup([
    mask?.raw || '',
    ...(Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : []),
    ...(Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : []),
    ...(Array.isArray(mask?.inputs?.style) ? mask.inputs.style : []),
  ].join(' '));
  const instructions = [];

  if (/\b(canette|soda|cola|boisson gazeuse)\b/.test(source)) {
    instructions.push("Le sujet est une canette métallique en aluminium, au format standard d'une boisson gazeuse.");
    instructions.push('La silhouette cylindrique de la canette reste nette, simple et immédiatement reconnaissable.');
  }

  if (/\b(pokemon|pokémon)\b/.test(source)) {
    instructions.push('La créature garde une silhouette claire, lisible et cohérente, dans un style inspiré des monsters de jeu vidéo.');
  }

  if (/\bdragon\b/.test(source) && /\b(feu|flamme|flammes|fire)\b/.test(source)) {
    instructions.push('Le corps, les ailes et les flammes restent bien distincts avec des contours séparés et lisibles.');
  }

  return instructions;
}

function buildLiteralInstructions(mask = {}) {
  const instructions = [
    'Interprétation littérale de la demande.',
    'Respecter exactement le sujet principal, les couleurs, le style et la composition demandés.',
    'Composer une scène simple, cohérente et lisible.',
    'Inclure uniquement les éléments explicitement demandés.',
    ...buildSubjectSpecificInstructions(mask),
  ];

  if (Array.isArray(mask?.inputs?.palette) && mask.inputs.palette.length > 0) {
    instructions.push("Les couleurs demandées s'appliquent d'abord au sujet principal. Le fond et les éléments secondaires restent sobres et cohérents.");
  }

  if (mask?.constraints?.no_text === true) {
    instructions.push("Image purement visuelle, sans texte lisible, sans logo, sans signature et sans watermark.");
  }

  return instructions.join(' ');
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
    prompt_language: 'fr',
    prompt_prebuilt: true,
    width: Number(mask?.options?.width || 768),
    height: Number(mask?.options?.height || 768),
    num_inference_steps: Number(mask?.options?.steps || 40),
    guidance_scale: Number(mask?.options?.guidance_scale || 8),
    ...(mask?.options?.seed !== undefined ? { seed: Number(mask.options.seed) } : {}),
  };
}

module.exports = compileMaskToImagePrompt;

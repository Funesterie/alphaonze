const { bindSemanticAtoms } = require('./bind-semantic-atoms.cjs');

const COLOR_WORD_MAP = new Map([
  ['rouge', 'rouge'],
  ['rouges', 'rouge'],
  ['bleu', 'bleu'],
  ['bleue', 'bleu'],
  ['bleus', 'bleu'],
  ['bleues', 'bleu'],
  ['vert', 'vert'],
  ['verte', 'vert'],
  ['verts', 'vert'],
  ['vertes', 'vert'],
  ['jaune', 'jaune'],
  ['jaunes', 'jaune'],
  ['violet', 'violet'],
  ['violette', 'violet'],
  ['violets', 'violet'],
  ['violettes', 'violet'],
  ['orange', 'orange'],
  ['oranges', 'orange'],
  ['rose', 'rose'],
  ['roses', 'rose'],
  ['blanc', 'blanc'],
  ['blanche', 'blanc'],
  ['blancs', 'blanc'],
  ['blanches', 'blanc'],
  ['noir', 'noir'],
  ['noire', 'noir'],
  ['noirs', 'noir'],
  ['noires', 'noir'],
  ['marron', 'marron'],
  ['marrons', 'marron'],
  ['gris', 'gris'],
  ['grise', 'gris'],
  ['grises', 'gris'],
  ['doré', 'doré'],
  ['dorée', 'doré'],
  ['dorés', 'doré'],
  ['dorées', 'doré'],
  ['argent', 'argent'],
  ['argenté', 'argenté'],
  ['argentée', 'argenté'],
  ['argentés', 'argenté'],
  ['argentées', 'argenté'],
]);

const CHARACTER_REFERENCE_WORDS = new Set([
  'batman',
  'robin',
  'mario',
  'zelda',
  'donkey kong',
  'pikachu',
  'vegeta',
  'pokemon',
  'personnage',
  'princesse',
  'hero',
  'héros',
]);

const NAMED_GROUP_REFERENCE_PATTERNS = [
  /\bavengers\b/,
  /\bx[\s-]?men\b/,
  /\bjustice league\b/,
  /\bguardians? of the galaxy\b/,
  /\bfantastic four\b/,
  /\bteen titans\b/,
  /\bsuicide squad\b/,
  /\bpower rangers\b/,
  /\bstraw hat pirates\b/,
  /\bchapeau(?:x)? de paille\b/,
  /\bmugiwaras?\b/,
  /\béquipage\b/,
  /\bequipage\b/,
];

function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinPromptSections(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map((entry) => normalizeWhitespace(String(entry || '').replace(/[.。\s]+$/g, '')))
    .filter(Boolean)
    .join('. ');
}

function normalizeIntentText(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripImageGenerationCommandPrefix(value = '') {
  return String(value || '')
    .replace(/^(?:(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+)+(?:que\s+tu\s+)?(?:me\s+)?/i, '')
    .replace(/^que\s+tu\s+/i, '')
    .replace(/^(?:peux[- ]?tu\s+)?(?:s(?:tp|il te plait|’il te plait|il te plaît)\s+)?/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|generate(?:d)?|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche)\s+(?:moi\s+)?/i, '')
    .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait)\s+(?:de|du|de la|de l['’]?|d(?:['’]|\s+))?\s*/i, '')
    .trim();
}

function normalizeImagePromptLiteral(value = '') {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  return stripImageGenerationCommandPrefix(raw) || raw;
}

function extractPalette(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  if (!normalized) return [];

  const palette = [];
  for (const [variant, canonical] of COLOR_WORD_MAP.entries()) {
    const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i');
    if (pattern.test(normalized)) palette.push(canonical);
  }
  return [...new Set(palette)];
}

function stripPaletteSuffixFromSubject(value = '', palette = []) {
  const tokens = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return normalizeWhitespace(value);

  const paletteSet = new Set(
    (Array.isArray(palette) ? palette : [])
      .map((entry) => normalizeIntentText(entry))
      .filter(Boolean)
  );

  while (tokens.length > 1 && paletteSet.has(normalizeIntentText(tokens[tokens.length - 1]))) {
    tokens.pop();
  }

  return normalizeWhitespace(tokens.join(' ')) || normalizeWhitespace(value);
}

function trimSubjectPhrase(value = '', palette = []) {
  const subject = normalizeWhitespace(String(value || '')
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d(?:['’]|\s+)un|d(?:['’]|\s+)une|d['’]?|le|la|les)\s+/i, '')
    .replace(/\b(?:qui|avec|dans|sur|au milieu de|au bord de|sous|portant|tenant|sortant|sorti|sortie|en)\b.*$/i, '')
    .replace(/\b(?:style|cartoon|anime|ghibli|photo|photorealiste|photoréaliste|realiste|réaliste|fantasy)\b.*$/i, '')
    .trim());

  return stripPaletteSuffixFromSubject(subject, palette);
}

function isPluralRequested(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  return (
    /\b(des|plusieurs|many|multiple|crowd|group|groupe|ensemble)\b/.test(normalized)
    || NAMED_GROUP_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function isMultiSubjectSceneRequest(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  if (!normalized) return false;
  return (
    isPluralRequested(prompt)
    || /\b(crew|team|squad|party|band|bande|troupe|alliance|league)\b/.test(normalized)
    || /\b(scene de groupe|composition de groupe|scene multi|multi personnages|multi personnage|multi character|multi characters)\b/.test(normalized)
    || /\b(groupe|equipage|équipage)\b/.test(normalized)
    || /\b(personnages|characters)\b/.test(normalized)
  );
}

function isSubjectPhraseMeaningful(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  if (normalized.split(/\s+/).length > 8) return false;
  if (COLOR_WORD_MAP.has(normalized)) return false;
  if (/^(image|illustration|dessin|photo|visuel|portrait|style)$/.test(normalized)) return false;
  return true;
}

function looksLikeCharacterSubject(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  for (const entry of CHARACTER_REFERENCE_WORDS) {
    if (normalized.includes(normalizeIntentText(entry))) return true;
  }
  return false;
}

function trimRelationalSubjectPhrase(value = '', palette = []) {
  const subject = normalizeWhitespace(String(value || ''))
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d(?:['’]|\s+)un|d(?:['’]|\s+)une|d['’]?|le|la|les)\s+/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim();

  return stripPaletteSuffixFromSubject(subject, palette);
}

function extractRelationalPairConstraints(basePrompt = '', palette = []) {
  const relationMatch = String(basePrompt || '').match(
    /^(.+?)\s+\bavec\s+((?:un|une|des)\s+(?:patient|patiente|ennemi|ennemie|ennemie|enemy|adversaire|compagnon|compagnonne|companion|ami|amie|friend|monstre|monster|creature|créature|pokemon|pokémon|dragon|robot|zombie|squelette|skeletrex)\b[^,.!?;:]*)$/i
  );
  if (!relationMatch) return null;

  const firstSubject = trimRelationalSubjectPhrase(relationMatch[1], palette);
  const secondSubject = trimRelationalSubjectPhrase(relationMatch[2], palette);
  if (!isSubjectPhraseMeaningful(firstSubject) || !isSubjectPhraseMeaningful(secondSubject)) return null;

  const kind = [firstSubject, secondSubject].some(looksLikeCharacterSubject) ? 'characters' : 'subjects';
  return {
    count: 2,
    kind,
    relation: 'with',
    subjects: [firstSubject, secondSubject],
    promptHints: [
      `Montrer clairement ${firstSubject} avec ${secondSubject}.`,
      `Deux ${kind === 'characters' ? 'personnages' : 'sujets'} distincts et lisibles.`,
      'Exactement deux personnages, une seule occurrence de chaque personnage.',
      'Éviter de dupliquer le premier sujet à la place du second.',
    ],
    negativeHints: ['clone du premier sujet', 'dupliquer le premier personnage', 'collage', 'montage', 'mosaïque de personnages'],
  };
}

function translateImagePromptToEnglish(value = '') {
  return normalizeImagePromptLiteral(value);
}

function compileCharacterCountConstraints(rawPrompt = '') {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  if (!basePrompt || isPluralRequested(basePrompt)) return null;

  const palette = extractPalette(basePrompt);
  const relationalPair = extractRelationalPairConstraints(basePrompt, palette);
  if (relationalPair) return relationalPair;

  const pairParts = basePrompt
    .split(/\b(?:et|and|&)\b/i)
    .map((entry) => trimSubjectPhrase(entry, palette))
    .filter(Boolean);

  if (pairParts.length !== 2 || !pairParts.every(isSubjectPhraseMeaningful)) return null;

  const kind = pairParts.some(looksLikeCharacterSubject) ? 'characters' : 'subjects';
  return {
    count: 2,
    kind,
    subjects: pairParts,
    promptHints: [
      `Montrer clairement ${pairParts[0]} et ${pairParts[1]}.`,
      `Deux ${kind === 'characters' ? 'personnages' : 'sujets'} distincts et lisibles.`,
      'Exactement deux personnages, une seule occurrence de chaque personnage.',
    ],
    negativeHints: ['clone du premier sujet', 'dupliquer le premier personnage', 'collage', 'montage', 'mosaïque de personnages'],
  };
}

function compileSingleSubjectConstraints(rawPrompt = '') {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  if (!basePrompt || isMultiSubjectSceneRequest(basePrompt)) return null;
  if (compileCharacterCountConstraints(basePrompt)) return null;

  const palette = extractPalette(basePrompt);
  const subject = trimSubjectPhrase(basePrompt, palette);
  if (!isSubjectPhraseMeaningful(subject)) return null;

  return {
    count: 1,
    subject,
    promptHints: [
      `Sujet principal : ${subject}.`,
      'Un seul sujet principal bien visible.',
    ],
    negativeHints: [],
  };
}

function buildPositiveInstructions({ palette = [], pair = null, single = null } = {}) {
  const instructions = [
    'Créer une image fidèle à la demande.',
    'Garder une scène simple, lisible et naturelle.',
  ];

  if (pair?.count === 2) {
    instructions.push('Montrer clairement les deux sujets demandés.');
    instructions.push('Garder exactement deux personnages, un seul exemplaire de chaque personnage.');
  } else if (single?.count === 1) {
    instructions.push('Mettre en avant un seul sujet principal bien visible.');
  }

  if (Array.isArray(palette) && palette.length > 0) {
    instructions.push('Utiliser les couleurs demandées sur le sujet principal.');
  }

  return instructions;
}

function analyzeImagePrompt(rawPrompt = '', options = {}) {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  const pair = compileCharacterCountConstraints(basePrompt);
  const single = pair ? null : compileSingleSubjectConstraints(basePrompt);
  const palette = extractPalette(basePrompt);
  const subjectText = pair?.subjects?.join(' et ')
    || single?.subject
    || trimSubjectPhrase(basePrompt, palette)
    || basePrompt;

  return {
    basePrompt,
    ambiguity: null,
    subjectText,
    subjectPromptEnglish: subjectText,
    palette,
    styleHints: [],
    compositionHints: [],
    characterCountConstraints: pair,
    singleSubjectConstraints: single,
    floralRequested: false,
    pluralRequested: isPluralRequested(basePrompt),
    semanticBinding: {
      promptLead: subjectText,
      relationAtoms: [],
      styleAtoms: [],
      structuralAtoms: [],
    },
    options,
  };
}

function buildSdPromptBundle(rawPrompt = '', options = {}) {
  const details = analyzeImagePrompt(rawPrompt, options);
  const instructions = buildPositiveInstructions({
    palette: details.palette,
    pair: details.characterCountConstraints,
    single: details.singleSubjectConstraints,
  });

  const promptSections = [
    details.basePrompt ? `Demande : ${details.basePrompt}` : '',
    details.subjectText ? `Sujet principal : ${details.subjectText}` : '',
    details.palette.length ? `Couleurs : ${details.palette.join(', ')}` : '',
    ...instructions,
  ].filter(Boolean);

  return {
    prompt: joinPromptSections(promptSections),
    ambiguity: null,
    negativeHints: [],
    details,
  };
}

function detectImagePromptAmbiguity() {
  return null;
}

module.exports = {
  normalizeImagePromptLiteral,
  detectImagePromptAmbiguity,
  analyzeImagePrompt,
  buildSdPromptBundle,
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  isMultiSubjectSceneRequest,
  translateImagePromptToEnglish,
  bindSemanticAtoms,
};

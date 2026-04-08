const {
  bindSemanticCompoundsRaw,
  bindSemanticCompoundsEnglish,
  bindSemanticAtoms,
  SCENE_RELATION_TRANSLATION_PATTERNS,
  stripEnglishSubjectWrappers,
  uniqueSemanticStrings,
} = require('./bind-semantic-atoms.cjs');

const IMAGE_COLOR_AMBIGUITY_WORDS = new Set([
  'rose',
  'orange',
  'violet',
  'marron',
]);

const COLOR_WORD_MAP = new Map([
  ['rouge', 'red'],
  ['red', 'red'],
  ['bleu', 'blue'],
  ['bleue', 'blue'],
  ['blue', 'blue'],
  ['vert', 'green'],
  ['verte', 'green'],
  ['green', 'green'],
  ['jaune', 'yellow'],
  ['yellow', 'yellow'],
  ['violet', 'purple'],
  ['violette', 'purple'],
  ['purple', 'purple'],
  ['orange', 'orange'],
  ['rose', 'pink'],
  ['pink', 'pink'],
  ['blanc', 'white'],
  ['blanche', 'white'],
  ['white', 'white'],
  ['noir', 'black'],
  ['noire', 'black'],
  ['black', 'black'],
  ['marron', 'brown'],
  ['brown', 'brown'],
  ['gris', 'gray'],
  ['grise', 'gray'],
  ['gray', 'gray'],
  ['grey', 'gray'],
  ['doré', 'golden'],
  ['dorée', 'golden'],
  ['dore', 'golden'],
  ['gold', 'gold'],
  ['golden', 'golden'],
  ['argent', 'silver'],
  ['argenté', 'silver'],
  ['argentée', 'silver'],
  ['silver', 'silver'],
  ['ultraviolet', 'ultraviolet'],
]);

const ENGLISH_COLOR_WORDS = new Set([...new Set(COLOR_WORD_MAP.values())]);
const FLORAL_LEAK_COLORS = new Set(['yellow', 'pink', 'orange', 'purple']);
const ANIMAL_SUBJECT_TERMS = [
  'grizzly bear',
  'grizzly bears',
  'hedgehog',
  'hedgehogs',
  'rabbit',
  'rabbits',
  'cow',
  'cows',
  'pig',
  'pigs',
  'fish',
  'cat',
  'cats',
  'dog',
  'dogs',
  'fox',
  'foxes',
  'bear',
  'bears',
  'panda',
  'pandas',
  'lion',
  'lions',
  'tiger',
  'tigers',
  'dragon',
  'dragons',
  'unicorn',
  'unicorns',
];
const CHARACTER_COUNT_REFERENCE_WORDS = new Set([
  'batman',
  'robin',
  'mario',
  'zelda',
  'donkey kong',
  'princess',
  'princesse',
  'hero',
  'heros',
  'héros',
  'character',
  'personnage',
]);

const IMAGE_PHRASE_TRANSLATIONS = [
  ...SCENE_RELATION_TRANSLATION_PATTERNS,
  [/sort(?:ant|i|ie)\s+d(?:['’]|\s+)un\b/gi, 'coming out of a'],
  [/sort(?:ant|i|ie)\s+d(?:['’]|\s+)une\b/gi, 'coming out of a'],
  [/sort(?:ant|i|ie)\s+du\b/gi, 'coming out of the'],
  [/sort(?:ant|i|ie)\s+de la\b/gi, 'coming out of the'],
  [/de couleur de peau\b/gi, 'with skin color'],
  [/de couleurs?\b/gi, 'colored'],
  [/de p[aâ]ques\b/gi, 'Easter'],
  [/chapeau de magicien\b/gi, 'magician hat'],
  [/chapeau de sorcier\b/gi, 'wizard hat'],
  [/au milieu d(?:['’]|\s+)un\b/gi, 'in the middle of a'],
  [/au milieu d(?:['’]|\s+)une\b/gi, 'in the middle of a'],
  [/au milieu de la\b/gi, 'in the middle of the'],
  [/au milieu du\b/gi, 'in the middle of the'],
  [/au bord d(?:['’]|\s+)une\b/gi, 'at the edge of a'],
  [/au bord d(?:['’]|\s+)un\b/gi, 'at the edge of a'],
  [/au bord de la\b/gi, 'at the edge of the'],
  [/au bord du\b/gi, 'at the edge of the'],
  [/sous une\b/gi, 'under a'],
  [/sous un\b/gi, 'under a'],
  [/sous la\b/gi, 'under the'],
  [/sous le\b/gi, 'under the'],
  [/sur une\b/gi, 'on a'],
  [/sur un\b/gi, 'on a'],
  [/sur des\b/gi, 'on'],
  [/sur la\b/gi, 'on the'],
  [/sur le\b/gi, 'on the'],
  [/\ben vélo\b/gi, 'on a bicycle'],
  [/\bà vélo\b/gi, 'on a bicycle'],
  [/\ba velo\b/gi, 'on a bicycle'],
  [/dans une\b/gi, 'in a'],
  [/dans un\b/gi, 'in a'],
  [/dans des\b/gi, 'in'],
  [/dans la\b/gi, 'in the'],
  [/dans le\b/gi, 'in the'],
  [/avec une\b/gi, 'with a'],
  [/avec un\b/gi, 'with a'],
  [/avec des\b/gi, 'with'],
  [/avec la\b/gi, 'with the'],
  [/avec le\b/gi, 'with the'],
  [/avec\b/gi, 'with'],
  [/tenant une\b/gi, 'holding a'],
  [/tenant un\b/gi, 'holding a'],
  [/tenant des\b/gi, 'holding'],
  [/tenant la\b/gi, 'holding the'],
  [/tenant le\b/gi, 'holding the'],
  [/portant une\b/gi, 'wearing a'],
  [/portant un\b/gi, 'wearing a'],
  [/portant des\b/gi, 'wearing'],
  [/portant la\b/gi, 'wearing the'],
  [/portant le\b/gi, 'wearing the'],
  [/style ghibli\b/gi, 'ghibli style'],
  [/style cartoon\b/gi, 'cartoon style'],
  [/style anime\b/gi, 'anime style'],
  [/photo realiste\b/gi, 'photorealistic'],
  [/photo réaliste\b/gi, 'photorealistic'],
  [/dessin anime\b/gi, 'anime illustration'],
  [/jeu retro\b/gi, 'retro game'],
  [/jeu rétro\b/gi, 'retro game'],
];

const IMAGE_TOKEN_TRANSLATIONS = new Map([
  ['un', 'a'],
  ['une', 'a'],
  ['des', ''],
  ['du', 'of the'],
  ['de', 'of'],
  ['d', 'of'],
  ['la', 'the'],
  ['le', 'the'],
  ['les', 'the'],
  ['lapin', 'rabbit'],
  ['lapins', 'rabbits'],
  ['lapine', 'rabbit'],
  ['herisson', 'hedgehog'],
  ['herissons', 'hedgehogs'],
  ['vache', 'cow'],
  ['vaches', 'cows'],
  ['cochon', 'pig'],
  ['cochons', 'pigs'],
  ['poisson', 'fish'],
  ['chat', 'cat'],
  ['chats', 'cats'],
  ['chien', 'dog'],
  ['chiens', 'dogs'],
  ['renard', 'fox'],
  ['renards', 'foxes'],
  ['ours', 'bear'],
  ['grizzli', 'grizzly bear'],
  ['grizzlis', 'grizzly bears'],
  ['grizzly', 'grizzly bear'],
  ['grizzlys', 'grizzly bears'],
  ['panda', 'panda'],
  ['pandas', 'pandas'],
  ['courgette', 'zucchini'],
  ['courgettes', 'zucchinis'],
  ['tomate', 'tomato'],
  ['tomates', 'tomatoes'],
  ['carotte', 'carrot'],
  ['carottes', 'carrots'],
  ['citrouille', 'pumpkin'],
  ['citrouilles', 'pumpkins'],
  ['pomme', 'apple'],
  ['pommes', 'apples'],
  ['fraise', 'strawberry'],
  ['fraises', 'strawberries'],
  ['cerise', 'cherry'],
  ['cerises', 'cherries'],
  ['champignon', 'mushroom'],
  ['champignons', 'mushrooms'],
  ['papillon', 'butterfly'],
  ['papillons', 'butterflies'],
  ['oiseau', 'bird'],
  ['oiseaux', 'birds'],
  ['tortue', 'turtle'],
  ['tortues', 'turtles'],
  ['grenouille', 'frog'],
  ['grenouilles', 'frogs'],
  ['lion', 'lion'],
  ['lions', 'lions'],
  ['tigre', 'tiger'],
  ['tigres', 'tigers'],
  ['dragon', 'dragon'],
  ['dragons', 'dragons'],
  ['licorne', 'unicorn'],
  ['licornes', 'unicorns'],
  ['paques', 'Easter'],
  ['pâques', 'Easter'],
  ['noel', 'Christmas'],
  ['noël', 'Christmas'],
  ['princesse', 'princess'],
  ['princesses', 'princesses'],
  ['personnage', 'character'],
  ['personnages', 'characters'],
  ['hero', 'hero'],
  ['heros', 'hero'],
  ['héros', 'hero'],
  ['magicien', 'magician'],
  ['magique', 'magical'],
  ['chapeau', 'hat'],
  ['cape', 'cape'],
  ['capes', 'capes'],
  ['sabre', 'sword'],
  ['sabres', 'swords'],
  ['épée', 'sword'],
  ['epee', 'sword'],
  ['épées', 'swords'],
  ['epees', 'swords'],
  ['couronne', 'crown'],
  ['couronnes', 'crowns'],
  ['velo', 'bicycle'],
  ['vélo', 'bicycle'],
  ['velo', 'bicycle'],
  ['bicyclette', 'bicycle'],
  ['cycliste', 'cyclist'],
  ['cyclistes', 'cyclists'],
  ['montagne', 'mountain'],
  ['montagnes', 'mountains'],
  ['alpes', 'alps'],
  ['rivière', 'river'],
  ['riviere', 'river'],
  ['forêt', 'forest'],
  ['foret', 'forest'],
  ['lune', 'moon'],
  ['lunes', 'moons'],
  ['ciel', 'sky'],
  ['nuage', 'cloud'],
  ['nuages', 'clouds'],
  ['etoile', 'star'],
  ['étoile', 'star'],
  ['etoiles', 'stars'],
  ['étoiles', 'stars'],
  ['sombre', 'dark'],
  ['clair', 'bright'],
  ['cartoon', 'cartoon'],
  ['anime', 'anime'],
  ['manga', 'manga'],
  ['ghibli', 'ghibli'],
  ['photo', 'photo'],
  ['réaliste', 'realistic'],
  ['realiste', 'realistic'],
  ['photorealiste', 'photorealistic'],
  ['photoréaliste', 'photorealistic'],
  ['poudlard', 'hogwarts'],
  ['sorcier', 'wizard'],
  ['sorciere', 'witch'],
  ['sorcière', 'witch'],
  ['chevalier', 'knight'],
  ['pirate', 'pirate'],
  ['ninja', 'ninja'],
  ['robot', 'robot'],
  ['monstre', 'monster'],
  ['doré', 'golden'],
  ['dorée', 'golden'],
  ['dore', 'golden'],
  ['argenté', 'silver'],
  ['argentée', 'silver'],
  ['argente', 'silver'],
  ['ultraviolet', 'ultraviolet'],
  ['couleur', 'color'],
  ['peau', 'skin'],
  ['decor', 'background'],
  ['décor', 'background'],
  ['rayon', 'ray'],
  ['rayons', 'rays'],
]);

function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIntentText(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function normalizeLookupToken(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase();
}

function buildEnglishColorPattern() {
  return [...ENGLISH_COLOR_WORDS]
    .sort((left, right) => right.length - left.length)
    .map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

const ENGLISH_COLOR_PATTERN = buildEnglishColorPattern();

function reorderFrenchColorPhrase(value = '') {
  let out = normalizeWhitespace(value);
  out = out.replace(/^(.*?)\s+de couleurs?\s+([a-zA-ZÀ-ÿ-]+)(.*)$/i, (_match, subject, color, suffix) => {
    return `${color} ${String(subject || '').trim()}${suffix || ''}`.trim();
  });
  out = out.replace(/^(.*?)\s+(rouge|bleu(?:e)?|vert(?:e)?|jaune|violet(?:te)?|orange|rose|blanc(?:he)?|noir(?:e)?|marron|gris(?:e)?|dor[ée]e?|argent[ée]e?)(\b.*)$/i, (_match, subject, color, suffix) => {
    return `${color} ${String(subject || '').trim()}${suffix || ''}`.trim();
  });
  return normalizeWhitespace(out);
}

function translateImageToken(part = '') {
  const trimmed = String(part || '');
  if (!trimmed) return '';
  const lookup = normalizeLookupToken(trimmed);
  if (!lookup) return trimmed;
  const direct = IMAGE_TOKEN_TRANSLATIONS.get(lookup) || COLOR_WORD_MAP.get(lookup);
  if (direct) return direct;

  const singularCandidates = [
    lookup.endsWith('es') ? lookup.slice(0, -2) : '',
    lookup.endsWith('s') ? lookup.slice(0, -1) : '',
    lookup.endsWith('aux') ? `${lookup.slice(0, -3)}al` : '',
  ].filter(Boolean);

  for (const candidate of singularCandidates) {
    const translated = IMAGE_TOKEN_TRANSLATIONS.get(candidate) || COLOR_WORD_MAP.get(candidate);
    if (!translated) continue;
    if (ENGLISH_COLOR_WORDS.has(translated)) return translated;
    if (/(s|x|z|ch|sh)$/.test(translated)) return `${translated}es`;
    if (/[^aeiou]y$/.test(translated)) return `${translated.slice(0, -1)}ies`;
    if (translated.endsWith('s')) return translated;
    return `${translated}s`;
  }

  return trimmed;
}

function translateImagePromptToEnglish(value = '') {
  const source = bindSemanticCompoundsRaw(
    normalizeImagePromptLiteral(String(value || '').replace(/[’]/g, "'"))
  );
  let out = bindSemanticCompoundsRaw(reorderFrenchColorPhrase(source));
  if (!out) return '';

  for (const [pattern, replacement] of IMAGE_PHRASE_TRANSLATIONS) {
    out = out.replace(pattern, replacement);
  }

  out = out.split(/(\s+|[,:;()])/).map((part) => {
    if (!part || /^\s+$/.test(part) || /^[,:;()]$/.test(part)) return part;
    return translateImageToken(part);
  }).join('');

  out = out
    .replace(/\b(a|an)\s+(a|an)\b/gi, '$1')
    .replace(/\b(a|the)\s+([a-z][a-z0-9-]*)\s+(dark|bright|magical)\b/gi, '$1 $3 $2')
    .replace(/\b(red|blue|green|yellow|purple|orange|pink|white|black|brown|gray|grey|golden|silver)\s+(a|an)\s+([a-z][a-z0-9-]*)\b/gi, '$2 $1 $3')
    .replace(/\bray\s+ultraviolet\b/gi, 'ultraviolet ray')
    .replace(/\bof\s+the\s+the\b/gi, 'of the')
    .replace(/\bwith\s+with\b/gi, 'with')
    .replace(/\b(in|on|with|of)\s+\b/gi, '$1 ')
    .replace(/\b([a-z][a-z0-9-]*)\s+colored\b/gi, 'colored $1')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();

  return stripEnglishSubjectWrappers(bindSemanticCompoundsEnglish(out));
}

function stripImageGenerationCommandPrefix(value = '') {
  return String(value || '')
    .replace(/^(?:(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+)+(?:que\s+tu\s+)?(?:me\s+)?/i, '')
    .replace(/^que\s+tu\s+/i, '')
    .replace(/^(?:peux[- ]?tu\s+)?(?:s(?:tp|il te plait|’il te plait|il te plaît)\s+)?/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|generate(?:d)?|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche)\s+(?:moi\s+)?(?:an?\s+|une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait)\s+(?:of|de|du|de la|de l['’]?|d['’]|\bd\s+)\s*/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|generate(?:d)?|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche)\s+(?:moi\s+)?(?:an?\s+|une?\s+)?(?:image|illustration|dessin|visuel)\b\s*/i, '')
    .replace(/^(?:une?\s+)?(?:image|visuel)\s+(?:de|du|de la|de l['’]?|d['’])?\s*/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|generate(?:d)?|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée))\s+(?:moi\s+)?/i, '')
    .trim();
}

function normalizeImagePromptLiteral(value = '') {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  return stripImageGenerationCommandPrefix(raw) || raw;
}

function detectImagePromptAmbiguity(rawPrompt = '') {
  const basePrompt = bindSemanticCompoundsRaw(normalizeImagePromptLiteral(rawPrompt));
  if (!basePrompt) return null;

  const normalized = normalizeIntentText(basePrompt);
  if (!normalized) return null;
  if (/\b(de couleurs?|couleurs?|color|colored)\b/.test(normalized)) return null;
  if (/\b(fleur|fleurs|bouquet|petale|petales|jardin|couronne|rosier|flowers?|petals?|floral)\b/.test(normalized)) return null;

  const match = normalized.match(/^(?:une|un|des|de la|de l|du|d )?\s*([a-z0-9 -]{2,40}?)\s+(rose|orange|violet|marron)\b(.*)$/i);
  if (!match) return null;

  const subject = normalizeWhitespace(match[1] || '');
  const color = normalizeWhitespace(match[2] || '').toLowerCase();
  const suffix = normalizeWhitespace(match[3] || '');
  if (!subject || !IMAGE_COLOR_AMBIGUITY_WORDS.has(color)) return null;
  if (subject.split(/\s+/).length > 6) return null;

  const colorPrompt = `${subject} de couleur ${color}${suffix ? ` ${suffix}` : ''}`.trim();
  const floralPrompt = `${subject}${suffix ? ` ${suffix}` : ''} entoure de ${color === 'orange' ? 'fruits oranges' : `${color}s / fleurs`}`.trim();
  const question = `Quand tu dis "${subject} ${color}", tu veux dire 1. ${subject} de couleur ${color} ou 2. ${subject} avec ${color === 'orange' ? 'des oranges' : `des ${color}s / fleurs`} ?`;

  return {
    kind: 'image_generation',
    subject,
    color,
    basePrompt,
    colorPrompt,
    floralPrompt,
    question,
    options: [
      `1. ${subject} de couleur ${color}`,
      `2. ${subject} avec ${color === 'orange' ? 'des oranges' : `des ${color}s / fleurs`}`,
    ],
  };
}

function extractPalette(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  const palette = [];

  for (const [token, canonical] of COLOR_WORD_MAP.entries()) {
    const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(normalized)) palette.push(canonical);
  }

  return [...new Set(palette)];
}

function extractStyleHints(prompt = '') {
  const normalized = normalizeIntentText(prompt);
  const styleHints = ['high quality', 'detailed'];

  if (/\b(anime|manga|one piece|naruto|dragon ball|pokemon|bleach|fairy tail|attack on titan)\b/.test(normalized)) {
    styleHints.push('anime illustration', 'manga art', 'clean linework', 'cel shading');
  }

  if (/\b(zelda|fantasy|hogwarts|harry potter|wizard|magicien|elfe|dragon|princesse)\b/.test(normalized)) {
    styleHints.push('fantasy illustration', 'cinematic lighting');
  }

  if (/\b(photo|photorealiste|photorealistic|realiste|realistic)\b/.test(normalized)) {
    styleHints.push('photorealistic', 'natural textures');
  }

  if (/\b(dessin|illustration|cartoon)\b/.test(normalized)) {
    styleHints.push('illustration');
  }

  return [...new Set(styleHints)];
}

function extractCompositionHints(prompt = '', options = {}) {
  const normalized = normalizeIntentText(prompt);
  const hints = [];
  const pluralRequested = /\b(des|plusieurs|many|multiple|crowd|group|groupe|ensemble)\b/.test(normalized);

  if (!pluralRequested) hints.push('single main subject', 'solo subject', 'one subject only');
  hints.push('clear centered composition', 'clear subject focus');

  if (/\b(portrait|visage|face)\b/.test(normalized)) hints.push('portrait framing');
  if (/\b(hero|heros|batman|mario|donkey kong|princesse|personnage|character)\b/.test(normalized)) {
    hints.push('single character focus');
  }
  if (/\b(velo|bike|bicycle|cycliste|cyclist)\b/.test(normalized)) {
    hints.push('clear riding pose', 'single bicycle');
  }
  if (/\b(sort|sorti|sortie|sortant|out of|from)\b.*\b(chapeau|hat)\b/.test(normalized)
    || /\b(chapeau|hat)\b.*\b(magicien|wizard)\b/.test(normalized)) {
    hints.push('clear action pose');
  }
  if (options.simpleBackground !== false) hints.push('simple clean background');

  return [...new Set(hints)];
}

function trimSubjectPhrase(value = '') {
  return normalizeWhitespace(String(value || '')
    .replace(/^(?:un|une|des|du|de la|de l|d['’]|le|la|les|the|a|an)\s+/i, '')
    .replace(/\b(?:dans|sur|avec|au milieu de|au bord de|sortant|sorti|sortie|coming out of|in|on|with|portant|tenant|wearing|holding)\b.*$/i, '')
    .replace(/\b(?:style|cartoon|anime|ghibli|photo|photorealiste|photorealistic|realiste|realistic|fantasy)\b.*$/i, '')
    .trim());
}

function isSubjectPhraseMeaningful(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  if (normalized.split(/\s+/).length > 8) return false;
  if (/^(orange|violet|rouge|bleu|vert|jaune|rose|pink|red|blue|green|yellow|purple|brown|gray|grey|gold|golden|silver|blanc|noir|marron|gris)$/.test(normalized)) {
    return false;
  }
  if (/^(cartoon|anime|ghibli|photo|photorealiste|photorealistic|realiste|realistic|fantasy|style)$/.test(normalized)) {
    return false;
  }
  return true;
}

function looksLikeCharacterSubject(value = '') {
  const normalized = normalizeIntentText(value);
  if (!normalized) return false;
  for (const entry of CHARACTER_COUNT_REFERENCE_WORDS) {
    if (normalized.includes(normalizeIntentText(entry))) return true;
  }
  return false;
}

function singularizeEnglishNounPhrase(value = '') {
  const parts = normalizeWhitespace(String(value || '')).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';

  const lastIndex = parts.length - 1;
  let last = parts[lastIndex].toLowerCase();

  if (/(sses|shes|ches|xes|zes)$/.test(last)) {
    last = last.replace(/es$/, '');
  } else if (/ies$/.test(last) && last.length > 3) {
    last = `${last.slice(0, -3)}y`;
  } else if (last.endsWith('s') && !last.endsWith('ss')) {
    last = last.slice(0, -1);
  }

  parts[lastIndex] = last;
  return normalizeWhitespace(parts.join(' '));
}

function compileCharacterCountConstraints(rawPrompt = '') {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  const normalized = normalizeIntentText(basePrompt);
  if (!normalized) return null;

  const pluralRequested = /\b(des|plusieurs|many|multiple|crowd|group|groupe|ensemble)\b/.test(normalized);
  if (pluralRequested) return null;

  const pairParts = basePrompt.split(/\b(?:et|and|&)\b/i).map((entry) => trimSubjectPhrase(entry)).filter(Boolean);
  if (pairParts.length !== 2 || !pairParts.every(isSubjectPhraseMeaningful)) return null;

  const translatedParts = pairParts.map((entry) => translateImagePromptToEnglish(entry));
  const kind = translatedParts.some(looksLikeCharacterSubject) || pairParts.some(looksLikeCharacterSubject)
    ? 'characters'
    : 'subjects';
  const [left, right] = translatedParts;
  const promptHints = [
    `exactly two distinct ${kind}: ${left} and ${right}`,
    `one ${left} and one ${right} only`,
    'separate bodies',
    'separate faces',
    'clean non-overlapping composition',
    'no character fusion',
    'no duplicate identities',
  ];
  const negativeHints = [
    `multiple ${left}`,
    `multiple ${right}`,
    'duplicate characters',
    'duplicate subjects',
    'fused bodies',
    'merged faces',
    'extra people',
    'crowd',
    'collage',
    'repeated faces',
    'clones',
  ];

  return {
    count: 2,
    kind,
    subjects: translatedParts,
    promptHints,
    negativeHints,
  };
}

function stripEnglishLeadingArticle(value = '') {
  return normalizeWhitespace(String(value || '').replace(/^(?:a|an|the)\s+/i, ''));
}

function stripLeadingEnglishColorPhrase(value = '') {
  return normalizeWhitespace(
    String(value || '')
      .replace(new RegExp(`^(?:a|an|the)\\s+(?:${ENGLISH_COLOR_PATTERN})\\s+`, 'i'), '')
      .replace(new RegExp(`^(?:${ENGLISH_COLOR_PATTERN})\\s+`, 'i'), '')
      .replace(/^(?:a|an|the)\s+/i, '')
  );
}

function looksLikeAnimalSubject(value = '') {
  const normalized = normalizeIntentText(stripEnglishLeadingArticle(value));
  if (!normalized) return false;
  return ANIMAL_SUBJECT_TERMS.some((entry) => normalized.includes(normalizeIntentText(entry)));
}

function chooseAnimalSurfaceDescriptor(subjectLead = '') {
  const normalized = normalizeIntentText(subjectLead);
  if (/\b(fish|dragon)\b/.test(normalized)) return 'scales';
  return 'fur';
}

function mentionsJuvenileAnimal(subjectLead = '') {
  const normalized = normalizeIntentText(subjectLead);
  if (!normalized) return false;
  return /\b(baby|young|juvenile|cub|pup|kit|kitten|puppy|foal|calf|fawn|bebe|bébé|jeune|petit|petite|petits|petites|ourson|lionceau|chiot|chaton|renardeau)\b/.test(normalized);
}

function buildSoloAnimalExclusionHints(subjectLead = '') {
  const baseHints = [
    'pair of animals',
    'animal family',
    'animal group',
    'pack',
    'litter',
    'offspring',
    'two animals',
    'multiple animals',
  ];
  if (mentionsJuvenileAnimal(subjectLead)) {
    return baseHints;
  }
  return [
    ...baseHints,
    'baby animal',
    'juvenile animal',
    'cub',
    'pup',
    'kit',
  ];
}

function buildAnimalColorBinding(details = {}) {
  const palette = Array.isArray(details?.palette) ? details.palette : [];
  const primaryColor = String(palette[0] || '').trim().toLowerCase();
  if (!primaryColor) return null;

  const baseLead = normalizeWhitespace(
    details?.semanticBinding?.promptLead
    || details?.subjectPromptEnglish
    || details?.subjectText
    || ''
  );
  if (!looksLikeAnimalSubject(baseLead)) return null;

  const bareSubject = stripLeadingEnglishColorPhrase(baseLead);
  if (!bareSubject) return null;

  const surface = chooseAnimalSurfaceDescriptor(bareSubject);
  const stabilizedColor = primaryColor === 'yellow' ? 'golden-yellow' : primaryColor;
  const floralLeakRisk = FLORAL_LEAK_COLORS.has(primaryColor);
  const singularSubject = stripEnglishLeadingArticle(singularizeEnglishNounPhrase(bareSubject) || bareSubject) || bareSubject;

  return {
    promptLead: `one ${bareSubject} with ${stabilizedColor} ${surface}`,
    structuralAtoms: [
      `exactly one ${singularSubject}`,
      `one ${singularSubject} only`,
      'standing alone',
      'solo composition',
      'centered subject',
      'simple clean background',
      'only one animal in frame',
      'no other animals visible',
    ],
    literalColorSentence: floralLeakRisk
      ? `the animal itself has ${stabilizedColor} ${surface}, not ${primaryColor} flowers, petals, meadow plants, or background elements`
      : `the animal itself has ${stabilizedColor} ${surface}, the color belongs to the animal body and not to the background, props, or decorative elements`,
    negativeHints: floralLeakRisk
      ? [
          `${primaryColor} flowers`,
          `${primaryColor} petals`,
          `${primaryColor} floral background`,
          `${primaryColor} blossom meadow`,
          'flower field',
          'meadow flowers',
          'decorative plants',
          'multiple subjects',
          'second subject',
          'crowd',
          ...buildSoloAnimalExclusionHints(bareSubject),
        ]
      : [
          'multiple subjects',
          'second subject',
          'crowd',
          ...buildSoloAnimalExclusionHints(bareSubject),
        ],
  };
}

function compileSingleSubjectConstraints(rawPrompt = '', translatedPrompt = '') {
  const basePrompt = normalizeImagePromptLiteral(rawPrompt);
  const normalized = normalizeIntentText(basePrompt);
  if (!normalized) return null;

  const pluralRequested = /\b(des|plusieurs|many|multiple|crowd|group|groupe|ensemble)\b/.test(normalized);
  if (pluralRequested) return null;
  if (compileCharacterCountConstraints(basePrompt)) return null;

  const subjectPhrase = trimSubjectPhrase(basePrompt);
  if (!isSubjectPhraseMeaningful(subjectPhrase)) return null;

  const translatedSubject = normalizeWhitespace(translateImagePromptToEnglish(subjectPhrase));
  if (!translatedSubject) return null;

  const promptSubject = stripEnglishLeadingArticle(translatedSubject) || translatedSubject;
  const singularSubject = stripEnglishLeadingArticle(singularizeEnglishNounPhrase(translatedSubject) || translatedSubject) || promptSubject;
  const promptHints = [
    `exactly one ${promptSubject}`,
    `one ${singularSubject} only`,
    'one instance only',
    'solo composition',
    'single isolated subject',
    'clean non-repeated composition',
    'no duplicate instances',
  ];
  const negativeHints = [
    'multiple subjects',
    'second subject',
    'group shot',
    'fused anatomy',
    'crowd',
  ];

  return {
    count: 1,
    subject: singularSubject,
    promptHints,
    negativeHints,
  };
}

function mentionsFloralElements(prompt = '') {
  return /\b(fleur|fleurs|bouquet|petale|petales|garden|garden props|flowers?|petals?|floral)\b/i.test(normalizeIntentText(prompt));
}

function analyzeImagePrompt(rawPrompt = '', options = {}) {
  const basePrompt = bindSemanticCompoundsRaw(normalizeImagePromptLiteral(rawPrompt));
  const ambiguity = detectImagePromptAmbiguity(basePrompt);
  const preferLiteralColor = options.preferLiteralColor === true || options.forceColorPrompt === true;
  const subjectText = ambiguity && preferLiteralColor ? ambiguity.colorPrompt : basePrompt;
  const subjectPromptEnglish = translateImagePromptToEnglish(subjectText);
  const styleHints = extractStyleHints(subjectText);
  const palette = extractPalette(subjectText);
  const characterCountConstraints = compileCharacterCountConstraints(subjectText);
  const singleSubjectConstraints = characterCountConstraints
    ? null
    : compileSingleSubjectConstraints(subjectText, subjectPromptEnglish);
  const compositionHints = [
    ...extractCompositionHints(subjectText, options),
    ...(characterCountConstraints?.count === 2 ? ['two distinct subjects', 'balanced two-subject composition'] : []),
  ];
  const floralRequested = mentionsFloralElements(subjectText);
  const pluralRequested = /\b(des|plusieurs|many|multiple|crowd|group|groupe|ensemble)\b/i.test(normalizeIntentText(subjectText));
  const semanticBinding = bindSemanticAtoms({
    rawPrompt: subjectText,
    subjectPromptEnglish,
    styleHints,
    compositionHints,
    characterCountConstraints,
    singleSubjectConstraints,
    translatePrompt: translateImagePromptToEnglish,
  });

  return {
    basePrompt,
    ambiguity,
    subjectText,
    subjectPromptEnglish,
    palette,
    styleHints,
    compositionHints,
    characterCountConstraints,
    singleSubjectConstraints,
    floralRequested,
    pluralRequested,
    semanticBinding,
  };
}

function buildSdPromptBundle(rawPrompt = '', options = {}) {
  const details = analyzeImagePrompt(rawPrompt, options);
  const semanticBinding = details.semanticBinding && typeof details.semanticBinding === 'object'
    ? details.semanticBinding
    : {};
  const animalColorBinding = buildAnimalColorBinding(details);
  const structuralAtoms = Array.isArray(animalColorBinding?.structuralAtoms) && animalColorBinding.structuralAtoms.length
    ? animalColorBinding.structuralAtoms
    : (Array.isArray(semanticBinding.structuralAtoms) && semanticBinding.structuralAtoms.length
    ? semanticBinding.structuralAtoms
    : (
      details.pluralRequested
        ? []
        : ['exactly one main subject', 'solo composition', 'clear centered composition']
    ));
  const literalColorSentence = animalColorBinding?.literalColorSentence || (
    details.palette.length
      ? 'the requested color applies to the main subject itself, not to the background, foreground, props, or decorative elements'
      : ''
  );
  const finalPromptParts = [
    animalColorBinding?.promptLead || semanticBinding.promptLead || details.subjectPromptEnglish || details.subjectText,
    ...((semanticBinding.relationAtoms || [])),
    (semanticBinding.styleAtoms || details.styleHints || []).join(', '),
    structuralAtoms.join(', '),
    literalColorSentence,
    'literal interpretation, apply the requested colors to the main subject only, do not add extra props, flowers, decorative patterns, or extra characters unless requested',
  ].filter(Boolean);

  const negativeHints = [
    'blurry',
    'abstract',
    'deformed',
    'bad anatomy',
    'low quality',
    'text',
    'watermark',
    'signature',
    'logo',
    'collage',
    'repeated pattern',
    'wallpaper',
    'background clutter',
    'random props',
  ];

  if (!details.floralRequested) {
    negativeHints.push('flowers', 'bouquet', 'rose petals', 'floral background', 'floral pattern', 'foreground flowers', 'decorative foreground objects');
  }
  if (!details.pluralRequested) {
    negativeHints.push(
      'multiple subjects',
      'second subject',
      'crowd',
      'group shot',
      'fused anatomy',
      'merged limbs'
    );
  }
  negativeHints.push(...(semanticBinding.blockedDuplicates || []));
  negativeHints.push(...(animalColorBinding?.negativeHints || []));

  return {
    prompt: finalPromptParts.join('. ').trim(),
    ambiguity: details.ambiguity,
    negativeHints: uniqueSemanticStrings(negativeHints),
    details,
  };
}

module.exports = {
  normalizeImagePromptLiteral,
  detectImagePromptAmbiguity,
  analyzeImagePrompt,
  buildSdPromptBundle,
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  translateImagePromptToEnglish,
  bindSemanticAtoms,
};

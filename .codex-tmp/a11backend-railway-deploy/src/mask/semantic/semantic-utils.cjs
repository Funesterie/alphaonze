const STOPWORDS = new Set([
  'a', 'alors', 'au', 'aucun', 'aussi', 'autre', 'aux', 'avec',
  'ce', 'ces', 'cette', 'cet', 'cela', 'ca', 'car', 'comme',
  'dans', 'de', 'des', 'du', 'donc',
  'elle', 'elles', 'en', 'est', 'et',
  'il', 'ils', 'je', 'j', 'la', 'le', 'les', 'leur', 'lui',
  'ma', 'mais', 'me', 'mes', 'moi', 'mon',
  'ne', 'ni', 'notre', 'nos',
  'on', 'ou', 'où', 'par', 'pas', 'pour',
  'que', 'qui', 'quoi', 'quand', 'quel', 'quelle', 'quelles', 'quels',
  'qu',
  'sa', 'se', 'ses', 'si', 'son', 'sur',
  'ta', 'te', 'tes', 'toi', 'ton', 'tu',
  'un', 'une', 'vos', 'votre', 'vous', 'y',
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'in', 'on', 'with', 'me', 'my', 'your',
]);

const SUBJECT_NOISE_WORDS = new Set([
  'salut', 'bonjour', 'bonsoir', 'coucou', 'hello', 'hey',
  'bien', 'merci', 'ok', 'okay', 'dac', 'daccord',
  'va', 'vas', 'allez', 'allons',
  'peux', 'peut', 'pourrais', 'voudrais', 'aimerais',
  'genre', 'juste', 'simplement',
]);

const QUESTION_WORDS = [
  'quoi', 'comment', 'pourquoi', 'quand', 'ou', 'où', 'qui', 'quel', 'quelle', 'quels', 'quelles',
  'what', 'how', 'why', 'when', 'where', 'who',
];

const ACTION_VERBS = [
  'genere', 'generer', 'cree', 'creer', 'dessine', 'dessiner', 'fabrique', 'produis', 'prepare',
  'montre', 'montrer', 'affiche', 'afficher', 'cherche', 'chercher', 'recherche', 'trouve', 'trouver', 'donne', 'donner', 'envoie', 'envoyer', 'verifie', 'vérifie',
  'ecris', 'ecrire', 'code', 'fais', 'faire', 'construis', 'build', 'generate', 'create', 'draw', 'show', 'find', 'search',
];

const INTENT_DEFINITIONS = {
  'image.generate': {
    label: 'Generer une image',
    kind: 'action',
    verbs: ['genere', 'generer', 'cree', 'creer', 'dessine', 'dessiner', 'fabrique', 'produis', 'prepare', 'generate', 'create', 'draw', 'render'],
    keywords: ['image', 'illustration', 'dessin', 'photo', 'visuel', 'portrait', 'art', 'avatar', 'affiche', 'wallpaper', 'scene', 'paysage'],
    phrases: [
      /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare)\b.*\b(image|illustration|dessin|photo|visuel|portrait|art)\b/i,
      /\b(generate|create|draw|make|produce)\b.*\b(image|illustration|drawing|photo|visual|art)\b/i,
    ],
  },
  'web.image.search': {
    label: 'Chercher une image sur le web',
    kind: 'action',
    verbs: ['montre', 'affiche', 'cherche', 'recherche', 'trouve', 'show', 'find', 'search'],
    keywords: ['image', 'photo', 'picture', 'source', 'web', 'internet', 'google', 'bing'],
    phrases: [
      /montre(?:-|\s)?moi\s+(?:une?\s+)?image\s+de\s+(.+)/i,
      /\b(cherche|trouve|affiche|montre)\b.*\b(image|photo|picture)\b/i,
    ],
  },
  'code.python.generate': {
    label: 'Generer du code Python',
    kind: 'action',
    verbs: ['ecris', 'ecrire', 'code', 'genere', 'cree', 'fais', 'prepare', 'build'],
    keywords: ['python', 'script', 'fonction', 'code', 'programme', 'api', 'json', 'regex', 'tri', 'fichier', 'dossier', 'png', 'csv', 'node'],
    phrases: [
      /\b(ecris|code|genere|cree|prepare)\b.*\b(script|fonction|code|python)\b/i,
      /\btrie(?:r|z)?\b.*\b(png|jpg|jpeg|gif|images?)\b/i,
    ],
  },
  'web.search': {
    label: 'Chercher sur le web',
    kind: 'action',
    verbs: ['cherche', 'recherche', 'trouve', 'verifie', 'vérifie', 'consulte', 'look', 'lookup', 'search', 'find'],
    keywords: ['web', 'internet', 'source', 'article', 'news', 'actualite', 'actualité', 'latest', 'recent', 'documentation', 'docs'],
    phrases: [
      /\b(cherche|recherche|trouve|verifie|vérifie|consulte)\b.*\b(web|internet|source|article|documentation|docs)\b/i,
      /\b(latest|recent|actualite|actualité|news)\b/i,
    ],
  },
  'memory.recall': {
    label: 'Rappeler la memoire',
    kind: 'support',
    verbs: ['rappelle', 'souviens', 'remember', 'recall', 'retrouve'],
    keywords: ['memoire', 'mémoire', 'historique', 'conversation', 'avant', 'precedent', 'précédent', 'dernier', 'previous'],
    phrases: [
      /\b(rappelle|souviens|retrouve)\b.*\b(conversation|memoire|mémoire|avant|precedent|précédent)\b/i,
      /\b(what did i say|what did you say before)\b/i,
    ],
  },
  'chat.reply': {
    label: 'Repondre en texte',
    kind: 'default',
    verbs: [],
    keywords: [],
    phrases: [],
  },
};

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSemanticText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenizeWords(text) {
  const matches = String(text || '').match(/[a-z0-9àâçéèêëîïôûùüÿñæœ-]+/gi);
  return Array.isArray(matches) ? matches : [];
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitSentences(text) {
  return String(text || '')
    .match(/[^.!?\n]+[.!?]?/g)
    ?.map((entry) => entry.trim())
    .filter(Boolean) || [];
}

function countRegexMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  let count = 0;
  while (regex.exec(text)) count += 1;
  return count;
}

function classifyWordSemanticTags(word) {
  const normalized = normalizeSemanticText(word);
  if (!normalized) return [];

  const tags = [];
  if (STOPWORDS.has(normalized)) tags.push('stopword');
  if (QUESTION_WORDS.includes(normalized)) tags.push('question');
  if (ACTION_VERBS.includes(normalized)) tags.push('action');
  if (/\d/.test(normalized)) tags.push('numeric');

  for (const [intentType, definition] of Object.entries(INTENT_DEFINITIONS)) {
    if (definition.verbs.includes(normalized)) tags.push(`${intentType}:verb`);
    if (definition.keywords.includes(normalized)) tags.push(`${intentType}:keyword`);
  }

  if (/\b(orange|rouge|bleu|vert|jaune|violet|purple|red|blue|green|yellow|black|white|blanc|noir|rose|pink|marron|brown|gris|gray|grey|dore|doré|gold|golden|argent|silver)\b/.test(normalized)) {
    tags.push('color');
  }

  return [...new Set(tags)];
}

function extractSubjectCandidate(words = []) {
  const filtered = words
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => ({
      raw: entry,
      normalized: normalizeSemanticText(entry),
    }))
    .filter((entry) => entry.normalized && !STOPWORDS.has(entry.normalized))
    .filter((entry) => !SUBJECT_NOISE_WORDS.has(entry.normalized))
    .filter((entry) => !ACTION_VERBS.includes(entry.normalized))
    .filter((entry) => !QUESTION_WORDS.includes(entry.normalized))
    .filter((entry) => !Object.values(INTENT_DEFINITIONS).some((definition) => definition.keywords.includes(entry.normalized)))
    .filter((entry) => !Object.values(INTENT_DEFINITIONS).some((definition) => definition.verbs.includes(entry.normalized)));

  return filtered[0]?.raw || '';
}

module.exports = {
  STOPWORDS,
  QUESTION_WORDS,
  ACTION_VERBS,
  INTENT_DEFINITIONS,
  clamp01,
  normalizeSemanticText,
  tokenizeWords,
  splitParagraphs,
  splitSentences,
  countRegexMatches,
  classifyWordSemanticTags,
  extractSubjectCandidate,
  SUBJECT_NOISE_WORDS,
};

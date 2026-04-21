const { findColorDefinition } = require('./color-library.cjs');
const { findStyleDefinition } = require('./style-library.cjs');
const { findSceneDefinition } = require('./scene-library.cjs');
const { findElementDefinition } = require('./element-library.cjs');
const { findMetierDefinition } = require('./metier-library.cjs');
const { findAccessoryDefinition } = require('./accessory-library.cjs');
const {
  normalizeSubjectProfileText,
  resolveSubjectProfile,
} = require('./subject-profile-library.cjs');

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
  'qu', 'd', 'l',
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
  'studio', 'fond', 'background', 'lumiere', 'lumière', 'lighting',
  'light', 'neutre', 'neutral', 'soft', 'douce', 'doux',
  'petit', 'petite', 'grand', 'grande',
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
  'video.generate': {
    label: 'Generer une video',
    kind: 'action',
    verbs: ['genere', 'generer', 'cree', 'creer', 'fais', 'faire', 'fabrique', 'produis', 'prepare', 'generate', 'create', 'make', 'render'],
    keywords: ['video', 'animation', 'gif', 'mp4', 'clip', 'sequence', 'frames'],
    phrases: [
      /\b(genere|generer|cree|creer|fais|faire|fabrique|produis|prepare)\b.*\b(video|animation|gif|mp4|clip)\b/i,
      /\b(generate|create|make|render)\b.*\b(video|animation|gif|mp4|clip)\b/i,
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
  'chat.reply': {
    label: 'Repondre en texte',
    kind: 'default',
    verbs: [],
    keywords: [],
    phrases: [],
  },
};

const INTENT_ALIASES = {
  'code.generate': 'code.python.generate',
  'text.answer': 'chat.reply',
  'action.run': 'chat.reply',
  'memory.recall': 'chat.reply',
  'ui.display': 'chat.reply',
  'image.search': 'web.image.search',
  'image.find': 'web.image.search',
  'web.image.find': 'web.image.search',
  'search.web': 'web.search',
};

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeIntentType(intentType, fallback = 'chat.reply') {
  const normalized = String(intentType || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (INTENT_DEFINITIONS[normalized]) return normalized;
  if (INTENT_ALIASES[normalized] && INTENT_DEFINITIONS[INTENT_ALIASES[normalized]]) {
    return INTENT_ALIASES[normalized];
  }
  return fallback;
}

function isSupportedIntentType(intentType) {
  return normalizeIntentType(intentType, '') !== '';
}

function listSupportedIntentTypes() {
  return Object.keys(INTENT_DEFINITIONS);
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

  const colorDefinition = findColorDefinition(normalized);
  if (colorDefinition) {
    tags.push('color');
    tags.push(`color:${colorDefinition.key}`);
    if (colorDefinition.family) tags.push(`color-family:${colorDefinition.family}`);
  }

  const styleDefinition = findStyleDefinition(normalized);
  if (styleDefinition) {
    tags.push('style');
    tags.push(`style:${styleDefinition.key}`);
    if (styleDefinition.family) tags.push(`style-family:${styleDefinition.family}`);
  }

  const sceneDefinition = findSceneDefinition(normalized);
  if (sceneDefinition) {
    tags.push('scene');
    tags.push(`scene:${sceneDefinition.key}`);
    if (sceneDefinition.family) tags.push(`scene-family:${sceneDefinition.family}`);
  }

  const elementDefinition = findElementDefinition(normalized);
  if (elementDefinition) {
    tags.push('element');
    tags.push(`element:${elementDefinition.key}`);
    if (elementDefinition.family) tags.push(`element-family:${elementDefinition.family}`);
  }

  const metierDefinition = findMetierDefinition(normalized);
  if (metierDefinition) {
    tags.push('metier');
    tags.push(`metier:${metierDefinition.key}`);
    if (metierDefinition.family) tags.push(`metier-family:${metierDefinition.family}`);
    if (metierDefinition.profileType) tags.push(`profile:${metierDefinition.profileType}`);
  }

  const accessoryDefinition = findAccessoryDefinition(normalized);
  if (accessoryDefinition) {
    tags.push('accessory');
    tags.push(`accessory:${accessoryDefinition.key}`);
    if (accessoryDefinition.family) tags.push(`accessory-family:${accessoryDefinition.family}`);
  }

  return [...new Set(tags)];
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSubjectEntries(words = []) {
  return (Array.isArray(words) ? words : [words])
    .map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const raw = String(entry.word || entry.raw || '').trim();
        return {
          raw,
          normalized: normalizeSemanticText(entry.normalized || raw),
          tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
        };
      }
      const raw = String(entry || '').trim();
      return {
        raw,
        normalized: normalizeSemanticText(raw),
        tags: [],
      };
    })
    .filter((entry) => entry.raw && entry.normalized);
}

function normalizeSubjectAliasForLookup(value = '') {
  return normalizeSubjectProfileText(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTextContainsSubjectAlias(sourceText = '', alias = '') {
  const normalizedSource = normalizeSubjectAliasForLookup(sourceText);
  const normalizedAlias = normalizeSubjectAliasForLookup(alias);
  if (!normalizedSource || !normalizedAlias) return false;
  const pattern = new RegExp(
    `(^|\\b)${escapeRegex(normalizedAlias).replace(/\s+/g, '\\s+')}(\\b|$)`,
    'i'
  );
  return pattern.test(normalizedSource);
}

function resolveProfileSubjectCandidate(sourceText = '') {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  const profile = resolveSubjectProfile({ sourceText: raw });
  if (!profile) return '';

  const aliases = (Array.isArray(profile.aliases) ? profile.aliases : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const matchedAlias = aliases.find((entry) => sourceTextContainsSubjectAlias(raw, entry));
  return String(profile.canonicalSubject || matchedAlias || '').trim();
}

function sanitizeStructuredSubjectCandidate(value = '') {
  const cleaned = String(value || '')
    .replace(/[,.!?;:]+$/g, '')
    .replace(/^(?:d['’]\s*un|d['’]\s*une|d['’]\s*des|d\s+un|d\s+une|d\s+des|de\s+la|de\s+l['’]?|du|des|un|une|le|la|les)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const normalized = normalizeSemanticText(cleaned);
  if (!normalized) return '';
  if (STOPWORDS.has(normalized) || SUBJECT_NOISE_WORDS.has(normalized)) return '';
  if (/^(?:studio|photo|portrait|image|illustration|dessin|visuel|fond|background|lumiere|lighting)$/.test(normalized)) {
    return '';
  }

  return cleaned;
}

function extractStructuredSubjectCandidate(sourceText = '') {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  const stripped = raw
    .replace(/^(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+/i, '')
    .replace(/^que\s+tu\s+/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)?|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche|show|generate|create|draw|render|make)\s+(?:moi\s+)?/i, '')
    .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait|vid[eé]o|video|animation|clip)\s+(?:de|du|de la|de l['’]?|d['’]?)?\s*/i, '')
    .replace(/^(?:photo(?:\s+studio)?|studio\s+photo|portrait(?:\s+photo)?|studio)\s+(?:de|du|de la|de l['’]?|d['’]?)?\s*/i, '')
    .trim();

  if (!stripped) return '';

  const match = /^(.+?)(?=\s+(?:avec|sans|dans|sur|sous|au milieu de|au bord de|près de|pres de|devant|derriere|derrière|contre|versus|vs|en train de|portant|tenant|assis|assise|marchant|marchante|courant|courante|fumant|fumante|lumi[eè]re|fond|background|lighting|style|couleurs?|palette)\b|[,.!?;:]|$)/i.exec(stripped);
  return sanitizeStructuredSubjectCandidate(match?.[1] || stripped);
}

function shouldRejectWordAsSubject(entry = {}) {
  const normalized = String(entry.normalized || '').trim();
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  if (!normalized) return true;
  if (STOPWORDS.has(normalized) || SUBJECT_NOISE_WORDS.has(normalized)) return true;
  if (ACTION_VERBS.includes(normalized) || QUESTION_WORDS.includes(normalized)) return true;
  if (/^(?:d\s+un|d\s+une|d\s+des|de\s+la|de\s+l|de|du|des)$/.test(normalized)) return true;
  if (tags.some((tag) => ['color', 'style', 'scene', 'element', 'accessory'].includes(tag))) return true;
  if (tags.some((tag) => /^(?:color|style|scene|element|accessory|image\.generate|web\.image\.search|web\.search|code\.python\.generate):/.test(tag))) {
    return true;
  }
  if (Object.values(INTENT_DEFINITIONS).some((definition) => definition.keywords.includes(normalized))) return true;
  if (Object.values(INTENT_DEFINITIONS).some((definition) => definition.verbs.includes(normalized))) return true;
  return false;
}

function extractSubjectCandidate(words = [], options = {}) {
  const sourceText = String(options?.sourceText || '').trim();
  const structuredCandidate = extractStructuredSubjectCandidate(sourceText);

  const profileCandidate = resolveProfileSubjectCandidate(structuredCandidate || sourceText);
  if (profileCandidate) return profileCandidate;

  if (structuredCandidate) return structuredCandidate;

  const filtered = normalizeSubjectEntries(words)
    .filter((entry) => !shouldRejectWordAsSubject(entry));

  return filtered[0]?.raw || '';
}

module.exports = {
  STOPWORDS,
  QUESTION_WORDS,
  ACTION_VERBS,
  INTENT_DEFINITIONS,
  INTENT_ALIASES,
  clamp01,
  normalizeIntentType,
  isSupportedIntentType,
  listSupportedIntentTypes,
  normalizeSemanticText,
  tokenizeWords,
  splitParagraphs,
  splitSentences,
  countRegexMatches,
  classifyWordSemanticTags,
  extractSubjectCandidate,
  SUBJECT_NOISE_WORDS,
};

const {
  ACTION_VERBS,
  INTENT_DEFINITIONS,
  QUESTION_WORDS,
  STOPWORDS,
  normalizeSemanticText,
} = require('../mask/semantic/semantic-utils.cjs');
const { COLOR_LIBRARY } = require('../mask/semantic/color-library.cjs');
const { STYLE_LIBRARY } = require('../mask/semantic/style-library.cjs');
const { SCENE_LIBRARY } = require('../mask/semantic/scene-library.cjs');
const { ELEMENT_LIBRARY } = require('../mask/semantic/element-library.cjs');
const { METIER_LIBRARY } = require('../mask/semantic/metier-library.cjs');
const { ACCESSORY_LIBRARY } = require('../mask/semantic/accessory-library.cjs');
const { SUBJECT_PROFILE_LIBRARY } = require('../mask/semantic/subject-profile-library.cjs');
const { callStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');

const REQUEST_TEXT_SMOOTHER_SYSTEM_PROMPT = `Tu es un lisseur de requêtes utilisateur pour A11.
Tu reçois :
- le texte original
- une version déjà lissée localement

Ta mission :
1. corriger les fautes d'orthographe ou de frappe évidentes
2. reformuler légèrement en français simple si nécessaire
3. conserver exactement la même intention
4. ne jamais inventer de nouveau sujet, accessoire, décor, style ou action
5. ne jamais transformer la demande en prompt artistique libre

Réponds UNIQUEMENT en JSON strict :
{
  "corrected_text": "texte corrigé fidèle en français"
}`;

const BASE_REQUEST_TERMS = [
  'image',
  'images',
  'illustration',
  'illustrations',
  'dessin',
  'dessins',
  'dessiner',
  'dessine',
  'dessinee',
  'dessinée',
  'photo',
  'photos',
  'portrait',
  'visuel',
  'visuels',
  'fond',
  'fonds',
  'simple',
  'simples',
  'clair',
  'claire',
  'claires',
  'coherent',
  'coherente',
  'coherentes',
  'cohérent',
  'cohérente',
  'cohérentes',
  'visible',
  'visibles',
  'bouche',
  'fumant',
  'fumer',
  'fume',
  'train',
  'tenant',
  'portant',
  'serviette',
  'piscine',
  'route',
  'circuit',
  'kart',
  'ballon',
  'ballons',
  'football',
  'soccer',
  'foot',
  'derapage',
  'dérapage',
  'action',
  'dynamique',
  'plan',
  'americain',
  'américain',
  'scene',
  'scène',
  'heroique',
  'héroïque',
  'personnage',
  'personnages',
  'explique',
  'expliquer',
  'probleme',
  'problème',
  'erreur',
  'erreurs',
  'bug',
  'bugs',
  'conforme',
  'conformes',
  'generateur',
  'générateur',
  'fonctionne',
  'fonctionner',
];

function tokenizeForSmoother(text = '') {
  return String(text || '').match(/[A-Za-zÀ-ÿ0-9]+(?:['’-][A-Za-zÀ-ÿ0-9]+)?|[^A-Za-zÀ-ÿ0-9]+/g) || [];
}

function extractWordTokens(text = '') {
  return String(text || '').match(/[A-Za-zÀ-ÿ0-9]+(?:['’-][A-Za-zÀ-ÿ0-9]+)?/g) || [];
}

function mergeLexiconCategories(existing = [], next = []) {
  return [...new Set([
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(next) ? next : []),
  ].filter(Boolean))];
}

function addToLexiconIndex(index, byInitial, value = '', priority = 50, category = 'generic') {
  for (const token of extractWordTokens(value)) {
    const normalized = normalizeSemanticText(token);
    if (!normalized || normalized.length < 3) continue;

    const current = index.get(normalized);
    const exemplar = String(token || '').trim();
    if (!current || priority < current.priority) {
      index.set(normalized, {
        normalized,
        exemplar,
        priority,
        categories: mergeLexiconCategories(current?.categories, [category]),
      });
    } else if (current) {
      current.categories = mergeLexiconCategories(current.categories, [category]);
    }

    const initial = normalized[0];
    if (!byInitial.has(initial)) byInitial.set(initial, []);
    const bucket = byInitial.get(initial);
    if (!bucket.some((entry) => entry.normalized === normalized)) {
      bucket.push(index.get(normalized) || { normalized, exemplar, priority });
    }
  }
}

function buildRequestLexicon() {
  const index = new Map();
  const byInitial = new Map();

  for (const term of BASE_REQUEST_TERMS) {
    addToLexiconIndex(index, byInitial, term, 10, 'base_term');
  }

  for (const word of ACTION_VERBS) {
    addToLexiconIndex(index, byInitial, word, 12, 'action_verb');
  }
  for (const word of QUESTION_WORDS) {
    addToLexiconIndex(index, byInitial, word, 20, 'question_word');
  }
  for (const word of STOPWORDS) {
    addToLexiconIndex(index, byInitial, word, 40, 'stopword');
  }

  for (const definition of Object.values(INTENT_DEFINITIONS)) {
    for (const word of definition.verbs || []) addToLexiconIndex(index, byInitial, word, 12, 'intent_verb');
    for (const word of definition.keywords || []) addToLexiconIndex(index, byInitial, word, 14, 'intent_keyword');
  }

  for (const entry of COLOR_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.label, 12, 'color');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 12, 'color');
  }
  for (const entry of STYLE_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.label, 14, 'style');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 14, 'style');
  }
  for (const entry of SCENE_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.label, 15, 'scene');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 15, 'scene');
  }
  for (const entry of ELEMENT_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.label, 14, 'element');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 14, 'element');
  }
  for (const entry of METIER_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.label, 13, 'metier');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 13, 'metier');
  }
  for (const entry of ACCESSORY_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.label, 13, 'accessory');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 13, 'accessory');
  }
  for (const entry of SUBJECT_PROFILE_LIBRARY) {
    addToLexiconIndex(index, byInitial, entry.canonicalSubject || '', 11, 'subject_canonical');
    for (const alias of entry.aliases || []) addToLexiconIndex(index, byInitial, alias, 11, 'subject_alias');
    for (const keyword of entry.definitionKeywords || []) addToLexiconIndex(index, byInitial, keyword, 16, 'subject_keyword');
  }

  return {
    index,
    byInitial,
  };
}

const REQUEST_LEXICON = buildRequestLexicon();

function applyFrenchContractions(text = '') {
  return String(text || '')
    .replace(/\bd\s+un\b/gi, "d'un")
    .replace(/\bd\s+une\b/gi, "d'une")
    .replace(/\bd\s+images?\b/gi, (match) => `d'${match.trim().slice(2)}`)
    .replace(/\bl\s+image\b/gi, "l'image")
    .replace(/\bc\s+est\b/gi, "c'est")
    .replace(/\bj\s+ai\b/gi, "j'ai")
    .replace(/\bj\s+aimerais\b/gi, "j'aimerais")
    .replace(/\bqu\s+il\b/gi, "qu'il")
    .replace(/\bqu\s+elle\b/gi, "qu'elle");
}

function normalizeFramingTypos(text = '') {
  return String(text || '')
    .replace(/\bplant\s+am[eé]ricain\b/gi, 'plan americain');
}

function normalizeSurfaceSpacing(text = '') {
  return applyFrenchContractions(
    normalizeFramingTypos(String(text || ''))
      .replace(/[’]/g, '\'')
      .replace(/\s+([,.;!?])/g, '$1')
      .replace(/([(\[{])\s+/g, '$1')
      .replace(/\s+([)\]}])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function levenshteinDistance(left = '', right = '') {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) return b.length;
  if (!b) return a.length;

  const rows = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
}

function commonPrefixLength(left = '', right = '') {
  const limit = Math.min(String(left || '').length, String(right || '').length);
  let count = 0;
  while (count < limit && left[count] === right[count]) count += 1;
  return count;
}

function preserveTokenCasing(source = '', target = '') {
  const rawSource = String(source || '');
  const rawTarget = String(target || '');
  if (!rawTarget) return rawTarget;
  if (rawSource === rawSource.toUpperCase()) return rawTarget.toUpperCase();
  if (rawSource[0] && rawSource[0] === rawSource[0].toUpperCase()) {
    return rawTarget[0].toUpperCase() + rawTarget.slice(1);
  }
  return rawTarget;
}

function isWordToken(token = '') {
  return /^[A-Za-zÀ-ÿ0-9]+(?:['’-][A-Za-zÀ-ÿ0-9]+)?$/.test(String(token || ''));
}

function isCapitalizedToken(token = '') {
  const raw = String(token || '').trim();
  return !!raw && raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase();
}

function hasRiskyLexiconCategory(candidate = null, categories = []) {
  const candidateCategories = Array.isArray(categories) && categories.length
    ? categories
    : (Array.isArray(candidate?.categories) ? candidate.categories : []);
  return candidateCategories.some((entry) => [
    'question_word',
    'stopword',
    'subject_alias',
    'subject_canonical',
    'subject_keyword',
  ].includes(String(entry || '').trim()));
}

function isSafeLocalCorrectionCandidate(sourceToken = '', candidate = null, distance = Infinity, prefix = 0) {
  if (!candidate?.normalized) return false;
  const categories = Array.isArray(candidate.categories) ? candidate.categories : [];
  if (categories.includes('stopword') || categories.includes('question_word')) {
    return false;
  }

  if (hasRiskyLexiconCategory(candidate, categories)) {
    if (distance > 1 || prefix < 4) {
      return false;
    }
  }

  if (isCapitalizedToken(sourceToken) && !isCapitalizedToken(candidate.exemplar) && distance > 1) {
    return false;
  }

  return true;
}

function getSuspiciousTokens(text = '') {
  const suspicious = [];
  for (const token of extractWordTokens(text)) {
    const normalized = normalizeSemanticText(token);
    if (!normalized || normalized.length < 5) continue;
    if (/\d/.test(normalized)) continue;
    if (REQUEST_LEXICON.index.has(normalized)) continue;
    suspicious.push(token);
  }
  return suspicious;
}

function findBestLocalCorrection(token = '') {
  const normalized = normalizeSemanticText(token);
  if (!normalized || normalized.length < 4) return null;
  if (/\d/.test(normalized)) return null;
  if (REQUEST_LEXICON.index.has(normalized)) return null;

  const candidates = REQUEST_LEXICON.byInitial.get(normalized[0]) || [];
  if (!candidates.length) return null;

  const maxDistance = normalized.length <= 4 ? 1 : normalized.length <= 8 ? 2 : 3;
  const ranked = [];

  for (const candidate of candidates) {
    if (!candidate?.normalized) continue;
    if (Math.abs(candidate.normalized.length - normalized.length) > 2) continue;

    const distance = levenshteinDistance(normalized, candidate.normalized);
    if (distance > maxDistance) continue;

    const prefix = commonPrefixLength(normalized, candidate.normalized);
    if (distance > 1 && prefix < 2) continue;
    if (distance >= 2 && prefix < 3) continue;

    ranked.push({
      candidate,
      distance,
      prefix,
      score: distance + (Math.abs(candidate.normalized.length - normalized.length) * 0.12) + (candidate.priority * 0.01) - (prefix * 0.08),
    });
  }

  if (!ranked.length) return null;

  ranked.sort((left, right) => left.score - right.score || left.candidate.priority - right.candidate.priority);
  const winner = ranked[0];
  const second = ranked[1] || null;
  if (second && Math.abs(second.score - winner.score) < 0.14 && second.distance === winner.distance) {
    return null;
  }

  if (!isSafeLocalCorrectionCandidate(token, winner.candidate, winner.distance, winner.prefix)) {
    return null;
  }

  return preserveTokenCasing(token, winner.candidate.exemplar);
}

function normalizeSmootherResult(result = {}, fallbackText = '') {
  const originalText = String(result.originalText || fallbackText || '').trim();
  const text = normalizeSurfaceSpacing(String(result.text || originalText || '').trim());
  const localCorrections = Array.isArray(result.localCorrections) ? result.localCorrections : [];
  const suspiciousTokens = Array.isArray(result.suspiciousTokens) ? result.suspiciousTokens : getSuspiciousTokens(text);
  const noiseScore = Number.isFinite(Number(result.noiseScore)) ? Number(result.noiseScore) : 0;
  const changed = result.changed === true || (text && text !== originalText);
  return {
    originalText,
    text: text || originalText,
    changed,
    usedLlm: result.usedLlm === true,
    localCorrections,
    suspiciousTokens,
    noiseScore,
  };
}

function smoothRequestTextSync(text = '', opts = {}) {
  const originalText = normalizeSurfaceSpacing(String(text || '').trim());
  if (!originalText) {
    return normalizeSmootherResult({
      originalText: '',
      text: '',
      changed: false,
      localCorrections: [],
      suspiciousTokens: [],
      noiseScore: 0,
    }, '');
  }

  const tokens = tokenizeForSmoother(originalText);
  const corrections = [];
  const output = tokens.map((token) => {
    if (!isWordToken(token)) return token;
    const candidate = findBestLocalCorrection(token);
    if (!candidate || candidate === token) return token;
    corrections.push({ from: token, to: candidate });
    return candidate;
  }).join('');

  const smoothedText = normalizeSurfaceSpacing(output);
  const suspiciousTokens = getSuspiciousTokens(smoothedText);
  const noiseScore = Math.min(
    6,
    (corrections.length >= 1 ? 1 : 0)
      + (corrections.length >= 3 ? 1 : 0)
      + (suspiciousTokens.length >= 1 ? 1 : 0)
      + (suspiciousTokens.length >= 3 ? 1 : 0)
  );

  return normalizeSmootherResult({
    originalText,
    text: smoothedText,
    changed: smoothedText !== originalText,
    usedLlm: false,
    localCorrections: corrections,
    suspiciousTokens,
    noiseScore,
  }, originalText);
}

function shouldUseRequestTextSmootherLlm(localResult = {}, opts = {}) {
  if (opts.forceLlm === true) return true;
  if (opts.enableLlm === false) return false;
  if (typeof opts.callStructuredLlmJson !== 'function') return false;

  const explicit = process.env.A11_REQUEST_TEXT_SMOOTHER_LLM;
  if (explicit !== undefined && explicit !== '') {
    const enabled = ['1', 'true', 'yes', 'on'].includes(String(explicit).trim().toLowerCase());
    if (!enabled) return false;
  }

  return Number(localResult?.noiseScore || 0) >= 2;
}

function looksSafeLlmCorrection(baseText = '', correctedText = '') {
  const base = normalizeSurfaceSpacing(baseText);
  const corrected = normalizeSurfaceSpacing(correctedText);
  if (!base || !corrected) return false;
  if (corrected.length > (base.length * 1.8) + 30) return false;
  if (/https?:\/\//i.test(corrected)) return false;

  const baseWords = extractWordTokens(base).map((entry) => normalizeSemanticText(entry)).filter((entry) => entry.length >= 3);
  const correctedWords = extractWordTokens(corrected).map((entry) => normalizeSemanticText(entry)).filter((entry) => entry.length >= 3);
  if (!correctedWords.length) return false;

  const baseSet = new Set(baseWords);
  const shared = correctedWords.filter((entry) => baseSet.has(entry)).length;
  return shared >= Math.max(1, Math.floor(correctedWords.length * 0.4));
}

function extractLlmCorrectedText(payload = null) {
  if (!payload || typeof payload !== 'object') return '';
  return normalizeSurfaceSpacing(String(payload.corrected_text || payload.correctedText || '').trim());
}

async function smoothRequestText(text = '', opts = {}) {
  const localResult = smoothRequestTextSync(text, opts);
  const callStructuredLlmJsonImpl = opts.callStructuredLlmJson || callStructuredLlmJson;

  if (!shouldUseRequestTextSmootherLlm(localResult, {
    ...opts,
    callStructuredLlmJson: callStructuredLlmJsonImpl,
  })) {
    return localResult;
  }

  try {
    const llmPayload = await callStructuredLlmJsonImpl({
      text: [
        `Texte original : ${localResult.originalText}`,
        `Version locale : ${localResult.text}`,
      ].join('\n'),
      systemPrompt: REQUEST_TEXT_SMOOTHER_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 180,
      timeoutMs: Number(process.env.A11_REQUEST_TEXT_SMOOTHER_TIMEOUT_MS || 5000),
    });
    const correctedText = extractLlmCorrectedText(llmPayload);
    if (!correctedText) return localResult;
    if (!looksSafeLlmCorrection(localResult.text, correctedText)) return localResult;

    return normalizeSmootherResult({
      ...localResult,
      text: correctedText,
      changed: correctedText !== localResult.originalText,
      usedLlm: true,
      suspiciousTokens: getSuspiciousTokens(correctedText),
    }, localResult.originalText);
  } catch {
    return localResult;
  }
}

function attachRequestTextSmootherMeta(target = null, smootherResult = null) {
  if (!target || typeof target !== 'object') return target;
  const normalized = normalizeSmootherResult(smootherResult || {}, target?.meta?.sourceText || '');
  return {
    ...target,
    meta: {
      ...(target?.meta && typeof target.meta === 'object' ? target.meta : {}),
      sourceText: normalized.text || target?.meta?.sourceText || '',
      originalSourceText: normalized.originalText || target?.meta?.originalSourceText || '',
      requestTextSmoother: {
        applied: normalized.changed,
        usedLlm: normalized.usedLlm,
        smoothedText: normalized.text,
        correctionCount: normalized.localCorrections.length,
        localCorrections: normalized.localCorrections.slice(0, 8),
        suspiciousTokens: normalized.suspiciousTokens.slice(0, 6),
        noiseScore: normalized.noiseScore,
      },
    },
  };
}

module.exports = {
  REQUEST_LEXICON,
  REQUEST_TEXT_SMOOTHER_SYSTEM_PROMPT,
  attachRequestTextSmootherMeta,
  findBestLocalCorrection,
  normalizeSmootherResult,
  shouldUseRequestTextSmootherLlm,
  smoothRequestText,
  smoothRequestTextSync,
};

const {
  analyzeImagePrompt,
  normalizeImagePromptLiteral,
} = require('../mask/build-sd-prompt-bundle.cjs');

const RENDER_HINT_PATTERNS = [
  { key: 'cartoon', pattern: /\b(cartoon|cartoonesque|dessin anime|toon)\b/i },
  { key: 'anime', pattern: /\b(anime|manga|ghibli|one piece|naruto|dragon ball|pokemon)\b/i },
  { key: 'retro-game', pattern: /\b(mario 64|mario|donkey kong|zelda|nintendo|retro game|jeu retro)\b/i },
  { key: 'pixel-art', pattern: /\b(pixel art|pixel-art|8 ?bit|16 ?bit)\b/i },
  { key: 'photorealistic', pattern: /\b(photo|photorealiste|photorealistic|realiste|realistic)\b/i },
  { key: 'fantasy', pattern: /\b(fantasy|hogwarts|harry potter|wizard|magicien|zelda|dragon|elfe|princesse)\b/i },
];

const REFERENCE_HINT_PATTERNS = [
  { key: 'donkey kong', pattern: /\b(donkey kong|dk)\b/i },
  { key: 'mario 64', pattern: /\b(mario 64|super mario 64)\b/i },
  { key: 'mario', pattern: /\bmario\b/i },
  { key: 'one piece', pattern: /\bone piece\b/i },
  { key: 'ghibli', pattern: /\bghibli\b/i },
  { key: 'zelda', pattern: /\bzelda\b/i },
  { key: 'hogwarts', pattern: /\bhogwarts|harry potter\b/i },
];

const COLOR_TOKEN_PATTERN = /\b(orange|rouge|bleu|vert|jaune|violet|purple|red|blue|green|yellow|black|white|blanc|noir|rose|pink|marron|brown|gris|gray|grey|dore|gold|golden|argent|silver)\b/gi;
const STYLE_TOKEN_PATTERN = /\b(cartoon|cartoonesque|anime|manga|ghibli|pixel art|pixel-art|8 ?bit|16 ?bit|photo|photorealiste|photorealistic|realiste|realistic|fantasy)\b/gi;
const LEAD_IN_PATTERN = /^(?:(?:euh|heu|hum|bon|alors|ok|okay)\s+)*(?:salut|bonjour|bonsoir|hey|hello)\s+/i;
const FILLER_PREFIX_PATTERN = /^(?:(?:euh|heu|hum|bon|alors|stp|svp|please|peux[- ]?tu|tu peux|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+)+/i;
const REQUEST_PREFIX_PATTERN = /^(?:(?:peux[- ]?tu|tu peux|stp|svp|s il te plait|s'il te plaît|please|je veux|je voudrais|j aimerais|j'aimerais)\s+)*(?:fais[- ]?moi|donne[- ]?moi|genere|g[eé]n[eè]re|cree|cr[eée]e|dessine|fabrique|produis|prepare|pr[eé]pare|show me|montre[- ]?moi|montre|affiche[- ]?moi|affiche|fais voir|voir)\s+/i;
const SHOW_REQUEST_PATTERN = /\b(montre(?:-|\s)?moi|montre|montrer|affiche(?:-|\s)?moi|affiche|afficher|fais voir|je veux voir|je voudrais voir|j'aimerais voir)\b/i;

function mergeUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractRenderHints(text = '') {
  return RENDER_HINT_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.key);
}

function extractReferenceHints(text = '') {
  return REFERENCE_HINT_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.key);
}

function stripImageLeadIn(text = '') {
  let value = String(text || '').trim();
  let previous = null;

  while (value && value !== previous) {
    previous = value;
    value = value
      .replace(LEAD_IN_PATTERN, '')
      .replace(FILLER_PREFIX_PATTERN, '')
      .replace(REQUEST_PREFIX_PATTERN, '')
      .replace(/^(?:me\s+)?(?:faire|generer|g[eé]n[eè]rer|creer|cr[eé]er|dessiner|fabriquer|produire|preparer|pr[eé]parer)\s+/i, '')
      .trim();
  }

  return value;
}

function extractSceneDescription(text = '') {
  const normalized = normalizeImagePromptLiteral(text);
  const match = normalized.match(/\b(?:dans|in|inside|sur|on|au milieu de|au bord de)\b\s+(.+)$/i);
  if (!match) return '';
  return String(match[1] || '').trim();
}

function extractSubjectEntity(text = '', palette = [], renderHints = [], referenceHints = []) {
  let candidate = normalizeText(stripImageLeadIn(normalizeImagePromptLiteral(text)));
  candidate = candidate
    .replace(/\b(?:une?|des)\s+image[s]?\s+(?:de|d')\s*/i, '')
    .replace(/\b(?:image|illustration|dessin|photo|visuel|portrait)\s+(?:de|d')\s*/i, '')
    .replace(/\b(?:avec|dans|sur|au milieu de|au bord de)\b.*$/i, '')
    .replace(/\b(?:sortant|sorti|sortie)\b.*$/i, '')
    .trim();

  for (const renderHint of renderHints) {
    const escaped = renderHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    candidate = candidate.replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ').trim();
  }

  candidate = candidate.replace(STYLE_TOKEN_PATTERN, ' ').trim();
  candidate = candidate.replace(COLOR_TOKEN_PATTERN, ' ').trim();
  candidate = candidate.replace(/^(?:un|une|des|du|de la|de l|d['’])\s+/i, '').trim();
  candidate = candidate.replace(/\s+/g, ' ').trim();

  if (referenceHints.length && candidate) {
    for (const reference of referenceHints) {
      const normalizedCandidate = normalizeText(candidate);
      const normalizedReference = normalizeText(reference);
      if (normalizedCandidate === normalizedReference || normalizedCandidate.includes(normalizedReference)) {
        return reference;
      }
    }
  }

  if (!candidate && referenceHints.length) return referenceHints[0];
  return candidate;
}

function looksLikeShowRequest(text = '') {
  const normalized = normalizeText(text);
  return SHOW_REQUEST_PATTERN.test(normalized);
}

function buildPromptSeed(text = '', semanticAnalysis = null) {
  const details = analyzeImagePrompt(text, { preferLiteralColor: true });
  const normalized = normalizeText(text);
  const renderHints = mergeUniqueStrings([
    ...extractRenderHints(normalized),
    ...(details?.styleHints || [])
      .map((entry) => {
        const lower = normalizeText(entry);
        if (lower.includes('anime') || lower.includes('manga')) return 'anime';
        if (lower.includes('cartoon')) return 'cartoon';
        if (lower.includes('fantasy')) return 'fantasy';
        if (lower.includes('photorealistic')) return 'photorealistic';
        return '';
      })
      .filter(Boolean),
  ]);
  const referenceHints = extractReferenceHints(normalized);
  const sceneDescription = extractSceneDescription(text);
  const palette = mergeUniqueStrings(details?.palette || []);
  const subjectEntity = extractSubjectEntity(text, palette, renderHints, referenceHints)
    || String(semanticAnalysis?.subject || '').trim()
    || String(details?.subjectText || '').trim();

  return {
    normalizedText: normalized,
    promptDetails: details,
    renderHints,
    referenceHints,
    sceneDescription,
    palette,
    subjectEntity,
    styleHints: mergeUniqueStrings(details?.styleHints || []),
    compositionHints: mergeUniqueStrings(details?.compositionHints || []),
    showIntent: looksLikeShowRequest(text),
  };
}

module.exports = {
  buildPromptSeed,
  mergeUniqueStrings,
  normalizeText,
  stripImageLeadIn,
  extractRenderHints,
  extractReferenceHints,
  extractSceneDescription,
  extractSubjectEntity,
  looksLikeShowRequest,
};

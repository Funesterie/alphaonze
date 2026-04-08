function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isDefinitionLookupEnabled(explicitValue) {
  if (explicitValue !== undefined) {
    return explicitValue === true || isTruthy(explicitValue);
  }
  const envValue = process.env.A11_ENABLE_DEFINITION_LOOKUP;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

const LOOKUP_ELIGIBLE_INTENTS = new Set([
  'image.generate',
  'web.search',
  'web.image.search',
]);

const SIMPLE_COLOR_WORDS = new Set([
  'rouge',
  'bleu',
  'bleue',
  'vert',
  'verte',
  'jaune',
  'violet',
  'violette',
  'orange',
  'rose',
  'blanc',
  'blanche',
  'noir',
  'noire',
  'marron',
  'gris',
  'grise',
  'dore',
  'doré',
  'dorée',
  'argent',
  'argente',
  'argenté',
  'argentée',
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'pink',
  'white',
  'black',
  'brown',
  'gray',
  'grey',
  'gold',
  'golden',
  'silver',
]);

const KNOWN_IMAGE_SUBJECT_TERMS = new Set([
  'animal',
  'avatar',
  'batman',
  'bicyclette',
  'bird',
  'bouteille',
  'butterfly',
  'canette',
  'carotte',
  'cat',
  'cerise',
  'champignon',
  'chat',
  'chien',
  'citrouille',
  'cochon',
  'courgette',
  'cow',
  'creature',
  'créature',
  'dragon',
  'frog',
  'fraise',
  'fox',
  'goku',
  'grenouille',
  'hedgehog',
  'herisson',
  'héros',
  'hero',
  'lapin',
  'lion',
  'licorne',
  'mario',
  'monstre',
  'mushroom',
  'ours',
  'oiseau',
  'panda',
  'papillon',
  'personnage',
  'phoenix',
  'phénix',
  'pig',
  'pikachu',
  'poisson',
  'pokemon',
  'pomme',
  'rabbit',
  'rat',
  'renard',
  'robin',
  'strawberry',
  'tigre',
  'tomate',
  'tortue',
  'turtle',
  'unicorn',
  'vegeta',
  'velo',
  'vélo',
  'vache',
  'zelda',
]);

function getPrimaryIntentType(semanticAnalysis = null, heuristicWazaa = null) {
  return String(
    semanticAnalysis?.decision?.selectedIntentType
    || semanticAnalysis?.topIntents?.[0]?.type
    || heuristicWazaa?.intent?.type
    || heuristicWazaa?.intents?.[0]?.type
    || ''
  ).trim();
}

function getSubjectEntity(heuristicWazaa = null) {
  if (!Array.isArray(heuristicWazaa?.entities)) return '';
  const entry = heuristicWazaa.entities.find((item) => String(item?.role || '').trim() === 'subject');
  return String(entry?.value || '').trim();
}

function sanitizeLookupCandidate(value = '') {
  let candidate = String(value || '').trim();
  if (!candidate) return '';

  candidate = candidate
    .replace(/^(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+/i, '')
    .replace(/^que\s+tu\s+/i, '')
    .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche|cherche|recherche|trouve|definis|defini|explique)\s+(?:moi\s+)?/i, '')
    .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait|definition|définition|contexte|explication)\s+(?:de|du|de la|de l['’]?|d['’])?\s*/i, '')
    .replace(/\b(?:avec|dans|sur|au milieu de|au bord de|sous|portant|tenant|sortant|sorti|sortie)\b.*$/i, '')
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d['’]|le|la|les)\s+/i, '')
    .trim();

  const tokens = candidate.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && SIMPLE_COLOR_WORDS.has(normalizeText(tokens[tokens.length - 1]))) {
    tokens.pop();
  }

  candidate = tokens.join(' ').trim();
  if (!candidate) return '';
  if (/\b(?:image of|generate|genere|dessine|create|draw|show me|search|find)\b/i.test(candidate)) return '';
  return candidate;
}

function buildDefinitionLookupQuery({
  userText = '',
  semanticAnalysis = null,
  heuristicWazaa = null,
} = {}) {
  const semanticSubject = String(semanticAnalysis?.subject || '').trim();
  const wazaaSubject = getSubjectEntity(heuristicWazaa);
  return sanitizeLookupCandidate(semanticSubject)
    || sanitizeLookupCandidate(wazaaSubject)
    || sanitizeLookupCandidate(userText);
}

function looksLikeUnknownSubject(query = '') {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 3) return false;
  const lexicalTokens = tokens.filter((entry) => !SIMPLE_COLOR_WORDS.has(entry));
  if (!lexicalTokens.length) return false;
  return lexicalTokens.every((entry) => !KNOWN_IMAGE_SUBJECT_TERMS.has(entry));
}

function shouldLookupDefinitionContext({
  userText = '',
  semanticAnalysis = null,
  heuristicWazaa = null,
  enabled,
} = {}) {
  if (!isDefinitionLookupEnabled(enabled)) return false;
  if (!String(userText || '').trim()) return false;

  const intentType = getPrimaryIntentType(semanticAnalysis, heuristicWazaa);
  if (!LOOKUP_ELIGIBLE_INTENTS.has(intentType)) return false;

  const confidence = Number(
    semanticAnalysis?.summary?.confidence
    || heuristicWazaa?.intent?.confidence
    || heuristicWazaa?.signal?.confidence
    || 0
  );
  const ambiguities = Array.isArray(semanticAnalysis?.ambiguities)
    ? semanticAnalysis.ambiguities
    : (Array.isArray(heuristicWazaa?.ambiguities) ? heuristicWazaa.ambiguities : []);
  const query = buildDefinitionLookupQuery({ userText, semanticAnalysis, heuristicWazaa });
  const subjectMissing = !query;
  const heuristicSubjectMissing = !sanitizeLookupCandidate(getSubjectEntity(heuristicWazaa));
  const unknownSubject = looksLikeUnknownSubject(query);
  return (
    subjectMissing
    || ambiguities.length > 0
    || confidence < 0.58
    || (heuristicSubjectMissing && confidence < 0.72)
    || (unknownSubject && confidence < 0.82)
  );
}

async function fetchJson(url, fetchImpl, options = {}) {
  const response = await fetchImpl(url, options);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function lookupWikipediaDefinition(query, fetchImpl, language = 'fr') {
  const searchUrl = `https://${language}.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&origin=*&search=${encodeURIComponent(query)}`;
  const search = await fetchJson(searchUrl, fetchImpl);
  const titles = Array.isArray(search?.[1]) ? search[1] : [];
  const descriptions = Array.isArray(search?.[2]) ? search[2] : [];
  const urls = Array.isArray(search?.[3]) ? search[3] : [];
  const title = String(titles[0] || '').trim();
  const url = String(urls[0] || '').trim();
  let summary = String(descriptions[0] || '').trim();

  if (title && !summary) {
    const summaryUrl = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryPayload = await fetchJson(summaryUrl, fetchImpl, {
      headers: { 'Accept': 'application/json' },
    });
    summary = String(summaryPayload?.extract || '').trim();
  }

  if (!title || !summary) return null;
  return {
    term: query,
    title,
    summary: summary.replace(/\s+/g, ' ').trim().slice(0, 320),
    url,
    source: 'wikipedia',
    language,
  };
}

async function lookupDuckDuckGoDefinition(query, fetchImpl) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1&t=a11`;
  const payload = await fetchJson(url, fetchImpl);
  if (!payload || typeof payload !== 'object') return null;

  const abstractText = String(payload.AbstractText || '').trim();
  const heading = String(payload.Heading || '').trim();
  const abstractUrl = String(payload.AbstractURL || '').trim();
  if (!abstractText && !heading) return null;

  return {
    term: query,
    title: heading || query,
    summary: (abstractText || heading).replace(/\s+/g, ' ').trim().slice(0, 320),
    url: abstractUrl,
    source: 'duckduckgo',
    language: 'unknown',
  };
}

async function lookupDefinitionContext(input = {}, options = {}) {
  const query = typeof input === 'string'
    ? String(input || '').trim()
    : String(input?.query || '').trim();
  if (!query) return null;

  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;

  try {
    return await lookupWikipediaDefinition(query, fetchImpl, 'fr')
      || await lookupWikipediaDefinition(query, fetchImpl, 'en')
      || await lookupDuckDuckGoDefinition(query, fetchImpl);
  } catch {
    return null;
  }
}

function mergeDefinitionContextIntoWazaa(wazaa = null, definitionContext = null, sourceText = '') {
  if (!wazaa || typeof wazaa !== 'object' || !definitionContext || typeof definitionContext !== 'object') {
    return wazaa;
  }

  const entities = Array.isArray(wazaa.entities) ? [...wazaa.entities] : [];
  const hasSubject = entities.some((entry) => String(entry?.role || '').trim() === 'subject' && String(entry?.value || '').trim());
  const title = String(definitionContext.title || definitionContext.term || '').trim();
  if (!hasSubject && title) {
    entities.unshift({
      value: title,
      role: 'subject',
      weight: 0.61,
      source: 'definition_lookup',
    });
  }

  return {
    ...wazaa,
    entities,
    meta: {
      ...(wazaa.meta && typeof wazaa.meta === 'object' ? wazaa.meta : {}),
      ...(sourceText ? { sourceText } : {}),
      definitionLookup: {
        term: String(definitionContext.term || '').trim(),
        title,
        summary: String(definitionContext.summary || '').trim(),
        url: String(definitionContext.url || '').trim(),
        source: String(definitionContext.source || '').trim(),
        language: String(definitionContext.language || '').trim(),
      },
    },
  };
}

module.exports = {
  buildDefinitionLookupQuery,
  isDefinitionLookupEnabled,
  lookupDefinitionContext,
  mergeDefinitionContextIntoWazaa,
  sanitizeLookupCandidate,
  shouldLookupDefinitionContext,
};

const {
  lookupDefinitionContext: defaultLookupDefinitionContext,
} = require('./definition-context.cjs');

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .toLowerCase();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isImageEntityResolverEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_ENTITY_RESOLVER;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function sanitizeEntityLookupCandidate(value = '') {
  return normalizeText(value)
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d['’]|le|la|les)\s+/i, '')
    .replace(/\b(?:avec|dans|sur|sous|au milieu de|au bord de|près de|pres de|tenant|portant|sortant|sortie|sorti)\b.*$/i, '')
    .trim();
}

function buildImageEntityLookupQuery(mask = {}) {
  const candidates = [
    mask?.meta?.imageEntityContext?.canonicalSubject,
    mask?.meta?.canonicalSubject,
    mask?.meta?.subjectProfile?.canonicalSubject,
    mask?.inputs?.subject?.[0],
    mask?.meta?.definitionLookup?.title,
    mask?.meta?.definitionLookup?.term,
    mask?.raw,
  ];

  for (const candidate of candidates) {
    const cleaned = sanitizeEntityLookupCandidate(candidate);
    if (cleaned) return cleaned;
  }

  return '';
}

function looksLikeNamedReference(mask = {}) {
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const raw = normalizeLookup(mask?.raw || '');
  const query = normalizeLookup(buildImageEntityLookupQuery(mask));
  return (
    subjectProfileType === 'reference_character'
    || /\d/.test(raw)
    || query.split(/\s+/).filter(Boolean).length >= 2
  );
}

function shouldResolveImageEntityContext({
  mask = {},
  selection = null,
  enabled,
} = {}) {
  if (!isImageEntityResolverEnabled(enabled)) return false;
  if (String(mask?.intent || '').trim() !== 'image.generate') return false;
  if (mask?.meta?.imageEntityContext && typeof mask.meta.imageEntityContext === 'object') return false;

  const query = buildImageEntityLookupQuery(mask);
  if (!query) return false;

  const confidence = Number(mask?.meta?.semantic?.confidence || 0);
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const hasDefinition = Boolean(mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object');

  return (
    selection?.candidate === true
    || hasDefinition
    || confidence < 0.72
    || ['reference_character', 'pokemon_creature', 'single_human_figure'].includes(subjectProfileType)
    || looksLikeNamedReference(mask)
  );
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'A11-ImageEntityResolver/1.0',
    },
  });
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function searchWikidataEntities(query, fetchImpl, language = 'fr') {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}&uselang=${encodeURIComponent(language)}&type=item&limit=5&format=json&origin=*`;
  const payload = await fetchJson(url, fetchImpl);
  return Array.isArray(payload?.search) ? payload.search : [];
}

function textContainsToken(text = '', token = '') {
  const normalizedText = normalizeLookup(text);
  const normalizedToken = normalizeLookup(token);
  if (!normalizedText || !normalizedToken) return false;
  return new RegExp(`(^|\\b)${normalizedToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(\\b|$)`, 'i').test(normalizedText);
}

function pickWikidataCandidate(results = [], query = '', mask = {}) {
  const normalizedQuery = normalizeLookup(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const raw = normalizeLookup(mask?.raw || '');
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');

  const ranked = (Array.isArray(results) ? results : [])
    .map((entry) => {
      const label = normalizeText(entry?.label || entry?.display?.label?.value || '');
      const description = normalizeText(entry?.description || entry?.display?.description?.value || '');
      const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
      const haystack = [label, description, ...aliases].join(' ');
      let score = 0;

      if (normalizedQuery && textContainsToken(label, normalizedQuery)) score += 240;
      if (normalizedQuery && aliases.some((alias) => textContainsToken(alias, normalizedQuery))) score += 200;
      if (normalizedQuery && normalizeLookup(label) === normalizedQuery) score += 320;

      for (const token of queryTokens) {
        if (textContainsToken(haystack, token)) score += 35;
      }

      if (subjectProfileType === 'reference_character' && /\b(personnage|fiction|jeu video|video game|anime|manga|cartoon|super hero|super-soldat|heroine|héroïne)\b/i.test(normalizeLookup(description))) {
        score += 80;
      }
      if (/\d/.test(raw) && /\d/.test([label, ...aliases].join(' '))) {
        score += 40;
      }

      return {
        ...entry,
        label,
        description,
        aliases,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || right.label.length - left.label.length);

  return ranked[0] || null;
}

async function fetchWikidataEntityData(entityId, fetchImpl) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`;
  const payload = await fetchJson(url, fetchImpl);
  if (!payload?.entities || typeof payload.entities !== 'object') return null;
  return payload.entities[entityId] || null;
}

function getLocalizedValue(bucket = null, languages = ['fr', 'en']) {
  if (!bucket || typeof bucket !== 'object') return '';
  for (const language of languages) {
    const value = normalizeText(bucket?.[language]?.value || '');
    if (value) return value;
  }
  const firstValue = Object.values(bucket)
    .map((entry) => normalizeText(entry?.value || ''))
    .find(Boolean);
  return firstValue || '';
}

function getLocalizedAliases(bucket = null, languages = ['fr', 'en']) {
  if (!bucket || typeof bucket !== 'object') return [];
  const ordered = [];
  for (const language of languages) {
    const values = Array.isArray(bucket?.[language]) ? bucket[language] : [];
    ordered.push(...values.map((entry) => normalizeText(entry?.value || '')).filter(Boolean));
  }
  if (!ordered.length) {
    for (const values of Object.values(bucket)) {
      if (!Array.isArray(values)) continue;
      ordered.push(...values.map((entry) => normalizeText(entry?.value || '')).filter(Boolean));
    }
  }
  return toUniqueStrings(ordered);
}

function getPreferredWikipediaLink(entity = null) {
  const sitelinks = entity?.sitelinks && typeof entity.sitelinks === 'object'
    ? entity.sitelinks
    : {};

  const preferred = sitelinks.frwiki || sitelinks.enwiki || null;
  if (!preferred) return { title: '', url: '' };

  return {
    title: normalizeText(preferred?.title || ''),
    url: normalizeText(preferred?.url || ''),
  };
}

function inferUniverseFromText(value = '') {
  const normalized = normalizeLookup(value);
  if (!normalized) return '';

  const patterns = [
    /\bunivers\s+([a-z0-9][a-z0-9 '\-]{1,40})/i,
    /\bfranchise\s+([a-z0-9][a-z0-9 '\-]{1,40})/i,
    /\bsaga\s+([a-z0-9][a-z0-9 '\-]{1,40})/i,
    /\bserie\s+([a-z0-9][a-z0-9 '\-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const candidate = normalizeText(match?.[1] || '');
    if (candidate) {
      return candidate
        .split(/\s+/)
        .map((entry) => entry ? entry[0].toUpperCase() + entry.slice(1) : entry)
        .join(' ');
    }
  }

  return '';
}

function inferEntityTypeFromText(value = '', subjectProfileType = '') {
  const normalized = normalizeLookup(value);
  if (/\b(personnage|fiction|hero|heros|heroine|héroïne|super-soldat|super soldat|cartoon|anime|manga|super hero)\b/.test(normalized)) {
    return 'fictional_character';
  }
  if (/\b(pokemon|pokémon|creature|créature|dragon|phenix|phénix|monstre)\b/.test(normalized)) {
    return 'fictional_creature';
  }
  if (/\b(animal|oiseau|mammifere|mammifère|lapin|chat|chien|faucon|aigle)\b/.test(normalized)) {
    return 'animal';
  }
  if (/\b(fruit|legume|légume|aliment|boisson|objet|outil|vehicule|véhicule)\b/.test(normalized)) {
    return 'object';
  }

  if (subjectProfileType === 'reference_character') return 'fictional_character';
  if (subjectProfileType === 'pokemon_creature' || subjectProfileType === 'mythic_creature' || subjectProfileType === 'phoenix_creature') {
    return 'fictional_creature';
  }
  if (subjectProfileType === 'single_animal') return 'animal';
  if (subjectProfileType === 'simple_food_object' || subjectProfileType === 'container_object') return 'object';
  return '';
}

async function resolveImageEntityContext({
  mask = {},
  selection = null,
  lookupDefinitionContext = defaultLookupDefinitionContext,
  fetch = globalThis.fetch,
  enabled,
} = {}) {
  if (!shouldResolveImageEntityContext({ mask, selection, enabled })) return null;
  if (typeof fetch !== 'function') return null;

  const query = buildImageEntityLookupQuery(mask);
  if (!query) return null;

  const frenchResults = await searchWikidataEntities(query, fetch, 'fr');
  const searchResults = frenchResults.length
    ? frenchResults
    : await searchWikidataEntities(query, fetch, 'en');
  const best = pickWikidataCandidate(searchResults, query, mask);
  if (!best?.id) return null;

  let entity = null;
  try {
    entity = await fetchWikidataEntityData(best.id, fetch);
  } catch {
    entity = null;
  }

  const existingCanonicalSubject = normalizeText(
    mask?.meta?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || ''
  );
  const label = normalizeText(
    getLocalizedValue(entity?.labels)
    || best.label
    || query
  );
  const description = normalizeText(
    getLocalizedValue(entity?.descriptions)
    || best.description
  );
  const aliases = toUniqueStrings([
    ...getLocalizedAliases(entity?.aliases),
    ...(Array.isArray(best.aliases) ? best.aliases.map((entry) => normalizeText(entry)) : []),
  ]).slice(0, 8);
  const canonicalSubject = existingCanonicalSubject || label;
  const wikipedia = getPreferredWikipediaLink(entity);

  let definitionContext = null;
  if (typeof lookupDefinitionContext === 'function') {
    try {
      definitionContext = await lookupDefinitionContext({
        query: canonicalSubject || label || query,
      });
    } catch {
      definitionContext = null;
    }
  }

  const summary = normalizeText(definitionContext?.summary || '');
  const universe = inferUniverseFromText([
    description,
    summary,
    normalizeText(best?.description || ''),
  ].filter(Boolean).join('. '));
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const entityType = inferEntityTypeFromText([description, summary].join('. '), subjectProfileType);

  const hintFacts = toUniqueStrings([
    canonicalSubject ? `Sujet canonique : ${canonicalSubject}` : '',
    description ? `Repère d'entité : ${description}` : '',
    summary ? `Contexte encyclopédique : ${summary}` : '',
    universe ? `Univers probable : ${universe}` : '',
  ]).slice(0, 4);

  return {
    query,
    wikidataId: normalizeText(best.id || ''),
    canonicalSubject,
    label,
    description,
    aliases,
    wikipediaTitle: wikipedia.title || normalizeText(definitionContext?.title || ''),
    wikipediaUrl: wikipedia.url || normalizeText(definitionContext?.url || ''),
    summary,
    universe,
    entityType,
    source: 'wikidata',
    hintFacts,
    score: Number(best.score || 0),
  };
}

module.exports = {
  buildImageEntityLookupQuery,
  isImageEntityResolverEnabled,
  resolveImageEntityContext,
  shouldResolveImageEntityContext,
};

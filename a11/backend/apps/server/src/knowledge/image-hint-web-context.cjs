const { lookupDefinitionContext: defaultLookupDefinitionContext } = require('./definition-context.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../../lib/image-search.cjs');

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

function isImageHintWebLookupEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_HINT_WEB_LOOKUP;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function isImageWebDraftEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_WEB_DRAFT_ENABLED;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function extractSourceDomain(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return String(new URL(raw).hostname || '').replace(/^www\./i, '').trim();
  } catch {
    return '';
  }
}

function buildImageHintLookupQuery(mask = {}) {
  const subject = normalizeText(mask?.meta?.canonicalSubject || mask?.inputs?.subject?.[0] || '');
  const accessories = toUniqueStrings((mask?.meta?.semantic?.accessories || []).map((entry) => entry?.label || entry?.key || entry));
  const elements = toUniqueStrings((mask?.meta?.semantic?.elements || []).map((entry) => entry?.label || entry?.key || entry));
  const metiers = toUniqueStrings((mask?.meta?.semantic?.metiers || []).map((entry) => entry?.label || entry?.key || entry));

  const pieces = [
    subject,
    accessories[0] || '',
    elements[0] || '',
    metiers[0] || '',
  ].filter(Boolean);

  return toUniqueStrings(pieces).join(' ').trim();
}

function shouldLookupImageHintWebContext({ mask = {}, selection = null, enabled } = {}) {
  if (!isImageHintWebLookupEnabled(enabled)) return false;
  if (String(mask?.intent || '').trim() !== 'image.generate') return false;

  const confidence = Number(mask?.meta?.semantic?.confidence || 0);
  const hasDefinition = Boolean(mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object');
  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  const hasRelation = /\b(avec|dans|sur|tenant|portant|sortant|sortie|sorti)\b/i.test(String(mask?.raw || ''));

  return (
    selection?.candidate === true
    || confidence < 0.66
    || !subjectProfileType
    || hasRelation
    || hasDefinition
  );
}

async function lookupImageHintWebContext({
  mask = {},
  selection = null,
  lookupDefinitionContext = defaultLookupDefinitionContext,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
  enabled,
} = {}) {
  if (!shouldLookupImageHintWebContext({ mask, selection, enabled })) {
    return null;
  }

  const query = buildImageHintLookupQuery(mask);
  if (!query) return null;

  let definition = null;
  let imageResult = null;

  if (typeof lookupDefinitionContext === 'function') {
    try {
      definition = await lookupDefinitionContext({ query });
    } catch {
      definition = null;
    }
  }

  if (typeof duckduckgoImageSearch === 'function') {
    try {
      imageResult = await duckduckgoImageSearch(query);
    } catch {
      imageResult = null;
    }
  }

  const summary = normalizeText(definition?.summary || '');
  const title = normalizeText(definition?.title || definition?.term || '');
  const sourceUrl = normalizeText(definition?.url || imageResult?.source_url || '');
  const sourceDomain = extractSourceDomain(sourceUrl);
  const imageTitle = normalizeText(imageResult?.title || '');

  const hintFacts = toUniqueStrings([
    title ? `Sujet recherché : ${title}` : '',
    summary ? `Contexte web : ${summary}` : '',
    imageTitle ? `Repère image web : ${imageTitle}` : '',
    sourceDomain ? `Source web : ${sourceDomain}` : '',
  ]).slice(0, 4);

  if (!hintFacts.length) return null;

  return {
    query,
    title,
    summary,
    sourceUrl,
    sourceDomain,
    imageTitle,
    imageUrl: normalizeText(imageResult?.image_url || ''),
    imageSourceUrl: normalizeText(imageResult?.source_url || ''),
    imageWidth: Number(imageResult?.width || 0) || null,
    imageHeight: Number(imageResult?.height || 0) || null,
    hintFacts,
  };
}

function normalizeStrength(value, fallback = 0.45) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.18, Math.min(0.78, numeric));
}

function shouldUseImageWebDraft({
  mask = {},
  selection = null,
  webHintContext = null,
  enabled,
} = {}) {
  if (!isImageWebDraftEnabled(enabled)) return false;
  if (String(mask?.intent || '').trim() !== 'image.generate') return false;
  if (!normalizeText(webHintContext?.imageUrl || '')) return false;

  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  const hasRelation = /\b(avec|dans|sur|tenant|portant|sortant|sortie|sorti)\b/i.test(String(mask?.raw || ''));

  return (
    selection?.compartment === 'special'
    || selection?.candidate === true
    || hasRelation
    || [
      'reference_character',
      'single_human_figure',
      'pokemon_creature',
      'phoenix_creature',
      'mythic_creature',
    ].includes(subjectProfileType)
  );
}

function resolveImageWebDraft({
  mask = {},
  selection = null,
  webHintContext = null,
  enabled,
  strength,
} = {}) {
  if (!shouldUseImageWebDraft({ mask, selection, webHintContext, enabled })) {
    return null;
  }

  const initImageUrl = normalizeText(webHintContext?.imageUrl || '');
  if (!initImageUrl) return null;

  const configuredStrength = strength !== undefined
    ? strength
    : (mask?.options?.strength ?? process.env.A11_IMAGE_WEB_DRAFT_STRENGTH);

  return {
    mode: 'web-image-draft',
    query: normalizeText(webHintContext?.query || ''),
    title: normalizeText(webHintContext?.imageTitle || webHintContext?.title || ''),
    initImageUrl,
    sourceUrl: normalizeText(webHintContext?.imageSourceUrl || webHintContext?.sourceUrl || ''),
    sourceDomain: normalizeText(webHintContext?.sourceDomain || ''),
    strength: normalizeStrength(configuredStrength, 0.45),
    width: Number(webHintContext?.imageWidth || 0) || null,
    height: Number(webHintContext?.imageHeight || 0) || null,
  };
}

module.exports = {
  buildImageHintLookupQuery,
  isImageHintWebLookupEnabled,
  isImageWebDraftEnabled,
  lookupImageHintWebContext,
  resolveImageWebDraft,
  shouldLookupImageHintWebContext,
  shouldUseImageWebDraft,
};

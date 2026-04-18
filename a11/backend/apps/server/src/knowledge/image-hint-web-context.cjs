const { lookupDefinitionContext: defaultLookupDefinitionContext } = require('./definition-context.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../../lib/image-search.cjs');
const { compileCharacterCountConstraints } = require('../mask/build-sd-prompt-bundle.cjs');

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

function normalizeArrayLabels(values = []) {
  return toUniqueStrings(
    (Array.isArray(values) ? values : [])
      .map((entry) => entry?.label || entry?.key || entry)
  );
}

function hasStrongPromptTransform(mask = {}) {
  const raw = normalizeLookup(mask?.raw || '');
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const accessoryLabels = normalizeArrayLabels(semantic?.accessories || []);
  const elementLabels = normalizeArrayLabels(semantic?.elements || []);

  return (
    accessoryLabels.length > 0
    || elementLabels.length > 0
    || /\b(fume|fumer|fumant|fumante|portant|tenant)\b/.test(raw)
    || /\bdans la bouche\b/.test(raw)
  );
}

function hasCompositionalSceneRequest(mask = {}) {
  const raw = normalizeLookup(mask?.raw || '');
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const accessories = normalizeArrayLabels(semantic?.accessories || []);
  const scenes = normalizeArrayLabels(semantic?.scenes || []);
  const metiers = normalizeArrayLabels(semantic?.metiers || []);

  return (
    /\b(avec|dans|sur|sous|devant|derriere|derrière|tenant|portant|en train de)\b/.test(raw)
    || accessories.length > 0
    || scenes.length > 0
    || metiers.length > 0
  );
}

function resolveEntityUniverse(mask = {}) {
  return normalizeText(
    mask?.meta?.imageEntityContext?.universe
    || mask?.meta?.imageScratchpad?.universe
    || ''
  );
}

function resolveSubjectProfileType(mask = {}) {
  return normalizeLookup(
    mask?.meta?.subjectProfile?.type
    || mask?.meta?.imageScratchpad?.subjectProfileType
    || ''
  );
}

function resolveScratchpadEntityType(mask = {}) {
  return normalizeLookup(
    mask?.meta?.imageScratchpad?.entityType
    || mask?.meta?.imageEntityContext?.entityType
    || ''
  );
}

function hasVolatileElementTransform(mask = {}) {
  const raw = normalizeLookup(mask?.raw || '');
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const elementFamilies = new Set(
    (Array.isArray(semantic?.elements) ? semantic.elements : [])
      .map((entry) => normalizeLookup(entry?.family || entry?.key || entry?.label || entry))
      .filter(Boolean)
  );

  return (
    elementFamilies.has('fire')
    || /\b(en feu|feu|flamme|flammes|incendie|embrase|embrasee|embrasé|burning|on fire|flaming)\b/.test(raw)
  );
}

function looksLikePhotoRequest(mask = {}) {
  const raw = normalizeLookup(mask?.raw || '');
  const styleWords = normalizeArrayLabels(mask?.meta?.semantic?.styles || [])
    .map((entry) => normalizeLookup(entry))
    .filter(Boolean);
  return (
    /\b(photo|photorealiste|photorealistic|realiste|realistic|portrait photo)\b/.test(raw)
    || styleWords.some((entry) => /\b(photo|photorealiste|photorealistic|realiste|realistic)\b/.test(entry))
  );
}

function buildReferenceCharacterQuery(mask = {}, subject = '') {
  const canonicalSubject = normalizeText(subject);
  const normalizedSubject = normalizeLookup(canonicalSubject);
  const entityUniverse = resolveEntityUniverse(mask);
  if (!canonicalSubject) return '';
  const artBias = looksLikePhotoRequest(mask) ? 'photo reference' : 'character art';

  if (entityUniverse && !new RegExp(`\\b${normalizeLookup(entityUniverse).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalizedSubject)) {
    return `${canonicalSubject} ${entityUniverse} ${artBias}`.trim();
  }

  if (/\bmaster chief\b|\bjohn 117\b|\bspartan 117\b/.test(normalizedSubject)) {
    return `${canonicalSubject} Halo ${artBias}`.trim();
  }

  if (/\bmario\b/.test(normalizedSubject)) {
    return `${canonicalSubject} Nintendo ${artBias}`.trim();
  }

  if (/\bprincesse peach\b|\bprincess peach\b|\bpeach\b/.test(normalizedSubject)) {
    return `${canonicalSubject} Nintendo ${artBias}`.trim();
  }

  if (/\bzelda\b/.test(normalizedSubject)) {
    return `${canonicalSubject} Nintendo ${artBias}`.trim();
  }

  return `${canonicalSubject} ${artBias}`.trim();
}

function buildImageHintLookupQuery(mask = {}) {
  const subject = normalizeText(
    mask?.meta?.imageEntityContext?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || mask?.meta?.canonicalSubject
    || mask?.inputs?.subject?.[0]
    || ''
  );
  const subjectProfileType = resolveSubjectProfileType(mask);
  const scratchpadEntityType = resolveScratchpadEntityType(mask);
  const accessories = normalizeArrayLabels(mask?.meta?.semantic?.accessories || []);
  const elements = normalizeArrayLabels(mask?.meta?.semantic?.elements || []);
  const metiers = normalizeArrayLabels(mask?.meta?.semantic?.metiers || []);
  const entityUniverse = resolveEntityUniverse(mask);
  const hasVolatileTransform = hasVolatileElementTransform(mask);

  if (subjectProfileType === 'reference_character') {
    return buildReferenceCharacterQuery(mask, subject);
  }

  const shouldSkipElementBias = (
    hasVolatileTransform
    && (
      [
        'single_animal',
        'single_human_figure',
        'reference_character',
        'pokemon_creature',
        'phoenix_creature',
        'mythic_creature',
      ].includes(subjectProfileType)
      || ['animal', 'human'].includes(scratchpadEntityType)
    )
  );

  const pieces = [
    subject,
    entityUniverse,
    accessories[0] || '',
    shouldSkipElementBias ? '' : (elements[0] || ''),
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
    imageSelectionScore: Number(imageResult?.selection_score || 0) || 0,
    imageSelectionReason: normalizeText(imageResult?.selection_reason || ''),
    hintFacts,
  };
}

function normalizeStrength(value, fallback = 0.45) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.18, Math.min(0.78, numeric));
}

function hasExplicitReferenceAnchorRequest(mask = {}) {
  const raw = normalizeLookup(mask?.raw || '');
  if (!raw) return false;
  return (
    /\b(reference|reference officielle|reference officiel|ref officielle|official art|art officiel)\b/.test(raw)
    || /\b(a partir de|a partir d une image|a partir d un visuel|depuis une image|depuis l image)\b/.test(raw)
    || /\b(inspire de|inspire toi de|base toi sur|reprends|retravaille|retouche)\b/.test(raw)
    || /\b(variation|variante|version alternative|meme pose|meme cadrage|pose similaire|same pose|same framing)\b/.test(raw)
  );
}

function isSimpleOriginalCharacterRequest(mask = {}) {
  const raw = normalizeLookup(mask?.raw || '');
  const tokenCount = raw.split(/\s+/).filter(Boolean).length;
  const subjectProfileType = resolveSubjectProfileType(mask);
  const hasExplicitPair = Boolean(compileCharacterCountConstraints(String(mask?.raw || '')));
  const hasRelation = /\b(avec|dans|sur|tenant|portant|sortant|sortie|sorti)\b/i.test(String(mask?.raw || ''));

  if (![
    'reference_character',
    'single_human_figure',
    'pokemon_creature',
    'single_animal',
    'mythic_creature',
    'phoenix_creature',
  ].includes(subjectProfileType)) {
    return false;
  }

  return (
    !hasExplicitPair
    && !hasRelation
    && !hasStrongPromptTransform(mask)
    && !hasVolatileElementTransform(mask)
    && tokenCount <= 8
  );
}

function looksLikeCompositeWebImageContext(webHintContext = null) {
  const width = Number(webHintContext?.imageWidth || 0);
  const height = Number(webHintContext?.imageHeight || 0);
  const longestSide = Math.max(width, height, 0);
  const shortestSide = Math.max(1, Math.min(width || 1, height || 1));
  const aspectRatio = longestSide / shortestSide;
  const combinedText = normalizeLookup([
    webHintContext?.title,
    webHintContext?.imageTitle,
    webHintContext?.sourceUrl,
    webHintContext?.imageSourceUrl,
    webHintContext?.sourceDomain,
  ].filter(Boolean).join(' '));

  return (
    /\b(lineup|sheet|sprite|spritesheet|collage|mosaic|panel|poster|wallpaper|crew|group|team|characters|personnages|cover)\b/.test(combinedText)
    || (longestSide >= 1000 && aspectRatio >= 1.5)
  );
}

function shouldRejectCharacterDraftImage(mask = {}, webHintContext = null) {
  const subjectProfileType = resolveSubjectProfileType(mask);
  if (!['reference_character', 'pokemon_creature'].includes(subjectProfileType)) {
    return false;
  }

  const combinedText = normalizeLookup([
    webHintContext?.title,
    webHintContext?.imageTitle,
    webHintContext?.sourceUrl,
    webHintContext?.imageSourceUrl,
    webHintContext?.sourceDomain,
  ].filter(Boolean).join(' '));

  if (!combinedText) return false;

  return /\b(cosplay|costume|peluche|plush|figurine|toy|doll|poupee|poupee|girl|woman|boy|man|person|people|costumed)\b/.test(combinedText);
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

  const subjectProfileType = resolveSubjectProfileType(mask);
  const scratchpadEntityType = resolveScratchpadEntityType(mask);
  const hasExplicitPair = Boolean(compileCharacterCountConstraints(String(mask?.raw || '')));
  const hasRelation = /\b(avec|dans|sur|tenant|portant|sortant|sortie|sorti)\b/i.test(String(mask?.raw || ''));
  const hasStrongTransform = hasStrongPromptTransform(mask);
  const hasCompositionalScene = hasCompositionalSceneRequest(mask);
  const hasVolatileTransform = hasVolatileElementTransform(mask);
  const explicitReferenceAnchor = hasExplicitReferenceAnchorRequest(mask);
  const simpleOriginalCharacterRequest = isSimpleOriginalCharacterRequest(mask);
  const compositeRisk = looksLikeCompositeWebImageContext(webHintContext);
  const imageSelectionScore = Number(webHintContext?.imageSelectionScore || 0);

  if (hasExplicitPair) {
    return false;
  }

  if (['simple_food_object', 'container_object', 'single_plant_object'].includes(subjectProfileType)) {
    return false;
  }

  if (
    hasVolatileTransform
    && (
      [
        'single_animal',
        'single_human_figure',
        'reference_character',
        'pokemon_creature',
        'phoenix_creature',
        'mythic_creature',
      ].includes(subjectProfileType)
      || ['animal', 'human'].includes(scratchpadEntityType)
    )
  ) {
    return false;
  }

  if (
    hasStrongTransform
    && [
      'reference_character',
      'single_human_figure',
      'pokemon_creature',
      'phoenix_creature',
      'mythic_creature',
      'single_animal',
    ].includes(subjectProfileType)
  ) {
    return false;
  }

  if (compositeRisk && !explicitReferenceAnchor) {
    return false;
  }

  if (hasCompositionalScene && !explicitReferenceAnchor) {
    return false;
  }

  if (imageSelectionScore < 2 && !explicitReferenceAnchor) {
    return false;
  }

  if (simpleOriginalCharacterRequest && !explicitReferenceAnchor) {
    return false;
  }

  return (
    explicitReferenceAnchor
    || (
      !simpleOriginalCharacterRequest
      && (
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
      )
    )
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
  if (shouldRejectCharacterDraftImage(mask, webHintContext)) return null;

  const configuredStrength = strength !== undefined
    ? strength
    : (mask?.options?.strength ?? process.env.A11_IMAGE_WEB_DRAFT_STRENGTH);
  const explicitReferenceAnchor = hasExplicitReferenceAnchorRequest(mask);
  const compositeRisk = looksLikeCompositeWebImageContext(webHintContext);

  return {
    mode: 'web-image-draft',
    reason: explicitReferenceAnchor ? 'explicit_reference_anchor' : 'automatic_web_anchor',
    query: normalizeText(webHintContext?.query || ''),
    title: normalizeText(webHintContext?.imageTitle || webHintContext?.title || ''),
    initImageUrl,
    sourceUrl: normalizeText(webHintContext?.imageSourceUrl || webHintContext?.sourceUrl || ''),
    sourceDomain: normalizeText(webHintContext?.sourceDomain || ''),
    strength: normalizeStrength(configuredStrength, 0.45),
    width: Number(webHintContext?.imageWidth || 0) || null,
    height: Number(webHintContext?.imageHeight || 0) || null,
    imageSelectionScore: Number(webHintContext?.imageSelectionScore || 0) || 0,
    imageSelectionReason: normalizeText(webHintContext?.imageSelectionReason || ''),
    explicitReferenceAnchor,
    compositeRisk,
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

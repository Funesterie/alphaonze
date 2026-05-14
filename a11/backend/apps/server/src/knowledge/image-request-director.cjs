const { callStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');
const { lookupDefinitionContext: defaultLookupDefinitionContext } = require('./definition-context.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../../lib/image-search.cjs');

const IMAGE_REQUEST_DIRECTOR_SYSTEM_PROMPT = `Je suis un directeur de demande image pour A11.
Je reçois une demande image déjà structurée.
Je peux aider à mieux diriger la procédure, mais je ne dois jamais changer le sujet principal, l intention, la palette, ni inventer un nouveau personnage principal.

Je réponds uniquement en JSON strict avec cette forme :
{
  "action_candidates": ["..."],
  "web_queries": ["..."],
  "composition_hints": ["..."],
  "environment_hints": ["..."],
  "style_hints": ["..."],
  "prompt_instructions": ["..."]
}

Règles strictes :
- français uniquement
- positif uniquement
- simple et utile
- pas de négation
- pas de traduction
- pas de nouveau sujet principal
- pas de changement de couleurs
- maximum 5 action_candidates
- maximum 3 web_queries
- maximum 3 entrées pour les autres tableaux
- si une recherche web n aide pas, laisse web_queries vide`;

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

function isImageRequestDirectorEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_REQUEST_DIRECTOR;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function sanitizeHintEntry(value = '') {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length > 180) return '';
  if (/\b(ne pas|pas de|sans|eviter|éviter|do not|don't|avoid)\b/i.test(text)) return '';
  if (/\b(traduire|translate|reformuler|reformulation)\b/i.test(text)) return '';
  if (/\b(changer|remplacer|palette|nouveau sujet|autre sujet|second sujet|nouveau personnage|autre personnage)\b/i.test(text)) return '';
  if (/negative[_ -]?prompt/i.test(text)) return '';
  return text;
}

function sanitizeActionCandidate(value = '') {
  const text = sanitizeHintEntry(value);
  if (!text) return '';
  if (text.length > 120) return '';
  return text;
}

function sanitizeWebQuery(value = '') {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length > 120) return '';
  if (/\b(traduire|translate|prompt|negative prompt)\b/i.test(text)) return '';
  return text;
}

function normalizeHintArray(values = []) {
  return toUniqueStrings((Array.isArray(values) ? values : [values]).map((entry) => sanitizeHintEntry(entry)).filter(Boolean)).slice(0, 3);
}

function normalizeActionCandidates(values = []) {
  return toUniqueStrings((Array.isArray(values) ? values : [values]).map((entry) => sanitizeActionCandidate(entry)).filter(Boolean)).slice(0, 5);
}

function normalizeWebQueries(values = []) {
  return toUniqueStrings((Array.isArray(values) ? values : [values]).map((entry) => sanitizeWebQuery(entry)).filter(Boolean)).slice(0, 3);
}

function normalizeDirectorResult(result = {}) {
  if (!result || typeof result !== 'object') {
    return {
      action_candidates: [],
      web_queries: [],
      composition_hints: [],
      environment_hints: [],
      style_hints: [],
      prompt_instructions: [],
    };
  }

  return {
    action_candidates: normalizeActionCandidates(result.action_candidates || result.actionCandidates || []),
    web_queries: normalizeWebQueries(result.web_queries || result.webQueries || []),
    composition_hints: normalizeHintArray(result.composition_hints || result.compositionHints || []),
    environment_hints: normalizeHintArray(result.environment_hints || result.environmentHints || []),
    style_hints: normalizeHintArray(result.style_hints || result.styleHints || []),
    prompt_instructions: normalizeHintArray(result.prompt_instructions || result.promptInstructions || []),
  };
}

function countEntries(values = []) {
  return (Array.isArray(values) ? values : []).filter(Boolean).length;
}

function hasSceneRelation(rawText = '') {
  return /\b(avec|dans|sur|sous|tenant|portant|sortant|sortie|sorti|en train de)\b/i.test(String(rawText || ''));
}

function shouldDirectImageRequest({ mask = {}, selection = null, enabled } = {}) {
  if (!isImageRequestDirectorEnabled(enabled)) return false;
  if (String(mask?.intent || '').trim() !== 'image.generate') return false;

  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const confidence = Number(semantic?.confidence || 0);
  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  const hasDefinition = Boolean(mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object');
  const hasEntityContext = Boolean(mask?.meta?.imageEntityContext && typeof mask.meta.imageEntityContext === 'object');
  const hasScratchpad = Boolean(mask?.meta?.imageScratchpad && typeof mask.meta.imageScratchpad === 'object');
  const hasSemanticFamilies = (
    countEntries(semantic?.accessories)
    + countEntries(semantic?.elements)
    + countEntries(semantic?.metiers)
    + countEntries(semantic?.scenes)
  ) > 0;
  const hasPromptInstructions = Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 0;
  const hasEmbellishment = Boolean(mask?.meta?.imageScratchpad?.embellishment);
  const shortRequest = normalizeLookup(mask?.raw || '').split(/\s+/).filter(Boolean).length <= 7;

  return Boolean(
    selection?.candidate === true
    || selection?.compartment === 'special'
    || confidence < 0.72
    || hasSceneRelation(mask?.raw)
    || hasSemanticFamilies
    || hasDefinition
    || hasEntityContext
    || hasEmbellishment
    || (shortRequest && hasScratchpad)
    || !subjectProfileType
  );
}

function buildImageRequestDirectorPrompt(mask = {}) {
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const scratchpad = mask?.meta?.imageScratchpad && typeof mask.meta.imageScratchpad === 'object'
    ? mask.meta.imageScratchpad
    : null;
  const entityContext = mask?.meta?.imageEntityContext && typeof mask.meta.imageEntityContext === 'object'
    ? mask.meta.imageEntityContext
    : null;

  return JSON.stringify({
    demande: normalizeText(mask?.raw || ''),
    sujet_principal: toUniqueStrings(mask?.inputs?.subject || []).slice(0, 3),
    environnement: toUniqueStrings(mask?.inputs?.environment || []).slice(0, 4),
    style: toUniqueStrings(mask?.inputs?.style || []).slice(0, 4),
    composition: toUniqueStrings(mask?.inputs?.composition || []).slice(0, 5),
    couleurs: toUniqueStrings(mask?.inputs?.palette || []).slice(0, 5),
    profil_sujet: normalizeText(mask?.meta?.subjectProfile?.type || ''),
    instructions_existantes: toUniqueStrings(mask?.meta?.promptInstructions || []).slice(0, 5),
    semantic: {
      confidence: Number(semantic?.confidence || 0),
      accessories: toUniqueStrings((semantic?.accessories || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
      elements: toUniqueStrings((semantic?.elements || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
      metiers: toUniqueStrings((semantic?.metiers || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
      scenes: toUniqueStrings((semantic?.scenes || []).map((entry) => entry?.label || entry?.key || entry)).slice(0, 5),
    },
    ardoise_temporaire: scratchpad ? {
      canonical_subject: normalizeText(scratchpad.canonicalSubject || ''),
      universe: normalizeText(scratchpad.universe || ''),
      subject_profile_type: normalizeText(scratchpad.subjectProfileType || ''),
      facts: toUniqueStrings(scratchpad.facts || []).slice(0, 5),
      embellishment: scratchpad.embellishment && typeof scratchpad.embellishment === 'object'
        ? {
            family: normalizeText(scratchpad.embellishment.family || ''),
            reason: normalizeText(scratchpad.embellishment.reason || ''),
            composition: toUniqueStrings(scratchpad.embellishment.composition || []).slice(0, 3),
            environment: toUniqueStrings(scratchpad.embellishment.environment || []).slice(0, 3),
            style: toUniqueStrings(scratchpad.embellishment.style || []).slice(0, 3),
            prompt_instructions: toUniqueStrings(scratchpad.embellishment.promptInstructions || []).slice(0, 3),
          }
        : null,
    } : null,
    contexte_entite: entityContext ? {
      canonical_subject: normalizeText(entityContext.canonicalSubject || ''),
      description: normalizeText(entityContext.description || ''),
      summary: normalizeText(entityContext.summary || ''),
      universe: normalizeText(entityContext.universe || ''),
      entity_type: normalizeText(entityContext.entityType || ''),
    } : null,
  }, null, 2);
}

async function resolveQueryContext(query, {
  lookupDefinitionContext = defaultLookupDefinitionContext,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
} = {}) {
  const cleanedQuery = sanitizeWebQuery(query);
  if (!cleanedQuery) return null;

  let definition = null;
  let imageResult = null;
  if (typeof lookupDefinitionContext === 'function') {
    try {
      definition = await lookupDefinitionContext({ query: cleanedQuery });
    } catch {
      definition = null;
    }
  }
  if (typeof duckduckgoImageSearch === 'function') {
    try {
      imageResult = await duckduckgoImageSearch(cleanedQuery);
    } catch {
      imageResult = null;
    }
  }

  const title = normalizeText(definition?.title || definition?.term || '');
  const summary = normalizeText(definition?.summary || '');
  const imageTitle = normalizeText(imageResult?.title || '');
  const imageUrl = normalizeText(imageResult?.image_url || '');
  const sourceUrl = normalizeText(definition?.url || imageResult?.source_url || '');
  const sourceDomain = (() => {
    try {
      return sourceUrl ? String(new URL(sourceUrl).hostname || '').replace(/^www\./i, '').trim() : '';
    } catch {
      return '';
    }
  })();
  const facts = toUniqueStrings([
    title ? `Sujet web : ${title}` : '',
    summary ? `Contexte web : ${summary}` : '',
    imageTitle ? `Repère image : ${imageTitle}` : '',
    sourceDomain ? `Source : ${sourceDomain}` : '',
  ]).slice(0, 4);

  if (!facts.length) return null;

  return {
    query: cleanedQuery,
    title,
    summary,
    imageTitle,
    imageUrl,
    sourceUrl,
    sourceDomain,
    facts,
  };
}

function mergeDirectorHints(mask = {}, director = {}) {
  const nextMask = JSON.parse(JSON.stringify(mask || {}));
  nextMask.meta = nextMask.meta && typeof nextMask.meta === 'object' ? nextMask.meta : {};
  nextMask.inputs = nextMask.inputs && typeof nextMask.inputs === 'object' ? nextMask.inputs : {};

  nextMask.inputs.composition = toUniqueStrings([
    ...(Array.isArray(nextMask.inputs.composition) ? nextMask.inputs.composition : []),
    ...(Array.isArray(director.composition_hints) ? director.composition_hints : []),
  ]);
  nextMask.inputs.environment = toUniqueStrings([
    ...(Array.isArray(nextMask.inputs.environment) ? nextMask.inputs.environment : []),
    ...(Array.isArray(director.environment_hints) ? director.environment_hints : []),
  ]);
  nextMask.inputs.style = toUniqueStrings([
    ...(Array.isArray(nextMask.inputs.style) ? nextMask.inputs.style : []),
    ...(Array.isArray(director.style_hints) ? director.style_hints : []),
  ]);
  nextMask.meta.promptInstructions = toUniqueStrings([
    ...(Array.isArray(nextMask.meta.promptInstructions) ? nextMask.meta.promptInstructions : []),
    ...(Array.isArray(director.prompt_instructions) ? director.prompt_instructions : []),
    ...(Array.isArray(director.action_candidates) ? director.action_candidates.slice(0, 3) : []),
  ]);
  nextMask.meta.imageRequestDirector = {
    actionCandidates: Array.isArray(director.action_candidates) ? director.action_candidates : [],
    webQueries: Array.isArray(director.web_queries) ? director.web_queries : [],
    webContexts: Array.isArray(director.web_contexts) ? director.web_contexts : [],
    summaryFacts: Array.isArray(director.summary_facts) ? director.summary_facts : [],
    appliedHintCount: Number(director.appliedHintCount || 0),
  };
  return nextMask;
}

async function directImageRequest({
  mask = {},
  selection = null,
  callStructuredLlm = callStructuredLlmJson,
  lookupDefinitionContext = defaultLookupDefinitionContext,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
  enabled,
} = {}) {
  if (!shouldDirectImageRequest({ mask, selection, enabled })) {
    return {
      mask,
      director: null,
      skipped: true,
      reason: 'not_needed',
    };
  }

  if (typeof callStructuredLlm !== 'function') {
    return {
      mask,
      director: null,
      skipped: true,
      reason: 'llm_unavailable',
    };
  }

  let raw = null;
  try {
    raw = await callStructuredLlm({
      text: buildImageRequestDirectorPrompt(mask),
      systemPrompt: IMAGE_REQUEST_DIRECTOR_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 420,
      timeoutMs: Number(process.env.A11_IMAGE_REQUEST_DIRECTOR_TIMEOUT_MS || 90000),
    });
  } catch (error_) {
    return {
      mask,
      director: null,
      skipped: true,
      reason: String(error_?.message || error_) || 'director_failed',
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      mask,
      director: null,
      skipped: true,
      reason: 'empty_or_invalid_director',
    };
  }

  const normalized = normalizeDirectorResult(raw);
  const webContexts = [];
  for (const query of normalized.web_queries) {
    const context = await resolveQueryContext(query, {
      lookupDefinitionContext,
      duckduckgoImageSearch,
    });
    if (context) webContexts.push(context);
  }

  const summaryFacts = toUniqueStrings([
    ...normalized.action_candidates.map((entry) => `Action utile : ${entry}`),
    ...webContexts.flatMap((entry) => entry.facts || []),
  ]).slice(0, 8);

  const appliedHintCount = (
    normalized.action_candidates.length
    + normalized.composition_hints.length
    + normalized.environment_hints.length
    + normalized.style_hints.length
    + normalized.prompt_instructions.length
  );

  if (appliedHintCount === 0 && webContexts.length === 0) {
    return {
      mask,
      director: null,
      skipped: true,
      reason: 'empty_or_invalid_director',
    };
  }

  const director = {
    ...normalized,
    web_contexts: webContexts,
    summary_facts: summaryFacts,
    appliedHintCount,
  };

  return {
    mask: mergeDirectorHints(mask, director),
    director,
    skipped: false,
    reason: '',
  };
}

module.exports = {
  IMAGE_REQUEST_DIRECTOR_SYSTEM_PROMPT,
  buildImageRequestDirectorPrompt,
  directImageRequest,
  isImageRequestDirectorEnabled,
  normalizeDirectorResult,
  shouldDirectImageRequest,
};

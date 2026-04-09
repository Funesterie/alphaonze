const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');
const { isLlmEnrichmentEnabled, callStructuredLlmJson } = require('./resolve-text-to-wazaa.cjs');

const SPECIAL_IMAGE_COMPILER_SYSTEM_PROMPT = `Tu es un raffineur de compilateur image pour A11.
Tu reçois un MASK image déjà structuré en français.
Tu ne dois jamais changer le sujet principal, la palette, l'intention, les contraintes, ni ajouter un nouveau personnage ou un nouveau sujet principal.
Tu dois seulement proposer des hints positifs et courts pour mieux cadrer une demande image complexe.

Réponds uniquement en JSON strict avec cette forme :
{
  "composition_hints": ["..."],
  "environment_hints": ["..."],
  "style_hints": ["..."],
  "prompt_instructions": ["..."]
}

Règles strictes :
- français uniquement
- positif uniquement
- pas de négation
- pas de traduction
- pas de changement de sujet
- pas de changement de couleurs
- maximum 3 entrées par tableau
- si rien n'est utile, renvoie des tableaux vides`;

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function normalizeSemanticLookup(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function countTruthyEntries(values = []) {
  return (Array.isArray(values) ? values : []).filter(Boolean).length;
}

function hasNonTrivialSemanticFamilies(mask = {}) {
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  return (
    countTruthyEntries(semantic?.elements) > 0
    || countTruthyEntries(semantic?.accessories) > 0
    || countTruthyEntries(semantic?.metiers) > 0
    || countTruthyEntries(semantic?.scenes) > 0
  );
}

function hasSceneRelation(rawText = '') {
  return /\b(avec|dans|sur|tenant|portant|sortant|sorti|sortie)\b/i.test(String(rawText || ''));
}

function looksLikeShortOrNoisySubject(mask = {}) {
  const subject = normalizeSemanticLookup(mask?.inputs?.subject?.[0] || '');
  const subjectProfile = normalizeText(mask?.meta?.subjectProfile?.type || '');
  if (!subjectProfile) return true;
  if (!subject) return true;
  if (subject.length <= 2) return true;
  if (/^(?:d|de|du|des|la|le|les|un|une|truc|chose)$/.test(subject)) return true;
  return false;
}

function hasSpecialCompilerLlmSupport(options = {}) {
  const preferredHints = normalizeSpecialCompilerHints(options.preferredHints || {});
  const preferredHintCount = (
    preferredHints.composition_hints.length
    + preferredHints.environment_hints.length
    + preferredHints.style_hints.length
    + preferredHints.prompt_instructions.length
  );
  if (preferredHintCount > 0) return true;
  if (typeof options.callStructuredLlmJson === 'function') return true;
  return isLlmEnrichmentEnabled();
}

function resolveImageCompilerCompartment(rawMask = {}, options = {}) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const reasons = [];
  let score = 0;

  const semanticConfidence = Number(mask?.meta?.semantic?.confidence || 0);
  if (semanticConfidence > 0 && semanticConfidence < 0.58) {
    score += 2;
    reasons.push('low_semantic_confidence');
  }

  if (mask?.meta?.llmEnriched === true || (mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object')) {
    score += 2;
    reasons.push('llm_or_definition_context');
  }

  if (Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 0) {
    score += 1;
    reasons.push('existing_prompt_instructions');
  }

  if (hasNonTrivialSemanticFamilies(mask)) {
    score += 1;
    reasons.push('semantic_family_detected');
  }

  const rawText = String(mask?.meta?.promptSeedText || mask?.raw || '').trim();
  if (hasSceneRelation(rawText)) {
    score += 1;
    reasons.push('scene_or_attachment_relation');
  }

  if (looksLikeShortOrNoisySubject(mask)) {
    score += 1;
    reasons.push('short_or_noisy_subject');
  }

  const candidate = score >= 3;
  const llmAvailable = hasSpecialCompilerLlmSupport(options);
  const compartment = candidate && llmAvailable ? 'special' : 'standard';

  return {
    compartment,
    score,
    reasons,
    candidate,
    llmAvailable,
    shouldBypassCache: compartment === 'special',
  };
}

function buildSpecialCompilerUserPrompt(mask = {}) {
  const rememberedHints = normalizeSpecialCompilerHints(mask?.meta?.specialCompilerHintMemory || {});
  const webHintContext = mask?.meta?.webHintContext && typeof mask.meta.webHintContext === 'object'
    ? {
        query: normalizeText(mask.meta.webHintContext.query || ''),
        title: normalizeText(mask.meta.webHintContext.title || ''),
        summary: normalizeText(mask.meta.webHintContext.summary || ''),
        source_domain: normalizeText(mask.meta.webHintContext.sourceDomain || ''),
        image_title: normalizeText(mask.meta.webHintContext.imageTitle || ''),
        hint_facts: toUniqueStrings(mask.meta.webHintContext.hintFacts || []).slice(0, 4),
      }
    : null;
  const payload = {
    demande: normalizeText(mask?.raw || ''),
    sujet_principal: toUniqueStrings(mask?.inputs?.subject || []).slice(0, 3),
    environnement: toUniqueStrings(mask?.inputs?.environment || []).slice(0, 3),
    style: toUniqueStrings(mask?.inputs?.style || []).slice(0, 3),
    composition: toUniqueStrings(mask?.inputs?.composition || []).slice(0, 5),
    couleurs: toUniqueStrings(mask?.inputs?.palette || []).slice(0, 5),
    profil_sujet: normalizeText(mask?.meta?.subjectProfile?.type || ''),
    instructions_existantes: toUniqueStrings(mask?.meta?.promptInstructions || []).slice(0, 5),
    hints_memoires_utiles: rememberedHints,
    contexte_web: webHintContext,
  };

  return JSON.stringify(payload, null, 2);
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

function normalizeHintArray(values = []) {
  return toUniqueStrings(values.map((entry) => sanitizeHintEntry(entry)).filter(Boolean)).slice(0, 3);
}

function normalizeSpecialCompilerHints(result = {}) {
  if (!result || typeof result !== 'object') {
    return {
      composition_hints: [],
      environment_hints: [],
      style_hints: [],
      prompt_instructions: [],
    };
  }

  return {
    composition_hints: normalizeHintArray(result.composition_hints || result.compositionHints || []),
    environment_hints: normalizeHintArray(result.environment_hints || result.environmentHints || []),
    style_hints: normalizeHintArray(result.style_hints || result.styleHints || []),
    prompt_instructions: normalizeHintArray(result.prompt_instructions || result.promptInstructions || []),
  };
}

function mergeSpecialCompilerHints(mask = {}, hints = {}) {
  const nextMask = deepClone(mask) || {};
  nextMask.meta = nextMask.meta && typeof nextMask.meta === 'object' ? nextMask.meta : {};
  nextMask.inputs = nextMask.inputs && typeof nextMask.inputs === 'object' ? nextMask.inputs : {};

  nextMask.inputs.composition = toUniqueStrings([
    ...(Array.isArray(nextMask.inputs.composition) ? nextMask.inputs.composition : []),
    ...(Array.isArray(hints.composition_hints) ? hints.composition_hints : []),
  ]);
  nextMask.inputs.environment = toUniqueStrings([
    ...(Array.isArray(nextMask.inputs.environment) ? nextMask.inputs.environment : []),
    ...(Array.isArray(hints.environment_hints) ? hints.environment_hints : []),
  ]);
  nextMask.inputs.style = toUniqueStrings([
    ...(Array.isArray(nextMask.inputs.style) ? nextMask.inputs.style : []),
    ...(Array.isArray(hints.style_hints) ? hints.style_hints : []),
  ]);
  nextMask.meta.promptInstructions = toUniqueStrings([
    ...(Array.isArray(nextMask.meta.promptInstructions) ? nextMask.meta.promptInstructions : []),
    ...(Array.isArray(hints.prompt_instructions) ? hints.prompt_instructions : []),
  ]);

  return nextMask;
}

async function enrichMaskForSpecialImageCompiler(rawMask = {}, options = {}) {
  const baseMask = deepClone(normalizeMaskImageGenerate(rawMask));
  baseMask.meta = baseMask.meta && typeof baseMask.meta === 'object' ? baseMask.meta : {};
  const memoryHints = normalizeSpecialCompilerHints(options.preferredHints || {});
  const memoryHintCount = (
    memoryHints.composition_hints.length
    + memoryHints.environment_hints.length
    + memoryHints.style_hints.length
    + memoryHints.prompt_instructions.length
  );
  if (memoryHintCount > 0) {
    baseMask.meta.specialCompilerHintMemory = memoryHints;
  }

  const selection = resolveImageCompilerCompartment(baseMask, options);
  const reasonText = selection.reasons.join(', ');

  if (selection.compartment !== 'special') {
    baseMask.meta.compilerCompartment = 'standard';
    if (reasonText) baseMask.meta.specialCompilerReason = reasonText;
    if (selection.candidate && !selection.llmAvailable) {
      baseMask.meta.specialCompilerFallback = 'llm_unavailable';
    }
    return {
      mask: baseMask,
      selection,
      appliedHints: {
        composition_hints: [],
        environment_hints: [],
        style_hints: [],
        prompt_instructions: [],
      },
      fallbackReason: selection.candidate && !selection.llmAvailable ? 'llm_unavailable' : '',
    };
  }

  let workingMask = baseMask;
  if (memoryHintCount > 0) {
    workingMask = mergeSpecialCompilerHints(workingMask, memoryHints);
  }

  const llmCaller = typeof options.callStructuredLlmJson === 'function'
    ? options.callStructuredLlmJson
    : callStructuredLlmJson;

  let rawHints = null;
  let normalizedHints = null;
  let fallbackReason = '';
  try {
    rawHints = await llmCaller({
      text: buildSpecialCompilerUserPrompt(workingMask),
      systemPrompt: SPECIAL_IMAGE_COMPILER_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 280,
      timeoutMs: Number(process.env.A11_SPECIAL_COMPILER_TIMEOUT_MS || 8000),
    });
    normalizedHints = normalizeSpecialCompilerHints(rawHints);
  } catch (error_) {
    fallbackReason = String(error_?.message || error_) || 'llm_error';
  }

  const appliedCount = normalizedHints
    ? (
      normalizedHints.composition_hints.length
      + normalizedHints.environment_hints.length
      + normalizedHints.style_hints.length
      + normalizedHints.prompt_instructions.length
    )
    : 0;

  if (!normalizedHints || appliedCount === 0) {
    const fallbackMask = workingMask;
    fallbackMask.meta.compilerCompartment = memoryHintCount > 0 ? 'special' : 'standard';
    if (reasonText) fallbackMask.meta.specialCompilerReason = reasonText;
    if (!fallbackReason) fallbackReason = 'empty_or_invalid_hints';
    fallbackMask.meta.specialCompilerFallback = fallbackReason;
    if (memoryHintCount > 0) {
      fallbackMask.meta.specialCompilerAppliedHintsCount = memoryHintCount;
      fallbackMask.meta.specialCompilerMemoryHintsAppliedCount = memoryHintCount;
    }
    return {
      mask: fallbackMask,
      selection,
      appliedHints: memoryHintCount > 0
        ? memoryHints
        : (normalizedHints || {
          composition_hints: [],
          environment_hints: [],
          style_hints: [],
          prompt_instructions: [],
        }),
      fallbackReason,
    };
  }

  const combinedHints = {
    composition_hints: toUniqueStrings([
      ...memoryHints.composition_hints,
      ...normalizedHints.composition_hints,
    ]).slice(0, 3),
    environment_hints: toUniqueStrings([
      ...memoryHints.environment_hints,
      ...normalizedHints.environment_hints,
    ]).slice(0, 3),
    style_hints: toUniqueStrings([
      ...memoryHints.style_hints,
      ...normalizedHints.style_hints,
    ]).slice(0, 3),
    prompt_instructions: toUniqueStrings([
      ...memoryHints.prompt_instructions,
      ...normalizedHints.prompt_instructions,
    ]).slice(0, 3),
  };
  const enrichedMask = mergeSpecialCompilerHints(baseMask, combinedHints);
  enrichedMask.meta.compilerCompartment = 'special';
  if (reasonText) enrichedMask.meta.specialCompilerReason = reasonText;
  const totalAppliedCount = (
    combinedHints.composition_hints.length
    + combinedHints.environment_hints.length
    + combinedHints.style_hints.length
    + combinedHints.prompt_instructions.length
  );
  enrichedMask.meta.specialCompilerAppliedHintsCount = totalAppliedCount;
  if (memoryHintCount > 0) {
    enrichedMask.meta.specialCompilerMemoryHintsAppliedCount = memoryHintCount;
  }

  return {
    mask: enrichedMask,
    selection,
    appliedHints: combinedHints,
    fallbackReason: '',
  };
}

module.exports = {
  SPECIAL_IMAGE_COMPILER_SYSTEM_PROMPT,
  resolveImageCompilerCompartment,
  normalizeSpecialCompilerHints,
  enrichMaskForSpecialImageCompiler,
};

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
    .replace(/[-_]/g, ' ')
    .toLowerCase();
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampInteger(value, min, max, fallback) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function toStringList(values = [], { limit = 50 } = {}) {
  const source = Array.isArray(values) ? values : [values];
  const normalized = [];
  const seen = new Set();
  for (const entry of source) {
    const text = normalizeText(entry);
    if (!text) continue;
    const key = normalizeLookup(text);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    normalized.push(text);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

function normalizeCreativeBrief(brief = {}) {
  const source = brief && typeof brief === 'object' ? brief : {};
  const rawPrompt = normalizeText(source.rawPrompt || source.raw_prompt || '');
  return {
    rawPrompt,
    normalizedPrompt: normalizeText(source.normalizedPrompt || source.normalized_prompt || rawPrompt),
    lyricsFragments: toStringList(source.lyricsFragments || source.lyrics_fragments || [], { limit: 12 }),
    referenceImageUrls: toStringList(source.referenceImageUrls || source.reference_image_urls || [], { limit: 12 }),
    referenceImagePaths: toStringList(source.referenceImagePaths || source.reference_image_paths || [], { limit: 12 }),
    styleHints: toStringList(source.styleHints || source.style_hints || [], { limit: 12 }),
    userForbidden: toStringList(source.userForbidden || source.user_forbidden || [], { limit: 12 }),
  };
}

function normalizeExtractedTerm(term = {}) {
  const source = term && typeof term === 'object' ? term : {};
  const label = normalizeText(source.term || source.label || '');
  return {
    term: label,
    normalized: normalizeText(source.normalized || normalizeLookup(label)),
    domain: normalizeText(source.domain || ''),
    category: normalizeText(source.category || source.type || ''),
    confidence: clamp01(source.confidence, 0),
    evidence: toStringList(source.evidence || [], { limit: 8 }),
    ambiguity: toStringList(source.ambiguity || [], { limit: 8 }),
  };
}

function normalizeObjectCard(card = {}) {
  const source = card && typeof card === 'object' ? card : {};
  return {
    term: normalizeText(source.term || source.label || ''),
    domain: normalizeText(source.domain || ''),
    resolvedMeaning: normalizeText(source.resolvedMeaning || source.resolved_meaning || source.meaning || ''),
    confidence: clamp01(source.confidence, 0),
    visualRole: normalizeText(source.visualRole || source.visual_role || ''),
    spatialRole: normalizeText(source.spatialRole || source.spatial_role || ''),
    mustShow: toStringList(source.mustShow || source.must_show || [], { limit: 8 }),
    forbidden: toStringList(source.forbidden || [], { limit: 8 }),
    queriesUsed: toStringList(source.queriesUsed || source.queries_used || [], { limit: 8 }),
    sourceFacts: toStringList(source.sourceFacts || source.source_facts || [], { limit: 8 }),
    clipUse: normalizeText(source.clipUse || source.clip_use || ''),
  };
}

function normalizeZones(zones = {}) {
  const source = zones && typeof zones === 'object' ? zones : {};
  const normalized = {};
  for (const [key, value] of Object.entries(source)) {
    const label = normalizeText(key);
    if (!label) continue;
    normalized[label] = toStringList(value, { limit: 10 });
  }
  return normalized;
}

function normalizeSpatialLock(lock = {}) {
  const source = lock && typeof lock === 'object' ? lock : {};
  return {
    subject: normalizeText(source.subject || ''),
    positiveModel: normalizeText(source.positiveModel || source.positive_model || ''),
    stableGeometry: toStringList(source.stableGeometry || source.stable_geometry || [], { limit: 12 }),
    zones: normalizeZones(source.zones || {}),
    placements: toStringList(source.placements || [], { limit: 12 }),
    forbiddenPlacements: toStringList(source.forbiddenPlacements || source.forbidden_placements || [], { limit: 12 }),
    negativePromptFragments: toStringList(source.negativePromptFragments || source.negative_prompt_fragments || [], { limit: 12 }),
    confidence: clamp01(source.confidence, 0),
  };
}

function normalizeReferenceBoardItem(item = {}) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    role: normalizeText(source.role || ''),
    label: normalizeText(source.label || source.title || ''),
    query: normalizeText(source.query || ''),
    sourceUrl: normalizeText(source.sourceUrl || source.source_url || ''),
    imageUrl: normalizeText(source.imageUrl || source.image_url || ''),
    facts: toStringList(source.facts || source.sourceFacts || source.source_facts || [], { limit: 8 }),
    confidence: clamp01(source.confidence, source.selectionScore ? clamp01(source.selectionScore, 0) : 0),
  };
}

function normalizeReferenceBoard(board = {}) {
  const source = board && typeof board === 'object' ? board : {};
  return {
    identityReferences: (Array.isArray(source.identityReferences) ? source.identityReferences : source.identity_references || [])
      .map(normalizeReferenceBoardItem)
      .filter((entry) => entry.role || entry.label || entry.query || entry.imageUrl || entry.sourceUrl),
    spatialReferences: (Array.isArray(source.spatialReferences) ? source.spatialReferences : source.spatial_references || [])
      .map(normalizeReferenceBoardItem)
      .filter((entry) => entry.role || entry.label || entry.query || entry.imageUrl || entry.sourceUrl),
    styleReferences: (Array.isArray(source.styleReferences) ? source.styleReferences : source.style_references || [])
      .map(normalizeReferenceBoardItem)
      .filter((entry) => entry.role || entry.label || entry.query || entry.imageUrl || entry.sourceUrl),
    roleSeparationRules: toStringList(source.roleSeparationRules || source.role_separation_rules || [], { limit: 8 }),
    compositeImageUrl: normalizeText(source.compositeImageUrl || source.composite_image_url || ''),
  };
}

function normalizeStoryboardBeat(beat = {}) {
  const source = beat && typeof beat === 'object' ? beat : {};
  return {
    label: normalizeText(source.label || ''),
    sceneGoal: normalizeText(source.sceneGoal || source.scene_goal || ''),
    requiredObjects: toStringList(source.requiredObjects || source.required_objects || [], { limit: 12 }),
    spatialLocks: toStringList(source.spatialLocks || source.spatial_locks || [], { limit: 12 }),
    cameraHints: toStringList(source.cameraHints || source.camera_hints || [], { limit: 8 }),
    negativeConstraints: toStringList(source.negativeConstraints || source.negative_constraints || [], { limit: 8 }),
    verifierFocus: toStringList(source.verifierFocus || source.verifier_focus || [], { limit: 8 }),
  };
}

function normalizeVerificationChecklist(checklist = {}) {
  const source = checklist && typeof checklist === 'object' ? checklist : {};
  return {
    id: normalizeText(source.id || ''),
    mustPass: toStringList(source.mustPass || source.must_pass || [], { limit: 20 }),
    rejectIf: toStringList(source.rejectIf || source.reject_if || [], { limit: 20 }),
    regenerationHints: toStringList(source.regenerationHints || source.regeneration_hints || [], { limit: 12 }),
  };
}

function normalizeCorrectionHints(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {};
  for (const [key, entries] of Object.entries(source)) {
    const label = normalizeText(key);
    if (!label) continue;
    normalized[label] = toStringList(entries, { limit: 8 });
  }
  return normalized;
}

function normalizeRegenerationPolicy(policy = {}) {
  const source = policy && typeof policy === 'object' ? policy : {};
  return {
    errorSignals: toStringList(source.errorSignals || source.error_signals || [], { limit: 12 }),
    correctionHintsByError: normalizeCorrectionHints(source.correctionHintsByError || source.correction_hints_by_error || {}),
    positiveRestatementOrder: toStringList(source.positiveRestatementOrder || source.positive_restatement_order || [], { limit: 12 }),
    negativeGuardrails: toStringList(source.negativeGuardrails || source.negative_guardrails || [], { limit: 12 }),
    maxAttempts: clampInteger(source.maxAttempts || source.max_attempts, 0, 5, 0),
  };
}

function normalizeDirectorPlan(plan = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const objectCards = (Array.isArray(source.objectCards) ? source.objectCards : source.object_cards || [])
    .map(normalizeObjectCard)
    .filter((entry) => entry.term || entry.resolvedMeaning);
  const spatialLocks = (Array.isArray(source.spatialLocks) ? source.spatialLocks : source.spatial_locks || [])
    .map(normalizeSpatialLock)
    .filter((entry) => entry.subject || entry.positiveModel || entry.stableGeometry.length || Object.keys(entry.zones).length);

  return {
    enabled: Boolean(source.enabled),
    providerUsed: normalizeText(source.providerUsed || source.provider_used || ''),
    fallbackReason: normalizeText(source.fallbackReason || source.fallback_reason || '') || null,
    creativeBrief: normalizeCreativeBrief(source.creativeBrief || source.creative_brief || {}),
    extractedTerms: (Array.isArray(source.extractedTerms) ? source.extractedTerms : source.extracted_terms || [])
      .map(normalizeExtractedTerm)
      .filter((entry) => entry.term),
    objectCards,
    spatialLocks,
    referenceBoard: normalizeReferenceBoard(source.referenceBoard || source.reference_board || {}),
    storyboardBeats: (Array.isArray(source.storyboardBeats) ? source.storyboardBeats : source.storyboard_beats || [])
      .map(normalizeStoryboardBeat)
      .filter((entry) => entry.label || entry.sceneGoal),
    verificationChecklist: normalizeVerificationChecklist(source.verificationChecklist || source.verification_checklist || {}),
    regenerationPolicy: normalizeRegenerationPolicy(source.regenerationPolicy || source.regeneration_policy || {}),
    plannerFacts: toStringList(source.plannerFacts || source.planner_facts || [], { limit: 12 }),
    plannerLocks: toStringList(source.plannerLocks || source.planner_locks || [], { limit: 12 }),
    plannerNegativeFragments: toStringList(source.plannerNegativeFragments || source.planner_negative_fragments || [], { limit: 12 }),
  };
}

function buildDirectorPlannerContext(plan = {}, {
  compiledBasePrompt = '',
  existingVisualContext = '',
  existingSubjectFacts = [],
} = {}) {
  const normalized = normalizeDirectorPlan(plan);
  const basePrompt = normalizeText(compiledBasePrompt);
  const visualParts = toStringList(existingVisualContext, { limit: 4 });
  const subjectFacts = toStringList(existingSubjectFacts, { limit: 20 });

  if (!normalized.enabled) {
    return {
      compiledBasePrompt: basePrompt,
      compiledVisualContext: visualParts.join('. '),
      subjectFacts,
    };
  }

  const positiveLocks = toStringList([
    ...normalized.spatialLocks.map((entry) => entry.positiveModel),
    ...normalized.plannerLocks,
  ], { limit: 12 });
  if (positiveLocks.length) {
    visualParts.push(`A11 Director positive spatial model: ${positiveLocks.join('; ')}`);
  }

  if (normalized.plannerNegativeFragments.length) {
    visualParts.push(`A11 Director final guardrails: ${normalized.plannerNegativeFragments.join('; ')}`);
  }

  return {
    compiledBasePrompt: basePrompt,
    compiledVisualContext: visualParts.join('. '),
    subjectFacts: toStringList([
      ...subjectFacts,
      ...normalized.plannerFacts,
    ], { limit: 24 }),
  };
}

module.exports = {
  buildDirectorPlannerContext,
  normalizeDirectorPlan,
};

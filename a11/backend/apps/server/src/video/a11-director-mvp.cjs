const {
  normalizeDirectorPlan,
} = require('./a11-director-contract.cjs');
const {
  resolveMotorcycleDirectorDomain,
} = require('./a11-director-motorcycle-domain.cjs');

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

function toUniqueStrings(values = [], limit = 20) {
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

function buildCreativeBrief({ prompt = '', request = {}, sourceImagePath = '', sourceImageUrl = '' } = {}) {
  const rawPrompt = normalizeText(prompt || request?.prompt || request?.message || '');
  return {
    rawPrompt,
    normalizedPrompt: rawPrompt,
    lyricsFragments: toUniqueStrings(request?.lyricsFragments || request?.lyrics_fragments || [], 12),
    referenceImageUrls: toUniqueStrings([
      sourceImageUrl,
      request?.sourceImageUrl,
      request?.initImageUrl,
      request?.referenceImageUrl,
      request?.reference_image_url,
      request?.referenceImageUrls,
      request?.reference_image_urls,
    ], 12),
    referenceImagePaths: toUniqueStrings([
      sourceImagePath,
      request?.sourceImagePath,
      request?.initImagePath,
    ], 12),
    referenceAudioUrls: toUniqueStrings([
      request?.audioUrl,
      request?.audio_url,
      request?.referenceAudioUrl,
      request?.reference_audio_url,
      request?.referenceAudioUrls,
      request?.reference_audio_urls,
    ], 12),
    referenceVideoUrls: toUniqueStrings([
      request?.sourceVideoUrl,
      request?.source_video_url,
      request?.referenceVideoUrl,
      request?.reference_video_url,
      request?.referenceVideoUrls,
      request?.reference_video_urls,
    ], 12),
    styleHints: toUniqueStrings(request?.styleHints || request?.style_hints || [], 12),
    userForbidden: toUniqueStrings(request?.userForbidden || request?.user_forbidden || [], 12),
  };
}

function mergeReferenceArrays(primary = [], secondary = []) {
  const output = [];
  const seen = new Set();
  for (const entry of [...primary, ...secondary]) {
    if (!entry || typeof entry !== 'object') continue;
    const role = normalizeText(entry.role || '');
    const label = normalizeText(entry.label || entry.title || '');
    const imageUrl = normalizeText(entry.imageUrl || entry.image_url || '');
    const sourceUrl = normalizeText(entry.sourceUrl || entry.source_url || '');
    const key = [role, label, imageUrl, sourceUrl].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      role,
      label,
      query: normalizeText(entry.query || ''),
      sourceUrl,
      imageUrl,
      facts: toUniqueStrings(entry.facts || entry.sourceFacts || entry.source_facts || [], 8),
      confidence: Number(entry.confidence || entry.selectionScore || entry.selection_score || 0) || 0.7,
    });
  }
  return output;
}

function categorizeReference(entry = {}) {
  const role = normalizeLookup(entry.role || '');
  if (/\b(art direction|art_direction|style|mood|lighting|environment)\b/.test(role)) return 'styleReferences';
  if (/\b(vehicle identity|vehicle_identity|subject|identity)\b/.test(role)) return 'identityReferences';
  return 'spatialReferences';
}

function buildInjectedReferenceBoard(referencePack = null) {
  const board = {
    identityReferences: [],
    spatialReferences: [],
    styleReferences: [],
  };
  const refs = Array.isArray(referencePack?.references) ? referencePack.references : [];
  for (const ref of refs) {
    const bucket = categorizeReference(ref);
    board[bucket].push(ref);
  }
  return board;
}

function mergeReferenceBoards(domainBoard = {}, injectedBoard = {}, compositeImageUrl = '') {
  return {
    identityReferences: mergeReferenceArrays(injectedBoard.identityReferences, domainBoard.identityReferences),
    spatialReferences: mergeReferenceArrays(injectedBoard.spatialReferences, domainBoard.spatialReferences),
    styleReferences: mergeReferenceArrays(injectedBoard.styleReferences, domainBoard.styleReferences),
    roleSeparationRules: toUniqueStrings([
      ...(Array.isArray(domainBoard.roleSeparationRules) ? domainBoard.roleSeparationRules : []),
      'style references never replace vehicle identity references',
      'spatial part references never replace unrelated vehicle zones',
    ], 12),
    compositeImageUrl: normalizeText(compositeImageUrl || domainBoard.compositeImageUrl || ''),
  };
}

function buildStoryboardBeats(plan = {}) {
  const cardTerms = toUniqueStrings((plan.objectCards || []).map((card) => card.term), 12);
  const lockSummaries = toUniqueStrings((plan.spatialLocks || []).flatMap((lock) => [
    lock.positiveModel,
    ...(Array.isArray(lock.stableGeometry) ? lock.stableGeometry : []),
  ]), 12);
  return [
    {
      label: 'garage prep',
      sceneGoal: 'prepare the 50cc mecanoboite in a dark wet garage before start',
      requiredObjects: cardTerms,
      spatialLocks: lockSummaries,
      cameraHints: ['close garage framing', 'hands and fuel prep details'],
      negativeConstraints: ['do not change vehicle identity'],
      verifierFocus: ['adult 50cc supermoto proportions', 'front plate remains plausible'],
    },
    {
      label: 'macro mechanics',
      sceneGoal: 'show engine intake, OKO carburetor, low exhaust and side cooling details',
      requiredObjects: cardTerms.filter((term) => /OKO|Metrakit|AM6|radiateur/i.test(term)),
      spatialLocks: lockSummaries,
      cameraHints: ['macro mechanical close-up', 'low angle near frame'],
      negativeConstraints: ['no frontal sci-fi radiator'],
      verifierFocus: ['carb near intake', 'low 2T exhaust', 'radiators lateral'],
    },
    {
      label: 'wet parking stunt',
      sceneGoal: 'street stunt energy in wet parking with smoke and neon',
      requiredObjects: ['same 50cc supermoto'],
      spatialLocks: lockSummaries,
      cameraHints: ['drone circle', 'low tire shot'],
      negativeConstraints: ['no big road bike'],
      verifierFocus: ['same slim 50cc vehicle identity'],
    },
    {
      label: 'neon final run',
      sceneGoal: 'final wheelie through neon tunnel with same vehicle structure',
      requiredObjects: ['same 50cc supermoto', 'same rider'],
      spatialLocks: lockSummaries,
      cameraHints: ['long neon line', 'motion blur controlled'],
      negativeConstraints: ['no scooter or pocket bike'],
      verifierFocus: ['adult rider scale', 'headlight/front mask plausible'],
    },
  ];
}

function extractResearchQueries(objectCards = []) {
  return toUniqueStrings(objectCards.flatMap((card) => card.queriesUsed || []), 3);
}

async function resolveResearchFacts(queries = [], lookupWebContext) {
  if (typeof lookupWebContext !== 'function' || !queries.length) return { facts: [], failed: false };
  const facts = [];
  for (const query of queries) {
    const result = await lookupWebContext({ query });
    facts.push(...toUniqueStrings([
      result?.summary,
      result?.fact,
      ...(Array.isArray(result?.facts) ? result.facts : []),
    ], 4));
  }
  return { facts: toUniqueStrings(facts, 8), failed: false };
}

function buildDisabledPlan({ prompt = '', request = {}, sourceImagePath = '', sourceImageUrl = '' } = {}) {
  return normalizeDirectorPlan({
    enabled: false,
    providerUsed: 'heuristic',
    fallbackReason: null,
    creativeBrief: buildCreativeBrief({ prompt, request, sourceImagePath, sourceImageUrl }),
    extractedTerms: [],
    objectCards: [],
    spatialLocks: [],
    referenceBoard: {
      identityReferences: [],
      spatialReferences: [],
      styleReferences: [],
      roleSeparationRules: [],
    },
    storyboardBeats: [],
    verificationChecklist: {
      id: '',
      mustPass: [],
      rejectIf: [],
      regenerationHints: [],
    },
    regenerationPolicy: {
      errorSignals: [],
      correctionHintsByError: {},
      positiveRestatementOrder: [],
      negativeGuardrails: [],
      maxAttempts: 0,
    },
    plannerFacts: [],
    plannerLocks: [],
    plannerNegativeFragments: [],
  });
}

function shouldBuildReferenceComposite({ request = {}, enabled }) {
  if (enabled === true) return true;
  return Boolean(
    request?.config?.a11DirectorBuildReferenceComposite === true
    || request?.a11DirectorBuildReferenceComposite === true
  );
}

async function planA11DirectorMvp({
  request = {},
  prompt = '',
  sourceImagePath = '',
  sourceImageUrl = '',
  lookupWebContext = null,
  resolveReferencePack = null,
  buildReferenceComposite = null,
  buildReferenceCompositeEnabled = false,
  domainResolvers = [resolveMotorcycleDirectorDomain],
} = {}) {
  const creativeBrief = buildCreativeBrief({ prompt, request, sourceImagePath, sourceImageUrl });
  const rawPrompt = creativeBrief.rawPrompt;
  const domainPlans = [];
  for (const resolver of Array.isArray(domainResolvers) ? domainResolvers : []) {
    if (typeof resolver !== 'function') continue;
    const resolved = resolver(rawPrompt);
    if (resolved?.enabled) domainPlans.push(resolved);
  }

  if (!domainPlans.length) {
    return buildDisabledPlan({ prompt, request, sourceImagePath, sourceImageUrl });
  }

  const basePlan = domainPlans[0];
  let fallbackReason = '';
  let researchFacts = [];
  try {
    const research = await resolveResearchFacts(extractResearchQueries(basePlan.objectCards), lookupWebContext);
    researchFacts = research.facts;
  } catch {
    fallbackReason = 'research_failed';
  }

  let injectedReferenceBoard = {
    identityReferences: [],
    spatialReferences: [],
    styleReferences: [],
  };
  let compositeImageUrl = '';
  try {
    if (typeof resolveReferencePack === 'function') {
      const referencePack = await resolveReferencePack({
        prompt: rawPrompt,
        objectCards: basePlan.objectCards,
        spatialLocks: basePlan.spatialLocks,
        roles: [
          'vehicle_identity',
          'front_headlight_plate',
          'engine_carburetor',
          'low_exhaust',
          'side_radiator_shroud',
          'art_direction',
        ],
      });
      injectedReferenceBoard = buildInjectedReferenceBoard(referencePack);

      if (
        typeof buildReferenceComposite === 'function'
        && shouldBuildReferenceComposite({ request, enabled: buildReferenceCompositeEnabled })
      ) {
        const composite = await buildReferenceComposite({ referencePack });
        compositeImageUrl = normalizeText(composite?.imageUrl || composite?.url || '');
      }
    }
  } catch {
    if (!fallbackReason) fallbackReason = 'reference_pack_failed';
  }

  const referenceBoard = mergeReferenceBoards(basePlan.referenceBoard, injectedReferenceBoard, compositeImageUrl);
  const plannerFacts = toUniqueStrings([
    ...basePlan.plannerFacts,
    ...researchFacts,
  ], 12);

  return normalizeDirectorPlan({
    ...basePlan,
    enabled: true,
    providerUsed: 'heuristic',
    fallbackReason: fallbackReason || null,
    creativeBrief,
    referenceBoard,
    storyboardBeats: buildStoryboardBeats(basePlan),
    plannerFacts,
  });
}

module.exports = {
  planA11DirectorMvp,
};

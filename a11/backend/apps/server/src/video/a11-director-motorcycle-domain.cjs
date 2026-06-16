const {
  normalizeDirectorPlan,
} = require('./a11-director-contract.cjs');

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

function hasAny(lookup = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(lookup));
}

function buildTerm(term, category, evidence = []) {
  return {
    term,
    normalized: normalizeLookup(term),
    domain: '50cc 2-stroke mechanics',
    category,
    confidence: 0.86,
    evidence,
    ambiguity: [],
  };
}

function buildReference(role, label, query, facts = []) {
  return {
    role,
    label,
    query,
    sourceUrl: '',
    imageUrl: '',
    facts,
    confidence: 0.72,
  };
}

function createEmptyResult() {
  return normalizeDirectorPlan({
    enabled: false,
    providerUsed: 'heuristic',
    fallbackReason: null,
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
      id: 'motorcycle-50cc-spatial',
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

function resolveMotorcycleDirectorDomain(prompt = '') {
  const raw = normalizeText(prompt);
  const lookup = normalizeLookup(raw);
  if (!lookup) return createEmptyResult();

  const has50ccContext = hasAny(lookup, [
    /\b50\s*cc\b/,
    /\bam6\b/,
    /\bbeta\b/,
    /\bderbi\b/,
    /\brieju\b/,
    /\bmecaboite\b/,
    /\bmecanoboite\b/,
    /\bsupermotard\b/,
    /\bsupermoto\b/,
    /\boko\b/,
    /\bmetrakit\b/,
    /\bpowerjet\b/,
  ]);
  if (!has50ccContext) return createEmptyResult();

  const extractedTerms = [];
  const objectCards = [];
  const identityReferences = [];
  const spatialReferences = [];
  const styleReferences = [];
  const plannerFacts = [];

  extractedTerms.push(buildTerm('50cc mecanoboite supermoto', 'vehicle_identity', ['50cc context']));
  identityReferences.push(buildReference(
    'vehicle_identity',
    'adult-size European 50cc supermoto side view',
    'Beta RR 50 Derbi Rieju 50cc supermoto side view',
    ['Vehicle identity stays adult-size European 50cc supermoto, slim frame, not big road bike or pocket bike.']
  ));
  plannerFacts.push('Vehicle identity: adult-size European 50cc mecanoboite supermoto, slim frame, normal rider-scale proportions.');

  if (hasAny(lookup, [/\boko\b/, /\bpowerjet\b/, /\bcarbu\b/, /\bcarburateur\b/, /\bcarburetor\b/])) {
    extractedTerms.push(buildTerm('OKO powerjet', 'engine_intake', ['OKO/powerjet context']));
    objectCards.push({
      term: 'OKO powerjet',
      domain: '50cc 2-stroke mechanics',
      resolvedMeaning: 'OKO/powerjet carburetor context for 50cc 2T tuning',
      confidence: 0.86,
      visualRole: 'macro mechanical detail before acceleration',
      spatialRole: 'small carburetor near engine intake, side of bike, close to fuel hose and admission moteur',
      mustShow: ['small metallic carburetor body', 'fuel hose', 'engine intake side'],
      forbidden: ['large front object', 'frontal sci-fi reactor', 'electric motorcycle part'],
      queriesUsed: ['OKO carburetor AM6 50cc powerjet'],
      sourceFacts: ['OKO/powerjet is treated as carburetor and intake context for 50cc 2-stroke tuning.'],
      clipUse: 'close-up on bass hit before throttle rise',
    });
    spatialReferences.push(buildReference(
      'engine_carburetor',
      'OKO carburetor near AM6 intake',
      'OKO carburetor AM6 50cc powerjet',
      ['OKO belongs near the engine intake, not on the front of the bike.']
    ));
    plannerFacts.push('OKO/powerjet resolves as a small carburetor near the engine intake, side of bike.');
  }

  if (hasAny(lookup, [/\bmetrakit\b/, /\bpassage bas\b/, /\bpot\b/, /\bechappement\b/, /\bexhaust\b/])) {
    extractedTerms.push(buildTerm('Metrakit passage bas', 'low_exhaust', ['Metrakit/pot passage bas context']));
    objectCards.push({
      term: 'Metrakit passage bas',
      domain: '50cc 2-stroke mechanics',
      resolvedMeaning: 'low-passage 2-stroke exhaust for 50cc tuning',
      confidence: 0.84,
      visualRole: 'visible 2T expansion exhaust under or low along the frame',
      spatialRole: 'low passage exhaust under the frame or low side, sous le cadre',
      mustShow: ['2-stroke expansion chamber', 'low frame route', 'visible exhaust line'],
      forbidden: ['superbike exhaust can', 'large roadster exhaust', 'futuristic turbine'],
      queriesUsed: ['Metrakit low passage exhaust AM6 50cc'],
      sourceFacts: ['Metrakit passage bas is treated as a low 2T exhaust context when paired with pot/passage bas.'],
      clipUse: 'low mechanical shot with smoke and vibration',
    });
    spatialReferences.push(buildReference(
      'low_exhaust',
      'Metrakit-style low-passage 2T exhaust',
      'Metrakit pot passage bas AM6 50cc',
      ['Low-passage exhaust belongs under or low along the frame.']
    ));
    plannerFacts.push('Metrakit passage bas resolves as a low-passage 2T exhaust under or low along the frame.');
  }

  if (hasAny(lookup, [/\bam6\b/])) {
    extractedTerms.push(buildTerm('AM6', 'engine_family', ['AM6 context']));
    objectCards.push({
      term: 'AM6',
      domain: '50cc 2-stroke mechanics',
      resolvedMeaning: 'compact 50cc 2-stroke mecanoboite engine family context',
      confidence: 0.8,
      visualRole: 'compact center-low 2T engine mass',
      spatialRole: 'center-low engine area inside slim 50cc frame',
      mustShow: ['compact 2-stroke engine', 'center-low frame placement'],
      forbidden: ['large multi-cylinder superbike engine', 'electric hub motor'],
      queriesUsed: ['AM6 50cc engine supermoto'],
      sourceFacts: ['AM6 anchors the scene in 50cc mecanoboite 2T proportions.'],
      clipUse: 'engine vibration and kick/start macro',
    });
  }

  if (hasAny(lookup, [/\bradiateur\b/, /\bradiateurs\b/, /\bradiator\b/, /\bradiators\b/, /\bouies\b/, /\bshrouds\b/])) {
    extractedTerms.push(buildTerm('radiateurs lateraux', 'side_radiators', ['radiator context']));
    objectCards.push({
      term: 'radiateurs lateraux',
      domain: '50cc supermoto architecture',
      resolvedMeaning: 'lateral side radiators behind or near side shrouds',
      confidence: 0.82,
      visualRole: 'side cooling detail, not a front face object',
      spatialRole: 'radiators are side radiators behind side shrouds, never replacing headlight plate',
      mustShow: ['side shrouds', 'lateral radiator placement'],
      forbidden: ['huge front radiator', 'radiator replacing headlight plate'],
      queriesUsed: ['Derbi Senda 50 radiator side shrouds'],
      sourceFacts: ['50cc supermoto radiators are treated as lateral cooling elements, not a frontal grille.'],
      clipUse: 'steam detail on side radiator area',
    });
    spatialReferences.push(buildReference(
      'side_radiator_shroud',
      '50cc side radiator behind shroud',
      'Beta RR 50 radiator side shrouds',
      ['Radiators stay lateral and never replace the front headlight plate.']
    ));
    plannerFacts.push('Radiators are side radiators behind side shrouds and never replace the front headlight plate.');
  }

  if (hasAny(lookup, [/\bplaque phare\b/, /\bheadlight\b/, /\bnumber plate\b/, /\bmasque avant\b/, /\bfront mask\b/])) {
    extractedTerms.push(buildTerm('plaque phare', 'front_structure', ['headlight plate context']));
    objectCards.push({
      term: 'plaque phare',
      domain: '50cc supermoto architecture',
      resolvedMeaning: 'front headlight plate or number plate mask',
      confidence: 0.86,
      visualRole: 'front identity marker of the 50cc supermoto',
      spatialRole: 'front zone of the bike, above high front fender',
      mustShow: ['front headlight plate', 'high front fender'],
      forbidden: ['radiator replacing the headlight plate', 'blank roadster front'],
      queriesUsed: ['Beta RR 50 front headlight plate'],
      sourceFacts: ['Plaque phare is a protected front structure in this vehicle model.'],
      clipUse: 'front or three-quarter rider tension shot',
    });
    spatialReferences.push(buildReference(
      'front_headlight_plate',
      '50cc front headlight plate and high fender',
      'Beta RR 50 front headlight plate',
      ['The front zone contains headlight plate or number plate mask and high front fender.']
    ));
    plannerFacts.push('Front zone keeps the headlight plate or number plate mask visible above the high front fender.');
  }

  if (hasAny(lookup, [/\bneon\b/, /\bneons\b/, /\bpluie\b/, /\brain\b/, /\bgarage\b/, /\bfumee\b/, /\bsmoke\b/, /\bstreet\b/, /\bstunt\b/])) {
    styleReferences.push(buildReference(
      'art_direction',
      'wet neon street stunt garage mood',
      'wet neon garage street stunt cinematic reference',
      ['Art direction can affect lighting, smoke, camera mood, and rain, but never replace vehicle identity.']
    ));
  }

  const spatialLocks = [{
    subject: '50cc mecanoboite supermoto',
    positiveModel: 'adult-size European 50cc supermoto mecanoboite moped, slim frame, 17-inch supermoto wheels, compact center-low 2-stroke engine',
    stableGeometry: [
      'front headlight plate or number plate mask remains visible',
      'radiators are side radiators behind side shrouds',
      'compact 2T engine stays center-low',
      'low-passage exhaust stays under or low along the frame',
    ],
    zones: {
      front: ['headlight plate or number plate mask', 'high front fender'],
      side: ['side shrouds', 'radiators are side radiators behind side shrouds'],
      engineArea: ['AM6-style compact 2-stroke engine', 'OKO carburetor near intake', 'fuel hose'],
      lowerFrame: ['Metrakit-style low-passage 2T exhaust'],
    },
    placements: [
      'plaque phare stays in the front zone',
      'radiateurs lateraux stay behind the side shrouds',
      'carburetor stays near engine intake',
      'exhaust follows low frame line',
    ],
    forbiddenPlacements: [
      'huge front radiator',
      'radiator replacing headlight plate',
      'big road bike proportions',
      'pocket bike toy proportions',
    ],
    negativePromptFragments: [
      'no huge front radiator',
      'no radiator replacing headlight plate',
      'no big road bike',
      'no pocket bike',
      'no scooter',
    ],
    confidence: 0.86,
  }];

  const verificationChecklist = {
    id: 'motorcycle-50cc-spatial',
    mustPass: [
      'Vehicle reads as adult-size European 50cc mecanoboite supermoto.',
      'Front headlight plate or number plate mask remains visible.',
      'Radiators are lateral or at least not replacing the front.',
      'Engine area remains compact 2T center-low when visible.',
      'Carburetor appears near the engine intake when visible.',
      'Low-passage 2T exhaust appears under or low along frame when visible.',
    ],
    rejectIf: [
      'Vehicle resembles big road bike, gros cube, roadster, naked bike, or superbike.',
      'Vehicle resembles pocket bike or toy mini-bike.',
      'Vehicle becomes a scooter.',
      'A huge front radiator or radiateur frontal replaces the headlight plate.',
      'A muddy motocross bike appears when street supermotard is requested.',
    ],
    regenerationHints: [
      'Restate adult 50cc supermoto identity before guardrails.',
      'Restate front headlight plate and side radiator zones before mentioning forbidden front radiator.',
    ],
  };

  const regenerationPolicy = {
    errorSignals: [
      'front_radiator_replaced_headlight',
      'big_road_bike_proportions',
      'pocket_bike_proportions',
      'scooter_body',
    ],
    correctionHintsByError: {
      front_radiator_replaced_headlight: [
        'front headlight plate visible first',
        'radiators lateral behind side shrouds',
      ],
      big_road_bike_proportions: [
        'adult-size European 50cc supermoto, slim frame, normal 50cc proportions',
        'compact center-low 2T engine',
      ],
      pocket_bike_proportions: [
        'adult rider-scale 50cc mecanoboite',
        '17-inch supermoto wheels and realistic wheelbase',
      ],
    },
    positiveRestatementOrder: [
      'vehicle identity',
      'front zone',
      'side radiator zone',
      'engine intake zone',
      'low exhaust zone',
    ],
    negativeGuardrails: [
      'no huge front radiator',
      'no big road bike',
      'no pocket bike',
      'no scooter',
    ],
    maxAttempts: 2,
  };

  const referenceBoard = {
    identityReferences,
    spatialReferences,
    styleReferences,
    roleSeparationRules: [
      'style references never replace vehicle identity references',
      'radiator references never satisfy front headlight plate role',
      'big motorcycle style references never override 50cc proportions',
    ],
    compositeImageUrl: '',
  };

  const plannerLocks = [
    spatialLocks[0].positiveModel,
    'front zone: headlight plate or number plate mask plus high front fender',
    'side zone: radiators are side radiators behind side shrouds',
    'engine zone: compact AM6-style 2T engine with OKO carburetor near intake',
    'lower frame: Metrakit-style low-passage exhaust',
  ];

  return normalizeDirectorPlan({
    enabled: true,
    providerUsed: 'heuristic',
    fallbackReason: null,
    extractedTerms,
    objectCards,
    spatialLocks,
    referenceBoard,
    storyboardBeats: [],
    verificationChecklist,
    regenerationPolicy,
    plannerFacts,
    plannerLocks,
    plannerNegativeFragments: spatialLocks[0].negativePromptFragments,
  });
}

module.exports = {
  resolveMotorcycleDirectorDomain,
};

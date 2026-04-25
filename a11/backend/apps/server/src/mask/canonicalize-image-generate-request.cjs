const {
  detectPromptLanguageProfile,
} = require('./build-sd-prompt-bundle.cjs');
const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('./resolve-text-to-wazaa.cjs');

const CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT = `You are the canonical request normalizer for A11 image.generate.

You receive a raw user request that may be written in French or another language.
Your job is to convert it into a single canonical English source of truth for the whole image generation pipeline.

Rules:
- Output useful prompt data in English only.
- Do not preserve French wording anywhere in canonicalEnglishInput or structuredFields.
- Keep the user's meaning, details, intensity, and constraints.
- Do not invent new subjects, props, environments, styles, or actions.
- Treat explicit proper names and named entities as immutable source facts: preserve every named character, place, object, brand, title, and person the user wrote. Do not replace a named entity with a related or more famous entity from the same universe.
- Translate only common descriptive words and localized franchise names when needed; never substitute one named character for another.
- If the request is ambiguous in a way that blocks image generation, ask for clarification instead of guessing.
- If a reference image is present, reflect that in the English request and keep identity/pose/framing preservation when explicitly requested.
- Treat solo portrait requests as single-subject unless there is a strong explicit signal for two or more subjects.
- Treat "versus", "vs", "against", "duel", "fight", "battle", "combat between", and equivalent wording as a pair or group scene when named subjects are present. Do not emit "single subject" instructions for pair or group scenes.
- Preserve explicit cardinality from raw_user_input: if the user asks for two subjects, both subjects, a duel, 1v1, face-to-face combat, or "between two" actors, scenePolicy.subjectMode must be "pair", explicitSubjectCount must be 2, and structuredFields.subject must contain two separate subject entries.
- Do not turn action/event nouns such as confrontation, fight, battle, duel, combat, or clash into the sole subject when the user requested actors taking part in that action.
- Make scenePolicy and constraints consistent: if subjectMode is "pair" or explicitSubjectCount is 2, promptInstructions and composition must not say "single subject".
- Each structuredFields array item must be one short atomic idea only, never a paragraph.
- Deduplicate repeated ideas across structuredFields.
- Keep negativeHints atomic: one defect or artifact per item, no long sentences.
- When a reference image is used, prioritize: identity, pose/framing/laterality, transformation details, then environment/style.

Return strict JSON only:
{
  "needsClarification": false,
  "clarificationQuestion": "",
  "canonicalEnglishInput": "full canonical English request",
  "structuredFields": {
    "subject": ["..."],
    "environment": ["..."],
    "style": ["..."],
    "composition": ["..."],
    "lighting": ["..."],
    "palette": ["..."],
    "constraints": {
      "promptInstructions": ["..."],
      "negativeHints": ["..."],
      "noText": true,
      "safeMode": true
    }
  },
  "scenePolicy": {
    "subjectMode": "single",
    "explicitSubjectCount": 1
  }
}`;

const CANONICAL_IMAGE_GENERATE_REQUEST_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'canonical_image_generate_request',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        needsClarification: { type: 'boolean' },
        clarificationQuestion: { type: 'string' },
        canonicalEnglishInput: { type: 'string' },
        structuredFields: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subject: { type: 'array', items: { type: 'string' } },
            environment: { type: 'array', items: { type: 'string' } },
            style: { type: 'array', items: { type: 'string' } },
            composition: { type: 'array', items: { type: 'string' } },
            lighting: { type: 'array', items: { type: 'string' } },
            palette: { type: 'array', items: { type: 'string' } },
            constraints: {
              type: 'object',
              additionalProperties: false,
              properties: {
                promptInstructions: { type: 'array', items: { type: 'string' } },
                negativeHints: { type: 'array', items: { type: 'string' } },
                noText: { type: 'boolean' },
                safeMode: { type: 'boolean' },
              },
              required: ['promptInstructions', 'negativeHints', 'noText', 'safeMode'],
            },
          },
          required: ['subject', 'environment', 'style', 'composition', 'lighting', 'palette', 'constraints'],
        },
        scenePolicy: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subjectMode: {
              type: 'string',
              enum: ['single', 'pair', 'group', 'unspecified'],
            },
            explicitSubjectCount: {
              anyOf: [
                { type: 'integer' },
                { type: 'null' },
              ],
            },
          },
          required: ['subjectMode', 'explicitSubjectCount'],
        },
      },
      required: [
        'needsClarification',
        'clarificationQuestion',
        'canonicalEnglishInput',
        'structuredFields',
        'scenePolicy',
      ],
    },
  },
};

const FRENCH_LEAK_PATTERNS = [
  /\b(?:avec|sans|visage|identite|identité|decor|décor|personnage|lumiere|lumière|maquillage|batte|immeuble|sujet|tenue|cadrage|corpulence|theatrale|théâtrale|sombre|cinematographique|cinématographique|realiste|réaliste|lisible)\b/i,
  /\b(?:garde|garder|preserve?r? la|preserve?r? le|ajoute|remplace|transforme|montre|utilise|aucun texte lisible|texte lisible)\b/i,
];

const FRENCH_LEAK_LOOKUP_FRAGMENTS = [
  'couronne',
  'baton',
  'hyperrealiste',
  'picturale',
  'peinture',
  'spectrale',
  'foret',
  'ville',
  'plan moyen',
  'profondeur de champ',
  'vraie personnalite visuelle',
  'rester fidele au sujet canonique nomme',
  'mettant accent',
  'en valeur',
];

const STRUCTURED_FIELD_ITEM_LIMITS = Object.freeze({
  subject: Object.freeze({ maxWords: 18, maxChars: 140, maxItems: 6 }),
  environment: Object.freeze({ maxWords: 14, maxChars: 120, maxItems: 6 }),
  style: Object.freeze({ maxWords: 12, maxChars: 100, maxItems: 6 }),
  composition: Object.freeze({ maxWords: 14, maxChars: 120, maxItems: 8 }),
  lighting: Object.freeze({ maxWords: 10, maxChars: 80, maxItems: 6 }),
  palette: Object.freeze({ maxWords: 4, maxChars: 40, maxItems: 8 }),
  promptInstructions: Object.freeze({ maxWords: 18, maxChars: 180, maxItems: 8 }),
  negativeHints: Object.freeze({ maxWords: 8, maxChars: 80, maxItems: 16 }),
});

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

const NAMED_ENTITY_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'generate',
  'create',
  'make',
  'image',
  'picture',
  'photo',
  'scene',
  'génère',
  'genere',
  'crée',
  'cree',
  'fait',
  'fais',
  'dessine',
]);

function extractPreservedNamedEntityCandidates(rawUserInput = '') {
  const text = normalizeText(rawUserInput);
  if (!text) return [];
  const matches = text.match(/\b[A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ0-9]*(?:[-'][A-ZÀ-Þ]?[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*(?:\s+[A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ0-9]*(?:[-'][A-ZÀ-Þ]?[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*)*/g) || [];
  const seen = new Set();
  const candidates = [];
  for (const match of matches) {
    const cleaned = normalizeText(match).replace(/[.,!?;:]+$/g, '');
    const lookup = normalizeLookup(cleaned);
    if (!lookup || seen.has(lookup)) continue;
    if (NAMED_ENTITY_STOPWORDS.has(lookup)) continue;
    const tokenCount = lookup.split(/\s+/).filter(Boolean).length;
    const hasNamedShape = (
      tokenCount >= 2
      || /[-']/.test(cleaned)
      || (cleaned.length >= 4 && text.indexOf(cleaned) > 0)
    );
    if (!hasNamedShape) continue;
    seen.add(lookup);
    candidates.push(cleaned);
  }
  return candidates;
}

function collectCanonicalizedRequestText(canonicalizedRequest = null) {
  const fields = canonicalizedRequest?.structuredFields || {};
  const constraints = fields?.constraints || {};
  return [
    canonicalizedRequest?.canonicalEnglishInput,
    ...(Array.isArray(fields?.subject) ? fields.subject : []),
    ...(Array.isArray(fields?.environment) ? fields.environment : []),
    ...(Array.isArray(fields?.style) ? fields.style : []),
    ...(Array.isArray(fields?.composition) ? fields.composition : []),
    ...(Array.isArray(fields?.lighting) ? fields.lighting : []),
    ...(Array.isArray(fields?.palette) ? fields.palette : []),
    ...(Array.isArray(constraints?.promptInstructions) ? constraints.promptInstructions : []),
    ...(Array.isArray(constraints?.negativeHints) ? constraints.negativeHints : []),
  ].map((entry) => normalizeText(entry)).filter(Boolean);
}

function findMissingNamedEntityCandidates(canonicalizedRequest = null) {
  const rawUserInput = normalizeText(canonicalizedRequest?.audit?.rawUserInput || '');
  const candidates = extractPreservedNamedEntityCandidates(rawUserInput);
  if (!candidates.length) return [];
  const haystack = normalizeLookup(collectCanonicalizedRequestText(canonicalizedRequest).join(' '));
  return candidates.filter((candidate) => !haystack.includes(normalizeLookup(candidate)));
}

function hasSingleSubjectInstruction(value = '') {
  const lookup = normalizeLookup(value);
  return /\b(single subject|single main subject|single clearly visible main subject|single well framed subject|single well framed|only one subject|one subject only)\b/i.test(lookup);
}

function findRawSubjectCardinalityExpectation(rawUserInput = '') {
  const lookup = normalizeLookup(rawUserInput);
  if (!lookup) {
    return { subjectMode: 'unspecified', explicitSubjectCount: null, reason: '' };
  }

  const pairPatterns = [
    {
      reason: 'explicit_two_subjects',
      pattern: /\b(?:deux|two|2)\s+(?:personnages?|characters?|combattants?|fighters?|guerriers?|warriors?|adversaires?|opponents?|sujets?|subjects?|personnes?|people|humains?|humans?)\b/i,
    },
    {
      reason: 'both_subjects',
      pattern: /\b(?:les\s+deux|both)\s+(?:personnages?|characters?|combattants?|fighters?|guerriers?|warriors?|adversaires?|opponents?|sujets?|subjects?|personnes?|people|humains?|humans?)\b/i,
    },
    {
      reason: 'between_two_actors',
      pattern: /\b(?:entre|between)\s+(?:deux|two|2)\b/i,
    },
    {
      reason: 'duel_pair_scene',
      pattern: /\b(?:duel|face\s+a\s+face|face\s+to\s+face|one\s+on\s+one|1\s*(?:v|vs|versus|contre)\s*1|1v1)\b/i,
    },
    {
      reason: 'versus_pair_scene',
      pattern: /\b(?:vs\.?|versus)\b/i,
    },
  ];

  const match = pairPatterns.find((entry) => entry.pattern.test(lookup));
  if (!match) {
    return { subjectMode: 'unspecified', explicitSubjectCount: null, reason: '' };
  }
  return { subjectMode: 'pair', explicitSubjectCount: 2, reason: match.reason };
}

function isAbstractCombatEventSubject(value = '') {
  const lookup = normalizeLookup(value);
  if (!lookup) return false;
  return /^(?:affrontement|confrontation|combat|duel|fight|battle|clash|collision|energy clash|scene|action scene|combat scene)$/i.test(lookup);
}

function findCardinalityConflict(canonicalizedRequest = null) {
  const structuredFields = canonicalizedRequest?.structuredFields || {};
  const constraints = structuredFields?.constraints || {};
  const subjectCount = Array.isArray(structuredFields?.subject) ? structuredFields.subject.length : 0;
  const scenePolicy = normalizeScenePolicy(canonicalizedRequest?.scenePolicy);
  const explicitSubjectCount = Number(scenePolicy.explicitSubjectCount || 0) || 0;
  const mode = scenePolicy.subjectMode;
  const rawExpectation = findRawSubjectCardinalityExpectation(canonicalizedRequest?.audit?.rawUserInput || '');

  if (rawExpectation.subjectMode === 'pair' && rawExpectation.explicitSubjectCount === 2) {
    if (mode === 'single' || explicitSubjectCount === 1) {
      return `raw_pair_scene_collapsed_to_single:${rawExpectation.reason}`;
    }
    if (subjectCount < 2) {
      const firstSubject = Array.isArray(structuredFields?.subject) ? structuredFields.subject[0] : '';
      if (isAbstractCombatEventSubject(firstSubject)) {
        return `raw_pair_scene_collapsed_to_event_subject:${normalizeText(firstSubject)}`;
      }
      return `raw_pair_scene_missing_two_subject_entries:${rawExpectation.reason}`;
    }
  }

  const effectivePairOrGroup = (
    mode === 'pair'
    || mode === 'group'
    || explicitSubjectCount >= 2
    || subjectCount >= 2
  );

  if ((mode === 'single' || explicitSubjectCount === 1) && subjectCount >= 2) {
    return 'scenePolicy_single_with_multiple_subjects';
  }

  if (!effectivePairOrGroup) return '';

  const conflictEntry = [
    canonicalizedRequest?.canonicalEnglishInput,
    ...(Array.isArray(structuredFields?.composition) ? structuredFields.composition : []),
    ...(Array.isArray(constraints?.promptInstructions) ? constraints.promptInstructions : []),
  ].find((entry) => hasSingleSubjectInstruction(entry));

  return conflictEntry ? `single_subject_instruction_in_multi_subject_scene:${normalizeText(conflictEntry)}` : '';
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function countWords(value = '') {
  const text = normalizeText(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function stripStructuredFieldIdeaPrefix(value = '', field = '') {
  const text = normalizeText(value)
    .replace(/^[-*•]\s*/, '')
    .replace(/^(?:subject|environment|style|composition|lighting|palette|prompt instructions?|negative hints?)\s*:\s*/i, '');

  if (field === 'negativeHints') {
    return text
      .replace(/^(?:prompt\s+n[ée]gatif|negative\s+prompt|negative\s+hints?)\s*:\s*/i, '')
      .replace(/^(?:avoid|exclude)\s+/i, '');
  }
  if (field === 'palette') {
    return text.replace(/^(?:color\s+palette|palette)\s*:\s*/i, '');
  }
  return text;
}

function isParagraphLikeStructuredFieldItem(value = '', limits = {}) {
  const text = normalizeText(value);
  if (!text) return false;
  return (
    countWords(text) > Number(limits?.maxWords || 18)
    || text.length > Number(limits?.maxChars || 140)
    || /[.!?;]\s+\S+/.test(text)
  );
}

function splitStructuredFieldIdeaCandidates(value = '', field = '', limits = {}) {
  let candidates = [stripStructuredFieldIdeaPrefix(value, field)];
  const splitters = [
    (entry) => (
      field === 'negativeHints'
      && /,\s*/.test(entry)
    )
      ? entry.split(/\s*,\s*/).map((part) => normalizeText(part)).filter(Boolean)
      : [entry],
    (entry) => isParagraphLikeStructuredFieldItem(entry, limits) && /[.!?;]+/.test(entry)
      ? entry.split(/\s*(?:[.!?;]+)\s*/).map((part) => normalizeText(part)).filter(Boolean)
      : [entry],
    (entry) => isParagraphLikeStructuredFieldItem(entry, limits) && /,\s*/.test(entry)
      ? entry.split(/\s*,\s*/).map((part) => normalizeText(part)).filter(Boolean)
      : [entry],
    (entry) => (
      field === 'negativeHints'
      && isParagraphLikeStructuredFieldItem(entry, limits)
      && /\b(?:and|or|with)\b/i.test(entry)
    )
      ? entry.split(/\s+\b(?:and|or|with)\b\s+/i).map((part) => normalizeText(part)).filter(Boolean)
      : [entry],
  ];

  for (const splitter of splitters) {
    candidates = candidates.flatMap((entry) => splitter(entry));
  }

  return candidates
    .map((entry) => stripStructuredFieldIdeaPrefix(entry, field))
    .map((entry) => normalizeText(entry).replace(/[.。]+$/g, ''))
    .filter(Boolean);
}

function normalizeAtomicIdeaList(values = [], field = '') {
  const limits = STRUCTURED_FIELD_ITEM_LIMITS[field] || STRUCTURED_FIELD_ITEM_LIMITS.subject;
  const results = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : [values]) {
    const candidates = splitStructuredFieldIdeaCandidates(value, field, limits);
    for (const candidate of candidates) {
      const cleaned = normalizeText(candidate);
      if (!cleaned) continue;
      if (isParagraphLikeStructuredFieldItem(cleaned, limits)) continue;
      const lookup = normalizeLookup(cleaned);
      if (!lookup || seen.has(lookup)) continue;
      if (results.some((entry) => {
        const existing = normalizeLookup(entry);
        return existing === lookup || existing.includes(lookup) || lookup.includes(existing);
      })) {
        continue;
      }
      results.push(cleaned);
      seen.add(lookup);
      if (results.length >= limits.maxItems) return results;
    }
  }

  return results;
}

function findNonAtomicStructuredFieldEntry(structuredFields = {}) {
  const buckets = [
    ['subject', structuredFields?.subject],
    ['environment', structuredFields?.environment],
    ['style', structuredFields?.style],
    ['composition', structuredFields?.composition],
    ['lighting', structuredFields?.lighting],
    ['palette', structuredFields?.palette],
    ['promptInstructions', structuredFields?.constraints?.promptInstructions],
    ['negativeHints', structuredFields?.constraints?.negativeHints],
  ];

  for (const [field, values] of buckets) {
    const limits = STRUCTURED_FIELD_ITEM_LIMITS[field] || STRUCTURED_FIELD_ITEM_LIMITS.subject;
    for (const entry of Array.isArray(values) ? values : []) {
      if (isParagraphLikeStructuredFieldItem(entry, limits)) {
        return {
          field,
          value: normalizeText(entry),
        };
      }
    }
  }

  return null;
}

function hasFrenchLeak(value = '') {
  const text = normalizeText(value);
  if (!text) return false;
  const lookup = normalizeLookup(text);
  return (
    FRENCH_LEAK_PATTERNS.some((pattern) => pattern.test(text))
    || FRENCH_LEAK_LOOKUP_FRAGMENTS.some((fragment) => lookup.includes(fragment))
  );
}

function isEnglishLikeText(value = '') {
  const text = normalizeText(value);
  if (!text) return false;
  if (hasFrenchLeak(text)) return false;
  const profile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(text)
    : { dominant: 'unknown', mixed: false };
  if (profile?.dominant === 'en' && profile?.mixed !== true) return true;
  if (profile?.dominant === 'unknown' && profile?.mixed !== true) return true;
  return profile?.dominant === 'en' && Number(profile?.englishScore || 0) >= Number(profile?.frenchScore || 0) + 4;
}

function normalizeScenePolicy(value = null) {
  const subjectMode = String(value?.subjectMode || '').trim().toLowerCase();
  const explicitSubjectCount = Number(value?.explicitSubjectCount);
  return {
    subjectMode: ['single', 'pair', 'group', 'unspecified'].includes(subjectMode)
      ? subjectMode
      : 'unspecified',
    explicitSubjectCount: Number.isFinite(explicitSubjectCount) && explicitSubjectCount > 0
      ? Math.round(explicitSubjectCount)
      : null,
  };
}

function normalizeStructuredFields(value = null) {
  const constraints = value?.constraints && typeof value.constraints === 'object'
    ? value.constraints
    : {};
  return {
    subject: normalizeAtomicIdeaList(value?.subject || [], 'subject'),
    environment: normalizeAtomicIdeaList(value?.environment || [], 'environment'),
    style: normalizeAtomicIdeaList(value?.style || [], 'style'),
    composition: normalizeAtomicIdeaList(value?.composition || [], 'composition'),
    lighting: normalizeAtomicIdeaList(value?.lighting || [], 'lighting'),
    palette: normalizeAtomicIdeaList(value?.palette || [], 'palette'),
    constraints: {
      promptInstructions: normalizeAtomicIdeaList(
        constraints.promptInstructions || constraints.prompt_instructions || [],
        'promptInstructions'
      ),
      negativeHints: normalizeAtomicIdeaList(
        constraints.negativeHints || constraints.negative_hints || [],
        'negativeHints'
      ),
      noText: constraints.noText !== false,
      safeMode: constraints.safeMode !== false,
    },
  };
}

function buildCanonicalEnglishInputFromStructuredFields(structuredFields = {}) {
  return toUniqueStrings([
    ...(Array.isArray(structuredFields?.subject) ? structuredFields.subject : []),
    ...(Array.isArray(structuredFields?.constraints?.promptInstructions)
      ? structuredFields.constraints.promptInstructions
      : []),
    ...(Array.isArray(structuredFields?.composition) ? structuredFields.composition : []),
    ...(Array.isArray(structuredFields?.environment) ? structuredFields.environment : []),
    ...(Array.isArray(structuredFields?.style) ? structuredFields.style : []),
    ...(Array.isArray(structuredFields?.lighting) ? structuredFields.lighting : []),
    ...(Array.isArray(structuredFields?.palette) && structuredFields.palette.length
      ? [`color palette: ${structuredFields.palette.join(', ')}`]
      : []),
    ...(structuredFields?.constraints?.noText === true ? ['no readable text'] : []),
  ]).join(', ');
}

function normalizeCanonicalizedImageGenerateRequest(payload = null, rawUserInput = '') {
  const structuredFields = normalizeStructuredFields(payload?.structuredFields);
  const canonicalEnglishInput = normalizeText(
    payload?.canonicalEnglishInput || buildCanonicalEnglishInputFromStructuredFields(structuredFields)
  );
  return {
    needsClarification: payload?.needsClarification === true,
    clarificationQuestion: normalizeText(payload?.clarificationQuestion || ''),
    canonicalEnglishInput,
    structuredFields,
    scenePolicy: normalizeScenePolicy(payload?.scenePolicy),
    audit: {
      rawUserInput: normalizeText(payload?.audit?.rawUserInput || rawUserInput),
      source: normalizeText(payload?.audit?.source || ''),
      fallbackUsed: payload?.audit?.fallbackUsed === true,
      reason: normalizeText(payload?.audit?.reason || ''),
    },
  };
}

function validateCanonicalizedImageGenerateRequest(canonicalizedRequest = null) {
  if (!canonicalizedRequest || typeof canonicalizedRequest !== 'object') {
    const error = new Error('invalid_canonicalized_request');
    error.code = 'invalid_canonicalized_request';
    throw error;
  }

  if (canonicalizedRequest.needsClarification === true) {
    return canonicalizedRequest;
  }

  if (!normalizeText(canonicalizedRequest.canonicalEnglishInput)) {
    const error = new Error('missing_canonical_english_input');
    error.code = 'missing_canonical_english_input';
    throw error;
  }

  if (!Array.isArray(canonicalizedRequest.structuredFields?.subject) || canonicalizedRequest.structuredFields.subject.length <= 0) {
    const error = new Error('missing_canonical_subject');
    error.code = 'missing_canonical_subject';
    throw error;
  }

  const englishValues = [
    canonicalizedRequest.canonicalEnglishInput,
    ...(canonicalizedRequest.structuredFields?.subject || []),
    ...(canonicalizedRequest.structuredFields?.environment || []),
    ...(canonicalizedRequest.structuredFields?.style || []),
    ...(canonicalizedRequest.structuredFields?.composition || []),
    ...(canonicalizedRequest.structuredFields?.lighting || []),
    ...(canonicalizedRequest.structuredFields?.palette || []),
    ...(canonicalizedRequest.structuredFields?.constraints?.promptInstructions || []),
    ...(canonicalizedRequest.structuredFields?.constraints?.negativeHints || []),
  ].filter(Boolean);

  const leakedValue = englishValues.find((entry) => hasFrenchLeak(entry));
  if (leakedValue) {
    const error = new Error('canonicalized_request_not_english_only');
    error.code = 'canonicalized_request_not_english_only';
    error.details = leakedValue;
    throw error;
  }

  const nonAtomicEntry = findNonAtomicStructuredFieldEntry(canonicalizedRequest.structuredFields);
  if (nonAtomicEntry) {
    const error = new Error('canonicalized_request_non_atomic_structured_fields');
    error.code = 'canonicalized_request_non_atomic_structured_fields';
    error.details = `${nonAtomicEntry.field}:${nonAtomicEntry.value}`;
    throw error;
  }

  const cardinalityConflict = findCardinalityConflict(canonicalizedRequest);
  if (cardinalityConflict) {
    const error = new Error('canonicalized_request_cardinality_conflict');
    error.code = 'canonicalized_request_cardinality_conflict';
    error.details = cardinalityConflict;
    throw error;
  }

  const missingNamedEntities = findMissingNamedEntityCandidates(canonicalizedRequest);
  if (missingNamedEntities.length) {
    const error = new Error('canonicalized_request_missing_named_entity');
    error.code = 'canonicalized_request_missing_named_entity';
    error.details = missingNamedEntities.join(', ');
    throw error;
  }

  return canonicalizedRequest;
}

function buildCanonicalizeImageGenerateRequestUserText(rawUserInput = '', options = {}) {
  return JSON.stringify({
    raw_user_input: normalizeText(rawUserInput),
    reference_image_present: options.referenceImagePresent === true,
    reference_image_url: options.referenceImageUrl ? String(options.referenceImageUrl).trim() : '',
  }, null, 2);
}

function buildCanonicalizeImageGenerateRequestRetryText(rawUserInput = '', options = {}, {
  previousPayload = null,
  rejectionCode = '',
  rejectionDetails = '',
} = {}) {
  return JSON.stringify({
    raw_user_input: normalizeText(rawUserInput),
    reference_image_present: options.referenceImagePresent === true,
    reference_image_url: options.referenceImageUrl ? String(options.referenceImageUrl).trim() : '',
    previous_rejected_payload: previousPayload && typeof previousPayload === 'object'
      ? previousPayload
      : null,
    rejection_code: normalizeText(rejectionCode),
    rejection_details: normalizeText(rejectionDetails),
    retry_instruction: 'Re-emit the full canonical request in English only, preserve every explicit named entity and subject count from raw_user_input, keep scenePolicy consistent with the subject count, use two separate subject entries for explicit pair/duel requests, never collapse actors into an abstract event subject, and make every structuredFields item a short atomic idea.',
  }, null, 2);
}

function logCanonicalizedImageGenerateRequest(canonicalizedRequest = null, stage = 'canonicalize') {
  if (!canonicalizedRequest || typeof canonicalizedRequest !== 'object') return;
  console.log(
    `[A11][prompt-canon][event] stage=${stage}`
    + ` outcome=${canonicalizedRequest.needsClarification === true ? 'clarification' : 'success'}`
    + ` source=${String(canonicalizedRequest.audit?.source || 'structured_llm').trim() || 'structured_llm'}`
    + ` fallback=${canonicalizedRequest.audit?.fallbackUsed === true ? 'true' : 'false'}`
    + (
      canonicalizedRequest.audit?.reason
        ? ` reason=${String(canonicalizedRequest.audit.reason).trim()}`
        : ''
    )
  );
  console.log(`[A11][prompt-canon][raw] stage=${stage} input=${JSON.stringify(String(canonicalizedRequest.audit?.rawUserInput || ''))}`);
  console.log(`[A11][prompt-canon][english] stage=${stage} input=${JSON.stringify(String(canonicalizedRequest.canonicalEnglishInput || ''))}`);
  console.log(`[A11][prompt-canon][fields] stage=${stage} ${JSON.stringify(canonicalizedRequest.structuredFields || {})}`);
}

function resolveCanonicalizerFailureStatus(error_ = null) {
  const status = Number(error_?.statusCode || error_?.status || 0);
  if (Number.isFinite(status) && status >= 400) return status;
  return 502;
}

function buildCanonicalizerUpstreamDetails(error_ = null) {
  if (error_?.upstream && typeof error_.upstream === 'object') {
    return {
      ...error_.upstream,
    };
  }
  return null;
}

function sanitizeRejectedCanonicalizerPayload(payload = null) {
  if (!payload || typeof payload !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
}

function resolveCanonicalizerTimeoutMs(env = process.env) {
  const explicit = Number(env.A11_IMAGE_CANONICALIZER_TIMEOUT_MS);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(5000, Math.min(120000, Math.trunc(explicit)));
  }

  const translationTimeout = Number(env.A11_WAZAA_LLM_TIMEOUT_MS);
  if (Number.isFinite(translationTimeout) && translationTimeout > 0) {
    return Math.max(12000, Math.min(30000, Math.trunc(translationTimeout)));
  }

  return 30000;
}

function shouldRetryCanonicalizerFailure(error_ = null) {
  const code = String(error_?.code || '').trim();
  return [
    'canonicalized_request_not_english_only',
    'canonicalized_request_non_atomic_structured_fields',
    'canonicalized_request_cardinality_conflict',
    'canonicalized_request_missing_named_entity',
    'missing_canonical_english_input',
    'missing_canonical_subject',
  ].includes(code);
}

function buildCanonicalizerAttemptPlan(caller = null, rawUserInput = '', options = {}, requestPayload = {}) {
  if (!caller || typeof caller?.fn !== 'function') return [];
  return [
    {
      label: caller.label,
      payload: requestPayload,
      auditReason: '',
    },
    {
      label: `${caller.label}_retry`,
      shouldRun: shouldRetryCanonicalizerFailure,
      buildPayload(error_, previousPayload) {
        return {
          ...requestPayload,
          text: buildCanonicalizeImageGenerateRequestRetryText(rawUserInput, options, {
            previousPayload,
            rejectionCode: error_?.code || error_?.message || '',
            rejectionDetails: error_?.details || '',
          }),
        };
      },
      auditReason(error_) {
        return `retry_after_${String(error_?.code || 'validation_failure').trim() || 'validation_failure'}`;
      },
    },
  ];
}

async function canonicalizeImageGenerateRequest(rawUserInput = '', options = {}) {
  const normalizedRawUserInput = normalizeText(rawUserInput);
  if (!normalizedRawUserInput) {
    const error = new Error('missing_raw_user_input');
    error.code = 'missing_raw_user_input';
    throw error;
  }

  const stage = options.stage || 'canonicalize';
  const requestPayload = {
    text: buildCanonicalizeImageGenerateRequestUserText(normalizedRawUserInput, options),
    systemPrompt: CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: Number(process.env.A11_IMAGE_CANONICALIZER_MAX_TOKENS || 1200),
    timeoutMs: resolveCanonicalizerTimeoutMs(),
    responseFormat: CANONICAL_IMAGE_GENERATE_REQUEST_RESPONSE_FORMAT,
    strict: true,
    stage,
  };
  const resolvedStructuredLlm = typeof options.callStructuredLlmJson === 'function'
    ? {
        label: 'provided_structured_llm',
        fn: options.callStructuredLlmJson,
      }
    : (
        typeof defaultCallStructuredLlmJson === 'function'
          ? {
              label: 'default_structured_llm',
              fn: defaultCallStructuredLlmJson,
            }
          : null
      );
  const llmCallers = resolvedStructuredLlm ? [resolvedStructuredLlm] : [];
  const failureReasons = [];
  const failureStatuses = [];
  const failureUpstreams = [];
  const rejectedPayloads = [];

  for (const caller of llmCallers) {
    const attempts = buildCanonicalizerAttemptPlan(caller, normalizedRawUserInput, options, requestPayload);
    let previousAttemptError = null;
    let previousAttemptPayload = null;

    for (const attempt of attempts) {
      if (typeof attempt?.shouldRun === 'function' && !attempt.shouldRun(previousAttemptError)) {
        continue;
      }

      try {
        const attemptPayload = typeof attempt?.buildPayload === 'function'
          ? attempt.buildPayload(previousAttemptError, previousAttemptPayload)
          : (attempt?.payload || requestPayload);
        const payload = await caller.fn(attemptPayload);
        if (!payload || typeof payload !== 'object') {
          previousAttemptError = new Error('empty_payload');
          previousAttemptError.code = 'empty_payload';
          failureReasons.push(`${attempt.label}:empty_payload`);
          failureStatuses.push(502);
          previousAttemptPayload = null;
          continue;
        }
        previousAttemptPayload = payload;
        const canonicalizedRequest = validateCanonicalizedImageGenerateRequest(
          normalizeCanonicalizedImageGenerateRequest({
            ...payload,
            audit: {
              ...(payload?.audit && typeof payload.audit === 'object' ? payload.audit : {}),
              source: attempt.label,
              fallbackUsed: false,
              reason: typeof attempt?.auditReason === 'function'
                ? attempt.auditReason(previousAttemptError, payload)
                : normalizeText(attempt?.auditReason || payload?.audit?.reason || ''),
            },
          }, normalizedRawUserInput)
        );
        logCanonicalizedImageGenerateRequest(canonicalizedRequest, stage);
        return canonicalizedRequest;
      } catch (error_) {
        previousAttemptError = error_;
        const reason = String(error_?.code || error_?.message || error_).trim() || 'unknown_error';
        failureReasons.push(`${attempt.label}:${reason}`);
        failureStatuses.push(resolveCanonicalizerFailureStatus(error_));
        const rejectedPayload = sanitizeRejectedCanonicalizerPayload(previousAttemptPayload);
        if (rejectedPayload) {
          rejectedPayloads.push({
            attempt: attempt.label,
            reason,
            payload: rejectedPayload,
          });
        }
        const upstream = buildCanonicalizerUpstreamDetails(error_);
        if (upstream) {
          failureUpstreams.push(upstream);
        }
        console.warn(`[A11][prompt-canon][event] stage=${stage} outcome=structured_llm_rejected source=${attempt.label} reason=${reason}`);
      }
    }
  }

  const statusCode = failureStatuses.find((status) => Number(status) === 503)
    || failureStatuses.find((status) => Number(status) >= 500)
    || 502;
  const error = new Error('image_request_canonicalizer_failed');
  error.code = 'image_request_canonicalizer_failed';
  error.statusCode = statusCode;
  error.status = statusCode;
  if (failureUpstreams.length) {
    error.upstream = failureUpstreams[0];
  }
  error.payload = {
    ok: false,
    error: 'image_request_canonicalizer_failed',
    message: 'image_request_canonicalizer_failed',
    details: {
      stage,
      reasons: failureReasons,
      policy: 'llm_only_no_heuristic_fallback',
      ...(rejectedPayloads.length ? { rejectedPayloads: rejectedPayloads.slice(-2) } : {}),
      ...(failureUpstreams.length ? { upstream: failureUpstreams[0] } : {}),
    },
  };
  console.error(
    `[A11][prompt-canon][event] stage=${stage} outcome=failed`
    + ' source=structured_llm reason=llm_only_no_heuristic_fallback'
    + (failureReasons.length ? ` reasons=${failureReasons.join('|')}` : '')
  );
  throw error;
}

function buildCanonicalizedRequestTextSmootherResult(canonicalizedRequest = null) {
  const canonicalEnglishInput = normalizeText(canonicalizedRequest?.canonicalEnglishInput || '');
  return {
    originalText: canonicalEnglishInput,
    text: canonicalEnglishInput,
    changed: false,
    usedLlm: false,
    localCorrections: [],
    suspiciousTokens: [],
    noiseScore: 0,
  };
}

function applyCanonicalizedImageGenerateRequestToMask(mask = {}, canonicalizedRequest = null) {
  const normalizedCanonicalizedRequest = validateCanonicalizedImageGenerateRequest(
    normalizeCanonicalizedImageGenerateRequest(
      canonicalizedRequest,
      canonicalizedRequest?.audit?.rawUserInput || ''
    )
  );
  const preservedOriginalSourceText = normalizeText(
    mask?.meta?.originalSourceText
    || normalizedCanonicalizedRequest.audit.rawUserInput
    || mask?.raw
    || ''
  );

  return {
    ...(mask && typeof mask === 'object' ? mask : {}),
    inputs: {
      ...((mask && mask.inputs && typeof mask.inputs === 'object') ? mask.inputs : {}),
      subject: normalizedCanonicalizedRequest.structuredFields.subject,
      environment: normalizedCanonicalizedRequest.structuredFields.environment,
      style: normalizedCanonicalizedRequest.structuredFields.style,
      composition: normalizedCanonicalizedRequest.structuredFields.composition,
      lighting: normalizedCanonicalizedRequest.structuredFields.lighting,
      palette: normalizedCanonicalizedRequest.structuredFields.palette,
    },
    constraints: {
      ...((mask && mask.constraints && typeof mask.constraints === 'object') ? mask.constraints : {}),
      no_text: normalizedCanonicalizedRequest.structuredFields.constraints.noText,
      safe_mode: normalizedCanonicalizedRequest.structuredFields.constraints.safeMode,
    },
    raw: normalizedCanonicalizedRequest.canonicalEnglishInput,
    meta: {
      ...((mask && mask.meta && typeof mask.meta === 'object') ? mask.meta : {}),
      sourceText: normalizedCanonicalizedRequest.canonicalEnglishInput,
      originalSourceText: preservedOriginalSourceText || normalizedCanonicalizedRequest.canonicalEnglishInput,
      promptSeedText: normalizedCanonicalizedRequest.canonicalEnglishInput,
      promptText: normalizedCanonicalizedRequest.canonicalEnglishInput,
      promptInstructions: normalizedCanonicalizedRequest.structuredFields.constraints.promptInstructions,
      promptNegativeHints: normalizedCanonicalizedRequest.structuredFields.constraints.negativeHints,
      negativeHints: normalizedCanonicalizedRequest.structuredFields.constraints.negativeHints,
      ...(normalizedCanonicalizedRequest.structuredFields.constraints.negativeHints.length
        ? {
            negative_prompt: normalizedCanonicalizedRequest.structuredFields.constraints.negativeHints.join(', '),
            negativePrompt: normalizedCanonicalizedRequest.structuredFields.constraints.negativeHints.join(', '),
          }
        : {}),
      canonicalizedRequest: normalizedCanonicalizedRequest,
      promptCanonicalization: {
        audit: normalizedCanonicalizedRequest.audit,
        rawUserInput: normalizedCanonicalizedRequest.audit.rawUserInput,
        canonicalEnglishInput: normalizedCanonicalizedRequest.canonicalEnglishInput,
        structuredFields: normalizedCanonicalizedRequest.structuredFields,
        scenePolicy: normalizedCanonicalizedRequest.scenePolicy,
      },
      audit: {
        ...((mask?.meta?.audit && typeof mask.meta.audit === 'object') ? mask.meta.audit : {}),
        rawUserInput: normalizedCanonicalizedRequest.audit.rawUserInput,
        promptCanonicalizationSource: normalizedCanonicalizedRequest.audit.source || '',
      },
      deferEnglishPromptLocalization: false,
    },
  };
}

module.exports = {
  CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT,
  CANONICAL_IMAGE_GENERATE_REQUEST_RESPONSE_FORMAT,
  applyCanonicalizedImageGenerateRequestToMask,
  buildCanonicalEnglishInputFromStructuredFields,
  buildCanonicalizedRequestTextSmootherResult,
  canonicalizeImageGenerateRequest,
  hasFrenchLeak,
  extractPreservedNamedEntityCandidates,
  findCardinalityConflict,
  findMissingNamedEntityCandidates,
  findRawSubjectCardinalityExpectation,
  isEnglishLikeText,
  normalizeCanonicalizedImageGenerateRequest,
  resolveCanonicalizerTimeoutMs,
  validateCanonicalizedImageGenerateRequest,
};

const {
  compileCharacterCountConstraints,
} = require('../mask/build-sd-prompt-bundle.cjs');
const {
  duckduckgoImageSearch: defaultDuckduckgoImageSearch,
} = require('../../lib/image-search.cjs');

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

function isImageReferencePackEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_REFERENCE_PACK;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function extractSemanticEntries(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => ({
      label: normalizeText(entry?.label || entry?.key || entry),
      family: normalizeLookup(entry?.family || entry?.key || ''),
    }))
    .filter((entry) => entry.label);
}

function extractBodyAnchors(mask = {}) {
  const raw = normalizeLookup([
    mask?.raw,
    ...(Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions : []),
  ].filter(Boolean).join(' '));
  const anchors = [];
  const register = (key, label, queryHint) => {
    if (anchors.some((entry) => entry.key === key)) return;
    anchors.push({ key, label, queryHint });
  };

  if (/\b(bouche|levres|levres|lips|mouth)\b/.test(raw)) register('mouth', 'bouche', 'mouth close up');
  if (/\b(main|mains|hand|hands|tenir|tenant|holding)\b/.test(raw)) register('hand', 'main', 'hand pose');
  if (/\b(tete|tête|head|chapeau|sombrero|casquette|couronne|capuche)\b/.test(raw)) register('head', 'tête', 'headwear reference');
  if (/\b(visage|face|yeux|oeil|oeils|regard)\b/.test(raw)) register('face', 'visage', 'face close up');
  if (/\b(bras|arm|arms)\b/.test(raw)) register('arm', 'bras', 'arm pose');
  if (/\b(jambe|jambes|leg|legs)\b/.test(raw)) register('leg', 'jambe', 'leg pose');
  if (/\b(corps entier|full body|silhouette|forme complete|forme complète)\b/.test(raw)) register('full_body', 'corps entier', 'full body reference');

  return anchors;
}

function resolvePrimarySubject(mask = {}) {
  return normalizeText(
    mask?.meta?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.imageEntityContext?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || mask?.inputs?.subject?.[0]
    || ''
  );
}

function resolveUniverse(mask = {}) {
  return normalizeText(
    mask?.meta?.imageScratchpad?.universe
    || mask?.meta?.imageEntityContext?.universe
    || ''
  );
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveReferenceCharacterUniverseHint(mask = {}, subject = '', universe = '') {
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const resolvedUniverse = normalizeText(universe);
  if (subjectProfileType !== 'reference_character') return resolvedUniverse;

  const normalizedSubject = normalizeLookup(subject);
  if (!normalizedSubject) return resolvedUniverse;

  if (/\bmaster chief\b|\bjohn 117\b|\bspartan 117\b/.test(normalizedSubject)) return 'Halo';
  if (/\bjames bond\b|\bagent 007\b/.test(normalizedSubject)) return 'James Bond';
  if (/\bmario\b/.test(normalizedSubject)) return 'Nintendo';
  if (/\bprincesse peach\b|\bprincess peach\b|\bpeach\b/.test(normalizedSubject)) return 'Nintendo';
  if (/\bzelda\b/.test(normalizedSubject)) return 'Nintendo';
  return resolvedUniverse;
}

function extractDistinctiveSubjectTokens(value = '') {
  const genericTokens = new Set([
    'princess',
    'princesse',
    'prince',
    'king',
    'queen',
    'lord',
    'lady',
    'sir',
    'master',
    'mr',
    'mrs',
    'ms',
    'miss',
    'dr',
    'doctor',
    'captain',
    'capitaine',
    'super',
  ]);
  const tokens = normalizeLookup(value)
    .split(/\s+/)
    .filter(Boolean);
  const distinctive = tokens.filter((token) => token.length >= 4 && !genericTokens.has(token));
  return distinctive.length
    ? [...new Set(distinctive)]
    : [...new Set(tokens.filter((token) => token.length >= 3))];
}

function hasTokenBoundaryMatch(haystack = '', token = '') {
  if (!haystack || !token) return false;
  return new RegExp(`(^|\\b)${escapeRegex(token)}(\\b|$)`, 'i').test(haystack);
}

const AMBIGUOUS_REFERENCE_SUBJECT_TOKENS = new Set([
  'mario',
  'peach',
  'robin',
]);

function looksLikeSubjectReferenceMatch(entry = {}, options = {}) {
  const combined = normalizeLookup([
    entry?.title,
    entry?.sourceUrl,
    entry?.sourceDomain,
    entry?.imageUrl,
  ].filter(Boolean).join(' '));
  if (!combined) return false;

  const subjectTokens = extractDistinctiveSubjectTokens(options?.subject || entry?.label || '');
  if (!subjectTokens.length) return true;
  if (!subjectTokens.some((token) => hasTokenBoundaryMatch(combined, token))) {
    return false;
  }

  if (!options?.strictSubject || subjectTokens.length !== 1) {
    return true;
  }

  const ambiguousToken = subjectTokens[0];
  if (!AMBIGUOUS_REFERENCE_SUBJECT_TOKENS.has(ambiguousToken)) {
    return true;
  }

  const universeTokens = extractDistinctiveSubjectTokens(options?.universe || '');
  if (universeTokens.some((token) => hasTokenBoundaryMatch(combined, token))) {
    return true;
  }

  if (ambiguousToken === 'mario') {
    return /\b(super mario|mario bros|nintendo|video game|jeu video)\b/.test(combined);
  }
  if (ambiguousToken === 'peach') {
    return /\b(princess peach|princesse peach|super mario|mario bros|nintendo|video game|jeu video)\b/.test(combined);
  }
  if (ambiguousToken === 'robin') {
    return /\b(one piece|batman|dc comics|teen titans|anime|manga|cartoon)\b/.test(combined);
  }

  return true;
}

function resolveSubjectReferenceQuerySuffix(mask = {}, options = {}) {
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const motionProfile = normalizeLookup(options?.motionProfile || '').replace(/\s+/g, '_');
  const bodyAnchors = extractBodyAnchors(mask);
  const wantsFullBody = bodyAnchors.some((entry) => entry.key === 'full_body');

  if (['mounted_archery', 'archery_shot'].includes(motionProfile)) {
    if (subjectProfileType === 'reference_character') return 'archer pose full body character art';
    if (subjectProfileType === 'single_human_figure') return 'archer pose full body reference';
    return 'archer pose full body reference';
  }
  if (['action_burst', 'power_up_loop', 'transformation_rise'].includes(motionProfile)) {
    if (subjectProfileType === 'reference_character') return 'battle pose full body character art';
    if (subjectProfileType === 'single_human_figure') return 'battle pose full body reference';
    return 'battle pose full body reference';
  }
  if (['walk_cycle', 'run_cycle', 'dance_cycle', 'gesture_loop', 'subtle_loop'].includes(motionProfile)) {
    if (subjectProfileType === 'reference_character') return 'full body pose character art';
    if (subjectProfileType === 'single_human_figure') return 'full body pose reference';
    if (subjectProfileType === 'single_animal') return 'full body animal reference';
    return 'full body reference';
  }

  if (subjectProfileType === 'reference_character') {
    return wantsFullBody ? 'solo full body character art' : 'solo character art';
  }
  if (subjectProfileType === 'single_human_figure') {
    return wantsFullBody ? 'solo full body pose reference' : 'solo pose reference';
  }
  if (subjectProfileType === 'single_animal') {
    return wantsFullBody ? 'solo full body animal reference' : 'solo animal reference';
  }
  return wantsFullBody ? 'full body reference' : 'reference';
}

function buildSubjectReferenceQuery(mask = {}, subject = '', universe = '', options = {}) {
  if (!subject) return '';
  const suffix = resolveSubjectReferenceQuerySuffix(mask, options);
  const resolvedUniverse = resolveReferenceCharacterUniverseHint(mask, subject, universe);
  return [subject, resolvedUniverse, suffix].filter(Boolean).join(' ');
}

function looksRiskyReferenceResult(entry = {}) {
  const haystack = normalizeLookup([
    entry?.title,
    entry?.sourceUrl,
    entry?.sourceDomain,
    entry?.imageUrl,
    entry?.label,
  ].filter(Boolean).join(' '));
  if (!haystack) return false;

  return /\b(?:poster|wallpaper|cover|lineup|line up|collage|mosaic|sheet|sprite\s*sheet|compilation|collection|group|crew|team|characters|personnages|all\s+characters|manga\s*page|comic\s*page|page|panel|sticker|logo|emblem|coloriage|coloring page|colouring page|line art|lineart|outline|black and white|stl|3d model|modele 3d|mod[eè]le 3d|figurine|miniature|printable|3d print|impression 3d|cults3d|thingiverse|myminifactory|cgtrader|anniversaire|birthday|celebrite|celebrity|statue|sculpture|medieval|wax|cire|mannequin|effigie)\b/i.test(haystack);
}

function shouldRejectReferenceResult(entry = {}, options = {}) {
  if (!normalizeText(entry?.imageUrl || '')) return true;
  if (looksRiskyReferenceResult(entry)) return true;

  const role = normalizeLookup(entry?.role || '');
  if (role === 'subject' && !looksLikeSubjectReferenceMatch(entry, options)) {
    return true;
  }

  const selectionScore = Number(entry?.selectionScore || 0) || 0;
  if (selectionScore > 0) {
    const minimumScore = role === 'subject' && options?.strictSubject ? 12 : 6;
    if (selectionScore < minimumScore) return true;
  }

  const width = Number(entry?.width || 0) || 0;
  const height = Number(entry?.height || 0) || 0;
  const minimumSide = (role === 'subject' && options?.strictSubject) ? 384 : 256;
  if ((width > 0 && width < minimumSide) || (height > 0 && height < minimumSide)) {
    return true;
  }

  return false;
}

function buildAccessoryQuery({ subject = '', universe = '', entry = {}, anchors = [] } = {}) {
  const label = normalizeText(entry?.label || '');
  const family = normalizeLookup(entry?.family || '');
  if (!subject || !label) return '';

  const anchorKeys = new Set((Array.isArray(anchors) ? anchors : []).map((item) => item.key));
  const lowerLabel = normalizeLookup(label);
  const headwear = /\b(chapeau|sombrero|casquette|couronne|capuche|helmet|helm)\b/.test(lowerLabel);

  if (family === 'smoking_prop') {
    return [subject, universe, label, 'mouth smoking pose anime'].filter(Boolean).join(' ');
  }
  if (family === 'weapon') {
    return [subject, universe, label, anchorKeys.has('hand') ? 'hand holding pose anime' : 'holding pose anime'].filter(Boolean).join(' ');
  }
  if (family === 'wearable') {
    const suffix = headwear || anchorKeys.has('head')
      ? 'wearing headwear anime reference'
      : 'wearing outfit anime reference';
    return [subject, universe, label, suffix].filter(Boolean).join(' ');
  }
  if (family === 'food_prop') {
    const suffix = anchorKeys.has('mouth') ? 'mouth pose anime reference' : 'anime prop reference';
    return [subject, universe, label, suffix].filter(Boolean).join(' ');
  }
  return [subject, universe, label, 'anime reference'].filter(Boolean).join(' ');
}

function buildElementQuery({ subject = '', universe = '', entry = {} } = {}) {
  const label = normalizeText(entry?.label || '');
  if (!subject || !label) return '';
  return [subject, universe, label, 'effect reference'].filter(Boolean).join(' ');
}

function buildBodyAnchorQueries(mask = {}, subject = '', universe = '', anchors = []) {
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  if (!subject || !['reference_character', 'single_human_figure'].includes(subjectProfileType)) {
    return [];
  }

  return (Array.isArray(anchors) ? anchors : [])
    .filter((entry) => ['face', 'hand', 'head'].includes(entry.key))
    .map((entry) => ({
      role: 'body_anchor',
      label: entry.label,
      family: entry.key,
      placement: entry.key,
      query: [subject, universe, entry.queryHint, 'anime reference'].filter(Boolean).join(' '),
    }));
}

function buildImageReferenceQueries(mask = {}, options = {}) {
  const subjectOnly = options?.subjectOnly === true;
  const subject = resolvePrimarySubject(mask);
  const universe = resolveUniverse(mask);
  const accessories = extractSemanticEntries(mask?.meta?.semantic?.accessories || []);
  const elements = extractSemanticEntries(mask?.meta?.semantic?.elements || []);
  const scenes = extractSemanticEntries(mask?.meta?.semantic?.scenes || []);
  const anchors = extractBodyAnchors(mask);
  const queries = [];

  if (!subject) return queries;

  queries.push({
    role: 'subject',
    label: subject,
    family: normalizeLookup(mask?.meta?.subjectProfile?.type || ''),
    placement: '',
    query: buildSubjectReferenceQuery(mask, subject, universe, options),
  });

  if (subjectOnly) {
    return queries
      .map((entry) => ({
        ...entry,
        query: normalizeText(entry.query),
      }))
      .filter((entry) => entry.query)
      .slice(0, 1);
  }

  for (const entry of accessories.slice(0, 3)) {
    queries.push({
      role: 'accessory',
      label: entry.label,
      family: entry.family,
      placement: (
        entry.family === 'smoking_prop' ? 'mouth'
          : (entry.family === 'weapon' ? 'hand'
            : (entry.family === 'wearable' ? 'head_or_body' : 'with_subject'))
      ),
      query: buildAccessoryQuery({ subject, universe, entry, anchors }),
    });
  }

  for (const entry of elements.slice(0, 2)) {
    queries.push({
      role: 'element',
      label: entry.label,
      family: entry.family,
      placement: 'around_subject',
      query: buildElementQuery({ subject, universe, entry }),
    });
  }

  for (const entry of buildBodyAnchorQueries(mask, subject, universe, anchors).slice(0, 2)) {
    queries.push(entry);
  }

  if (!accessories.length && !elements.length && scenes.length > 0) {
    const scene = scenes[0];
    queries.push({
      role: 'scene',
      label: scene.label,
      family: scene.family,
      placement: 'background',
      query: [subject, universe, scene.label, 'scene reference'].filter(Boolean).join(' '),
    });
  }

  return queries
    .map((entry) => ({
      ...entry,
      query: normalizeText(entry.query),
    }))
    .filter((entry) => entry.query)
    .slice(0, 6);
}

function shouldResolveImageReferencePack({
  mask = {},
  selection = null,
  enabled,
  forceSubjectLookup = false,
} = {}) {
  if (!isImageReferencePackEnabled(enabled)) return false;
  if (String(mask?.intent || '').trim() !== 'image.generate') return false;
  if (mask?.meta?.webReferencePack && typeof mask.meta.webReferencePack === 'object') return false;
  if (compileCharacterCountConstraints(String(mask?.raw || ''))) return false;

  const subject = resolvePrimarySubject(mask);
  if (!subject) return false;

  const accessories = extractSemanticEntries(mask?.meta?.semantic?.accessories || []);
  const elements = extractSemanticEntries(mask?.meta?.semantic?.elements || []);
  const scenes = extractSemanticEntries(mask?.meta?.semantic?.scenes || []);
  const anchors = extractBodyAnchors(mask);
  const hasPromptInstructions = Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 0;
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const canonicalSubject = normalizeText(
    mask?.meta?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.imageEntityContext?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || ''
  );

  if (
    forceSubjectLookup
    && canonicalSubject
    && ['reference_character', 'pokemon_creature'].includes(subjectProfileType)
  ) {
    return true;
  }

  return Boolean(
    selection?.candidate === true
    || accessories.length > 0
    || elements.length > 0
    || scenes.length > 0
    || anchors.length > 0
    || hasPromptInstructions
  );
}

async function resolveImageReferencePack({
  mask = {},
  selection = null,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
  enabled,
  forceSubjectLookup = false,
  subjectOnly = false,
  motionProfile = '',
} = {}) {
  if (!shouldResolveImageReferencePack({ mask, selection, enabled, forceSubjectLookup })) return null;
  if (typeof duckduckgoImageSearch !== 'function') return null;

  const queries = buildImageReferenceQueries(mask, { subjectOnly, motionProfile });
  if (!queries.length) return null;

  const references = [];
  const subject = resolvePrimarySubject(mask);
  const universe = resolveUniverse(mask);
  const subjectUniverseHint = resolveReferenceCharacterUniverseHint(mask, subject, universe);
  for (const entry of queries) {
    try {
      const result = await duckduckgoImageSearch(entry.query, {
        limit: 8,
        subject: entry.role === 'subject' ? entry.label : subject,
        universe: subjectUniverseHint || universe,
        strictSubject: entry.role === 'subject' && (forceSubjectLookup || subjectOnly),
      });
      const resolvedEntry = {
        role: entry.role,
        label: entry.label,
        family: entry.family,
        placement: entry.placement,
        query: entry.query,
        title: normalizeText(result?.title || ''),
        imageUrl: normalizeText(result?.image_url || ''),
        sourceUrl: normalizeText(result?.source_url || ''),
        sourceDomain: normalizeText(result?.source_domain || ''),
        width: Number(result?.width || 0) || null,
        height: Number(result?.height || 0) || null,
        selectionScore: Number(result?.selection_score || 0) || 0,
      };
      if (shouldRejectReferenceResult(resolvedEntry, {
        subject: entry.role === 'subject' ? entry.label : subject,
        universe: subjectUniverseHint || universe,
        strictSubject: entry.role === 'subject' && (forceSubjectLookup || subjectOnly),
      })) continue;
      references.push(resolvedEntry);
    } catch {
      continue;
    }
  }

  if (!references.length) return null;

  const summaryFacts = toUniqueStrings(references.map((entry) => (
    `Référence ${entry.role} ${entry.label} : ${entry.title || entry.sourceDomain || entry.query}`
  ))).slice(0, 6);

  return {
    subject: resolvePrimarySubject(mask),
    universe: resolveUniverse(mask),
    references,
    summaryFacts,
  };
}

module.exports = {
  buildImageReferenceQueries,
  extractBodyAnchors,
  isImageReferencePackEnabled,
  resolveImageReferencePack,
  shouldResolveImageReferencePack,
};

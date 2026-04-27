const {
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  detectPromptLanguageProfile,
  isMultiSubjectSceneRequest,
  normalizeImagePromptLiteral,
  translateImagePromptToEnglish,
} = require('./build-sd-prompt-bundle.cjs');
const {
  normalizeCanonicalizedImageGenerateRequest,
} = require('./canonicalize-image-generate-request.cjs');
const { resolveSubjectProfile } = require('./semantic/subject-profile-library.cjs');

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

function normalizeList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function normalizeAtomicNegativeHintList(values = []) {
  const results = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : [values]) {
    const segments = String(value || '')
      .split(/\s*(?:[;\n]+)\s*/)
      .flatMap((entry) => entry.split(/\s*,\s*/))
      .map((entry) => normalizeText(
        entry
          .replace(/^(?:negative prompt|negative hints?)\s*:\s*/i, '')
          .replace(/[.。]+$/g, '')
      ))
      .filter(Boolean);

    for (const segment of segments) {
      const lookup = normalizeLookup(segment);
      if (!lookup || seen.has(lookup)) continue;
      seen.add(lookup);
      results.push(segment);
    }
  }

  return results;
}

function sanitizeReferenceLateralityPhrasing(value = '') {
  let text = normalizeText(value);
  if (!text) return '';

  text = text
    .replace(/\bprimary reference image\b/gi, 'reference image')
    .replace(
      /\b(bandaged|wrapped|cast|splinted)\s+(left|right)\s+hand\b/gi,
      '$1 hand on the same side as in the reference image'
    )
    .replace(
      /\b(left|right)\s+(hand|arm)\s+placement\b/gi,
      '$2 placement on the same side as in the reference image'
    )
    .replace(/\bhandedness\b/gi, 'same-side hand laterality')
    .replace(/\bpreserve laterality\b/gi, 'preserve same-side hand laterality from the reference image')
    .replace(
      /\bkeep the same-side bandaged hand placement\b/gi,
      'preserve the same-side bandaged hand placement from the reference image'
    )
    .replace(
      /\bkeep the same-side wrapped hand placement\b/gi,
      'preserve the same-side wrapped hand placement from the reference image'
    )
    .replace(
      /\bpreserve the body angle, arm placement, (?:handedness|same-side hand laterality), and visible hand pose from the reference image\b/i,
      'preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image'
    )
    .replace(
      /\bignore any screenshot interface or overlay text from the reference image\b/i,
      'ignore screenshot interface and overlay text from the reference image'
    );

  return normalizeText(text);
}

function normalizeCanonicalAssemblyFragment(value = '') {
  const text = sanitizeReferenceLateralityPhrasing(value)
    .replace(/[.。]+$/g, '');
  if (!text) return '';

  if (/^(?:a\s+)?single subject$/i.test(text)) {
    return 'single clearly visible main subject';
  }
  if (/^(?:single main subject|single clearly visible main subject|single well-framed subject|single well framed subject)$/i.test(text)) {
    return 'single clearly visible main subject';
  }
  if (/^(?:no text|without readable text|no readable text)$/i.test(text)) {
    return 'no readable text';
  }
  if (/\bfull (?:recognizable|recognisable) character\b/i.test(text) || /\bfull character visible\b/i.test(text) || /\bfull body visible\b/i.test(text)) {
    return 'full body visible';
  }
  if (/\bfull readable creature\b/i.test(text) || /\bfull creature visible\b/i.test(text)) {
    return 'full readable creature';
  }
  if (/\bpreserve exact pose and framing\b/i.test(text) || /\bexact pose and framing\b/i.test(text)) {
    return 'preserve the pose and framing from the reference image';
  }
  if (/\bpreserve same-side hand laterality from the reference image\b/i.test(text) || /\bpreserve laterality\b/i.test(text)) {
    return 'preserve same-side hand laterality from the reference image';
  }
  if (/\bsame-side bandaged hand placement\b/i.test(text)) {
    return 'preserve the same-side bandaged hand placement from the reference image';
  }
  if (/\bsame-side wrapped hand placement\b/i.test(text)) {
    return 'preserve the same-side wrapped hand placement from the reference image';
  }
  if (/\bpreserve the body angle, arm placement, .*visible hand pose from the reference image\b/i.test(text)) {
    return 'preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image';
  }
  if (/\bignore .*screenshot.*overlay text/i.test(text) || /\bignore .*interface.*overlay text/i.test(text)) {
    return 'ignore screenshot interface and overlay text from the reference image';
  }

  return text;
}

function resolveCanonicalAssemblySemanticKey(value = '') {
  const lookup = normalizeLookup(normalizeCanonicalAssemblyFragment(value));
  if (!lookup) return '';

  if (/\bkeep exactly the same face\b|\bsame face\b|\bexact same face\b|\bsame facial structure\b|\bfacial structure\b/.test(lookup)) {
    return 'identity_exact_face';
  }
  if (/\bkeep the same eyes\b/.test(lookup) && /\bjawline\b/.test(lookup) && /\bsmile\b/.test(lookup)) {
    return 'identity_face_features';
  }
  if (/\bpreserve these distinctive visible cues from the reference image:/.test(lookup)) {
    return lookup;
  }
  if (/\bpreserve the pose and framing from the reference image\b/.test(lookup)) {
    return 'pose_framing';
  }
  if (/\bsame side hand laterality\b/.test(lookup)) {
    return 'pose_laterality';
  }
  if (/\bsame side bandaged hand placement\b/.test(lookup)) {
    return 'pose_bandaged_hand';
  }
  if (/\bsame side wrapped hand placement\b/.test(lookup)) {
    return 'pose_wrapped_hand';
  }
  if (/\bbody angle\b|\barm placement\b|\bvisible hand pose\b/.test(lookup)) {
    return 'pose_body_hand';
  }
  if (/\bsingle clearly visible main subject\b/.test(lookup)) {
    return 'directive_single_subject';
  }
  if (/\bexactly two distinct readable subjects\b/.test(lookup)) {
    return 'directive_pair';
  }
  if (/\bclear readable multi subject composition\b/.test(lookup)) {
    return 'directive_group';
  }
  if (/\bfull body visible\b/.test(lookup)) {
    return 'directive_full_body';
  }
  if (/\bfull readable creature\b/.test(lookup)) {
    return 'directive_full_creature';
  }
  if (/\bno readable text\b/.test(lookup)) {
    return 'directive_no_text';
  }
  if (/\bignore screenshot interface and overlay text from the reference image\b/.test(lookup)) {
    return 'directive_ignore_ui';
  }

  return lookup;
}

function resolveCanonicalAssemblyBucket(value = '', sourceBucket = '') {
  const lookup = normalizeLookup(normalizeCanonicalAssemblyFragment(value));
  const normalizedSourceBucket = normalizeLookup(sourceBucket);

  if (!lookup) return 'directive';
  if (normalizedSourceBucket === 'environment') return 'environment';
  if (normalizedSourceBucket === 'style') return 'style';
  if (normalizedSourceBucket === 'lighting') return 'lighting';
  if (normalizedSourceBucket === 'palette') return 'palette';
  if (normalizedSourceBucket === 'directive') return 'directive';

  if (
    /\bkeep exactly the same face\b|\bsame face\b|\bsame identity\b|\bexact same person\b|\bexact same face\b|\bfacial structure\b|\bdistinctive visible cues from the reference image\b/.test(lookup)
    || (/\bkeep the same eyes\b/.test(lookup) && /\bjawline\b/.test(lookup) && /\bsmile\b/.test(lookup))
  ) {
    return 'identity';
  }
  if (
    /\bpose and framing\b|\bbody angle\b|\barm placement\b|\bsame side hand laterality\b|\bvisible hand pose\b|\bsame side bandaged hand placement\b|\bsame side wrapped hand placement\b/.test(lookup)
  ) {
    return 'pose';
  }
  if (
    /\bjoker\b|\bmakeup\b|\bcostume\b|\boutfit\b|\bprop\b|\bbat\b|\bweapon\b|\bexpression\b|\bclown\b|\btheatrical\b/.test(lookup)
  ) {
    return 'transformation';
  }
  if (
    /\bsingle clearly visible main subject\b|\bexactly two distinct readable subjects\b|\btwo full recognizable characters\b|\bclear readable multi subject composition\b|\bfull body visible\b|\bfull readable creature\b|\bno readable text\b|\bignore screenshot interface\b/.test(lookup)
  ) {
    return 'directive';
  }
  if (
    /\bstreet\b|\bbuilding\b|\bgraffiti\b|\bbackground\b|\benvironment\b|\bdecor\b|\bentrance\b|\bground\b|\batmosphere\b|\bimmersive\b/.test(lookup)
  ) {
    return 'environment';
  }
  if (
    /\blighting\b|\breflections\b|\bneon\b|\bbacklight\b|\bportrait\b|\bcinematic\b|\brealistic\b|\blive action\b|\bcomic book\b|\bnoir\b|\bstylized\b|\bstyle\b/.test(lookup)
  ) {
    return 'style';
  }
  if (normalizedSourceBucket === 'composition') return 'directive';
  return normalizedSourceBucket === 'instruction' ? 'transformation' : 'directive';
}

function buildOrderedCanonicalPromptFragments(mask = {}, canonicalizedState = null, {
  promptInstructions = [],
  directives = [],
  composition = [],
  environment = [],
  style = [],
  lighting = [],
  paletteHints = [],
} = {}) {
  const buckets = {
    identity: [],
    pose: [],
    transformation: [],
    directive: [],
    environment: [],
    style: [],
    lighting: [],
    palette: [],
  };
  const seen = new Set();

  const append = (values, sourceBucket = '') => {
    for (const value of normalizeList(values)) {
      const fragment = normalizeCanonicalAssemblyFragment(value);
      if (!fragment || !looksCanonicalEnglishLiteral(fragment)) continue;
      const semanticKey = resolveCanonicalAssemblySemanticKey(fragment);
      if (!semanticKey || seen.has(semanticKey)) continue;
      const bucket = resolveCanonicalAssemblyBucket(fragment, sourceBucket);
      if (!buckets[bucket]) continue;
      seen.add(semanticKey);
      buckets[bucket].push(fragment);
    }
  };

  append(promptInstructions, 'instruction');
  append(directives, 'directive');
  append(composition, 'composition');
  append(environment, 'environment');
  append(style, 'style');
  append(lighting, 'lighting');
  append(paletteHints, 'palette');

  return [
    ...buckets.identity,
    ...buckets.pose,
    ...buckets.transformation,
    ...buckets.directive,
    ...buckets.environment,
    ...buckets.style,
    ...buckets.lighting,
    ...buckets.palette,
  ];
}

function looksCanonicalEnglishLiteral(value = '') {
  const text = normalizeText(value);
  if (!text) return false;
  if (/\b(?:avec|sans|visage|identite|identité|decor|décor|personnage|lumiere|lumière|maquillage|batte|sujet|tenue|cadrage|corpulence)\b/i.test(text)) {
    return false;
  }
  const profile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(text)
    : { dominant: 'unknown', mixed: false };
  return profile?.dominant === 'en' || (profile?.dominant === 'unknown' && profile?.mixed !== true);
}

function sanitizePositivePromptHint(value = '') {
  const text = normalizeText(value);
  if (!text) return '';

  const lookup = normalizeLookup(text);
  if (!lookup) return '';
  if (/\b(ne pas|pas de|sans|eviter|do not|don t|avoid)\b/.test(lookup)) return '';
  if (/negative prompt/.test(lookup)) return '';

  return text;
}

function normalizePositivePromptHints(values = []) {
  return normalizeList(
    (Array.isArray(values) ? values : [values])
      .map((entry) => sanitizePositivePromptHint(entry))
      .filter(Boolean)
  );
}

function localizeList(values = []) {
  return normalizeList(Array.isArray(values) ? values : [values]);
}

function hasSemanticElementFamily(mask = {}, family = '') {
  const normalizedFamily = normalizeText(family).toLowerCase();
  if (!normalizedFamily) return false;
  const elements = Array.isArray(mask?.meta?.semantic?.elements) ? mask.meta.semantic.elements : [];
  return elements.some((entry) => normalizeText(entry?.family || entry?.key || entry?.label || entry).toLowerCase() === normalizedFamily);
}

function hasAnimateSubjectProfile(mask = {}) {
  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '').toLowerCase();
  return [
    'single_animal',
    'single_human_figure',
    'reference_character',
    'pokemon_creature',
    'phoenix_creature',
    'mythic_creature',
  ].includes(subjectProfileType);
}

function limitWords(value = '', maxWords = 10) {
  const words = normalizeText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, Math.max(1, maxWords)).join(' ');
}

function analyzePromptDensity(value = '') {
  const text = normalizeText(value);
  return {
    length: text.length,
    words: text ? text.split(/\s+/).filter(Boolean).length : 0,
    clauses: text
      ? text
        .split(/[.!?;:\n]+/)
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
        .length
      : 0,
    commas: (text.match(/,/g) || []).length,
  };
}

function trimPromptFragment(value = '', maxWords = 10) {
  return limitWords(
    normalizeText(String(value || '')
      .replace(/^(?:sujet principal|environnement|style|composition|lumi[eè]re|couleurs?)\s*:\s*/i, '')
      .replace(/^(?:cr[eé]er une image fid[eè]le [^.]+|composer une sc[eè]ne [^.]+)\.?\s*/i, '')
      .replace(/[.。]+$/g, '')),
    maxWords
  );
}

function takeCompactHints(values = [], options = {}) {
  const {
    maxItems = 3,
    maxWords = 8,
    exclude = [],
  } = options;
  const blocked = exclude.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean);
  const results = [];

  for (const value of normalizeList(values)) {
    const compact = trimPromptFragment(value, maxWords);
    if (!compact) continue;
    const lowered = compact.toLowerCase();
    if (blocked.includes(lowered)) continue;
    if (results.some((entry) => entry.toLowerCase() === lowered)) continue;
    if (results.some((entry) => entry.toLowerCase().includes(lowered) || lowered.includes(entry.toLowerCase()))) {
      continue;
    }
    results.push(compact);
    if (results.length >= maxItems) break;
  }

  return results;
}

function filterConflictingCompositionHints(values = [], options = {}) {
  const { pair = null } = options;
  const entries = normalizeList(values);
  if (pair?.count !== 2) return entries;
  return entries.filter((entry) => !/\b(unique|un seul|sujet unique|personnage unique)\b/i.test(entry));
}

function isSoloCompositionHint(value = '') {
  const entry = normalizeText(value).toLowerCase();
  if (!entry) return false;
  return [
    /sujet unique bien cadr[eé]/i,
    /silhouette lisible/i,
    /forme compl[eè]te visible/i,
    /un seul sujet principal/i,
    /personnage complet et reconnaissable/i,
    /corps entier dans le cadre/i,
    /un seul personnage complet/i,
    /une seule personne compl[eè]te/i,
    /visage unique bien lisible/i,
    /corps complet bien visible/i,
    /cr[eé]ature unique compl[eè]te/i,
    /cr[eé]ature compl[eè]te et lisible/i,
  ].some((pattern) => pattern.test(entry));
}

function filterSceneCompositionHints(values = [], options = {}) {
  const { pair = null, multiSubjectScene = false } = options;
  const entries = filterConflictingCompositionHints(values, { pair });
  if (!multiSubjectScene) return entries;
  return entries.filter((entry) => !isSoloCompositionHint(entry));
}

function joinPromptFragments(values = [], options = {}) {
  const normalizedOptions = typeof options === 'number'
    ? { maxChars: options }
    : (options && typeof options === 'object' ? options : {});
  const {
    maxChars = 420,
    allowLeadOverflow = false,
  } = normalizedOptions;
  const fragments = normalizeList(values);
  if (!fragments.length) return '';

  const kept = [];
  for (const [index, fragment] of fragments.entries()) {
    const next = kept.length ? `${kept.join(', ')}, ${fragment}` : fragment;
    if (next.length > maxChars) {
      if (!kept.length && allowLeadOverflow === true && index === 0) {
        kept.push(fragment);
      }
      break;
    }
    kept.push(fragment);
  }

  return kept.join(', ');
}

function splitPromptFragments(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function resolvePromptLanguage(mask = {}) {
  const compilerTarget = String(mask?.compiler?.target || '').trim().toLowerCase();
  const deferEnglishLocalization = mask?.meta?.deferEnglishPromptLocalization === true;
  if (deferEnglishLocalization && compilerTarget === 'image-prompt-en') {
    const languageSample = normalizeText([
      mask?.raw,
      ...(Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : []),
      ...(Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : []),
      ...(Array.isArray(mask?.inputs?.style) ? mask.inputs.style : []),
      ...(Array.isArray(mask?.inputs?.composition) ? mask.inputs.composition : []),
      ...(Array.isArray(mask?.inputs?.lighting) ? mask.inputs.lighting : []),
      ...(Array.isArray(mask?.inputs?.palette) ? mask.inputs.palette : []),
    ].filter(Boolean).join(' '));
    const profile = typeof detectPromptLanguageProfile === 'function'
      ? detectPromptLanguageProfile(languageSample)
      : { dominant: 'unknown' };
    return profile?.dominant === 'en' ? 'en' : 'fr';
  }
  return ['image-prompt-en', 'sd-payload'].includes(compilerTarget) ? 'en' : 'fr';
}

function localizePromptFragment(value = '', language = 'fr') {
  const text = normalizeText(value);
  if (!text) return '';
  if (String(language || '').trim().toLowerCase() !== 'en') {
    return text;
  }
  return normalizeText(translateImagePromptToEnglish(text) || text);
}

function localizePromptList(values = [], language = 'fr') {
  return normalizeList(Array.isArray(values) ? values : [values])
    .map((entry) => localizePromptFragment(entry, language))
    .filter(Boolean);
}

function resolveImageOptionNumber(value, {
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  fallback = 0,
  integer = false,
} = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = integer ? Math.round(numeric) : numeric;
  return Math.max(min, Math.min(max, normalized));
}

function resolveOptionalSeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(4294967295, Math.round(numeric)));
}

function buildFallbackImagePrompt(mask = {}, language = 'fr') {
  const subjectFallback = normalizeList(mask?.inputs?.subject || [])[0];
  if (subjectFallback) {
    return localizePromptFragment(subjectFallback, language);
  }

  const rawFallback = normalizeImagePromptLiteral(mask?.raw || '');
  if (rawFallback) {
    return localizePromptFragment(rawFallback, language);
  }

  return language === 'en' ? 'coherent detailed scene' : 'scene cohérente détaillée';
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveCanonicalLeadSubject(mask = {}) {
  return normalizeText(
    mask?.meta?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.imageEntityContext?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || ''
  );
}

function resolveCanonicalLeadAliases(mask = {}, canonicalSubject = '') {
  const aliases = normalizeList([
    mask?.inputs?.subject?.[0],
    ...(Array.isArray(mask?.meta?.imageEntityContext?.aliases) ? mask.meta.imageEntityContext.aliases : []),
    canonicalSubject.split(/\s+/).length >= 2 ? canonicalSubject.split(/\s+/).slice(-1)[0] : '',
  ]);
  const canonicalLookup = normalizeLookup(canonicalSubject);
  return aliases.filter((entry) => normalizeLookup(entry) !== canonicalLookup);
}

function promoteCanonicalLeadSubject(lead = '', mask = {}) {
  const cleanedLead = normalizeText(lead);
  if (!cleanedLead) return '';

  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  if (subjectProfileType !== 'reference_character') return cleanedLead;

  const canonicalSubject = resolveCanonicalLeadSubject(mask);
  if (!canonicalSubject) return cleanedLead;
  if (normalizeLookup(cleanedLead).startsWith(normalizeLookup(canonicalSubject))) {
    return cleanedLead;
  }

  for (const alias of resolveCanonicalLeadAliases(mask, canonicalSubject)) {
    const pattern = new RegExp(`^${escapeRegex(alias)}(?=\\b|\\s|,)`, 'i');
    if (pattern.test(cleanedLead)) {
      return normalizeText(cleanedLead.replace(pattern, canonicalSubject));
    }
  }

  return cleanedLead;
}

function hasReferenceInitImage(mask = {}) {
  return Boolean(normalizeText(
    mask?.meta?.reference_image_url
    || mask?.meta?.init_image_url
    || mask?.meta?.webImageDraft?.initImageUrl
    || mask?.meta?.webImageDraft?.initImagePath
    || ''
  ));
}

function hasChatSourceReference(mask = {}) {
  return mask?.meta?.webImageDraft?.fromChatSourceImage === true;
}

function isReferenceHumanFigure(mask = {}) {
  return (
    hasReferenceInitImage(mask)
    && normalizeLookup(mask?.meta?.subjectProfile?.type || '') === 'single_human_figure'
  );
}

function buildReferenceHumanIdentityLockHints(language = 'en') {
  if (String(language || '').trim().toLowerCase() === 'fr') {
    return [
      'garder exactement le même visage, la même structure faciale et la même identité',
      'garder les mêmes yeux, les mêmes sourcils, le même nez, la même mâchoire et le même sourire',
      'préserver la pose et le cadrage de l image de référence',
      'préserver l angle du corps, le placement des bras, la latéralité du même côté et la pose visible des mains de l image de référence',
    ];
  }

  return [
    'keep exactly the same face, facial structure, and identity',
    'keep the same eyes, eyebrows, nose, jawline, and smile from the reference image',
    'preserve the pose and framing from the reference image',
    'preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image',
  ];
}

function hasJokerStyleTransformationSignal(value = '') {
  return /\b(joker(?:[ -]?style|[ -]?themed)?|joker-inspired|joker inspired|character inspired by the joker|personnage inspire du joker|joker portrait|joker-style transformation|joker style transformation)\b/i.test(String(value || ''));
}

function isReferenceHumanJokerTransformation(mask = {}, value = '') {
  if (!isReferenceHumanFigure(mask)) return false;
  return hasJokerStyleTransformationSignal([
    value,
    mask?.raw,
    mask?.meta?.originalSourceText,
    mask?.meta?.canonicalizedRequest?.canonicalEnglishInput,
    mask?.meta?.promptCanonicalization?.canonicalEnglishInput,
  ].filter(Boolean).join(' '));
}

function rewriteReferenceHumanStyledSubject(value = '', mask = {}) {
  const text = normalizeText(value);
  if (!text || !isReferenceHumanFigure(mask)) return text;

  const rewriteInspiredSubject = (styleLabel = '') => {
    const normalizedStyleLabel = normalizeLookup(styleLabel);
    if (normalizedStyleLabel.includes('joker')) {
      return 'the same person from the reference image transformed into a Joker-style version';
    }
    return `${normalizeText(styleLabel)}-style version of the same person without altering identity`;
  };

  return normalizeText(
    text
      .replace(
        /\b([a-z][a-z0-9' -]{0,40})-inspired character\b/gi,
        (_match, styleLabel) => rewriteInspiredSubject(styleLabel)
      )
      .replace(
        /\bcharacter inspired by ([a-z][a-z0-9' -]{0,40})\b/gi,
        (_match, styleLabel) => rewriteInspiredSubject(styleLabel)
      )
  );
}

function isRichPromptAssemblyMode(mask = {}, rawPrompt = '') {
  const sourceText = normalizeText(
    mask?.meta?.originalSourceText
    || rawPrompt
    || ''
  );
  const density = analyzePromptDensity(sourceText);
  return (
    hasReferenceInitImage(mask)
    || density.length >= 320
    || density.words >= 55
    || density.clauses >= 6
    || density.commas >= 6
    || (Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length >= 4)
  );
}

function resolvePromptJoinBudget(mask = {}, rawPrompt = '') {
  const sourceText = normalizeText(
    mask?.meta?.originalSourceText
    || rawPrompt
    || ''
  );
  const density = analyzePromptDensity(sourceText);
  return Math.max(
    hasReferenceInitImage(mask) ? 760 : 520,
    Math.min(
      2600,
      260 + density.length + (density.words * 6) + (density.clauses * 80)
    )
  );
}

function resolveInitImageLeadAnchor(mask = {}) {
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  return (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'single_human_figure'
  )
    ? 'la même personne que sur l image de référence'
    : 'le même sujet que sur l image de référence';
}

function shouldPrefixInitImageLead(lead = '', subject = [], mask = {}) {
  if (!hasReferenceInitImage(mask)) return false;

  const normalizedLead = normalizeLookup(lead);
  if (!normalizedLead) return true;
  if (/\b(meme|same|reference|photo de reference|image de reference|personne de reference|sujet de reference)\b/i.test(normalizedLead)) {
    return false;
  }

  return normalizeList(subject).length === 0;
}

function buildPromptLead(rawPrompt = '', subject = [], mask = {}) {
  const cleanedPrompt = normalizeImagePromptLiteral(rawPrompt);
  const baseLead = cleanedPrompt
    ? promoteCanonicalLeadSubject(cleanedPrompt, mask)
    : normalizeList(subject).join(' et ');

  if (shouldPrefixInitImageLead(baseLead, subject, mask)) {
    return normalizeText(
      [resolveInitImageLeadAnchor(mask), baseLead]
        .filter(Boolean)
        .join(', ')
    );
  }

  return baseLead;
}

function buildCompactDirectives(mask = {}, options = {}) {
  const {
    pair = null,
    single = null,
    subjectProfileType = '',
    multiSubjectScene = false,
  } = options;
  const directives = [];

  if (pair?.count === 2) {
    directives.push('deux sujets distincts et lisibles');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'pokemon_creature'
      || subjectProfileType === 'single_human_figure'
    ) {
      directives.push('deux personnages complets et reconnaissables');
    }
  } else if (single?.count === 1 && !multiSubjectScene) {
    directives.push('un seul sujet principal');
  }

  if (
    !multiSubjectScene
    && !pair?.count
    && (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'pokemon_creature'
    || subjectProfileType === 'single_human_figure'
    )
  ) {
    directives.push('personnage complet et reconnaissable');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      directives.push('corps entier dans le cadre');
    }
  }

  if (
    !multiSubjectScene
    && !pair?.count
    && (
      subjectProfileType === 'single_animal'
      || subjectProfileType === 'mythic_creature'
      || subjectProfileType === 'phoenix_creature'
    )
  ) {
    directives.push('créature complète et lisible');
  }

  if (hasSemanticElementFamily(mask, 'fire') && hasAnimateSubjectProfile(mask)) {
    directives.push('flammes nettes autour du sujet');
  }

  if (mask?.constraints?.no_text === true) {
    directives.push('sans texte lisible');
  }

  return takeCompactHints(directives, { maxItems: 4, maxWords: 6 });
}

function buildPositiveInstructionHints(mask = {}, options = {}) {
  const {
    maxItems = 2,
    maxWords = 14,
    exclude = [],
  } = options;

  const profileInstruction = sanitizePositivePromptHint(mask?.meta?.subjectProfile?.promptInstruction || '');
  const promptInstructions = normalizePositivePromptHints(mask?.meta?.promptInstructions || []);
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const referencePreservationHints = hasReferenceInitImage(mask)
    ? (
        subjectProfileType === 'single_human_figure'
      )
      ? [
          ...buildReferenceHumanIdentityLockHints('fr'),
          'préserver la même corpulence et la même posture',
          'préserver la silhouette et la tenue principale',
        ]
      : (
        subjectProfileType === 'reference_character'
      )
      ? [
          'garder le même visage et la même coiffure',
          'préserver la pose et le cadrage de l image de référence',
          'préserver la silhouette et la tenue principale',
        ]
      : [
          'préserver le sujet de référence',
        ]
    : [];

  return takeCompactHints(
    [
      profileInstruction,
      ...referencePreservationHints,
      ...promptInstructions,
    ],
    {
      maxItems,
      maxWords,
      exclude,
    }
  );
}

function buildNegativePrompt(mask = {}) {
  const subject = localizeList(mask?.inputs?.subject || []);
  const environment = localizeList(mask?.inputs?.environment || []);
  const composition = localizeList(mask?.inputs?.composition || []);
  const resolvedSubjectProfile = mask?.meta?.subjectProfile || resolveSubjectProfile({
    subject: subject.join(' '),
    definitionSummary: String(mask?.meta?.definitionLookup?.summary || mask?.meta?.definitionContext?.summary || '').trim(),
    sourceText: String(mask?.raw || '').trim(),
  });
  const subjectProfileType = normalizeText(resolvedSubjectProfile?.type || '');
  const rawPrompt = normalizeText(mask?.raw || '');
  const pair = rawPrompt ? compileCharacterCountConstraints(rawPrompt) : null;
  const single = pair ? null : (rawPrompt ? compileSingleSubjectConstraints(rawPrompt) : null);
  const multiSubjectScene = Boolean(pair?.count >= 2) || isMultiSubjectSceneRequest(rawPrompt);
  const hints = [];

  if (mask?.constraints?.no_text === true) {
    hints.push('texte lisible', 'watermark', 'logo', 'signature');
  }

  if (hasReferenceInitImage(mask)) {
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      hints.push('autre personne', 'visage différent', 'identité différente');
    } else {
      hints.push('sujet différent');
    }
  }

  if (hasChatSourceReference(mask)) {
    hints.push(
      'texte incrusté',
      'date incrustée',
      'capture d écran',
      'interface mobile',
      'barre de statut',
      'icônes de téléphone',
      'cadre de smartphone'
    );
  }

  if (pair?.count === 2) {
    hints.push('troisième sujet', 'personnage supplémentaire', 'foule');
    if (Array.isArray(pair?.negativeHints)) {
      hints.push(...pair.negativeHints);
    }
  } else if (!multiSubjectScene && (single?.count === 1 || subject.length <= 1)) {
    hints.push('plusieurs sujets', 'doublon du sujet', 'foule');
  }

  if (
    !multiSubjectScene
    && (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'pokemon_creature'
    || subjectProfileType === 'single_human_figure'
    )
  ) {
    hints.push('visages dupliqués', 'personnage coupé');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      hints.push('hors cadre', 'gros plan', 'plan poitrine');
    }
  }

  if (
    !multiSubjectScene
    && (
      subjectProfileType === 'single_animal'
      || subjectProfileType === 'mythic_creature'
      || subjectProfileType === 'phoenix_creature'
    )
  ) {
    hints.push('créatures multiples', 'anatomie fusionnée');
  }

  if (subjectProfileType === 'phoenix_creature') {
    hints.push('plusieurs têtes', 'ailes supplémentaires', 'forme de fleur', 'plante');
  }

  if (subjectProfileType === 'simple_food_object' || subjectProfileType === 'container_object') {
    hints.push('objets multiples', 'décor encombré', 'arrière-plan chargé');
  }

  if (subjectProfileType === 'single_plant_object') {
    hints.push('plusieurs plantes', 'forêt dense', 'arrière-plan chargé');
  }

  const mergedSceneHints = [...environment, ...composition].join(' ');
  if (/(fond neutre simple|fond simple|décor simple|objet centré|sujet centré)/i.test(mergedSceneHints)) {
    hints.push('arrière-plan chargé', 'décor encombré');
  }
  if (
    !multiSubjectScene
    && /(forme complète visible|corps complet|sujet unique bien cadré|silhouette lisible|sujet centré|objet centré)/i.test(mergedSceneHints)
  ) {
    hints.push('sujet coupé', 'hors cadre');
  }

  const extraNegativeHints = normalizeList([
    ...(Array.isArray(mask?.meta?.promptNegativeHints) ? mask.meta.promptNegativeHints : []),
    ...(Array.isArray(mask?.meta?.negativeHints) ? mask.meta.negativeHints : []),
    ...splitPromptFragments(mask?.meta?.negative_prompt || mask?.meta?.negativePrompt || ''),
  ]);

  const finalHints = normalizeAtomicNegativeHintList([...hints, ...extraNegativeHints]).slice(0, 12);
  return finalHints.length ? finalHints.join(', ') : '';
}

function resolveCanonicalizedPromptState(mask = {}) {
  const source = (
    mask?.meta?.canonicalizedRequest && typeof mask.meta.canonicalizedRequest === 'object'
      ? mask.meta.canonicalizedRequest
      : (mask?.meta?.promptCanonicalization && typeof mask.meta.promptCanonicalization === 'object'
          ? mask.meta.promptCanonicalization
          : null)
  );
  if (!source) return null;

  const normalizedCanonicalizedRequest = normalizeCanonicalizedImageGenerateRequest(
    source,
    mask?.meta?.originalSourceText || mask?.raw || ''
  );
  const structuredFields = normalizedCanonicalizedRequest?.structuredFields && typeof normalizedCanonicalizedRequest.structuredFields === 'object'
    ? normalizedCanonicalizedRequest.structuredFields
    : {};
  const constraints = structuredFields?.constraints && typeof structuredFields.constraints === 'object'
    ? structuredFields.constraints
    : {};

  return {
    canonicalEnglishInput: normalizeText(normalizedCanonicalizedRequest?.canonicalEnglishInput || ''),
    structuredFields: {
      subject: normalizeList(structuredFields?.subject || []),
      environment: normalizeList(structuredFields?.environment || []),
      style: normalizeList(structuredFields?.style || []),
      composition: normalizeList(structuredFields?.composition || []),
      lighting: normalizeList(structuredFields?.lighting || []),
      palette: normalizeList(structuredFields?.palette || []),
      constraints: {
        promptInstructions: normalizeList(constraints?.promptInstructions || constraints?.prompt_instructions || []),
        negativeHints: normalizeAtomicNegativeHintList(constraints?.negativeHints || constraints?.negative_hints || []),
        noText: constraints?.noText !== false && mask?.constraints?.no_text !== false,
        safeMode: constraints?.safeMode !== false && mask?.constraints?.safe_mode !== false,
      },
    },
    scenePolicy: {
      subjectMode: ['single', 'pair', 'group', 'unspecified'].includes(String(normalizedCanonicalizedRequest?.scenePolicy?.subjectMode || '').trim().toLowerCase())
        ? String(normalizedCanonicalizedRequest.scenePolicy.subjectMode).trim().toLowerCase()
        : 'unspecified',
      explicitSubjectCount: Number.isFinite(Number(normalizedCanonicalizedRequest?.scenePolicy?.explicitSubjectCount))
        ? Math.max(1, Math.round(Number(normalizedCanonicalizedRequest.scenePolicy.explicitSubjectCount)))
        : null,
    },
  };
}

function resolveCanonicalScenePolicy(mask = {}, canonicalizedState = null) {
  const subjectCount = Array.isArray(canonicalizedState?.structuredFields?.subject)
    ? canonicalizedState.structuredFields.subject.length
    : 0;
  const explicitSubjectCount = Number(canonicalizedState?.scenePolicy?.explicitSubjectCount || 0) || 0;
  const subjectMode = String(canonicalizedState?.scenePolicy?.subjectMode || '').trim().toLowerCase();

  if (explicitSubjectCount >= 3 || subjectMode === 'group') {
    return { subjectMode: 'group', subjectCount: Math.max(3, explicitSubjectCount || subjectCount || 3) };
  }
  if (explicitSubjectCount === 2 || subjectMode === 'pair' || subjectCount === 2) {
    return { subjectMode: 'pair', subjectCount: 2 };
  }
  if (explicitSubjectCount === 1 || subjectMode === 'single' || subjectCount <= 1) {
    return { subjectMode: 'single', subjectCount: 1 };
  }
  return { subjectMode: 'unspecified', subjectCount: Math.max(1, subjectCount || explicitSubjectCount || 1) };
}

function buildCanonicalEnglishLead(subject = [], mask = {}) {
  const joinedSubject = subject.length <= 2
    ? subject.join(' and ')
    : subject.join(', ');
  if (isReferenceHumanJokerTransformation(mask, joinedSubject)) {
    return 'the exact same person from the reference image in a Joker-style transformation';
  }
  const cleanedLead = rewriteReferenceHumanStyledSubject(joinedSubject, mask);
  if (!hasReferenceInitImage(mask)) return cleanedLead;
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const referenceAnchor = (
    subjectProfileType === 'reference_character'
    || subjectProfileType === 'single_human_figure'
  )
    ? 'the same person as in the reference image'
    : 'the same subject as in the reference image';

  if (!cleanedLead || /^reference subject$/i.test(cleanedLead)) {
    return referenceAnchor;
  }
  if (/\bthe same (?:person|subject) as in the reference image\b/i.test(cleanedLead)) {
    return cleanedLead;
  }
  return `${referenceAnchor}, ${cleanedLead}`;
}

function buildCanonicalEnglishDirectives(mask = {}, canonicalizedState = null) {
  const directives = [];
  const scenePolicy = resolveCanonicalScenePolicy(mask, canonicalizedState);

  // Pour les scènes multi-sujets explicites, ajouter les directives de cardinalité
  // Le LLM canonicalizer a déjà décidé subjectMode — on respecte sa décision.
  if (scenePolicy.subjectMode === 'pair') {
    directives.push('exactly two distinct readable subjects');
  } else if (scenePolicy.subjectMode === 'group') {
    directives.push('clear readable multi-subject composition');
  }
  // Ne plus injecter "single clearly visible main subject" par défaut —
  // le LLM canonicalizer l'ajoute dans promptInstructions si nécessaire.

  if (canonicalizedState?.structuredFields?.constraints?.noText === true) {
    directives.push('no readable text');
  }

  if (hasChatSourceReference(mask)) {
    directives.push('ignore screenshot interface and overlay text from the reference image');
  }

  return normalizeList(directives);
}

function buildCanonicalEnglishNegativePrompt(mask = {}, canonicalizedState = null) {
  const hints = [];
  const subjectProfileType = normalizeLookup(mask?.meta?.subjectProfile?.type || '');
  const scenePolicy = resolveCanonicalScenePolicy(mask, canonicalizedState);

  if (canonicalizedState?.structuredFields?.constraints?.noText === true) {
    hints.push('readable text', 'watermark', 'logo', 'signature');
  }

  if (hasReferenceInitImage(mask)) {
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      hints.push('different person', 'different face', 'different identity');
    } else {
      hints.push('different subject');
    }
  }

  if (hasChatSourceReference(mask)) {
    hints.push(
      'embedded text',
      'embedded timestamp',
      'mobile screenshot',
      'mobile interface',
      'status bar',
      'phone icons',
      'smartphone frame',
      'story caption overlay',
      'social media overlay',
      'ui overlay'
    );
  }

  if (scenePolicy.subjectMode === 'pair') {
    hints.push('third subject', 'extra character', 'crowd', 'collage', 'montage');
  } else if (scenePolicy.subjectMode === 'single') {
    hints.push('multiple subjects', 'duplicate subject', 'crowd');
  }

  if (
    scenePolicy.subjectMode === 'single'
    && (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
      || subjectProfileType === 'pokemon_creature'
    )
  ) {
    hints.push('duplicated faces', 'cropped character');
    if (
      subjectProfileType === 'reference_character'
      || subjectProfileType === 'single_human_figure'
    ) {
      hints.push('head crop', 'feet crop', 'close-up only', 'torso crop');
    }
  }

  if (
    scenePolicy.subjectMode === 'single'
    && (
      subjectProfileType === 'single_animal'
      || subjectProfileType === 'mythic_creature'
      || subjectProfileType === 'phoenix_creature'
    )
  ) {
    hints.push('multiple creatures', 'merged anatomy');
  }

  if (subjectProfileType === 'phoenix_creature') {
    hints.push('multiple heads', 'extra wings', 'flower shape', 'plant');
  }

  if (subjectProfileType === 'simple_food_object' || subjectProfileType === 'container_object') {
    hints.push('multiple objects', 'cluttered scene', 'busy background');
  }

  if (subjectProfileType === 'single_plant_object') {
    hints.push('multiple plants', 'dense forest', 'busy background');
  }

  const extraNegativeHints = normalizeList([
    ...(canonicalizedState?.structuredFields?.constraints?.negativeHints || []),
    ...(Array.isArray(mask?.meta?.promptNegativeHints) ? mask.meta.promptNegativeHints : []),
    ...(Array.isArray(mask?.meta?.negativeHints) ? mask.meta.negativeHints : []),
    ...splitPromptFragments(mask?.meta?.negative_prompt || mask?.meta?.negativePrompt || ''),
  ]).filter((entry) => looksCanonicalEnglishLiteral(entry));

  return normalizeAtomicNegativeHintList([...extraNegativeHints, ...hints]).slice(0, 16).join(', ');
}

function resolveCanonicalPromptJoinBudget(mask = {}, canonicalizedState = null) {
  const sourceText = normalizeText(canonicalizedState?.canonicalEnglishInput || '');
  const density = analyzePromptDensity(sourceText);
  return Math.max(
    hasReferenceInitImage(mask) ? 860 : 620,
    Math.min(
      3200,
      420 + density.length + (density.words * 8) + (density.clauses * 110)
    )
  );
}

function resolvePrimaryReferenceManifest(mask = {}) {
  const manifests = Array.isArray(mask?.meta?.imageReferenceManifests)
    ? mask.meta.imageReferenceManifests
    : [];
  const primaryImageId = normalizeText(mask?.meta?.imageReferenceDecision?.primaryImageId || '');
  if (!primaryImageId) return null;
  return manifests.find((entry) => normalizeText(entry?.image_id || entry?.imageId || '') === primaryImageId) || null;
}

function buildPrimaryReferenceAnchorHints(mask = {}, language = 'en') {
  if (String(language || '').trim().toLowerCase() !== 'en') return [];

  const primaryManifest = resolvePrimaryReferenceManifest(mask);
  const detectedContent = sanitizeReferenceLateralityPhrasing(
    primaryManifest?.detected_content || primaryManifest?.detectedContent || ''
  );
  if (!detectedContent) return [];

  return [
    `preserve these distinctive visible cues from the reference image: ${detectedContent}`,
  ];
}

function buildCanonicalEnglishPromptInstructions(mask = {}, canonicalizedState = null) {
  return normalizeList([
    ...(isReferenceHumanFigure(mask) ? buildReferenceHumanIdentityLockHints('en') : []),
    ...buildPrimaryReferenceAnchorHints(mask, 'en'),
    ...(Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions : []),
    ...(canonicalizedState?.structuredFields?.constraints?.promptInstructions || []),
  ]).filter((entry) => looksCanonicalEnglishLiteral(entry));
}

function compileCanonicalizedMaskToImagePrompt(mask = {}, canonicalizedState = null) {
  const subject = normalizeList(canonicalizedState?.structuredFields?.subject || [])
    .map((entry) => rewriteReferenceHumanStyledSubject(entry, mask))
    .filter(Boolean);
  const environment = normalizeList(canonicalizedState?.structuredFields?.environment || []);
  const style = normalizeList(canonicalizedState?.structuredFields?.style || []);
  const composition = normalizeList(canonicalizedState?.structuredFields?.composition || []);
  const lighting = normalizeList(canonicalizedState?.structuredFields?.lighting || []);
  const palette = normalizeList(canonicalizedState?.structuredFields?.palette || []);
  const promptInstructions = buildCanonicalEnglishPromptInstructions(mask, canonicalizedState);
  const promptLead = buildCanonicalEnglishLead(subject, mask);
  const directives = buildCanonicalEnglishDirectives(mask, canonicalizedState);
  const paletteHints = palette.length ? [`color palette: ${palette.slice(0, 6).join(', ')}`] : [];
  const orderedFragments = buildOrderedCanonicalPromptFragments(mask, canonicalizedState, {
    promptInstructions,
    directives,
    composition,
    environment,
    style,
    lighting,
    paletteHints,
  });

  const prompt = joinPromptFragments([
    promptLead,
    ...orderedFragments,
  ], {
    maxChars: resolveCanonicalPromptJoinBudget(mask, canonicalizedState),
    allowLeadOverflow: true,
  }) || normalizeText(canonicalizedState?.canonicalEnglishInput || '') || 'coherent detailed scene';

  const negativePrompt = buildCanonicalEnglishNegativePrompt(mask, canonicalizedState);
  const width = resolveImageOptionNumber(mask?.options?.width, {
    min: 64,
    max: 4096,
    fallback: 768,
    integer: true,
  });
  const height = resolveImageOptionNumber(mask?.options?.height, {
    min: 64,
    max: 4096,
    fallback: 768,
    integer: true,
  });
  const numInferenceSteps = resolveImageOptionNumber(mask?.options?.steps, {
    min: 1,
    max: 150,
    fallback: 40,
    integer: true,
  });
  const guidanceScale = resolveImageOptionNumber(mask?.options?.guidance_scale, {
    min: 0,
    max: 30,
    fallback: 8,
  });
  const seed = resolveOptionalSeed(mask?.options?.seed);

  return {
    prompt,
    prompt_language: 'en',
    prompt_prebuilt: true,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    width,
    height,
    num_inference_steps: numInferenceSteps,
    guidance_scale: guidanceScale,
    ...(seed !== undefined ? { seed } : {}),
  };
}

function compileMaskToImagePrompt(mask = {}) {
  const canonicalizedState = resolveCanonicalizedPromptState(mask);
  if (canonicalizedState) {
    return compileCanonicalizedMaskToImagePrompt(mask, canonicalizedState);
  }

  const promptLanguage = resolvePromptLanguage(mask);
  const rawPrompt = normalizeText(mask?.raw || '');
  const richPromptAssembly = isRichPromptAssemblyMode(mask, rawPrompt);
  const subject = localizeList(mask?.inputs?.subject || []);
  const environment = localizeList(mask?.inputs?.environment || []);
  const style = localizeList(mask?.inputs?.style || []);
  const composition = localizeList(mask?.inputs?.composition || []);
  const lighting = localizeList(mask?.inputs?.lighting || []);
  const palette = localizeList(mask?.inputs?.palette || []);
  const pair = rawPrompt ? compileCharacterCountConstraints(rawPrompt) : null;
  const single = pair ? null : (rawPrompt ? compileSingleSubjectConstraints(rawPrompt) : null);
  const subjectProfileType = normalizeText(mask?.meta?.subjectProfile?.type || '');
  const multiSubjectScene = Boolean(pair?.count >= 2) || isMultiSubjectSceneRequest(rawPrompt);

  const promptLead = buildPromptLead(rawPrompt, subject, mask);
  const styleHints = takeCompactHints(style, {
    maxItems: richPromptAssembly ? 3 : 2,
    maxWords: richPromptAssembly ? 10 : 6,
  });
  const environmentHints = takeCompactHints(environment, {
    maxItems: richPromptAssembly ? 2 : 1,
    maxWords: richPromptAssembly ? 12 : 8,
  });
  const compositionHints = takeCompactHints(filterSceneCompositionHints(composition, { pair, multiSubjectScene }), {
    maxItems: richPromptAssembly ? 5 : 3,
    maxWords: richPromptAssembly ? 10 : 6,
  });
  const lightingHints = takeCompactHints(lighting, {
    maxItems: richPromptAssembly ? 2 : 1,
    maxWords: richPromptAssembly ? 8 : 5,
  });
  const paletteHints = palette.length ? [`couleurs ${palette.slice(0, 3).join(', ')}`] : [];
  const directives = buildCompactDirectives(mask, {
    pair,
    single,
    subjectProfileType,
    multiSubjectScene,
  });
  const instructionHints = buildPositiveInstructionHints(mask, {
    maxItems: richPromptAssembly
      ? (isReferenceHumanFigure(mask) ? 6 : 4)
      : 2,
    maxWords: richPromptAssembly ? 18 : 14,
    exclude: [
      promptLead,
      ...styleHints,
      ...environmentHints,
      ...compositionHints,
      ...lightingHints,
      ...paletteHints,
      ...directives,
    ],
  });

  const prompt = joinPromptFragments(localizePromptList([
    promptLead,
    ...instructionHints,
    ...directives,
    ...compositionHints,
    ...environmentHints,
    ...styleHints,
    ...lightingHints,
    ...paletteHints,
  ], promptLanguage), {
    maxChars: resolvePromptJoinBudget(mask, rawPrompt),
    allowLeadOverflow: richPromptAssembly,
  }) || buildFallbackImagePrompt(mask, promptLanguage);
  const negativePrompt = localizePromptList(
    splitPromptFragments(buildNegativePrompt(mask)),
    promptLanguage
  ).join(', ');
  const width = resolveImageOptionNumber(mask?.options?.width, {
    min: 64,
    max: 4096,
    fallback: 768,
    integer: true,
  });
  const height = resolveImageOptionNumber(mask?.options?.height, {
    min: 64,
    max: 4096,
    fallback: 768,
    integer: true,
  });
  const numInferenceSteps = resolveImageOptionNumber(mask?.options?.steps, {
    min: 1,
    max: 150,
    fallback: 40,
    integer: true,
  });
  const guidanceScale = resolveImageOptionNumber(mask?.options?.guidance_scale, {
    min: 0,
    max: 30,
    fallback: 8,
  });
  const seed = resolveOptionalSeed(mask?.options?.seed);

  return {
    prompt,
    prompt_language: promptLanguage,
    prompt_prebuilt: true,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    width,
    height,
    num_inference_steps: numInferenceSteps,
    guidance_scale: guidanceScale,
    ...(seed !== undefined ? { seed } : {}),
  };
}

module.exports = compileMaskToImagePrompt;

const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');
const validateMaskImageGenerate = require('./validate-mask-image-generate.cjs');
const compileMaskToSD = require('./compile-mask-to-sd.cjs');
const compileMaskToImagePrompt = require('./compile-mask-to-image-prompt.cjs');
const {
  enrichMaskForSpecialImageCompiler,
  resolveImageCompilerCompartment,
  isImageOrchestratorEnabled,
} = require('./compile-mask-to-image-prompt-special.cjs');
const adaptMaskToFreelandValue = require('./adapt-mask-to-freeland-value.cjs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  inferExpectedImageContract,
  verifyGeneratedImageCardinality,
  buildRetrySdBody,
} = require('../image/verify-generated-image-cardinality.cjs');
const {
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
} = require('../image/image-hint-memory.cjs');
const {
  verifyGeneratedImageWithLlmJudge,
} = require('../image/verify-generated-image-with-llm.cjs');
const {
  enrichImg2ImgDraft,
} = require('../image/img2img-source-guard.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('./resolve-image-mask-from-text.cjs');
const {
  applyCanonicalizedImageGenerateRequestToMask,
  normalizeCanonicalizedImageGenerateRequest: normalizeCanonicalizedImageGenerateRequestPayload,
} = require('./canonicalize-image-generate-request.cjs');
const {
  lookupImageHintWebContext: defaultLookupImageHintWebContext,
  resolveImageWebDraft: defaultResolveImageWebDraft,
} = require('../knowledge/image-hint-web-context.cjs');
const {
  resolveImageReferencePack: defaultResolveImageReferencePack,
} = require('../knowledge/image-reference-pack.cjs');
const {
  buildImageReferenceComposite: defaultBuildImageReferenceComposite,
} = require('../knowledge/image-reference-composite.cjs');
const {
  resolveImageEntityContext: defaultResolveImageEntityContext,
} = require('../knowledge/image-entity-resolver.cjs');
const {
  directImageRequest: defaultDirectImageRequest,
} = require('../knowledge/image-request-director.cjs');
const {
  lookupDefinitionContext: defaultLookupDefinitionContext,
} = require('../knowledge/definition-context.cjs');
const {
  duckduckgoImageSearch: defaultDuckduckgoImageSearch,
} = require('../../lib/image-search.cjs');
const {
  enrichImageMaskWithScratchpad,
} = require('./image-scratchpad.cjs');
const {
  compileCharacterCountConstraints,
  detectPromptLanguageProfile,
  translateImagePromptToEnglish,
} = require('./build-sd-prompt-bundle.cjs');
const resolveImageDimensionConfig = normalizeMaskImageGenerate.resolveImageDimensionConfig;
const resolveSdLocalRenderLimits = normalizeMaskImageGenerate.resolveSdLocalRenderLimits;

let sharpLib;

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

function toUniqueNormalizedStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function splitPromptFragments(value = '') {
  return String(value || '')
    .split(/[,.]/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function mergePromptHints(base = '', hints = [], {
  maxHints = 4,
  insertAfterLead = false,
} = {}) {
  const normalizedBase = normalizeLookup(base);
  const selected = [];

  for (const hint of toUniqueNormalizedStrings(hints)) {
    const normalizedHint = normalizeLookup(hint);
    if (!normalizedHint) continue;
    if (normalizedBase.includes(normalizedHint)) continue;
    if (selected.some((entry) => normalizeLookup(entry) === normalizedHint)) continue;
    selected.push(hint);
    if (selected.length >= maxHints) break;
  }

  const normalizedBaseText = normalizeText(base);
  if (!selected.length) return normalizedBaseText;
  if (insertAfterLead) {
    const fragments = String(normalizedBaseText || '')
      .split(',')
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    if (fragments.length) {
      return [fragments[0], ...selected, ...fragments.slice(1)].filter(Boolean).join(', ').trim();
    }
  }
  return [normalizedBaseText, ...selected].filter(Boolean).join('. ').trim();
}

function mergeNegativePromptHints(base = '', hints = [], {
  maxHints = 6,
} = {}) {
  const existing = splitPromptFragments(base);
  const selected = [...existing];
  const seen = new Set(existing.map((entry) => normalizeLookup(entry)).filter(Boolean));

  for (const hint of toUniqueNormalizedStrings(hints)) {
    const normalizedHint = normalizeLookup(hint);
    if (!normalizedHint || seen.has(normalizedHint)) continue;
    selected.push(hint);
    seen.add(normalizedHint);
    if ((selected.length - existing.length) >= maxHints) break;
  }

  return selected.join(', ').trim();
}

function countPromptClauses(value = '') {
  return String(value || '')
    .split(/[.!?;:\n]+/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .length;
}

function analyzePromptDensity(prompt = '', negativePrompt = '') {
  const safePrompt = normalizeText(prompt);
  const safeNegativePrompt = normalizeText(negativePrompt);
  const promptWords = safePrompt ? safePrompt.split(/\s+/).filter(Boolean).length : 0;
  const negativeWords = safeNegativePrompt ? safeNegativePrompt.split(/\s+/).filter(Boolean).length : 0;
  const promptClauses = countPromptClauses(safePrompt);
  const negativeClauses = countPromptClauses(safeNegativePrompt);
  const commaClauses = (safePrompt.match(/,/g) || []).length;

  return {
    promptLength: safePrompt.length,
    negativePromptLength: safeNegativePrompt.length,
    promptWords,
    negativeWords,
    promptClauses,
    negativeClauses,
    commaClauses,
  };
}

function isRichFinalImagePrompt(prompt = '', negativePrompt = '') {
  const density = analyzePromptDensity(prompt, negativePrompt);
  return (
    density.promptLength >= 520
    || density.promptWords >= 80
    || density.promptClauses >= 9
    || density.negativePromptLength >= 180
    || (density.promptLength >= 380 && density.promptClauses >= 6)
    || (density.promptLength >= 340 && density.commaClauses >= 7)
    || (density.promptLength >= 300 && density.negativePromptLength >= 100)
  );
}

function isOvercompressedPromptRewrite({
  currentPrompt = '',
  currentNegativePrompt = '',
  nextPrompt = '',
  nextNegativePrompt = '',
} = {}) {
  const safeCurrentPrompt = normalizeText(currentPrompt);
  const safeNextPrompt = normalizeText(nextPrompt);
  if (!safeCurrentPrompt || !safeNextPrompt) return false;
  if (!isRichFinalImagePrompt(safeCurrentPrompt, currentNegativePrompt)) return false;

  const currentDensity = analyzePromptDensity(safeCurrentPrompt, currentNegativePrompt);
  const nextDensity = analyzePromptDensity(safeNextPrompt, nextNegativePrompt);

  if (nextDensity.promptLength < Math.max(220, Math.round(currentDensity.promptLength * 0.62))) {
    return true;
  }
  if (nextDensity.promptWords < Math.max(34, Math.round(currentDensity.promptWords * 0.6))) {
    return true;
  }
  if (nextDensity.promptClauses < Math.max(4, Math.round(currentDensity.promptClauses * 0.6))) {
    return true;
  }

  return (
    currentDensity.negativePromptLength >= 80
    && nextDensity.negativePromptLength > 0
    && nextDensity.negativePromptLength < Math.max(40, Math.round(currentDensity.negativePromptLength * 0.45))
  );
}

function resolveStrengthPromptGuidanceLanguage({
  prompt = '',
  promptLanguage = '',
} = {}) {
  const explicit = String(promptLanguage || '').trim().toLowerCase();
  if (explicit === 'fr') return 'fr';
  if (explicit === 'en') return 'en';
  const profile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(prompt)
    : { dominant: 'unknown' };
  if (profile?.dominant === 'fr') return 'fr';
  if (profile?.dominant === 'en') return 'en';
  return 'en';
}

function hasReferenceHumanFigure(mask = {}) {
  return (
    Boolean(String(
      mask?.meta?.webImageDraft?.initImageUrl
      || mask?.meta?.webImageDraft?.initImagePath
      || mask?.meta?.reference_image_url
      || mask?.meta?.init_image_url
      || ''
    ).trim())
    && normalizeLookup(mask?.meta?.subjectProfile?.type || '') === 'single_human_figure'
  );
}

function hasJokerStyleTransformationSignal(value = '') {
  return /\b(joker(?:[ -]?style|[ -]?themed)?|joker-inspired|joker inspired|character inspired by the joker|personnage inspire du joker|joker portrait|joker-style transformation|joker style transformation)\b/i.test(String(value || ''));
}

function isReferenceHumanJokerTransformation(mask = {}, prompt = '') {
  if (!hasReferenceHumanFigure(mask)) return false;
  return hasJokerStyleTransformationSignal([
    prompt,
    mask?.raw,
    mask?.meta?.initialRawUserInput,
    mask?.meta?.userSourceText,
    mask?.meta?.originalSourceText,
    mask?.meta?.canonicalizedRequest?.canonicalEnglishInput,
    mask?.meta?.promptCanonicalization?.canonicalEnglishInput,
  ].filter(Boolean).join(' '));
}

function normalizeReferenceHumanTransformationPrompt(prompt = '', mask = {}) {
  const safePrompt = normalizeText(prompt);
  if (!safePrompt || !isReferenceHumanJokerTransformation(mask, safePrompt)) return safePrompt;

  const fragments = safePrompt
    .split(',')
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .filter((entry) => !(
      /\bthe (?:exact )?same person (?:as in|from) the reference image\b/i.test(entry)
      || /\b(?:joker-inspired|joker inspired|joker portrait|joker-style version|joker style version|joker-style transformation|joker style transformation|character inspired by the joker)\b/i.test(entry)
    ));

  return [
    'the exact same person from the reference image in a Joker-style transformation',
    ...fragments,
  ].filter(Boolean).join(', ');
}

const SD_PROMPT_OUTPUT_LANGUAGE = 'en';
const SD_PROMPT_OUTPUT_LABEL = 'english';
const ENGLISH_MIXED_LANGUAGE_PATTERNS = [
  /\b(?:transforme|ajoute|remplace|garde|garder|preserver|préserver|rendre|montre|montrer|utilise|utiliser|avec|dans|sur|pour)\s+(?:the|a|an|with|and|or|of|to|for|from)\b/i,
  /\b(?:the|a|an|with|and|or|of|to|for|from)\s+(?:meme|visage|identite|corpulence|posture|cadrage|tenue|maquillage|decor|ambiance|rue|sol|graffitis|lumiere|reflets|personnage|sujet|batte)\b/i,
  /\b(?:keep|preserve|replace|transform|add|show|use|make)\s+(?:le|la|les|un|une|des|du|de|meme|visage|identite|corpulence|posture|cadrage|tenue|maquillage|decor|ambiance|rue|sol|graffitis|lumiere|reflets|personnage|sujet|batte)\b/i,
  /\b(?:portrait|live action|high quality|dramatic|cinematic|realistic|noir|comic-book)\s+(?:sombre|sale|usee|usée|brute|theatrale|théâtrale|menaçante|menacante|inquietant|inquietante|fidele|lisible)\b/i,
];
const ENGLISH_MIXED_LANGUAGE_LOOKUP_FRAGMENTS = [
  'forest and ville',
  'hyperrealiste and picturale',
  'presence spectrale',
  'couronne portee',
  'couronne porte',
  'inclure clearly',
  'vraie personnalite visuelle',
  'plan moyen',
  'profondeur de champ',
  'silhouette spectrale',
  'forme spectrale',
  'contours bien visibles',
  'de maniere proeminente',
];
const FRENCH_PROMPT_LEAK_PATTERNS = [
  /\b(?:garde|garder|avec|sans|visage|identite|decor|personnage|lumiere|maquillage|batte|immeuble|sujet|tenue|cadrage|corpulence|posture|theatrale|theatrales|usee|usees|sombre|cinematographique|realiste|propre|homme|femme|vert|blanc|rouge|noir)\b/i,
  /\b(?:visage fusionne|visages fusionnes|visage duplique|visages dupliques|yeux deformes|bouche deformee|nez deforme|texte lisible)\b/i,
];
const FRENCH_PROMPT_LEAK_LOOKUP_FRAGMENTS = [
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
  'lisibilite maximale',
  'esthetique',
  'photoréalisme',
  'photorealisme',
  'symboliste',
  'contours bien visibles',
  'de maniere proeminente',
  'portrait homme',
];
const SD_PROMPT_ENGLISH_PHRASE_FIXUPS = [
  [
    /\bgarder (?:(?:la|the) )?meme corpulence et (?:(?:la|the) )?meme posture\b/gi,
    'preserve the same build and posture',
  ],
  [
    /\bbatte custom clairement visible\b/gi,
    'custom bat clearly visible',
  ],
  [
    /\bcomposition propre(?: et puissante)?\b/gi,
    'clean powerful composition',
  ],
  [
    /\bsujet unique personnage entier visible\b/gi,
    'single full character visible',
  ],
  [
    /\billustration science[- ]fiction nette\b/gi,
    'clean science fiction illustration',
  ],
  [
    /\bsimple et lisible\b/gi,
    'simple and readable',
  ],
  [
    /\bcircuit color[eÃ©] coherent avec l univers\b/gi,
    'colorful track consistent with the universe',
  ],
  [
    /\b[eÃ©]nergie arcade nette\b/gi,
    'clean arcade energy',
  ],
  [
    /\bl[eÃ©]g[eÃ¨]re fum[eÃ©]e\b/gi,
    'light smoke',
  ],
  [
    /\bde petites flammes [aÃ ] l [eÃ©]chappement\b/gi,
    'small exhaust flames',
  ],
  [
    /\bgarder strictement (?:(?:le|the) )?meme (?:(?:visage|face)) et (?:(?:la|the) )?meme identite\b/gi,
    'keep exactly the same face and identity',
  ],
  [
    /\bpreserver? (?:(?:la|the) )?silhouette et (?:(?:la|the) )?tenue principale\b/gi,
    'preserve the silhouette and main outfit',
  ],
  [
    /\brendre (?:(?:la|the) )?(?:lumiere|light) et (?:(?:les|the) )?(?:effets|effects) clairement visib(?:le|les|les?)\b/gi,
    'make the lighting and effects clearly visible',
  ],
  [
    /\brendre (?:(?:les|the) )?(?:effets|effects) et (?:(?:la|the) )?(?:lumiere|light) clairement visib(?:le|les|les?)\b/gi,
    'make the lighting and effects clearly visible',
  ],
  [
    /\bpreserver? une anatomie naturelle et des proportions stables\b/gi,
    'preserve natural anatomy and stable proportions',
  ],
  [
    /\baccessoire baton bien visible\b/gi,
    'baton accessory clearly visible',
  ],
  [
    /\baccessoire baton\b/gi,
    'baton accessory',
  ],
  [
    /\baccessoire bien visible\b/gi,
    'accessory clearly visible',
  ],
  [
    /\bshow one full animal and bien readable\b/gi,
    'show one full readable animal',
  ],
  [
    /\bbien readable\b/gi,
    'clearly readable',
  ],
  [
    /\bun seul animal complet\b/gi,
    'one full animal',
  ],
  [
    /\bcorps complet bien visible\b/gi,
    'full body clearly visible',
  ],
  [
    /\bposture claire(?: et lisible)?\b/gi,
    'clear readable pose',
  ],
  [
    /\bsilhouette lisible\b/gi,
    'clear silhouette',
  ],
  [
    /\bforme compl[eÃ©]te visible\b/gi,
    'full shape visible',
  ],
  [
    /\bforme complète visible\b/gi,
    'full shape visible',
  ],
  [
    /\b(?:couleur|couleurs) lisibles? sur le sujet\b/gi,
    'colors readable on the subject',
  ],
  [
    /\bune seule personne compl[eÃ¨]te\b/gi,
    'one full person',
  ],
  [
    /\bune seule personne complète\b/gi,
    'one full person',
  ],
  [
    /\bun seul personnage complet\b/gi,
    'one full character',
  ],
  [
    /\bvisage unique bien lisible\b/gi,
    'single clearly visible face',
  ],
  [
    /\bsilhouette humaine compl[eÃ¨]te\b/gi,
    'full human silhouette',
  ],
  [
    /\bsilhouette humaine complète\b/gi,
    'full human silhouette',
  ],
  [
    /\bmontrer clairement une? figure de ([^,.;]+?) unique (?:et|and) reconnaissable\b/gi,
    'show clearly one unique recognizable $1 figure',
  ],
  [
    /\bshow clearly a figure de ([^,.;]+?) unique (?:et|and) recognizable\b/gi,
    'show clearly one unique recognizable $1 figure',
  ],
  [
    /\bmontrer clairement ([^,.;]+?) port[eÃ©] par (?:le|the) sujet principal\b/gi,
    'show clearly $1 worn by the main subject',
  ],
  [
    /\bmontrer clairement l accessoire ([^,.;]+?) avec (?:le|the) sujet principal\b/gi,
    'show clearly the $1 accessory with the main subject',
  ],
  [
    /\bmontrer clairement (?:le|the)? ?sujet principal en train de fumer avec ([^,.;]+?) visible pr[eÃ¨]s de (?:la|the) bouche\b/gi,
    'show clearly the main subject smoking with $1 clearly visible near the mouth',
  ],
  [
    /\bmontrer clairement (?:le|the)? ?sujet principal en train de fumer avec ([^,.;]+?) visible près de (?:la|the) bouche\b/gi,
    'show clearly the main subject smoking with $1 clearly visible near the mouth',
  ],
  [
    /\bd[eé]cor simple et lisible\b/gi,
    'simple readable setting',
  ],
  [
    /\bd[eé]cor sobre et lisible\b/gi,
    'understated readable setting',
  ],
  [
    /\bsilhouette h[eé]ro[iï]que lisible\b/gi,
    'clear heroic silhouette',
  ],
  [
    /\bmontrer clairement l[’']? epee tenue par le personnage principal\b/gi,
    'show clearly the sword held by the main character',
  ],
  [
    /\bmontrer clairement la carotte attach[eé]e? au sujet principal\b/gi,
    'show clearly the carrot attached to the main subject',
  ],
  [
    /\brester fid[eè]le au sujet canonique nomm[eé]\b/gi,
    'stay faithful to the canonical subject named',
  ],
  [
    /\brester coherent avec l univers\b/gi,
    'stay consistent with the universe',
  ],
  [
    /\bcigarette visible pres de la bouche\b/gi,
    'cigarette clearly visible near the mouth',
  ],
  [
    /\bgrand sombrero mexicain\b/gi,
    'large Mexican sombrero',
  ],
  [
    /\btexte\b/gi,
    'text',
  ],
  [
    /\bportrait homme\b/gi,
    'male portrait',
  ],
  [
    /\bportrait propre\b/gi,
    'clean portrait',
  ],
  [
    /\bfond simple\b/gi,
    'simple background',
  ],
  [
    /\bdecor sombre\b/gi,
    'dark setting',
  ],
  [
    /\bdecor urbain inspire de Harlem\b/gi,
    'Harlem-inspired urban environment',
  ],
  [
    /\bhaute qualit[^\s,.;:]*/gi,
    'high quality',
  ],
  [
    /\bd[eÃé]cor sombre\b/gi,
    'dark setting',
  ],
  [
    /\bd[eÃé]cor urbain inspire de Harlem\b/gi,
    'Harlem-inspired urban environment',
  ],
  [
    /\bcostume joker elegant mais chaotique\b/gi,
    'elegant but chaotic Joker-themed suit',
  ],
  [
    /\bmaquillage de clown inquietant mais credible\b/gi,
    'unsettling but believable clown makeup',
  ],
  [
    /\bla batte custom doit etre bien visible\b/gi,
    'the custom bat must be clearly visible',
  ],
  [
    /\ble d[eÃƒÃ©]cor doit rester secondaire mais immersif\b/gi,
    'the background stays secondary but immersive',
  ],
  [
    /\brue brute avec graffitis(?: et immeubles uses)?\b/gi,
    'raw street with graffiti and worn buildings',
  ],
  [
    /\bpersonnage entier visible\b/gi,
    'full body visible',
  ],
  [
    /\bbatte custom clairement visible\b/gi,
    'custom bat clearly visible',
  ],
  [
    /\bcomposition propre(?: et puissante)?\b/gi,
    'clean composition',
  ],
  [
    /\blumiere dramatique\b/gi,
    'dramatic lighting',
  ],
  [
    /\breflets de neons violets et verts\b/gi,
    'purple and green neon reflections',
  ],
  [
    /\bcinematographique\b/gi,
    'cinematic',
  ],
  [
    /\billustration nette\b/gi,
    'clear illustration',
  ],
  [
    /\bherisson\b/gi,
    'hedgehog',
  ],
  [
    /\blapin\b/gi,
    'rabbit',
  ],
  [
    /\bvisage fusionne\b/gi,
    'fused face',
  ],
  [
    /\bvisages fusionnes\b/gi,
    'merged faces',
  ],
  [
    /\bvisage duplique\b/gi,
    'duplicated face',
  ],
  [
    /\bvisages dupliques\b/gi,
    'duplicated faces',
  ],
  [
    /\byeux deformes\b/gi,
    'deformed eyes',
  ],
  [
    /\bbouche deformee\b/gi,
    'deformed mouth',
  ],
  [
    /\bnez deforme\b/gi,
    'deformed nose',
  ],
  [
    /\bdouble visage\b/gi,
    'double face',
  ],
  [
    /\bmorphing facial\b/gi,
    'facial morphing',
  ],
  [
    /\bpresence spectrale(?: complete et lisible| full and readable)?\b/gi,
    'full readable spectral presence',
  ],
  [
    /\bforme spectrale(?: clairement lisible| lisible)?\b/gi,
    'readable spectral form',
  ],
  [
    /\bsilhouette spectrale\b/gi,
    'spectral silhouette',
  ],
  [
    /\bcouronne port[ée]e? par (?:(?:le|the) )?sujet principal\b/gi,
    'crown worn by the main subject',
  ],
  [
    /\bshow clearly couronne port[ée]e? par the main subject\b/gi,
    'show clearly the crown worn by the main subject',
  ],
  [
    /\binclure clairement? une vraie personnalit[eé] visuelle\b/gi,
    'clearly include a strong visual identity',
  ],
  [
    /\binclure clearly a vraie personnalit[eé] visuelle\b/gi,
    'clearly include a strong visual identity',
  ],
  [
    /\bvraie personnalit[eé] visuelle\b/gi,
    'strong visual identity',
  ],
  [
    /\bcadre en plan moyen(?: \(medium shot\))?(?: mettant accent (?:(?:sur le personnage principal)|(?:on the character main)))?\b/gi,
    'medium shot focused on the main character',
  ],
  [
    /\bplan moyen\b/gi,
    'medium shot',
  ],
  [
    /\ben valeur (?:(?:the )?)?profondeur de champ\b/gi,
    'highlighted depth of field',
  ],
  [
    /\bprofondeur de champ\b/gi,
    'depth of field',
  ],
  [
    /\bfor[eê]t et ville\b/gi,
    'forest and city',
  ],
  [
    /\bforest and ville\b/gi,
    'forest and city',
  ],
  [
    /\bsc[eè]ne hyperr[eé]aliste(?: et| and) picturale repr[eé]sentant\b/gi,
    'hyperrealistic painterly scene depicting',
  ],
  [
    /\bhyperr[eé]aliste(?: et| and) picturale\b/gi,
    'hyperrealistic and painterly',
  ],
  [
    /\besth[eé]tique de peinture hyperr[eé]aliste\b/gi,
    'hyperrealistic painting aesthetic',
  ],
  [
    /\bpeinture hyperr[eé]aliste\b/gi,
    'hyperrealistic painting',
  ],
  [
    /\bpeinture dark ou symboliste\b/gi,
    'dark or symbolist painting',
  ],
  [
    /\bpeinture\b/gi,
    'painting',
  ],
  [
    /\bcontours bien visibles\b/gi,
    'clearly visible contours',
  ],
  [
    /\bde mani[eè]re pro[eé]minente et visible\b/gi,
    'prominently and visibly',
  ],
];

function applySdEnglishPhraseFixups(value = '') {
  let next = normalizeText(value);
  for (const [pattern, replacement] of SD_PROMPT_ENGLISH_PHRASE_FIXUPS) {
    next = next.replace(pattern, replacement);
  }
  return normalizeText(next);
}

function normalizeSdPromptRewriteText(value = '') {
  return applySdEnglishPhraseFixups(value);
}

function isAcceptableSdRewriteLanguage(value = '', { allowUnknown = false } = {}) {
  const text = normalizeText(value);
  if (!text) return false;
  const profile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(text)
    : { dominant: 'unknown', mixed: false };
  if (
    profile?.dominant === 'en'
    && (
      profile?.mixed !== true
      || Number(profile?.englishScore || 0) >= Number(profile?.frenchScore || 0) + 6
    )
  ) {
    return true;
  }
  return allowUnknown && profile?.dominant === 'unknown' && profile?.mixed !== true;
}

function hasEnglishMixedLanguageArtifacts(value = '') {
  const text = normalizeText(value);
  if (!text) return false;
  const lookup = normalizeLookup(text);
  return (
    ENGLISH_MIXED_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text))
    || ENGLISH_MIXED_LANGUAGE_LOOKUP_FRAGMENTS.some((fragment) => lookup.includes(fragment))
  );
}

function isUsableEnglishPromptText(value = '', { allowUnknown = false } = {}) {
  const text = normalizeSdPromptRewriteText(value);
  return (
    isAcceptableSdRewriteLanguage(text, { allowUnknown })
    && !hasEnglishMixedLanguageArtifacts(text)
  );
}

function hasFrenchPromptLeak(value = '') {
  const text = normalizeText(value);
  if (!text) return false;
  const lookup = normalizeLookup(text);
  return (
    FRENCH_PROMPT_LEAK_PATTERNS.some((pattern) => pattern.test(text))
    || FRENCH_PROMPT_LEAK_LOOKUP_FRAGMENTS.some((fragment) => lookup.includes(fragment))
  );
}

function isCanonicalEnglishSdText(value = '', { allowUnknown = false } = {}) {
  const text = normalizeSdPromptRewriteText(value);
  if (!text) return false;
  if (hasEnglishMixedLanguageArtifacts(text)) return false;
  if (hasFrenchPromptLeak(text)) return false;
  return isAcceptableSdRewriteLanguage(text, { allowUnknown });
}

function tryLocalEnglishPromptNormalization(value = '') {
  return '';
}

function isRichPromptForDetailPreservation(value = '') {
  const density = analyzePromptDensity(value, '');
  return (
    density.promptLength >= 260
    || density.promptWords >= 45
    || density.promptClauses >= 5
    || (density.promptLength >= 220 && density.commaClauses >= 5)
  );
}

function scorePromptDetailDensity(value = '') {
  const density = analyzePromptDensity(value, '');
  return (
    density.promptLength
    + (density.promptWords * 4)
    + (density.promptClauses * 18)
    + (density.commaClauses * 8)
  );
}

function pickMostDetailedPromptText(values = []) {
  const candidates = (Array.isArray(values) ? values : [values])
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  if (!candidates.length) return '';
  return candidates
    .slice()
    .sort((left, right) => scorePromptDetailDensity(right) - scorePromptDetailDensity(left))[0];
}

function resolveAuthoritativeRawRequest(mask = {}) {
  return pickMostDetailedPromptText([
    mask?.meta?.initialRawUserInput,
    mask?.meta?.userSourceText,
    mask?.meta?.originalSourceText,
    mask?.raw,
    mask?.meta?.sourceText,
    mask?.meta?.promptSeedText,
    mask?.meta?.promptText,
  ]);
}

function hasReferenceInitImage(mask = {}) {
  return Boolean(String(
    mask?.meta?.webImageDraft?.initImageUrl
    || mask?.meta?.webImageDraft?.initImagePath
    || mask?.meta?.reference_image_url
    || mask?.meta?.init_image_url
    || mask?.sdBody?.init_image_url
    || ''
  ).trim());
}

function shouldPromoteRawRequestToCurrentPrompt({
  rawRequest = '',
  currentPrompt = '',
} = {}) {
  const safeRawRequest = normalizeText(rawRequest);
  const safeCurrentPrompt = normalizeText(currentPrompt);
  if (!safeRawRequest) return false;
  if (!safeCurrentPrompt) return true;

  const rawDensity = analyzePromptDensity(safeRawRequest, '');
  const currentDensity = analyzePromptDensity(safeCurrentPrompt, '');
  if (isRichPromptForDetailPreservation(safeRawRequest) && !isRichPromptForDetailPreservation(safeCurrentPrompt)) {
    return true;
  }
  return (
    rawDensity.promptLength >= currentDensity.promptLength + 80
    || rawDensity.promptWords >= currentDensity.promptWords + 14
    || rawDensity.promptClauses >= currentDensity.promptClauses + 3
    || rawDensity.commaClauses >= currentDensity.commaClauses + 4
  );
}

function isOvercompressedPromptFieldRewrite(source = '', translated = '') {
  const safeSource = normalizeText(source);
  const safeTranslated = normalizeText(translated);
  if (!safeSource || !safeTranslated) return false;
  if (!isRichPromptForDetailPreservation(safeSource)) return false;

  const sourceDensity = analyzePromptDensity(safeSource, '');
  const translatedDensity = analyzePromptDensity(safeTranslated, '');
  if (translatedDensity.promptLength < Math.max(220, Math.round(sourceDensity.promptLength * 0.72))) {
    return true;
  }
  if (translatedDensity.promptWords < Math.max(38, Math.round(sourceDensity.promptWords * 0.7))) {
    return true;
  }
  if (translatedDensity.promptClauses < Math.max(4, Math.round(sourceDensity.promptClauses * 0.72))) {
    return true;
  }
  return false;
}

function resolvePromptRewriteMaxTokens(values = [], {
  floor = 900,
  ceiling = 1800,
  base = 360,
} = {}) {
  const reference = pickMostDetailedPromptText(values);
  if (!reference) return floor;
  const density = analyzePromptDensity(reference, '');
  return Math.max(
    floor,
    Math.min(
      ceiling,
      base + (density.promptWords * 4) + (density.promptClauses * 60)
    )
  );
}

function applyPromptOverrideCompiledState(compiledState = {}, {
  prompt = '',
  negativePrompt = '',
  promptLanguage = '',
} = {}) {
  const nextPrompt = normalizeSdPromptRewriteText(prompt);
  if (!nextPrompt) return null;
  const nextNegativePrompt = normalizeSdPromptRewriteText(negativePrompt);
  const resolvedPromptLanguage = String(promptLanguage || '').trim();

  return {
    ...compiledState,
    compiledPayload: {
      ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object' ? compiledState.compiledPayload : {}),
      prompt: nextPrompt,
      ...(resolvedPromptLanguage ? { prompt_language: resolvedPromptLanguage } : {}),
      ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
    },
    compiled: (
      compiledState?.compiled && typeof compiledState.compiled === 'object'
        ? {
            ...compiledState.compiled,
            prompt: nextPrompt,
            ...(resolvedPromptLanguage ? { prompt_language: resolvedPromptLanguage } : {}),
            ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
          }
        : compiledState.compiled
    ),
    sdBody: {
      ...(compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {}),
      prompt: nextPrompt,
      ...(resolvedPromptLanguage ? { prompt_language: resolvedPromptLanguage } : {}),
      ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
    },
  };
}

function buildEnglishPromptOverrideCompiledState(compiledState = {}, {
  prompt = '',
  negativePrompt = '',
} = {}) {
  const nextPrompt = normalizeReferenceHumanEnglishPromptContract(
    normalizeSdPromptRewriteText(prompt),
    compiledState?.mask || {}
  );
  if (!nextPrompt || !isUsableEnglishPromptText(nextPrompt, { allowUnknown: true })) return null;
  if (!shouldPromoteRawRequestToCurrentPrompt({
    rawRequest: nextPrompt,
    currentPrompt: compiledState?.sdBody?.prompt || '',
  })) {
    return null;
  }

  const nextNegativePrompt = normalizeSdPromptRewriteText(
    negativePrompt || compiledState?.sdBody?.negative_prompt || ''
  );

  return applyPromptOverrideCompiledState(compiledState, {
    prompt: nextPrompt,
    negativePrompt: nextNegativePrompt,
    promptLanguage: SD_PROMPT_OUTPUT_LANGUAGE,
  });
}

function shouldPromoteLocalEnglishPromptFallback(compiledState = {}) {
  const compilerTarget = String(compiledState?.mask?.compiler?.target || '').trim().toLowerCase();
  if (compilerTarget !== 'image-prompt-en' && compilerTarget !== 'sd-payload') return false;
  if (!hasReferenceInitImage(compiledState?.mask || {})) return false;
  const prompt = normalizeText(compiledState?.sdBody?.prompt || '');
  if (!prompt) return false;
  return !isUsableEnglishPromptText(prompt, { allowUnknown: true });
}

function buildLocalEnglishPromptFallbackCompiledState(compiledState = {}) {
  return null;
}

function normalizeReferenceHumanEnglishPromptContract(prompt = '', mask = {}) {
  let text = normalizeSdPromptRewriteText(prompt);
  if (!text) return '';
  if (!hasReferenceInitImage(mask)) return text;
  if (normalizeLookup(mask?.meta?.subjectProfile?.type || '') !== 'single_human_figure') return text;
  if (!/\bjoker(?:[ -]?style|[ -]?themed| inspired| portrait)\b/i.test(text)) return text;

  text = text
    .replace(/\bJoker-inspired\b/gi, 'Joker-style')
    .replace(/\bcharacter inspired by the Joker\b/gi, 'Joker-style character');

  if (!/\bthe exact same person from the reference image in a Joker-style transformation\b/i.test(text)) {
    const remainder = normalizeText(
      text
        .replace(/^use the input image as an identity, pose(?:, and framing)? reference\.?\s*/i, '')
        .replace(/^the same person from the reference image,?\s*/i, '')
    );
    text = normalizeText([
      'the exact same person from the reference image in a Joker-style transformation',
      remainder,
    ].filter(Boolean).join(', '));
  }

  return text;
}

function extractPromptFieldFragments(value = '') {
  return toUniqueNormalizedStrings(
    String(value || '')
      .replace(/[.。]+\s*/g, ', ')
      .split(/[,\n]+/)
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  );
}

function applyPromptOverrideCompiledStateStrict(compiledState = {}, {
  prompt = '',
  negativePrompt = '',
  promptLanguage = '',
} = {}) {
  const nextPrompt = normalizeSdPromptRewriteText(prompt);
  if (!nextPrompt) return null;
  const nextNegativePrompt = normalizeSdPromptRewriteText(negativePrompt);
  const resolvedPromptLanguage = String(promptLanguage || '').trim();

  return {
    ...compiledState,
    compiledPayload: {
      ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object' ? compiledState.compiledPayload : {}),
      prompt: nextPrompt,
      ...(resolvedPromptLanguage ? { prompt_language: resolvedPromptLanguage } : {}),
      negative_prompt: nextNegativePrompt,
    },
    compiled: (
      compiledState?.compiled && typeof compiledState.compiled === 'object'
        ? {
            ...compiledState.compiled,
            prompt: nextPrompt,
            ...(resolvedPromptLanguage ? { prompt_language: resolvedPromptLanguage } : {}),
            negative_prompt: nextNegativePrompt,
          }
        : compiledState.compiled
    ),
    sdBody: {
      ...(compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {}),
      prompt: nextPrompt,
      ...(resolvedPromptLanguage ? { prompt_language: resolvedPromptLanguage } : {}),
      negative_prompt: nextNegativePrompt,
    },
  };
}

function buildConservativeCanonicalEnglishPromptField(value = '', {
  allowUnknown = true,
} = {}) {
  const canonicalFragments = [];
  for (const fragment of extractPromptFieldFragments(value)) {
    const normalizedFragment = normalizeSdPromptRewriteText(fragment);
    if (normalizedFragment && isCanonicalEnglishSdText(normalizedFragment, { allowUnknown })) {
      canonicalFragments.push(normalizedFragment);
    }
  }
  return toUniqueNormalizedStrings(canonicalFragments).join(', ');
}

async function repairPromptFieldToCanonicalEnglish(value = '', options = {}) {
  const text = normalizeSdPromptRewriteText(value);
  if (!text) return '';
  if (isCanonicalEnglishSdText(text, { allowUnknown: true })) return text;

  const translatedPrompt = normalizeSdPromptRewriteText(
    await translateDetailedPromptFieldToEnglish(text, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      previousRejected: text,
    })
  );
  if (translatedPrompt && isCanonicalEnglishSdText(translatedPrompt, { allowUnknown: true })) {
    return translatedPrompt;
  }

  return buildConservativeCanonicalEnglishPromptField(text, { allowUnknown: true });
}

async function repairCompiledStateToCanonicalEnglish(compiledState = {}, options = {}) {
  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
    : {};
  const currentPrompt = normalizeSdPromptRewriteText(sdBody?.prompt || '');
  const currentNegativePrompt = normalizeSdPromptRewriteText(sdBody?.negative_prompt || '');
  if (
    currentPrompt
    && isCanonicalEnglishSdText(currentPrompt, { allowUnknown: true })
    && (!currentNegativePrompt || isCanonicalEnglishSdText(currentNegativePrompt, { allowUnknown: true }))
  ) {
    return {
      compiledState,
      repaired: false,
      reason: 'already_canonical',
    };
  }

  const repairedPrompt = normalizeReferenceHumanEnglishPromptContract(
    await repairPromptFieldToCanonicalEnglish(currentPrompt, options),
    compiledState?.mask || {}
  );
  if (!repairedPrompt || !isCanonicalEnglishSdText(repairedPrompt, { allowUnknown: true })) {
    return {
      compiledState,
      repaired: false,
      reason: 'prompt_repair_unavailable',
    };
  }

  let repairedNegativePrompt = currentNegativePrompt;
  if (currentNegativePrompt && !isCanonicalEnglishSdText(currentNegativePrompt, { allowUnknown: true })) {
    repairedNegativePrompt = await repairPromptFieldToCanonicalEnglish(currentNegativePrompt, options);
  }
  if (repairedNegativePrompt && !isCanonicalEnglishSdText(repairedNegativePrompt, { allowUnknown: true })) {
    repairedNegativePrompt = buildConservativeCanonicalEnglishPromptField(repairedNegativePrompt, {
      allowUnknown: true,
    });
  }
  if (repairedNegativePrompt && !isCanonicalEnglishSdText(repairedNegativePrompt, { allowUnknown: true })) {
    repairedNegativePrompt = '';
  }

  const localizedState = applyPromptOverrideCompiledStateStrict(compiledState, {
    prompt: repairedPrompt,
    negativePrompt: repairedNegativePrompt,
    promptLanguage: SD_PROMPT_OUTPUT_LANGUAGE,
  });
  return {
    compiledState: localizedState || compiledState,
    repaired: Boolean(localizedState),
    reason: localizedState ? 'translated_current_prompt_to_canonical_english' : 'repair_override_unavailable',
  };
}

function inferSpecificPropPromptHint(mask = {}, prompt = '') {
  const candidates = toUniqueNormalizedStrings([
    ...(Array.isArray(mask?.inputs?.composition) ? mask.inputs.composition : []),
    ...(Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions : []),
    prompt,
  ]);

  for (const candidate of candidates) {
    const translatedCandidate = normalizeSdPromptRewriteText(candidate);
    if (!translatedCandidate) continue;

    const accessoryMatch = translatedCandidate.match(/\b([a-z][a-z -]{1,40}) accessory clearly visible\b/i)
      || translatedCandidate.match(/\b([a-z][a-z -]{1,40}) accessory\b/i);
    if (accessoryMatch && normalizeText(accessoryMatch[1])) {
      return `make the ${normalizeText(accessoryMatch[1])} accessory clearly visible`;
    }
    if (/\bcrown worn by the main subject\b/i.test(translatedCandidate)) {
      return 'show clearly the crown worn by the main subject';
    }
    if (/\bsword held by the main character\b/i.test(translatedCandidate)) {
      return 'show clearly the sword held by the main character';
    }
    if (/\bcarrot attached to the main subject\b/i.test(translatedCandidate)) {
      return 'show clearly the carrot attached to the main subject';
    }
  }

  return '';
}

function shouldCanonicalizePromptGuidanceToEnglish(compiledState = {}, mask = {}) {
  const explicitPromptLanguage = String(
    compiledState?.sdBody?.prompt_language
    || compiledState?.compiledPayload?.prompt_language
    || ''
  ).trim().toLowerCase();
  if (explicitPromptLanguage === SD_PROMPT_OUTPUT_LANGUAGE) return true;

  const compilerTarget = String(
    compiledState?.mask?.compiler?.target
    || mask?.compiler?.target
    || ''
  ).trim().toLowerCase();

  return compilerTarget === 'image-prompt-en' || compilerTarget === 'sd-payload';
}

function canonicalizePromptGuidanceBaseState(compiledState = {}, mask = {}) {
  if (!shouldCanonicalizePromptGuidanceToEnglish(compiledState, mask)) {
    return {
      compiledState,
      applied: false,
      canonical: false,
      reason: 'non_english_target',
    };
  }

  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
    : {};
  const currentPrompt = normalizeSdPromptRewriteText(sdBody?.prompt || '');
  const currentNegativePrompt = normalizeSdPromptRewriteText(sdBody?.negative_prompt || '');
  let nextPrompt = currentPrompt;
  let nextNegativePrompt = currentNegativePrompt;
  const promptCanonical = nextPrompt && isCanonicalEnglishSdText(nextPrompt, { allowUnknown: true });
  const negativeCanonical = !nextNegativePrompt || isCanonicalEnglishSdText(nextNegativePrompt, { allowUnknown: true });

  if (!promptCanonical || !negativeCanonical) {
    return {
      compiledState,
      applied: false,
      canonical: false,
      reason: 'base_prompt_not_canonical_english',
    };
  }

  const localizedState = applyPromptOverrideCompiledState(compiledState, {
    prompt: nextPrompt,
    negativePrompt: nextNegativePrompt,
    promptLanguage: SD_PROMPT_OUTPUT_LANGUAGE,
  });

  return {
    compiledState: localizedState || compiledState,
    applied: Boolean(localizedState),
    canonical: true,
    reason: localizedState ? 'normalized_existing_canonical_prompt' : 'already_canonical',
  };
}

function normalizePromptContextShape(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePromptContextShape(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizePromptContextShape(entry)])
    );
  }
  if (typeof value === 'string') return normalizeSdPromptRewriteText(value);
  return value;
}

function detectPromptContextLanguage(value) {
  const sample = normalizeText(JSON.stringify(value));
  if (!sample) return { dominant: 'unknown', mixed: false };
  return typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(sample)
    : { dominant: 'unknown', mixed: false };
}

function isCompatiblePromptContextTranslation(source = {}, translated = {}) {
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) return false;
  const requiredKeys = Object.keys(source || {});
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(translated, key));
}

async function translateDetailedPromptFieldToEnglish(value = '', options = {}) {
  const sourceText = normalizeText(value);
  if (!sourceText || typeof options.callStructuredLlmJson !== 'function') return '';
  const sourceProfile = typeof detectPromptLanguageProfile === 'function'
    ? detectPromptLanguageProfile(sourceText)
    : { dominant: 'unknown', mixed: false };
  if (sourceProfile?.dominant === 'en' && sourceProfile?.mixed !== true) {
    return sourceText;
  }
  const normalizedSourceText = normalizeSdPromptRewriteText(sourceText);
  if (isUsableEnglishPromptText(normalizedSourceText, { allowUnknown: true })) {
    return normalizedSourceText;
  }
  const localTranslation = normalizeSdPromptRewriteText(
    typeof translateImagePromptToEnglish === 'function'
      ? translateImagePromptToEnglish(sourceText)
      : ''
  );
  if (
    localTranslation
    && sourceText.length <= 220
    && isUsableEnglishPromptText(localTranslation, { allowUnknown: true })
    && !isOvercompressedPromptFieldRewrite(sourceText, localTranslation)
  ) {
    return localTranslation;
  }

  const translateOnce = async (previousRejected = '') => {
    try {
      const response = await options.callStructuredLlmJson({
        text: JSON.stringify({
          source_text: sourceText,
          ...(previousRejected
            ? { rejected_translation: normalizeText(previousRejected) }
            : {}),
        }, null, 2),
        systemPrompt: `You translate a single image-generation prompt field into detailed natural English for A11.
Strict rules:
- preserve every concrete visual detail and every useful constraint
- never summarize, condense, shorten, simplify, or omit details
- keep identity locks, face, body, pose, framing, outfit, props, environment, lighting, palette, mood, style, and all negative constraints
- if the source is rich and long, the translation must stay rich and long
- output only strict JSON
{
  "translated_text": "detailed english translation"
}`,
        temperature: 0.1,
        maxTokens: resolvePromptRewriteMaxTokens([sourceText], {
          floor: 700,
          ceiling: 2200,
          base: 320,
        }),
        timeoutMs: Number(process.env.A11_IMAGE_PROMPT_TRANSLATOR_TIMEOUT_MS || 10000),
      });
      const translated = normalizeSdPromptRewriteText(
        response?.translated_text || response?.translatedText || ''
      );
      if (!translated) return '';
      if (!isUsableEnglishPromptText(translated, { allowUnknown: true })) return '';
      if (isOvercompressedPromptFieldRewrite(sourceText, translated)) return '';
      return translated;
    } catch {
      return '';
    }
  };

  const firstAttempt = await translateOnce('');
  if (firstAttempt) return firstAttempt;
  const retried = await translateOnce(options.previousRejected || '');
  if (retried) return retried;
  if (
    localTranslation
    && isUsableEnglishPromptText(localTranslation, { allowUnknown: true })
    && !isOvercompressedPromptFieldRewrite(sourceText, localTranslation)
  ) {
    return localTranslation;
  }
  return '';
}

const NEGATIVE_PROMPT_HINT_LITERAL_RULES = [
  { pattern: /\b(?:flou|blur(?:ry)?|out of focus|soft focus)\b/i, literal: 'blurry' },
  { pattern: /\b(?:basse qualite|basse qualité|low quality|poor quality)\b/i, literal: 'low quality' },
  { pattern: /\b(?:visage deforme|visage déformé|deformed face)\b/i, literal: 'deformed face' },
  { pattern: /\b(?:mains ratees|mains ratées|bad hands)\b/i, literal: 'bad hands' },
  { pattern: /\b(?:doigts? en trop|extra fingers?|polydactyl(?:y|e))\b/i, literal: 'extra fingers' },
  { pattern: /\b(?:anatomie incorrecte|incorrect anatomy|bad anatomy)\b/i, literal: 'incorrect anatomy' },
  { pattern: /\b(?:plusieurs personnages|multiple characters|multiple subjects)\b/i, literal: 'multiple characters' },
  { pattern: /\b(?:batte dupliquee|batte dupliquée|duplicated bat)\b/i, literal: 'duplicated bat' },
  { pattern: /\b(?:tete coupee|tête coupée|cut head|head crop)\b/i, literal: 'cut head' },
  { pattern: /\b(?:pieds coupes|pieds coupés|cut feet|feet crop)\b/i, literal: 'cut feet' },
  { pattern: /\b(?:decor vide|décor vide|empty background)\b/i, literal: 'empty background' },
  { pattern: /\b(?:lumiere plate|lumière plate|flat lighting)\b/i, literal: 'flat lighting' },
  { pattern: /\b(?:maquillage faible|weak makeup)\b/i, literal: 'weak makeup' },
  { pattern: /\b(?:costume peu visible|tenue peu visible|unclear costume)\b/i, literal: 'unclear costume' },
  { pattern: /\b(?:fond mal genere|fond mal généré|poorly generated background)\b/i, literal: 'poorly generated background' },
  { pattern: /\b(?:texte lisible|texte|text)\b/i, literal: 'text' },
  { pattern: /\b(?:watermark|filigrane)\b/i, literal: 'watermark' },
  { pattern: /\b(?:logo)\b/i, literal: 'logo' },
  { pattern: /\b(?:signature)\b/i, literal: 'signature' },
];

function resolveLiteralNegativePromptHint(value = '') {
  const text = normalizeText(value);
  if (!text) return '';
  for (const rule of NEGATIVE_PROMPT_HINT_LITERAL_RULES) {
    if (rule.pattern.test(text)) {
      return rule.literal;
    }
  }
  return '';
}

function sanitizeNegativePromptHintLiteral(value = '') {
  const text = normalizeText(value)
    .replace(/[.]+$/g, '')
    .replace(/^negative prompt\s*:\s*/i, '')
    .trim();
  if (!text) return '';

  const literalOverride = resolveLiteralNegativePromptHint(text);
  if (literalOverride) return literalOverride;

  if (!isUsableEnglishPromptText(text, { allowUnknown: true })) return '';
  if (/[.!?]/.test(text)) return '';

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 0 || words.length > 8) return '';
  if (/\b(?:must|should|depict|depicted|rendered|presented|featuring|incorporated|integrated|contains?|showing|showcasing)\b/i.test(text)) {
    return '';
  }
  if (/^(?:a|an|the)\b/i.test(text) && words.length > 4) {
    return '';
  }
  if (/[,;:]/.test(text) && words.length > 5) {
    return '';
  }

  return text;
}

async function translateNegativePromptHintToEnglish(value = '', options = {}) {
  const sourceText = normalizeText(value);
  if (!sourceText) return '';

  const sourceLiteral = sanitizeNegativePromptHintLiteral(sourceText);
  if (sourceLiteral) return sourceLiteral;
  if (typeof options.callStructuredLlmJson !== 'function') {
    return resolveLiteralNegativePromptHint(sourceText) || sourceText;
  }

  const translateOnce = async (previousRejected = '') => {
    try {
      const response = await options.callStructuredLlmJson({
        text: JSON.stringify({
          source_text: sourceText,
          ...(previousRejected
            ? { rejected_translation: normalizeText(previousRejected) }
            : {}),
        }, null, 2),
        systemPrompt: `You translate a single negative prompt hint for A11 into short literal English suitable for a Stable Diffusion negative prompt.
Strict rules:
- translate into short literal English only
- keep it concise: a short fragment, not a sentence
- never expand into a scene description
- never rewrite as a positive instruction
- never add visual details that were not present
- avoid punctuation except parentheses when essential
- output only strict JSON
{
  "translated_text": "short english negative hint"
}`,
        temperature: 0,
        maxTokens: 120,
        timeoutMs: Number(process.env.A11_IMAGE_PROMPT_TRANSLATOR_TIMEOUT_MS || 10000),
      });
      const translated = normalizeSdPromptRewriteText(
        response?.translated_text || response?.translatedText || ''
      );
      return sanitizeNegativePromptHintLiteral(translated);
    } catch {
      return '';
    }
  };

  const firstAttempt = await translateOnce('');
  if (firstAttempt) return firstAttempt;
  const retried = await translateOnce(options.previousRejected || '');
  if (retried) return retried;

  return resolveLiteralNegativePromptHint(sourceText) || sourceText;
}

async function translateNegativePromptHintListToEnglish(values = [], options = {}) {
  const translated = [];
  for (const entry of Array.isArray(values) ? values : [values]) {
    const nextEntry = await translateNegativePromptHintToEnglish(entry, options);
    if (nextEntry) translated.push(nextEntry);
  }
  return toUniqueNormalizedStrings(translated);
}

async function translateNegativePromptTextToEnglish(value = '', options = {}) {
  const sourceText = normalizeText(value);
  if (!sourceText) return '';
  const fragments = splitPromptFragments(sourceText);
  if (!fragments.length) {
    return await translateNegativePromptHintToEnglish(sourceText, options);
  }
  const translated = await translateNegativePromptHintListToEnglish(fragments, options);
  return translated.join(', ');
}

function shouldSkipPromptContextEnglishRepair(pathSegments = [], value = '') {
  const leaf = String(pathSegments[pathSegments.length - 1] || '').trim().toLowerCase();
  if ([
    'target_language',
    'reference_init_image',
    'source_domain',
    'subject_profile_type',
    'image_url',
    'source_url',
  ].includes(leaf)) {
    return true;
  }
  const text = normalizeText(value);
  return /^(?:https?:\/\/|data:|app:\/\/|plugin:\/\/|file:\/\/)/i.test(text);
}

async function repairPromptContextValueToEnglish(currentValue, sourceValue, options = {}, pathSegments = []) {
  if (Array.isArray(currentValue)) {
    const sourceArray = Array.isArray(sourceValue) ? sourceValue : [];
    const repaired = [];
    for (let index = 0; index < currentValue.length; index += 1) {
      repaired.push(await repairPromptContextValueToEnglish(
        currentValue[index],
        sourceArray[index],
        options,
        [...pathSegments, String(index)]
      ));
    }
    return repaired;
  }

  if (currentValue && typeof currentValue === 'object') {
    const sourceObject = sourceValue && typeof sourceValue === 'object' ? sourceValue : {};
    const repairedEntries = [];
    for (const [key, entry] of Object.entries(currentValue)) {
      repairedEntries.push([
        key,
        await repairPromptContextValueToEnglish(entry, sourceObject?.[key], options, [...pathSegments, key]),
      ]);
    }
    return Object.fromEntries(repairedEntries);
  }

  if (typeof currentValue !== 'string') return currentValue;

  const currentText = normalizeText(currentValue);
  const sourceText = normalizeText(sourceValue || currentValue);
  if (!currentText || shouldSkipPromptContextEnglishRepair(pathSegments, currentText)) {
    return currentText;
  }
  const locallyNormalizedText = normalizeSdPromptRewriteText(currentText);
  if (isUsableEnglishPromptText(locallyNormalizedText, { allowUnknown: true })) {
    return locallyNormalizedText;
  }

  const llmRepaired = await translateDetailedPromptFieldToEnglish(sourceText, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    previousRejected: currentText,
  });
  if (llmRepaired && isUsableEnglishPromptText(llmRepaired, { allowUnknown: true })) {
    return llmRepaired;
  }

  return currentText;
}

async function translatePromptContextToEnglish(context = {}, options = {}) {
  const normalizedContext = normalizePromptContextShape(context);
  const profile = detectPromptContextLanguage(normalizedContext);
  if (profile?.dominant === 'en' && profile?.mixed !== true) {
    const promotedEnglishContext = { ...normalizedContext };
    if (shouldPromoteRawRequestToCurrentPrompt({
      rawRequest: promotedEnglishContext.raw_request,
      currentPrompt: promotedEnglishContext.current_prompt,
    })) {
      promotedEnglishContext.current_prompt = normalizeText(promotedEnglishContext.raw_request);
    }
    return normalizePromptContextShape(promotedEnglishContext);
  }
  if (typeof options.callStructuredLlmJson !== 'function') {
    return normalizedContext;
  }

  try {
    const translated = await options.callStructuredLlmJson({
      text: JSON.stringify(normalizedContext, null, 2),
      systemPrompt: `You are a multilingual prompt-context translator for A11.
You receive a JSON payload that may contain French, English, or mixed-language prompt context.
Your job is to translate and adapt every textual field into clean, detailed English for a downstream prompt refiner that only understands English.

Strict rules:
- preserve every concrete visual detail and every useful constraint
- never summarize, condense, shorten, simplify, or omit details
- keep the same JSON schema and the same level of detail
- translate string fields and array entries into English
- keep non-text fields unchanged
- output only strict JSON`,
      temperature: 0.1,
      maxTokens: resolvePromptRewriteMaxTokens([
        normalizedContext?.raw_request,
        normalizedContext?.current_prompt,
        normalizedContext?.current_negative_prompt,
      ], {
        floor: 1400,
        ceiling: 2400,
        base: 620,
      }),
      timeoutMs: Number(process.env.A11_IMAGE_PROMPT_TRANSLATOR_TIMEOUT_MS || 10000),
    });
    if (!isCompatiblePromptContextTranslation(normalizedContext, translated)) {
      return normalizedContext;
    }
    let repairedContext = normalizePromptContextShape(translated);
    for (const field of ['raw_request', 'current_prompt', 'current_negative_prompt']) {
      const sourceText = normalizeText(normalizedContext?.[field] || '');
      const translatedText = normalizeText(repairedContext?.[field] || '');
      if (!sourceText) continue;
      if (
        translatedText
        && isUsableEnglishPromptText(translatedText, { allowUnknown: field !== 'raw_request' })
        && !isOvercompressedPromptFieldRewrite(sourceText, translatedText)
      ) {
        continue;
      }
      const repairedField = await translateDetailedPromptFieldToEnglish(sourceText, {
        callStructuredLlmJson: options.callStructuredLlmJson,
        previousRejected: translatedText,
      });
      if (repairedField) {
        repairedContext = {
          ...repairedContext,
          [field]: repairedField,
        };
      }
    }
    if (shouldPromoteRawRequestToCurrentPrompt({
      rawRequest: repairedContext.raw_request,
      currentPrompt: repairedContext.current_prompt,
    })) {
      repairedContext = {
        ...repairedContext,
        current_prompt: normalizeText(repairedContext.raw_request),
      };
    }
    repairedContext = await repairPromptContextValueToEnglish(
      repairedContext,
      normalizedContext,
      options,
      []
    );
    return normalizePromptContextShape(repairedContext);
  } catch {
    return normalizedContext;
  }
}

const CANONICAL_STRUCTURED_PROMPT_KEYS = [
  'subject',
  'environment',
  'style',
  'composition',
  'lighting',
  'palette',
];

async function translateStructuredPromptEntryToEnglish(value = '', options = {}) {
  const sourceText = normalizeText(value);
  if (!sourceText) return '';
  if (isAcceptableSdRewriteLanguage(sourceText, { allowUnknown: false }) && !hasEnglishMixedLanguageArtifacts(sourceText)) {
    return sourceText;
  }

  const localTranslation = normalizeSdPromptRewriteText(
    typeof translateImagePromptToEnglish === 'function'
      ? translateImagePromptToEnglish(sourceText)
      : ''
  );
  if (
    localTranslation
    && isUsableEnglishPromptText(localTranslation, { allowUnknown: true })
    && !isOvercompressedPromptFieldRewrite(sourceText, localTranslation)
  ) {
    return localTranslation;
  }

  const llmTranslation = await translateDetailedPromptFieldToEnglish(sourceText, options);
  if (llmTranslation) return llmTranslation;

  return sourceText;
}

async function translateStructuredPromptListToEnglish(values = [], options = {}) {
  const translated = [];
  for (const entry of Array.isArray(values) ? values : [values]) {
    const nextEntry = await translateStructuredPromptEntryToEnglish(entry, options);
    if (nextEntry) translated.push(nextEntry);
  }
  return toUniqueNormalizedStrings(translated);
}

function buildStructuredPromptFieldsSnapshot(mask = {}) {
  return normalizeCanonicalStructuredPromptFields({
    subject: toUniqueNormalizedStrings(mask?.inputs?.subject || []),
    environment: toUniqueNormalizedStrings(mask?.inputs?.environment || []),
    style: toUniqueNormalizedStrings(mask?.inputs?.style || []),
    composition: toUniqueNormalizedStrings(mask?.inputs?.composition || []),
    lighting: toUniqueNormalizedStrings(mask?.inputs?.lighting || []),
    palette: toUniqueNormalizedStrings(mask?.inputs?.palette || []),
    constraints: {
      safe_mode: mask?.constraints?.safe_mode === true,
      no_text: mask?.constraints?.no_text === true,
      prompt_instructions: toUniqueNormalizedStrings(mask?.meta?.promptInstructions || []),
      negative_hints: toUniqueNormalizedStrings([
        ...(Array.isArray(mask?.meta?.promptNegativeHints) ? mask.meta.promptNegativeHints : []),
        ...(Array.isArray(mask?.meta?.negativeHints) ? mask.meta.negativeHints : []),
        ...splitPromptFragments(mask?.meta?.negative_prompt || mask?.meta?.negativePrompt || ''),
      ]),
    },
  });
}

function normalizeCanonicalStructuredPromptFields(structuredFields = {}) {
  const normalizedRequest = normalizeCanonicalizedImageGenerateRequestPayload(
    {
      canonicalEnglishInput: '',
      structuredFields,
    },
    ''
  );
  const normalizedFields = normalizedRequest?.structuredFields && typeof normalizedRequest.structuredFields === 'object'
    ? normalizedRequest.structuredFields
    : {};
  const constraints = normalizedFields?.constraints && typeof normalizedFields.constraints === 'object'
    ? normalizedFields.constraints
    : {};
  return {
    subject: toUniqueNormalizedStrings(normalizedFields?.subject || []),
    environment: toUniqueNormalizedStrings(normalizedFields?.environment || []),
    style: toUniqueNormalizedStrings(normalizedFields?.style || []),
    composition: toUniqueNormalizedStrings(normalizedFields?.composition || []),
    lighting: toUniqueNormalizedStrings(normalizedFields?.lighting || []),
    palette: toUniqueNormalizedStrings(normalizedFields?.palette || []),
    constraints: {
      safe_mode: constraints?.safe_mode === true || constraints?.safeMode === true,
      no_text: constraints?.no_text === true || constraints?.noText === true,
      prompt_instructions: toUniqueNormalizedStrings([
        ...(Array.isArray(constraints?.prompt_instructions) ? constraints.prompt_instructions : []),
        ...(Array.isArray(constraints?.promptInstructions) ? constraints.promptInstructions : []),
      ]),
      negative_hints: toUniqueNormalizedStrings([
        ...(Array.isArray(constraints?.negative_hints) ? constraints.negative_hints : []),
        ...(Array.isArray(constraints?.negativeHints) ? constraints.negativeHints : []),
      ]),
    },
  };
}

function hasUsableCanonicalStructuredPromptFields(structuredFields = {}) {
  return (
    CANONICAL_STRUCTURED_PROMPT_KEYS.some((key) => Array.isArray(structuredFields?.[key]) && structuredFields[key].length > 0)
    || (Array.isArray(structuredFields?.constraints?.prompt_instructions) && structuredFields.constraints.prompt_instructions.length > 0)
    || (Array.isArray(structuredFields?.constraints?.negative_hints) && structuredFields.constraints.negative_hints.length > 0)
    || structuredFields?.constraints?.safe_mode === true
    || structuredFields?.constraints?.no_text === true
  );
}

function logCanonicalPromptFlow({
  stage = 'runtime',
  rawUserInput = '',
  canonicalEnglishInput = '',
  structuredFields = null,
} = {}) {
  console.log(`[A11][prompt-canon][raw] stage=${stage} input=${JSON.stringify(String(rawUserInput || ''))}`);
  console.log(`[A11][prompt-canon][english] stage=${stage} input=${JSON.stringify(String(canonicalEnglishInput || ''))}`);
  if (structuredFields && typeof structuredFields === 'object') {
    console.log(`[A11][prompt-canon][fields] stage=${stage} ${JSON.stringify(structuredFields)}`);
  }
}

function buildCanonicalEnglishInputFromStructuredFields(structuredFields = {}) {
  const sections = [
    ...(Array.isArray(structuredFields?.subject) ? structuredFields.subject : []),
    ...(Array.isArray(structuredFields?.constraints?.prompt_instructions)
      ? structuredFields.constraints.prompt_instructions
      : []),
    ...(Array.isArray(structuredFields?.composition) ? structuredFields.composition : []),
    ...(Array.isArray(structuredFields?.environment) ? structuredFields.environment : []),
    ...(Array.isArray(structuredFields?.style) ? structuredFields.style : []),
    ...(Array.isArray(structuredFields?.lighting) ? structuredFields.lighting : []),
    (
      Array.isArray(structuredFields?.palette) && structuredFields.palette.length
        ? [`color palette: ${structuredFields.palette.join(', ')}`]
        : []
    ),
    ...(structuredFields?.constraints?.no_text === true ? ['no readable text'] : []),
  ];

  return toUniqueNormalizedStrings(sections).join(', ');
}

function cleanupFallbackImageSubjectCandidate(value = '') {
  const text = normalizeText(value)
    .replace(/^(?:a|an|the|un|une|le|la|les|du|de|des|d['’])\s+/i, '')
    .replace(/\b(?:high quality|detailed|single main subject|clear centered composition|clear subject focus|simple clean background|literal interpretation)\b[\s\S]*$/i, '')
    .replace(/\b(?:avec|with|dans|in|sur|on|sans|without|style|background|fond|lighting|couleurs?|palette)\b[\s\S]*$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim();
  if (!text) return '';
  if (/\b(?:tu peux|peux tu|generate|generer|g[?]+n[?]+rer|image|illustration|prompt|subject|background)\b/i.test(text)) {
    return '';
  }
  return text.split(/\s+/).slice(0, 6).join(' ').trim();
}

function inferFallbackImageSubjectFromFreeformText(value = '') {
  const source = normalizeText(value);
  if (!source) return '';
  const patterns = [
    /\bimage\s+of\s+([^,.!?;]+)/i,
    /\b(?:image|illustration|drawing|picture|photo)\s+(?:de|du|d['’]|of)\s+([^,.!?;]+)/i,
    /\b(?:generate|render|draw|create|genere|g[?]+n[?]+rer|générer)\s+(?:an?\s+)?(?:image|illustration|drawing|picture|photo)\s+(?:de|du|d['’]|of)\s+([^,.!?;]+)/i,
  ];
  for (const pattern of patterns) {
    const candidate = cleanupFallbackImageSubjectCandidate(pattern.exec(source)?.[1] || '');
    if (candidate) {
      return normalizeSdPromptRewriteText(
        typeof translateImagePromptToEnglish === 'function'
          ? translateImagePromptToEnglish(candidate)
          : candidate
      ) || candidate;
    }
  }
  return '';
}

function isSuspiciousImageSubjectCandidate(value = '') {
  const text = normalizeText(value);
  if (!text) return true;
  return (
    /\b(?:tu peux|peux tu|generate|generer|g[?]+n[?]+rer|image of|a image|literal interpretation)\b/i.test(text)
    || /[?]{2,}/.test(text)
  );
}

async function canonicalizeImageMaskPromptFlow(mask = {}, options = {}) {
  const normalizedMask = normalizeMaskImageGenerate(mask);
  const compilerTarget = String(normalizedMask?.compiler?.target || '').trim().toLowerCase();
  if (!['image-prompt-en', 'sd-payload'].includes(compilerTarget)) {
    return normalizedMask;
  }

  const meta = normalizedMask?.meta && typeof normalizedMask.meta === 'object'
    ? normalizedMask.meta
    : {};
  const existingCanonicalizedRequest = meta?.canonicalizedRequest && typeof meta.canonicalizedRequest === 'object'
    ? meta.canonicalizedRequest
    : null;
  const existingPromptCanonicalization = meta?.promptCanonicalization && typeof meta.promptCanonicalization === 'object'
    ? meta.promptCanonicalization
    : null;
  const existingAudit = existingCanonicalizedRequest?.audit && typeof existingCanonicalizedRequest.audit === 'object'
    ? existingCanonicalizedRequest.audit
    : {};
  const shouldBypassReusableCanonicalFields = (
    String(options.stage || '').trim() === 'post_enrichment'
    && (
      Number(meta?.specialCompilerAppliedHintsCount || 0) > 0
      || Number(meta?.specialCompilerMemoryHintsAppliedCount || 0) > 0
      || (meta?.imageScratchpad && typeof meta.imageScratchpad === 'object')
      || (meta?.imageRequestDirector && typeof meta.imageRequestDirector === 'object')
      || (meta?.webReferencePack && typeof meta.webReferencePack === 'object')
    )
  );
  const translationOptions = {
    callStructuredLlmJson: shouldBypassReusableCanonicalFields ? null : options.callStructuredLlmJson,
  };
  const reusableCanonicalStructuredFields = shouldBypassReusableCanonicalFields
    ? null
    : [
    existingCanonicalizedRequest?.structuredFields,
    existingPromptCanonicalization?.structuredFields,
  ]
    .map((candidate) => normalizeCanonicalStructuredPromptFields(candidate))
    .find((candidate) => hasUsableCanonicalStructuredPromptFields(candidate))
    || null;
  const rawUserInput = pickMostDetailedPromptText([
    meta?.initialRawUserInput,
    meta?.userSourceText,
    existingAudit?.rawUserInput,
    existingPromptCanonicalization?.rawUserInput,
    resolveAuthoritativeRawRequest(normalizedMask),
    normalizedMask?.raw,
  ]);
  const structuredPromptSource = buildCanonicalEnglishInputFromStructuredFields(
    buildStructuredPromptFieldsSnapshot(normalizedMask)
  );
  const canonicalTranslationSource = pickMostDetailedPromptText([
    rawUserInput,
    structuredPromptSource,
    normalizeText(normalizedMask?.raw || ''),
  ]);
  const existingCanonicalEnglishInput = normalizeText(
    existingCanonicalizedRequest?.canonicalEnglishInput
    || existingPromptCanonicalization?.canonicalEnglishInput
    || ''
  );
  const shouldRefreshCanonicalEnglishInput = (
    String(options.stage || '').trim() === 'post_enrichment'
    && isRichPromptForDetailPreservation(canonicalTranslationSource)
    && scorePromptDetailDensity(canonicalTranslationSource) > Math.max(260, Math.round(scorePromptDetailDensity(existingCanonicalEnglishInput) * 1.25))
  );
  const canonicalEnglishInput = isUsableEnglishPromptText(existingCanonicalEnglishInput, { allowUnknown: true })
    && !shouldRefreshCanonicalEnglishInput
    ? existingCanonicalEnglishInput
    : await translateStructuredPromptEntryToEnglish(canonicalTranslationSource || rawUserInput, translationOptions);

  const translatedInputs = {};
  for (const key of CANONICAL_STRUCTURED_PROMPT_KEYS) {
    const preservedEntries = Array.isArray(reusableCanonicalStructuredFields?.[key])
      ? reusableCanonicalStructuredFields[key]
      : [];
    translatedInputs[key] = preservedEntries.length
      ? preservedEntries
      : await translateStructuredPromptListToEnglish(
        normalizedMask?.inputs?.[key] || [],
        translationOptions
      );
  }
  const fallbackSubject = inferFallbackImageSubjectFromFreeformText(
    pickMostDetailedPromptText([
      rawUserInput,
      canonicalTranslationSource,
      normalizedMask?.raw,
      meta?.sourceText,
      meta?.originalSourceText,
    ])
  );
  if (
    fallbackSubject
    && (
      !Array.isArray(translatedInputs.subject)
      || translatedInputs.subject.length <= 0
      || translatedInputs.subject.every((entry) => isSuspiciousImageSubjectCandidate(entry))
    )
  ) {
    translatedInputs.subject = [fallbackSubject];
  }

  const translatedStructuredEntries = CANONICAL_STRUCTURED_PROMPT_KEYS.flatMap((key) => (
    Array.isArray(translatedInputs?.[key]) ? translatedInputs[key] : []
  ));
  const englishStructuredEntryCount = translatedStructuredEntries.filter((entry) => (
    isCanonicalEnglishSdText(entry, { allowUnknown: true })
  )).length;
  const nonEnglishStructuredEntryCount = translatedStructuredEntries.filter((entry) => (
    normalizeText(entry)
    && (
      hasFrenchPromptLeak(entry)
      || !isCanonicalEnglishSdText(entry, { allowUnknown: true })
    )
  )).length;
  const shouldBackfillStructuredFieldsFromCanonicalEnglish = (
    isUsableEnglishPromptText(canonicalEnglishInput, { allowUnknown: true })
    && nonEnglishStructuredEntryCount >= Math.max(2, englishStructuredEntryCount + 1)
  );
  if (shouldBackfillStructuredFieldsFromCanonicalEnglish) {
    for (const key of ['subject', 'environment', 'style', 'composition']) {
      translatedInputs[key] = [canonicalEnglishInput];
    }
  }
  const structuredDetailText = normalizeText(translatedStructuredEntries.join(', '));
  if (
    !reusableCanonicalStructuredFields
    && isRichPromptForDetailPreservation(canonicalEnglishInput)
    && canonicalEnglishInput.length > Math.max(160, Math.round(structuredDetailText.length * 0.9))
  ) {
    translatedInputs.composition = toUniqueNormalizedStrings([
      ...(Array.isArray(translatedInputs.composition) ? translatedInputs.composition : []),
      canonicalEnglishInput,
    ]);
  }

  const preservedPromptInstructions = Array.isArray(reusableCanonicalStructuredFields?.constraints?.prompt_instructions)
    ? reusableCanonicalStructuredFields.constraints.prompt_instructions
    : [];
  const preservedNegativeHints = Array.isArray(reusableCanonicalStructuredFields?.constraints?.negative_hints)
    ? reusableCanonicalStructuredFields.constraints.negative_hints
    : [];
  const translatedPromptInstructions = preservedPromptInstructions.length
    ? preservedPromptInstructions
    : await translateStructuredPromptListToEnglish(
      meta?.promptInstructions || [],
      translationOptions
    );
  const translatedPromptNegativeHints = preservedNegativeHints.length
    ? preservedNegativeHints
    : await translateNegativePromptHintListToEnglish(
      meta?.promptNegativeHints || [],
      translationOptions
    );
  const translatedNegativeHints = preservedNegativeHints.length
    ? preservedNegativeHints
    : await translateNegativePromptHintListToEnglish(
      meta?.negativeHints || [],
      translationOptions
    );
  const translatedNegativePrompt = await translateNegativePromptTextToEnglish(
    meta?.negative_prompt || meta?.negativePrompt || '',
    translationOptions
  );
  const translatedTechniquePrompt = await translateStructuredPromptEntryToEnglish(
    meta?.techniqueAnalysisPrompt || '',
    translationOptions
  );
  const translatedSubjectProfilePromptInstruction = await translateStructuredPromptEntryToEnglish(
    meta?.subjectProfile?.promptInstruction || '',
    translationOptions
  );
  const preliminaryMask = {
    ...normalizedMask,
    constraints: {
      ...(normalizedMask?.constraints && typeof normalizedMask.constraints === 'object'
        ? normalizedMask.constraints
        : {}),
      safe_mode: normalizedMask?.constraints?.safe_mode === true || reusableCanonicalStructuredFields?.constraints?.safe_mode === true,
      no_text: normalizedMask?.constraints?.no_text === true || reusableCanonicalStructuredFields?.constraints?.no_text === true,
    },
    inputs: {
      ...(normalizedMask?.inputs && typeof normalizedMask.inputs === 'object' ? normalizedMask.inputs : {}),
      ...translatedInputs,
    },
    meta: {
      ...meta,
      promptInstructions: translatedPromptInstructions,
      promptNegativeHints: translatedPromptNegativeHints,
      negativeHints: translatedNegativeHints,
      ...(translatedNegativePrompt
        ? {
            negative_prompt: translatedNegativePrompt,
            negativePrompt: translatedNegativePrompt,
          }
        : {}),
      subjectProfile: (
        meta?.subjectProfile && typeof meta.subjectProfile === 'object'
          ? {
              ...meta.subjectProfile,
              ...(translatedSubjectProfilePromptInstruction
                ? { promptInstruction: translatedSubjectProfilePromptInstruction }
                : {}),
            }
          : meta?.subjectProfile
      ),
    },
  };
  const structuredFields = buildStructuredPromptFieldsSnapshot(preliminaryMask);
  const structuredEnglishFallback = buildCanonicalEnglishInputFromStructuredFields(structuredFields);
  const resolvedCanonicalEnglishInput = isUsableEnglishPromptText(canonicalEnglishInput, { allowUnknown: true })
    ? canonicalEnglishInput
    : structuredEnglishFallback;

  const nextMask = {
    ...preliminaryMask,
    ...(resolvedCanonicalEnglishInput ? { raw: resolvedCanonicalEnglishInput } : {}),
    meta: {
      ...(preliminaryMask?.meta && typeof preliminaryMask.meta === 'object' ? preliminaryMask.meta : {}),
      deferEnglishPromptLocalization: false,
      ...(resolvedCanonicalEnglishInput
        ? {
            initialRawUserInput: normalizeText(meta?.initialRawUserInput || rawUserInput),
            userSourceText: normalizeText(meta?.userSourceText || rawUserInput),
            originalSourceText: resolvedCanonicalEnglishInput,
            sourceText: resolvedCanonicalEnglishInput,
            promptSeedText: resolvedCanonicalEnglishInput,
            promptText: resolvedCanonicalEnglishInput,
          }
        : {}),
      ...(translatedTechniquePrompt ? { techniqueAnalysisPrompt: translatedTechniquePrompt } : {}),
    },
  };
  nextMask.meta = {
    ...(nextMask?.meta && typeof nextMask.meta === 'object' ? nextMask.meta : {}),
    canonicalizedRequest: {
      canonicalEnglishInput: resolvedCanonicalEnglishInput,
      structuredFields,
      scenePolicy: existingCanonicalizedRequest?.scenePolicy || existingPromptCanonicalization?.scenePolicy || null,
      audit: {
        ...existingAudit,
        rawUserInput,
      },
    },
    promptCanonicalization: {
      ...(existingPromptCanonicalization && typeof existingPromptCanonicalization === 'object'
        ? existingPromptCanonicalization
        : {}),
      rawUserInput,
      canonicalEnglishInput: resolvedCanonicalEnglishInput,
      structuredFields,
    },
  };

  logCanonicalPromptFlow({
    stage: options.stage || 'runtime',
    rawUserInput,
    canonicalEnglishInput: resolvedCanonicalEnglishInput,
    structuredFields,
  });

  return nextMask;
}

async function enforceFinalCanonicalEnglishPrompt(compiledState = {}, options = {}) {
  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
    : {};
  const currentPrompt = normalizeSdPromptRewriteText(sdBody?.prompt || '');
  const currentNegativePrompt = normalizeSdPromptRewriteText(sdBody?.negative_prompt || '');
  const promptOkay = isCanonicalEnglishSdText(currentPrompt, { allowUnknown: true });
  const negativeOkay = !currentNegativePrompt || isCanonicalEnglishSdText(currentNegativePrompt, { allowUnknown: true });

  if (promptOkay && negativeOkay) {
    const normalizedCanonicalState = (
      currentPrompt !== normalizeText(sdBody?.prompt || '')
      || currentNegativePrompt !== normalizeText(sdBody?.negative_prompt || '')
    )
      ? applyPromptOverrideCompiledState(compiledState, {
        prompt: currentPrompt,
        negativePrompt: currentNegativePrompt,
        promptLanguage: SD_PROMPT_OUTPUT_LANGUAGE,
      })
      : null;
    const upstreamCanonicalizationApplied = (
      compiledState?.techniqueReconciler?.promptGuidance?.applied === true
      && String(compiledState?.techniqueReconciler?.promptGuidance?.baseNormalization || '').trim()
    );
    return {
      compiledState: normalizedCanonicalState || compiledState,
      finalPromptGuard: {
        applied: Boolean(normalizedCanonicalState) || Boolean(upstreamCanonicalizationApplied),
        reason: normalizedCanonicalState
          ? 'normalized_existing_canonical_prompt'
          : (upstreamCanonicalizationApplied
              ? 'translated_current_prompt_to_canonical_english'
              : 'already_canonical'),
      },
    };
  }

  const repairedCurrentState = await repairCompiledStateToCanonicalEnglish(compiledState, options);
  if (repairedCurrentState.repaired === true) {
    return {
      compiledState: repairedCurrentState.compiledState,
      finalPromptGuard: {
        applied: true,
        reason: repairedCurrentState.reason,
      },
    };
  }

  const mask = compiledState?.mask && typeof compiledState.mask === 'object'
    ? {
        ...compiledState.mask,
        meta: {
          ...((compiledState.mask.meta && typeof compiledState.mask.meta === 'object') ? compiledState.mask.meta : {}),
          deferEnglishPromptLocalization: false,
        },
      }
    : null;
  if (!mask) {
    return {
      compiledState,
      finalPromptGuard: {
        applied: false,
        rejected: true,
        reason: 'missing_mask_for_rebuild',
      },
    };
  }

  try {
    const rebuiltPayload = compileMaskToImagePrompt(mask);
    const rebuiltPrompt = normalizeSdPromptRewriteText(rebuiltPayload?.prompt || '');
    const rebuiltNegativePrompt = normalizeSdPromptRewriteText(
      rebuiltPayload?.negative_prompt || currentNegativePrompt || ''
    );
    const rebuiltPromptOkay = isCanonicalEnglishSdText(rebuiltPrompt, { allowUnknown: true });
    const rebuiltNegativeOkay = !rebuiltNegativePrompt || isCanonicalEnglishSdText(rebuiltNegativePrompt, { allowUnknown: true });

    if (!rebuiltPromptOkay || !rebuiltNegativeOkay) {
      const rebuiltState = applyPromptOverrideCompiledStateStrict({
        ...compiledState,
        mask,
      }, {
        prompt: rebuiltPrompt,
        negativePrompt: rebuiltNegativePrompt,
        promptLanguage: SD_PROMPT_OUTPUT_LANGUAGE,
      });
      const repairedRebuiltState = await repairCompiledStateToCanonicalEnglish(
        rebuiltState || {
          ...compiledState,
          mask,
          sdBody: {
            ...sdBody,
            prompt: rebuiltPrompt,
            negative_prompt: rebuiltNegativePrompt,
            prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
          },
        },
        options
      );
      if (repairedRebuiltState.repaired === true) {
        return {
          compiledState: repairedRebuiltState.compiledState,
          finalPromptGuard: {
            applied: true,
            reason: 'translated_rebuilt_prompt_to_canonical_english',
          },
        };
      }
      return {
        compiledState,
        finalPromptGuard: {
          applied: false,
          rejected: true,
          reason: 'rebuilt_prompt_not_canonical_english',
        },
      };
    }

    const guardedState = applyPromptOverrideCompiledState({
      ...compiledState,
      mask,
    }, {
      prompt: rebuiltPrompt,
      negativePrompt: rebuiltNegativePrompt,
      promptLanguage: SD_PROMPT_OUTPUT_LANGUAGE,
    });

    return {
      compiledState: guardedState || compiledState,
      finalPromptGuard: {
        applied: Boolean(guardedState),
        reason: guardedState
          ? 'rebuilt_from_canonical_english_fields'
          : 'rebuild_override_unavailable',
      },
    };
  } catch (error_) {
    return {
      compiledState,
      finalPromptGuard: {
        applied: false,
        rejected: true,
        reason: 'canonical_english_rebuild_failed',
        message: String(error_?.message || error_),
      },
    };
  }
}

function buildStrengthComponentPromptGuidance({
  strengthComponents = null,
  promptLanguage = '',
  prompt = '',
  mask = {},
} = {}) {
  if (!strengthComponents || typeof strengthComponents !== 'object') {
    return {
      positiveHints: [],
      negativeHints: [],
      language: 'en',
    };
  }

  const language = 'en';
  const identity = strengthComponents.identity && typeof strengthComponents.identity === 'object'
    ? strengthComponents.identity
    : {};
  const anatomy = strengthComponents.anatomy && typeof strengthComponents.anatomy === 'object'
    ? strengthComponents.anatomy
    : {};
  const outfit = strengthComponents.outfit && typeof strengthComponents.outfit === 'object'
    ? strengthComponents.outfit
    : {};
  const background = strengthComponents.background && typeof strengthComponents.background === 'object'
    ? strengthComponents.background
    : {};
  const effects = strengthComponents.effects && typeof strengthComponents.effects === 'object'
    ? strengthComponents.effects
    : {};
  const props = strengthComponents.props && typeof strengthComponents.props === 'object'
    ? strengthComponents.props
    : {};
  const referenceJokerTransformation = isReferenceHumanJokerTransformation(mask, prompt);

  const positiveHints = [];
  const negativeHints = [];

  if (referenceJokerTransformation) {
    positiveHints.push('make the outfit change clearly visible');
    positiveHints.push('clearly redesign the background and atmosphere');
    positiveHints.push('make the lighting and effects clearly visible');
  }

  if (
    String(identity.profile || '').trim() === 'preserve'
    || Number(identity.strength) <= 0.34
  ) {
    positiveHints.push('keep exactly the same face and identity');
    positiveHints.push('preserve the same recognizable face and the same facial structure from the reference image');
    positiveHints.push('keep the same eyes, eyebrows, nose, jawline, and smile from the reference image');
    positiveHints.push('preserve the pose and framing from the reference image');
    negativeHints.push('different face', 'different identity', 'different person');
  }

  if (
    String(anatomy.profile || '').trim() === 'preserve'
    || Number(anatomy.strength) <= 0.36
  ) {
    positiveHints.push('preserve natural anatomy and stable proportions');
    positiveHints.push('preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image');
    negativeHints.push('bad anatomy', 'deformed hands', 'deformed eyes');
  }

  if (hasReferenceHumanFigure(mask)) {
    positiveHints.push('full body visible');
  }

  if (String(outfit.profile || '').trim() === 'preserve') {
    positiveHints.push('preserve the silhouette and main outfit');
  } else if (
    ['balanced', 'restyle'].includes(String(outfit.profile || '').trim())
    && Number(outfit.strength) >= 0.58
  ) {
    positiveHints.push('make the outfit change clearly visible');
  }

  if (referenceJokerTransformation) {
    positiveHints.push('make the outfit change clearly visible');
  }

  if (
    String(background.profile || '').trim() === 'restyle'
    || Number(background.strength) >= 0.7
  ) {
    positiveHints.push('clearly redesign the background and atmosphere');
  }

  if (
    ['balanced', 'restyle'].includes(String(effects.profile || '').trim())
    && Number(effects.strength) >= 0.58
  ) {
    positiveHints.push('make the lighting and effects clearly visible');
  }

  if (
    ['balanced', 'restyle'].includes(String(props.profile || '').trim())
    && Number(props.strength) >= 0.56
  ) {
    positiveHints.push(
      inferSpecificPropPromptHint(mask, prompt)
      || 'make the requested prop or accessory clearly visible'
    );
  }

  if (mask?.meta?.webImageDraft?.fromChatSourceImage === true) {
    positiveHints.unshift('ignore any mobile screenshot interface or overlay caption from the reference image');
    negativeHints.unshift('mobile screenshot interface, story caption overlay, status bar, phone icons');
  }

  return {
    language,
    positiveHints: toUniqueNormalizedStrings(positiveHints).slice(0, hasReferenceHumanFigure(mask) ? 12 : 8),
    negativeHints: toUniqueNormalizedStrings(negativeHints).slice(0, 6),
  };
}

function applyStrengthComponentPromptGuidance(compiledState = {}, mask = {}) {
  const baseNormalization = canonicalizePromptGuidanceBaseState(compiledState, mask);
  if (baseNormalization.canonical === false) {
    return {
      compiledState: baseNormalization.compiledState,
      promptGuidance: {
        applied: false,
        reason: 'base_prompt_not_canonical_english',
      },
    };
  }
  const effectiveCompiledState = baseNormalization.compiledState;
  const sdBody = effectiveCompiledState?.sdBody && typeof effectiveCompiledState.sdBody === 'object'
    ? effectiveCompiledState.sdBody
    : {};
  const strengthComponents = sdBody?.strength_components
    || mask?.meta?.webImageDraft?.strengthComponents
    || null;
  const guidance = buildStrengthComponentPromptGuidance({
    strengthComponents,
    promptLanguage: sdBody?.prompt_language,
    prompt: sdBody?.prompt,
    mask,
  });

  if (!guidance.positiveHints.length && !guidance.negativeHints.length) {
    return {
      compiledState: effectiveCompiledState,
      promptGuidance: {
        applied: false,
        reason: 'no_component_guidance',
        ...(baseNormalization.applied
          ? { baseNormalization: baseNormalization.reason }
          : {}),
      },
    };
  }

  const normalizedBasePrompt = normalizeReferenceHumanTransformationPrompt(sdBody?.prompt || '', mask);
  const nextPrompt = mergePromptHints(normalizedBasePrompt, guidance.positiveHints, {
    maxHints: hasReferenceHumanFigure(mask) ? 10 : 4,
    insertAfterLead: isReferenceHumanJokerTransformation(mask, normalizedBasePrompt),
  });
  const nextNegativePrompt = mergeNegativePromptHints(sdBody?.negative_prompt || '', guidance.negativeHints);

  const nextCompiledState = {
    ...effectiveCompiledState,
    compiledPayload: {
      ...(effectiveCompiledState?.compiledPayload && typeof effectiveCompiledState.compiledPayload === 'object' ? effectiveCompiledState.compiledPayload : {}),
      ...(nextPrompt ? { prompt: nextPrompt } : {}),
      ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
    },
    compiled: (
      effectiveCompiledState?.compiled && typeof effectiveCompiledState.compiled === 'object'
        ? {
            ...effectiveCompiledState.compiled,
            ...(nextPrompt ? { prompt: nextPrompt } : {}),
            ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
          }
        : effectiveCompiledState.compiled
    ),
    sdBody: {
      ...sdBody,
      ...(nextPrompt ? { prompt: nextPrompt } : {}),
      ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
    },
  };

  return {
    compiledState: nextCompiledState,
    promptGuidance: {
      applied: true,
      reason: 'component_strength_guidance',
      language: guidance.language,
      positiveHints: guidance.positiveHints,
      negativeHints: guidance.negativeHints,
      ...(baseNormalization.applied
        ? { baseNormalization: baseNormalization.reason }
        : {}),
    },
  };
}

const IMAGE_COMPONENT_PROMPT_DIRECTOR_SYSTEM_PROMPT = `Je suis le directeur final du prompt Stable Diffusion pour A11.
J'interviens APRES la stabilisation du prompt final et APRES le calcul des strengths par composant.

Mission :
- reformuler le prompt final de façon naturelle, fluide, fidele et complete
- intégrer les consignes de contrôle par composant sans mentionner les scores ni la mécanique interne
- préserver strictement le sujet principal, le nombre de sujets, l identité, la relation entre sujets, le style demandé et les contraintes critiques
- éviter les contradictions entre preservation d identité/anatomie et restylisation du décor, des accessoires ou des effets
- ne pas ajouter de nouveau personnage, de nouvel objet principal ni de nouvelle action importante

Règles :
- pour les champs prompt et negative_prompt, utiliser strictement l anglais naturel, english only
- je ne suis pas un résumeur: ne jamais condenser, simplifier, raccourcir ou lisser agressivement une demande riche
- si la raw_request ou le current_prompt contient un détail visuel concret utile, il doit rester présent dans la sortie finale
- si le prompt courant est deja riche et precis, le conserver presque intact et n ajuster que ce qui est necessaire pour l anglais, la fluidité et la cohérence
- si la raw_request est plus riche que le current_prompt, réintégrer proprement ses détails concrets dans le prompt final
- intégrer les priorités de façon sémantique, pas comme une liste technique
- ne jamais raccourcir agressivement un prompt deja detaille
- conserver la densité visuelle: le prompt final peut rester long si la demande est longue
- produire aussi un negative prompt propre et coherent sans ecraser les contraintes existantes

Je réponds uniquement en JSON strict :
{
  "prompt": "prompt final reformulé",
  "negative_prompt": "negative prompt final"
}`;

function resolveImageFinalPromptDirectorEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = String(process.env.A11_IMAGE_FINAL_PROMPT_DIRECTOR || '').trim().toLowerCase();
  if (!envValue) return true;
  if (['0', 'false', 'no', 'off'].includes(envValue)) return false;
  if (['1', 'true', 'yes', 'on'].includes(envValue)) return true;
  return true;
}

function buildStrengthComponentDirectorSourceContext(compiledState = {}, mask = {}, guidance = {}) {
  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
    : {};
  const rawComponents = sdBody?.strength_components && typeof sdBody.strength_components === 'object'
    ? sdBody.strength_components
    : {};

  const components = Object.fromEntries(
    Object.entries(rawComponents).map(([key, value]) => [
      key,
      {
        profile: String(value?.profile || '').trim(),
        reason: String(value?.reason || '').trim(),
        strength: Number(value?.strength),
      },
    ])
  );
  const positiveHints = Array.isArray(guidance.positiveHints)
    ? guidance.positiveHints.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const negativeHints = Array.isArray(guidance.negativeHints)
    ? guidance.negativeHints.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  return {
    target_language: SD_PROMPT_OUTPUT_LABEL,
    raw_request: resolveAuthoritativeRawRequest(mask),
    current_prompt: normalizeText(sdBody?.prompt || ''),
    current_negative_prompt: normalizeText(sdBody?.negative_prompt || ''),
    reference_init_image: String(
      sdBody?.init_image_url
      || mask?.meta?.webImageDraft?.initImageUrl
      || mask?.meta?.webImageDraft?.initImagePath
      || ''
    ).trim(),
    global_strength_profile: String(sdBody?.strength_profile || '').trim(),
    global_strength_reason: String(sdBody?.strength_reason || '').trim(),
    scene_type: String(mask?.meta?.webImageDraft?.sceneType || '').trim(),
    strength_components: components,
    guidance_positive_hints: positiveHints,
    guidance_negative_hints: negativeHints,
  };
}

function buildStrengthComponentDirectorInput(context = {}) {
  return JSON.stringify(normalizePromptContextShape(context), null, 2);
}

async function directStrengthComponentPromptGuidance(compiledState = {}, mask = {}, options = {}) {
  const baseNormalization = canonicalizePromptGuidanceBaseState(compiledState, mask);
  if (baseNormalization.canonical === false) {
    return {
      compiledState: baseNormalization.compiledState,
      promptGuidance: {
        applied: false,
        reason: 'base_prompt_not_canonical_english',
      },
    };
  }
  const effectiveCompiledState = baseNormalization.compiledState;
  const sdBody = effectiveCompiledState?.sdBody && typeof effectiveCompiledState.sdBody === 'object'
    ? effectiveCompiledState.sdBody
    : {};
  const guidance = buildStrengthComponentPromptGuidance({
    strengthComponents: sdBody?.strength_components
      || mask?.meta?.webImageDraft?.strengthComponents
      || null,
    promptLanguage: sdBody?.prompt_language,
    prompt: sdBody?.prompt,
  });

  if (!guidance.positiveHints.length && !guidance.negativeHints.length) {
    return {
      compiledState: effectiveCompiledState,
      promptGuidance: {
        applied: false,
        reason: 'no_component_guidance',
        ...(baseNormalization.applied
          ? { baseNormalization: baseNormalization.reason }
          : {}),
      },
    };
  }

  if (isRichFinalImagePrompt(sdBody?.prompt || '', sdBody?.negative_prompt || '')) {
    const fallback = applyStrengthComponentPromptGuidance(effectiveCompiledState, mask);
    return {
      compiledState: fallback.compiledState,
      promptGuidance: {
        ...fallback.promptGuidance,
        preservedRichPrompt: true,
        reason: fallback.promptGuidance?.applied === true
          ? 'component_strength_guidance_preserved_rich_prompt'
          : 'rich_prompt_preserved',
      },
    };
  }

  const normalizedPrompt = normalizeSdPromptRewriteText(sdBody?.prompt || '');
  const normalizedNegativePrompt = normalizeSdPromptRewriteText(sdBody?.negative_prompt || '');
  const promptCanonical = isUsableEnglishPromptText(normalizedPrompt, { allowUnknown: true });
  const negativeCanonical = !normalizedNegativePrompt
    || isUsableEnglishPromptText(normalizedNegativePrompt, { allowUnknown: true });
  if (promptCanonical && negativeCanonical) {
    const normalizedCompiledState = {
      ...effectiveCompiledState,
      sdBody: {
        ...sdBody,
        prompt: normalizedPrompt,
        negative_prompt: normalizedNegativePrompt || sdBody?.negative_prompt || '',
      },
    };
    return applyStrengthComponentPromptGuidance(normalizedCompiledState, mask);
  }

  if (
    !resolveImageFinalPromptDirectorEnabled(options.finalPromptDirectorEnabled)
    || typeof options.callStructuredLlmJson !== 'function'
  ) {
    return applyStrengthComponentPromptGuidance(effectiveCompiledState, mask);
  }

  try {
    const englishContext = await translatePromptContextToEnglish(
      buildStrengthComponentDirectorSourceContext(effectiveCompiledState, mask, guidance),
      { callStructuredLlmJson: options.callStructuredLlmJson }
    );
    const promotedFallbackState = buildEnglishPromptOverrideCompiledState(effectiveCompiledState, {
      prompt: englishContext?.current_prompt || '',
      negativePrompt: englishContext?.current_negative_prompt || sdBody?.negative_prompt || '',
    });
    const compressionReferencePrompt = pickMostDetailedPromptText([
      englishContext?.raw_request,
      englishContext?.current_prompt,
      sdBody?.prompt,
    ]);
    const response = await options.callStructuredLlmJson({
      text: buildStrengthComponentDirectorInput(englishContext),
      systemPrompt: IMAGE_COMPONENT_PROMPT_DIRECTOR_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: resolvePromptRewriteMaxTokens([
        englishContext?.raw_request,
        englishContext?.current_prompt,
        englishContext?.current_negative_prompt,
      ], {
        floor: 900,
        ceiling: 1800,
        base: 420,
      }),
      timeoutMs: Number(process.env.A11_IMAGE_FINAL_PROMPT_DIRECTOR_TIMEOUT_MS || 9000),
    });

    const nextPrompt = normalizeSdPromptRewriteText(response?.prompt || '');
    const nextNegativePrompt = normalizeSdPromptRewriteText(response?.negative_prompt || '');
    if (!nextPrompt) {
      return applyStrengthComponentPromptGuidance(promotedFallbackState || effectiveCompiledState, mask);
    }
    if (!isUsableEnglishPromptText(nextPrompt, { allowUnknown: true })) {
      const fallback = applyStrengthComponentPromptGuidance(promotedFallbackState || effectiveCompiledState, mask);
      return {
        compiledState: fallback.compiledState,
        promptGuidance: {
          ...fallback.promptGuidance,
          fallbackReason: 'component_strength_llm_director_non_english',
        },
      };
    }
    if (nextNegativePrompt && !isUsableEnglishPromptText(nextNegativePrompt, { allowUnknown: true })) {
      const fallback = applyStrengthComponentPromptGuidance(promotedFallbackState || effectiveCompiledState, mask);
      return {
        compiledState: fallback.compiledState,
        promptGuidance: {
          ...fallback.promptGuidance,
          fallbackReason: 'component_strength_llm_director_non_english_negative',
        },
      };
    }
    if (isOvercompressedPromptRewrite({
      currentPrompt: compressionReferencePrompt || sdBody?.prompt || '',
      currentNegativePrompt: englishContext?.current_negative_prompt || sdBody?.negative_prompt || '',
      nextPrompt,
      nextNegativePrompt,
    })) {
      const fallback = applyStrengthComponentPromptGuidance(promotedFallbackState || effectiveCompiledState, mask);
      return {
        compiledState: fallback.compiledState,
        promptGuidance: {
          ...fallback.promptGuidance,
          fallbackReason: 'component_strength_llm_director_overcompressed',
          preservedRichPrompt: true,
        },
      };
    }

    const nextCompiledState = {
      ...effectiveCompiledState,
      compiledPayload: {
        ...(effectiveCompiledState?.compiledPayload && typeof effectiveCompiledState.compiledPayload === 'object' ? effectiveCompiledState.compiledPayload : {}),
        prompt: nextPrompt,
        prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
        ...(nextNegativePrompt
          ? { negative_prompt: nextNegativePrompt }
          : {}),
      },
      compiled: (
        effectiveCompiledState?.compiled && typeof effectiveCompiledState.compiled === 'object'
          ? {
              ...effectiveCompiledState.compiled,
              prompt: nextPrompt,
              prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
              ...(nextNegativePrompt
                ? { negative_prompt: nextNegativePrompt }
                : {}),
            }
          : effectiveCompiledState.compiled
      ),
      sdBody: {
        ...sdBody,
        prompt: nextPrompt,
        prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
        ...(nextNegativePrompt
          ? { negative_prompt: nextNegativePrompt }
          : {}),
      },
    };

    return {
      compiledState: nextCompiledState,
      promptGuidance: {
        applied: true,
        reason: 'component_strength_llm_director',
        language: guidance.language,
        positiveHints: guidance.positiveHints,
        negativeHints: guidance.negativeHints,
        originalPrompt: String(sdBody?.prompt || '').trim(),
        refinedPrompt: nextPrompt,
        refinedNegativePrompt: nextNegativePrompt || String(sdBody?.negative_prompt || '').trim(),
        ...(baseNormalization.applied
          ? { baseNormalization: baseNormalization.reason }
          : {}),
      },
    };
  } catch (error_) {
    const fallback = applyStrengthComponentPromptGuidance(effectiveCompiledState, mask);
    return {
      compiledState: fallback.compiledState,
      promptGuidance: {
        ...fallback.promptGuidance,
        fallbackReason: 'component_strength_llm_director_failed',
        message: String(error_?.message || error_),
      },
    };
  }
}

function roundDimensionToMultiple(value, multiple = 64) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(multiple, Math.round(numeric / multiple) * multiple);
}

function clampRenderDimension(value, max = 2048) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(64, Math.min(max, roundDimensionToMultiple(numeric, 64)));
}

function fitRenderDimensions({
  width,
  height,
  fallbackWidth = 2048,
  fallbackHeight = 2048,
  minSide = 64,
  maxSide = 2048,
  maxPixels = maxSide * maxSide,
} = {}) {
  let resolvedWidth = Number(width);
  let resolvedHeight = Number(height);

  if (!Number.isFinite(resolvedWidth) || resolvedWidth <= 0) resolvedWidth = fallbackWidth;
  if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) resolvedHeight = fallbackHeight;

  resolvedWidth = Math.max(minSide, resolvedWidth);
  resolvedHeight = Math.max(minSide, resolvedHeight);

  let scale = 1;
  if (resolvedWidth > maxSide || resolvedHeight > maxSide) {
    scale = Math.min(scale, maxSide / resolvedWidth, maxSide / resolvedHeight);
  }
  if ((resolvedWidth * resolvedHeight) > maxPixels) {
    scale = Math.min(scale, Math.sqrt(maxPixels / Math.max(resolvedWidth * resolvedHeight, 1)));
  }

  if (scale < 1) {
    resolvedWidth *= scale;
    resolvedHeight *= scale;
  }

  resolvedWidth = clampRenderDimension(resolvedWidth, maxSide);
  resolvedHeight = clampRenderDimension(resolvedHeight, maxSide);

  let guard = 0;
  while ((resolvedWidth * resolvedHeight) > maxPixels && guard < 4) {
    const areaScale = Math.sqrt(maxPixels / Math.max(resolvedWidth * resolvedHeight, 1));
    if (!(areaScale > 0 && areaScale < 1)) break;
    const nextWidth = clampRenderDimension(resolvedWidth * areaScale, maxSide);
    const nextHeight = clampRenderDimension(resolvedHeight * areaScale, maxSide);
    if (nextWidth === resolvedWidth && nextHeight === resolvedHeight) break;
    resolvedWidth = nextWidth;
    resolvedHeight = nextHeight;
    guard += 1;
  }

  return {
    width: resolvedWidth,
    height: resolvedHeight,
  };
}

function promptMentionsExplicitCanvas(raw = '') {
  return /\b\d{3,4}\s*[xX]\s*\d{3,4}\b/.test(String(raw || '').trim());
}

function resolveWebDraftCanvasPlan(mask = {}, webImageDraft = {}, env = process.env) {
  const targetWidth = Number(webImageDraft?.targetWidth || 0);
  const targetHeight = Number(webImageDraft?.targetHeight || 0);
  const sourceWidth = Number(webImageDraft?.sourceWidth || webImageDraft?.width || 0);
  const sourceHeight = Number(webImageDraft?.sourceHeight || webImageDraft?.height || 0);
  if (Number.isFinite(targetWidth) && targetWidth > 0 && Number.isFinite(targetHeight) && targetHeight > 0) {
    return {
      source: 'web_init_image',
      reason: String(webImageDraft?.canvasReason || 'preserve_init_image_ratio').trim() || 'preserve_init_image_ratio',
      requestedWidth: sourceWidth || null,
      requestedHeight: sourceHeight || null,
      width: targetWidth,
      height: targetHeight,
    };
  }
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const imageConfig = typeof resolveImageDimensionConfig === 'function'
    ? resolveImageDimensionConfig(env)
    : { maxRenderSide: 2048 };
  const maxRenderSide = Number(imageConfig?.maxRenderSide || 2048) || 2048;
  const currentWidth = Number(mask?.options?.width || 0);
  const currentHeight = Number(mask?.options?.height || 0);
  const sourceLongestSide = Math.max(sourceWidth, sourceHeight, 1);
  const currentLongestSide = Math.max(currentWidth, currentHeight, 0);
  const preferredLongestSide = Number(process.env.A11_IMAGE_WEB_DRAFT_TARGET_SIDE || 1344) || 1344;
  const targetLongestSide = Math.min(
    maxRenderSide,
    Math.max(sourceLongestSide, currentLongestSide, preferredLongestSide)
  );
  const scale = targetLongestSide / sourceLongestSide;

  return {
    source: 'web_init_image',
    reason: 'preserve_init_image_ratio',
    requestedWidth: sourceWidth,
    requestedHeight: sourceHeight,
    width: clampRenderDimension(Math.max(64, Math.floor(sourceWidth * scale)), maxRenderSide),
    height: clampRenderDimension(Math.max(64, Math.floor(sourceHeight * scale)), maxRenderSide),
  };
}

function applyWebDraftCanvasToMask(mask = {}, webImageDraft = {}) {
  if (!webImageDraft || typeof webImageDraft !== 'object') return mask;
  if (promptMentionsExplicitCanvas(mask?.raw || '')) return mask;

  const canvasPlan = resolveWebDraftCanvasPlan(mask, webImageDraft, process.env);
  if (!canvasPlan) return mask;

  return {
    ...(mask && typeof mask === 'object' ? mask : {}),
    options: {
      ...((mask && mask.options && typeof mask.options === 'object') ? mask.options : {}),
      width: canvasPlan.width,
      height: canvasPlan.height,
    },
    meta: {
      ...((mask && mask.meta && typeof mask.meta === 'object') ? mask.meta : {}),
      renderSizing: {
        source: canvasPlan.source,
        reason: canvasPlan.reason,
        requestedWidth: canvasPlan.requestedWidth,
        requestedHeight: canvasPlan.requestedHeight,
        resolvedWidth: canvasPlan.width,
        resolvedHeight: canvasPlan.height,
        maxRenderSide: Number(resolveImageDimensionConfig(process.env)?.maxRenderSide || 2048) || 2048,
      },
    },
  };
}

function shouldRelaxWebInitFusionRetry(mask = {}, verification = {}) {
  const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
    ? mask.meta.webImageDraft
    : null;
  if (!webImageDraft) return false;

  const fusionDetected = verification?.observed?.fusion_detected === true
    || String(verification?.decision?.reason || '').trim() === 'fusion_detected';
  if (!fusionDetected) return false;

  return (
    webImageDraft.compositeRisk === true
    || (
      webImageDraft.explicitReferenceAnchor !== true
      && String(webImageDraft.reason || '').trim() === 'automatic_web_anchor'
    )
  );
}

function relaxVerificationForWebInit(mask = {}, verification = {}) {
  if (!verification || typeof verification !== 'object') return verification;
  if (!shouldRelaxWebInitFusionRetry(mask, verification)) return verification;

  return {
    ...verification,
    decision: {
      ...(verification.decision && typeof verification.decision === 'object' ? verification.decision : {}),
      retry: false,
      reason: 'fusion_detected_web_init_tolerated',
      notes: [
        String(verification?.decision?.notes || '').trim(),
        'web_init_relaxed=1',
      ].filter(Boolean).join(' ').trim(),
    },
    raw: {
      ...(verification.raw && typeof verification.raw === 'object' ? verification.raw : {}),
      fusion_retry_relaxed: true,
    },
  };
}

function getSharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = require('sharp');
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

function extractLatestUserMessage(body = {}) {
  if (typeof body?.message === 'string' && body.message.trim()) return body.message.trim();
  if (typeof body?.prompt === 'string' && body.prompt.trim()) return body.prompt.trim();

  if (Array.isArray(body?.messages)) {
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const entry = body.messages[index];
      if (String(entry?.role || '').trim().toLowerCase() !== 'user') continue;

      if (typeof entry?.content === 'string' && entry.content.trim()) {
        return entry.content.trim();
      }

      if (Array.isArray(entry?.content)) {
        const text = entry.content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
            return '';
          })
          .join(' ')
          .trim();
        if (text) return text;
      }
    }
  }

  return '';
}

function normalizeImageRequestModeValue(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'creative') return 'raw';
  if (raw === 'orchestrated' || raw === 'orchestrateur') return 'smart';
  if (['raw', 'smart', 'auto'].includes(raw)) return raw;
  return '';
}

function countImageSemanticFamilies(mask = {}) {
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  return (
    (Array.isArray(semantic?.accessories) ? semantic.accessories.length : 0)
    + (Array.isArray(semantic?.elements) ? semantic.elements.length : 0)
    + (Array.isArray(semantic?.metiers) ? semantic.metiers.length : 0)
    + (Array.isArray(semantic?.scenes) ? semantic.scenes.length : 0)
  );
}

function getImageSubjectProfileType(mask = {}) {
  const directType = String(mask?.meta?.subjectProfile?.type || '').trim();
  if (directType) return directType;
  return String(mask?.meta?.semantic?.subjectProfile?.type || '').trim();
}

function getImageAccessoryFamilies(mask = {}) {
  const accessories = Array.isArray(mask?.meta?.semantic?.accessories)
    ? mask.meta.semantic.accessories
    : [];
  return new Set(
    accessories
      .map((entry) => String(entry?.family || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function isModelSensitiveImageProfile(profileType = '') {
  return [
    'reference_character',
    'single_human_figure',
    'pokemon_creature',
    'mythic_creature',
    'phoenix_creature',
  ].includes(String(profileType || '').trim());
}

function looksLikeNamedReferenceSubject(mask = {}) {
  const subject = String(
    mask?.meta?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.imageEntityContext?.canonicalSubject
    || (Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject[0] : '')
    || ''
  ).trim();
  if (!subject) return false;

  const tokens = subject.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  if (/\b(avec|dans|sur|sous|devant|derriere|derrière|marchant|courant|fumant|style|background|fond)\b/i.test(subject)) {
    return false;
  }

  const capitalizedCount = tokens.filter((token) => /^[A-ZÀ-Ý0-9]/.test(token)).length;
  return capitalizedCount >= 2;
}

function inferAutoImageRequestMode(rawMask = {}) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const rawText = String(mask?.raw || '').trim();
  const normalizedText = rawText.toLowerCase();
  const tokenCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const subjectProfileType = getImageSubjectProfileType(mask);
  const namedReferenceSubject = looksLikeNamedReferenceSubject(mask);
  const accessoryFamilies = getImageAccessoryFamilies(mask);
  const hasPair = Boolean(compileCharacterCountConstraints(rawText));
  const hasInitImage = Boolean(
    String(mask?.meta?.webImageDraft?.initImageUrl || mask?.meta?.webImageDraft?.initImagePath || '').trim()
    || String(mask?.meta?.reference_image_url || mask?.meta?.init_image_url || '').trim()
  );
  const hasWorkflowSignal = /\b(web|internet|cherche|recherche|reference|référence|variation|variante|version|corrige|corriger|ameliore|améliore|retravaille|retouche|upscale|memoire|mémoire|workflow|plusieurs etapes|plusieurs étapes|edition|édition|edit)\b/i.test(rawText);
  const hasRichPromptState = Boolean(
    (mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object')
    || (mask?.meta?.imageEntityContext && typeof mask.meta.imageEntityContext === 'object')
    || (Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 3)
    || countImageSemanticFamilies(mask) >= 3
  );
  const hasSceneAttachment = /\b(avec|with|dans|in|sur|on|sous|under|tenant|holding|portant|wearing|carrying|en train de|devant|in front of|derriere|derrière|behind|next to|beside|inside)\b/i.test(rawText);
  const hasPromptInstructionHints = Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 0;
  const hasHumanFigureAccessory = (
    ['reference_character', 'single_human_figure'].includes(subjectProfileType)
    && ['wearable', 'weapon', 'smoking_prop'].some((family) => accessoryFamilies.has(family))
  );
  const hasAccessoryAttachmentVariation = (
    hasSceneAttachment
    && (
      accessoryFamilies.size > 0
      || hasPromptInstructionHints
    )
  );
  const hasNamedCharacterVariation = (
    subjectProfileType === 'reference_character'
    && (hasSceneAttachment || accessoryFamilies.size > 0 || tokenCount >= 5)
  );

  if (hasInitImage || hasWorkflowSignal || hasPair) {
    return {
      mode: 'smart',
      reason: hasInitImage ? 'init_image_requested' : (hasPair ? 'multiple_subjects_requested' : 'workflow_signal'),
      explicit: false,
    };
  }

  if (hasNamedCharacterVariation || hasHumanFigureAccessory || hasAccessoryAttachmentVariation) {
    return {
      mode: 'smart',
      reason: hasNamedCharacterVariation
        ? 'reference_character_variation'
        : (hasHumanFigureAccessory ? 'human_figure_accessory_variation' : 'accessory_attachment_variation'),
      explicit: false,
    };
  }

  if (namedReferenceSubject) {
    return {
      mode: 'smart',
      reason: 'named_reference_subject',
      explicit: false,
    };
  }

  if (isModelSensitiveImageProfile(subjectProfileType)) {
    return {
      mode: 'smart',
      reason: 'model_sensitive_profile',
      explicit: false,
    };
  }

  if (hasRichPromptState) {
    return {
      mode: 'smart',
      reason: 'rich_prompt_state',
      explicit: false,
    };
  }

  if (tokenCount <= 16 && !hasSceneAttachment) {
    return {
      mode: 'raw',
      reason: 'simple_single_subject_prompt',
      explicit: false,
    };
  }

  return {
    mode: 'raw',
    reason: 'default_raw',
    explicit: false,
  };
}

function resolveImageRequestMode({ rawMask = {}, req = null, explicitMode = '' } = {}) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const reqMode = normalizeImageRequestModeValue(
    explicitMode
    || req?.body?.mode
    || req?.body?.image_mode
    || ''
  );
  const maskMode = normalizeImageRequestModeValue(
    mask?.meta?.imageRequestMode
    || mask?.meta?.imagePipelineMode
    || ''
  );
  const envMode = normalizeImageRequestModeValue(process.env.A11_IMAGE_PIPELINE_MODE || '');
  const selected = reqMode || maskMode || envMode;
  if (selected === 'raw' || selected === 'smart') {
    return {
      mode: selected,
      reason: `${selected}_explicit`,
      explicit: true,
    };
  }

  return inferAutoImageRequestMode(mask);
}

function buildSdRequestBody(mask, compiledPayload) {
  const payload = compiledPayload && typeof compiledPayload === 'object'
    ? compiledPayload
    : {};
  const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
    ? mask.meta.webImageDraft
    : {};
  const initImage = String(
    payload.init_image
    || payload.initImage
    || payload.init_image_url
    || payload.initImageUrl
    || webImageDraft.initImagePath
    || webImageDraft.initImageUrl
    || ''
  ).trim();
  const strength = payload.strength !== undefined
    ? Number(payload.strength)
    : Number(webImageDraft.strength);
  const faceProtectionNegativeHints = Array.isArray(webImageDraft?.faceProtectionNegativeHints)
    ? webImageDraft.faceProtectionNegativeHints
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    : [];
  const prompt2 = String(payload.prompt_2 || payload.prompt2 || '').trim();
  const prompt3 = String(payload.prompt_3 || payload.prompt3 || '').trim();
  const negativePrompt2 = String(payload.negative_prompt_2 || payload.negativePrompt2 || '').trim();
  const negativePrompt3 = String(payload.negative_prompt_3 || payload.negativePrompt3 || '').trim();
  const renderSizing = mask?.meta?.renderSizing && typeof mask.meta.renderSizing === 'object'
    ? mask.meta.renderSizing
    : null;
  const preferMaskCanvas = String(renderSizing?.source || '').trim() === 'web_init_image';
  const requestedWidth = Number(
    preferMaskCanvas
      ? (mask?.options?.width || payload.width)
      : (payload.width || mask?.options?.width)
  );
  const requestedHeight = Number(
    preferMaskCanvas
      ? (mask?.options?.height || payload.height)
      : (payload.height || mask?.options?.height)
  );
  const renderLimits = typeof resolveSdLocalRenderLimits === 'function'
    ? resolveSdLocalRenderLimits({
      env: process.env,
      width: requestedWidth,
      height: requestedHeight,
    })
    : {
      minSide: 64,
      maxSide: Number(process.env.A11_IMAGE_MAX_SIZE || 2048),
      maxPixels: Number(process.env.A11_IMAGE_MAX_PIXELS || (Number(process.env.A11_IMAGE_MAX_SIZE || 2048) ** 2)),
      policy: 'default',
      profile: null,
    };
  const IMAGE_MAX_SIZE = Number(renderLimits.maxSide || 2048) || 2048;
  const IMAGE_MIN_SIZE = Number(renderLimits.minSide || 64) || 64;
  const IMAGE_MAX_PIXELS = Number(renderLimits.maxPixels || (IMAGE_MAX_SIZE * IMAGE_MAX_SIZE)) || (IMAGE_MAX_SIZE * IMAGE_MAX_SIZE);
  const fittedDimensions = fitRenderDimensions({
    width: requestedWidth,
    height: requestedHeight,
    fallbackWidth: IMAGE_MAX_SIZE,
    fallbackHeight: IMAGE_MAX_SIZE,
    minSide: IMAGE_MIN_SIZE,
    maxSide: IMAGE_MAX_SIZE,
    maxPixels: IMAGE_MAX_PIXELS,
  });
  const width = fittedDimensions.width;
  const height = fittedDimensions.height;
  if (requestedWidth !== undefined && width !== requestedWidth) {
    console.warn(`[A11][image-chat-runtime] width requested=${requestedWidth} effective=${width} (fit)`);
  }
  if (requestedHeight !== undefined && height !== requestedHeight) {
    console.warn(`[A11][image-chat-runtime] height requested=${requestedHeight} effective=${height} (fit)`);
  }
  if (renderLimits.policy && renderLimits.policy !== 'default') {
    console.warn(
      `[A11][image-chat-runtime] applying size guard policy=${renderLimits.policy}`
      + ` profile=${renderLimits.profile || 'unknown'}`
      + ` max_side=${IMAGE_MAX_SIZE}`
      + ` max_pixels=${IMAGE_MAX_PIXELS}`
    );
  }
  return {
    prompt: String(payload.prompt || mask?.raw || '').trim(),
    prompt_prebuilt: true,
    ...(prompt2 ? { prompt_2: prompt2, prompt_2_prebuilt: true } : {}),
    ...(prompt3 ? { prompt_3: prompt3, prompt_3_prebuilt: true } : {}),
    ...(payload.prompt_language ? { prompt_language: String(payload.prompt_language).trim() } : {}),
    ...((() => {
      const baseNegativePrompt = String(payload.negative_prompt || '').trim();
      const mergedNegativePrompt = [...new Set([
        ...baseNegativePrompt.split(',').map((entry) => String(entry || '').trim()).filter(Boolean),
        ...faceProtectionNegativeHints,
      ])].join(', ').trim();
      const negativePayload = {
        ...(mergedNegativePrompt
          ? {
              negative_prompt: mergedNegativePrompt,
              negative_prompt_prebuilt: true,
            }
          : {}),
        ...(negativePrompt2 ? { negative_prompt_2: negativePrompt2, negative_prompt_2_prebuilt: true } : {}),
        ...(negativePrompt3 ? { negative_prompt_3: negativePrompt3, negative_prompt_3_prebuilt: true } : {}),
      };
      return negativePayload;
    })()),
    width,
    height,
    num_inference_steps: Number(payload.steps || mask?.options?.steps || 30),
    guidance_scale: Number(payload.guidance_scale || mask?.options?.guidance_scale || 7.5),
    ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
    ...(payload.sampler ? { sampler: payload.sampler } : {}),
    ...(initImage ? { init_image_url: initImage } : {}),
    ...(Number.isFinite(strength) ? { strength } : {}),
    ...(renderSizing ? {
      size_source: renderSizing.source,
      size_reason: renderSizing.reason,
      requested_width: renderSizing.requestedWidth,
      requested_height: renderSizing.requestedHeight,
    } : {}),
  };
}

function resolveSdImg2ImgDraftFields(mask, payload = {}) {
  const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
    ? mask.meta.webImageDraft
    : {};
  const initImage = String(
    payload?.init_image
    || payload?.initImage
    || payload?.init_image_url
    || payload?.initImageUrl
    || webImageDraft.initImagePath
    || webImageDraft.initImageUrl
    || ''
  ).trim();
  const rawStrength = payload?.strength !== undefined
    ? payload.strength
    : webImageDraft.strength;
  const normalizedRawStrength = String(rawStrength ?? '').trim().toLowerCase();
  const hasManualStrengthOverride = (
    rawStrength !== undefined
    && rawStrength !== null
    && normalizedRawStrength !== ''
    && normalizedRawStrength !== 'auto'
    && Number.isFinite(Number(rawStrength))
  );
  const strengthProfile = String(
    webImageDraft.strengthProfile
    || webImageDraft.strength_profile
    || payload?.strength_profile
    || payload?.strengthProfile
    || ''
  ).trim();
  const strengthReason = String(
    webImageDraft.strengthReason
    || webImageDraft.strength_reason
    || webImageDraft.strengthRationale
    || payload?.strength_reason
    || payload?.strengthReason
    || ''
  ).trim();
  const strengthValue = Number(
    webImageDraft.strengthValue
    || webImageDraft.strength_value
    || payload?.strength_value
    || payload?.strengthValue
  );
  const strengthComponents = (
    webImageDraft.strengthComponents
    || webImageDraft.strength_components
    || payload?.strength_components
    || payload?.strengthComponents
    || null
  );
  const strengthComponentStrengths = (
    webImageDraft.strengthComponentStrengths
    || webImageDraft.strength_component_strengths
    || payload?.strength_component_strengths
    || payload?.strengthComponentStrengths
    || null
  );
  const strengthComponentProfiles = (
    webImageDraft.strengthComponentProfiles
    || webImageDraft.strength_component_profiles
    || payload?.strength_component_profiles
    || payload?.strengthComponentProfiles
    || null
  );
  const strengthComponentReasons = (
    webImageDraft.strengthComponentReasons
    || webImageDraft.strength_component_reasons
    || payload?.strength_component_reasons
    || payload?.strengthComponentReasons
    || null
  );
  const normalizedStrength = hasManualStrengthOverride
    ? Number(rawStrength)
    : 'auto';

  return {
    ...(initImage ? { init_image_url: initImage } : {}),
    ...(initImage ? {
      strength: normalizedStrength,
    } : {}),
    ...(initImage && strengthProfile ? { strength_profile: strengthProfile } : {}),
    ...(initImage && strengthReason ? { strength_reason: strengthReason } : {}),
    ...(initImage && hasManualStrengthOverride && Number.isFinite(strengthValue) ? { strength_value: strengthValue } : {}),
    ...(initImage && strengthComponents && typeof strengthComponents === 'object' ? { strength_components: strengthComponents } : {}),
    ...(initImage && strengthComponentStrengths && typeof strengthComponentStrengths === 'object' ? { strength_component_strengths: strengthComponentStrengths } : {}),
    ...(initImage && strengthComponentProfiles && typeof strengthComponentProfiles === 'object' ? { strength_component_profiles: strengthComponentProfiles } : {}),
    ...(initImage && strengthComponentReasons && typeof strengthComponentReasons === 'object' ? { strength_component_reasons: strengthComponentReasons } : {}),
  };
}

function buildTechniqueSdPayloadFromCompiledState(compiledState = {}) {
  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
    : {};

  return {
    prompt: String(sdBody.prompt || '').trim(),
    ...(sdBody.prompt_language ? { prompt_language: String(sdBody.prompt_language).trim() } : {}),
    ...(sdBody.negative_prompt ? { negative_prompt: String(sdBody.negative_prompt).trim() } : {}),
    ...(sdBody.prompt_2 ? { prompt_2: String(sdBody.prompt_2).trim() } : {}),
    ...(sdBody.prompt_3 ? { prompt_3: String(sdBody.prompt_3).trim() } : {}),
    ...(sdBody.negative_prompt_2 ? { negative_prompt_2: String(sdBody.negative_prompt_2).trim() } : {}),
    ...(sdBody.negative_prompt_3 ? { negative_prompt_3: String(sdBody.negative_prompt_3).trim() } : {}),
    ...(sdBody.width ? { width: Number(sdBody.width) } : {}),
    ...(sdBody.height ? { height: Number(sdBody.height) } : {}),
    ...(sdBody.num_inference_steps ? { steps: Number(sdBody.num_inference_steps) } : {}),
    ...(sdBody.guidance_scale !== undefined ? { guidance_scale: Number(sdBody.guidance_scale) } : {}),
    ...(sdBody.seed !== undefined ? { seed: sdBody.seed } : {}),
    ...(sdBody.sampler ? { sampler: sdBody.sampler } : {}),
    ...(sdBody.strength_components && typeof sdBody.strength_components === 'object' ? { strength_components: sdBody.strength_components } : {}),
    ...(sdBody.strength_component_strengths && typeof sdBody.strength_component_strengths === 'object' ? { strength_component_strengths: sdBody.strength_component_strengths } : {}),
    ...(sdBody.strength_component_profiles && typeof sdBody.strength_component_profiles === 'object' ? { strength_component_profiles: sdBody.strength_component_profiles } : {}),
    ...(sdBody.strength_component_reasons && typeof sdBody.strength_component_reasons === 'object' ? { strength_component_reasons: sdBody.strength_component_reasons } : {}),
  };
}

async function reconcileCompiledImageTechnique(compiledState = {}, {
  selection = null,
  resolveImageWebDraft,
  webHintContext = null,
  callStructuredLlmJson = null,
  finalPromptDirectorEnabled,
} = {}) {
  const baseMask = compiledState?.mask && typeof compiledState.mask === 'object'
    ? compiledState.mask
    : {};
  const finalPrompt = normalizeText(compiledState?.sdBody?.prompt || '');
  const nextMask = {
    ...baseMask,
    meta: {
      ...((baseMask.meta && typeof baseMask.meta === 'object') ? baseMask.meta : {}),
      ...(finalPrompt ? { techniqueAnalysisPrompt: finalPrompt } : {}),
    },
  };

  if (!finalPrompt) {
    return {
      compiledState: {
        ...compiledState,
        mask: nextMask,
      },
      techniqueReconciler: {
        applied: false,
        reason: 'missing_final_prompt',
      },
    };
  }

  let effectiveDraft = nextMask?.meta?.webImageDraft && typeof nextMask.meta.webImageDraft === 'object'
    ? nextMask.meta.webImageDraft
    : null;

  if (
    typeof resolveImageWebDraft === 'function'
    && webHintContext
    && typeof webHintContext === 'object'
    && (
      !effectiveDraft
      || String(effectiveDraft?.mode || '').trim() === 'web-image-draft'
    )
  ) {
    try {
      const lateResolvedDraft = await resolveImageWebDraft({
        mask: nextMask,
        selection,
        webHintContext,
      });
      if (lateResolvedDraft && typeof lateResolvedDraft === 'object') {
        effectiveDraft = lateResolvedDraft;
      }
    } catch {
      // ignore late draft refresh failures and keep the existing technique
    }
  }

  let techniqueMask = nextMask;
  let reconcileReason = 'analysis_prompt_only';
  if (effectiveDraft && typeof effectiveDraft === 'object') {
    const enrichedDraft = await enrichImg2ImgDraft({
      webImageDraft: effectiveDraft,
      mask: nextMask,
    });
    techniqueMask = applyWebDraftCanvasToMask({
      ...nextMask,
      meta: {
        ...(nextMask.meta && typeof nextMask.meta === 'object' ? nextMask.meta : {}),
        webImageDraft: enrichedDraft,
      },
    }, enrichedDraft);
    reconcileReason = 'late_web_draft_reconciled';
  }

  const rebuiltPayload = buildTechniqueSdPayloadFromCompiledState(compiledState);
  const rebuiltSdBody = {
    ...buildSdRequestBody(techniqueMask, rebuiltPayload),
    ...resolveSdImg2ImgDraftFields(techniqueMask, {
      ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object'
        ? compiledState.compiledPayload
        : {}),
      ...rebuiltPayload,
    }),
  };
  const promptGuided = await directStrengthComponentPromptGuidance({
    ...compiledState,
    mask: techniqueMask,
    compiledPayload: {
      ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object' ? compiledState.compiledPayload : {}),
      ...rebuiltPayload,
      ...(rebuiltSdBody?.prompt ? { prompt: rebuiltSdBody.prompt } : {}),
      ...(rebuiltSdBody?.negative_prompt ? { negative_prompt: rebuiltSdBody.negative_prompt } : {}),
      ...(rebuiltSdBody?.strength_components && typeof rebuiltSdBody.strength_components === 'object'
        ? { strength_components: rebuiltSdBody.strength_components }
        : {}),
    },
    sdBody: rebuiltSdBody,
  }, techniqueMask, {
    callStructuredLlmJson,
    finalPromptDirectorEnabled,
  });

  return {
    compiledState: {
      ...compiledState,
      ...promptGuided.compiledState,
      mask: techniqueMask,
      sdBody: {
        ...(compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {}),
        ...rebuiltSdBody,
        ...((promptGuided.compiledState?.sdBody && typeof promptGuided.compiledState.sdBody === 'object')
          ? promptGuided.compiledState.sdBody
          : {}),
      },
    },
    techniqueReconciler: {
      applied: true,
      reason: reconcileReason,
      promptGuidance: promptGuided.promptGuidance,
    },
  };
}

function buildImagePromptRefinerSystemPrompt() {
  const languageInstruction = 'english only';

  return `Je suis un réécrivain final de prompt Stable Diffusion pour A11.
Je reçois une demande image riche avec beaucoup de contexte interne.
Ma mission est de produire un prompt FINAL propre, cohérent, complet et exploitable pour le générateur d'image.

Règles strictes :
- conserver exactement le sujet principal, le nombre de sujets, la relation entre eux, les couleurs importantes, le style demandé et les contraintes essentielles
- ne jamais ajouter un nouveau personnage, un nouvel objet principal, une nouvelle action ou un nouveau décor important
- supprimer biographies, contexte encyclopédique, redondances, répétitions, formulations bavardes et méta-instructions
- je ne suis pas un résumeur: ne jamais condenser, raccourcir, lisser ou simplifier agressivement une demande riche
- si le prompt courant est deja dense et precis, ne pas le resumer brutalement
- si la raw_request contient plus de détails concrets que le current_prompt, les réintégrer proprement dans le prompt final
- préserver tous les détails visuels concrets utiles: identité, visage, corpulence, posture, cadrage, tenue, accessoires, décor, éclairage, palette, ambiance et contraintes négatives utiles
- préserver les détails visuels concrets, les éléments de décor, les accessoires, les effets et les contraintes de cadrage réellement utiles
- si janus_reference_analysis est présent, préserver ses objets, personnages, anatomie, latéralité, relations spatiales et coordonnées utiles
- produire un prompt positif fluide, orienté rendu image, de longueur adaptée au besoin réel, sans perte d information
- produire aussi un negative prompt propre et utile
- pour les champs prompt et negative_prompt, utiliser strictement l anglais naturel: ${languageInstruction}
- ne jamais melanger francais et anglais dans le meme prompt

Je réponds uniquement en JSON strict :
{
  "prompt": "prompt final",
  "negative_prompt": "negative prompt final"
}`;
}

function resolveImagePromptRefinerEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = String(process.env.A11_IMAGE_PROMPT_REFINER || '').trim().toLowerCase();
  if (!envValue) return true;
  if (['0', 'false', 'no', 'off'].includes(envValue)) return false;
  if (['1', 'true', 'yes', 'on'].includes(envValue)) return true;
  return true;
}

function shouldRefineCompiledImagePrompt(compiledState = {}, options = {}) {
  if (!resolveImagePromptRefinerEnabled(options.imagePromptRefinerEnabled)) return false;
  if (typeof options.callStructuredLlmJson !== 'function') return false;
  if (String(compiledState?.imageRequestMode?.mode || '').trim().toLowerCase() === 'raw') return false;

  const prompt = normalizeSdPromptRewriteText(compiledState?.sdBody?.prompt || '');
  const negativePrompt = normalizeSdPromptRewriteText(compiledState?.sdBody?.negative_prompt || '');
  if (!prompt) return false;
  if (String(compiledState?.sdBody?.prompt_2 || compiledState?.sdBody?.prompt2 || '').trim()) return false;
  if (String(compiledState?.sdBody?.prompt_3 || compiledState?.sdBody?.prompt3 || '').trim()) return false;
  const promptCanonical = isUsableEnglishPromptText(prompt, { allowUnknown: true });
  const negativeCanonical = !negativePrompt || isUsableEnglishPromptText(negativePrompt, { allowUnknown: true });
  if (promptCanonical && negativeCanonical) return false;
  const hasReferenceInitImage = Boolean(String(
    compiledState?.mask?.meta?.webImageDraft?.initImageUrl
    || compiledState?.mask?.meta?.webImageDraft?.initImagePath
    || compiledState?.mask?.meta?.reference_image_url
    || compiledState?.mask?.meta?.init_image_url
    || compiledState?.sdBody?.init_image_url
    || ''
  ).trim());
  const needsEnglishRewrite = !isUsableEnglishPromptText(prompt, { allowUnknown: true });
  if (isRichFinalImagePrompt(prompt, negativePrompt) && !(hasReferenceInitImage && needsEnglishRewrite)) {
    return false;
  }

  return (
    prompt.length >= 160
    || (hasReferenceInitImage && needsEnglishRewrite)
    || compiledState?.specialCompiler?.selection?.candidate === true
    || (Array.isArray(compiledState?.mask?.meta?.promptInstructions) && compiledState.mask.meta.promptInstructions.length > 2)
    || Boolean(compiledState?.mask?.meta?.imageScratchpad)
    || Boolean(compiledState?.mask?.meta?.definitionLookup)
    || Boolean(compiledState?.mask?.meta?.webReferencePack)
    || Boolean(compiledState?.imageRequestDirector)
  );
}

function compactJanusReferenceEntity(entry = {}, nested = false) {
  if (!entry || typeof entry !== 'object') return null;
  const compact = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const text = normalizeText(value);
      if (text) compact[key] = text;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      compact[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length <= 0) continue;
      if (value.every((item) => typeof item === 'number')) {
        compact[key] = value.slice(0, 4);
        continue;
      }
      if (nested) {
        compact[key] = value
          .map((item) => normalizeText(item))
          .filter(Boolean)
          .slice(0, 6);
        continue;
      }
      compact[key] = value
        .map((item) => (item && typeof item === 'object'
          ? compactJanusReferenceEntity(item, true)
          : normalizeText(item)))
        .filter(Boolean)
        .slice(0, 8);
    }
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function buildJanusReferenceAnalysisContext(mask = {}) {
  const meta = mask?.meta && typeof mask.meta === 'object' ? mask.meta : {};
  const manifests = Array.isArray(meta.imageReferenceManifests)
    ? meta.imageReferenceManifests
        .map((manifest) => {
          if (!manifest || typeof manifest !== 'object') return null;
          const compact = {
            image_id: normalizeText(manifest.image_id || manifest.imageId || ''),
            probable_role: normalizeText(manifest.probable_role || manifest.probableRole || ''),
            confidence: Number(manifest.confidence || 0) || 0,
            detected_content: normalizeText(manifest.detected_content || manifest.detectedContent || ''),
            quality_flags: Array.isArray(manifest.quality_flags || manifest.qualityFlags)
              ? (manifest.quality_flags || manifest.qualityFlags).map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
              : [],
            objects: Array.isArray(manifest.objects)
              ? manifest.objects.map((entry) => compactJanusReferenceEntity(entry)).filter(Boolean).slice(0, 8)
              : [],
            characters: Array.isArray(manifest.characters)
              ? manifest.characters.map((entry) => compactJanusReferenceEntity(entry)).filter(Boolean).slice(0, 4)
              : [],
            anatomy: Array.isArray(manifest.anatomy)
              ? manifest.anatomy.map((entry) => compactJanusReferenceEntity(entry)).filter(Boolean).slice(0, 8)
              : [],
            relationships: Array.isArray(manifest.relationships)
              ? manifest.relationships.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
              : [],
          };
          if (!compact.image_id && !compact.detected_content) return null;
          return compact;
        })
        .filter(Boolean)
        .slice(0, 6)
    : [];
  const decision = meta.imageReferenceDecision && typeof meta.imageReferenceDecision === 'object'
    ? {
        primary_image_id: normalizeText(meta.imageReferenceDecision.primaryImageId || meta.imageReferenceDecision.primary_image_id || ''),
        primary_role: normalizeText(meta.imageReferenceDecision.primaryRole || meta.imageReferenceDecision.primary_role || ''),
        primary_confidence: Number(meta.imageReferenceDecision.primaryConfidence || meta.imageReferenceDecision.primary_confidence || 0) || 0,
        selection_mode: normalizeText(meta.imageReferenceDecision.selectionMode || meta.imageReferenceDecision.selection_mode || ''),
        decision_source: normalizeText(meta.imageReferenceDecision.decisionSource || meta.imageReferenceDecision.decision_source || ''),
      }
    : null;
  if (!manifests.length && !decision) return null;
  return {
    role: 'janus_source_image_spatial_analysis',
    instruction: 'Preserve concrete visible facts, laterality, spatial placement, and coordinates from this analysis; do not invent hidden details.',
    decision,
    manifests,
  };
}

function buildImagePromptRefinerSourceContext(compiledState = {}) {
  const mask = compiledState?.mask || {};
  const janusReferenceAnalysis = buildJanusReferenceAnalysisContext(mask);
  return {
    target_language: SD_PROMPT_OUTPUT_LABEL,
    raw_request: resolveAuthoritativeRawRequest(mask),
    current_prompt: normalizeText(compiledState?.sdBody?.prompt || ''),
    current_negative_prompt: normalizeText(compiledState?.sdBody?.negative_prompt || ''),
    subject: Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : [],
    environment: Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : [],
    style: Array.isArray(mask?.inputs?.style) ? mask.inputs.style : [],
    composition: Array.isArray(mask?.inputs?.composition) ? mask.inputs.composition : [],
    lighting: Array.isArray(mask?.inputs?.lighting) ? mask.inputs.lighting : [],
    palette: Array.isArray(mask?.inputs?.palette) ? mask.inputs.palette : [],
    prompt_instructions: Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions.slice(0, 12) : [],
    ...(janusReferenceAnalysis ? { janus_reference_analysis: janusReferenceAnalysis } : {}),
    subject_profile_type: String(mask?.meta?.subjectProfile?.type || '').trim(),
    canonical_subject: String(mask?.meta?.canonicalSubject || mask?.meta?.imageScratchpad?.canonicalSubject || '').trim(),
    universe: String(mask?.meta?.imageScratchpad?.universe || '').trim(),
    reference_init_image: String(
      mask?.meta?.webImageDraft?.initImageUrl
      || mask?.meta?.webImageDraft?.initImagePath
      || mask?.meta?.reference_image_url
      || mask?.meta?.init_image_url
      || ''
    ).trim(),
    web_reference_pack: mask?.meta?.webReferencePack && typeof mask.meta.webReferencePack === 'object'
      ? {
          subject: String(mask.meta.webReferencePack.subject || '').trim(),
          universe: String(mask.meta.webReferencePack.universe || '').trim(),
          summary_facts: Array.isArray(mask.meta.webReferencePack.summaryFacts)
            ? mask.meta.webReferencePack.summaryFacts.slice(0, 6)
            : [],
          references: Array.isArray(mask.meta.webReferencePack.references)
            ? mask.meta.webReferencePack.references.slice(0, 6).map((entry) => ({
                role: String(entry?.role || '').trim(),
                label: String(entry?.label || '').trim(),
                family: String(entry?.family || '').trim(),
                placement: String(entry?.placement || '').trim(),
                query: String(entry?.query || '').trim(),
                title: String(entry?.title || '').trim(),
                source_domain: String(entry?.sourceDomain || '').trim(),
              }))
            : [],
        }
      : null,
  };
}

function buildImagePromptRefinerInput(context = {}) {
  return JSON.stringify(normalizePromptContextShape(context), null, 2);
}

async function refineCompiledImagePromptWithLlm(compiledState = {}, options = {}) {
  if (!shouldRefineCompiledImagePrompt(compiledState, options)) {
    return {
      compiledState,
      promptRefiner: {
        applied: false,
        reason: 'disabled_or_not_needed',
      },
    };
  }

  try {
    const englishContext = await translatePromptContextToEnglish(
      buildImagePromptRefinerSourceContext(compiledState),
      { callStructuredLlmJson: options.callStructuredLlmJson }
    );
    const promotedFallbackState = buildEnglishPromptOverrideCompiledState(compiledState, {
      prompt: englishContext?.current_prompt || '',
      negativePrompt: englishContext?.current_negative_prompt || compiledState?.sdBody?.negative_prompt || '',
    });
    const compressionReferencePrompt = pickMostDetailedPromptText([
      englishContext?.raw_request,
      englishContext?.current_prompt,
      compiledState?.sdBody?.prompt,
    ]);
    const response = await options.callStructuredLlmJson({
      text: buildImagePromptRefinerInput(englishContext),
      systemPrompt: buildImagePromptRefinerSystemPrompt(),
      temperature: 0.1,
      maxTokens: resolvePromptRewriteMaxTokens([
        englishContext?.raw_request,
        englishContext?.current_prompt,
        englishContext?.current_negative_prompt,
      ], {
        floor: 900,
        ceiling: 1800,
        base: 420,
      }),
      timeoutMs: Number(process.env.A11_IMAGE_PROMPT_REFINER_TIMEOUT_MS || 10000),
    });

    const nextPrompt = normalizeSdPromptRewriteText(response?.prompt || '');
    const nextNegativePrompt = normalizeSdPromptRewriteText(response?.negative_prompt || '');

    if (!nextPrompt) {
      return {
        compiledState: promotedFallbackState || compiledState,
        promptRefiner: {
          applied: Boolean(promotedFallbackState),
          reason: promotedFallbackState ? 'promoted_translated_raw_request' : 'empty_response',
        },
      };
    }
    if (!isUsableEnglishPromptText(nextPrompt, { allowUnknown: true })) {
      return {
        compiledState: promotedFallbackState || compiledState,
        promptRefiner: {
          applied: Boolean(promotedFallbackState),
          reason: promotedFallbackState ? 'promoted_translated_raw_request' : 'non_english_response',
        },
      };
    }
    if (nextNegativePrompt && !isUsableEnglishPromptText(nextNegativePrompt, { allowUnknown: true })) {
      return {
        compiledState: promotedFallbackState || compiledState,
        promptRefiner: {
          applied: Boolean(promotedFallbackState),
          reason: promotedFallbackState ? 'promoted_translated_raw_request' : 'non_english_negative_response',
        },
      };
    }
    if (isOvercompressedPromptRewrite({
      currentPrompt: compressionReferencePrompt || compiledState?.sdBody?.prompt || '',
      currentNegativePrompt: englishContext?.current_negative_prompt || compiledState?.sdBody?.negative_prompt || '',
      nextPrompt,
      nextNegativePrompt,
    })) {
      return {
        compiledState: promotedFallbackState || compiledState,
        promptRefiner: {
          applied: Boolean(promotedFallbackState),
          reason: promotedFallbackState ? 'promoted_translated_raw_request' : 'overcompressed_response',
        },
      };
    }

    const nextCompiledState = {
      ...compiledState,
      compiledPayload: {
        ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object' ? compiledState.compiledPayload : {}),
        prompt: nextPrompt,
        prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
        ...(nextNegativePrompt
          ? { negative_prompt: nextNegativePrompt }
          : {}),
      },
      compiled: (
        compiledState?.compiled && typeof compiledState.compiled === 'object'
          ? {
              ...compiledState.compiled,
              prompt: nextPrompt,
              prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
              ...(nextNegativePrompt
                ? { negative_prompt: nextNegativePrompt }
                : {}),
            }
          : compiledState.compiled
      ),
      sdBody: {
        ...(compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {}),
        prompt: nextPrompt,
        prompt_language: SD_PROMPT_OUTPUT_LANGUAGE,
        ...(nextNegativePrompt
          ? { negative_prompt: nextNegativePrompt }
          : {}),
      },
    };

    return {
      compiledState: nextCompiledState,
      promptRefiner: {
        applied: true,
        reason: 'llm_refined',
        originalPrompt: String(compiledState?.sdBody?.prompt || '').trim(),
        refinedPrompt: nextPrompt,
        refinedNegativePrompt: nextNegativePrompt || String(compiledState?.sdBody?.negative_prompt || '').trim(),
      },
    };
  } catch (error_) {
    return {
      compiledState,
      promptRefiner: {
        applied: false,
        reason: 'llm_refine_failed',
        message: String(error_?.message || error_),
      },
    };
  }
}

function compileMaskImageGenerate(rawMask) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const validation = validateMaskImageGenerate(mask);
  if (!validation.valid) {
    const error = new Error('invalid_mask');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'invalid_mask',
      details: validation.errors,
      mask,
    };
    throw error;
  }

  const compilerTarget = String(mask?.compiler?.target || 'image-prompt-en').trim() || 'image-prompt-en';
  const compiledPayload = compilerTarget === 'sd-payload'
    ? compileMaskToSD(mask)
    : compileMaskToImagePrompt(mask);
  const compiled = adaptMaskToFreelandValue(mask, compiledPayload);
  // Aligner width/height sur la politique globale
  const requestedWidth = Number(compiledPayload?.width || mask?.options?.width);
  const requestedHeight = Number(compiledPayload?.height || mask?.options?.height);
  const renderLimits = typeof resolveSdLocalRenderLimits === 'function'
    ? resolveSdLocalRenderLimits({
      env: process.env,
      width: requestedWidth,
      height: requestedHeight,
    })
    : {
      minSide: 64,
      maxSide: Number(process.env.A11_IMAGE_MAX_SIZE || 2048),
      maxPixels: Number(process.env.A11_IMAGE_MAX_PIXELS || (Number(process.env.A11_IMAGE_MAX_SIZE || 2048) ** 2)),
      policy: 'default',
      profile: null,
    };
  const IMAGE_MAX_SIZE = Number(renderLimits.maxSide || 2048) || 2048;
  const IMAGE_MIN_SIZE = Number(renderLimits.minSide || 64) || 64;
  const IMAGE_MAX_PIXELS = Number(renderLimits.maxPixels || (IMAGE_MAX_SIZE * IMAGE_MAX_SIZE)) || (IMAGE_MAX_SIZE * IMAGE_MAX_SIZE);
  const fittedDimensions = fitRenderDimensions({
    width: requestedWidth,
    height: requestedHeight,
    fallbackWidth: IMAGE_MAX_SIZE,
    fallbackHeight: IMAGE_MAX_SIZE,
    minSide: IMAGE_MIN_SIZE,
    maxSide: IMAGE_MAX_SIZE,
    maxPixels: IMAGE_MAX_PIXELS,
  });
  const width = fittedDimensions.width;
  const height = fittedDimensions.height;
  const renderSizing = mask?.meta?.renderSizing && typeof mask.meta.renderSizing === 'object'
    ? mask.meta.renderSizing
    : null;
  if (requestedWidth !== undefined && width !== requestedWidth) {
    console.warn(`[A11][image-chat-runtime] width requested=${requestedWidth} effective=${width} (fit)`);
  }
  if (requestedHeight !== undefined && height !== requestedHeight) {
    console.warn(`[A11][image-chat-runtime] height requested=${requestedHeight} effective=${height} (fit)`);
  }
  if (renderLimits.policy && renderLimits.policy !== 'default') {
    console.warn(
      `[A11][image-chat-runtime] applying size guard policy=${renderLimits.policy}`
      + ` profile=${renderLimits.profile || 'unknown'}`
      + ` max_side=${IMAGE_MAX_SIZE}`
      + ` max_pixels=${IMAGE_MAX_PIXELS}`
    );
  }
  if (renderSizing) {
    console.log(
      `[A11][image-size] source=${renderSizing.source || 'unknown'}`
      + ` reason=${renderSizing.reason || 'n/a'}`
      + ` requested=${renderSizing.requestedWidth || 'auto'}x${renderSizing.requestedHeight || 'auto'}`
      + ` resolved=${width}x${height}`
      + (renderLimits.policy && renderLimits.policy !== 'default'
        ? ` policy=${renderLimits.policy}`
        : '')
    );
  }
  const sdBody = compilerTarget === 'sd-payload'
    ? buildSdRequestBody(mask, compiledPayload)
    : {
        ...compiledPayload,
        width,
        height,
        ...(renderSizing ? {
          size_source: renderSizing.source,
          size_reason: renderSizing.reason,
          requested_width: renderSizing.requestedWidth,
          requested_height: renderSizing.requestedHeight,
        } : {}),
        num_inference_steps: Number(compiledPayload?.num_inference_steps || mask?.options?.steps || 30),
      guidance_scale: Number(compiledPayload?.guidance_scale || mask?.options?.guidance_scale || 7.5),
        ...(compiledPayload?.seed !== undefined ? { seed: compiledPayload.seed } : {}),
        ...resolveSdImg2ImgDraftFields(mask, compiledPayload),
      };

  return {
    mask,
    compiledPayload,
    compiled,
    sdBody,
  };
}

async function compileMaskImageGenerateRuntime(rawMask, options = {}) {
  const canonicalEntryMask = await canonicalizeImageMaskPromptFlow(rawMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    stage: 'ingress',
  });
  const imageRequestMode = resolveImageRequestMode({
    rawMask: canonicalEntryMask,
    req: options.req,
    explicitMode: options.imageRequestMode,
  });
  if (imageRequestMode.mode === 'raw') {
    const rawModeMask = normalizeMaskImageGenerate(canonicalEntryMask);
    rawModeMask.meta = rawModeMask.meta && typeof rawModeMask.meta === 'object' ? rawModeMask.meta : {};
    rawModeMask.meta.imageRequestMode = 'raw';
    rawModeMask.meta.imagePipelineMode = 'raw';
    rawModeMask.meta.compilerCompartment = 'standard';
    rawModeMask.meta.specialCompilerReason = imageRequestMode.reason;
    rawModeMask.meta.deferEnglishPromptLocalization = true;

    const compiledState = compileMaskImageGenerate(rawModeMask);
    compiledState.imageRequestMode = imageRequestMode;
    compiledState.imageRequestDirector = null;
    compiledState.specialCompiler = {
      selection: {
        compartment: 'standard',
        candidate: false,
        reasons: [imageRequestMode.reason],
        llmAvailable: false,
        shouldBypassCache: false,
        aggressive: false,
        pipelineMode: 'raw',
      },
      appliedHints: null,
      fallbackReason: 'raw_mode',
      preferredHintMemory: null,
    };
    return compiledState;
  }

  const baseSelection = resolveImageCompilerCompartment(canonicalEntryMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    pipelineMode: 'smart',
  });
  const orchestratorEnabled = isImageOrchestratorEnabled(baseSelection.pipelineMode);
  let preferredHintMemory = null;
  if (orchestratorEnabled) {
    try {
      preferredHintMemory = typeof options.readPreferredImageHintMemory === 'function'
        ? await options.readPreferredImageHintMemory(canonicalEntryMask)
        : await readPreferredImageHintMemory(canonicalEntryMask);
    } catch (error_) {
      preferredHintMemory = {
        available: false,
        skipped: true,
        reason: 'hint_memory_read_failed',
        message: String(error_?.message || error_),
        hints: {
          composition_hints: [],
          environment_hints: [],
          style_hints: [],
          prompt_instructions: [],
        },
      };
    }
  }
  const selection = orchestratorEnabled
    ? resolveImageCompilerCompartment(canonicalEntryMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
      pipelineMode: 'smart',
    })
    : baseSelection;
  let runtimeMask = canonicalEntryMask;
  if (typeof options.resolveImageEntityContext === 'function') {
    try {
      const imageEntityContext = await options.resolveImageEntityContext({
        mask: runtimeMask,
        selection,
      });
      if (imageEntityContext && typeof imageEntityContext === 'object') {
        runtimeMask = enrichImageMaskWithScratchpad(runtimeMask, { entityContext: imageEntityContext });
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageEntityContextError: String(error_?.message || error_),
        },
      };
    }
  }
  let webHintContext = null;
  if (orchestratorEnabled && typeof options.lookupImageHintWebContext === 'function') {
    try {
      webHintContext = await options.lookupImageHintWebContext({
        mask: runtimeMask,
        selection,
      });
      if (webHintContext && typeof webHintContext === 'object') {
        runtimeMask = {
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webHintContext,
          },
        };
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webHintContextError: String(error_?.message || error_),
        },
      };
    }
  }
  if (orchestratorEnabled && typeof options.resolveImageReferencePack === 'function') {
    try {
      const webReferencePack = await options.resolveImageReferencePack({
        mask: runtimeMask,
        selection,
        duckduckgoImageSearch: options.duckduckgoImageSearch,
      });
      if (webReferencePack && typeof webReferencePack === 'object') {
        runtimeMask = {
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webReferencePack,
          },
        };
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webReferencePackError: String(error_?.message || error_),
        },
      };
    }
  }
  if (orchestratorEnabled && typeof options.resolveImageWebDraft === 'function') {
    try {
      const resolvedWebImageDraft = await options.resolveImageWebDraft({
        mask: runtimeMask,
        selection,
        webHintContext,
      });
      if (resolvedWebImageDraft && typeof resolvedWebImageDraft === 'object') {
        const webImageDraft = await enrichImg2ImgDraft({
          webImageDraft: resolvedWebImageDraft,
          mask: runtimeMask,
        });
        runtimeMask = applyWebDraftCanvasToMask({
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webImageDraft,
          },
        }, webImageDraft);
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webImageDraftError: String(error_?.message || error_),
        },
      };
    }
  }
  const existingInitImage = String(
    runtimeMask?.meta?.webImageDraft?.initImageUrl
    || runtimeMask?.meta?.webImageDraft?.initImagePath
    || runtimeMask?.meta?.reference_image_url
    || runtimeMask?.meta?.init_image_url
    || ''
  ).trim();
  if (
    orchestratorEnabled
    && !existingInitImage
    && typeof options.buildImageReferenceComposite === 'function'
  ) {
    try {
      const referenceCompositeDraft = await options.buildImageReferenceComposite({
        mask: runtimeMask,
        referencePack: runtimeMask?.meta?.webReferencePack || null,
      });
      if (referenceCompositeDraft && typeof referenceCompositeDraft === 'object') {
        const enrichedReferenceCompositeDraft = await enrichImg2ImgDraft({
          webImageDraft: referenceCompositeDraft,
          mask: runtimeMask,
        });
        runtimeMask = applyWebDraftCanvasToMask({
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webImageDraft: enrichedReferenceCompositeDraft,
          },
        }, enrichedReferenceCompositeDraft);
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageReferenceCompositeError: String(error_?.message || error_),
        },
      };
    }
  }
  let director = null;
  if (orchestratorEnabled && typeof options.directImageRequest === 'function') {
    try {
      const directed = await options.directImageRequest({
        mask: runtimeMask,
        selection,
        callStructuredLlm: options.callStructuredLlmJson,
        lookupDefinitionContext: options.lookupDefinitionContext,
        duckduckgoImageSearch: options.duckduckgoImageSearch,
      });
      if (directed && typeof directed === 'object') {
        director = directed.director || null;
        if (directed.mask && typeof directed.mask === 'object') {
          runtimeMask = directed.mask;
        }
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageRequestDirectorError: String(error_?.message || error_),
        },
      };
    }
  }
  const enriched = await enrichMaskForSpecialImageCompiler(runtimeMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    preferredHints: preferredHintMemory?.hints || {},
    pipelineMode: 'smart',
  });
  const enrichedMask = await canonicalizeImageMaskPromptFlow(enriched?.mask || runtimeMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    stage: 'post_enrichment',
  });
  enrichedMask.meta = enrichedMask.meta && typeof enrichedMask.meta === 'object'
    ? enrichedMask.meta
    : {};
  enrichedMask.meta.deferEnglishPromptLocalization = false;
  const compiledState = compileMaskImageGenerate(enrichedMask);
  compiledState.imageRequestMode = imageRequestMode;
  compiledState.imageRequestDirector = director;
  compiledState.specialCompiler = {
    selection: enriched?.selection || resolveImageCompilerCompartment(runtimeMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
      pipelineMode: 'smart',
    }),
    appliedHints: enriched?.appliedHints || null,
    fallbackReason: String(enriched?.fallbackReason || '').trim(),
    preferredHintMemory: preferredHintMemory || null,
  };
  const promptRefined = await refineCompiledImagePromptWithLlm(compiledState, options);
  const englishPromptFallbackState = buildLocalEnglishPromptFallbackCompiledState(promptRefined.compiledState);
  const effectivePromptCompiledState = englishPromptFallbackState || promptRefined.compiledState;
  const techniqueReconciled = await reconcileCompiledImageTechnique(effectivePromptCompiledState, {
    selection: effectivePromptCompiledState?.specialCompiler?.selection || selection,
    resolveImageWebDraft: options.resolveImageWebDraft,
    webHintContext,
    callStructuredLlmJson: options.callStructuredLlmJson,
    finalPromptDirectorEnabled: options.finalPromptDirectorEnabled,
  });
  techniqueReconciled.compiledState.promptRefiner = promptRefined.promptRefiner;
  techniqueReconciled.compiledState.techniqueReconciler = techniqueReconciled.techniqueReconciler;
  techniqueReconciled.compiledState.localEnglishPromptFallback = {
    applied: false,
    reason: 'disabled',
  };
  const finalPromptGuard = await enforceFinalCanonicalEnglishPrompt(techniqueReconciled.compiledState, {
    callStructuredLlmJson: options.callStructuredLlmJson,
  });
  finalPromptGuard.compiledState.finalPromptGuard = finalPromptGuard.finalPromptGuard;
  return finalPromptGuard.compiledState;
}

function slugifyImageVerificationLabel(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image';
}

function buildImageVerificationRequestId(compiledState = {}, expectedImageContract = null) {
  const contractLabel = String(expectedImageContract?.subjectLabel || '').trim();
  const subject = String(
    contractLabel
    || compiledState?.mask?.inputs?.subject?.[0]
    || compiledState?.mask?.raw
    || 'image'
  ).trim();
  const slug = slugifyImageVerificationLabel(subject);
  return `img-${slug}-${Date.now()}`;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isFalsyEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function isLocalImageRuntime(env = process.env) {
  return isTruthyEnv(env?.A11_LOCAL_MODE)
    || String(env?.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local';
}

function isImageVerificationEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_CARDINALITY_GUARD
    || process.env.A11_IMAGE_VERIFY_CARDINALITY
    || '';
  if (!String(envValue).trim()) return true;
  if (isFalsyEnv(envValue)) return false;
  return isTruthyEnv(envValue);
}

function resolveMaxVerificationRetries(explicitValue) {
  if (explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
    const numeric = Number(explicitValue);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  }
  const fallbackRetries = isLocalImageRuntime(process.env) ? 0 : 1;
  const fromEnv = Number(
    process.env.A11_IMAGE_CARDINALITY_MAX_RETRIES
    || process.env.A11_IMAGE_VERIFY_MAX_RETRIES
    || fallbackRetries
  );
  return Number.isFinite(fromEnv) ? Math.max(0, Math.floor(fromEnv)) : 0;
}

function buildCompiledPromptHash(sdBody = {}) {
  return crypto
    .createHash('sha1')
    .update(String(sdBody?.prompt || '').trim())
    .digest('hex')
    .slice(0, 16);
}

function deriveOperationalSeed({ mask = {}, sdBody = {} } = {}) {
  const existingSeed = Number(sdBody?.seed);
  if (Number.isFinite(existingSeed)) {
    return Math.max(1, Math.floor(existingSeed));
  }

  const payload = [
    String(sdBody?.prompt || '').trim(),
    String(mask?.raw || '').trim(),
    String(mask?.inputs?.subject?.join('|') || '').trim(),
    String(mask?.meta?.canonicalSubject || mask?.meta?.imageScratchpad?.canonicalSubject || '').trim(),
    String(mask?.meta?.subjectProfile?.type || '').trim(),
  ].join('\n');

  const digest = crypto.createHash('sha1').update(payload).digest();
  const derived = digest.readUInt32BE(0) & 0x7fffffff;
  return Math.max(1, derived || 1);
}

function ensureOperationalSdBody(sdBody = {}, mask = {}) {
  const initImage = String(
    sdBody?.init_image_url
    || sdBody?.initImageUrl
    || mask?.meta?.webImageDraft?.initImagePath
    || mask?.meta?.webImageDraft?.initImageUrl
    || mask?.meta?.reference_image_url
    || mask?.meta?.init_image_url
    || ''
  ).trim();
  return {
    ...sdBody,
    ...(initImage ? { init_image_url: initImage } : {}),
    seed: deriveOperationalSeed({ mask, sdBody }),
  };
}

async function inspectGeneratedImage(sdResult) {
  const imageUrl = resolveGeneratedImageUrl(sdResult);
  if (!imageUrl) {
    return { ok: true, skipped: true, reason: 'missing_image_url' };
  }

  const sharp = getSharp();
  if (!sharp || typeof globalThis.fetch !== 'function') {
    return { ok: true, skipped: true, reason: 'image_probe_unavailable' };
  }

  try {
    const response = await globalThis.fetch(imageUrl);
    if (!response.ok) {
      return {
        ok: true,
        skipped: true,
        reason: 'image_probe_unavailable',
        message: `image_probe_http_${response.status}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const probe = sharp(buffer, { failOn: 'none' });
    const [metadata, stats] = await Promise.all([
      probe.metadata(),
      probe.stats(),
    ]);
    const rgbChannels = Array.isArray(stats?.channels) ? stats.channels.slice(0, 3) : [];
    const solidBlack = rgbChannels.length >= 3 && rgbChannels.every((channel) => (
      Number(channel?.max || 0) <= 2 && Number(channel?.mean || 0) <= 2
    ));

    if (solidBlack) {
      return {
        ok: false,
        reason: 'solid_black_image_detected',
        imageUrl,
        metadata: {
          width: Number(metadata?.width || 0),
          height: Number(metadata?.height || 0),
          channels: Number(metadata?.channels || 0),
          sizeBytes: buffer.length,
        },
      };
    }

    return {
      ok: true,
      imageUrl,
      metadata: {
        width: Number(metadata?.width || 0),
        height: Number(metadata?.height || 0),
        channels: Number(metadata?.channels || 0),
        sizeBytes: buffer.length,
      },
    };
  } catch (error_) {
    return {
      ok: true,
      skipped: true,
      reason: 'image_probe_failed',
      message: String(error_?.message || error_),
    };
  }
}

async function generateImageFromMask({
  req,
  rawMask,
  generateImage,
  generateSd,
  specialCompilerCallStructuredLlmJson,
  verifyImageCardinality = verifyGeneratedImageCardinality,
  verifyImageWithLlmJudge = verifyGeneratedImageWithLlmJudge,
  inspectGeneratedImageResult = inspectGeneratedImage,
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
  callStructuredVisionJudgeJson,
  resolveImageEntityContext = defaultResolveImageEntityContext,
  directImageRequest = defaultDirectImageRequest,
  lookupDefinitionContext = defaultLookupDefinitionContext,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
  lookupImageHintWebContext = defaultLookupImageHintWebContext,
  resolveImageReferencePack = defaultResolveImageReferencePack,
  buildImageReferenceComposite = defaultBuildImageReferenceComposite,
  resolveImageWebDraft = defaultResolveImageWebDraft,
  imageVerificationEnabled,
  maxVerificationRetries,
}) {
  const compiledState = await compileMaskImageGenerateRuntime(rawMask, {
    req,
    callStructuredLlmJson: specialCompilerCallStructuredLlmJson,
    readPreferredImageHintMemory,
    resolveImageEntityContext,
    directImageRequest,
    lookupDefinitionContext,
    duckduckgoImageSearch,
    lookupImageHintWebContext,
    resolveImageReferencePack,
    buildImageReferenceComposite,
    resolveImageWebDraft,
  });
  const imageGenerator = typeof generateImage === 'function'
    ? generateImage
    : generateSd;

  if (typeof imageGenerator !== 'function') {
    const error = new Error('generateImage handler unavailable');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'image_engine_unavailable',
      message: 'generateImage handler unavailable',
    };
    throw error;
  }

  const expectedImageContract = inferExpectedImageContract({
    mask: compiledState.mask,
    compiledState,
  });
  const requestId = buildImageVerificationRequestId(compiledState, expectedImageContract);
  const imageRequestMode = compiledState.imageRequestMode?.mode || 'smart';
  const guardEnabled = isImageVerificationEnabled(imageVerificationEnabled);
  const resolvedMaxVerificationRetries = resolveMaxVerificationRetries(maxVerificationRetries);
  const attempts = [];

  let activeSdBody = ensureOperationalSdBody(compiledState.sdBody, compiledState.mask);
  const finalPrompt = String(activeSdBody?.prompt || '').trim();
  const finalNegativePrompt = String(activeSdBody?.negative_prompt || '').trim();
  const finalPromptOkay = isCanonicalEnglishSdText(finalPrompt, { allowUnknown: true });
  const finalNegativeOkay = !finalNegativePrompt || isCanonicalEnglishSdText(finalNegativePrompt, { allowUnknown: true });
  console.log(`[A11][prompt-canon][final] prompt=${JSON.stringify(finalPrompt)}`);
  if (!finalPromptOkay || !finalNegativeOkay || compiledState?.finalPromptGuard?.rejected === true) {
    const error = new Error('final_prompt_not_canonical_english');
    error.statusCode = 422;
    error.payload = {
      ok: false,
      error: 'final_prompt_not_canonical_english',
      prompt: finalPrompt,
      negative_prompt: finalNegativePrompt,
      finalPromptGuard: compiledState?.finalPromptGuard || null,
    };
    throw error;
  }
  let compiledPromptHash = buildCompiledPromptHash(activeSdBody);
  const expectedSubjectCount = Number(expectedImageContract?.subjectCount || 0) || 0;
  const expectedMode = String(expectedImageContract?.mode || expectedImageContract?.reason || 'none').trim() || 'none';
  const expectedLabel = String(expectedImageContract?.subjectLabel || '').trim() || '-';
  console.log(
    `[A11][image-guard] start requestId=${requestId} enabled=${guardEnabled} promptHash=${compiledPromptHash} seed=${activeSdBody.seed ?? 'none'} expected=${expectedSubjectCount || 'none'} mode=${expectedMode} label=${expectedLabel}`
  );
  if (compiledState?.mask?.meta?.webImageDraft && typeof compiledState.mask.meta.webImageDraft === 'object') {
    const draft = compiledState.mask.meta.webImageDraft;
    const strengthLabel = String(activeSdBody?.strength || '').trim().toLowerCase() === 'auto'
      ? 'auto'
      : (Number.isFinite(Number(activeSdBody?.strength)) ? Number(activeSdBody.strength).toFixed(2) : 'none');
    console.log(
      `[A11][img2img-web] source=${String(draft?.sourceUsed || draft?.initImagePath || draft?.initImageUrl || 'unknown').trim() || 'unknown'}`
      + (
        draft?.sourcePreparedApplied === true && draft?.sourceOriginalUsed
          ? ` source_original=${String(draft.sourceOriginalUsed).trim()}`
          : ''
      )
      + ` source_dims=${draft?.sourceWidth || draft?.width || 'unknown'}x${draft?.sourceHeight || draft?.height || 'unknown'}`
      + (
        draft?.sourceTrimApplied === true
          ? ` source_dims_original=${draft?.originalSourceWidth || 'unknown'}x${draft?.originalSourceHeight || 'unknown'}`
          : ''
      )
      + ` source_ratio=${Number.isFinite(Number(draft?.sourceRatio)) ? Number(draft.sourceRatio).toFixed(4) : 'unknown'}`
      + ` target=${draft?.targetWidth || activeSdBody.width || 'unknown'}x${draft?.targetHeight || activeSdBody.height || 'unknown'}`
      + ` scene_type=${String(draft?.sceneType || 'unknown').trim() || 'unknown'}`
      + ` strength=${strengthLabel}`
    );
  }
  let sdResult = await imageGenerator({
    req,
    prompt: activeSdBody.prompt,
    body: activeSdBody,
  });
  attempts.push({
    attempt: 1,
    prompt_hash: compiledPromptHash,
    prompt: String(activeSdBody.prompt || '').trim(),
    seed: activeSdBody.seed,
    image_url: resolveGeneratedImageUrl(sdResult),
  });

  let verification = null;
  const retryHistory = [];
  if (imageRequestMode === 'raw') {
    if (typeof verifyImageCardinality === 'function' && expectedImageContract?.enabled) {
      try {
        verification = await verifyImageCardinality({
          imageUrl: resolveGeneratedImageUrl(sdResult),
          expected: expectedImageContract,
          requestId,
          prompt: String(activeSdBody.prompt || '').trim(),
          seed: activeSdBody.seed,
        });
      } catch (error_) {
        verification = {
          ok: false,
          skipped: true,
          reason: 'raw_non_blocking_verify_failed',
          message: String(error_?.message || error_),
        };
      }
      console.log(
        `[A11][image-guard] raw requestId=${requestId} promptHash=${compiledPromptHash} reason=${verification?.decision?.reason || verification?.reason || 'skipped'}`
      );
    } else {
      verification = {
        ok: false,
        skipped: true,
        reason: 'raw_mode_no_blocking_check',
      };
    }
  } else if (guardEnabled && typeof verifyImageCardinality === 'function' && expectedImageContract?.enabled) {
    try {
      verification = await verifyImageCardinality({
        imageUrl: resolveGeneratedImageUrl(sdResult),
        expected: expectedImageContract,
        requestId,
        prompt: String(activeSdBody.prompt || '').trim(),
        seed: activeSdBody.seed,
      });
      verification = relaxVerificationForWebInit(compiledState.mask, verification);
    } catch (error_) {
      verification = {
        ok: false,
        skipped: true,
        reason: 'vision_verify_failed',
        message: String(error_?.message || error_),
      };
    }
    console.log(
      `[A11][image-guard] verify requestId=${requestId} promptHash=${compiledPromptHash} status=${verification?.ok ? 'ok' : 'skip'} reason=${verification?.decision?.reason || verification?.reason || 'unknown'}`
    );

    let retryCount = 0;
    while (
      retryCount < resolvedMaxVerificationRetries
      && verification?.ok
      && verification?.decision?.retry === true
    ) {
      retryCount += 1;
      console.log(
        `[A11][image-guard] retry=${retryCount} requestId=${requestId} reason=${verification.decision.reason} observed=${verification.observed?.subject_count} expected=${verification.expected?.subject_count}`
      );
      retryHistory.push({
        retry: retryCount,
        reason: String(verification?.decision?.reason || '').trim() || 'verification_retry',
        observed_subject_count: Number(verification?.observed?.subject_count || 0),
        confidence: Number(verification?.observed?.confidence || 0),
      });

      activeSdBody = buildRetrySdBody(activeSdBody, verification, {
        seed: Date.now(),
      });
      if (compiledState?.mask?.meta?.webImageDraft && typeof compiledState.mask.meta.webImageDraft === 'object') {
        const retryStrength = Number(compiledState.mask.meta.webImageDraft.retryStrength);
        if (Number.isFinite(retryStrength)) {
          activeSdBody = {
            ...activeSdBody,
            strength: retryStrength,
          };
        }
      }
      compiledPromptHash = buildCompiledPromptHash(activeSdBody);
      sdResult = await imageGenerator({
        req,
        prompt: activeSdBody.prompt,
        body: activeSdBody,
      });
      attempts.push({
        attempt: retryCount + 1,
        prompt_hash: compiledPromptHash,
        prompt: String(activeSdBody.prompt || '').trim(),
        seed: activeSdBody.seed,
        image_url: resolveGeneratedImageUrl(sdResult),
      });

      try {
        verification = await verifyImageCardinality({
          imageUrl: resolveGeneratedImageUrl(sdResult),
          expected: expectedImageContract,
          requestId,
          prompt: String(activeSdBody.prompt || '').trim(),
          seed: activeSdBody.seed,
        });
        verification = relaxVerificationForWebInit(compiledState.mask, verification);
      } catch (error_) {
        verification = {
          ok: false,
          skipped: true,
          reason: 'vision_verify_failed',
          message: String(error_?.message || error_),
        };
        break;
      }
      console.log(
        `[A11][image-guard] verify requestId=${requestId} promptHash=${compiledPromptHash} status=${verification?.ok ? 'ok' : 'skip'} reason=${verification?.decision?.reason || verification?.reason || 'unknown'}`
      );
    }
  }

  const imageInspection = typeof inspectGeneratedImageResult === 'function'
    ? await inspectGeneratedImageResult(sdResult)
    : { ok: true, skipped: true, reason: 'image_probe_disabled' };
  if (imageInspection?.ok === false && imageRequestMode !== 'raw') {
    const error = new Error('Generated image is invalid');
    error.statusCode = 502;
    error.payload = {
      ok: false,
      error: 'image_generation_invalid',
      message: "Le backend image a renvoye une image invalide.",
      details: imageInspection,
      result: sdResult,
    };
    throw error;
  }

  const imageUrl = resolveGeneratedImageUrl(sdResult);
  const shouldRunLlmJudge = Boolean(
    imageRequestMode !== 'raw'
    && imageUrl
    && typeof verifyImageWithLlmJudge === 'function'
    && (
      compiledState?.specialCompiler?.selection?.candidate === true
      || compiledState?.specialCompiler?.selection?.compartment === 'special'
      || retryHistory.length > 0
    )
  );
  const imageLlmJudge = shouldRunLlmJudge
    ? await verifyImageWithLlmJudge({
      imageUrl,
      mask: compiledState.mask,
      requestId,
      prompt: String(activeSdBody.prompt || '').trim(),
      seed: activeSdBody.seed,
      callStructuredVisionJson: callStructuredVisionJudgeJson,
    })
    : {
      ok: false,
      skipped: true,
      reason: imageRequestMode === 'raw' ? 'raw_mode_no_llm_judge' : 'vision_llm_not_needed',
    };

  let hintMemory = null;
  if (
    imageLlmJudge?.ok === true
    && imageLlmJudge?.decision?.accepted === true
    && typeof recordSuccessfulImageHintMemory === 'function'
  ) {
    try {
      hintMemory = await recordSuccessfulImageHintMemory({
        mask: compiledState.mask,
        workingHints: imageLlmJudge.workingHints,
        judgeResult: imageLlmJudge,
      });
    } catch (error_) {
      hintMemory = {
        ok: false,
        skipped: true,
        reason: 'hint_memory_record_failed',
        message: String(error_?.message || error_),
      };
    }
  }

  return {
    ...compiledState,
    sdBody: activeSdBody,
    sdResult,
    imageInspection,
    imageLlmJudge,
    hintMemory,
    imageGuard: {
      requestId,
      enabled: imageRequestMode === 'raw' ? false : guardEnabled,
      mode: imageRequestMode,
      compiledPromptHash: attempts[0]?.prompt_hash || compiledPromptHash,
      expected: expectedImageContract,
      verification,
      retries: retryHistory,
      attempts,
    },
  };
}

async function generateImageFromText({ req, text, generateSd, ...rest }) {
  const message = String(text || '').trim();
  if (!message) {
    const error = new Error('missing_message');
    error.statusCode = 400;
    error.payload = { ok: false, error: 'missing_message' };
    throw error;
  }

  const maskResolution = await buildCanonicalImageMaskFromText(message);

  return generateImageFromMask({
    req,
    rawMask: maskResolution.rawMask,
    generateSd,
    ...rest,
  });
}

function resolveGeneratedImageUrl(sdResult) {
  return String(
    sdResult?.image_url
    || sdResult?.url
    || sdResult?.imagePath
    || sdResult?.public_url
    || sdResult?.file?.downloadUrl
    || sdResult?.file?.url
    || sdResult?.conversationResource?.downloadUrl
    || sdResult?.conversationResource?.url
    || sdResult?.result?.image_url
    || sdResult?.result?.url
    || sdResult?.result?.public_url
    || sdResult?.data?.image_url
    || sdResult?.data?.url
    || sdResult?.output?.image_url
    || sdResult?.output?.url
    || sdResult?.artifact?.image_url
    || sdResult?.artifact?.url
    || ''
  ).trim();
}

function inferImageFilename(imageUrl = '') {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  try {
    const pathname = new URL(raw).pathname || '';
    const candidate = path.basename(decodeURIComponent(pathname));
    return String(candidate || '').trim();
  } catch {
    const candidate = raw.split('?')[0].split('#')[0].split('/').pop();
    return String(candidate || '').trim();
  }
}

function ensureImageFilename(filename, imageUrl, contentType = '', artifactType = '') {
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  const normalizedArtifactType = String(artifactType || '').trim().toLowerCase();
  const candidate = String(filename || '').trim() || inferImageFilename(imageUrl);
  if (/\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(candidate)) {
    return candidate;
  }
  if (normalizedContentType === 'image/jpeg') return `${candidate || 'image'}.jpg`;
  if (normalizedContentType === 'image/webp') return `${candidate || 'image'}.webp`;
  if (normalizedContentType === 'image/gif') return `${candidate || 'image'}.gif`;
  if (normalizedContentType.startsWith('image/') || normalizedArtifactType.includes('image')) {
    return `${candidate || 'image'}.png`;
  }
  return candidate;
}

function buildImageAssistantMessage({ imageUrl, filename, ok = true, error = '', message = '' }) {
  if (ok === false) {
    const detail = String(message || error || '').trim();
    return detail
      ? `Je n'ai pas pu générer l'image. ${detail}`
      : "Je n'ai pas pu générer l'image.";
  }
  if (imageUrl && filename) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  if (imageUrl) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  return "La génération image a répondu sans URL exploitable. Je ne peux pas l'afficher ici tant que le backend ne fournit pas de lien public.";
}

function toImageChatProxyPayload({
  sdResult,
  mask,
  compiled,
  sdBody,
  imageGuard,
  imageLlmJudge,
  hintMemory,
  imageRequestDirector,
}) {
  const imageUrl = resolveGeneratedImageUrl(sdResult);
  const filename = ensureImageFilename(
    sdResult?.filename || sdResult?.conversationResource?.filename || sdResult?.file?.filename,
    imageUrl,
    sdResult?.content_type || sdResult?.contentType || sdResult?.conversationResource?.contentType || sdResult?.file?.contentType,
    sdResult?.artifact_type
  );
  const ok = sdResult?.ok !== false && Boolean(imageUrl);
  const content = buildImageAssistantMessage({
    imageUrl,
    filename,
    ok,
    error: sdResult?.error,
    message: sdResult?.message,
  });

  return {
    ok,
    error: sdResult?.error || null,
    message: sdResult?.message || null,
    id: `a11-img-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'a11-mask-image',
    mode: 'generate_image',
    tool: sdResult?.tool || 'generate_image',
    engine: sdResult?.mode || null,
    artifact_type: sdResult?.artifact_type || 'image',
    image_url: imageUrl || null,
    imagePath: imageUrl || null,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    a11Agent: {
      imagePath: imageUrl || null,
      imageDraft: mask?.meta?.webImageDraft || null,
      webReferencePack: mask?.meta?.webReferencePack || null,
      imageRequestDirector: imageRequestDirector || mask?.meta?.imageRequestDirector || null,
      imageGuard: imageGuard || null,
      imageLlmJudge: imageLlmJudge || null,
      hintMemory: hintMemory || null,
      results: [
        {
          action: sdResult?.tool || 'generate_image',
          ok: sdResult?.ok !== false,
          result: sdResult,
        },
      ],
    },
    result: sdResult,
    mask,
    compiled,
    sdBody,
  };
}

module.exports = {
  extractLatestUserMessage,
  applyStrengthComponentPromptGuidance,
  buildSdRequestBody,
  buildImageVerificationRequestId,
  compileMaskImageGenerate,
  compileMaskImageGenerateRuntime,
  resolveMaxVerificationRetries,
  resolveImageRequestMode,
  generateImageFromMask,
  generateImageFromText,
  resolveGeneratedImageUrl,
  inspectGeneratedImage,
  resolveImageCompilerCompartment,
  toImageChatProxyPayload,
};

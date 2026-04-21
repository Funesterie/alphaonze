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

  if (!selected.length) return normalizeText(base);
  return [normalizeText(base), ...selected].filter(Boolean).join('. ').trim();
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

const SD_PROMPT_OUTPUT_LANGUAGE = 'en';
const SD_PROMPT_OUTPUT_LABEL = 'english';
const SD_PROMPT_ENGLISH_PHRASE_FIXUPS = [
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
    /\btexte\b/gi,
    'text',
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

function normalizePromptContextShape(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePromptContextShape(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizePromptContextShape(entry)])
    );
  }
  if (typeof value === 'string') return normalizeText(value);
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

async function translatePromptContextToEnglish(context = {}, options = {}) {
  const normalizedContext = normalizePromptContextShape(context);
  const profile = detectPromptContextLanguage(normalizedContext);
  if (profile?.dominant === 'en' && profile?.mixed !== true) {
    return normalizedContext;
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
      maxTokens: 1400,
      timeoutMs: Number(process.env.A11_IMAGE_PROMPT_TRANSLATOR_TIMEOUT_MS || 10000),
    });
    if (!isCompatiblePromptContextTranslation(normalizedContext, translated)) {
      return normalizedContext;
    }
    return normalizePromptContextShape(translated);
  } catch {
    return normalizedContext;
  }
}

function buildStrengthComponentPromptGuidance({
  strengthComponents = null,
  promptLanguage = '',
  prompt = '',
} = {}) {
  if (!strengthComponents || typeof strengthComponents !== 'object') {
    return {
      positiveHints: [],
      negativeHints: [],
      language: resolveStrengthPromptGuidanceLanguage({ promptLanguage, prompt }),
    };
  }

  const language = resolveStrengthPromptGuidanceLanguage({ promptLanguage, prompt });
  const useFrench = language === 'fr';
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

  const positiveHints = [];
  const negativeHints = [];

  if (
    String(identity.profile || '').trim() === 'preserve'
    || Number(identity.strength) <= 0.34
  ) {
    positiveHints.push(
      useFrench
        ? 'garder strictement le meme visage et la meme identite'
        : 'keep exactly the same face and identity'
    );
    negativeHints.push(
      useFrench
        ? 'visage different, identite differente, autre personne'
        : 'different face, different identity, different person'
    );
  }

  if (
    String(anatomy.profile || '').trim() === 'preserve'
    || Number(anatomy.strength) <= 0.36
  ) {
    positiveHints.push(
      useFrench
        ? 'preserver une anatomie naturelle et des proportions stables'
        : 'preserve natural anatomy and stable proportions'
    );
    negativeHints.push(
      useFrench
        ? 'anatomie deformee, mains deformees, yeux deformes'
        : 'bad anatomy, deformed hands, deformed eyes'
    );
  }

  if (String(outfit.profile || '').trim() === 'preserve') {
    positiveHints.push(
      useFrench
        ? 'preserver la silhouette et la tenue principale'
        : 'preserve the silhouette and main outfit'
    );
  } else if (
    ['balanced', 'restyle'].includes(String(outfit.profile || '').trim())
    && Number(outfit.strength) >= 0.58
  ) {
    positiveHints.push(
      useFrench
        ? 'rendre le changement de tenue clairement visible'
        : 'make the outfit change clearly visible'
    );
  }

  if (
    String(background.profile || '').trim() === 'restyle'
    || Number(background.strength) >= 0.7
  ) {
    positiveHints.push(
      useFrench
        ? 'reinventer clairement le decor et l ambiance'
        : 'clearly redesign the background and atmosphere'
    );
  }

  if (
    ['balanced', 'restyle'].includes(String(effects.profile || '').trim())
    && Number(effects.strength) >= 0.58
  ) {
    positiveHints.push(
      useFrench
        ? 'rendre les effets et la lumiere clairement visibles'
        : 'make the lighting and effects clearly visible'
    );
  }

  if (
    ['balanced', 'restyle'].includes(String(props.profile || '').trim())
    && Number(props.strength) >= 0.56
  ) {
    positiveHints.push(
      useFrench
        ? 'rendre l accessoire demande clairement visible'
        : 'make the requested prop or accessory clearly visible'
    );
  }

  return {
    language,
    positiveHints: toUniqueNormalizedStrings(positiveHints).slice(0, 4),
    negativeHints: toUniqueNormalizedStrings(negativeHints).slice(0, 6),
  };
}

function applyStrengthComponentPromptGuidance(compiledState = {}, mask = {}) {
  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
    : {};
  const strengthComponents = sdBody?.strength_components
    || mask?.meta?.webImageDraft?.strengthComponents
    || null;
  const guidance = buildStrengthComponentPromptGuidance({
    strengthComponents,
    promptLanguage: sdBody?.prompt_language,
    prompt: sdBody?.prompt,
  });

  if (!guidance.positiveHints.length && !guidance.negativeHints.length) {
    return {
      compiledState,
      promptGuidance: {
        applied: false,
        reason: 'no_component_guidance',
      },
    };
  }

  const nextPrompt = mergePromptHints(sdBody?.prompt || '', guidance.positiveHints);
  const nextNegativePrompt = mergeNegativePromptHints(sdBody?.negative_prompt || '', guidance.negativeHints);

  const nextCompiledState = {
    ...compiledState,
    compiledPayload: {
      ...(compiledState?.compiledPayload && typeof compiledState.compiledPayload === 'object' ? compiledState.compiledPayload : {}),
      ...(nextPrompt ? { prompt: nextPrompt } : {}),
      ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
    },
    compiled: (
      compiledState?.compiled && typeof compiledState.compiled === 'object'
        ? {
            ...compiledState.compiled,
            ...(nextPrompt ? { prompt: nextPrompt } : {}),
            ...(nextNegativePrompt ? { negative_prompt: nextNegativePrompt } : {}),
          }
        : compiledState.compiled
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
    },
  };
}

const IMAGE_COMPONENT_PROMPT_DIRECTOR_SYSTEM_PROMPT = `Tu es le directeur final du prompt Stable Diffusion pour A11.
Tu interviens APRES la stabilisation du prompt final et APRES le calcul des strengths par composant.

Mission :
- reformuler le prompt final de façon naturelle, fluide, fidele et complete
- intégrer les consignes de contrôle par composant sans mentionner les scores ni la mécanique interne
- préserver strictement le sujet principal, le nombre de sujets, l identité, la relation entre sujets, le style demandé et les contraintes critiques
- éviter les contradictions entre preservation d identité/anatomie et restylisation du décor, des accessoires ou des effets
- ne pas ajouter de nouveau personnage, de nouvel objet principal ni de nouvelle action importante

Règles :
- pour les champs prompt et negative_prompt, utiliser strictement l anglais naturel, english only
- tu n es pas un résumeur: ne jamais condenser, simplifier, raccourcir ou lisser agressivement une demande riche
- si la raw_request ou le current_prompt contient un détail visuel concret utile, il doit rester présent dans la sortie finale
- si le prompt courant est deja riche et precis, le conserver presque intact et n ajuster que ce qui est necessaire pour l anglais, la fluidité et la cohérence
- si la raw_request est plus riche que le current_prompt, réintégrer proprement ses détails concrets dans le prompt final
- intégrer les priorités de façon sémantique, pas comme une liste technique
- ne jamais raccourcir agressivement un prompt deja detaille
- conserver la densité visuelle: le prompt final peut rester long si la demande est longue
- produire aussi un negative prompt propre et coherent sans ecraser les contraintes existantes

Réponds uniquement en JSON strict :
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
    raw_request: String(mask?.raw || '').trim(),
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
  const sdBody = compiledState?.sdBody && typeof compiledState.sdBody === 'object'
    ? compiledState.sdBody
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
      compiledState,
      promptGuidance: {
        applied: false,
        reason: 'no_component_guidance',
      },
    };
  }

  if (isRichFinalImagePrompt(sdBody?.prompt || '', sdBody?.negative_prompt || '')) {
    const fallback = applyStrengthComponentPromptGuidance(compiledState, mask);
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

  if (
    !resolveImageFinalPromptDirectorEnabled(options.finalPromptDirectorEnabled)
    || typeof options.callStructuredLlmJson !== 'function'
  ) {
    return applyStrengthComponentPromptGuidance(compiledState, mask);
  }

  try {
    const englishContext = await translatePromptContextToEnglish(
      buildStrengthComponentDirectorSourceContext(compiledState, mask, guidance),
      { callStructuredLlmJson: options.callStructuredLlmJson }
    );
    const response = await options.callStructuredLlmJson({
      text: buildStrengthComponentDirectorInput(englishContext),
      systemPrompt: IMAGE_COMPONENT_PROMPT_DIRECTOR_SYSTEM_PROMPT,
      temperature: 0.1,
      maxTokens: 900,
      timeoutMs: Number(process.env.A11_IMAGE_FINAL_PROMPT_DIRECTOR_TIMEOUT_MS || 9000),
    });

    const nextPrompt = normalizeSdPromptRewriteText(response?.prompt || '');
    const nextNegativePrompt = normalizeSdPromptRewriteText(response?.negative_prompt || '');
    if (!nextPrompt) {
      return applyStrengthComponentPromptGuidance(compiledState, mask);
    }
    if (!isAcceptableSdRewriteLanguage(nextPrompt)) {
      const fallback = applyStrengthComponentPromptGuidance(compiledState, mask);
      return {
        compiledState: fallback.compiledState,
        promptGuidance: {
          ...fallback.promptGuidance,
          fallbackReason: 'component_strength_llm_director_non_english',
        },
      };
    }
    if (nextNegativePrompt && !isAcceptableSdRewriteLanguage(nextNegativePrompt, { allowUnknown: true })) {
      const fallback = applyStrengthComponentPromptGuidance(compiledState, mask);
      return {
        compiledState: fallback.compiledState,
        promptGuidance: {
          ...fallback.promptGuidance,
          fallbackReason: 'component_strength_llm_director_non_english_negative',
        },
      };
    }
    if (isOvercompressedPromptRewrite({
      currentPrompt: sdBody?.prompt || '',
      currentNegativePrompt: sdBody?.negative_prompt || '',
      nextPrompt,
      nextNegativePrompt,
    })) {
      const fallback = applyStrengthComponentPromptGuidance(compiledState, mask);
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
      },
    };
  } catch (error_) {
    const fallback = applyStrengthComponentPromptGuidance(compiledState, mask);
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
    mask?.meta?.llmEnriched === true
    || (mask?.meta?.definitionLookup && typeof mask.meta.definitionLookup === 'object')
    || (mask?.meta?.imageEntityContext && typeof mask.meta.imageEntityContext === 'object')
    || (Array.isArray(mask?.meta?.promptInstructions) && mask.meta.promptInstructions.length > 3)
    || countImageSemanticFamilies(mask) >= 3
  );
  const hasSceneAttachment = /\b(avec|dans|sur|sous|tenant|portant|en train de|devant|derriere|derrière)\b/i.test(rawText);
  const hasHumanFigureAccessory = (
    ['reference_character', 'single_human_figure'].includes(subjectProfileType)
    && ['wearable', 'weapon', 'smoking_prop'].some((family) => accessoryFamilies.has(family))
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

  if (namedReferenceSubject) {
    return {
      mode: 'smart',
      reason: 'named_reference_subject',
      explicit: false,
    };
  }

  if (hasNamedCharacterVariation || hasHumanFigureAccessory) {
    return {
      mode: 'smart',
      reason: hasNamedCharacterVariation ? 'reference_character_variation' : 'human_figure_accessory_variation',
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

  const requestedWidth = Number(payload.width || mask?.options?.width);
  const requestedHeight = Number(payload.height || mask?.options?.height);
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

  return `Tu es un réécrivain final de prompt Stable Diffusion pour A11.
Tu reçois une demande image riche avec beaucoup de contexte interne.
Ta mission est de produire un prompt FINAL propre, cohérent, complet et exploitable pour le générateur d'image.

Règles strictes :
- conserver exactement le sujet principal, le nombre de sujets, la relation entre eux, les couleurs importantes, le style demandé et les contraintes essentielles
- ne jamais ajouter un nouveau personnage, un nouvel objet principal, une nouvelle action ou un nouveau décor important
- supprimer biographies, contexte encyclopédique, redondances, répétitions, formulations bavardes et méta-instructions
- tu n es pas un résumeur: ne jamais condenser, raccourcir, lisser ou simplifier agressivement une demande riche
- si le prompt courant est deja dense et precis, ne pas le resumer brutalement
- si la raw_request contient plus de détails concrets que le current_prompt, les réintégrer proprement dans le prompt final
- préserver tous les détails visuels concrets utiles: identité, visage, corpulence, posture, cadrage, tenue, accessoires, décor, éclairage, palette, ambiance et contraintes négatives utiles
- préserver les détails visuels concrets, les éléments de décor, les accessoires, les effets et les contraintes de cadrage réellement utiles
- produire un prompt positif fluide, orienté rendu image, de longueur adaptée au besoin réel, sans perte d information
- produire aussi un negative prompt propre et utile
- pour les champs prompt et negative_prompt, utiliser strictement l anglais naturel: ${languageInstruction}
- ne jamais melanger francais et anglais dans le meme prompt

Réponds uniquement en JSON strict :
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

  const prompt = String(compiledState?.sdBody?.prompt || '').trim();
  const negativePrompt = String(compiledState?.sdBody?.negative_prompt || '').trim();
  if (!prompt) return false;
  if (String(compiledState?.sdBody?.prompt_2 || compiledState?.sdBody?.prompt2 || '').trim()) return false;
  if (String(compiledState?.sdBody?.prompt_3 || compiledState?.sdBody?.prompt3 || '').trim()) return false;
  if (isRichFinalImagePrompt(prompt, negativePrompt)) return false;
  const hasReferenceInitImage = Boolean(String(
    compiledState?.mask?.meta?.webImageDraft?.initImageUrl
    || compiledState?.mask?.meta?.webImageDraft?.initImagePath
    || compiledState?.mask?.meta?.reference_image_url
    || compiledState?.mask?.meta?.init_image_url
    || compiledState?.sdBody?.init_image_url
    || ''
  ).trim());

  return (
    prompt.length >= 160
    || hasReferenceInitImage
    || compiledState?.specialCompiler?.selection?.candidate === true
    || (Array.isArray(compiledState?.mask?.meta?.promptInstructions) && compiledState.mask.meta.promptInstructions.length > 2)
    || Boolean(compiledState?.mask?.meta?.imageScratchpad)
    || Boolean(compiledState?.mask?.meta?.definitionLookup)
    || Boolean(compiledState?.mask?.meta?.webReferencePack)
    || Boolean(compiledState?.imageRequestDirector)
  );
}

function buildImagePromptRefinerSourceContext(compiledState = {}) {
  const mask = compiledState?.mask || {};
  return {
    target_language: SD_PROMPT_OUTPUT_LABEL,
    raw_request: String(mask?.raw || '').trim(),
    current_prompt: normalizeText(compiledState?.sdBody?.prompt || ''),
    current_negative_prompt: normalizeText(compiledState?.sdBody?.negative_prompt || ''),
    subject: Array.isArray(mask?.inputs?.subject) ? mask.inputs.subject : [],
    environment: Array.isArray(mask?.inputs?.environment) ? mask.inputs.environment : [],
    style: Array.isArray(mask?.inputs?.style) ? mask.inputs.style : [],
    composition: Array.isArray(mask?.inputs?.composition) ? mask.inputs.composition : [],
    lighting: Array.isArray(mask?.inputs?.lighting) ? mask.inputs.lighting : [],
    palette: Array.isArray(mask?.inputs?.palette) ? mask.inputs.palette : [],
    prompt_instructions: Array.isArray(mask?.meta?.promptInstructions) ? mask.meta.promptInstructions.slice(0, 12) : [],
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
    const response = await options.callStructuredLlmJson({
      text: buildImagePromptRefinerInput(englishContext),
      systemPrompt: buildImagePromptRefinerSystemPrompt(),
      temperature: 0.1,
      maxTokens: 900,
      timeoutMs: Number(process.env.A11_IMAGE_PROMPT_REFINER_TIMEOUT_MS || 10000),
    });

    const nextPrompt = normalizeSdPromptRewriteText(response?.prompt || '');
    const nextNegativePrompt = normalizeSdPromptRewriteText(response?.negative_prompt || '');

    if (!nextPrompt) {
      return {
        compiledState,
        promptRefiner: {
          applied: false,
          reason: 'empty_response',
        },
      };
    }
    if (!isAcceptableSdRewriteLanguage(nextPrompt)) {
      return {
        compiledState,
        promptRefiner: {
          applied: false,
          reason: 'non_english_response',
        },
      };
    }
    if (nextNegativePrompt && !isAcceptableSdRewriteLanguage(nextNegativePrompt, { allowUnknown: true })) {
      return {
        compiledState,
        promptRefiner: {
          applied: false,
          reason: 'non_english_negative_response',
        },
      };
    }
    if (isOvercompressedPromptRewrite({
      currentPrompt: compiledState?.sdBody?.prompt || '',
      currentNegativePrompt: compiledState?.sdBody?.negative_prompt || '',
      nextPrompt,
      nextNegativePrompt,
    })) {
      return {
        compiledState,
        promptRefiner: {
          applied: false,
          reason: 'overcompressed_response',
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
  const imageRequestMode = resolveImageRequestMode({
    rawMask,
    req: options.req,
    explicitMode: options.imageRequestMode,
  });
  if (imageRequestMode.mode === 'raw') {
    const rawModeMask = normalizeMaskImageGenerate(rawMask);
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

  const baseSelection = resolveImageCompilerCompartment(rawMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    pipelineMode: 'smart',
  });
  const orchestratorEnabled = isImageOrchestratorEnabled(baseSelection.pipelineMode);
  let preferredHintMemory = null;
  if (orchestratorEnabled) {
    try {
      preferredHintMemory = typeof options.readPreferredImageHintMemory === 'function'
        ? await options.readPreferredImageHintMemory(rawMask)
        : await readPreferredImageHintMemory(rawMask);
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
    ? resolveImageCompilerCompartment(rawMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
      pipelineMode: 'smart',
    })
    : baseSelection;
  let runtimeMask = rawMask;
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
  const enrichedMask = enriched?.mask || runtimeMask;
  enrichedMask.meta = enrichedMask.meta && typeof enrichedMask.meta === 'object'
    ? enrichedMask.meta
    : {};
  enrichedMask.meta.deferEnglishPromptLocalization = true;
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
  const techniqueReconciled = await reconcileCompiledImageTechnique(promptRefined.compiledState, {
    selection: promptRefined.compiledState?.specialCompiler?.selection || selection,
    resolveImageWebDraft: options.resolveImageWebDraft,
    webHintContext,
    callStructuredLlmJson: options.callStructuredLlmJson,
    finalPromptDirectorEnabled: options.finalPromptDirectorEnabled,
  });
  techniqueReconciled.compiledState.promptRefiner = promptRefined.promptRefiner;
  techniqueReconciled.compiledState.techniqueReconciler = techniqueReconciled.techniqueReconciler;
  return techniqueReconciled.compiledState;
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
  return {
    ...sdBody,
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
      + ` source_dims=${draft?.sourceWidth || draft?.width || 'unknown'}x${draft?.sourceHeight || draft?.height || 'unknown'}`
      + (
        draft?.sourceTrimApplied === true
          ? ` source_original=${draft?.originalSourceWidth || 'unknown'}x${draft?.originalSourceHeight || 'unknown'}`
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

  const maskResolution = await buildCanonicalImageMaskFromText(message, {
    allowCompatFallback: true,
  });

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

function buildImageAssistantMessage({ imageUrl, filename }) {
  if (imageUrl && filename) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  if (imageUrl) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  return "C'est fait. L'image a été générée.";
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
  const content = buildImageAssistantMessage({ imageUrl, filename });

  return {
    ok: sdResult?.ok !== false,
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

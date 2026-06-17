const crypto = require('node:crypto');

const analyzeSemanticIntent = require('./mask/semantic/analyze-semantic-intent.cjs');
const compileMaskUnified = require('./mask/compile-mask-unified.cjs');
const {
  createA11ImageBrain: defaultCreateA11ImageBrain,
  buildClarificationMessage,
} = require('./image/a11-image-brain.cjs');
const {
  generateImageFromMask,
  resolveImageRequestMode,
  toImageChatProxyPayload,
} = require('./mask/image-chat-runtime.cjs');
const {
  resolveImageCompilerCompartment,
} = require('./mask/compile-mask-to-image-prompt-special.cjs');
const {
  readPreferredImageHintMemory: defaultReadPreferredImageHintMemory,
} = require('./image/image-hint-memory.cjs');
const textToWazaa = require('./mask/text-to-wazaa.cjs');
const validateMaskUnified = require('./mask/validate-mask-unified.cjs');
const wazaaToMask = require('./mask/wazaa-to-mask.cjs');
const {
  buildDefinitionLookupQuery,
  lookupDefinitionContext: defaultLookupDefinitionContext,
  mergeDefinitionContextIntoWazaa,
  shouldLookupDefinitionContext,
} = require('./knowledge/definition-context.cjs');
const {
  resolveImageEntityContext: defaultResolveImageEntityContext,
} = require('./knowledge/image-entity-resolver.cjs');
const {
  enrichImageMaskWithScratchpad,
} = require('./mask/image-scratchpad.cjs');
const {
  smoothRequestText: defaultSmoothRequestText,
} = require('./knowledge/request-text-smoother.cjs');
const {
  applyCanonicalizedImageGenerateRequestToMask,
  buildCanonicalizedRequestTextSmootherResult,
  canonicalizeImageGenerateRequest: defaultCanonicalizeImageGenerateRequest,
} = require('./mask/canonicalize-image-generate-request.cjs');
const {
  applyImageReferenceDecisionToMask,
  buildAutomaticImageReferenceFallbackDecision,
  classifyReferenceImages: defaultClassifyReferenceImages,
  extractRequestImageReferences,
} = require('./image/janus-image-manifest.cjs');
const {
  executeDirectImagePipeline,
} = require('./image/image-pipeline-direct.cjs');
const {
  autoDescribeImage,
  buildAutoDescribeUserMessage,
} = require('./image/image-auto-describe.cjs');
const {
  detectIntentWithLlm: defaultDetectIntentWithLlm,
} = require('../lib/intent-detection.cjs');

const {
  detectImageIntent: defaultDetectImageIntent,
  detectVideoIntent: defaultDetectVideoIntent,
  detectWebImageIntent: defaultDetectWebImageIntent,
} = require('../lib/intent-detection.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../lib/image-search.cjs');
const { parseVideoGenerateRequest } = require('./video/video-request.cjs');
const { toVideoChatProxyPayload } = require('./video/video-generate-runtime.cjs');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isIntentRouterV2Enabled(explicitValue) {
  if (explicitValue !== undefined) return explicitValue === true || isTruthy(explicitValue);
  const envValue = process.env.A11_INTENT_ROUTER_V2;
  if (envValue === undefined || envValue === '') return true;
  return isTruthy(envValue);
}

function isLegacySemanticIntentFallbackEnabled(env = process.env) {
  return isTruthy(env.A11_ENABLE_LEGACY_SEMANTIC_INTENT_FALLBACK);
}

function shouldUseSemanticIntentFallback(llmIntentResult = null) {
  if (!llmIntentResult || typeof llmIntentResult !== 'object') return true;
  const reason = String(llmIntentResult.reason || '').trim().toLowerCase();
  return (
    reason === 'structured_intent_fallback'
    || reason === 'llm_unavailable_no_word_detector'
    || reason === 'llm_error_no_word_detector'
  );
}

function shouldAcceptLlmIntent(llmIntentResult = null) {
  const intent = String(llmIntentResult?.intent || '').trim();
  if (!intent) return false;
  const confidence = Number(llmIntentResult?.confidence || 0);
  if (!Number.isFinite(confidence)) return false;
  if (confidence >= 0.6) return true;
  return intent !== 'chat.reply' && confidence >= 0.5;
}

function buildTraceId(req) {
  const headerTrace = String(
    req?.headers?.['x-trace-id']
    || req?.headers?.['x-request-id']
    || ''
  ).trim();
  if (headerTrace) return headerTrace;
  return `intent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeUserText(input = {}) {
  const direct = String(
    input.userText
    || input.body?.message
    || input.body?.prompt
    || ''
  ).trim();
  if (direct) return direct;

  const messages = Array.isArray(input.messages)
    ? input.messages
    : (Array.isArray(input.body?.messages) ? input.body.messages : []);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
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

  return '';
}

function withIntentMetadata(payload, resolution) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    traceId: resolution.traceId,
    pipeline: resolution.pipeline,
    kind: resolution.kind,
  };
}

function extractSourceImageUrl(body = {}, messages = []) {
  const references = extractRequestImageReferences({
    body,
    messages,
  });
  return String(references[0]?.locator || '').trim();
}

function extractMediaMarkerUrls(messages = [], kind = '') {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (!normalizedKind) return [];
  const re = new RegExp(`\\[${normalizedKind}:([^\\]]+)\\]`, 'gi');
  const output = [];
  const seen = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const content = String(message?.content || '');
    if (!content) continue;
    let match = null;
    while ((match = re.exec(content))) {
      const url = String(match[1] || '').trim();
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(url);
      if (output.length >= 12) return output;
    }
  }
  return output;
}

function toUniqueReferenceUrls(...sources) {
  const output = [];
  const seen = new Set();
  for (const source of sources) {
    const entries = Array.isArray(source) ? source : [source];
    for (const entry of entries) {
      const url = String(entry || '').trim();
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(url);
      if (output.length >= 12) return output;
    }
  }
  return output;
}

function normalizeLookup(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isPlaceholderSourceImageSubject(value = '') {
  const normalized = normalizeLookup(value);
  if (!normalized) return false;
  if (/^(?:ce|cet|cette)\s+(?:fichier|photo|image|portrait|visuel)$/.test(normalized)) return true;
  return [
    'fichier',
    'photo',
    'image',
    'portrait',
    'visuel',
    'theme',
    'style',
    'sujet de reference',
    'personne de reference',
    'reference subject',
    'reference person',
  ].includes(normalized);
}

function shouldSkipEntityResolutionForDirectSourceImage(mask = {}) {
  if (mask?.meta?.webImageDraft?.fromChatSourceImage !== true) return false;
  const referenceRole = normalizeLookup(mask?.meta?.webImageDraft?.imageReferenceRole || '');
  if (referenceRole && !['identity', 'pose'].includes(referenceRole)) return false;
  const firstSubject = Array.isArray(mask?.inputs?.subject) ? String(mask.inputs.subject[0] || '').trim() : '';
  return !firstSubject || isPlaceholderSourceImageSubject(firstSubject);
}

function attachDirectSourceImageToMask(mask = {}, body = {}, messages = []) {
  const sourceImageUrl = extractSourceImageUrl(body, messages);
  if (!sourceImageUrl) return mask;
  if (String(mask?.intent || '').trim() !== 'image.generate') return mask;
  const imageContextCarryover = body?._a11ImageContextCarryover && typeof body._a11ImageContextCarryover === 'object'
    ? body._a11ImageContextCarryover
    : null;

  const nextMask = {
    ...(mask && typeof mask === 'object' ? mask : {}),
    meta: {
      ...((mask && mask.meta && typeof mask.meta === 'object') ? mask.meta : {}),
    },
  };
  const existingWebDraft = nextMask.meta.webImageDraft && typeof nextMask.meta.webImageDraft === 'object'
    ? nextMask.meta.webImageDraft
    : {};
  const imageReferences = extractRequestImageReferences({
    body,
    messages,
  });

  nextMask.meta.init_image_url = String(nextMask.meta.init_image_url || sourceImageUrl).trim() || sourceImageUrl;
  nextMask.meta.reference_image_url = String(nextMask.meta.reference_image_url || sourceImageUrl).trim() || sourceImageUrl;
  nextMask.meta.imageReferences = imageReferences;
  nextMask.meta.webImageDraft = {
    ...existingWebDraft,
    initImageUrl: String(existingWebDraft.initImageUrl || sourceImageUrl).trim() || sourceImageUrl,
    sourceUsed: String(existingWebDraft.sourceUsed || sourceImageUrl).trim() || sourceImageUrl,
    mode: String(existingWebDraft.mode || 'image_url').trim() || 'image_url',
    reason: String(existingWebDraft.reason || 'chat_source_image_url').trim() || 'chat_source_image_url',
    explicitReferenceAnchor: existingWebDraft.explicitReferenceAnchor !== false,
    fromChatSourceImage: true,
    ...(imageContextCarryover?.strengthProfile ? { strengthProfile: String(imageContextCarryover.strengthProfile).trim() } : {}),
    ...(imageContextCarryover?.strengthReason ? { strengthReason: String(imageContextCarryover.strengthReason).trim() } : {}),
    ...(imageContextCarryover?.strengthComponents && typeof imageContextCarryover.strengthComponents === 'object'
      ? { strengthComponents: imageContextCarryover.strengthComponents }
      : {}),
  };
  if (imageContextCarryover) {
    nextMask.meta.previousVisionAnalysis = {
      source: String(imageContextCarryover.source || 'previous_vision_analysis').trim() || 'previous_vision_analysis',
      sourceImageUrl,
      summary: String(imageContextCarryover.summary || '').trim(),
    };
    nextMask.meta.promptInstructions = [
      ...(Array.isArray(nextMask.meta.promptInstructions) ? nextMask.meta.promptInstructions : []),
      ...(Array.isArray(imageContextCarryover.promptInstructions) ? imageContextCarryover.promptInstructions : []),
    ].filter(Boolean);
  }
  if (Array.isArray(nextMask.inputs?.subject) && isPlaceholderSourceImageSubject(nextMask.inputs.subject[0] || '')) {
    nextMask.inputs.subject = ['reference subject'];
    if (nextMask.meta.canonicalSubject && isPlaceholderSourceImageSubject(nextMask.meta.canonicalSubject)) {
      delete nextMask.meta.canonicalSubject;
    }
  }
  return nextMask;
}

function isImageTransformRequest(text = '') {
  const normalized = normalizeLookup(text);
  if (!normalized) return false;
  if (/\b(video|clip|film)\b/.test(normalized)) return false;

  const referenceCue = /\b(cette|cet|ce|ces|ca|cela|celle ci|celui ci|l image|les images|la photo|les photos|le portrait|les portraits|image jointe|images jointes|photo jointe|photos jointes|reference|references|ref|refs|dessus|this|these)\b/.test(normalized);
  const transformCue = /\b(retravaille|retravailler|retouche|retoucher|modifie|modifier|change|changer|transforme|transformer|transformation|adapte|adapter|remix|recompose|recomposer|corrige|corriger|ameliore|ameliorer|refais|refaire|remake|rework|edit|modify|transform|transformation|enhance|upscale|stylise|styliser)\b/.test(normalized);
  const imageCue = /\b(images?|photos?|portraits?|visuels?|dessins?|illustrations?|fichiers?|pictures?|refs?|references?)\b/.test(normalized);
  const visualFeedbackCue = /\b(mais|par contre|sauf que|pas bon|pas bonne|pas correct|pas correcte|mauvais|mauvaise|trop|pas assez|devrait|devrais|doit|doivent|elle a|il a|ils ont|elles ont|yeux|oeil|iris|regard|cheveux|peau|visage|robe|tenue|couleur|bleu|bleue|bleus|bleues|vert|verte|verts|vertes|marron|noir|noire|roux|rousse|blond|blonde)\b/.test(normalized);

  return (transformCue && (referenceCue || imageCue)) || (visualFeedbackCue && (referenceCue || imageCue));
}

function isVisualFeedbackEditRequest(text = '') {
  const normalized = normalizeLookup(text);
  if (!normalized) return false;
  const feedbackCue = /\b(mais|par contre|sauf que|pas bon|pas bonne|pas correct|pas correcte|mauvais|mauvaise|trop|pas assez|devrait|devrais|doit|doivent|elle a|il a|ils ont|elles ont|met|mets|ajoute|retire|change|corrige)\b/.test(normalized);
  const visualAttributeCue = /\b(yeux|oeil|iris|regard|cheveux|peau|visage|bouche|nez|robe|tenue|couleur|bleu|bleue|bleus|bleues|vert|verte|verts|vertes|marron|noir|noire|roux|rousse|blond|blonde|rouge|violet|violette|grand|petit|sombre|clair)\b/.test(normalized);
  return feedbackCue && visualAttributeCue;
}

function isExplicitImageGenerationRequest(text = '') {
  const normalized = normalizeLookup(text);
  if (!normalized) return false;
  if (/\b(video|clip|film)\b/.test(normalized)) return false;

  const creationCue = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare|rends moi|fais moi|fais|fait|make|generate|create|draw)\b/.test(normalized);
  const imageCue = /\b(image|illustration|dessin|photo|visuel|portrait|artwork)\b/.test(normalized);
  const visualStyleCue = /\b(cartoon|anime|manga|pixel art|pixelart|comic|bd|rendu|render|3d|cinematique|cinematic|stylise|styliser|affiche|poster|avatar|logo)\b/.test(normalized);
  const troubleshootingCue = /\b(pourquoi|comment|probleme|bug|erreur|marche pas|fonctionne pas|peux tu|peux pas|capable|capacite)\b/.test(normalized);

  if (!creationCue || (!imageCue && !visualStyleCue)) return false;
  if (troubleshootingCue && !/\b(genere|generer|cree|creer|dessine|dessiner|generate|create|draw)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function buildClarificationPayload(clarification, semantic, traceId, pipeline) {
  const resolution = {
    traceId,
    pipeline,
    kind: 'clarification',
  };
  return withIntentMetadata({
    ok: true,
    mode: 'need_clarification',
    assistant: buildClarificationMessage(clarification),
    clarification,
    semantic: {
      topIntents: Array.isArray(semantic?.topIntents) ? semantic.topIntents.slice(0, 3) : [],
      confidence: Number(semantic?.summary?.confidence || 0),
    },
  }, resolution);
}

function shouldSurfaceCanonicalizerDiagnostic(error_ = null) {
  if (String(error_?.code || '').trim() !== 'image_request_canonicalizer_failed') return false;
  return true;
}

function buildCanonicalizerDiagnosticSummary(error_ = null) {
  const details = error_?.payload?.details && typeof error_.payload.details === 'object'
    ? error_.payload.details
    : {};
  const reasons = Array.isArray(details.reasons) ? details.reasons : [];
  const rejectedPayloads = Array.isArray(details.rejectedPayloads) ? details.rejectedPayloads : [];
  const lastRejected = rejectedPayloads.length ? rejectedPayloads[rejectedPayloads.length - 1] : null;
  const lastReason = String(lastRejected?.reason || '').trim();
  const reasonText = reasons.join(' ');
  let failedBecause = 'english_only_validation_failed_after_retry';
  if (/canonicalized_request_cardinality_conflict/i.test(lastReason)) {
    failedBecause = 'cardinality_validation_failed_after_retry';
  } else if (/canonicalized_request_missing_named_entity/i.test(lastReason)) {
    failedBecause = 'named_entity_validation_failed_after_retry';
  } else if (/structured_llm_unconfigured|llm_unavailable|missing authentication|unauthorized|llm_upstream_401|\b401\b/i.test(reasonText)) {
    failedBecause = 'canonicalizer_unavailable';
  } else if (/empty_payload|invalid_json/i.test(reasonText)) {
    failedBecause = 'canonicalizer_empty_or_invalid_response';
  } else if (/missing_canonical_english_input|missing_canonical_subject/i.test(reasonText)) {
    failedBecause = 'canonicalizer_incomplete_response';
  }
  return {
    failedBecause,
    retryCount: Math.max(0, rejectedPayloads.length - 1),
    lastAttempt: String(lastRejected?.attempt || '').trim(),
    lastReason,
    lastCanonicalEnglishInput: String(lastRejected?.payload?.canonicalEnglishInput || '').trim(),
    reasons,
  };
}

function buildCanonicalizerDiagnosticAssistant(error_ = null) {
  const details = error_?.payload?.details && typeof error_.payload.details === 'object'
    ? error_.payload.details
    : {};
  const rejectedPayloads = Array.isArray(details.rejectedPayloads) ? details.rejectedPayloads : [];
  const summary = buildCanonicalizerDiagnosticSummary(error_);
  let reasonLine = "La requete image a ete comprise, mais la normalisation canonique a encore laisse du francais dans la sortie.";
  if (summary.failedBecause === 'cardinality_validation_failed_after_retry') {
    reasonLine = "La requete image a ete comprise, mais la normalisation a essaye de reduire une scene a plusieurs sujets en sujet unique.";
  } else if (summary.failedBecause === 'named_entity_validation_failed_after_retry') {
    reasonLine = "La requete image a ete comprise, mais la normalisation a perdu ou remplace un nom explicite de ta demande.";
  } else if (summary.failedBecause === 'canonicalizer_unavailable') {
    reasonLine = "La requete image a ete comprise, mais la normalisation canonique LLM n'est pas disponible dans cet environnement.";
  } else if (summary.failedBecause === 'canonicalizer_empty_or_invalid_response') {
    reasonLine = "La requete image a ete comprise, mais la normalisation canonique LLM a renvoye une reponse vide ou invalide.";
  } else if (summary.failedBecause === 'canonicalizer_incomplete_response') {
    reasonLine = "La requete image a ete comprise, mais la normalisation canonique LLM n'a pas fourni un sujet ou un prompt anglais fiable.";
  }
  const lines = [
    reasonLine,
    summary.retryCount > 0
      ? "J'ai deja tente une seconde passe automatique, sans obtenir une sortie canonique fiable."
      : '',
    "Je prefere bloquer ici plutot que lancer une generation avec un prompt ecrase.",
    rejectedPayloads.length ? "Le detail technique complet reste disponible dans `diagnostic.rejectedPayloads`." : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildCanonicalizerDiagnosticPayload(error_ = null, traceId = '', pipeline = '', rawUserInput = '') {
  const resolution = {
    traceId,
    pipeline,
    kind: 'image.generate.diagnostic',
  };
  const details = error_?.payload?.details && typeof error_.payload.details === 'object'
    ? error_.payload.details
    : {};
  return withIntentMetadata({
    ok: true,
    mode: 'image_canonicalizer_diagnostic',
    assistant: buildCanonicalizerDiagnosticAssistant(error_),
    diagnostic: {
      error: String(error_?.code || 'image_request_canonicalizer_failed').trim() || 'image_request_canonicalizer_failed',
      message: String(error_?.message || 'image_request_canonicalizer_failed').trim() || 'image_request_canonicalizer_failed',
      rawUserInput: String(rawUserInput || '').trim(),
      stage: String(details.stage || '').trim(),
      summary: buildCanonicalizerDiagnosticSummary(error_),
      reasons: Array.isArray(details.reasons) ? details.reasons : [],
      policy: String(details.policy || '').trim(),
      rejectedPayloads: Array.isArray(details.rejectedPayloads) ? details.rejectedPayloads : [],
      upstream: details.upstream || null,
    },
  }, resolution);
}

function validateAndCompileMask(mask) {
  const validation = validateMaskUnified(mask);
  if (!validation.valid) {
    const error = new Error(validation.error || 'invalid_mask');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'invalid_mask',
      details: validation.errors || validation.error,
    };
    throw error;
  }

  return {
    validation,
    compiled: compileMaskUnified(mask),
  };
}

function buildWebImagePayload(result, subject, resolution) {
  const imageUrl = result?.image_url || null;
  const content = imageUrl
    ? `Image trouvée sur le web. [ouvrir l'image](${imageUrl})`
    : 'Image trouvée sur le web.';
  return withIntentMetadata({
    ok: true,
    artifact_type: 'web_image',
    content,
    image_url: imageUrl,
    imagePath: imageUrl,
    source_url: result?.source_url || null,
    title: result?.title || subject || null,
    width: result?.width,
    height: result?.height,
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
  }, resolution);
}

async function executeWebImageSearch(mask, duckduckgoImageSearch) {
  if (typeof duckduckgoImageSearch !== 'function') {
    const error = new Error('web_image_search_unavailable');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'web_image_search_unavailable',
      message: 'duckduckgoImageSearch handler unavailable',
    };
    throw error;
  }

  const query = String(mask?.inputs?.query || '').trim();
  if (!query) {
    const error = new Error('missing_subject');
    error.statusCode = 400;
    error.payload = { ok: false, error: 'missing_subject' };
    throw error;
  }

  return {
    subject: query,
    result: await duckduckgoImageSearch(query),
  };
}

function resolveIntentDependencies(overrides = {}) {
  return {
    createA11ImageBrain: overrides.createA11ImageBrain || defaultCreateA11ImageBrain,
    detectImageIntent: overrides.detectImageIntent || defaultDetectImageIntent,
    detectVideoIntent: overrides.detectVideoIntent || defaultDetectVideoIntent,
    detectWebImageIntent: overrides.detectWebImageIntent || defaultDetectWebImageIntent,
    duckduckgoImageSearch: overrides.duckduckgoImageSearch || defaultDuckduckgoImageSearch,
    generateSd: overrides.generateSd,
    generateVideo: overrides.generateVideo,
    textToWazaa: overrides.textToWazaa || textToWazaa,
    lookupDefinitionContext: overrides.lookupDefinitionContext || defaultLookupDefinitionContext,
    resolveImageEntityContext: overrides.resolveImageEntityContext || defaultResolveImageEntityContext,
    specialCompilerCallStructuredLlmJson: overrides.specialCompilerCallStructuredLlmJson,
    readPreferredImageHintMemory: overrides.readPreferredImageHintMemory || defaultReadPreferredImageHintMemory,
    smoothRequestText: overrides.smoothRequestText || defaultSmoothRequestText,
    canonicalizeImageGenerateRequest: overrides.canonicalizeImageGenerateRequest || defaultCanonicalizeImageGenerateRequest,
    hasCustomImageCanonicalizer: typeof overrides.canonicalizeImageGenerateRequest === 'function',
    classifyReferenceImages: overrides.classifyReferenceImages || defaultClassifyReferenceImages,
    detectIntentWithLlm: overrides.detectIntentWithLlm || defaultDetectIntentWithLlm,
  };
}

function createImageBrainRuntime(deps = {}) {
  if (typeof deps.createA11ImageBrain !== 'function') return null;
  return deps.createA11ImageBrain({
    detectImageIntent: deps.detectImageIntent,
    detectWebImageIntent: deps.detectWebImageIntent,
    duckduckgoImageSearch: deps.duckduckgoImageSearch,
    generateSd: deps.generateSd,
  });
}

async function executeResolvedRuntime(resolution, input = {}, deps = {}) {
  if (!resolution || typeof resolution !== 'object') return resolution;

  if (resolution.kind === 'image.generate') {
    // PIPELINE ACTIF : executeDirectImagePipeline (image-pipeline-direct.cjs)
    // Chemin : message brut → LLM structuré (Groq 70B si A11_IMAGE_DIRECT_GROQ_ENABLED=1) → prompt SD → generateSd → Kontext si init_image_url
    //
    // Chemin alternatif (NON actif ici) : a11-image-brain → buildCanonicalImageMaskFromText → wazaa/mask → generateImageFromMask
    // Ce chemin passe par sd-tools.cjs et utilise le canonicalizer + mask enrichi.
    // Pour activer l'ancien chemin, le kind doit être routé vers createImageBrainRuntime (voir deps.createA11ImageBrain).
    //
    // Décision de commutation : toute résolution kind=image.generate passe par le chemin direct.
    // Si besoin de revenir au chemin mask, changer l'appel ci-dessous vers deps.imageBrainRuntime.planRequest().
    const imageReferences = extractRequestImageReferences({
      body: input.body || {},
      messages: Array.isArray(input.messages) ? input.messages : [],
    });
    const referenceImageUrl = String(imageReferences[0]?.locator || '').trim();
    const isLocalPath = referenceImageUrl && !referenceImageUrl.startsWith('http');
    const publicReferenceImageUrl = isLocalPath ? '' : referenceImageUrl;

    let imageContextCarryover = input.body?._a11ImageContextCarryover || resolution.imageContextCarryover || null;

    // Pas de carryover vision mais image de référence HTTP → décrire via Janus.
    // Fallback gratuit à Kontext : enrichit le prompt pour mieux préserver l'identité du sujet.
    if (publicReferenceImageUrl && !imageContextCarryover) {
      try {
        const runtimeRootForDescribe = String(
          process.env.A11_RUNTIME_ROOT
          || require('node:path').resolve(__dirname, '..', '..', '..', 'runtime')
        ).trim();
        const describeResult = await autoDescribeImage({
          imageLocator: publicReferenceImageUrl,
          runtimeRoot: runtimeRootForDescribe,
          timeoutMs: 5000,
          requestId: `ref-img-describe-${Date.now()}`,
        });
        if (!describeResult.skipped && describeResult.description) {
          console.log(`[A11][ref-describe] enriching image prompt: "${describeResult.description.slice(0, 80)}"`);
          imageContextCarryover = {
            source: 'reference_image_describe',
            sourceImageUrl: publicReferenceImageUrl,
            summary: describeResult.description,
            promptInstructions: [
              'preserve the identity, model, and visual appearance of the subject from the reference image',
              'apply only the new background, setting, or style requested by the user',
              'keep the same vehicle, person, or object identity from the reference',
            ],
            strengthProfile: 'preserve',
            strengthReason: 'reference_image_describe',
          };
        }
      } catch {
        // ok, continue without enrichment
      }
    }

    const imageResult = await executeDirectImagePipeline({
      userMessage: resolution.requestText?.original || normalizeUserText(input),
      referenceImageUrl: publicReferenceImageUrl,
      referenceImagePath: isLocalPath ? referenceImageUrl : '',
      imageContextCarryover,
      req: input.req,
      generateSd: deps.generateSd,
      callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
      timeoutMs: 25000,
    });
    return {
      ...resolution,
      responsePayload: withIntentMetadata({
        ...toImageChatProxyPayload({
          sdResult: {
            ...(imageResult.sdResult && typeof imageResult.sdResult === 'object' ? imageResult.sdResult : {}),
            ok: imageResult.ok,
            artifact_type: imageResult.artifact_type || 'image',
            image_url: imageResult.image_url || imageResult.url || null,
            url: imageResult.url || imageResult.image_url || null,
            filename: imageResult.filename || imageResult.sdResult?.filename || null,
            prompt: imageResult.prompt || imageResult.sdResult?.prompt || null,
            subject: imageResult.subject || null,
            tool: imageResult.sdResult?.tool || imageResult.tool || 'generate_image',
            mode: imageResult.sdResult?.mode || imageResult.mode || 'direct-image-pipeline',
          },
        }),
        prompt: imageResult.prompt,
        subject: imageResult.subject,
        requestStyle: imageResult.style || null,
      }, resolution),
      runtime: imageResult,
    };
  }

  if (resolution.kind === 'video.generate') {
    if (typeof deps.generateVideo !== 'function') {
      const error = new Error('video_engine_unavailable');
      error.statusCode = 500;
      error.payload = {
        ok: false,
        error: 'video_engine_unavailable',
        message: 'generateVideo handler unavailable',
      };
      throw error;
    }

    // Extraire les images de référence du message (tokens [image:...])
    // et les injecter dans le body vidéo pour que Janus puisse les analyser.
    const videoImageRefs = extractRequestImageReferences({
      body: input.body || {},
      messages: Array.isArray(input.messages) ? input.messages : [],
    });
    const firstVideoImageRef = String(videoImageRefs[0]?.locator || '').trim();
    const allVideoImageUrls = videoImageRefs.map((r) => r.locator).filter(Boolean);
    const messageAudioRefs = extractMediaMarkerUrls(input.messages, 'audio');
    const messageVideoRefs = extractMediaMarkerUrls(input.messages, 'video');
    const resolvedReferenceAudioUrls = toUniqueReferenceUrls(
      resolution.videoRequest?.referenceAudioUrls,
      input.body?.referenceAudioUrls,
      input.body?.reference_audio_urls,
      resolution.videoRequest?.audioUrl,
      input.body?.audioUrl,
      input.body?.audio_url,
      messageAudioRefs
    );
    const resolvedReferenceVideoUrls = toUniqueReferenceUrls(
      resolution.videoRequest?.referenceVideoUrls,
      input.body?.referenceVideoUrls,
      input.body?.reference_video_urls,
      resolution.videoRequest?.sourceVideoUrl,
      input.body?.sourceVideoUrl,
      input.body?.source_video_url,
      messageVideoRefs
    );

    // sourceImageUrl : priorité à ce qui est déjà dans videoRequest, sinon première image du message
    const resolvedSourceImageUrl = String(resolution.videoRequest?.sourceImageUrl || firstVideoImageRef || '').trim();
    // data: URIs are valid for remote APIs (Replicate accepts them); only treat actual file paths as local
    const isDataUrl = resolvedSourceImageUrl.startsWith('data:');
    const isLocalVideoRef = resolvedSourceImageUrl && !resolvedSourceImageUrl.startsWith('http') && !isDataUrl;
    console.log(`[A11][video-resolve] sourceImageUrl="${resolvedSourceImageUrl.slice(0, 80)}" isLocal=${isLocalVideoRef} isData=${isDataUrl}`);
    let compiledVisualContext = String(
      resolution.videoRequest?.compiledVisualContext
      || input.body?.compiledVisualContext
      || input.body?.referenceVisualContext
      || input.body?.reference_visual_context
      || input.body?._a11ImageContextCarryover?.summary
      || ''
    ).trim();
    const canAutoDescribeVideoReference = /^https?:\/\//i.test(resolvedSourceImageUrl);
    if (canAutoDescribeVideoReference && !compiledVisualContext) {
      try {
        const runtimeRootForDescribe = String(
          process.env.A11_RUNTIME_ROOT
          || require('node:path').resolve(__dirname, '..', '..', '..', 'runtime')
        ).trim();
        const describeResult = await autoDescribeImage({
          imageLocator: resolvedSourceImageUrl,
          runtimeRoot: runtimeRootForDescribe,
          timeoutMs: 7000,
          requestId: `video-ref-describe-${Date.now()}`,
          prompt: [
            'Describe the visible person or subject, face traits, clothing, pose, room/decor, lighting, and camera angle for a video generation reference.',
            'Be concrete and concise. Do not invent hidden details.',
          ].join(' '),
          visionProvider: 'remote',
          preferRemoteVision: true,
        });
        if (!describeResult.skipped && describeResult.description) {
          compiledVisualContext = String(describeResult.description || '').trim().slice(0, 1200);
          console.log(`[A11][video-ref-describe] "${compiledVisualContext.slice(0, 90)}"`);
        }
      } catch (error_) {
        console.warn('[A11][video-ref-describe] skipped:', String(error_?.message || error_));
      }
    }

    const videoResult = await deps.generateVideo({
      req: input.req,
      prompt: resolution.videoRequest?.prompt || input.body?.prompt || '',
      body: {
        ...(input.body || {}),
        // Depuis le chat, eviter le timeout 60s en laissant la route video creer un job.
        acceptAsyncVideoJob: true,
        mobileAsync: true,
        prompt: resolution.videoRequest?.prompt || input.body?.prompt || '',
        durationSeconds: resolution.videoRequest?.durationSeconds,
        fps: resolution.videoRequest?.fps,
        format: resolution.videoRequest?.format,
        width: resolution.videoRequest?.width,
        height: resolution.videoRequest?.height,
        sourceType: resolution.videoRequest?.sourceType,
        sourceUrl: resolution.videoRequest?.sourceUrl,
        sourcePath: resolution.videoRequest?.sourcePath,
        // Injecter les images de référence extraites du message
        sourceImageUrl: isLocalVideoRef ? '' : resolvedSourceImageUrl,
        sourceImagePath: isLocalVideoRef ? resolvedSourceImageUrl : (resolution.videoRequest?.sourceImagePath || ''),
        sourceVideoUrl: resolution.videoRequest?.sourceVideoUrl || resolvedReferenceVideoUrls[0] || '',
        sourceVideoPath: resolution.videoRequest?.sourceVideoPath,
        audioUrl: resolvedReferenceAudioUrls[0] || '',
        referenceAudioUrls: resolvedReferenceAudioUrls,
        referenceVideoUrls: resolvedReferenceVideoUrls,
        // Toutes les images pour le contexte multi-référence
        referenceImageUrls: allVideoImageUrls.length > 1 ? allVideoImageUrls : undefined,
        // Contexte visuel enrichi par les descriptions Janus des images de référence
        compiledVisualContext: compiledVisualContext || undefined,
        referenceVisualContext: compiledVisualContext || undefined,
      },
    });
    return {
      ...resolution,
      responsePayload: withIntentMetadata(toVideoChatProxyPayload(videoResult), resolution),
      runtime: videoResult,
    };
  }

  if (resolution.kind === 'web.image.search') {
    if (resolution.imageBrainDecision?.handled) {
      const imageBrain = createImageBrainRuntime(deps);
      const webImage = await imageBrain.executePlan({
        req: input.req,
        decision: resolution.imageBrainDecision,
      });
      return {
        ...resolution,
        responsePayload: buildWebImagePayload(webImage.result, webImage.subject, resolution),
        runtime: webImage,
        subject: webImage.subject,
      };
    }
    const webImage = await executeWebImageSearch(resolution.mask, deps.duckduckgoImageSearch);
    return {
      ...resolution,
      responsePayload: buildWebImagePayload(webImage.result, webImage.subject, resolution),
      runtime: webImage,
      subject: webImage.subject,
    };
  }

  return resolution;
}

function createIntentResolver(overrides = {}) {
  const deps = resolveIntentDependencies(overrides);

  async function resolveUserRequest(input = {}) {
    const traceId = buildTraceId(input.req);
    const originalUserText = normalizeUserText(input);
    const messages = Array.isArray(input.messages)
      ? input.messages
      : (Array.isArray(input.body?.messages) ? input.body.messages : []);
    const pipeline = 'intent-router-v2';

    // ─── Auto-description Janus ───────────────────────────────────────────────
    // Quand l'utilisateur envoie une image sans texte, Janus l'analyse et produit
    // une description qui sert de message pour le reste du pipeline.
    let effectiveUserText = originalUserText;
    let autoDescribeResult = null;
    if (!originalUserText) {
      const imageRefsEarly = extractRequestImageReferences({
        body: input.body || {},
        messages,
      });
      const firstLocator = String(imageRefsEarly[0]?.locator || '').trim();
      if (firstLocator) {
        const runtimeRoot = String(
          process.env.A11_RUNTIME_ROOT
          || require('node:path').resolve(__dirname, '..', '..', '..', 'runtime')
        ).trim();
        autoDescribeResult = await autoDescribeImage({
          imageLocator: firstLocator,
          runtimeRoot,
          timeoutMs: 30000,
          requestId: traceId,
        });
        if (!autoDescribeResult.skipped && autoDescribeResult.description) {
          effectiveUserText = buildAutoDescribeUserMessage(autoDescribeResult.description);
          console.log(`[A11][auto-describe] traceId=${traceId} image described, effectiveText="${effectiveUserText.slice(0, 100)}"`);
        }
      }
    }

    // Si toujours pas de texte après auto-describe, erreur
    if (!effectiveUserText) {
      const error = new Error('missing_message');
      error.statusCode = 400;
      error.payload = { ok: false, error: 'missing_message' };
      throw error;
    }

    const requestTextSmootherResult = typeof deps.smoothRequestText === 'function'
      ? await deps.smoothRequestText(effectiveUserText, {
        source: 'resolve-user-request',
      })
      : {
        originalText: effectiveUserText,
        text: effectiveUserText,
        changed: false,
        usedLlm: false,
        localCorrections: [],
        suspiciousTokens: [],
        noiseScore: 0,
      };
    const userText = String(requestTextSmootherResult?.text || effectiveUserText).trim();

    const semantic = analyzeSemanticIntent(userText, {
      detectImageIntent: deps.detectImageIntent,
      detectVideoIntent: deps.detectVideoIntent,
      detectWebImageIntent: deps.detectWebImageIntent,
      messages,
      traceId,
    });
    const clarification = semantic?.decision || null;

    // Détection d'intent analytique via LLM — override la décision sémantique heuristique
    // quand la confiance est suffisante. Séquentiel, timeout court pour ne pas bloquer.
    // On passe la description Janus et l'historique récent pour que le LLM décide
    // correctement (ex: "regarde ce beau lapin" + image → chat.reply, pas image.generate).
    const conversationHistoryForIntent = messages
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .slice(-6)
      .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 200) }));

    let llmIntentResult = null;
    try {
      llmIntentResult = await deps.detectIntentWithLlm({
        message: userText,
        imageDescription: autoDescribeResult?.description || '',
        conversationHistory: conversationHistoryForIntent,
        callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
        timeoutMs: 6000,
      });
    } catch (intentError) {
      console.warn(`[A11][intent-detection] LLM intent detection failed: ${String(intentError?.message || intentError)}`);
    }

    // Résoudre l'intent final : LLM si confiance >= 0.75, sinon sémantique heuristique
    const earlyImageReferencesForIntent = extractRequestImageReferences({
      body: input.body || {},
      messages,
    });
    const hasReferenceImageForRequest = earlyImageReferencesForIntent.length > 0;
    const allowLegacySemanticFallback = isLegacySemanticIntentFallbackEnabled();
    const allowSafeSemanticFallback = shouldUseSemanticIntentFallback(llmIntentResult);
    const allowVisualImageBrainFallback = input.allowVisualImageBrainFallback === true;
    const llmIntentType = shouldAcceptLlmIntent(llmIntentResult) ? llmIntentResult.intent : null;
    const semanticIntentType = clarification?.selectedIntentType || semantic?.topIntents?.[0]?.type || 'chat.reply';
    const allowSemanticIntentFallback = allowLegacySemanticFallback || shouldUseSemanticIntentFallback(llmIntentResult);
    const selectedIntentType = llmIntentType || (allowSemanticIntentFallback ? semanticIntentType : 'chat.reply');

    if (llmIntentResult) {
      console.log(
        `[A11][intent] llm=${llmIntentResult.intent}(${llmIntentResult.confidence.toFixed(2)})`
        + ` semantic=${semanticIntentType}`
        + ` final=${selectedIntentType}`
        + ` reason=${llmIntentResult.reason}`
      );
    }

    if (allowSemanticIntentFallback && clarification?.shouldClarify && !llmIntentType) {
      return {
        traceId,
        pipeline,
        kind: 'clarification',
        semantic,
        clarification,
        responsePayload: buildClarificationPayload(clarification, semantic, traceId, pipeline),
      };
    }

    const shouldConsultImageBrain = (
      selectedIntentType === 'chat.reply'
      && (allowSemanticIntentFallback || (allowVisualImageBrainFallback && isExplicitImageGenerationRequest(userText)))
      && (!llmIntentType || llmIntentType === 'chat.reply' || shouldUseSemanticIntentFallback(llmIntentResult))
    );
    if (shouldConsultImageBrain) {
      const imageBrain = createImageBrainRuntime(deps);
      const imageBrainDecision = imageBrain?.planRequest(userText);

      if (imageBrainDecision?.handled && imageBrainDecision.mode === 'clarify') {
        return {
          traceId,
          pipeline,
          kind: 'clarification',
          semantic,
          clarification: imageBrainDecision.clarification,
          imageBrainDecision,
          responsePayload: buildClarificationPayload(
            imageBrainDecision.clarification,
            imageBrainDecision.semantic || semantic,
            traceId,
            pipeline
          ),
        };
      }

      if (imageBrainDecision?.handled && imageBrainDecision.mode === 'generate') {
        let resolution = {
          traceId,
          pipeline,
          kind: 'image.generate',
          semantic,
          imageBrainDecision,
          responsePayload: null,
          requestText: {
            original: effectiveUserText,
            smoothed: userText,
            changed: requestTextSmootherResult?.changed === true,
            autoDescribed: autoDescribeResult?.skipped === false,
            autoDescription: autoDescribeResult?.description || null,
          },
        };

        if (input.executeRuntime === true || input.executeImage === true) {
          resolution = await executeResolvedRuntime(resolution, input, deps);
        }

        return resolution;
      }

      if (imageBrainDecision?.handled && imageBrainDecision.mode === 'web_search') {
        let resolution = {
          traceId,
          pipeline,
          kind: 'web.image.search',
          semantic,
          imageBrainDecision,
          responsePayload: null,
          requestText: {
            original: effectiveUserText,
            smoothed: userText,
            changed: requestTextSmootherResult?.changed === true,
            autoDescribed: autoDescribeResult?.skipped === false,
            autoDescription: autoDescribeResult?.description || null,
          },
        };

        if (input.executeRuntime === true || input.executeWebSearch === true) {
          resolution = await executeResolvedRuntime(resolution, input, deps);
        }

        return resolution;
      }
    }

    if (selectedIntentType === 'video.generate') {
      // Extraire les images de référence du message pour enrichir le prompt vidéo
      const videoImageRefsEarly = extractRequestImageReferences({
        body: input.body || {},
        messages,
      });

      // Décrire les images de référence avec Janus pour enrichir le contexte vidéo
      // (ex: "ces deux soldats" → Janus décrit ce qu'il voit sur les images)
      const runtimeRootForVideo = String(
        process.env.A11_RUNTIME_ROOT
        || require('node:path').resolve(__dirname, '..', '..', '..', 'runtime')
      ).trim();

      const videoImageDescriptions = (
        await Promise.allSettled(
          videoImageRefsEarly.slice(0, 3).map((ref) =>
            autoDescribeImage({
              imageLocator: ref.locator,
              runtimeRoot: runtimeRootForVideo,
              timeoutMs: 7000,
              requestId: `${traceId}-video-ref-${ref.image_id}`,
            }).then((desc) => {
              if (!desc.skipped && desc.description) {
                console.log(`[A11][video-ref-describe] ${ref.image_id}: "${desc.description.slice(0, 80)}"`);
                return desc.description;
              }
              return null;
            })
          )
        )
      )
        .filter((r) => r.status === 'fulfilled' && r.value)
        .map((r) => r.value);

      // Enrichir le prompt vidéo avec les descriptions des images de référence
      const videoRequest = parseVideoGenerateRequest(userText, input.body || {});
      if (videoImageDescriptions.length > 0) {
        const refContext = videoImageDescriptions.length === 1
          ? `Reference image: ${videoImageDescriptions[0]}`
          : videoImageDescriptions.map((d, i) => `Reference image ${i + 1}: ${d}`).join('. ');
        videoRequest.compiledVisualContext = refContext;
        console.log(`[A11][video-ref-describe] visual context injected: "${refContext.slice(0, 120)}"`);
      }

      let resolution = {
        traceId,
        pipeline,
        kind: 'video.generate',
        semantic,
        videoRequest,
        responsePayload: null,
        requestText: {
          original: effectiveUserText,
          smoothed: userText,
          changed: requestTextSmootherResult?.changed === true,
          autoDescribed: autoDescribeResult?.skipped === false,
          autoDescription: autoDescribeResult?.description || null,
        },
      };

      if (input.executeRuntime === true) {
        resolution = await executeResolvedRuntime(resolution, input, deps);
      }

      return resolution;
    }

    // ─── Pipeline image direct ────────────────────────────────────────────────
    // 1 LLM call → prompt SD → génération. Pas de canonicalizer, wazaa, mask.
    if (selectedIntentType === 'image.generate' && (input.executeRuntime === true || input.executeImage === true)) {
      const imageReferences = extractRequestImageReferences({
        body: input.body || {},
        messages: Array.isArray(input.messages) ? input.messages : [],
      });
      const referenceLocator = String(imageReferences[0]?.locator || '').trim();
      const isLocalPath = referenceLocator && !referenceLocator.startsWith('http');

      let resolution = {
        traceId,
        pipeline,
        kind: 'image.generate',
        semantic,
        responsePayload: null,
        requestText: {
          original: effectiveUserText,
          smoothed: userText,
          changed: requestTextSmootherResult?.changed === true,
          autoDescribed: autoDescribeResult?.skipped === false,
          autoDescription: autoDescribeResult?.description || null,
        },
        referenceImageUrl: isLocalPath ? '' : referenceLocator,
        referenceImagePath: isLocalPath ? referenceLocator : '',
      };

      if (input.executeRuntime === true || input.executeImage === true) {
        resolution = await executeResolvedRuntime(resolution, input, deps);
      }

      return resolution;
    }

    // ─── Autres intents (web search, code, chat) ──────────────────────────────
    const textToWazaaAdapter = deps.textToWazaa || textToWazaa;
    const imageReferences = extractRequestImageReferences({
      body: input.body || {},
      messages: Array.isArray(input.messages) ? input.messages : [],
    });
    const wazaaSourceText = userText;

    const heuristicWazaa = typeof textToWazaaAdapter?.sync === 'function'
      ? textToWazaaAdapter.sync(wazaaSourceText, {
        analysis: semantic,
        source: 'resolve-user-request',
        requestTextSmootherResult,
      })
      : null;
    let definitionContext = null;
    if (shouldLookupDefinitionContext({
      userText: wazaaSourceText,
      semanticAnalysis: semantic,
      heuristicWazaa,
    })) {
      const lookupQuery = buildDefinitionLookupQuery({
        userText: wazaaSourceText,
        semanticAnalysis: semantic,
        heuristicWazaa,
      });
      if (lookupQuery && typeof deps.lookupDefinitionContext === 'function') {
        try {
          definitionContext = await deps.lookupDefinitionContext({
            query: lookupQuery,
            userText: wazaaSourceText,
            traceId,
          });
        } catch (error_) {
          console.warn(`[A11][definition-lookup] traceId=${traceId} query=${lookupQuery} error=${String(error_?.message || error_)}`);
        }
      }
    }

    const wazaa = await textToWazaaAdapter(wazaaSourceText, {
      analysis: semantic,
      source: 'resolve-user-request',
      requestTextSmootherResult,
    });
    const effectiveWazaa = mergeDefinitionContextIntoWazaa(wazaa || heuristicWazaa, definitionContext, wazaaSourceText);

    let mask = wazaaToMask(effectiveWazaa, {
      sourceText: wazaaSourceText,
      intentType: selectedIntentType,
      semanticAnalysis: semantic,
    });

    let imageReferenceResolution = null;
    let imageRequestMode = null;
    let canonicalizedImageRequest = null;
    let imageRequestTextSmootherResult = null;

    const imageCanonalizerDisabled = String(process.env.A11_IMAGE_CANONICALIZER_DISABLED || '').trim().toLowerCase();
    const shouldCanonicalizeImageRequest = !['1', 'true', 'yes', 'on'].includes(imageCanonalizerDisabled)
      && (
        deps.hasCustomImageCanonicalizer === true
        || input.canonicalizeImage === true
        || input.executeRuntime === true
        || input.executeImage === true
      );

    if (String(mask?.intent || '').trim() === 'image.generate' && shouldCanonicalizeImageRequest) {
      const primaryReferenceUrl = String(imageReferences[0]?.locator || '').trim();
      try {
        canonicalizedImageRequest = await deps.canonicalizeImageGenerateRequest(userText, {
          stage: 'resolve-user-request',
          callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
          referenceImagePresent: Boolean(primaryReferenceUrl),
          referenceImageUrl: primaryReferenceUrl,
        });
      } catch (error_) {
        if (shouldSurfaceCanonicalizerDiagnostic(error_)) {
          return {
            traceId,
            pipeline,
            kind: 'image.generate.diagnostic',
            semantic,
            responsePayload: buildCanonicalizerDiagnosticPayload(error_, traceId, pipeline, userText),
            requestText: {
              original: originalUserText,
              smoothed: userText,
              changed: requestTextSmootherResult?.changed === true,
            },
          };
        }
        throw error_;
      }

      if (canonicalizedImageRequest?.needsClarification === true) {
        const canonicalClarification = {
          shouldClarify: true,
          selectedIntentType: 'image.generate',
          question: canonicalizedImageRequest.clarificationQuestion || 'Do you want a single subject or multiple subjects in the image?',
        };
        return {
          traceId,
          pipeline,
          kind: 'clarification',
          semantic,
          clarification: canonicalClarification,
          responsePayload: buildClarificationPayload(canonicalClarification, semantic, traceId, pipeline),
        };
      }

      if (canonicalizedImageRequest && typeof canonicalizedImageRequest === 'object') {
        imageRequestTextSmootherResult = buildCanonicalizedRequestTextSmootherResult(canonicalizedImageRequest);
        mask = applyCanonicalizedImageGenerateRequestToMask(mask, canonicalizedImageRequest);
        const canonicalSourceText = String(
          imageRequestTextSmootherResult?.text
          || imageRequestTextSmootherResult?.smoothedText
          || canonicalizedImageRequest?.canonicalEnglishInput
          || ''
        ).trim();
        if (canonicalSourceText) {
          mask.meta = mask.meta && typeof mask.meta === 'object' ? mask.meta : {};
          mask.meta.originalSourceText = canonicalSourceText;
          mask.meta.requestTextSmoother = {
            ...((mask.meta.requestTextSmoother && typeof mask.meta.requestTextSmoother === 'object')
              ? mask.meta.requestTextSmoother
              : {}),
            ...imageRequestTextSmootherResult,
            smoothedText: canonicalSourceText,
          };
        }
      }
    }

    mask = attachDirectSourceImageToMask(
      mask,
      input.body || {},
      Array.isArray(input.messages) ? input.messages : []
    );

    if (String(mask?.intent || '').trim() === 'image.generate') {
      if (imageReferences.length > 0) {
        let referenceDecision = null;
        const classification = typeof deps.classifyReferenceImages === 'function'
          ? await deps.classifyReferenceImages({
              references: imageReferences,
              requestId: traceId,
            })
          : null;

        if (classification?.skipped === true) {
          referenceDecision = buildAutomaticImageReferenceFallbackDecision({
            references: imageReferences,
            reason: classification.reason || 'reference_classifier_skipped',
          });
        } else {
          referenceDecision = classification;
        }

        if (referenceDecision?.clarification_required === true || referenceDecision?.clarificationRequired === true) {
          const referenceClarification = {
            shouldClarify: true,
            selectedIntentType: 'image.generate',
            question: String(
              referenceDecision.clarification_question
              || referenceDecision.clarificationQuestion
              || 'Quelle image doit rester la référence principale ?'
            ).trim(),
          };
          return {
            traceId,
            pipeline,
            kind: 'clarification',
            semantic,
            clarification: referenceClarification,
            imageReferenceResolution: referenceDecision,
            responsePayload: buildClarificationPayload(referenceClarification, semantic, traceId, pipeline),
          };
        }

        if (referenceDecision && typeof referenceDecision === 'object') {
          mask = applyImageReferenceDecisionToMask(mask, referenceDecision, imageReferences);
          imageReferenceResolution = referenceDecision;
        }
      }

      imageRequestMode = resolveImageRequestMode({
        rawMask: mask,
        req: input.req,
        explicitMode: input.body?.mode || input.body?.image_mode || '',
      });
      mask.meta = mask.meta && typeof mask.meta === 'object' ? mask.meta : {};
      mask.meta.imageRequestMode = imageRequestMode.mode;

      if (imageRequestMode.mode === 'smart' && !shouldSkipEntityResolutionForDirectSourceImage(mask)) {
        let entityContext = null;
        try {
          entityContext = await deps.resolveImageEntityContext({
            mask,
            lookupDefinitionContext: deps.lookupDefinitionContext,
          });
        } catch (error_) {
          console.warn(`[A11][image-entity] traceId=${traceId} error=${String(error_?.message || error_)}`);
        }
        if (entityContext && typeof entityContext === 'object') {
          mask = enrichImageMaskWithScratchpad(mask, {
            entityContext,
          });
          mask.meta.imageRequestMode = imageRequestMode.mode;
        }
      }
    }

    if (!mask) {
      const error = new Error('invalid_mask');
      error.statusCode = 400;
      error.payload = { ok: false, error: 'invalid_mask' };
      throw error;
    }

    const { compiled } = validateAndCompileMask(mask);
    const kind = String(mask.intent || '').trim() || 'chat.reply';
    const imageCompilerSelection = kind === 'image.generate'
      ? resolveImageCompilerCompartment(mask, {
        callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
        pipelineMode: imageRequestMode?.mode || undefined,
      })
      : null;

    let resolution = {
      traceId,
      pipeline,
      kind,
      semantic,
      wazaa: effectiveWazaa,
      mask,
      compiled,
      maskSource: 'wazaa',
      fallbackUsed: null,
      imageRequestMode: imageRequestMode?.mode || undefined,
      imageCompilerSelection: imageCompilerSelection || undefined,
      shouldBypassImageRequestCache: imageCompilerSelection?.shouldBypassCache === true || undefined,
      imageReferenceResolution,
      canonicalizedImageRequest,
      responsePayload: null,
      requestText: {
        original: originalUserText,
        smoothed: userText,
        changed: requestTextSmootherResult?.changed === true,
        ...(imageRequestTextSmootherResult ? { canonical: imageRequestTextSmootherResult } : {}),
      },
    };

    if (kind === 'code.python.generate' && compiled?.target === 'python') {
      resolution.code = compiled.value;
    }

    if (kind === 'chat.reply' && input.includeChatReplyPayload === true) {
      resolution.responsePayload = withIntentMetadata({
        ok: true,
        mode: 'chat_reply',
        message: String(mask?.inputs?.message || userText).trim(),
      }, resolution);
    }

    if (input.executeRuntime === true) {
      resolution = await executeResolvedRuntime(resolution, input, deps);
    } else if ((kind === 'web.image.search' || kind === 'web.search') && input.executeWebSearch === true) {
      // web.search : exécuter la recherche et injecter les résultats dans le contexte LLM
      if (kind === 'web.search') {
        try {
          const query = String(mask?.inputs?.query || mask?.raw || userText).trim();
          const { t_web_search } = require('./a11/tools-dispatcher.cjs');
          const { buildWebGuide, formatWebGuideShort, enrichWebGuideWithJanus } = require('../lib/web-guide.cjs');
          const searchResults = typeof t_web_search === 'function'
            ? await t_web_search({ query, limit: 8 })
            : null;

          if (searchResults?.results?.length > 0) {
            let guide = buildWebGuide(query, searchResults.results);

            // Enrichir avec Janus si des images sont présentes (non-bloquant)
            try {
              guide = await enrichWebGuideWithJanus(guide, { maxImages: 2, timeoutMs: 8000 });
            } catch (_) {
              // Janus indisponible — on continue sans
            }

            const shortFormat = formatWebGuideShort(query, guide.sections);

            resolution.webSearchResults = searchResults.results;
            resolution.webGuide = guide;
            resolution.responsePayload = {
              ok: true,
              mode: 'web_search',
              query,
              results: searchResults.results,
              guide,
              webContext: guide.formatted,
              assistant: shortFormat,
            };
          } else {
            resolution.responsePayload = {
              ok: false,
              mode: 'web_search',
              query,
              results: [],
              assistant: `Je n'ai pas trouvé de résultats pour "${query}".`,
            };
          }
        } catch (searchErr) {
          console.error('[web.search] Erreur:', searchErr.message);
          resolution.responsePayload = {
            ok: false,
            mode: 'web_search',
            error: searchErr.message,
            assistant: `La recherche web a échoué : ${searchErr.message}`,
          };
        }
      } else {
        resolution = await executeResolvedRuntime(resolution, input, deps);
      }
    }

    return resolution;
  }

  return {
    resolveUserRequest,
    executeResolvedRuntime: (resolution, input = {}) => executeResolvedRuntime(resolution, input, deps),
  };
}

function summarizeIntentResolution(resolution = {}) {
  return {
    traceId: String(resolution.traceId || '').trim(),
    pipeline: String(resolution.pipeline || '').trim(),
    kind: String(resolution.kind || '').trim(),
    maskIntent: String(resolution.mask?.intent || '').trim(),
    compiledTarget: String(resolution.compiled?.target || '').trim(),
    semanticTopIntents: Array.isArray(resolution.semantic?.topIntents)
      ? resolution.semantic.topIntents.slice(0, 3)
      : [],
  };
}

module.exports = {
  buildTraceId,
  createIntentResolver,
  executeResolvedRuntime,
  isIntentRouterV2Enabled,
  normalizeUserText,
  summarizeIntentResolution,
};

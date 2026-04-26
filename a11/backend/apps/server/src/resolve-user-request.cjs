const crypto = require('node:crypto');

const analyzeSemanticIntent = require('./mask/semantic/analyze-semantic-intent.cjs');
const compileMaskUnified = require('./mask/compile-mask-unified.cjs');
const {
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
  };
  if (Array.isArray(nextMask.inputs?.subject) && isPlaceholderSourceImageSubject(nextMask.inputs.subject[0] || '')) {
    nextMask.inputs.subject = ['reference subject'];
    if (nextMask.meta.canonicalSubject && isPlaceholderSourceImageSubject(nextMask.meta.canonicalSubject)) {
      delete nextMask.meta.canonicalSubject;
    }
  }
  return nextMask;
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
  const reasons = Array.isArray(error_?.payload?.details?.reasons) ? error_.payload.details.reasons : [];
  return reasons.some((entry) => (
    /canonicalized_request_not_english_only/i.test(String(entry || ''))
    || /canonicalized_request_cardinality_conflict/i.test(String(entry || ''))
    || /canonicalized_request_missing_named_entity/i.test(String(entry || ''))
  ));
}

function buildCanonicalizerDiagnosticSummary(error_ = null) {
  const details = error_?.payload?.details && typeof error_.payload.details === 'object'
    ? error_.payload.details
    : {};
  const reasons = Array.isArray(details.reasons) ? details.reasons : [];
  const rejectedPayloads = Array.isArray(details.rejectedPayloads) ? details.rejectedPayloads : [];
  const lastRejected = rejectedPayloads.length ? rejectedPayloads[rejectedPayloads.length - 1] : null;
  const lastReason = String(lastRejected?.reason || '').trim();
  const failedBecause = /canonicalized_request_cardinality_conflict/i.test(lastReason)
    ? 'cardinality_validation_failed_after_retry'
    : (/canonicalized_request_missing_named_entity/i.test(lastReason)
        ? 'named_entity_validation_failed_after_retry'
        : 'english_only_validation_failed_after_retry');
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
  const reasonLine = summary.failedBecause === 'cardinality_validation_failed_after_retry'
    ? "La requete image a ete comprise, mais la normalisation a essaye de reduire une scene a plusieurs sujets en sujet unique."
    : (summary.failedBecause === 'named_entity_validation_failed_after_retry'
        ? "La requete image a ete comprise, mais la normalisation a perdu ou remplace un nom explicite de ta demande."
        : "La requete image a ete comprise, mais la normalisation canonique a encore laisse du francais dans la sortie.");
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
    classifyReferenceImages: overrides.classifyReferenceImages || defaultClassifyReferenceImages,
    detectIntentWithLlm: overrides.detectIntentWithLlm || defaultDetectIntentWithLlm,
  };
}

async function executeResolvedRuntime(resolution, input = {}, deps = {}) {
  if (!resolution || typeof resolution !== 'object') return resolution;

  if (resolution.kind === 'image.generate') {
    // Pipeline direct : 1 LLM call → prompt SD → génération.
    // Le LLM reçoit le message brut avec accents et produit directement le prompt SD.
    const imageReferences = extractRequestImageReferences({
      body: input.body || {},
      messages: Array.isArray(input.messages) ? input.messages : [],
    });
    const referenceImageUrl = String(imageReferences[0]?.locator || '').trim();
    const isLocalPath = referenceImageUrl && !referenceImageUrl.startsWith('http');

    const imageResult = await executeDirectImagePipeline({
      userMessage: resolution.requestText?.original || normalizeUserText(input),
      referenceImageUrl: isLocalPath ? '' : referenceImageUrl,
      referenceImagePath: isLocalPath ? referenceImageUrl : '',
      req: input.req,
      generateSd: deps.generateSd,
      callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
      timeoutMs: 25000,
    });
    return {
      ...resolution,
      responsePayload: withIntentMetadata(
        {
          ok: imageResult.ok,
          artifact_type: 'image',
          image_url: imageResult.image_url,
          url: imageResult.url,
          filename: imageResult.filename,
          prompt: imageResult.prompt,
          subject: imageResult.subject,
          pipeline: 'direct',
        },
        resolution
      ),
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

    const videoResult = await deps.generateVideo({
      req: input.req,
      prompt: resolution.videoRequest?.prompt || input.body?.prompt || '',
      body: {
        ...(input.body || {}),
        prompt: resolution.videoRequest?.prompt || input.body?.prompt || '',
        durationSeconds: resolution.videoRequest?.durationSeconds,
        fps: resolution.videoRequest?.fps,
        format: resolution.videoRequest?.format,
        width: resolution.videoRequest?.width,
        height: resolution.videoRequest?.height,
        sourceType: resolution.videoRequest?.sourceType,
        sourceUrl: resolution.videoRequest?.sourceUrl,
        sourcePath: resolution.videoRequest?.sourcePath,
        sourceImageUrl: resolution.videoRequest?.sourceImageUrl,
        sourceImagePath: resolution.videoRequest?.sourceImagePath,
        sourceVideoUrl: resolution.videoRequest?.sourceVideoUrl,
        sourceVideoPath: resolution.videoRequest?.sourceVideoPath,
      },
    });
    return {
      ...resolution,
      responsePayload: withIntentMetadata(toVideoChatProxyPayload(videoResult), resolution),
      runtime: videoResult,
    };
  }

  if (resolution.kind === 'web.image.search') {
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
    let llmIntentResult = null;
    try {
      llmIntentResult = await deps.detectIntentWithLlm({
        message: userText,
        callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
        timeoutMs: 6000,
      });
    } catch (intentError) {
      console.warn(`[A11][intent-detection] LLM intent detection failed: ${String(intentError?.message || intentError)}`);
    }

    // Résoudre l'intent final : LLM si confiance >= 0.75, sinon sémantique heuristique
    const llmIntentType = llmIntentResult?.confidence >= 0.75 ? llmIntentResult.intent : null;
    const semanticIntentType = clarification?.selectedIntentType || semantic?.topIntents?.[0]?.type || 'chat.reply';
    const selectedIntentType = llmIntentType || semanticIntentType;

    if (llmIntentResult) {
      console.log(
        `[A11][intent] llm=${llmIntentResult.intent}(${llmIntentResult.confidence.toFixed(2)})`
        + ` semantic=${semanticIntentType}`
        + ` final=${selectedIntentType}`
        + ` reason=${llmIntentResult.reason}`
      );
    }

    if (clarification?.shouldClarify && !llmIntentType) {
      return {
        traceId,
        pipeline,
        kind: 'clarification',
        semantic,
        clarification,
        responsePayload: buildClarificationPayload(clarification, semantic, traceId, pipeline),
      };
    }

    if (selectedIntentType === 'video.generate') {
      let resolution = {
        traceId,
        pipeline,
        kind: 'video.generate',
        semantic,
        videoRequest: parseVideoGenerateRequest(userText, input.body || {}),
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
    if (selectedIntentType === 'image.generate') {
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
    mask = attachDirectSourceImageToMask(
      mask,
      input.body || {},
      Array.isArray(input.messages) ? input.messages : []
    );

    if (!mask) {
      const error = new Error('invalid_mask');
      error.statusCode = 400;
      error.payload = { ok: false, error: 'invalid_mask' };
      throw error;
    }

    const { compiled } = validateAndCompileMask(mask);
    const kind = String(mask.intent || '').trim() || 'chat.reply';

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
      responsePayload: null,
      requestText: {
        original: originalUserText,
        smoothed: userText,
        changed: requestTextSmootherResult?.changed === true,
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
    } else if (kind === 'web.image.search' && input.executeWebSearch === true) {
      resolution = await executeResolvedRuntime(resolution, input, deps);
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

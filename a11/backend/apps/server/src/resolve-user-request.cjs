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
  detectImageIntent: defaultDetectImageIntent,
  detectWebImageIntent: defaultDetectWebImageIntent,
} = require('../lib/intent-detection.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../lib/image-search.cjs');

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
    detectWebImageIntent: overrides.detectWebImageIntent || defaultDetectWebImageIntent,
    duckduckgoImageSearch: overrides.duckduckgoImageSearch || defaultDuckduckgoImageSearch,
    generateSd: overrides.generateSd,
    textToWazaa: overrides.textToWazaa || textToWazaa,
    lookupDefinitionContext: overrides.lookupDefinitionContext || defaultLookupDefinitionContext,
    resolveImageEntityContext: overrides.resolveImageEntityContext || defaultResolveImageEntityContext,
    specialCompilerCallStructuredLlmJson: overrides.specialCompilerCallStructuredLlmJson,
    readPreferredImageHintMemory: overrides.readPreferredImageHintMemory || defaultReadPreferredImageHintMemory,
    smoothRequestText: overrides.smoothRequestText || defaultSmoothRequestText,
  };
}

async function executeResolvedRuntime(resolution, input = {}, deps = {}) {
  if (!resolution || typeof resolution !== 'object') return resolution;

  if (resolution.kind === 'image.generate') {
    const imageResult = await generateImageFromMask({
      req: input.req,
      rawMask: resolution.mask,
      generateSd: deps.generateSd,
      specialCompilerCallStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
      readPreferredImageHintMemory: deps.readPreferredImageHintMemory,
      lookupDefinitionContext: deps.lookupDefinitionContext,
      duckduckgoImageSearch: deps.duckduckgoImageSearch,
    });
    return {
      ...resolution,
      responsePayload: withIntentMetadata(
        {
          ...toImageChatProxyPayload(imageResult),
          maskSource: resolution.maskSource,
          fallbackUsed: resolution.fallbackUsed,
        },
        resolution
      ),
      runtime: imageResult,
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

    if (!originalUserText) {
      const error = new Error('missing_message');
      error.statusCode = 400;
      error.payload = { ok: false, error: 'missing_message' };
      throw error;
    }

    const requestTextSmootherResult = typeof deps.smoothRequestText === 'function'
      ? await deps.smoothRequestText(originalUserText, {
        source: 'resolve-user-request',
      })
      : {
        originalText: originalUserText,
        text: originalUserText,
        changed: false,
        usedLlm: false,
        localCorrections: [],
        suspiciousTokens: [],
        noiseScore: 0,
      };
    const userText = String(requestTextSmootherResult?.text || originalUserText).trim();

    const semantic = analyzeSemanticIntent(userText, {
      detectImageIntent: deps.detectImageIntent,
      detectWebImageIntent: deps.detectWebImageIntent,
      messages,
      traceId,
    });
    const clarification = semantic?.decision || null;

    if (clarification?.shouldClarify) {
      return {
        traceId,
        pipeline,
        kind: 'clarification',
        semantic,
        clarification,
        responsePayload: buildClarificationPayload(clarification, semantic, traceId, pipeline),
      };
    }

    const textToWazaaAdapter = deps.textToWazaa || textToWazaa;
    const heuristicWazaa = typeof textToWazaaAdapter?.sync === 'function'
      ? textToWazaaAdapter.sync(userText, {
        analysis: semantic,
        source: 'resolve-user-request',
        requestTextSmootherResult,
      })
      : null;
    let definitionContext = null;
    if (shouldLookupDefinitionContext({
      userText,
      semanticAnalysis: semantic,
      heuristicWazaa,
    })) {
      const lookupQuery = buildDefinitionLookupQuery({
        userText,
        semanticAnalysis: semantic,
        heuristicWazaa,
      });
      if (lookupQuery && typeof deps.lookupDefinitionContext === 'function') {
        try {
          definitionContext = await deps.lookupDefinitionContext({
            query: lookupQuery,
            userText,
            traceId,
          });
        } catch (error_) {
          console.warn(`[A11][definition-lookup] traceId=${traceId} query=${lookupQuery} error=${String(error_?.message || error_)}`);
        }
      }
    }

    const wazaa = await textToWazaaAdapter(userText, {
      analysis: semantic,
      source: 'resolve-user-request',
      requestTextSmootherResult,
    });
    const effectiveWazaa = mergeDefinitionContextIntoWazaa(wazaa || heuristicWazaa, definitionContext, userText);

    let mask = wazaaToMask(effectiveWazaa, {
      sourceText: userText,
      intentType: clarification?.selectedIntentType || semantic?.topIntents?.[0]?.type || 'chat.reply',
      semanticAnalysis: semantic,
    });

    if (!mask) {
      const error = new Error('invalid_mask');
      error.statusCode = 400;
      error.payload = {
        ok: false,
        error: 'invalid_mask',
        message: 'Impossible de produire un MASK canonique pour cette requete.',
      };
      throw error;
    }

    const imageRequestMode = String(mask?.intent || '').trim() === 'image.generate'
      ? resolveImageRequestMode({
        rawMask: mask,
        req: input.req,
        explicitMode: input.body?.mode || input.body?.image_mode || '',
      })
      : null;

    if (imageRequestMode && String(mask?.intent || '').trim() === 'image.generate') {
      mask.meta = mask.meta && typeof mask.meta === 'object' ? mask.meta : {};
      mask.meta.imageRequestMode = imageRequestMode.mode;
      mask.meta.imagePipelineMode = imageRequestMode.mode;
    }

    if (
      String(mask?.intent || '').trim() === 'image.generate'
      && imageRequestMode?.mode === 'smart'
      && typeof deps.resolveImageEntityContext === 'function'
    ) {
      try {
        const imageEntityContext = await deps.resolveImageEntityContext({ mask });
        if (imageEntityContext && typeof imageEntityContext === 'object') {
          mask = enrichImageMaskWithScratchpad(mask, { entityContext: imageEntityContext });
        }
      } catch (error_) {
        console.warn(`[A11][image-entity] traceId=${traceId} resolve failed: ${String(error_?.message || error_)}`);
      }
    }

    const { compiled } = validateAndCompileMask(mask);
    const kind = String(mask.intent || '').trim() || 'chat.reply';
    let preferredHintMemory = null;
    if (kind === 'image.generate' && typeof deps.readPreferredImageHintMemory === 'function') {
      try {
        preferredHintMemory = await deps.readPreferredImageHintMemory(mask);
      } catch (error_) {
        console.warn(`[A11][hint-memory] traceId=${traceId} read failed: ${String(error_?.message || error_)}`);
      }
    }
    const compilerCompartment = kind === 'image.generate'
      ? resolveImageCompilerCompartment(mask, {
        callStructuredLlmJson: deps.specialCompilerCallStructuredLlmJson,
        preferredHints: preferredHintMemory?.hints || {},
        pipelineMode: imageRequestMode?.mode || 'auto',
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
      responsePayload: null,
      compilerCompartmentCandidate: compilerCompartment?.compartment || 'standard',
      specialCompilerReason: Array.isArray(compilerCompartment?.reasons) ? compilerCompartment.reasons : [],
      shouldBypassImageRequestCache: compilerCompartment?.shouldBypassCache === true,
      imageRequestMode: imageRequestMode?.mode || null,
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
    } else if (kind === 'image.generate' && input.executeImage === true) {
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

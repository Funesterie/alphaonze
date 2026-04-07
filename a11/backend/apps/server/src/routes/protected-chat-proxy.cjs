const crypto = require('node:crypto');
const express = require('express');
const { ensureRequestId } = require('../../lib/request-context.cjs');
const { extractRequestAuthToken } = require('../middleware/jwt-auth.cjs');
const {
  extractLatestUserMessage,
} = require('../mask/image-chat-runtime.cjs');
const {
  createIntentResolver,
  isIntentRouterV2Enabled,
} = require('../resolve-user-request.cjs');
const {
  t_list_resources: defaultListResources,
  t_generate_pdf: defaultGeneratePdf,
  t_share_file: defaultShareFile,
  t_email_latest_resource: defaultEmailLatestResource,
} = require('../a11/tools-dispatcher.cjs');

function defaultHasLocalChatUpstreamConfigured() {
  return Boolean(
    String(process.env.LOCAL_LLM_URL || '').trim()
    || String(process.env.LLAMA_BASE || '').trim()
    || String(process.env.LLM_ROUTER_URL || '').trim()
  );
}

function isTruthyEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function attachIntentDebug(payload, _resolution, _body = {}) {
  return payload;
}

const IMAGE_REQUEST_CACHE_TTL_MS = 15000;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cleanupExpiredImageCache(cache = new Map()) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      cache.delete(key);
    }
  }
}

function buildResolvedRequestKey(req, latestUserMessage, resolution) {
  const userId = String(req?.user?.id || req?.body?._user || 'anonymous').trim();
  const conversationId = String(req?.body?.conversationId || req?.body?.conversation_id || 'no-conversation').trim();
  const kind = String(resolution?.kind || 'unknown').trim();
  const mask = resolution?.mask && typeof resolution.mask === 'object'
    ? resolution.mask
    : {};
  const fingerprintSource = {
    userId,
    conversationId,
    kind,
    latestUserMessage: String(latestUserMessage || '').trim(),
    mask,
  };
  return crypto
    .createHash('sha1')
    .update(stableStringify(fingerprintSource))
    .digest('hex');
}

function defaultShouldDefaultToLocalProvider({
  hasLocalChatUpstreamConfigured = defaultHasLocalChatUpstreamConfigured,
} = {}) {
  const runtimeProfile = String(process.env.A11_RUNTIME_PROFILE || '').trim().toLowerCase();
  const defaultUpstream = String(process.env.DEFAULT_UPSTREAM || '').trim().toLowerCase();
  const hasRemoteProvider = Boolean(
    String(process.env.A11_AGENT_OPENAI_API_KEY || '').trim()
    || String(process.env.OPENAI_API_KEY || '').trim()
  );

  if (defaultUpstream === 'local') return true;
  if (isTruthyEnv(process.env.A11_LOCAL_MODE) || runtimeProfile === 'local') return true;
  if (hasRemoteProvider) return false;
  return hasLocalChatUpstreamConfigured();
}

function buildProxyErrorBody(error_, requestId, fallbackError = 'proxy_error') {
  if (error_?.payload && typeof error_.payload === 'object') {
    return {
      ...error_.payload,
      requestId: String(error_.payload.requestId || requestId),
      error: String(error_.payload.error || fallbackError),
      message: String(error_.payload.message || error_?.message || error_),
    };
  }

  const payload = {
    ok: false,
    error: String(error_?.error || fallbackError),
    requestId,
    message: String(error_?.message || error_),
  };

  if (error_?.upstream && typeof error_.upstream === 'object') {
    payload.upstream = error_.upstream;
  }

  return payload;
}

function buildExecutionContext(req) {
  return {
    authToken: extractRequestAuthToken(req),
    userId: String(req?.user?.id || req?.body?._user || '').trim(),
    conversationId: String(req?.body?.conversationId || req?.body?.conversation_id || '').trim(),
    convId: String(req?.body?.conversationId || req?.body?.conversation_id || '').trim(),
    sessionId: String(req?.body?.conversationId || req?.body?.conversation_id || '').trim(),
  };
}

function extractEmailRecipientsFromText(text = '') {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return [...new Set((matches || []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function isImageLikeResource(resource) {
  const contentType = String(resource?.contentType || resource?.content_type || '').trim().toLowerCase();
  const filename = String(resource?.filename || '').trim();
  const url = String(resource?.url || '').trim();
  return contentType.startsWith('image/')
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename)
    || /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(url);
}

function detectCompoundActionRequest(text = '') {
  const sourceText = String(text || '').trim();
  const normalizedText = sourceText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const recipients = extractEmailRecipientsFromText(sourceText);
  const hasMailAction = /\b(envoie|envoyer|envoi|mail|email|courriel)\b/.test(normalizedText);
  const hasPdfAction = /\b(pdf|document pdf|fichier pdf|rapport pdf)\b/.test(normalizedText);
  const hasImageMention = /\b(image|images|illustration|photo|photos)\b/.test(normalizedText);

  if (hasMailAction && recipients.length && hasImageMention) {
    return {
      kind: 'compound.mail_with_latest_image',
      recipients,
      sourceText,
    };
  }

  if (hasPdfAction && hasImageMention) {
    return {
      kind: 'compound.pdf_with_latest_images',
      recipients,
      sourceText,
    };
  }

  return null;
}

function buildCompoundPayload(payload, resolution) {
  return {
    ...payload,
    traceId: resolution.traceId,
    pipeline: resolution.pipeline,
    kind: resolution.kind,
  };
}

function buildAssistantChoice(content) {
  return [
    {
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: 'stop',
    },
  ];
}

async function executeCompoundActionRequest({
  req,
  compound,
  listResources,
  generatePdf,
  shareFile,
  emailLatestResource,
}) {
  const context = buildExecutionContext(req);
  const traceId = `compound_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolution = {
    traceId,
    pipeline: 'intent-router-v2',
    kind: compound.kind,
  };

  if (compound.kind === 'compound.mail_with_latest_image') {
    const result = await emailLatestResource({
      to: compound.recipients,
      conversationId: context.conversationId || null,
      kind: 'image',
      attachToEmail: true,
      subject: 'A11 - image',
      message: "Image jointe depuis la conversation A11.",
      _context: context,
    });

    if (!result?.ok) {
      const error = new Error(result?.error || 'compound_mail_with_image_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_mail_with_image_failed',
        details: result,
      };
      throw error;
    }

    const attachedUrl = String(
      result?.resource?.url
      || result?.resource?.downloadUrl
      || ''
    ).trim() || null;
    const content = `C'est fait. Le mail a ete envoye avec la derniere image de la conversation${attachedUrl ? ` et son apercu est disponible ici: ${attachedUrl}` : '.'}`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'email',
      content,
      recipients: compound.recipients,
      resource: result?.resource || null,
      mail: result?.mail || null,
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  if (compound.kind === 'compound.pdf_with_latest_images') {
    const listed = await listResources({
      conversationId: context.conversationId || null,
      limit: 12,
      _context: context,
    });
    const imageResources = Array.isArray(listed?.resources)
      ? listed.resources.filter(isImageLikeResource).slice(0, 4)
      : [];

    if (!imageResources.length) {
      const error = new Error('compound_pdf_with_images_missing_images');
      error.statusCode = 404;
      error.payload = {
        ok: false,
        error: 'compound_pdf_with_images_missing_images',
        message: "Aucune image recente n'a ete trouvee dans cette conversation pour construire le PDF.",
      };
      throw error;
    }

    const pdf = await generatePdf({
      conversationId: context.conversationId || null,
      title: 'Document A11',
      author: 'A11',
      sections: [
        {
          heading: 'Images de la conversation',
          text: compound.sourceText,
          images: imageResources.map((resource) => String(resource.id || resource.url || resource.filename || '').trim()).filter(Boolean),
        },
      ],
      _context: context,
    });

    if (!pdf?.ok || !String(pdf?.outputPath || '').trim()) {
      const error = new Error(pdf?.error || 'compound_pdf_with_images_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_pdf_with_images_failed',
        details: pdf,
      };
      throw error;
    }

    const shared = await shareFile({
      path: pdf.outputPath,
      conversationId: context.conversationId || null,
      filename: String(pdf.filename || '').trim() || 'a11-images.pdf',
      _context: context,
    });

    if (!shared?.ok) {
      const error = new Error(shared?.error || 'compound_pdf_share_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_pdf_share_failed',
        details: shared,
      };
      throw error;
    }

    const pdfUrl = String(shared?.url || shared?.conversationResource?.url || shared?.conversationResource?.downloadUrl || '').trim() || null;
    const content = pdfUrl
      ? `C'est fait. Le PDF avec les images est pret. [ouvrir le PDF](${pdfUrl})`
      : "C'est fait. Le PDF avec les images est pret.";
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'pdf',
      content,
      file_url: pdfUrl,
      filePath: pdfUrl,
      pdf,
      shared: shared?.conversationResource || shared || null,
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  return null;
}

function createProtectedChatProxyRouter({
  verifyJWT,
  proxyChatToOpenAI,
  detectImageIntent,
  detectWebImageIntent,
  duckduckgoImageSearch,
  generateSd,
  listResources = defaultListResources,
  generatePdf = defaultGeneratePdf,
  shareFile = defaultShareFile,
  emailLatestResource = defaultEmailLatestResource,
  hasLocalChatUpstreamConfigured = defaultHasLocalChatUpstreamConfigured,
  shouldDefaultToLocalProvider = defaultShouldDefaultToLocalProvider,
  intentRouterV2Enabled = isIntentRouterV2Enabled(),
  localDefaultModel = String(process.env.LOCAL_DEFAULT_MODEL || 'llama3.2:latest'),
  remoteDefaultModel = String(
    process.env.OPENAI_MODEL
    || process.env.A11_OPENAI_MODEL
    || 'gpt-4o-mini'
  ).trim() || 'gpt-4o-mini',
} = {}) {
  if (typeof verifyJWT !== 'function') {
    throw new Error('createProtectedChatProxyRouter requires verifyJWT');
  }
  if (typeof proxyChatToOpenAI !== 'function') {
    throw new Error('createProtectedChatProxyRouter requires proxyChatToOpenAI');
  }
  const intentResolver = createIntentResolver({
    detectImageIntent,
    detectWebImageIntent,
    duckduckgoImageSearch,
    generateSd,
  });
  const inFlightImageRequests = new Map();
  const recentImageResponses = new Map();

  async function tryHandleIntentRequest(req, res) {
    const latestUserMessage = extractLatestUserMessage(req.body || {});
    if (!latestUserMessage) return false;

    const compoundRequest = detectCompoundActionRequest(latestUserMessage);
    if (compoundRequest) {
      const compoundPayload = await executeCompoundActionRequest({
        req,
        compound: compoundRequest,
        listResources,
        generatePdf,
        shareFile,
        emailLatestResource,
      });
      return res.status(200).json(compoundPayload);
    }

    const resolution = await intentResolver.resolveUserRequest({
      req,
      body: req.body || {},
      userText: latestUserMessage,
      messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
      executeImage: false,
      executeWebSearch: false,
    });

    if (
      resolution.kind === 'chat.reply'
      || resolution.kind === 'code.python.generate'
      || resolution.kind === 'web.search'
    ) {
      return false;
    }

    if (resolution.kind === 'clarification') {
      return res.status(200).json(attachIntentDebug(resolution.responsePayload, resolution, req.body || {}));
    }

    cleanupExpiredImageCache(recentImageResponses);
    const requestKey = buildResolvedRequestKey(req, latestUserMessage, resolution);
    const isCacheable = resolution.kind === 'image.generate' || resolution.kind === 'web.image.search';

    if (!isCacheable) {
      return res.status(200).json(attachIntentDebug(resolution.responsePayload, resolution, req.body || {}));
    }

    const cachedExecution = recentImageResponses.get(requestKey);
    if (cachedExecution) {
      console.log(`[A11][intent-sync] reuse recent result key=${requestKey.slice(0, 10)} kind=${resolution.kind}`);
      return res.status(200).json(attachIntentDebug(cachedExecution.result, resolution, req.body || {}));
    }

    const existing = inFlightImageRequests.get(requestKey);
    if (existing) {
      console.log(`[A11][intent-sync] join in-flight request key=${requestKey.slice(0, 10)} kind=${resolution.kind}`);
      const payload = await existing;
      return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
    }

    const executionPromise = Promise.resolve(resolution.responsePayload)
      .then(async (payload) => {
        if (payload) return payload;
        const executed = await intentResolver.executeResolvedRuntime(resolution, {
          req,
          body: req.body || {},
          messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        });
        return executed?.responsePayload || null;
      })
      .then((payload) => {
        recentImageResponses.set(requestKey, {
          expiresAt: Date.now() + IMAGE_REQUEST_CACHE_TTL_MS,
          result: payload,
        });
        return payload;
      })
      .finally(() => {
        inFlightImageRequests.delete(requestKey);
      });
    inFlightImageRequests.set(requestKey, executionPromise);

    const payload = await executionPromise;
    return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
  }

  function applyProviderDefaults(req) {
    if (!req.body) req.body = {};
    if (!req.body.provider && shouldDefaultToLocalProvider({ hasLocalChatUpstreamConfigured })) {
      req.body.provider = 'local';
    }
    if (req.body.provider === 'local' && !String(req.body.model || '').trim()) {
      req.body.model = String(localDefaultModel || 'llama3.2:latest');
    }
    if (req.body.provider !== 'local' && !String(req.body.model || '').trim()) {
      req.body.model = String(remoteDefaultModel || 'gpt-4o-mini');
    }
  }

  async function handleProxy(req, res) {
    const intentHandled = await tryHandleIntentRequest(req, res);
    if (intentHandled !== false) return intentHandled;

    applyProviderDefaults(req);
    return proxyChatToOpenAI(req, res);
  }

  const router = express.Router();

  router.post('/llm/chat', verifyJWT, express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][/api/llm/chat] requestId=${requestId} Error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'proxy_error'));
    }
  });

  router.post('/ai/chat', express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      req.body = {
        ...(req.body || {}),
        _user: req.user?.id || req.body?._user || 'anonymous',
      };
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][AuthChat] requestId=${requestId} Proxy error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'upstream_unreachable'));
    }
  });

  router.post('/ai', express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      req.body = {
        ...(req.body || {}),
        _user: req.user?.id || req.body?._user || 'anonymous',
      };
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][/api/ai] requestId=${requestId} Error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'proxy_error'));
    }
  });

  router.post('/completions', express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][/api/completions] requestId=${requestId} Error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'proxy_error'));
    }
  });

  router.handleProxy = handleProxy;
  router.applyProviderDefaults = applyProviderDefaults;

  return router;
}

module.exports = createProtectedChatProxyRouter;

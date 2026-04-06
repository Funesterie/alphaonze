const crypto = require('node:crypto');
const express = require('express');
const {
  extractLatestUserMessage,
} = require('../mask/image-chat-runtime.cjs');
const {
  createIntentResolver,
  isIntentRouterV2Enabled,
} = require('../resolve-user-request.cjs');

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

function createProtectedChatProxyRouter({
  verifyJWT,
  proxyChatToOpenAI,
  detectImageIntent,
  detectWebImageIntent,
  duckduckgoImageSearch,
  generateSd,
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
    try {
      return await handleProxy(req, res);
    } catch (error_) {
      console.error('[A11][/api/llm/chat] Error:', error_?.message || error_);
      return res.status(502).json({ ok: false, error: 'proxy_error', message: String(error_?.message || error_) });
    }
  });

  router.post('/ai/chat', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      req.body = {
        ...(req.body || {}),
        _user: req.user?.id || req.body?._user || 'anonymous',
      };
      return await handleProxy(req, res);
    } catch (error_) {
      console.error('[A11][AuthChat] Proxy error:', error_?.message || error_);
      return res.status(502).json({
        ok: false,
        error: 'upstream_unreachable',
        message: String(error_?.message || error_),
      });
    }
  });

  router.post('/ai', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      req.body = {
        ...(req.body || {}),
        _user: req.user?.id || req.body?._user || 'anonymous',
      };
      return await handleProxy(req, res);
    } catch (error_) {
      console.error('[A11][/api/ai] Error:', error_?.message || error_);
      return res.status(502).json({ ok: false, error: 'proxy_error', message: String(error_?.message || error_) });
    }
  });

  router.post('/completions', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      return await handleProxy(req, res);
    } catch (error_) {
      console.error('[A11][/api/completions] Error:', error_?.message || error_);
      return res.status(502).json({ ok: false, error: 'proxy_error', message: String(error_?.message || error_) });
    }
  });

  return router;
}

module.exports = createProtectedChatProxyRouter;

const crypto = require('node:crypto');
const express = require('express');
const {
  extractLatestUserMessage,
  toImageChatProxyPayload,
  toWebImageChatProxyPayload,
} = require('../mask/image-chat-runtime.cjs');
const {
  createA11ImageBrain,
  summarizeDecision,
} = require('../image/a11-image-brain.cjs');

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

function isDevModeEnabled(body = {}) {
  return body?.a11Dev === true || body?.devMode === true || body?.allowDevActions === true;
}

function attachImageBrainDebug(payload, decision, body = {}) {
  if (!payload || !decision) return payload;
  if (!isDevModeEnabled(body) && body?.includeDebug !== true) return payload;

  const imageBrain = summarizeDecision(decision);
  payload.a11Agent = payload.a11Agent && typeof payload.a11Agent === 'object'
    ? payload.a11Agent
    : {};
  payload.a11Agent.imageBrain = imageBrain;
  return payload;
}

function buildDevModeRequiredReply(reason = 'generer une image') {
  return `Le mode DEV n'est pas active. J'en ai besoin pour ${reason}. Active-le puis renvoie ta demande.`;
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

function buildImageRequestKey(req, latestUserMessage, imageDecision) {
  const userId = String(req?.user?.id || req?.body?._user || 'anonymous').trim();
  const conversationId = String(req?.body?.conversationId || req?.body?.conversation_id || 'no-conversation').trim();
  const mode = String(imageDecision?.mode || 'unknown').trim();
  const canonicalIntent = imageDecision?.canonicalIntent && typeof imageDecision.canonicalIntent === 'object'
    ? imageDecision.canonicalIntent
    : {};
  const fingerprintSource = {
    userId,
    conversationId,
    mode,
    latestUserMessage: String(latestUserMessage || '').trim(),
    canonicalIntent,
  };
  return crypto
    .createHash('sha1')
    .update(stableStringify(fingerprintSource))
    .digest('hex');
}

function toSimpleAssistantCompletion(content, model = 'a11-dev-required') {
  return {
    id: `chatcmpl-runtime-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
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
  };
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
  extractWebImageSubject,
  duckduckgoImageSearch,
  generateSd,
  hasLocalChatUpstreamConfigured = defaultHasLocalChatUpstreamConfigured,
  shouldDefaultToLocalProvider = defaultShouldDefaultToLocalProvider,
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
  const imageBrain = createA11ImageBrain({
    detectImageIntent,
    detectWebImageIntent,
    extractWebImageSubject,
    duckduckgoImageSearch,
    generateSd,
  });
  const inFlightImageRequests = new Map();
  const recentImageResponses = new Map();

  async function tryHandleImageRequest(req, res) {
    const latestUserMessage = extractLatestUserMessage(req.body || {});
    if (!latestUserMessage) return false;
    const imageDecision = imageBrain.planRequest(latestUserMessage);
    if (!imageDecision?.handled) return false;

    if (imageDecision.mode === 'clarify') return false;

    if (imageDecision.mode === 'generate' && !isDevModeEnabled(req.body || {})) {
      return res.status(200).json(
        toSimpleAssistantCompletion(buildDevModeRequiredReply('generer une image'), 'a11-dev-required')
      );
    }

    try {
      cleanupExpiredImageCache(recentImageResponses);
      const requestKey = buildImageRequestKey(req, latestUserMessage, imageDecision);
      let executionPromise = null;

      const cachedExecution = recentImageResponses.get(requestKey);
      if (cachedExecution) {
        console.log(`[A11][image-sync] reuse recent image result key=${requestKey.slice(0, 10)} mode=${imageDecision.mode}`);
        executionPromise = Promise.resolve(cachedExecution.result);
      } else {
        const existing = inFlightImageRequests.get(requestKey);
        if (existing) {
          console.log(`[A11][image-sync] join in-flight image request key=${requestKey.slice(0, 10)} mode=${imageDecision.mode}`);
          executionPromise = existing;
        } else {
          executionPromise = imageBrain.executePlan({
            req,
            decision: imageDecision,
          }).then((result) => {
            recentImageResponses.set(requestKey, {
              expiresAt: Date.now() + IMAGE_REQUEST_CACHE_TTL_MS,
              result,
            });
            return result;
          }).finally(() => {
            inFlightImageRequests.delete(requestKey);
          });
          inFlightImageRequests.set(requestKey, executionPromise);
        }
      }

      const imageExecution = await executionPromise;

      if (imageExecution.mode === 'web_search') {
        return res.status(200).json(
          attachImageBrainDebug(
            toWebImageChatProxyPayload({
              subject: imageExecution.subject,
              result: imageExecution.result,
            }),
            imageDecision,
            req.body || {}
          )
        );
      }

      if (imageExecution.mode === 'generate') {
        return res.status(200).json(
          attachImageBrainDebug(toImageChatProxyPayload(imageExecution.imageResult), imageDecision, req.body || {})
        );
      }

      return false;
    } catch (error_) {
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || {
          ok: false,
          error: imageDecision.mode === 'web_search' ? 'web_image_search_failed' : 'sd_call_failed',
          message: String(error_?.message || error_),
        }
      );
    }
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
    const imageHandled = await tryHandleImageRequest(req, res);
    if (imageHandled !== false) return imageHandled;

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

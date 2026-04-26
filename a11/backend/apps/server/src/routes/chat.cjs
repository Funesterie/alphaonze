'use strict';

const express = require('express');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { withOllamaQueue, getQueueStats } = require('../core/ollama-queue.cjs');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_) {
  OpenAI = null;
}

const {
  detectImageIntent: defaultDetectImageIntent,
  detectVideoIntent: defaultDetectVideoIntent,
  detectWebImageIntent: defaultDetectWebImageIntent,
} = require('../../lib/intent-detection.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../../lib/image-search.cjs');
const sdToolsModule = require('./sd-tools.cjs');
const videoToolsModule = require('./video-generate.cjs');
const {
  createIntentResolver: createUnifiedIntentResolver,
  isIntentRouterV2Enabled,
} = require('../resolve-user-request.cjs');

function createOpenAIClient() {
  if (!OpenAI) return null;
  return new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || 'dummy',
    defaultHeaders: {
      'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro',
    },
  });
}

function getOllamaConfig() {
  return {
    base: String(process.env.OLLAMA_BASE || '').trim().replace(/\/+$/, ''),
    model: String(process.env.LOCAL_DEFAULT_MODEL || process.env.DEFAULT_MODEL || 'gemma4:e4b').trim(),
  };
}

function buildOllamaMessages(userMessage) {
  return [
    { role: 'system', content: 'Tu es A11, un assistant IA local. Reponds en francais.' },
    { role: 'user', content: userMessage },
  ];
}

/**
 * Appel direct Ollama — mode non-streaming.
 * Retourne le texte de la réponse ou null si echec.
 */
async function callOllama(userMessage) {
  const { base, model } = getOllamaConfig();
  if (!base) return null;

  const ollamaUrl = `${base}/v1/chat/completions`;
  const bodyStr = JSON.stringify({
    model,
    messages: buildOllamaMessages(userMessage),
    stream: false,
  });

  let parsed;
  try {
    parsed = new URL(ollamaUrl);
  } catch (_) {
    return null;
  }

  const lib = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(data?.choices?.[0]?.message?.content || null);
          } catch (_) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(90_000, () => { req.destroy(); resolve(null); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Appel Ollama en mode streaming — pipe les chunks SSE vers res.
 * Format SSE : data: {"delta":"..."}\n\n  puis  data: [DONE]\n\n
 */
function streamOllama(userMessage, res) {
  const { base, model } = getOllamaConfig();
  if (!base) {
    res.write('data: {"error":"ollama_not_configured"}\n\n');
    res.end();
    return;
  }

  const bodyStr = JSON.stringify({
    model,
    messages: buildOllamaMessages(userMessage),
    stream: true,
  });

  let parsed;
  try {
    parsed = new URL(`${base}/v1/chat/completions`);
  } catch (_) {
    res.write('data: {"error":"invalid_ollama_url"}\n\n');
    res.end();
    return;
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const req = lib.request(
    {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    },
    (ollamaRes) => {
      let buf = '';
      ollamaRes.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop(); // fragment incomplet
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
          try {
            const parsed2 = JSON.parse(jsonStr);
            const delta = parsed2?.choices?.[0]?.delta?.content;
            if (delta) {
              res.write(`data: ${JSON.stringify({ delta, model })}\n\n`);
            }
          } catch (_) { /* ignore malformed chunks */ }
        }
      });
      ollamaRes.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });
      ollamaRes.on('error', () => {
        res.write('data: {"error":"ollama_stream_error"}\n\n');
        res.end();
      });
    }
  );

  req.on('error', () => {
    res.write('data: {"error":"ollama_unreachable"}\n\n');
    res.end();
  });
  req.setTimeout(120_000, () => {
    req.destroy();
    res.write('data: {"error":"ollama_timeout"}\n\n');
    res.end();
  });
  req.write(bodyStr);
  req.end();
}

function resolveChatDependencies(overrides = {}) {
  return {
    openaiClient: overrides.openaiClient || createOpenAIClient(),
    detectImageIntent: overrides.detectImageIntent || defaultDetectImageIntent,
    detectVideoIntent: overrides.detectVideoIntent || defaultDetectVideoIntent,
    detectWebImageIntent: overrides.detectWebImageIntent || defaultDetectWebImageIntent,
    duckduckgoImageSearch: overrides.duckduckgoImageSearch || defaultDuckduckgoImageSearch,
    generateSd: overrides.generateSd || sdToolsModule.generateSdInternal,
    generateVideo: overrides.generateVideo || videoToolsModule.generateVideoInternal,
    specialCompilerCallStructuredLlmJson: overrides.specialCompilerCallStructuredLlmJson,
    intentRouterV2Enabled: isIntentRouterV2Enabled(overrides.intentRouterV2Enabled),
  };
}

function attachIntentDebug(payload) {
  return payload;
}

function createChatRouter(overrides = {}) {
  const {
    openaiClient,
    detectImageIntent,
    detectVideoIntent,
    detectWebImageIntent,
    duckduckgoImageSearch,
    generateSd,
    generateVideo,
    specialCompilerCallStructuredLlmJson,
  } = resolveChatDependencies(overrides);

  const intentResolver = createUnifiedIntentResolver({
    detectImageIntent,
    detectVideoIntent,
    detectWebImageIntent,
    duckduckgoImageSearch,
    generateSd,
    generateVideo,
    specialCompilerCallStructuredLlmJson,
  });

  const router = express.Router();

  router.post('/chat', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const userMessage = String(req.body?.message || req.body?.prompt || '').trim();
      if (!userMessage) {
        return res.status(400).json({ ok: false, error: 'missing_message' });
      }

      const resolution = await intentResolver.resolveUserRequest({
        req,
        body: req.body || {},
        userText: userMessage,
        messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        executeRuntime: true,
      });

      if (
        resolution.kind !== 'chat.reply'
        && resolution.kind !== 'code.python.generate'
        && resolution.kind !== 'web.search'
        && resolution.responsePayload
      ) {
        return res.json(attachIntentDebug(resolution.responsePayload, resolution, req.body || {}));
      }

      console.log(`[A11][chat] Intention: fallback LLM | message: ${userMessage}`);

      // Priorite 1 : Ollama local (via queue pour éviter contention)
      try {
        const ollamaText = await withOllamaQueue(
          () => callOllama(userMessage),
          'chat'
        );
        if (ollamaText) {
          const { model } = getOllamaConfig();
          return res.json({ ok: true, mode: 'ollama', model, assistant: ollamaText });
        }
      } catch (qErr) {
        if (qErr.statusCode === 503) {
          return res.status(503).json({
            ok: false,
            error: 'ollama_busy',
            message: 'Trop de requêtes en cours, réessaie dans quelques secondes.',
            retryAfter: qErr.retryAfter || 10,
          });
        }
        if (qErr.statusCode === 504) {
          return res.status(504).json({
            ok: false,
            error: 'ollama_timeout',
            message: 'Ollama n\'a pas répondu à temps.',
          });
        }
        // Autre erreur → fallback OpenAI
      }

      // Priorite 2 : OpenAI (fallback cloud)
      if (!openaiClient) {
        return res.status(500).json({ ok: false, error: 'llm_unavailable' });
      }

      const completion = await openaiClient.chat.completions.create({
        model: process.env.A11_OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Tu es l\'assistant A11. Si la demande est une generation d\'image reelle, ne reponds pas en texte, laisse le routeur declencher le tool.',
          },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 512,
      });

      const text = completion?.choices?.[0]?.message?.content || '';
      return res.json({ ok: true, mode: 'llm', assistant: text });
    } catch (error_) {
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || {
          ok: false,
          error: 'internal_error',
          message: String(error_?.message || error_),
        }
      );
    }
  });

  // --- Route streaming SSE : POST /chat/stream ---
  // Envoie les tokens Ollama au fur et à mesure (Server-Sent Events).
  // Format : data: {"delta":"..."}\n\n  ...  data: [DONE]\n\n
  // Le client peut aussi passer ?stream=1 sur /chat pour activer le streaming.
  router.post('/chat/stream', express.json({ limit: '2mb' }), (req, res) => {
    const userMessage = String(req.body?.message || req.body?.prompt || '').trim();
    if (!userMessage) {
      res.status(400).json({ ok: false, error: 'missing_message' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx
    res.flushHeaders();

    console.log(`[A11][chat/stream] message: ${userMessage}`);

    // Vérifier la queue avant de démarrer le stream
    const stats = getQueueStats();
    if (stats.active >= stats.maxConcurrent && stats.queued >= stats.maxQueueSize) {
      res.write('data: {"error":"ollama_busy","retryAfter":10}\n\n');
      res.end();
      return;
    }

    streamOllama(userMessage, res);
  });

  // --- Route stats queue ---
  router.get('/chat/queue-stats', (req, res) => {
    res.json({ ok: true, queue: getQueueStats() });
  });

  return router;
}

function looksLikeDependencyBag(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      'openaiClient' in value
      || 'detectImageIntent' in value
      || 'detectVideoIntent' in value
      || 'detectWebImageIntent' in value
      || 'extractWebImageSubject' in value
      || 'duckduckgoImageSearch' in value
      || 'generateSd' in value
      || 'generateVideo' in value
      || 'specialCompilerCallStructuredLlmJson' in value
      || 'intentRouterV2Enabled' in value
    )
  );
}

const defaultRouter = createChatRouter();

function chatEntrypoint(...args) {
  if (args.length === 1 && looksLikeDependencyBag(args[0])) {
    return createChatRouter(args[0]);
  }
  return defaultRouter(...args);
}

chatEntrypoint.router = defaultRouter;
chatEntrypoint.createChatRouter = createChatRouter;

module.exports = chatEntrypoint;

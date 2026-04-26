'use strict';

const express = require('express');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

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

/**
 * Appel direct Ollama via /v1/chat/completions (compatible OpenAI).
 * Retourne le texte de la réponse ou null si echec.
 */
async function callOllama(userMessage) {
  const ollamaBase = String(process.env.OLLAMA_BASE || '').trim().replace(/\/+$/, '');
  if (!ollamaBase) return null;

  const localModel = String(
    process.env.LOCAL_DEFAULT_MODEL || process.env.DEFAULT_MODEL || 'gemma4:e4b'
  ).trim();

  const ollamaUrl = `${ollamaBase}/v1/chat/completions`;
  const bodyStr = JSON.stringify({
    model: localModel,
    messages: [
      { role: 'system', content: 'Tu es A11, un assistant IA local. Reponds en francais.' },
      { role: 'user', content: userMessage },
    ],
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

      // Priorite 1 : Ollama local
      const ollamaText = await callOllama(userMessage);
      if (ollamaText) {
        const localModel = String(
          process.env.LOCAL_DEFAULT_MODEL || process.env.DEFAULT_MODEL || 'gemma4:e4b'
        ).trim();
        return res.json({ ok: true, mode: 'ollama', model: localModel, assistant: ollamaText });
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

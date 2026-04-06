const express = require('express');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (error_) {
  OpenAI = null;
}

const {
  detectImageIntent: defaultDetectImageIntent,
  detectWebImageIntent: defaultDetectWebImageIntent,
  extractWebImageSubject: defaultExtractWebImageSubject,
} = require('../../lib/intent-detection.cjs');
const { duckduckgoImageSearch: defaultDuckduckgoImageSearch } = require('../../lib/image-search.cjs');
const sdToolsModule = require('./sd-tools.cjs');
const {
  toImageChatProxyPayload,
  toWebImageChatProxyPayload,
} = require('../mask/image-chat-runtime.cjs');
const {
  createA11ImageBrain,
  buildClarificationMessage,
  summarizeDecision,
} = require('../image/a11-image-brain.cjs');

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

function resolveChatDependencies(overrides = {}) {
  return {
    openaiClient: overrides.openaiClient || createOpenAIClient(),
    detectImageIntent: overrides.detectImageIntent || defaultDetectImageIntent,
    detectWebImageIntent: overrides.detectWebImageIntent || defaultDetectWebImageIntent,
    extractWebImageSubject: overrides.extractWebImageSubject || defaultExtractWebImageSubject,
    duckduckgoImageSearch: overrides.duckduckgoImageSearch || defaultDuckduckgoImageSearch,
    generateSd: overrides.generateSd || sdToolsModule.generateSdInternal,
  };
}

function createChatRouter(overrides = {}) {
  const {
    openaiClient,
    detectImageIntent,
    detectWebImageIntent,
    extractWebImageSubject,
    duckduckgoImageSearch,
    generateSd,
  } = resolveChatDependencies(overrides);
  const imageBrain = createA11ImageBrain({
    detectImageIntent,
    detectWebImageIntent,
    extractWebImageSubject,
    duckduckgoImageSearch,
    generateSd,
  });

  const router = express.Router();

  function attachImageBrainDebug(payload, decision, body = {}) {
    if (!payload || !decision) return payload;
    if (body?.a11Dev !== true && body?.includeDebug !== true) return payload;

    payload.a11Agent = payload.a11Agent && typeof payload.a11Agent === 'object'
      ? payload.a11Agent
      : {};
    payload.a11Agent.imageBrain = summarizeDecision(decision);
    return payload;
  }

  router.post('/chat', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const userMessage = String(req.body?.message || req.body?.prompt || '').trim();
      if (!userMessage) {
        return res.status(400).json({ ok: false, error: 'missing_message' });
      }

      const imageDecision = imageBrain.planRequest(userMessage);
      if (imageDecision?.handled) {
        if (imageDecision.mode === 'clarify') {
          return res.json({
            ok: true,
            mode: 'need_clarification',
            assistant: buildClarificationMessage(imageDecision.clarification),
            clarification: imageDecision.clarification,
            semantic: imageDecision.semantic,
          });
        }

        try {
          const imageExecution = await imageBrain.executePlan({
            req,
            decision: imageDecision,
          });

          if (imageExecution.mode === 'web_search') {
            return res.json(
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
            return res.json(
              attachImageBrainDebug(toImageChatProxyPayload(imageExecution.imageResult), imageDecision, req.body || {})
            );
          }
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

      console.log(`[A11][chat] Intention: fallback LLM | message: ${userMessage}`);
      if (!openaiClient) {
        return res.status(500).json({ ok: false, error: 'llm_unavailable' });
      }

      const completion = await openaiClient.chat.completions.create({
        model: process.env.A11_OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Tu es l’assistant A11. Si la demande est une génération d’image réelle, ne réponds pas en texte, laisse le routeur déclencher le tool.',
          },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 512,
      });

      const text = completion?.choices?.[0]?.message?.content || '';
      return res.json({ ok: true, mode: 'llm', assistant: text });
    } catch (error_) {
      return res.status(500).json({
        ok: false,
        error: 'internal_error',
        message: String(error_?.message || error_),
      });
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
      || 'detectWebImageIntent' in value
      || 'extractWebImageSubject' in value
      || 'duckduckgoImageSearch' in value
      || 'generateSd' in value
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

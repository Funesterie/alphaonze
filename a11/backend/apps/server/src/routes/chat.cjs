'use strict';

const express = require('express');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { withOllamaQueue, getQueueStats } = require('../core/ollama-queue.cjs');

// Charge le system prompt depuis system_prompt.txt (première personne, identité complète d'A11)
function loadSystemPrompt() {
  try {
    const promptPath = path.resolve(__dirname, '..', '..', 'system_prompt.txt');
    return fs.readFileSync(promptPath, 'utf8').trim();
  } catch (_) {
    // Fallback si le fichier est absent
    return `Je suis A-11, une intelligence artificielle développée par Jeffrey Cellauro alias Djeff alias funeste.\nJe réponds en français, de manière concise, claire et directe.`;
  }
}

const SYSTEM_PROMPT = loadSystemPrompt();

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
  detectAgentIntent: defaultDetectAgentIntent,
  detectShowcaseIntent: defaultDetectShowcaseIntent,
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
    { role: 'system', content: SYSTEM_PROMPT },
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
    detectAgentIntent: overrides.detectAgentIntent || defaultDetectAgentIntent,
    detectShowcaseIntent: overrides.detectShowcaseIntent || defaultDetectShowcaseIntent,
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
    detectAgentIntent,
    detectShowcaseIntent,
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

      // Détection d'intent agent : "A11, fais [Goal]"
      const agentIntent = detectAgentIntent(userMessage);
      if (agentIntent && agentIntent.goal) {
        try {
          // Appeler Cerbère (port 3001) pour créer la Task via le Droid
          const cerbereUrl = process.env.LLM_ROUTER_URL || 'http://localhost:3001';
          const cerbereEndpoint = `${cerbereUrl}/api/droid/tasks`;
          
          console.log(`[A11][chat] Agent intent detected, calling Cerbère: ${cerbereEndpoint}`);
          
          const taskPayload = {
            goal: agentIntent.goal,
            meta: {
              source: 'chat',
              conversationId: req.body?.conversationId || null,
              userId: req.body?.userId || null,
            },
            userId: req.body?.userId || null,
          };

          // Appel HTTP vers Cerbère avec timeout de 5s
          const cerbereResponse = await new Promise((resolve, reject) => {
            const parsed = new URL(cerbereEndpoint);
            const lib = parsed.protocol === 'https:' ? https : http;
            const bodyStr = JSON.stringify(taskPayload);
            
            const req = lib.request(
              {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname,
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(bodyStr),
                  'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro',
                },
                timeout: 5000,
              },
              (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                  try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                  } catch (e) {
                    reject(new Error(`Invalid JSON from Cerbère: ${data}`));
                  }
                });
              }
            );
            
            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('Cerbère timeout (5s)'));
            });
            
            req.write(bodyStr);
            req.end();
          });

          if (cerbereResponse.status === 201 && cerbereResponse.data?.task) {
            const task = cerbereResponse.data.task;
            console.log(`[A11][chat] Agent task created via Cerbère: ${task.id}`);

            // Confirmer la création avec l'ID de la Task
            return res.json({
              ok: true,
              mode: 'agent_task',
              taskId: task.id,
              goal: agentIntent.goal,
              assistant: `✅ Tâche créée : **${task.id}**\n\nJe vais m'occuper de : "${agentIntent.goal}"\n\nTu peux suivre l'avancement avec \`/api/droid/tasks/${task.id}\`.`,
            });
          } else {
            throw new Error(`Cerbère returned status ${cerbereResponse.status}`);
          }
        } catch (droidError) {
          console.error('[A11][chat] Failed to create agent task via Cerbère:', droidError);
          // Fallback : continuer avec le traitement normal si Cerbère échoue
        }
      }

      // Détection d'intent Showcase : "montre-moi ce que tu sais faire"
      const showcaseIntent = detectShowcaseIntent(userMessage);
      if (showcaseIntent) {
        try {
          console.log(`[A11][chat] Showcase intent detected, theme: ${showcaseIntent.theme || 'none'}`);
          
          // Importer le planner et construire le plan Showcase
          const { buildShowcasePlan } = require('../../a11-planner.cjs');
          const showcasePlan = await buildShowcasePlan(showcaseIntent.theme);
          
          console.log(`[A11][chat] Showcase plan generated: ${showcasePlan.steps.length} steps`);
          
          // Créer une Task Droid avec le plan Showcase
          const cerbereUrl = process.env.LLM_ROUTER_URL || 'http://localhost:3001';
          const cerbereEndpoint = `${cerbereUrl}/api/droid/tasks`;
          
          const taskPayload = {
            goal: showcaseIntent.theme 
              ? `Showcase Mode : démonstration sur le thème "${showcaseIntent.theme}"` 
              : 'Showcase Mode : démonstration complète de mes capacités',
            meta: {
              source: 'chat',
              mode: 'showcase',
              showcaseMode: true, // Flag pour l'Executor
              theme: showcaseIntent.theme,
              plan: showcasePlan,
              conversationId: req.body?.conversationId || null,
              userId: req.body?.userId || null,
            },
            userId: req.body?.userId || null,
          };

          // Appel HTTP vers Cerbère avec timeout de 5s
          const cerbereResponse = await new Promise((resolve, reject) => {
            const parsed = new URL(cerbereEndpoint);
            const lib = parsed.protocol === 'https:' ? https : http;
            const bodyStr = JSON.stringify(taskPayload);
            
            const req = lib.request(
              {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname,
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(bodyStr),
                  'X-NEZ-TOKEN': process.env.NEZ_ALLOWED_TOKEN || process.env.NEZ_TOKENS || 'nez:a11-client-funesterie-pro',
                },
                timeout: 5000,
              },
              (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                  try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                  } catch (e) {
                    reject(new Error(`Invalid JSON from Cerbère: ${data}`));
                  }
                });
              }
            );
            
            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('Cerbère timeout (5s)'));
            });
            
            req.write(bodyStr);
            req.end();
          });

          if (cerbereResponse.status === 201 && cerbereResponse.data?.task) {
            const task = cerbereResponse.data.task;
            console.log(`[A11][chat] Showcase task created via Cerbère: ${task.id}`);

            // Confirmer le démarrage du Showcase avec un message enthousiaste
            const themeMsg = showcaseIntent.theme ? ` sur le thème "${showcaseIntent.theme}"` : '';
            return res.json({
              ok: true,
              mode: 'showcase',
              taskId: task.id,
              theme: showcaseIntent.theme,
              stepsCount: showcasePlan.steps.length,
              assistant: `🎭 **Showcase Mode activé !**\n\n[SFX:thinking]\n\nJe vais te montrer ce que je sais faire${themeMsg}.\n\nPlan de démonstration : ${showcasePlan.steps.length} actions spectaculaires.\n\nC'est parti ! 🚀`,
            });
          } else {
            throw new Error(`Cerbère returned status ${cerbereResponse.status}`);
          }
        } catch (showcaseError) {
          console.error('[A11][chat] Failed to create showcase task:', showcaseError);
          // Fallback : réponse d'erreur gracieuse
          return res.json({
            ok: true,
            mode: 'llm',
            assistant: `Je détecte que tu veux voir mes capacités, mais je rencontre un problème technique pour lancer le Showcase Mode. Erreur : ${showcaseError.message}\n\nJe peux quand même te parler de ce que je sais faire si tu veux !`,
          });
        }
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: Number(process.env.A11_CHAT_MAX_TOKENS || 4096),
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

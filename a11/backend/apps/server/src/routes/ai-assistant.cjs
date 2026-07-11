'use strict';

/**
 * AI Assistant - Problem-solving assistant for Funesterie.
 * Uses the existing OpenAI provider to help with platform questions,
 * technical issues, and general assistance.
 */

const express = require('express');
const { askOpenAI } = require('../providers/openai');

const SYSTEM_PROMPT = `Tu es l'assistant IA de Funesterie, la plateforme créative qui regroupe A11, K44, Vivy, Djeff, Kiro et Codex.

Tu aides les utilisateurs à:
- Résoudre des problèmes techniques (API, déploiement, configuration)
- Comprendre le fonctionnement de la plateforme et de ses modules
- Naviguer dans l'écosystème Funesterie (agents, pipelines, mémoires, services)
- Diagnostiquer des erreurs et proposer des solutions
- Répondre à des questions sur les personas (Djeff le rappeur, Vivy la voix, A11 l'architecte, K44 le compagnon, Kiro le combattant)

Règles:
- Réponds en français par défaut, sauf si on te parle en anglais
- Sois précis, technique quand il faut, et chaleureux toujours
- Si tu ne sais pas, dis-le et propose une marche à suivre
- Tu connais l'architecture: Express backend, React frontend, Cloudflare tunnels, Railway, Neo4j, Ollama
- Tu connais les domaines: funesterie.me, funesterie.pro, salon.funesterie.me
- Les secrets ne sont jamais partagés, guide vers les bonnes pratiques
- Réponds de manière concise (2-5 phrases) sauf si on te demande des détails`;

function createAIAssistantRouter({ verifyJWT }) {
  const router = express.Router();

  // All routes require auth
  router.use(verifyJWT);

  /**
   * POST /api/ai-assistant/chat
   * Body: { messages: [{role, content}], context?: string }
   */
  router.post('/chat', async (req, res) => {
    try {
      const { messages, context } = req.body || {};

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ ok: false, error: 'messages requis' });
      }

      const systemContent = context
        ? `${SYSTEM_PROMPT}\n\nContexte additionnel: ${context}`
        : SYSTEM_PROMPT;

      const fullMessages = [
        { role: 'system', content: systemContent },
        ...messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 4000),
        })),
      ];

      const result = await askOpenAI({
        messages: fullMessages,
        model: process.env.A11_OPENAI_MODEL || 'gpt-4o-mini',
      });

      const reply = typeof result === 'string'
        ? result
        : (result?.choices?.[0]?.message?.content || result?.content || '');

      if (!reply) {
        return res.status(502).json({
          ok: false,
          error: 'Assistant IA temporairement indisponible',
        });
      }

      return res.json({
        ok: true,
        reply: reply.trim(),
        model: process.env.A11_OPENAI_MODEL || 'gpt-4o-mini',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[ai-assistant] chat error:', err?.message || err);
      return res.status(502).json({
        ok: false,
        error: 'Erreur assistant IA',
        detail: String(err?.message || '').slice(0, 200),
      });
    }
  });

  /**
   * POST /api/ai-assistant/diagnose
   * Body: { problem: string, context?: object }
   * Returns a structured diagnosis
   */
  router.post('/diagnose', async (req, res) => {
    try {
      const { problem, context } = req.body || {};

      if (!problem || typeof problem !== 'string') {
        return res.status(400).json({ ok: false, error: 'problem requis' });
      }

      const contextStr = context
        ? Object.entries(context).map(([k, v]) => `${k}: ${v}`).join('\n')
        : 'Aucun contexte fourni';

      const diagnoseMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Diagnostique ce problème et propose une solution structurée:

Problème: ${problem.slice(0, 2000)}

Contexte:
${contextStr}

Réponds en JSON:
{
  "diagnosis": "analyse du problème",
  "severity": "low|medium|high|critical",
  "possible_causes": ["cause1", "cause2"],
  "solutions": [
    {"step": "étape 1", "action": "description"},
    {"step": "étape 2", "action": "description"}
  ],
  "preventive": "conseil de prévention"
}`,
        },
      ];

      const result = await askOpenAI({
        messages: diagnoseMessages,
        model: process.env.A11_OPENAI_MODEL || 'gpt-4o-mini',
      });

      const reply = typeof result === 'string'
        ? result
        : (result?.choices?.[0]?.message?.content || result?.content || '');

      let diagnosis;
      try {
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        diagnosis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: reply };
      } catch {
        diagnosis = { raw: reply };
      }

      return res.json({
        ok: true,
        diagnosis,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[ai-assistant] diagnose error:', err?.message || err);
      return res.status(502).json({
        ok: false,
        error: 'Erreur diagnostic',
        detail: String(err?.message || '').slice(0, 200),
      });
    }
  });

  /**
   * GET /api/ai-assistant/status
   * Check if the AI assistant is available
   */
  router.get('/status', (req, res) => {
    const hasOpenAI = !!(process.env.OPENAI_API_KEY || process.env.A11_OPENAI_BASE_URL);
    return res.json({
      ok: true,
      available: hasOpenAI,
      model: process.env.A11_OPENAI_MODEL || 'gpt-4o-mini',
      features: ['chat', 'diagnose'],
    });
  });

  /**
   * GET /api/ai-assistant/knowledge
   * Return Funesterie knowledge summary for the assistant
   */
  router.get('/knowledge', (req, res) => {
    return res.json({
      agents: ['A11', 'K44', 'Vivy', 'Djeff', 'Kiro', 'Codex'],
      modules: ['chat', 'memory', 'knowledge-graph', 'casino', 'video-generate', 'social-autoprompt', 'vivy-studio', 'voice-learning', 'mail', 'sfx'],
      services: ['cockpit', 'mcp', 'ollama', 'sd-tools', 'image-atelier', 'semantic-media-roulette'],
      domains: ['funesterie.me', 'funesterie.pro', 'salon.funesterie.me', 'mcp.funesterie.me', 'vivy.funesterie.me'],
      infra: ['Cloudflare (tunnels, R2)', 'Railway', 'Neo4j', 'Netlify', 'Ollama local'],
    });
  });

  return router;
}

module.exports = { createAIAssistantRouter };

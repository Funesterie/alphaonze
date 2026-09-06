'use strict';
/**
 * djeff-engine-switch.cjs — Switch violet : bascule entre Djeff local (Ollama) et cloud.
 *
 * Mode local : djeff-engine sur Ollama (qwen2.5:32b fine-tuné)
 * Mode cloud : route vers le LLM cloud configuré (Grok 4.3, GPT-5, etc.)
 *
 * Le switch se fait via :
 *   - Variable DJEFF_ENGINE_MODE=local|cloud|auto
 *   - Route API /api/djeff-engine/switch (toggle)
 *   - "auto" : essaie local d'abord, fallback cloud si timeout
 */

const http = require('http');

const OLLAMA_BASE = process.env.A11_OLLAMA_BASE || process.env.OLLAMA_BASE_URL || 'http://a11-ollama:11434';
const MODEL = process.env.DJEFF_ENGINE_MODEL || 'djeff-engine';
const TIMEOUT_MS = Number(process.env.DJEFF_ENGINE_TIMEOUT_MS || 45000);

let currentMode = (process.env.DJEFF_ENGINE_MODE || 'auto').toLowerCase();

function getMode() { return currentMode; }
function setMode(mode) {
  if (['local', 'cloud', 'auto'].includes(mode)) currentMode = mode;
  return currentMode;
}

/**
 * Chat avec Djeff Engine local (Ollama).
 */
async function chatLocal(messages, options = {}) {
  const body = JSON.stringify({
    model: options.model || MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature || 0.8,
      num_predict: options.maxTokens || 2000,
    },
  });

  return new Promise((resolve, reject) => {
    const req = http.request(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: options.timeout || TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            ok: true,
            source: 'local',
            model: MODEL,
            content: parsed.message?.content || '',
            totalDuration: parsed.total_duration,
          });
        } catch (e) {
          reject(new Error('parse_error: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Chat avec le mode approprié.
 * En mode "auto" : essaie local, fallback cloud.
 */
async function chat(messages, options = {}) {
  if (currentMode === 'local') {
    return chatLocal(messages, options);
  }
  if (currentMode === 'cloud') {
    return { ok: false, source: 'cloud', reason: 'cloud_route_not_implemented_here' };
  }
  // Auto : essaie local, fallback signalé
  try {
    return await chatLocal(messages, { ...options, timeout: Math.min(TIMEOUT_MS, 30000) });
  } catch (err) {
    return {
      ok: false,
      source: 'auto-fallback',
      reason: err.message,
      hint: 'Route vers le LLM cloud (Grok/GPT) via le chat router standard',
    };
  }
}

/**
 * Crée le routeur Express pour le switch.
 */
function createDjeffEngineRouter() {
  const express = require('express');
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json({ mode: currentMode, model: MODEL, ollamaBase: OLLAMA_BASE });
  });

  router.post('/switch', express.json(), (req, res) => {
    const newMode = setMode(req.body?.mode || (currentMode === 'local' ? 'cloud' : 'local'));
    console.log(`[djeff-engine] Switch → ${newMode}`);
    res.json({ ok: true, mode: newMode });
  });

  router.post('/chat', express.json({ limit: '256kb' }), async (req, res) => {
    const messages = req.body?.messages || [{ role: 'user', content: req.body?.prompt || '' }];
    try {
      const result = await chat(messages, req.body?.options);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { chat, chatLocal, getMode, setMode, createDjeffEngineRouter, MODEL };

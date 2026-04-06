/* apps/server/providers/openai.js
   Lightweight wrapper for OpenAI calls. If the `openai` package isn't installed
   we surface a clear error and avoid crashing the whole server on require.
*/
'use strict';

let OpenAI;
let HAS_OPENAI = true;
try {
  OpenAI = require('openai');
} catch (err) {
  HAS_OPENAI = false;
  // Don't throw here — surface a runtime error when trying to call the functions.
  console.warn('[A11] warning: `openai` package not installed. Install it with `cd apps/server && npm i openai` to enable OpenAI backend.');
}

function getClient() {
  if (!HAS_OPENAI) {
    throw new Error('OpenAI client not available: install the `openai` package in apps/server (npm i openai)');
  }
  return new OpenAI.default({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.A11_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || undefined
  });
}

async function askOpenAI(opts) {
  if (!HAS_OPENAI) throw new Error('OpenAI unavailable: npm install openai in apps/server');

  const client = getClient();
  const model = opts?.model || process.env.A11_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const messages = Array.isArray(opts?.messages) ? opts.messages : (opts?.prompt ? [{ role: 'user', content: String(opts.prompt) }] : []);

  const res = await client.chat.completions.create({
    model,
    messages,
    stream: false,
  });

  // Support different SDK shapes but prefer the v3-style payload
  const content = res?.choices?.[0]?.message?.content ?? res?.choices?.[0]?.text ?? '';
  return String(content || '');
}

async function streamOpenAI(opts, onChunk) {
  if (!HAS_OPENAI) throw new Error('OpenAI unavailable: npm install openai in apps/server');

  const client = getClient();
  const model = opts?.model || process.env.A11_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const messages = Array.isArray(opts?.messages) ? opts.messages : (opts?.prompt ? [{ role: 'user', content: String(opts.prompt) }] : []);

  try {
    const stream = await client.chat.completions.create({ model, messages, stream: true });
    for await (const part of stream) {
      const delta = part?.choices?.[0]?.delta?.content || part?.choices?.[0]?.text || '';
      if (delta && typeof onChunk === 'function') onChunk(String(delta));
    }
  } catch (err) {
    // If the SDK or network doesn't support streaming, fall back to single response
    console.warn('[A11] OpenAI streaming failed, falling back to non-streaming:', err && err.message);
    const full = await askOpenAI(opts);
    if (typeof onChunk === 'function') {
      // send in small slices to simulate a stream
      const step = 64;
      for (let i = 0; i < full.length; i += step) {
        onChunk(full.slice(i, i + step));
      }
    }
  }
}

module.exports = { askOpenAI, streamOpenAI };

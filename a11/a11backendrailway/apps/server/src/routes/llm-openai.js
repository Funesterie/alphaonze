const { askOpenAI, streamOpenAI } = require("../../providers/openai");
const { countMessageTokens } = require("../../utils/tokenizer");
const { buildLongTermMemorySnippet } = require("../../lib/a11-longterm.cjs");

function registerOpenAIRoutes(router) {
  // POST /llm/openai

  // Limite contextuelle (OpenAI GPT-4o: 4096 tokens, ajustable)
  const MAX_TOKENS = 4096;
  const MIN_MESSAGES = 4;

  router.post('/llm/openai', async (req, res) => {
    try {
      const { prompt, history, model, systemPrompt } = req.body || {};

      if (!prompt && !(Array.isArray(history) && history.length)) {
        return res.status(400).json({ ok: false, error: 'Missing prompt or history' });
      }

      let messages = (Array.isArray(history) && history.length)
        ? history
        : [
            systemPrompt ? { role: 'system', content: systemPrompt } : null,
            { role: 'user', content: prompt }
          ].filter(Boolean);

      // Inject long-term memory snippet as a system message
      const ltmSnippet = await buildLongTermMemorySnippet();
      messages = [
        ...messages,
        { role: 'system', content: ltmSnippet }
      ];

      // Si trop de tokens, on résume/tronque l'historique
      let totalTokens = countMessageTokens(messages);
      if (totalTokens > MAX_TOKENS) {
        // On garde le systemPrompt, le dernier message user, et on résume le reste
        const systemMsg = messages.find(m => m.role === 'system');
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const assistantMsgs = messages.filter(m => m.role === 'assistant');
        // Génère un résumé simple des anciens messages
        const summary = `Résumé des échanges précédents :\n` + assistantMsgs.map(m => m.content).join(' ');
        messages = [
          ...(systemMsg ? [systemMsg] : []),
          { role: 'system', content: summary.slice(0, 1000) },
          ...(lastUserMsg ? [lastUserMsg] : [])
        ];
      }

      const output = await askOpenAI({ model, systemPrompt, messages });
      res.json({ ok: true, output });
    } catch (err) {
      console.error('[A11/OpenAI] error:', err);
      res.status(500).json({ ok: false, error: (err && err.message) || 'OpenAI error' });
    }
  });

  // POST /llm/openai/stream  (SSE)
  router.post('/llm/openai/stream', async (req, res) => {
    try {
      const { prompt, history, model, systemPrompt } = req.body || {};

      if (!prompt && !(Array.isArray(history) && history.length)) {
        res.status(400).end();
        return;
      }

      const messages = (Array.isArray(history) && history.length)
        ? history
        : [
            systemPrompt ? { role: 'system', content: systemPrompt } : null,
            { role: 'user', content: prompt }
          ].filter(Boolean);

      // Inject long-term memory snippet as a system message
      const ltmSnippet = await buildLongTermMemorySnippet();
      const finalMessages = [
        ...messages,
        { role: 'system', content: ltmSnippet }
      ];

      // Headers SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (res.flushHeaders) res.flushHeaders();

      let buffer = '';

      await streamOpenAI({ model, systemPrompt, messages: finalMessages }, (delta) => {
        buffer += delta;
        const payload = JSON.stringify({ delta, full: buffer });
        try {
          res.write(`data: ${payload}\n\n`);
        } catch (e) {
          // ignore write errors
        }
      });

      // End of stream
      try {
        res.write(`data: ${JSON.stringify({ done: true, full: buffer })}\n\n`);
      } catch (e) {}
      res.end();
    } catch (err) {
      console.error('[A11/OpenAI stream] error:', err);
      try {
        res.write(`data: ${JSON.stringify({ error: (err && err.message) || 'OpenAI stream error' })}\n\n`);
      } catch {}
      res.end();
    }
  });

  // La route /v1/chat/completions est supprimée pour éviter les doublons
}

module.exports = { registerOpenAIRoutes };

// vector-memory.cjs
// Routes API pour la mémoire vectorielle (RAG)

const express = require('express');
const { createVectorMemory } = require('../../lib/vector-memory.cjs');

function createVectorMemoryRouter({ verifyJWT, normalizeConversationId } = {}) {
  const router = express.Router();

  // GET /api/vector-memory/search - Recherche sémantique dans la mémoire
  router.get('/api/vector-memory/search', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const conversationId = normalizeConversationId(req.query.conversationId);
      const query = String(req.query.q || req.query.query || '').trim();
      const k = Math.max(1, Math.min(20, Number(req.query.k || 5)));
      const minSimilarity = Math.max(0, Math.min(1, Number(req.query.minSimilarity || 0.5)));

      if (!userId || !query) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and query are required',
        });
      }

      const vectorMemory = createVectorMemory(userId, conversationId);
      const results = await vectorMemory.search(query, { k, minSimilarity });

      return res.json({
        ok: true,
        query,
        resultCount: results.length,
        results: results.map((r) => ({
          userMessage: r.userMessage,
          assistantMessage: r.assistantMessage,
          timestamp: r.timestamp,
          similarity: r.similarity,
          metadata: r.metadata,
        })),
      });
    } catch (error) {
      req.logger?.error('Vector memory search failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'vector_search_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/vector-memory/context - Récupère le contexte pertinent pour une requête
  router.get('/api/vector-memory/context', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const conversationId = normalizeConversationId(req.query.conversationId);
      const query = String(req.query.q || req.query.query || '').trim();
      const k = Math.max(1, Math.min(20, Number(req.query.k || 5)));
      const minSimilarity = Math.max(0, Math.min(1, Number(req.query.minSimilarity || 0.5)));

      if (!userId || !query) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId and query are required',
        });
      }

      const vectorMemory = createVectorMemory(userId, conversationId);
      const context = await vectorMemory.getRelevantContext(query, { k, minSimilarity });

      return res.json({
        ok: true,
        query,
        found: context.found,
        context: context.context,
        exchangeCount: context.exchanges.length,
        exchanges: context.exchanges,
      });
    } catch (error) {
      req.logger?.error('Vector memory context retrieval failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'context_retrieval_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/vector-memory/add - Ajoute un échange à la mémoire vectorielle
  router.post('/api/vector-memory/add', verifyJWT, express.json(), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const conversationId = normalizeConversationId(req.body?.conversationId);
      const userMessage = String(req.body?.userMessage || '').trim();
      const assistantMessage = String(req.body?.assistantMessage || '').trim();
      const metadata = req.body?.metadata || {};

      if (!userId || !userMessage || !assistantMessage) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'userId, userMessage, and assistantMessage are required',
        });
      }

      const vectorMemory = createVectorMemory(userId, conversationId);
      const entry = await vectorMemory.addExchange(userMessage, assistantMessage, metadata);

      if (!entry) {
        return res.status(500).json({
          ok: false,
          error: 'embedding_generation_failed',
          message: 'Failed to generate embedding for exchange',
        });
      }

      return res.json({
        ok: true,
        id: entry.id,
        timestamp: entry.timestamp,
      });
    } catch (error) {
      req.logger?.error('Vector memory add failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'vector_add_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/vector-memory/stats - Statistiques de la mémoire vectorielle
  router.get('/api/vector-memory/stats', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const conversationId = normalizeConversationId(req.query.conversationId);

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
        });
      }

      const vectorMemory = createVectorMemory(userId, conversationId);
      const stats = vectorMemory.getStats();

      return res.json({
        ok: true,
        stats,
      });
    } catch (error) {
      req.logger?.error('Vector memory stats failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'stats_failed',
        message: String(error?.message || error),
      });
    }
  });

  // DELETE /api/vector-memory/prune - Nettoie les entrées anciennes
  router.delete('/api/vector-memory/prune', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      const conversationId = normalizeConversationId(req.query.conversationId);
      const maxAgeDays = Math.max(1, Math.min(365, Number(req.query.maxAgeDays || 30)));

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
        });
      }

      const vectorMemory = createVectorMemory(userId, conversationId);
      const result = vectorMemory.pruneOldEntries(maxAgeDays);

      return res.json({
        ok: true,
        removed: result.removed,
        remaining: result.remaining,
      });
    } catch (error) {
      req.logger?.error('Vector memory prune failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'prune_failed',
        message: String(error?.message || error),
      });
    }
  });

  return router;
}

module.exports = createVectorMemoryRouter;

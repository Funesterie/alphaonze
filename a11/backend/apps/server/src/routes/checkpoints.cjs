/**
 * Routes API pour le Checkpoint Manager
 *
 * Monté sous /api/checkpoints dans server.cjs
 *
 * Endpoints:
 * - POST   /                    Créer un checkpoint
 * - GET    /                    Lister les checkpoints
 * - GET    /stats               Statistiques (AVANT /:id pour éviter conflit)
 * - POST   /rollback            Rollback vers un checkpoint
 * - POST   /cleanup             Nettoyage manuel
 * - GET    /:checkpointId       Récupérer un checkpoint
 * - DELETE /:checkpointId       Supprimer un checkpoint
 */

const express = require('express');

function createCheckpointsRouter({ checkpointManager } = {}) {
  const router = express.Router();

  if (!checkpointManager) {
    throw new Error('checkpointManager is required');
  }

  // ── POST / ─ Créer un checkpoint ────────────────────────────────────────────
  router.post('/', express.json({ limit: '50mb' }), (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const conversationId = String(req.body?.conversationId || '').trim();
      if (!conversationId) return res.status(400).json({ ok: false, error: 'missing_conversation_id' });

      const checkpoint = checkpointManager.createCheckpoint({
        userId,
        conversationId,
        runId: req.body?.runId,
        stepNumber: req.body?.stepNumber,
        reason: req.body?.reason || 'manual',
        conversationHistory: req.body?.conversationHistory || req.body?.conversation_history,
        internalStateGraph: req.body?.internalStateGraph || req.body?.internal_state_graph,
        executionContext: req.body?.executionContext || req.body?.execution_context,
        toolInputsOutputs: req.body?.toolInputsOutputs || req.body?.tool_inputs_outputs,
        confidenceScore: req.body?.confidenceScore || req.body?.current_confidence_score,
        metadata: req.body?.metadata,
      });

      return res.json({
        ok: true,
        checkpoint: {
          checkpointId: checkpoint.checkpointId,
          timestamp: checkpoint.timestamp,
          metadata: checkpoint.metadata,
        },
      });
    } catch (error) {
      console.error('[CHECKPOINTS] create failed:', error.message);
      return res.status(500).json({ ok: false, error: 'checkpoint_create_failed', message: error.message });
    }
  });

  // ── GET / ─ Lister les checkpoints ──────────────────────────────────────────
  router.get('/', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const filters = { userId };
      if (req.query.conversationId) filters.conversationId = String(req.query.conversationId).trim();
      if (req.query.runId) filters.runId = String(req.query.runId).trim();

      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
      const checkpoints = checkpointManager.listCheckpoints(filters)
        .slice(0, limit)
        .map(cp => ({
          checkpointId: cp.checkpointId,
          timestamp: cp.timestamp,
          metadata: cp.metadata,
          confidenceScore: cp.current_confidence_score,
        }));

      return res.json({ ok: true, count: checkpoints.length, checkpoints });
    } catch (error) {
      console.error('[CHECKPOINTS] list failed:', error.message);
      return res.status(500).json({ ok: false, error: 'checkpoint_list_failed', message: error.message });
    }
  });

  // ── GET /stats ─ Statistiques (AVANT /:checkpointId) ────────────────────────
  router.get('/stats', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const conversationId = req.query.conversationId
        ? String(req.query.conversationId).trim()
        : undefined;

      const stats = checkpointManager.getStats(userId, conversationId);
      return res.json({ ok: true, stats });
    } catch (error) {
      console.error('[CHECKPOINTS] stats failed:', error.message);
      return res.status(500).json({ ok: false, error: 'checkpoint_stats_failed', message: error.message });
    }
  });

  // ── POST /rollback ─ Rollback (AVANT /:checkpointId) ────────────────────────
  router.post('/rollback', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const checkpointId = String(req.body?.checkpointId || '').trim();
      if (!checkpointId) return res.status(400).json({ ok: false, error: 'missing_checkpoint_id' });

      const checkpoint = checkpointManager.getCheckpoint(checkpointId);
      if (!checkpoint) return res.status(404).json({ ok: false, error: 'checkpoint_not_found' });
      if (checkpoint.metadata?.userId !== userId) return res.status(403).json({ ok: false, error: 'forbidden' });

      const restoredState = checkpointManager.rollback({
        checkpointId,
        reason: req.body?.reason,
        preserveContext: req.body?.preserveContext,
        reformulate: req.body?.reformulate,
      });

      return res.json({ ok: true, restoredState });
    } catch (error) {
      console.error('[CHECKPOINTS] rollback failed:', error.message);
      if (error.message === 'checkpoint_not_found') {
        return res.status(404).json({ ok: false, error: 'checkpoint_not_found' });
      }
      return res.status(500).json({ ok: false, error: 'checkpoint_rollback_failed', message: error.message });
    }
  });

  // ── POST /cleanup ─ Nettoyage manuel (AVANT /:checkpointId) ─────────────────
  router.post('/cleanup', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const options = {
        maxAgeMs: req.body?.maxAgeDays ? req.body.maxAgeDays * 24 * 60 * 60 * 1000 : undefined,
        keepLast: req.body?.keepLast,
        keepCurrentSession: req.body?.keepCurrentSession,
      };

      const cleaned = checkpointManager.cleanup(options);
      return res.json({ ok: true, cleaned });
    } catch (error) {
      console.error('[CHECKPOINTS] cleanup failed:', error.message);
      return res.status(500).json({ ok: false, error: 'checkpoint_cleanup_failed', message: error.message });
    }
  });

  // ── GET /:checkpointId ─ Récupérer un checkpoint ────────────────────────────
  router.get('/:checkpointId', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const checkpointId = String(req.params?.checkpointId || '').trim();
      if (!checkpointId) return res.status(400).json({ ok: false, error: 'missing_checkpoint_id' });

      const checkpoint = checkpointManager.getCheckpoint(checkpointId);
      if (!checkpoint) return res.status(404).json({ ok: false, error: 'checkpoint_not_found' });
      if (checkpoint.metadata?.userId !== userId) return res.status(403).json({ ok: false, error: 'forbidden' });

      return res.json({ ok: true, checkpoint });
    } catch (error) {
      console.error('[CHECKPOINTS] get failed:', error.message);
      return res.status(500).json({ ok: false, error: 'checkpoint_get_failed', message: error.message });
    }
  });

  // ── DELETE /:checkpointId ─ Supprimer un checkpoint ─────────────────────────
  router.delete('/:checkpointId', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const checkpointId = String(req.params?.checkpointId || '').trim();
      if (!checkpointId) return res.status(400).json({ ok: false, error: 'missing_checkpoint_id' });

      const checkpoint = checkpointManager.getCheckpoint(checkpointId);
      if (!checkpoint) return res.status(404).json({ ok: false, error: 'checkpoint_not_found' });
      if (checkpoint.metadata?.userId !== userId) return res.status(403).json({ ok: false, error: 'forbidden' });

      const deleted = checkpointManager.deleteCheckpoint(checkpointId);
      return res.json({ ok: true, deleted });
    } catch (error) {
      console.error('[CHECKPOINTS] delete failed:', error.message);
      return res.status(500).json({ ok: false, error: 'checkpoint_delete_failed', message: error.message });
    }
  });

  return router;
}

module.exports = createCheckpointsRouter;

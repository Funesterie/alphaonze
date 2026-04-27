// episodic-memory.cjs
// Routes API pour la mémoire épisodique

const express = require('express');
const {
  addEpisode,
  getEpisodes,
  getPreferences,
  setPreference,
  getRecentContext,
  deleteEpisode,
  clearUserEpisodes,
  buildEpisodicContext,
  getStats,
} = require('../../lib/episodic-memory.cjs');

function createEpisodicMemoryRouter({ verifyJWT } = {}) {
  const router = express.Router();

  // POST /api/episodic/add - Ajouter un épisode
  router.post('/api/episodic/add', verifyJWT, express.json(), async (req, res) => {
    try {
      const userId = String(req.user?.id || req.body?.userId || '').trim();
      const type = String(req.body?.type || 'event').trim();
      const content = String(req.body?.content || '').trim();
      const metadata = req.body?.metadata || {};

      if (!userId || !content) {
        return res.status(400).json({
          ok: false,
          error: 'missing_required_fields',
          message: 'userId and content are required',
        });
      }

      const result = addEpisode(userId, type, content, metadata);
      return res.json(result);
    } catch (error) {
      req.logger?.error('Add episode failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'add_episode_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/episodic/list - Lister les épisodes avec filtres
  router.get('/api/episodic/list', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim();
      const type = req.query?.type;
      const days = req.query?.days ? Number(req.query.days) : undefined;
      const since = req.query?.since;
      const until = req.query?.until;
      const limit = req.query?.limit ? Number(req.query.limit) : undefined;

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
          message: 'userId is required',
        });
      }

      const result = getEpisodes(userId, { type, days, since, until, limit });
      return res.json(result);
    } catch (error) {
      req.logger?.error('List episodes failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'list_episodes_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/episodic/preferences - Récupérer les préférences
  router.get('/api/episodic/preferences', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim();

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
          message: 'userId is required',
        });
      }

      const result = getPreferences(userId);
      return res.json(result);
    } catch (error) {
      req.logger?.error('Get preferences failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'get_preferences_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/episodic/preference - Définir une préférence
  router.post('/api/episodic/preference', verifyJWT, express.json(), async (req, res) => {
    try {
      const userId = String(req.user?.id || req.body?.userId || '').trim();
      const key = String(req.body?.key || '').trim();
      const value = req.body?.value;
      const metadata = req.body?.metadata || {};

      if (!userId || !key || value === undefined) {
        return res.status(400).json({
          ok: false,
          error: 'missing_required_fields',
          message: 'userId, key, and value are required',
        });
      }

      const result = setPreference(userId, key, value, metadata);
      return res.json(result);
    } catch (error) {
      req.logger?.error('Set preference failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'set_preference_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/episodic/context - Récupérer le contexte récent
  router.get('/api/episodic/context', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim();
      const days = req.query?.days ? Number(req.query.days) : 7;

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
          message: 'userId is required',
        });
      }

      const result = getRecentContext(userId, days);
      const context = buildEpisodicContext(userId, days);

      return res.json({
        ...result,
        contextText: context,
      });
    } catch (error) {
      req.logger?.error('Get context failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'get_context_failed',
        message: String(error?.message || error),
      });
    }
  });

  // DELETE /api/episodic/:episodeId - Supprimer un épisode
  router.delete('/api/episodic/:episodeId', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim();
      const episodeId = String(req.params?.episodeId || '').trim();

      if (!userId || !episodeId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_required_fields',
          message: 'userId and episodeId are required',
        });
      }

      const result = deleteEpisode(userId, episodeId);
      return res.json(result);
    } catch (error) {
      req.logger?.error('Delete episode failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'delete_episode_failed',
        message: String(error?.message || error),
      });
    }
  });

  // DELETE /api/episodic/clear - Supprimer tous les épisodes
  router.delete('/api/episodic/clear', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim();

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
          message: 'userId is required',
        });
      }

      const result = clearUserEpisodes(userId);
      return res.json(result);
    } catch (error) {
      req.logger?.error('Clear episodes failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'clear_episodes_failed',
        message: String(error?.message || error),
      });
    }
  });

  // GET /api/episodic/stats - Statistiques
  router.get('/api/episodic/stats', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim();

      if (!userId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_user_id',
          message: 'userId is required',
        });
      }

      const result = getStats(userId);
      return res.json(result);
    } catch (error) {
      req.logger?.error('Get stats failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'get_stats_failed',
        message: String(error?.message || error),
      });
    }
  });

  return router;
}

module.exports = createEpisodicMemoryRouter;

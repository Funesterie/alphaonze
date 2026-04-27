'use strict';
/**
 * Vision Memory Route — /api/agent/vision-memory
 *
 * Permet à A11 de gérer sa mémoire visuelle (empreintes d'images analysées par Janus).
 *
 * POST /api/agent/vision-memory/analyze  — analyser une image et sauvegarder l'empreinte
 * GET  /api/agent/vision-memory/list     — lister les empreintes (filtre userId, limit)
 * GET  /api/agent/vision-memory/search   — chercher par texte libre
 * GET  /api/agent/vision-memory/:id      — lire une empreinte spécifique
 * GET  /api/agent/vision-memory/context  — contexte textuel pour injection LLM
 */

const express = require('express');
const {
  analyzeAndSave,
  loadVisionEntry,
  listVisionEntries,
  searchVisionEntries,
  buildVisionContext,
} = require('../../lib/vision-memory.cjs');
const { getLogger } = require('../../lib/structured-logger.cjs');

const logger = getLogger({ component: 'vision-memory-route' });

function createVisionMemoryRouter({ runtimeRoot } = {}) {
  const router = express.Router();

  // ── POST /analyze ─────────────────────────────────────────────────────────
  router.post('/analyze', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const userId = String(req.user?.id || req.body?.userId || '').trim();
      const {
        imageLocator,
        imageId,
        imagePath,
        imageUrl,
        prompt,
        conversationId,
        source,
        timeoutMs,
      } = req.body || {};

      if (!imageLocator && !imagePath && !imageUrl) {
        return res.status(400).json({
          ok: false,
          error: 'missing_image',
          message: 'Fournis "imageLocator", "imagePath" ou "imageUrl".',
        });
      }

      const locator = imageLocator || imageUrl || imagePath;

      logger.info('Vision memory analyze request', { userId, source, locator: String(locator || '').slice(0, 80) });

      const result = await analyzeAndSave({
        imageLocator: locator,
        imageId,
        imagePath,
        imageUrl,
        prompt,
        userId,
        conversationId,
        source: source || 'unknown',
        runtimeRoot,
        timeoutMs: Number(timeoutMs) || 45000,
      });

      return res.json({
        ok: result.ok,
        entry: result.entry,
        skipped: result.skipped,
        reason: result.reason,
      });

    } catch (err) {
      logger.error('Vision memory analyze error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'analyze_failed', message: err.message });
    }
  });

  // ── GET /list ─────────────────────────────────────────────────────────────
  router.get('/list', (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim() || undefined;
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));

      const entries = listVisionEntries({ runtimeRoot, userId, limit });

      return res.json({
        ok: true,
        entries,
        total: entries.length,
      });
    } catch (err) {
      logger.error('Vision memory list error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'list_failed', message: err.message });
    }
  });

  // ── GET /search ───────────────────────────────────────────────────────────
  router.get('/search', (req, res) => {
    try {
      const query = String(req.query?.q || req.query?.query || '').trim();
      const userId = String(req.user?.id || req.query?.userId || '').trim() || undefined;
      const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20)));

      if (!query) {
        return res.status(400).json({ ok: false, error: 'missing_query', message: 'Paramètre "q" requis.' });
      }

      const entries = searchVisionEntries({ query, runtimeRoot, userId, limit });

      return res.json({
        ok: true,
        query,
        entries,
        total: entries.length,
      });
    } catch (err) {
      logger.error('Vision memory search error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'search_failed', message: err.message });
    }
  });

  // ── GET /context ──────────────────────────────────────────────────────────
  router.get('/context', (req, res) => {
    try {
      const userId = String(req.user?.id || req.query?.userId || '').trim() || undefined;
      const conversationId = String(req.query?.conversationId || '').trim() || undefined;
      const limit = Math.min(10, Math.max(1, Number(req.query?.limit || 5)));

      const context = buildVisionContext({ runtimeRoot, userId, conversationId, limit });

      return res.json({ ok: true, context, hasContext: context.length > 0 });
    } catch (err) {
      logger.error('Vision memory context error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'context_failed', message: err.message });
    }
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────
  router.get('/:id', (req, res) => {
    try {
      const imageId = String(req.params.id || '').trim();
      if (!imageId) return res.status(400).json({ ok: false, error: 'missing_id' });

      const entry = loadVisionEntry(imageId, runtimeRoot);
      if (!entry) {
        return res.status(404).json({ ok: false, error: 'not_found', message: `Empreinte introuvable : ${imageId}` });
      }

      return res.json({ ok: true, entry });
    } catch (err) {
      logger.error('Vision memory get error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'get_failed', message: err.message });
    }
  });

  return router;
}

module.exports = createVisionMemoryRouter;

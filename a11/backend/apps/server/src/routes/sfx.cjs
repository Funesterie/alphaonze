'use strict';
/**
 * Route SFX — Sons de karma émotionnel pour A11
 *
 * GET  /api/sfx/list              — liste les sons disponibles
 * GET  /api/sfx/:name.wav         — télécharger un son WAV
 * POST /api/sfx/generate          — (re)générer tous les sons
 * POST /api/sfx/parse             — parser les balises [SFX:...] dans un texte
 */

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const {
  generateAllSfx,
  getSfxPath,
  getSfxDir,
  parseSfxTags,
  stripSfxTags,
  extractSfxNames,
  listAvailableSfx,
} = require('../../lib/sfx-engine.cjs');

function createSfxRouter({ runtimeRoot } = {}) {
  const router = express.Router();

  // Générer les sons au démarrage (silencieux, non-bloquant)
  setImmediate(() => {
    try {
      generateAllSfx(runtimeRoot);
      console.log('[SFX] Sons de karma générés dans runtime/sfx/');
    } catch (e) {
      console.warn('[SFX] Génération des sons échouée:', e.message);
    }
  });

  // ── GET /api/sfx/list ─────────────────────────────────────────────────────
  router.get('/list', (req, res) => {
    const available = listAvailableSfx();
    const sfxDir = getSfxDir(runtimeRoot);
    const sounds = available.map(name => {
      const filePath = getSfxPath(name, runtimeRoot);
      const exists = fs.existsSync(filePath);
      return {
        name,
        url: `/api/sfx/${name}.wav`,
        exists,
        size: exists ? fs.statSync(filePath).size : null,
      };
    });
    return res.json({ ok: true, sounds, sfxDir });
  });

  // ── GET /api/sfx/:name.wav ────────────────────────────────────────────────
  router.get('/:name.wav', (req, res) => {
    const name = String(req.params.name || '').toLowerCase().replace(/[^a-z_]/g, '');
    if (!name) return res.status(400).json({ ok: false, error: 'invalid_name' });

    const filePath = getSfxPath(name, runtimeRoot);

    // Générer si absent
    if (!fs.existsSync(filePath)) {
      try {
        generateAllSfx(runtimeRoot);
      } catch (e) {
        return res.status(503).json({ ok: false, error: 'sfx_generation_failed', message: e.message });
      }
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'sfx_not_found', name });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.sendFile(filePath);
  });

  // ── POST /api/sfx/generate ────────────────────────────────────────────────
  router.post('/generate', (req, res) => {
    try {
      const force = req.body?.force === true;
      const results = generateAllSfx(runtimeRoot, { force });
      return res.json({ ok: true, results });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'generation_failed', message: e.message });
    }
  });

  // ── POST /api/sfx/parse ───────────────────────────────────────────────────
  router.post('/parse', express.json({ limit: '256kb' }), (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'missing_text' });

    const segments = parseSfxTags(text);
    const sfxNames = extractSfxNames(text);
    const cleanText = stripSfxTags(text);

    return res.json({
      ok: true,
      segments,
      sfxNames,
      cleanText,
      hasSfx: sfxNames.length > 0,
    });
  });

  return router;
}

module.exports = createSfxRouter;

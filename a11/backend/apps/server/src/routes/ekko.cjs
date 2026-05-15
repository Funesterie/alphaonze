'use strict';
/**
 * Route A11 pour Ekko — module d'écoute audio système.
 *
 * POST /api/ekko/ingest
 *   Reçoit un EkkoEvent depuis le module Python Ekko.
 *   Stocke en mémoire courte, diffuse aux agents Ivy connectés.
 *
 * GET  /api/ekko/status
 *   Retourne l'état connu du module Ekko (dernière activité, nb events).
 */

const express = require('express');
const router = express.Router();

// ------------------------------------------------------------------
// Auth guard — EKKO_TOKEN (env var)
// Si défini : vérifie X-Ekko-Token sur POST /ingest
// Si absent  : localhost uniquement
// ------------------------------------------------------------------
const EKKO_TOKEN = String(process.env.EKKO_TOKEN || '').trim();

function ekkoAuth(req, res, next) {
  if (EKKO_TOKEN) {
    const token = String(req.headers['x-ekko-token'] || '').trim();
    if (token !== EKKO_TOKEN) {
      return res.status(403).json({ ok: false, error: 'ekko_token_invalid' });
    }
    return next();
  }
  // Pas de token configuré → localhost seulement
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    return res.status(403).json({ ok: false, error: 'ekko_localhost_only' });
  }
  return next();
}

// ------------------------------------------------------------------
// Mémoire courte Ekko (ring buffer — 50 events max)
// ------------------------------------------------------------------
const EKKO_MAX_EVENTS = 50;
const _ekkoBuffer = [];
let _ekkoStats = {
  total_received: 0,
  last_received_at: null,
  last_app: null,
};

// ------------------------------------------------------------------
// Schéma minimal de validation
// ------------------------------------------------------------------
function validateEkkoEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const source = String(body.source || 'system_audio').trim();
  const module_ = String(body.module || 'ekko').trim();
  const transcript = String(body.transcript || '').trim();
  const summary = String(body.summary || '').trim();
  const confidence = Number(body.confidence ?? 0);
  const duration_ms = Number(body.duration_ms ?? 0);
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  const app_name = body.app_name ? String(body.app_name).trim() : null;
  const timestamp = body.timestamp ? String(body.timestamp) : String(Date.now());

  // Un event doit avoir au moins un contenu
  if (!transcript && !summary) return null;

  return {
    source,
    module: module_,
    timestamp,
    transcript,
    summary,
    confidence,
    duration_ms,
    tags,
    app_name,
    received_at: Date.now(),
  };
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

/**
 * POST /api/ekko/ingest
 * Corps : EkkoEvent (JSON)
 */
router.post('/ingest', ekkoAuth, express.json({ limit: '64kb' }), (req, res) => {
  const event = validateEkkoEvent(req.body);
  if (!event) {
    return res.status(400).json({ ok: false, error: 'invalid_ekko_event' });
  }

  // Stocker dans le ring buffer
  _ekkoBuffer.push(event);
  if (_ekkoBuffer.length > EKKO_MAX_EVENTS) {
    _ekkoBuffer.shift();
  }

  // Mettre à jour les stats
  _ekkoStats.total_received += 1;
  _ekkoStats.last_received_at = event.timestamp;
  _ekkoStats.last_app = event.app_name || null;

  const content = event.summary || event.transcript;
  console.log(`[Ekko] ← ingest (${event.duration_ms}ms, ${event.confidence.toFixed(2)}) : ${content.slice(0, 80)}`);

  // TODO : diffusion aux agents Ivy / Neo4j memory write
  // _dispatchToIvy(event);

  return res.json({ ok: true, buffered: _ekkoBuffer.length });
});

/**
 * GET /api/ekko/status
 * Retourne les stats et les N derniers events.
 */
router.get('/status', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 10), EKKO_MAX_EVENTS);
  const recent = _ekkoBuffer.slice(-limit).map((e) => ({
    timestamp: e.timestamp,
    duration_ms: e.duration_ms,
    confidence: e.confidence,
    tags: e.tags,
    app_name: e.app_name,
    preview: (e.summary || e.transcript).slice(0, 120),
  }));
  return res.json({
    ok: true,
    stats: _ekkoStats,
    recent,
  });
});

/**
 * DELETE /api/ekko/flush
 * Vide le buffer (debug / privacy wipe).
 */
router.delete('/flush', (req, res) => {
  const count = _ekkoBuffer.length;
  _ekkoBuffer.length = 0;
  console.log(`[Ekko] buffer vidé (${count} events)`);
  return res.json({ ok: true, flushed: count });
});

module.exports = router;
module.exports.getEkkoBuffer = () => [..._ekkoBuffer];
module.exports.getEkkoStats = () => ({ ..._ekkoStats });

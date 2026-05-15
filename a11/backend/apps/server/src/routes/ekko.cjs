'use strict';
/**
 * Route A11 pour Ekko — module d'écoute audio système.
 *
 * POST /api/ekko/ingest   ← reçoit EkkoEvent depuis le module Python
 * GET  /api/ekko/status   ← stats + derniers events (polling frontend)
 * DELETE /api/ekko/flush  ← privacy wipe
 *
 * dispatchToIvy() :
 *   1. Ring buffer (50 events, RAM)
 *   2. KV memory  → ekko:last_context  (fichier JSON A11)
 *   3. Neo4j      → nœud EkkoContext  (si writeNeo4j disponible)
 */

const express = require('express');

// ------------------------------------------------------------------
// Auth guard
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
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!isLocal) return res.status(403).json({ ok: false, error: 'ekko_localhost_only' });
  return next();
}

// ------------------------------------------------------------------
// Ring buffer (mémoire courte — 50 events)
// ------------------------------------------------------------------
const EKKO_MAX_EVENTS = 50;
const _ekkoBuffer = [];
let _ekkoStats = {
  total_received: 0,
  last_received_at: null,
  last_app: null,
};

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------
function validateEkkoEvent(body) {
  if (!body || typeof body !== 'object') return null;
  const transcript = String(body.transcript || '').trim();
  const summary    = String(body.summary    || '').trim();
  if (!transcript && !summary) return null;

  return {
    source:      String(body.source   || 'system_audio').trim(),
    module:      String(body.module   || 'ekko').trim(),
    timestamp:   body.timestamp ? String(body.timestamp) : String(Date.now()),
    transcript,
    summary,
    confidence:  Number(body.confidence  ?? 0),
    duration_ms: Number(body.duration_ms ?? 0),
    tags:        Array.isArray(body.tags) ? body.tags.map(String) : [],
    app_name:    body.app_name ? String(body.app_name).trim() : null,
    received_at: Date.now(),
  };
}

// ------------------------------------------------------------------
// dispatchToIvy — écriture mémoire A11 + Neo4j
// ------------------------------------------------------------------
async function dispatchToIvy(event, { writeMemoryKeyValue, writeNeo4j } = {}) {
  const content = event.summary || event.transcript;

  // 1. KV memory — contexte courant Ekko (dernier transcript utile)
  if (typeof writeMemoryKeyValue === 'function') {
    writeMemoryKeyValue('ekko:last_context', {
      timestamp:   event.timestamp,
      content,
      confidence:  event.confidence,
      duration_ms: event.duration_ms,
      tags:        event.tags,
      app_name:    event.app_name || null,
    });
  }

  // 2. Neo4j — nœud EkkoContext lié à la session courante
  if (typeof writeNeo4j === 'function' && content.length > 10) {
    try {
      await writeNeo4j(
        `MERGE (e:EkkoContext {timestamp: $ts})
         SET e.content     = $content,
             e.confidence  = $confidence,
             e.duration_ms = $duration_ms,
             e.tags        = $tags,
             e.app_name    = $app_name,
             e.source      = 'ekko',
             e.updated_at  = timestamp()`,
        {
          ts:          event.timestamp,
          content,
          confidence:  event.confidence,
          duration_ms: event.duration_ms,
          tags:        event.tags.join(','),
          app_name:    event.app_name || '',
        }
      );
    } catch (err) {
      console.warn('[Ekko] Neo4j write failed (non-bloquant) :', err?.message);
    }
  }
}

// ------------------------------------------------------------------
// Factory — permet d'injecter writeMemoryKeyValue + writeNeo4j
// depuis server.cjs
// ------------------------------------------------------------------
function createEkkoRouter({ writeMemoryKeyValue, writeNeo4j } = {}) {
  const router = express.Router();

  /**
   * POST /api/ekko/ingest
   */
  router.post('/ingest', ekkoAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const event = validateEkkoEvent(req.body);
    if (!event) {
      return res.status(400).json({ ok: false, error: 'invalid_ekko_event' });
    }

    // Ring buffer
    _ekkoBuffer.push(event);
    if (_ekkoBuffer.length > EKKO_MAX_EVENTS) _ekkoBuffer.shift();

    _ekkoStats.total_received += 1;
    _ekkoStats.last_received_at = event.timestamp;
    _ekkoStats.last_app = event.app_name || null;

    const preview = (event.summary || event.transcript).slice(0, 80);
    console.log(`[Ekko] ← ingest (${event.duration_ms}ms, conf=${event.confidence.toFixed(2)}) : ${preview}`);

    // Dispatch asynchrone — ne bloque pas la réponse HTTP
    dispatchToIvy(event, { writeMemoryKeyValue, writeNeo4j }).catch((err) => {
      console.warn('[Ekko] dispatchToIvy error :', err?.message);
    });

    return res.json({ ok: true, buffered: _ekkoBuffer.length });
  });

  /**
   * GET /api/ekko/status
   * Polling frontend (indicateur rouge).
   */
  router.get('/status', (req, res) => {
    const limit  = Math.min(Number(req.query.limit ?? 10), EKKO_MAX_EVENTS);
    const recent = _ekkoBuffer.slice(-limit).map((e) => ({
      timestamp:   e.timestamp,
      duration_ms: e.duration_ms,
      confidence:  e.confidence,
      tags:        e.tags,
      app_name:    e.app_name,
      preview:     (e.summary || e.transcript).slice(0, 120),
    }));

    // listening = true si un event a été reçu dans les 90 dernières secondes
    const lastTs = _ekkoStats.last_received_at;
    const listening = !!lastTs && (Date.now() - Number(lastTs)) < 90_000;

    return res.json({ ok: true, stats: _ekkoStats, recent, listening });
  });

  /**
   * DELETE /api/ekko/flush — privacy wipe
   */
  router.delete('/flush', (req, res) => {
    const count = _ekkoBuffer.length;
    _ekkoBuffer.length = 0;
    console.log(`[Ekko] buffer vidé (${count} events)`);
    return res.json({ ok: true, flushed: count });
  });

  return router;
}

module.exports = createEkkoRouter;
module.exports.getEkkoBuffer = () => [..._ekkoBuffer];
module.exports.getEkkoStats  = () => ({ ..._ekkoStats });

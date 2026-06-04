'use strict';
/**
 * Route STT — Speech-to-Text pour A11
 *
 * POST /api/stt/transcribe
 *   Body: multipart/form-data
 *     - audio: fichier audio (webm, mp4, wav, ogg, mp3, flac)
 *     - language: (optionnel) code ISO 639-1, ex: "fr", "en"
 *     - provider: (optionnel) "faster-whisper" | "ollama" | "openai" | "auto"
 *
 * GET /api/stt/status
 *   Retourne le provider actif, le modèle et la disponibilité.
 *
 * Réponse succès:
 *   { ok: true, text: "...", language: "fr", duration: 3.2, provider: "faster-whisper", model: "Systran/faster-whisper-large-v3" }
 *
 * Réponse erreur:
 *   { ok: false, error: "...", message: "..." }
 */

const express = require('express');
const multer = require('multer');
const { transcribe, getSttStatus } = require('../../lib/stt-service.cjs');
const { getLogger } = require('../../lib/structured-logger.cjs');

const logger = getLogger({ component: 'stt-route' });

// Multer en mémoire — pas de fichier temporaire sur disque
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max (limite Whisper API)
    files: 1,
  },
  fileFilter(_req, file, cb) {
    const allowed = [
      'audio/webm',
      'audio/mp4',
      'audio/wav',
      'audio/ogg',
      'audio/mpeg',
      'audio/mp3',
      'audio/flac',
      'audio/x-wav',
      'audio/x-m4a',
      'video/webm', // certains navigateurs envoient video/webm pour les enregistrements micro
      'video/mp4',
      'video/quicktime',
    ];
    // Accepter aussi si le nom de fichier a une extension audio connue
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    const allowedExts = ['webm', 'mp4', 'm4a', 'mov', 'wav', 'ogg', 'mp3', 'flac'];
    if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non supporté: ${file.mimetype}`));
    }
  },
});

function createSttRouter(options = {}) {
  const router = express.Router();

  // ── GET /api/stt/status ──────────────────────────────────────────────────
  router.get('/stt/status', (_req, res) => {
    try {
      const status = getSttStatus();
      return res.json({ ok: true, ...status });
    } catch (err) {
      logger.error('STT status error', { error: err.message });
      return res.status(500).json({ ok: false, error: 'status_error', message: err.message });
    }
  });

  // ── POST /api/stt/transcribe ─────────────────────────────────────────────
  router.post(
    '/stt/transcribe',
    upload.single('audio'),
    async (req, res) => {
      const startTime = Date.now();

      try {
        // Vérifier qu'un fichier a été envoyé
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
          return res.status(400).json({
            ok: false,
            error: 'missing_audio',
            message: 'Aucun fichier audio fourni. Envoie un champ "audio" en multipart/form-data.',
          });
        }

        const audioBuffer = req.file.buffer;
        const mimeType = req.file.mimetype || 'audio/webm';
        const language = String(req.body?.language || req.query?.language || '').trim() || undefined;
        const provider = String(req.body?.provider || req.query?.provider || '').trim() || undefined;

        logger.info('STT transcription request', {
          mimeType,
          language,
          provider,
          fileSize: audioBuffer.length,
          originalName: req.file.originalname,
        });

        const result = await transcribe(audioBuffer, mimeType, { language, provider });

        const elapsed = Date.now() - startTime;
        logger.info('STT transcription success', {
          provider: result.provider,
          textLength: result.text.length,
          elapsed,
        });

        return res.json({
          ok: true,
          text: result.text,
          language: result.language,
          duration: result.duration,
          provider: result.provider,
          model: result.model,
          elapsed,
        });
      } catch (err) {
        const elapsed = Date.now() - startTime;
        logger.error('STT transcription failed', { error: err.message, elapsed });

        // Erreur de configuration
        if (err.message.includes('provider STT disponible') || err.message.includes('non configuré')) {
          return res.status(503).json({
            ok: false,
            error: 'stt_unavailable',
            message: err.message,
          });
        }

        return res.status(500).json({
          ok: false,
          error: 'transcription_failed',
          message: err.message,
        });
      }
    }
  );

  // ── Gestion erreur multer (fichier trop grand, type invalide) ────────────
  router.use('/stt/transcribe', (err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        ok: false,
        error: 'file_too_large',
        message: 'Fichier audio trop grand (max 25 MB).',
      });
    }
    logger.error('STT upload error', { error: err?.message });
    return res.status(400).json({
      ok: false,
      error: 'upload_error',
      message: err?.message || 'Erreur upload',
    });
  });

  return router;
}

module.exports = createSttRouter;

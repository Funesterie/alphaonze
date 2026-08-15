'use strict';
/**
 * clip-router.cjs — Routes Express pour les clips NOSSEN.
 *
 * Routes :
 *   POST /api/mcp-bridge/clip/start  → lancer un clip (async, retourne jobId)
 *   GET  /api/mcp-bridge/clip/status/:id → statut d'un job
 *   GET  /api/mcp-bridge/clip/list → clips terminés
 *   GET  /api/mcp-bridge/clip/my-jobs → jobs de l'utilisateur
 */
const express = require('express');
const { createJob, updateJob, getJob, listJobs, listPublicClips, CLIPS_DIR } = require('./clip-jobs.cjs');

function createClipRouter({ verifyJWT, isAdmin } = {}) {
  const router = express.Router();

  // Lancer un clip (authentification requise)
  router.post('/start', express.json({ limit: '512kb' }), async (req, res) => {
    const { songUrl, title, style, fullDuration, sections } = req.body;
    if (!songUrl) return res.status(400).json({ ok: false, error: 'songUrl requis' });

    const user = req.user || (req.session && req.session.user) || {};
    const job = createJob({
      songUrl,
      title,
      style,
      fullDuration,
      userId: user.id || user.sub || null,
      email: user.email || null,
    });

    // Lancer la génération en arrière-plan
    setImmediate(() => {
      runClipGeneration(job.id, { songUrl, title, style, fullDuration, sections }).catch(err => {
        console.error('[clip-router] Job', job.id, 'erreur:', err.message);
        updateJob(job.id, { status: 'error', error: err.message });
      });
    });

    res.json({ ok: true, jobId: job.id, status: 'pending' });
  });

  // Statut d'un job
  router.get('/status/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job introuvable' });
    res.json({
      ok: true,
      id: job.id,
      status: job.status,
      progress: job.progress,
      segments: job.segments,
      totalSegments: job.totalSegments,
      title: job.title,
      error: job.error,
      outputUrl: job.outputUrl,
      outputFilename: job.outputFilename,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  });

  // Liste des clips terminés (public)
  router.get('/list', (_req, res) => {
    res.json({ ok: true, clips: listPublicClips() });
  });

  // Mes jobs (authentifié)
  router.get('/my-jobs', (req, res) => {
    const user = req.user || (req.session && req.session.user) || {};
    const jobs = listJobs({
      userId: user.id || user.sub,
      email: user.email,
      limit: 20,
    });
    res.json({ ok: true, jobs });
  });

  return router;
}

/**
 * Exécute la génération d'un clip (appelé en arrière-plan).
 */
async function runClipGeneration(jobId, config) {
  updateJob(jobId, { status: 'generating' });

  try {
    // Charger le générateur V2
    let generateClip;
    try {
      generateClip = require('./clip-generator-v2.cjs').generateClip;
    } catch (_) {
      try {
        generateClip = require('/app/src/clips/clip-generator-v2.cjs').generateClip;
      } catch (_2) {
        generateClip = require('/app/clip-generator-v2.cjs').generateClip;
      }
    }

    // Hook de progression : on écrit dans le job à chaque étape
    const originalConsoleLog = console.log;
    const progressRegex = /\[clip\] Vidéo (\d+) prête \((\d+)\/(\d+)\)/;
    console.log = function(...args) {
      originalConsoleLog.apply(console, args);
      const msg = args.join(' ');
      const match = msg.match(progressRegex);
      if (match) {
        const current = parseInt(match[2], 10);
        const total = parseInt(match[3], 10);
        updateJob(jobId, {
          status: 'generating',
          segments: current,
          totalSegments: total,
          progress: Math.round((current / total) * 90),
        });
      }
    };

    const result = await generateClip(config);

    console.log = originalConsoleLog;

    updateJob(jobId, {
      status: 'done',
      progress: 100,
      outputUrl: result.url || null,
      outputFilename: result.filename || null,
      segments: result.segments || 0,
    });
  } catch (err) {
    console.log = console.log; // restore
    updateJob(jobId, { status: 'error', error: err.message });
    throw err;
  }
}

module.exports = { createClipRouter };

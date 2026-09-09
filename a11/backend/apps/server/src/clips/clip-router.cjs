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
const {
  claimJob,
  createJob,
  createWorkerId,
  getJob,
  heartbeatJob,
  listJobs,
  listPublicClips,
  recordProviderPromptId,
} = require('./clip-jobs.cjs');
const { buildClipErrorInfo } = require('./clip-error-info.cjs');

const CLIP_WORKER_ID = createWorkerId();

function sanitizeJobDiagnostic(value, maxLength = 500) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try {
        const url = new URL(raw.replace(/[),.;]+$/, ''));
        url.search = '';
        url.hash = '';
        return url.toString();
      } catch { return '[url masquée]'; }
    })
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[masqué]')
    .replace(/\b(api[_ -]?key|authorization|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[masqué]')
    .trim()
    .slice(0, maxLength);
}

function createClipRouter({ verifyJWT, isAdmin, generateClipImpl } = {}) {
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
      runClipGeneration(job.id, { songUrl, title, style, fullDuration, sections }, {
        workerId: CLIP_WORKER_ID,
        generateClipImpl,
      }).catch((error) => {
        console.error('[clip-router] Job', job.id, 'erreur:', sanitizeJobDiagnostic(error.message));
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
      stage: job.stage,
      message: job.message || null,
      progress: job.progress,
      segments: job.segments,
      totalSegments: job.totalSegments,
      providerSegments: Array.isArray(job.providerSegments) ? job.providerSegments : [],
      title: job.title,
      error: job.error,
      errorInfo: job.errorInfo || null,
      outputUrl: job.outputUrl,
      outputFilename: job.outputFilename,
      partial: Boolean(job.partial),
      warning: job.warning || null,
      stale: Boolean(job.stale),
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
async function runClipGeneration(jobId, config, {
  workerId = CLIP_WORKER_ID,
  generateClipImpl,
} = {}) {
  const claimed = claimJob(jobId, workerId);
  if (!claimed) return { claimed: false };

  try {
    // Charger le générateur V2
    let generateClip = generateClipImpl;
    if (typeof generateClip !== 'function') {
      try {
        generateClip = require('./clip-generator-v2.cjs').generateClip;
      } catch (_) {
        try {
          generateClip = require('/app/src/clips/clip-generator-v2.cjs').generateClip;
        } catch (_2) {
          generateClip = require('/app/clip-generator-v2.cjs').generateClip;
        }
      }
    }

    // Callback explicite : aucune mutation globale de console, et chaque
    // événement renouvelle le lease du worker qui possède réellement ce job.
    const reportProgress = (event = {}) => {
      const payload = typeof event === 'string' ? { stage: event } : event;
      const stage = sanitizeJobDiagnostic(payload.stage || 'working', 80);
      let status = payload.status;
      if (!['validating', 'directing', 'generating', 'assembling'].includes(status)) {
        if (stage.startsWith('audio:')) status = 'validating';
        else if (stage.startsWith('director:')) status = 'directing';
        else if (stage === 'assembling') status = 'assembling';
        else status = 'generating';
      }
      const updates = { stage, status };
      if (Number.isFinite(Number(payload.progress))) {
        updates.progress = Math.max(0, Math.min(99, Math.round(Number(payload.progress))));
      }
      if (Number.isFinite(Number(payload.segments))) updates.segments = Math.max(0, Math.round(Number(payload.segments)));
      if (Number.isFinite(Number(payload.totalSegments))) {
        updates.totalSegments = Math.max(0, Math.round(Number(payload.totalSegments)));
      }
      if (payload.message) updates.message = sanitizeJobDiagnostic(payload.message);
      const persisted = payload.promptId !== undefined
        ? recordProviderPromptId(jobId, workerId, Number(payload.segmentIndex), payload.promptId, updates)
        : heartbeatJob(jobId, workerId, updates);
      if (!persisted) throw new Error('clip_job_lease_lost');
    };

    const result = await generateClip({ ...config, onProgress: reportProgress });

    const completed = heartbeatJob(jobId, workerId, {
      status: 'done',
      stage: result.partial ? 'complete:partial' : 'complete',
      progress: 100,
      outputUrl: result.url || null,
      outputFilename: result.filename || null,
      segments: result.segments || 0,
      totalSegments: result.requestedSegments || result.segments || 0,
      partial: Boolean(result.partial),
      warning: result.warning ? sanitizeJobDiagnostic(result.warning) : null,
      message: null,
    });
    if (!completed) throw new Error('clip_job_lease_lost');
    return { claimed: true, result };
  } catch (error) {
    const safeError = sanitizeJobDiagnostic(error.message) || 'clip_generation_failed';
    // Champ structuré ADDITIF (rétrocompatible) : le bandeau mobile expose
    // node_type + message lisible. On conserve `error` (chaîne) inchangé.
    const errorInfo = buildClipErrorInfo(safeError, { sanitize: (value) => sanitizeJobDiagnostic(value) });
    heartbeatJob(jobId, workerId, { status: 'error', stage: 'error', error: safeError, errorInfo });
    throw new Error(safeError);
  }
}

module.exports = { CLIP_WORKER_ID, buildClipErrorInfo, createClipRouter, runClipGeneration, sanitizeJobDiagnostic };

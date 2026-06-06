'use strict';

const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const path = require('node:path');
const { getBackendRoot } = require('../../lib/tts-paths.cjs');
const { normalizeEmail } = require('../auth/full-access.cjs');
const {
  analyzeWavBuffer,
  getUserKey,
  isAllowedAudioUpload,
} = require('../tts/voice-reference-store.cjs');

const REQUIRED_CORPUS_MS = Math.max(
  30_000,
  Math.min(30 * 60_000, Number(process.env.A11_VOICE_LEARNING_REQUIRED_MS || 180_000) || 180_000)
);

const DEFAULT_PERSONA_EMAILS = {
  a11: ['cellaurojeffrey@gmail.com'],
  kaen44: ['giovannabrunetto@gmail.com', 'giovannabrunettogiovanna@gmail.com'],
};

const VOICE_LEARNING_CONSENT = 'voice-learning-v1';
const DELETE_CONFIRMATION = 'delete-voice-learning-corpus';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(1, Math.min(80, Number(process.env.A11_VOICE_LEARNING_MAX_MB || 30) || 30)) * 1024 * 1024,
    files: 1,
  },
  fileFilter(_req, file, cb) {
    if (isAllowedAudioUpload(file)) return cb(null, true);
    return cb(new Error(`Type de fichier audio non supporte: ${file.mimetype || 'unknown'}`));
  },
});

function normalizeLooseEmail(value) {
  return normalizeEmail(String(value || '').replace(/\s+/g, ''));
}

function parseConfiguredEmails(value = '') {
  return String(value || '')
    .split(/[,\n;]+/g)
    .map(normalizeLooseEmail)
    .filter(Boolean);
}

function normalizePersona(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'k44' || raw === 'kaen') return 'kaen44';
  if (raw === 'a11' || raw === 'alphaonze' || raw === 'alpha-onze') return 'a11';
  if (raw === 'kaen44') return 'kaen44';
  return '';
}

function getAllowedEmailsForPersona(persona) {
  const key = persona === 'kaen44' ? 'KAEN44' : persona.toUpperCase();
  const configured = parseConfiguredEmails(process.env[`A11_VOICE_LEARNING_${key}_EMAILS`]);
  const defaults = DEFAULT_PERSONA_EMAILS[persona] || [];
  return new Set((configured.length ? configured : defaults).map(normalizeLooseEmail).filter(Boolean));
}

function requireOfficialSourceAccount() {
  const raw = String(process.env.A11_VOICE_LEARNING_SOURCE_ONLY || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveLearningAccess(req, requestedPersona = '') {
  const hasRequestedPersona = String(requestedPersona || '').trim().length > 0;
  const persona = normalizePersona(requestedPersona);
  const email = normalizeLooseEmail(req.user?.email || req.user?.username || '');
  if (!email) return null;
  if (hasRequestedPersona && !persona) return null;

  const candidates = persona ? [persona] : ['a11', 'kaen44'];
  const sourceOnly = requireOfficialSourceAccount();
  for (const candidate of candidates) {
    const allowed = getAllowedEmailsForPersona(candidate);
    const isOfficialSource = allowed.has(email);
    if (isOfficialSource || !sourceOnly) {
      return {
        persona: candidate,
        email,
        ownerKey: getUserKey({ ...req.user, email }),
        isOfficialSource,
        contributorRole: isOfficialSource ? 'official-source' : 'opt-in-user',
      };
    }
  }
  return null;
}

function resolveVoiceLearningRoot() {
  const configured = String(process.env.A11_VOICE_LEARNING_DIR || '').trim();
  if (configured) return path.resolve(configured);

  const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim();
  if (runtimeRoot) return path.resolve(runtimeRoot, 'voice-learning');

  return path.resolve(getBackendRoot(), 'runtime', 'voice-learning');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCorpusDir(access) {
  return ensureDir(path.join(resolveVoiceLearningRoot(), access.persona, access.ownerKey));
}

function getIndexPath(access) {
  return path.join(getCorpusDir(access), 'index.json');
}

function readIndex(access) {
  try {
    const indexPath = getIndexPath(access);
    if (!fs.existsSync(indexPath)) return { clips: [], trainRequests: [] };
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return {
      clips: Array.isArray(parsed?.clips) ? parsed.clips : [],
      trainRequests: Array.isArray(parsed?.trainRequests) ? parsed.trainRequests : [],
    };
  } catch {
    return { clips: [], trainRequests: [] };
  }
}

function writeIndex(access, index) {
  const indexPath = getIndexPath(access);
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({
    clips: Array.isArray(index.clips) ? index.clips : [],
    trainRequests: Array.isArray(index.trainRequests) ? index.trainRequests : [],
  }, null, 2));
  fs.renameSync(tmpPath, indexPath);
}

function inferAudioExtension(file = {}) {
  const ext = path.extname(String(file.originalname || '')).trim().toLowerCase();
  if (['.wav', '.wave', '.mp3', '.ogg', '.webm', '.m4a', '.mp4', '.mov', '.flac'].includes(ext)) {
    return ext === '.wave' ? '.wav' : ext;
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('flac')) return '.flac';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  return '.webm';
}

function clampDurationMs(value) {
  const numeric = Math.round(Number(value || 0));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(250, Math.min(10 * 60_000, numeric));
}

function makeSummary(index) {
  const clips = Array.isArray(index?.clips) ? index.clips : [];
  const knownDurationMs = clips.reduce((total, clip) => total + Math.max(0, Number(clip.durationMs || 0)), 0);
  const totalBytes = clips.reduce((total, clip) => total + Math.max(0, Number(clip.bytes || 0)), 0);
  return {
    clipCount: clips.length,
    secondsCollected: Math.round((knownDurationMs / 1000) * 10) / 10,
    requiredSeconds: Math.round((REQUIRED_CORPUS_MS / 1000) * 10) / 10,
    corpusReady: knownDurationMs >= REQUIRED_CORPUS_MS,
    totalBytes,
    lastClipAt: clips.at(-1)?.createdAt || null,
    queuedTrainingCount: (index.trainRequests || []).filter((job) => job?.state === 'queued').length,
  };
}

function safeTranscriptPreview(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function requireConsent(req) {
  const raw = String(req.body?.consent || req.query?.consent || '').trim().toLowerCase();
  return raw === VOICE_LEARNING_CONSENT || raw === 'true' || raw === '1' || raw === 'yes';
}

function requireDeleteConfirmation(req) {
  const raw = String(req.body?.confirm || req.query?.confirm || '').trim().toLowerCase();
  return raw === DELETE_CONFIRMATION;
}

function createVoiceLearningRouter(options = {}) {
  const router = express.Router();
  const verifyJWT = typeof options.verifyJWT === 'function'
    ? options.verifyJWT
    : (_req, _res, next) => next();

  router.get('/voice-learning/status', verifyJWT, (req, res) => {
    const requestedPersona = normalizePersona(req.query?.persona || req.query?.surface || '');
    const access = resolveLearningAccess(req, requestedPersona);
    if (!access) {
      return res.json({
        ok: true,
        enabled: true,
        canCapture: false,
        persona: requestedPersona || null,
        consentRequired: true,
        consent: VOICE_LEARNING_CONSENT,
        message: 'Connecte-toi puis active la contribution voix pour participer au corpus.',
        requiredSeconds: REQUIRED_CORPUS_MS / 1000,
      });
    }

    const index = readIndex(access);
    const summary = makeSummary(index);
    return res.json({
      ok: true,
      enabled: true,
      canCapture: true,
      persona: access.persona,
      consentRequired: true,
      consent: VOICE_LEARNING_CONSENT,
      isOfficialSource: access.isOfficialSource,
      contributorRole: access.contributorRole,
      ...summary,
      nextAction: summary.corpusReady ? 'train' : 'record',
    });
  });

  router.delete('/voice-learning/corpus', verifyJWT, express.json({ limit: '64kb' }), (req, res) => {
    if (!requireDeleteConfirmation(req)) {
      return res.status(400).json({
        ok: false,
        error: 'missing_delete_confirmation',
        message: 'Confirmation de suppression corpus voix manquante.',
      });
    }
    const access = resolveLearningAccess(req, req.body?.persona || req.query?.persona || '');
    if (!access) {
      return res.status(403).json({
        ok: false,
        error: 'voice_learning_not_allowed',
        message: 'Compte connecte requis pour retirer ce corpus voix.',
      });
    }
    const corpusDir = getCorpusDir(access);
    fs.rmSync(corpusDir, { recursive: true, force: true });
    return res.json({
      ok: true,
      enabled: true,
      canCapture: true,
      deleted: true,
      persona: access.persona,
      consentRequired: true,
      consent: VOICE_LEARNING_CONSENT,
      isOfficialSource: access.isOfficialSource,
      contributorRole: access.contributorRole,
      ...makeSummary({ clips: [], trainRequests: [] }),
      nextAction: 'record',
    });
  });

  router.post('/voice-learning/snippet', verifyJWT, upload.single('audio'), (req, res) => {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Aucun extrait audio fourni.' });
    }
    if (!requireConsent(req)) {
      return res.status(400).json({ ok: false, error: 'missing_consent', message: 'Consentement capture voix manquant.' });
    }

    const access = resolveLearningAccess(req, req.body?.persona || req.body?.surface || '');
    if (!access) {
      return res.status(403).json({
        ok: false,
        error: 'voice_learning_not_allowed',
        message: 'Connecte-toi et active la contribution voix avant de nourrir le corpus.',
      });
    }

    const index = readIndex(access);
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const duplicate = index.clips.find((clip) => clip?.sha256 === hash);
    if (duplicate) {
      return res.json({
        ok: true,
        duplicate: true,
        persona: access.persona,
        isOfficialSource: access.isOfficialSource,
        contributorRole: access.contributorRole,
        clipId: duplicate.id,
        ...makeSummary(index),
      });
    }

    const analysis = analyzeWavBuffer(req.file.buffer);
    const durationMs = analysis.ok
      ? Number(analysis.durationMs || 0)
      : clampDurationMs(req.body?.durationMs);
    const id = `vl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const ext = inferAudioExtension(req.file);
    const filename = `${id}${ext}`;
    const corpusDir = getCorpusDir(access);
    const filePath = path.join(corpusDir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const clip = {
      id,
      persona: access.persona,
      ownerKey: access.ownerKey,
      emailHash: crypto.createHash('sha256').update(access.email).digest('hex').slice(0, 16),
      contributorRole: access.contributorRole,
      isOfficialSource: access.isOfficialSource,
      consent: VOICE_LEARNING_CONSENT,
      filename,
      mimeType: req.file.mimetype || null,
      originalName: req.file.originalname || null,
      bytes: req.file.buffer.length,
      sha256: hash,
      durationMs,
      analysis: analysis.ok ? analysis : { ok: false, reason: analysis.reason || 'analysis_unavailable' },
      source: String(req.body?.source || 'micro').trim().slice(0, 40) || 'micro',
      transcriptPreview: safeTranscriptPreview(req.body?.transcript || ''),
      status: 'collected',
      createdAt: new Date().toISOString(),
    };

    index.clips.push(clip);
    writeIndex(access, index);
    return res.json({
      ok: true,
      duplicate: false,
      persona: access.persona,
      isOfficialSource: access.isOfficialSource,
      contributorRole: access.contributorRole,
      clipId: clip.id,
      durationMs,
      ...makeSummary(index),
    });
  });

  router.use('/voice-learning/snippet', (err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        ok: false,
        error: 'file_too_large',
        message: 'Extrait audio trop grand pour la capture voix.',
      });
    }
    return res.status(400).json({
      ok: false,
      error: 'voice_learning_upload_error',
      message: err?.message || 'Erreur pendant la capture voix.',
    });
  });

  router.post('/voice-learning/train', verifyJWT, express.json({ limit: '128kb' }), (req, res) => {
    if (!requireConsent(req)) {
      return res.status(400).json({ ok: false, error: 'missing_consent', message: 'Consentement entrainement voix manquant.' });
    }
    const access = resolveLearningAccess(req, req.body?.persona || req.query?.persona || '');
    if (!access) {
      return res.status(403).json({
        ok: false,
        error: 'voice_learning_not_allowed',
        message: 'Connecte-toi et active la contribution voix avant de lancer un entrainement.',
      });
    }

    const index = readIndex(access);
    const summary = makeSummary(index);
    if (!summary.corpusReady) {
      return res.status(409).json({
        ok: false,
        error: 'voice_corpus_too_short',
        message: 'Corpus voix encore trop court pour lancer un entrainement propre.',
        ...summary,
      });
    }

    const id = `train_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const trainRequest = {
      id,
      persona: access.persona,
      ownerKey: access.ownerKey,
      state: 'queued',
      clipCount: summary.clipCount,
      secondsCollected: summary.secondsCollected,
      createdAt: new Date().toISOString(),
      engine: 'rvc',
      source: 'voice-learning',
      contributorRole: access.contributorRole,
      isOfficialSource: access.isOfficialSource,
    };
    index.trainRequests.push(trainRequest);
    writeIndex(access, index);
    return res.json({
      ok: true,
      persona: access.persona,
      training: trainRequest,
      ...makeSummary(index),
      message: 'Demande entrainement RVC preparee pour le worker voix.',
    });
  });

  return router;
}

module.exports = createVoiceLearningRouter;

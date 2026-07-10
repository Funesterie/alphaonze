'use strict';

const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const path = require('node:path');
const {
  getCanonicalRuntimeRoot,
  getRuntimeRootCandidates,
} = require('../../lib/runtime-root.cjs');
const { hasFullAccess, normalizeEmail } = require('../auth/full-access.cjs');
const {
  TIERS,
  resolveMcpAccountProfileSync,
} = require('../auth/mcp-account-tier.cjs');
const {
  PERSONAL_VOICE_POLICY,
  getFamilyVoiceIdentitiesForPersona,
  getFamilyVoiceIdentityByEmail,
  getFamilyVoiceIdentityByKey,
  getOfficialVoiceSourceEmailsForPersona,
} = require('../config/family-accounts.cjs');
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
  a11: ['bayetgerard@gmail.com'],
  djeff: ['cellaurojeffrey@gmail.com'],
  marvin: ['marvincellauro@gmail.com', 'cellauromarvin@gmail.com'],
  kaen44: ['giovannabrunetto@gmail.com', 'giovannabrunettogiovanna@gmail.com'],
  vivy: ['jewitt.charlene@gmail.com', 'charlenejewitt@gmail.com'],
};

const VOICE_LEARNING_CONSENT = 'voice-learning-v1';
const DELETE_CONFIRMATION = 'delete-voice-learning-corpus';
const SUNO_VOICE_SLOT_CONSENT = 'suno-voice-slot-v1';
const SUNO_VOICE_DELETE_CONFIRMATION = 'delete-suno-voice-slot';

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
  if (raw === 'djeff' || raw === 'djeff-rap' || raw === 'pignon') return 'djeff';
  if (raw === 'marvin' || raw === 'frere' || raw === 'frère' || raw === 'brother') return 'marvin';
  if (raw === 'vivy' || raw === 'vivi') return 'vivy';
  if (raw === 'personal' || raw === 'personal-voice' || raw === 'my-voice' || raw === 'myvoice' || raw === 'ma-voix' || raw === 'ma_voix') return 'personal';
  if (raw === 'a11' || raw === 'alphaonze' || raw === 'alpha-onze') return 'a11';
  if (raw === 'kaen44') return 'kaen44';
  return '';
}

function normalizeSunoVoiceId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length < 8 || raw.length > 180) return '';
  if (!/^[a-zA-Z0-9:_-]+$/.test(raw)) return '';
  return raw;
}

function maskSunoVoiceId(value = '') {
  const raw = normalizeSunoVoiceId(value);
  if (!raw) return '';
  if (raw.length <= 12) return `${raw.slice(0, 3)}…${raw.slice(-3)}`;
  return `${raw.slice(0, 6)}…${raw.slice(-6)}`;
}

function hashSunoVoiceId(value = '') {
  const raw = normalizeSunoVoiceId(value);
  return raw ? crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) : '';
}

function normalizeSunoVoiceLabel(value = '') {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeStoredSunoVoice(value = null) {
  const voiceId = normalizeSunoVoiceId(value?.voiceId || value?.id || '');
  if (!voiceId) return null;
  const updatedAt = String(value?.updatedAt || value?.linkedAt || value?.createdAt || '').trim();
  return {
    provider: 'suno',
    voiceId,
    idHash: hashSunoVoiceId(voiceId),
    idMask: maskSunoVoiceId(voiceId),
    label: normalizeSunoVoiceLabel(value?.label || value?.name || '') || 'Voix Suno personnelle',
    consent: String(value?.consent || SUNO_VOICE_SLOT_CONSENT).trim(),
    linkedAt: String(value?.linkedAt || updatedAt || new Date().toISOString()).trim(),
    updatedAt: updatedAt || new Date().toISOString(),
    source: String(value?.source || 'vivy-studio').trim().slice(0, 60) || 'vivy-studio',
  };
}

function describeSunoVoiceSlot(slot = null) {
  const normalized = normalizeStoredSunoVoice(slot);
  if (!normalized) {
    return {
      sunoVoiceLinked: false,
      sunoVoiceProvider: 'suno',
    };
  }
  return {
    sunoVoiceLinked: true,
    sunoVoiceProvider: 'suno',
    sunoVoiceIdHash: normalized.idHash,
    sunoVoiceIdMask: normalized.idMask,
    sunoVoiceLabel: normalized.label,
    sunoVoiceUpdatedAt: normalized.updatedAt,
  };
}

function getAllowedEmailsForPersona(persona) {
  const key = persona === 'kaen44' ? 'KAEN44' : persona.toUpperCase();
  const configured = parseConfiguredEmails(process.env[`A11_VOICE_LEARNING_${key}_EMAILS`]);
  const mapped = getOfficialVoiceSourceEmailsForPersona(persona);
  const defaults = mapped.length ? mapped : (DEFAULT_PERSONA_EMAILS[persona] || []);
  return new Set((configured.length ? configured : defaults).map(normalizeLooseEmail).filter(Boolean));
}

function requireOfficialSourceAccount() {
  const raw = String(process.env.A11_VOICE_LEARNING_SOURCE_ONLY || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  const allowOptIn = String(process.env.A11_VOICE_LEARNING_ALLOW_OPT_IN_CONTRIBUTORS || '').trim().toLowerCase();
  if (allowOptIn === '1' || allowOptIn === 'true' || allowOptIn === 'yes' || allowOptIn === 'on') return false;
  return true;
}

function canUsePersonalVoice(user = {}) {
  const profile = resolveMcpAccountProfileSync(user, { env: process.env });
  return profile.tier === TIERS.PREMIUM
    || profile.tier === TIERS.FOUNDER
    || profile.tier === TIERS.ADMIN_FAMILY;
}

function buildPersonalVoiceAccess(req, email) {
  if (!canUsePersonalVoice({ ...req.user, email })) return null;
  const ownerIdentity = getFamilyVoiceIdentityByEmail(email);
  return {
    persona: 'personal',
    email,
    ownerKey: getUserKey({ ...req.user, email }),
    isOfficialSource: false,
    contributorRole: 'personal-owner',
    voiceIdentityKey: ownerIdentity?.key || 'personal',
    voiceIdentityLabel: ownerIdentity?.label || PERSONAL_VOICE_POLICY.label,
    voiceStyle: ownerIdentity?.voiceStyle || 'personal-account-voice',
    minimumTier: PERSONAL_VOICE_POLICY.minimumTier,
  };
}

function buildOfficialVoiceAccess(req, email, candidate, isOfficialSource) {
  const identities = getFamilyVoiceIdentitiesForPersona(candidate);
  const emailIdentity = getFamilyVoiceIdentityByEmail(email);
  const identity = identities.find((item) => normalizeLooseEmail(item.accountEmail) === email)
    || (emailIdentity?.persona === candidate ? emailIdentity : null)
    || identities[0]
    || getFamilyVoiceIdentityByKey(candidate);
  const curator = !isOfficialSource && hasFullAccess({ ...req.user, email }, process.env);
  return {
    persona: candidate,
    email,
    ownerKey: getUserKey({ ...req.user, email }),
    isOfficialSource,
    contributorRole: isOfficialSource ? 'official-source' : (curator ? 'family-admin-curator' : 'opt-in-user'),
    voiceIdentityKey: identity?.key || candidate,
    voiceIdentityLabel: identity?.label || candidate,
    voiceStyle: identity?.voiceStyle || `${candidate}-voice`,
  };
}

function resolveLearningAccess(req, requestedPersona = '') {
  const hasRequestedPersona = String(requestedPersona || '').trim().length > 0;
  const persona = normalizePersona(requestedPersona);
  const email = normalizeLooseEmail(req.user?.email || req.user?.username || '');
  if (!email) return null;
  if (hasRequestedPersona && !persona) return null;
  if (persona === 'personal') return buildPersonalVoiceAccess(req, email);

  const candidates = persona ? [persona] : ['a11', 'kaen44', 'vivy', 'djeff', 'marvin'];
  const sourceOnly = requireOfficialSourceAccount();
  for (const candidate of candidates) {
    const allowed = getAllowedEmailsForPersona(candidate);
    const isOfficialSource = allowed.has(email);
    const isFamilyAdminCurator = hasFullAccess({ ...req.user, email }, process.env);
    if (isOfficialSource || isFamilyAdminCurator || !sourceOnly) {
      return buildOfficialVoiceAccess(req, email, candidate, isOfficialSource);
    }
  }
  return null;
}

function resolveVoiceLearningRoot() {
  const configured = String(process.env.A11_VOICE_LEARNING_DIR || '').trim();
  if (configured) return path.resolve(configured);

  return path.join(getCanonicalRuntimeRoot(process.env), 'voice-learning');
}

function resolveVoiceLearningRootCandidates() {
  const configured = String(process.env.A11_VOICE_LEARNING_DIR || '').trim();
  if (configured) return [path.resolve(configured)];
  return getRuntimeRootCandidates(process.env)
    .map((runtimeRoot) => path.join(runtimeRoot, 'voice-learning'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCorpusDir(access, { root = resolveVoiceLearningRoot(), ensure = true } = {}) {
  const dir = path.join(root, access.persona, access.ownerKey);
  return ensure ? ensureDir(dir) : dir;
}

function getCorpusDirs(access, { ensure = false } = {}) {
  return resolveVoiceLearningRootCandidates()
    .map((root) => getCorpusDir(access, { root, ensure }));
}

function getIndexPath(access, options = {}) {
  return path.join(getCorpusDir(access, options), 'index.json');
}

function withRuntimeCorpusDir(clip, corpusDir) {
  return {
    ...clip,
    __runtimeCorpusDir: corpusDir,
  };
}

function stripRuntimeFields(clip = {}) {
  const { __runtimeCorpusDir, ...clean } = clip || {};
  return clean;
}

function readIndexFile(indexPath, corpusDir) {
  try {
    if (!fs.existsSync(indexPath)) return { clips: [], trainRequests: [], sunoVoice: null };
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return {
      clips: Array.isArray(parsed?.clips)
        ? parsed.clips.map((clip) => withRuntimeCorpusDir(clip, corpusDir))
        : [],
      trainRequests: Array.isArray(parsed?.trainRequests) ? parsed.trainRequests : [],
      sunoVoice: normalizeStoredSunoVoice(parsed?.sunoVoice),
    };
  } catch {
    return { clips: [], trainRequests: [], sunoVoice: null };
  }
}

function clipMergeKey(clip = {}) {
  return String(clip.sha256 || clip.id || clip.filename || '').trim();
}

function trainMergeKey(job = {}) {
  return String(job.id || `${job.createdAt || ''}:${job.state || ''}`).trim();
}

function mergeIndexes(indexes = []) {
  const clips = [];
  const clipKeys = new Set();
  const trainRequests = [];
  const trainKeys = new Set();
  let sunoVoice = null;

  for (const index of indexes) {
    for (const clip of (index?.clips || [])) {
      const key = clipMergeKey(clip);
      if (key && clipKeys.has(key)) continue;
      if (key) clipKeys.add(key);
      clips.push(clip);
    }
    for (const job of (index?.trainRequests || [])) {
      const key = trainMergeKey(job);
      if (key && trainKeys.has(key)) continue;
      if (key) trainKeys.add(key);
      trainRequests.push(job);
    }
    const candidateSunoVoice = normalizeStoredSunoVoice(index?.sunoVoice);
    if (candidateSunoVoice) {
      const currentTime = Date.parse(sunoVoice?.updatedAt || sunoVoice?.linkedAt || '') || 0;
      const candidateTime = Date.parse(candidateSunoVoice.updatedAt || candidateSunoVoice.linkedAt || '') || 0;
      if (!sunoVoice || candidateTime >= currentTime) sunoVoice = candidateSunoVoice;
    }
  }

  clips.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  trainRequests.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return { clips, trainRequests, sunoVoice };
}

function readIndex(access) {
  const indexes = getCorpusDirs(access, { ensure: false })
    .map((corpusDir) => readIndexFile(path.join(corpusDir, 'index.json'), corpusDir));
  return mergeIndexes(indexes);
}

function syncLegacyClipToCanonical(access, clip = {}, canonicalDir) {
  const legacyDir = String(clip.__runtimeCorpusDir || '').trim();
  const filename = String(clip.filename || '').trim();
  if (!legacyDir || !filename || path.resolve(legacyDir) === path.resolve(canonicalDir)) return;
  const sourcePath = path.join(legacyDir, filename);
  const targetPath = path.join(canonicalDir, filename);
  try {
    if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  } catch {
    // The metadata still contributes to status; unavailable legacy files can be cleaned later.
  }
}

function writeIndex(access, index) {
  const canonicalDir = getCorpusDir(access);
  for (const clip of (index?.clips || [])) {
    syncLegacyClipToCanonical(access, clip, canonicalDir);
  }
  const indexPath = path.join(canonicalDir, 'index.json');
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({
    clips: Array.isArray(index.clips) ? index.clips.map(stripRuntimeFields) : [],
    trainRequests: Array.isArray(index.trainRequests) ? index.trainRequests : [],
    sunoVoice: normalizeStoredSunoVoice(index.sunoVoice),
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

function requireSunoVoiceSlotConsent(req) {
  const raw = String(req.body?.consent || req.query?.consent || '').trim().toLowerCase();
  return raw === SUNO_VOICE_SLOT_CONSENT
    || raw === VOICE_LEARNING_CONSENT
    || raw === 'true'
    || raw === '1'
    || raw === 'yes';
}

function requireDeleteConfirmation(req) {
  const raw = String(req.body?.confirm || req.query?.confirm || '').trim().toLowerCase();
  return raw === DELETE_CONFIRMATION;
}

function requireSunoVoiceDeleteConfirmation(req) {
  const raw = String(req.body?.confirm || req.query?.confirm || '').trim().toLowerCase();
  return raw === SUNO_VOICE_DELETE_CONFIRMATION;
}

function buildPersonalSunoVoiceSlot(access, req) {
  const voiceId = normalizeSunoVoiceId(req.body?.voiceId || req.body?.sunoVoiceId || req.body?.id || '');
  if (!voiceId) return null;
  const now = new Date().toISOString();
  return normalizeStoredSunoVoice({
    provider: 'suno',
    voiceId,
    label: normalizeSunoVoiceLabel(req.body?.label || req.body?.name || access.voiceIdentityLabel || ''),
    consent: SUNO_VOICE_SLOT_CONSENT,
    linkedAt: now,
    updatedAt: now,
    source: String(req.body?.source || 'vivy-studio').trim().slice(0, 60) || 'vivy-studio',
  });
}

function resolvePersonalSunoVoiceForRequest(req = null) {
  if (!req) return null;
  const access = resolveLearningAccess(req, 'personal');
  if (!access) return null;
  const slot = normalizeStoredSunoVoice(readIndex(access).sunoVoice);
  if (!slot) return null;
  return {
    provider: 'suno',
    voiceId: slot.voiceId,
    label: slot.label,
    idHash: slot.idHash,
    idMask: slot.idMask,
    updatedAt: slot.updatedAt,
    persona: access.persona,
    contributorRole: access.contributorRole,
    voiceIdentityKey: access.voiceIdentityKey,
    voiceIdentityLabel: access.voiceIdentityLabel,
  };
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
        minimumTier: requestedPersona === 'personal' ? PERSONAL_VOICE_POLICY.minimumTier : undefined,
        ...describeSunoVoiceSlot(null),
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
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
      minimumTier: access.minimumTier,
      ...describeSunoVoiceSlot(access.persona === 'personal' ? index.sunoVoice : null),
      ...summary,
      nextAction: summary.corpusReady ? 'train' : 'record',
    });
  });

  router.post('/voice-learning/suno-voice', verifyJWT, express.json({ limit: '64kb' }), (req, res) => {
    if (!requireSunoVoiceSlotConsent(req)) {
      return res.status(400).json({
        ok: false,
        error: 'missing_suno_voice_consent',
        message: 'Consentement liaison voix Suno manquant.',
        consent: SUNO_VOICE_SLOT_CONSENT,
      });
    }
    const access = resolveLearningAccess(req, 'personal');
    if (!access) {
      return res.status(403).json({
        ok: false,
        error: 'personal_suno_voice_not_allowed',
        minimumTier: PERSONAL_VOICE_POLICY.minimumTier,
        message: 'Compte Premium, Fondateur ou Famille requis pour lier une voix Suno personnelle.',
      });
    }
    const slot = buildPersonalSunoVoiceSlot(access, req);
    if (!slot) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_suno_voice_id',
        message: 'ID voix Suno invalide. Colle l’identifiant brut fourni par Suno.',
      });
    }
    const index = readIndex(access);
    index.sunoVoice = slot;
    writeIndex(access, index);
    return res.json({
      ok: true,
      enabled: true,
      canCapture: true,
      persona: access.persona,
      consentRequired: true,
      consent: SUNO_VOICE_SLOT_CONSENT,
      contributorRole: access.contributorRole,
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
      minimumTier: access.minimumTier,
      ...describeSunoVoiceSlot(slot),
      ...makeSummary(index),
      nextAction: 'use-suno-voice',
      message: 'Voix Suno personnelle liée à ce compte.',
    });
  });

  router.delete('/voice-learning/suno-voice', verifyJWT, express.json({ limit: '64kb' }), (req, res) => {
    if (!requireSunoVoiceDeleteConfirmation(req)) {
      return res.status(400).json({
        ok: false,
        error: 'missing_suno_voice_delete_confirmation',
        message: 'Confirmation de suppression voix Suno manquante.',
      });
    }
    const access = resolveLearningAccess(req, 'personal');
    if (!access) {
      return res.status(403).json({
        ok: false,
        error: 'personal_suno_voice_not_allowed',
        minimumTier: PERSONAL_VOICE_POLICY.minimumTier,
        message: 'Compte Premium, Fondateur ou Famille requis pour retirer une voix Suno personnelle.',
      });
    }
    const index = readIndex(access);
    index.sunoVoice = null;
    writeIndex(access, index);
    return res.json({
      ok: true,
      enabled: true,
      canCapture: true,
      persona: access.persona,
      consentRequired: true,
      consent: SUNO_VOICE_SLOT_CONSENT,
      contributorRole: access.contributorRole,
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
      minimumTier: access.minimumTier,
      ...describeSunoVoiceSlot(null),
      ...makeSummary(index),
      nextAction: 'record',
      message: 'Voix Suno personnelle retirée de ce compte.',
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
    const previousIndex = readIndex(access);
    for (const corpusDir of getCorpusDirs(access, { ensure: false })) {
      fs.rmSync(corpusDir, { recursive: true, force: true });
    }
    const nextIndex = {
      clips: [],
      trainRequests: [],
      sunoVoice: previousIndex.sunoVoice || null,
    };
    if (nextIndex.sunoVoice) writeIndex(access, nextIndex);
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
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
      minimumTier: access.minimumTier,
      ...describeSunoVoiceSlot(nextIndex.sunoVoice),
      ...makeSummary(nextIndex),
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
        voiceIdentityKey: access.voiceIdentityKey,
        voiceIdentityLabel: access.voiceIdentityLabel,
        voiceStyle: access.voiceStyle,
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
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
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
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
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
      voiceIdentityKey: access.voiceIdentityKey,
      voiceIdentityLabel: access.voiceIdentityLabel,
      voiceStyle: access.voiceStyle,
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
module.exports.resolvePersonalSunoVoiceForRequest = resolvePersonalSunoVoiceForRequest;
module.exports.normalizeSunoVoiceId = normalizeSunoVoiceId;
module.exports.describeSunoVoiceSlot = describeSunoVoiceSlot;

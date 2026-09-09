'use strict';
/**
 * clip-jobs.cjs — Gestion persistante des jobs de clips NOSSEN.
 *
 * Le fichier est partagé par les couleurs blue/green. Les lectures sont donc
 * toujours rafraîchies depuis le volume, les écritures read-modify-write sont
 * sérialisées par un verrou court, et un lease désigne explicitement le worker
 * propriétaire d'un job actif.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CLIPS_DIR } = require('./clip-storage.cjs');

const JOBS_FILE = path.join(CLIPS_DIR, 'jobs.json');
const JOBS_LOCK_FILE = path.join(CLIPS_DIR, 'jobs.json.lock');
const ACTIVE_STATUSES = new Set(['pending', 'validating', 'directing', 'generating', 'assembling']);
const TERMINAL_STATUSES = new Set(['done', 'error']);
const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const DEFAULT_PENDING_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

let _jobs = [];

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function ensureDir() {
  if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

function readJobsFile() {
  ensureDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('clip_jobs_store_invalid');
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    if (error?.message === 'clip_jobs_store_invalid') throw error;
    throw new Error('clip_jobs_store_invalid');
  }
}

function loadJobs() {
  // Ne jamais faire confiance à un cache de processus : une autre couleur peut
  // avoir fait progresser le job depuis la requête HTTP précédente.
  _jobs = readJobsFile();
  return _jobs;
}

function writeJobsFile(jobs) {
  ensureDir();
  const tmp = `${JOBS_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, JOBS_FILE);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

function acquireJobsLock() {
  ensureDir();
  const token = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}:${Date.now()}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() <= deadline) {
    try {
      const fd = fs.openSync(JOBS_LOCK_FILE, 'wx', 0o600);
      fs.writeFileSync(fd, token, 'utf8');
      return { fd, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stats = fs.statSync(JOBS_LOCK_FILE);
        if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) fs.unlinkSync(JOBS_LOCK_FILE);
      } catch (inspectError) {
        if (!['ENOENT', 'EPERM', 'EACCES'].includes(inspectError?.code)) throw inspectError;
      }
      Atomics.wait(waitBuffer, 0, 0, 10);
    }
  }
  throw new Error('clip_jobs_store_busy');
}

function releaseJobsLock(lock) {
  try { fs.closeSync(lock.fd); } catch {}
  try {
    if (fs.readFileSync(JOBS_LOCK_FILE, 'utf8') === lock.token) fs.unlinkSync(JOBS_LOCK_FILE);
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[clip-jobs] verrou non libéré:', error.message);
  }
}

function mutateJobs(mutator) {
  const lock = acquireJobsLock();
  try {
    const jobs = readJobsFile();
    const result = mutator(jobs);
    _jobs = jobs.slice(-200);
    writeJobsFile(_jobs);
    return result;
  } finally {
    releaseJobsLock(lock);
  }
}

function createWorkerId() {
  return `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
}

function createJob({ songUrl, title, style, fullDuration, userId, email }) {
  return mutateJobs((jobs) => {
    const now = new Date().toISOString();
    const id = `clip-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const job = {
      id,
      status: 'pending',
      stage: 'pending',
      progress: 0,
      songUrl,
      title: title || 'Sans titre',
      style: style || '',
      fullDuration: Boolean(fullDuration),
      userId: userId || null,
      email: email || null,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: null,
      leaseUntil: null,
      workerId: null,
      segments: 0,
      totalSegments: 0,
      error: null,
      warning: null,
      partial: false,
      providerSegments: [],
      outputUrl: null,
      outputFilename: null,
    };
    jobs.push(job);
    return { ...job };
  });
}

function claimJob(id, workerId, {
  leaseMs = parseBoundedInteger(process.env.NOSSEN_CLIP_JOB_LEASE_MS, DEFAULT_LEASE_MS, 60_000, 60 * 60 * 1000),
} = {}) {
  if (!workerId) throw new Error('clip_worker_id_required');
  return mutateJobs((jobs) => {
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job || TERMINAL_STATUSES.has(job.status)) return null;
    const nowMs = Date.now();
    const leaseActive = job.workerId && job.workerId !== workerId
      && Number.isFinite(Date.parse(job.leaseUntil)) && Date.parse(job.leaseUntil) > nowMs;
    if (leaseActive) return null;
    const now = new Date(nowMs).toISOString();
    Object.assign(job, {
      workerId,
      heartbeatAt: now,
      leaseUntil: new Date(nowMs + leaseMs).toISOString(),
      status: job.status === 'pending' ? 'validating' : job.status,
      stage: job.status === 'pending' ? 'audio:validating' : job.stage,
      progress: Math.max(1, Number(job.progress) || 0),
      updatedAt: now,
      error: null,
    });
    return { ...job };
  });
}

function updateJob(id, updates = {}, {
  workerId,
  leaseMs = parseBoundedInteger(process.env.NOSSEN_CLIP_JOB_LEASE_MS, DEFAULT_LEASE_MS, 60_000, 60 * 60 * 1000),
} = {}) {
  return mutateJobs((jobs) => {
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job) return null;
    if (workerId && job.workerId && job.workerId !== workerId) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    Object.assign(job, updates, { updatedAt: now });
    if (workerId) {
      job.workerId = workerId;
      job.heartbeatAt = now;
      job.leaseUntil = TERMINAL_STATUSES.has(job.status) ? null : new Date(nowMs + leaseMs).toISOString();
    } else if (TERMINAL_STATUSES.has(job.status)) {
      job.leaseUntil = null;
    }
    return { ...job };
  });
}

function heartbeatJob(id, workerId, updates = {}, options = {}) {
  return updateJob(id, updates, { ...options, workerId });
}

function recordProviderPromptId(id, workerId, segmentIndex, promptId, updates = {}, {
  leaseMs = parseBoundedInteger(process.env.NOSSEN_CLIP_JOB_LEASE_MS, DEFAULT_LEASE_MS, 60_000, 60 * 60 * 1000),
} = {}) {
  const normalizedPromptId = String(promptId || '').trim();
  const normalizedIndex = Number(segmentIndex);
  if (!workerId || !/^[a-z0-9_-]{8,128}$/i.test(normalizedPromptId) || !Number.isInteger(normalizedIndex) || normalizedIndex < 0) {
    throw new Error('clip_provider_prompt_metadata_invalid');
  }
  return mutateJobs((jobs) => {
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job || (job.workerId && job.workerId !== workerId)) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const segments = Array.isArray(job.providerSegments) ? job.providerSegments : [];
    const existing = segments.find((segment) => segment.index === normalizedIndex);
    const metadata = { index: normalizedIndex, promptId: normalizedPromptId, acceptedAt: existing?.acceptedAt || now };
    if (existing) Object.assign(existing, metadata);
    else segments.push(metadata);
    segments.sort((left, right) => left.index - right.index);
    Object.assign(job, updates, {
      providerSegments: segments,
      workerId,
      heartbeatAt: now,
      leaseUntil: new Date(nowMs + leaseMs).toISOString(),
      updatedAt: now,
    });
    return { ...job, providerSegments: segments.map((segment) => ({ ...segment })) };
  });
}

function deriveSafeJobState(job, nowMs = Date.now()) {
  if (!job || TERMINAL_STATUSES.has(job.status) || !ACTIVE_STATUSES.has(job.status)) return job ? { ...job } : null;
  const leaseExpiry = Date.parse(job.leaseUntil);
  const createdAt = Date.parse(job.createdAt);
  const workerLeaseExpired = job.workerId && Number.isFinite(leaseExpiry) && leaseExpiry <= nowMs;
  const pendingLimit = parseBoundedInteger(
    process.env.NOSSEN_CLIP_PENDING_STALE_MS,
    DEFAULT_PENDING_STALE_MS,
    60_000,
    24 * 60 * 60 * 1000,
  );
  const unclaimedPendingExpired = !job.workerId && job.status === 'pending'
    && Number.isFinite(createdAt) && createdAt + pendingLimit <= nowMs;
  if (!workerLeaseExpired && !unclaimedPendingExpired) return { ...job };
  return {
    ...job,
    status: 'error',
    stage: 'interrupted',
    progress: Number(job.progress) || 0,
    error: 'clip_worker_interrupted',
    stale: true,
  };
}

function getJob(id, { raw = false } = {}) {
  const job = loadJobs().find((candidate) => candidate.id === id) || null;
  return raw ? (job ? { ...job } : null) : deriveSafeJobState(job);
}

function listJobs({ userId, email, limit = 20, raw = false } = {}) {
  const jobs = loadJobs();
  let filtered = jobs;
  if (userId || email) {
    filtered = jobs.filter((job) =>
      (userId && job.userId === userId)
      || (email && job.email && job.email.toLowerCase() === String(email).toLowerCase())
    );
  }
  return filtered.slice(-limit).reverse().map((job) => raw ? { ...job } : deriveSafeJobState(job));
}

function listPublicClips() {
  ensureDir();
  try {
    return fs.readdirSync(CLIPS_DIR)
      .filter((filename) => filename.endsWith('.mp4') && !filename.startsWith('clip-'))
      .map((filename) => {
        const stat = fs.statSync(path.join(CLIPS_DIR, filename));
        return {
          name: filename.replace(/\.mp4$/, ''),
          filename,
          url: '/clips/' + encodeURIComponent(filename),
          size: stat.size,
          created: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
  } catch (_) {
    return [];
  }
}

module.exports = {
  ACTIVE_STATUSES,
  CLIPS_DIR,
  DEFAULT_LEASE_MS,
  JOBS_FILE,
  claimJob,
  createJob,
  createWorkerId,
  deriveSafeJobState,
  getJob,
  heartbeatJob,
  listJobs,
  listPublicClips,
  loadJobs,
  recordProviderPromptId,
  updateJob,
};

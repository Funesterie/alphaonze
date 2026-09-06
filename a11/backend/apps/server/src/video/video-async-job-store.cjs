'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const JOB_ID_PATTERN = /^vjob_[a-zA-Z0-9_-]{8,160}$/;
const ACTIVE_STATUSES = new Set(['pending', 'running']);
const PROCESS_WORKER_ID = `${process.env.A11_RELEASE_ID || process.env.A11_BUILD_ID || 'a11'}:${process.pid}:${Math.random().toString(16).slice(2, 10)}`;

function resolveVideoJobStoreDir(env = process.env) {
  const runtimeRoot = path.resolve(env.A11_RUNTIME_ROOT || path.join(process.cwd(), 'runtime'));
  return path.resolve(env.A11_VIDEO_JOB_STORE_DIR || path.join(runtimeRoot, 'state', 'video-jobs'));
}

function sanitizePersistentValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.slice(0, 32_000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 8) return '[depth-limited]';
  if (typeof value !== 'object') return String(value).slice(0, 1_000);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizePersistentValue(item, depth + 1, seen));
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 300)) {
    if (/(?:authorization|cookie|token|secret|password|api[_-]?key|session)/i.test(key)) continue;
    output[key] = sanitizePersistentValue(item, depth + 1, seen);
  }
  return output;
}

function normalizePersistentJob(job = {}) {
  const id = String(job.id || '').trim();
  if (!JOB_ID_PATTERN.test(id)) throw new Error('video_job_id_invalid');
  return {
    version: STORE_VERSION,
    id,
    owner: String(job.owner || '').slice(0, 500),
    workerId: String(job.workerId || '').slice(0, 300),
    status: String(job.status || 'pending').slice(0, 40),
    createdAt: Number(job.createdAt || Date.now()),
    updatedAt: Number(job.updatedAt || job.createdAt || Date.now()),
    heartbeatAt: Number(job.heartbeatAt || job.updatedAt || job.createdAt || Date.now()),
    completedAt: Number(job.completedAt || 0) || null,
    pollIntervalMs: Number(job.pollIntervalMs || 0) || null,
    maxPollAttempts: Number(job.maxPollAttempts || 0) || null,
    maxWaitMs: Number(job.maxWaitMs || 0) || null,
    error: job.error ? String(job.error).slice(0, 2_000) : null,
    message: job.message ? String(job.message).slice(0, 2_000) : null,
    recovery: job.recovery ? sanitizePersistentValue(job.recovery) : null,
    result: job.result ? sanitizePersistentValue(job.result) : null,
  };
}

function createVideoAsyncJobStore({
  dir = resolveVideoJobStoreDir(),
  ttlMs = 2_700_000,
  orphanAfterMs = 90_000,
  now = () => Date.now(),
  workerId = PROCESS_WORKER_ID,
} = {}) {
  const storeDir = path.resolve(dir);
  const jobPath = (jobId) => {
    const id = String(jobId || '').trim();
    if (!JOB_ID_PATTERN.test(id)) return '';
    return path.join(storeDir, `${id}.json`);
  };

  function persist(job) {
    const normalized = normalizePersistentJob({ ...job, workerId: job?.workerId || workerId });
    fs.mkdirSync(storeDir, { recursive: true });
    const target = jobPath(normalized.id);
    const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    const payload = `${JSON.stringify(normalized)}\n`;
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new Error('video_job_state_too_large');
    fs.writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      fs.renameSync(temporary, target);
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch {}
    }
    return normalized;
  }

  function get(jobId) {
    const target = jobPath(jobId);
    if (!target) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (String(parsed?.id || '') !== String(jobId || '')) return null;
      return normalizePersistentJob(parsed);
    } catch {
      return null;
    }
  }

  function remove(jobId) {
    const target = jobPath(jobId);
    if (!target) return false;
    try {
      fs.rmSync(target, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  function loadAll({ markInterrupted = true } = {}) {
    let names = [];
    try { names = fs.readdirSync(storeDir); } catch { return []; }
    const jobs = [];
    for (const name of names) {
      if (!/^vjob_[a-zA-Z0-9_-]{8,160}\.json$/.test(name)) continue;
      const job = get(name.slice(0, -5));
      if (!job) continue;
      const age = now() - Number(job.updatedAt || job.createdAt || 0);
      if (!Number.isFinite(age) || age > ttlMs) {
        remove(job.id);
        continue;
      }
      const heartbeatAge = now() - Number(job.heartbeatAt || job.updatedAt || job.createdAt || 0);
      if (
        markInterrupted
        && ACTIVE_STATUSES.has(job.status)
        && job.workerId !== workerId
        && heartbeatAge > orphanAfterMs
      ) {
        const interrupted = {
          ...job,
          status: 'error',
          error: 'video_job_interrupted_by_restart',
          message: 'Le worker ne donne plus de signe de vie. Verifie le fournisseur avant toute relance pour eviter un rendu ou un debit en double.',
          recovery: { resumable: false, reason: 'process_restart', previousStatus: job.status },
          updatedAt: now(),
          completedAt: now(),
        };
        jobs.push(persist(interrupted));
      } else {
        jobs.push(job);
      }
    }
    return jobs;
  }

  function cleanup() {
    return loadAll({ markInterrupted: true });
  }

  return {
    dir: storeDir,
    workerId,
    cleanup,
    get,
    loadAll,
    persist,
    remove,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  createVideoAsyncJobStore,
  normalizePersistentJob,
  resolveVideoJobStoreDir,
  sanitizePersistentValue,
};

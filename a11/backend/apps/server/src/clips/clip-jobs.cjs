'use strict';
/**
 * clip-jobs.cjs — Gestion persistante des jobs de clips NOSSEN.
 *
 * Les jobs sont persistés dans <CLIPS_DIR>/jobs.json pour survivre
 * aux restarts du container. Chaque job a un statut (pending, generating,
 * assembling, done, error) et un pourcentage de progression.
 */
const fs = require('fs');
const path = require('path');

const { CLIPS_DIR } = require('./clips-config.cjs');
const JOBS_FILE = path.join(CLIPS_DIR, 'jobs.json');

// Cache mémoire synchronisé au fichier
let _jobs = null;

function ensureDir() {
  if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

function loadJobs() {
  if (_jobs) return _jobs;
  ensureDir();
  try {
    const raw = fs.readFileSync(JOBS_FILE, 'utf8');
    _jobs = JSON.parse(raw);
    if (!Array.isArray(_jobs)) _jobs = [];
  } catch (_) {
    _jobs = [];
  }
  return _jobs;
}

function saveJobs() {
  ensureDir();
  const tmp = JOBS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_jobs, null, 2));
  fs.renameSync(tmp, JOBS_FILE);
}

function createJob({ songUrl, title, style, fullDuration, userId, email }) {
  const jobs = loadJobs();
  const id = 'clip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const job = {
    id,
    status: 'pending',
    progress: 0,
    songUrl,
    title: title || 'Sans titre',
    style: style || '',
    fullDuration: Boolean(fullDuration),
    userId: userId || null,
    email: email || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    segments: 0,
    totalSegments: 0,
    error: null,
    outputUrl: null,
    outputFilename: null,
  };
  jobs.push(job);
  _jobs = jobs.slice(-200); // Garder 200 jobs max
  saveJobs();
  return job;
}

function updateJob(id, updates) {
  const jobs = loadJobs();
  const index = jobs.findIndex(j => j.id === id);
  if (index < 0) return null;
  Object.assign(jobs[index], updates, { updatedAt: new Date().toISOString() });
  saveJobs();
  return jobs[index];
}

function getJob(id) {
  const jobs = loadJobs();
  return jobs.find(j => j.id === id) || null;
}

function listJobs({ userId, email, limit = 20 } = {}) {
  const jobs = loadJobs();
  let filtered = jobs;
  if (userId || email) {
    filtered = jobs.filter(j =>
      (userId && j.userId === userId) ||
      (email && j.email && j.email.toLowerCase() === email.toLowerCase())
    );
  }
  return filtered.slice(-limit).reverse();
}

function listPublicClips() {
  ensureDir();
  try {
    return fs.readdirSync(CLIPS_DIR)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('clip-'))
      .map(f => {
        const stat = fs.statSync(path.join(CLIPS_DIR, f));
        return {
          name: f.replace(/\.mp4$/, ''),
          filename: f,
          url: '/clips/' + encodeURIComponent(f),
          size: stat.size,
          created: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
  } catch (_) {
    return [];
  }
}

module.exports = { createJob, updateJob, getJob, listJobs, listPublicClips, loadJobs, CLIPS_DIR };

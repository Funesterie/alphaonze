'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.NOSSEN_CLIPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-jobs-'));

const {
  JOBS_FILE,
  claimJob,
  createJob,
  getJob,
  recordProviderPromptId,
  updateJob,
} = require('../src/clips/clip-jobs.cjs');
const { runClipGeneration, sanitizeJobDiagnostic } = require('../src/clips/clip-router.cjs');

function newJob(title = 'Test') {
  return createJob({ songUrl: '/api/vivy/studio/assets/test.mp3', title });
}

test('un lease actif empêche une autre couleur de prendre le job', () => {
  const job = newJob('lease');
  assert.ok(claimJob(job.id, 'blue:worker:12345678'));
  assert.equal(claimJob(job.id, 'green:worker:12345678'), null);
  const stored = getJob(job.id, { raw: true });
  assert.equal(stored.workerId, 'blue:worker:12345678');
  assert.equal(stored.status, 'validating');
});

test('un lease expiré est affiché interrompu sans réécrire le job partagé', () => {
  const job = newJob('stale');
  assert.ok(claimJob(job.id, 'blue:worker:abcdefgh'));
  updateJob(job.id, { status: 'generating', leaseUntil: new Date(Date.now() - 1000).toISOString() });
  const visible = getJob(job.id);
  assert.equal(visible.status, 'error');
  assert.equal(visible.error, 'clip_worker_interrupted');
  assert.equal(visible.stale, true);
  const persisted = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')).find((item) => item.id === job.id);
  assert.equal(persisted.status, 'generating', 'un lecteur green ne doit pas marquer le worker blue en erreur sur disque');
});

test('les lectures voient immédiatement la mise à jour écrite par une autre couleur', () => {
  const job = newJob('fresh');
  const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  const target = jobs.find((item) => item.id === job.id);
  target.status = 'done';
  target.outputUrl = '/clips/from-green.mp4';
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs));
  assert.equal(getJob(job.id).outputUrl, '/clips/from-green.mp4');
});

test('le prompt_id fournisseur est persisté par segment sans URL signée', () => {
  const job = newJob('recovery');
  const worker = 'blue:worker:recovery1';
  assert.ok(claimJob(job.id, worker));
  const saved = recordProviderPromptId(job.id, worker, 0, '5097f8f3-4c78-498e-a417-b2b562862887');
  assert.deepEqual(saved.providerSegments, [{
    index: 0,
    promptId: '5097f8f3-4c78-498e-a417-b2b562862887',
    acceptedAt: saved.providerSegments[0].acceptedAt,
  }]);
  assert.doesNotMatch(JSON.stringify(saved.providerSegments), /https|signature|token/i);
});

test('le router suit les callbacks sans remplacer console.log et termine le job', async () => {
  const job = newJob('router');
  const originalConsoleLog = console.log;
  const result = await runClipGeneration(job.id, { songUrl: job.songUrl }, {
    workerId: 'blue:worker:router01',
    generateClipImpl: async (config) => {
      config.onProgress({ stage: 'director:sequencing', status: 'directing', progress: 14, message: 'Scénarisation en cours' });
      assert.equal(getJob(job.id).message, 'Scénarisation en cours');
      assert.equal(getJob(job.id).warning, null);
      config.onProgress({
        stage: 'video:accepted',
        status: 'generating',
        segmentIndex: 0,
        promptId: '5097f8f3-4c78-498e-a417-b2b562862887',
      });
      config.onProgress({ stage: 'video:ready', segments: 1, totalSegments: 1, progress: 90 });
      return {
        url: '/clips/router.mp4',
        filename: 'router.mp4',
        segments: 1,
        requestedSegments: 1,
        partial: false,
      };
    },
  });
  assert.equal(result.claimed, true);
  assert.equal(console.log, originalConsoleLog);
  const stored = getJob(job.id, { raw: true });
  assert.equal(stored.status, 'done');
  assert.equal(stored.progress, 100);
  assert.equal(stored.providerSegments[0].promptId, '5097f8f3-4c78-498e-a417-b2b562862887');
  assert.equal(stored.leaseUntil, null);
  assert.equal(stored.message, null);
});

test('les erreurs de job ne conservent ni query signée ni clé', () => {
  const safe = sanitizeJobDiagnostic('https://storage.googleapis.com/comfy-cloud-assets/a.mp4?X-Goog-Signature=SECRET token=abcd');
  assert.doesNotMatch(safe, /X-Goog|SECRET|abcd/);
  assert.match(safe, /token=\[masqué\]/);
});

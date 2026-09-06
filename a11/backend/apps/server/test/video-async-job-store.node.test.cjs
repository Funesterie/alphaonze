'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createVideoAsyncJobStore } = require('../src/video/video-async-job-store.cjs');

test('durable video job state survives a store recreation without secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a11-video-jobs-'));
  try {
    const first = createVideoAsyncJobStore({ dir, workerId: 'worker-a' });
    first.persist({
      id: 'vjob_12345678_abcd',
      owner: 'user-1',
      status: 'done',
      createdAt: 100,
      updatedAt: 200,
      completedAt: 200,
      result: {
        video_url: 'https://files.example/video.mp4',
        authorization: 'Bearer never-persist',
        nested: { apiKey: 'never-persist-either', provider: 'comfy' },
      },
    });

    const second = createVideoAsyncJobStore({ dir, workerId: 'worker-b', now: () => 250, ttlMs: 10_000 });
    const [restored] = second.loadAll();
    assert.equal(restored.status, 'done');
    assert.equal(restored.result.video_url, 'https://files.example/video.mp4');
    assert.equal(restored.result.authorization, undefined);
    assert.equal(restored.result.nested.apiKey, undefined);
    assert.equal(restored.result.nested.provider, 'comfy');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('fresh heartbeats remain running while stale jobs become explicit interrupted errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'a11-video-orphans-'));
  let now = 100_000;
  try {
    const first = createVideoAsyncJobStore({ dir, workerId: 'worker-a', now: () => now, orphanAfterMs: 5_000 });
    first.persist({
      id: 'vjob_fresh_12345678',
      owner: 'user-1',
      status: 'running',
      createdAt: now - 2_000,
      updatedAt: now - 1_000,
      heartbeatAt: now - 1_000,
    });
    first.persist({
      id: 'vjob_stale_12345678',
      owner: 'user-1',
      status: 'running',
      createdAt: now - 20_000,
      updatedAt: now - 10_000,
      heartbeatAt: now - 10_000,
    });

    const second = createVideoAsyncJobStore({ dir, workerId: 'worker-b', now: () => now, orphanAfterMs: 5_000, ttlMs: 60_000 });
    const restored = new Map(second.loadAll().map((job) => [job.id, job]));
    assert.equal(restored.get('vjob_fresh_12345678').status, 'running');
    assert.equal(restored.get('vjob_stale_12345678').status, 'error');
    assert.equal(restored.get('vjob_stale_12345678').error, 'video_job_interrupted_by_restart');
    assert.equal(restored.get('vjob_stale_12345678').recovery.resumable, false);

    now += 6_000;
    const reconciled = new Map(second.cleanup().map((job) => [job.id, job]));
    assert.equal(reconciled.get('vjob_fresh_12345678').status, 'error');
    assert.equal(reconciled.get('vjob_fresh_12345678').recovery.previousStatus, 'running');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

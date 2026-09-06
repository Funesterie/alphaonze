'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createVivyStudioRouter } = require('../src/routes/vivy-studio.cjs');
const { createVideoAsyncJobStore } = require('../src/video/video-async-job-store.cjs');

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('test_wait_timeout');
}

test('Full Clip route queues one durable job, reuses same-user request and exposes counters', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vivy-full-clip-route-'));
  const store = createVideoAsyncJobStore({ dir, ttlMs: 60_000, orphanAfterMs: 10_000 });
  const lifecycle = [];
  const ledger = {
    async start(input) {
      const record = { ...input, id: input.id || `gen_${lifecycle.length}`, startedAt: Date.now() };
      lifecycle.push({ type: 'start', record });
      return record;
    },
    async finish(record, terminal) {
      lifecycle.push({ type: 'finish', record, terminal });
      return { ...record, ...terminal };
    },
    async getStats() {
      return {
        attempts: 7, succeeded: 5, failed: 1, rejected: 1, active: 1,
        byKind: [
          { kind: 'lyrics', attempts: 5, succeeded: 4, failed: 1, rejected: 0, active: 0, averageDurationMs: 100, p95DurationMs: 200 },
          { kind: 'full_clip', attempts: 2, succeeded: 1, failed: 0, rejected: 1, active: 1, averageDurationMs: 1000, p95DurationMs: 1000 },
        ],
      };
    },
  };

  let releaseRender;
  let startedRender;
  const renderStarted = new Promise((resolve) => { startedRender = resolve; });
  const renderGate = new Promise((resolve) => { releaseRender = resolve; });
  const calls = [];
  const fakeUploader = async () => ({ url: 'https://files.funesterie.me/fake.mp4' });
  const fakeGenerator = async (input, context) => {
    calls.push({ input, context });
    startedRender();
    await renderGate;
    return {
      ok: true,
      durationSeconds: 180,
      formats: { landscape: { url: 'https://files.funesterie.me/clip-landscape.mp4' } },
      socialReady: { youtube: 'https://files.funesterie.me/clip-landscape.mp4' },
    };
  };
  const verifyJWT = (req, _res, next) => {
    req.user = {
      id: String(req.get('x-test-user') || 'founder'),
      role: String(req.get('x-test-role') || 'founder'),
    };
    next();
  };
  const app = express();
  app.use('/api/vivy/studio', createVivyStudioRouter({
    verifyJWT,
    fullClipGenerator: fakeGenerator,
    fullClipUploader: fakeUploader,
    fullClipJobStore: store,
    generationLedger: ledger,
  }));
  const server = await startServer(app);
  try {
    const first = await fetch(`${server.baseUrl}/api/vivy/studio/full-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'founder' },
      body: JSON.stringify({
        audioUrl: 'https://files.funesterie.me/song.mp3',
        lyrics: '[Verse]\nUne ligne',
        title: 'Test clip',
        formats: ['landscape'],
      }),
    });
    const queued = await first.json();
    assert.equal(first.status, 202);
    assert.equal(queued.status, 'pending');
    assert.match(queued.statusUrl, /\/full-clip\/jobs\/vjob_fullclip_/);

    const replay = await fetch(`${server.baseUrl}/api/vivy/studio/full-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'founder' },
      body: JSON.stringify({ audioUrl: 'https://files.funesterie.me/song.mp3', title: 'retry' }),
    });
    const replayBody = await replay.json();
    assert.equal(replay.status, 202);
    assert.equal(replayBody.reused, true);
    assert.equal(replayBody.jobId, queued.jobId);

    const busy = await fetch(`${server.baseUrl}/api/vivy/studio/full-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'premium-user', 'x-test-role': 'premium' },
      body: JSON.stringify({ audioUrl: 'https://files.funesterie.me/other.mp3', title: 'other' }),
    });
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).error, 'full_clip_busy');

    await renderStarted;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.uploadToR2, fakeUploader);
    assert.equal(calls[0].input.localAudioPath, '');
    assert.equal(calls[0].context.userId, 'user:founder');
    releaseRender();

    const done = await waitFor(async () => {
      const response = await fetch(`${server.baseUrl}${queued.statusUrl}`, { headers: { 'x-test-user': 'founder' } });
      const body = await response.json();
      return body.status === 'done' ? body : null;
    });
    assert.equal(done.result.ok, true);
    assert.equal(done.result.socialReady.youtube, 'https://files.funesterie.me/clip-landscape.mp4');
    assert.ok(lifecycle.some((entry) => entry.type === 'finish' && entry.terminal.status === 'succeeded'));
    assert.ok(lifecycle.some((entry) => entry.type === 'finish' && entry.terminal.errorCode === 'full_clip_busy'));

    const statsResponse = await fetch(`${server.baseUrl}/api/vivy/studio/generation-stats`, { headers: { 'x-test-user': 'founder' } });
    const stats = await statsResponse.json();
    assert.equal(statsResponse.status, 200);
    assert.equal(stats.scope, 'global');
    assert.equal(stats.attempts, 7);
    assert.equal(stats.byKind[1].active, 1);
  } finally {
    releaseRender();
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Vivy song chat records lyric success and failure without storing lyric text', async () => {
  const lifecycle = [];
  const ledger = {
    async start(input) {
      const record = { ...input, id: `lyrics_${lifecycle.length}`, startedAt: Date.now() };
      lifecycle.push({ type: 'start', input });
      return record;
    },
    async finish(_record, terminal) {
      lifecycle.push({ type: 'finish', terminal });
    },
    async getStats() { return { attempts: 0, succeeded: 0, failed: 0, rejected: 0, active: 0, byKind: [] }; },
  };
  const verifyJWT = (req, _res, next) => { req.user = { id: 'lyric-user', role: 'premium' }; next(); };
  const app = express();
  app.use('/api/vivy/studio', createVivyStudioRouter({
    verifyJWT,
    generationLedger: ledger,
    buildVivyAiChatImpl: async (input) => {
      if (/fail/i.test(input.message)) throw Object.assign(new Error('provider_timeout'), { code: 'provider_timeout' });
      return { ok: true, publicLyrics: '[Verse]\nParoles originales', provider: 'ollama-cloud' };
    },
  }));
  const server = await startServer(app);
  try {
    const success = await fetch(`${server.baseUrl}/api/vivy/studio/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'song', message: 'écris une chanson' }),
    });
    assert.equal(success.status, 200);
    const failed = await fetch(`${server.baseUrl}/api/vivy/studio/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'song', message: 'fail lyrics' }),
    });
    assert.equal(failed.status, 500);
    assert.deepEqual(
      lifecycle.filter((entry) => entry.type === 'finish').map((entry) => entry.terminal.status),
      ['succeeded', 'failed']
    );
    assert.equal(lifecycle[0].input.kind, 'lyrics');
    assert.equal('message' in lifecycle[0].input, false);
    assert.equal('lyrics' in lifecycle[0].input, false);
  } finally {
    await server.close();
  }
});

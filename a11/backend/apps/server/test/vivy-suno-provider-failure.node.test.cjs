'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-provider-failure-'));
process.env.A11_RUNTIME_ROOT = root;
process.env.A11_EPISODIC_MEMORY_DIR = path.join(root, 'episodes');
process.env.VIVY_SUNO_API_KEY = 'unit-test-only';
process.env.VIVY_SUNO_BASE_URL = 'https://provider.test/api/v1';
const { createVivyStudioRouter } = require('../src/routes/vivy-studio.cjs');
after(() => fs.rmSync(root, { recursive: true, force: true }));

async function withJob(id, upstream, run) {
  const nativeFetch = global.fetch;
  let requests = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:')) return nativeFetch(url, options);
    assert.equal(String(url), `https://provider.test/api/v1/generate/record-info?taskId=${id}`);
    assert.equal(options.method, 'GET', 'No generation/resubmission allowed while reading a failure');
    requests++;
    return upstream(requests);
  };
  const app = express();
  app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT(req, res, next) {
    if (req.headers.authorization !== 'Bearer test-founder') return res.status(401).end();
    req.user = { id: 'unit-founder', roles: ['founder'] }; next();
  } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/vivy/studio/jobs/${id}`;
  const poll = () => fetch(url, { headers: { Authorization: 'Bearer test-founder' } }).then(r => r.json());
  try { await run({ poll, requests: () => requests, url }); }
  finally { global.fetch = nativeFetch; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('callback failure identifies Suno and task without any paid retry or status call', async () => {
  const dir = path.join(root, 'vivy-suno-callbacks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'callback-500.json'), JSON.stringify({ payload: {
    code: 500, msg: 'Internal Error, Please try again later.', data: { task_id: 'callback-500', callbackType: 'error' },
  } }));
  await withJob('callback-500', () => { throw Error('Unexpected provider call'); }, async ({ poll, requests, url }) => {
    assert.equal((await fetch(url)).status, 401);
    const job = await poll();
    assert.equal(job.state, 'error');
    assert.equal(job.failureOrigin, 'provider');
    assert.equal(job.providerCode, 500);
    assert.equal(job.autoRetry, false);
    assert.equal(job.retryable, false);
    assert.match(job.message, /fournisseur Suno.*500/);
    assert.match(job.message, /callback-500/);
    assert.equal(job.providerDetail, 'Internal Error, Please try again later.');
    assert.equal(requests(), 0);
  });
});

test('HTTP 200 containing GENERATE_AUDIO_FAILED retains nested error and is cached terminally', async () => {
  await withJob('record-500', () => ({ ok: true, status: 200, json: async () => ({
    code: 200, msg: 'success', data: { taskId: 'record-500', status: 'GENERATE_AUDIO_FAILED', errorCode: 500,
      errorMessage: 'Internal Error, Please try again later.', response: null },
  }) }), async ({ poll, requests }) => {
    for (let i = 0; i < 2; i++) {
      const job = await poll();
      assert.equal(job.state, 'error');
      assert.equal(job.providerCode, 500);
      assert.equal(job.upstreamStatus, 'GENERATE_AUDIO_FAILED');
      assert.equal(job.status, 'suno_api_500');
      assert.match(job.message, /record-500/);
      assert.notEqual(job.providerDetail, 'success');
      assert.equal(job.media, undefined);
    }
    assert.equal(requests(), 1);
  });
});

test('HTTP 500 on status transport is not mistaken for a definitive generation failure', async () => {
  await withJob('status-outage', () => ({ ok: false, status: 500, json: async () => ({ msg: 'Temporary status outage' }) }), async ({ poll, requests }) => {
    const job = await poll();
    assert.equal(job.state, 'processing');
    assert.equal(job.retryable, true);
    assert.equal(job.status, 'suno_status_retryable_500');
    assert.equal(job.media, undefined);
    assert.equal(requests(), 1);
    assert.equal(fs.existsSync(path.join(root, 'vivy-suno-callbacks/status-outage.json')), false);
  });
});

'use strict';
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-completion-'));
process.env.A11_RUNTIME_ROOT = root;
process.env.A11_EPISODIC_MEMORY_DIR = path.join(root, 'episodes');
process.env.VIVY_SUNO_API_KEY = 'unit-test-only';
process.env.VIVY_SUNO_BASE_URL = 'https://provider.test/api/v1';
process.env.VIVY_SUNO_REQUIRE_LOCAL_AUDIO = 'true';
const { extractSunoMedia, extractSunoMediaWithAudio, materializeVivySunoMedia, createVivyStudioRouter } = require('../src/routes/vivy-studio.cjs');
const source = path.join(root, 'files/generated/vivy/vivy-music-fixture.mp3');
let audio;
const finalUrl = 'https://tempfile.aiquickdraw.com/r/test-completion.mp3';
const streamUrl = 'https://audiostream.api.box/stream/test-completion.mp3';
const partial = { code: 200, data: { taskId: 'test-completion', status: 'TEXT_SUCCESS', response: { sunoData: [{ id: 'test-audio', audioUrl: '', streamAudioUrl: streamUrl, duration: 0 }] } } };
before(() => {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  execFileSync(process.env.FFMPEG_BIN || 'ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:a', 'libmp3lame', source], { stdio: 'pipe', windowsHide: true });
  audio = fs.readFileSync(source);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('Suno provisional streaming URL cannot masquerade as completed audio, even without status', async () => {
  assert.equal(extractSunoMedia(partial), null);
  assert.equal(extractSunoMedia({ data: partial.data.response }), null);
  assert.equal(await extractSunoMediaWithAudio(partial, { probeAudio: () => { throw Error('must_not_probe_stream'); } }), null);
  assert.equal(extractSunoMedia({ audioUrl: streamUrl, duration: 0 }), null);
  const both = { audioUrl: finalUrl, streamAudioUrl: streamUrl, sourceAudioUrl: finalUrl, duration: 120 };
  assert.equal(extractSunoMedia({ code: 200, data: { callbackType: 'first', data: [both] } }), null);
  assert.equal(extractSunoMedia({ code: 200, data: { callbackType: 'complete', data: [both] } }).url, finalUrl);
});

test('required local media never silently returns an unmeasured provider URL', async () => {
  for (const url of [streamUrl, 'https://untrusted.invalid/test.mp3', '', '/missing.mp3']) {
    await assert.rejects(materializeVivySunoMedia({ url }, { requireLocalSunoAudio: true, attempts: 1 }), /local_materialization_failed/);
  }
  process.env.VIVY_SUNO_LOCAL_MP3_DISABLED = 'true';
  try { await assert.rejects(materializeVivySunoMedia({ url: finalUrl }), /not_localizable/); }
  finally { delete process.env.VIVY_SUNO_LOCAL_MP3_DISABLED; }
});

test('existing local MP3 is measured, and provider duration cannot cover a failed measurement', async () => {
  const media = await materializeVivySunoMedia({ url: '/api/vivy/studio/assets/vivy-music-fixture.mp3', durationSeconds: 0 });
  assert.equal(media.durationMeasured, true);
  assert.ok(media.durationMeasuredSeconds > 0.4 && media.durationMeasuredSeconds < 0.7);
  await assert.rejects(materializeVivySunoMedia({ url: media.url, durationSeconds: 180 }, { attempts: 1, probeAudioDurationSeconds: async () => 0 }), /audio_duration_unmeasurable/);
});

test('authenticated job polling: partial stream waits, stale partial cache refreshes, completed MP3 has measured duration', async () => {
  const nativeFetch = global.fetch;
  let providerCalls = 0, downloads = 0;
  const completed = { code: 200, data: { taskId: 'test-completion', status: 'SUCCESS', response: { sunoData: [{ id: 'test-audio', title: 'Recovered song', audioUrl: finalUrl, streamAudioUrl: streamUrl, duration: 0 }] } } };
  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return nativeFetch(url, options);
    if (String(url) === 'https://provider.test/api/v1/generate/record-info?taskId=test-completion') {
      providerCalls++;
      return { ok: true, status: 200, json: async () => providerCalls === 1 ? partial : completed };
    }
    if (String(url) === finalUrl) { downloads++; return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } }); }
    throw Error('unexpected_network_request');
  };
  const app = express();
  app.use('/api/vivy/studio', createVivyStudioRouter({ verifyJWT(req, res, next) {
    if (req.headers.authorization !== 'Bearer test-founder') return res.status(401).end();
    req.user = { id: 'unit-founder', roles: ['founder'] }; next();
  } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/vivy/studio/jobs/test-completion`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const first = await fetch(url, { headers: { Authorization: 'Bearer test-founder' } }).then(r => r.json());
    assert.equal(first.state, 'processing'); assert.equal(first.media, undefined); assert.equal(downloads, 0);
    // Old versions cached the partial payload; this must not trap the repaired poller.
    const cacheDir = path.join(root, 'vivy-suno-callbacks'); fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'test-completion.json'), JSON.stringify({ payload: partial }));
    const secondResponse = await fetch(url, { headers: { Authorization: 'Bearer test-founder' } });
    const second = await secondResponse.json();
    assert.equal(secondResponse.status, 200); assert.equal(second.state, 'done');
    assert.equal(providerCalls, 2); assert.equal(downloads, 1);
    assert.equal(second.media.durationMeasured, true); assert.ok(second.durationSeconds > 0);
    assert.match(second.media.url, /^\/api\/vivy\/studio\/assets\/vivy-music-suno-/);
    assert.ok(fs.statSync(second.media.path).size > 0);
  } finally { global.fetch = nativeFetch; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

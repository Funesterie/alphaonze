'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const createDoubleHarmonicRouter = require('../src/routes/double-harmonic.cjs');
const {
  BALANCE_AUTO,
  buildD40EnvelopeExpression,
  buildProtectMixD40Args,
  buildProtectMixD40Filter,
  MICROGAP_HALF_PLUS_CANON_MG,
  resolveHarmonicIntensity,
  resolveD40Density,
} = require('../src/audio/double-harmonic-d40.cjs');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

test('D40 calculation uses cross multiplication from 40.0005 to 40', () => {
  const density = resolveD40Density();
  assert.equal(density.value, 0.2919963500456244);
  assert.equal(density.correction, 0.999987500156248);

  const envelope = buildD40EnvelopeExpression({ profile: 'blend' });
  assert.equal(envelope.profile, 'blend');
  assert.match(envelope.expression, /0\.999987500156/);

  const built = buildProtectMixD40Filter({ profile: 'prime3' });
  assert.equal(built.envelope.profile, 'prime3');
  assert.match(built.filter, /asplit=2\[full\]\[work\]/);
  assert.match(built.filter, /amix=inputs=3:weights='1 1 1':normalize=0/);
});

test('harmonic intensity scales only the overlay weights and stays bounded', () => {
  const normal = buildProtectMixD40Filter({ intensity: 1 });
  const stronger = buildProtectMixD40Filter({ intensity: 1.08 });
  const attemptedMgOverride = buildProtectMixD40Filter({ intensity: 1, mg: 2 });

  assert.equal(resolveHarmonicIntensity('999'), 1 / BALANCE_AUTO);
  assert.equal(resolveHarmonicIntensity('0'), BALANCE_AUTO);
  assert.equal(normal.mg, MICROGAP_HALF_PLUS_CANON_MG);
  assert.equal(attemptedMgOverride.mg, MICROGAP_HALF_PLUS_CANON_MG);
  assert.equal(Number((normal.lowWeight / normal.highWeight).toFixed(12)), Number(BALANCE_AUTO.toFixed(12)));
  assert.equal(Number(stronger.highWeight.toFixed(12)), Number((normal.highWeight * 1.08).toFixed(12)));
  assert.equal(Number(stronger.lowWeight.toFixed(12)), Number((normal.lowWeight * 1.08).toFixed(12)));
  assert.match(stronger.filter, /amix=inputs=3:weights='1 1 1':normalize=0/);

  const mp3Args = buildProtectMixD40Args({
    inputPath: 'input.wav',
    outputPath: 'output.mp3',
    intensity: 1,
  }).args;
  assert.deepEqual(mp3Args.slice(-5), ['-codec:a', 'libmp3lame', '-b:a', '192k', 'output.mp3']);
});

test('double harmonic route exposes phase-lock v2 as status only', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-status-'));
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({ runtimeRoot }));

  const { server, baseUrl } = await listen(app);
  try {
    const status = await fetch(`${baseUrl}/api/double-harmonic/status`);
    const statusPayload = await status.json();
    assert.equal(status.status, 200);
    assert.equal(statusPayload.method, 'dry-master-plus-adaptive-d40-harmonic-overlay-v1');
    assert.equal(statusPayload.v2.preservesV1, true);
    assert.equal(statusPayload.v2.state, 'analysis-plan');

    const v2 = await fetch(`${baseUrl}/api/double-harmonic/v2/status?smoothing=1%2Fe&frameMs=20`);
    const v2Payload = await v2.json();
    assert.equal(v2.status, 200);
    assert.equal(v2Payload.v2.controls.smoothing.mode, 'one-over-e');
    assert.equal(v2Payload.v2.frameMs, 20);
    assert.equal(v2Payload.v2.safety.keepV1RouteUntouched, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route processes upload and exposes tokenized audio link', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processProtectMixD40: async ({ outputPath, profile, intensity }) => {
      calls.push({ profile, intensity });
      fs.writeFileSync(outputPath, Buffer.from('processed wav'));
      return {
        method: 'dry-master-plus-adaptive-d40-harmonic-overlay-v1',
        profile,
        intensity,
        weights: { dry: 1, high: 0.03, low: 0.024 },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('RIFFdemoWAVEfmt ')], { type: 'audio/wav' }), 'demo.wav');
    form.append('profile', 'blend');
    form.append('intensity', '1.08');
    const res = await fetch(`${baseUrl}/api/double-harmonic/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(calls, [{ profile: 'blend', intensity: 1.08 }]);
    assert.equal(payload.intensity, 1.08);
    assert.deepEqual(payload.weights, { dry: 1, high: 0.03, low: 0.024 });
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+\.wav$/);
    assert.match(payload.shareUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/double-harmonic\/out\/.+\.wav\?token=/);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/wav/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route analyzes upload through phase-lock v2 without writing output asset', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v2-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    analyzePhaseLockV2: async ({ inputPath, profile, frameMs, maxFrameDetails }) => {
      calls.push({
        existsDuringCall: fs.existsSync(inputPath),
        profile,
        frameMs,
        maxFrameDetails,
      });
      return {
        method: 'dry-first-d40-phase-lock-analysis-v2',
        state: 'measured-analysis',
        preservesV1: true,
        summary: { frames: 4, voicedFrames: 3, medianF0: 220 },
        frames: [{ index: 0, f0: 220, phaseRadians: 0 }],
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('RIFFdemoWAVEfmt ')], { type: 'audio/wav' }), 'demo.wav');
    form.append('profile', 'prime3');
    form.append('frameMs', '20');
    form.append('maxFrameDetails', '8');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v2/analyze`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-d40-phase-lock-analysis-v2');
    assert.equal(payload.v2.state, 'measured-analysis');
    assert.deepEqual(calls, [{
      existsDuringCall: true,
      profile: 'prime3',
      frameMs: 20,
      maxFrameDetails: 8,
    }]);
    const files = fs.readdirSync(path.join(runtimeRoot, 'double-harmonic-d40'));
    assert.equal(files.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route processes upload through experimental phase-lock v2', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v2-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processPhaseAwareD40V2: async ({ outputPath, profile, intensity, analysisOptions }) => {
      calls.push({ profile, intensity, frameMs: analysisOptions.frameMs });
      fs.writeFileSync(outputPath, Buffer.from('processed v2 mp3'));
      return {
        method: 'dry-first-d40-phase-aware-overlay-v2',
        state: 'experimental-process',
        profile,
        intensity,
        phase: { score: 1.01, delaySamples: 0.08 },
        analysis: { summary: { frames: 4, medianF0: 220 }, frameMs: analysisOptions.frameMs },
        weights: { dry: 1, high: 0.028, low: 0.02488888888888889, ratio: 0.8888888888888888 },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('intensity', '1.08');
    form.append('frameMs', '20');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v2/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-d40-phase-aware-overlay-v2');
    assert.equal(payload.state, 'experimental-process');
    assert.equal(payload.contentType, 'audio/mpeg');
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v2\.mp3$/);
    assert.deepEqual(calls, [{ profile: 'blend', intensity: 1.08, frameMs: 20 }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/mpeg/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route keeps mp3 input as mp3 output', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-mp3-'));
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processProtectMixD40: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('processed mp3'));
      return {
        method: 'dry-master-plus-adaptive-d40-harmonic-overlay-v1',
        profile: 'blend',
        intensity: 1,
        weights: { dry: 1, high: 0.03, low: 0.024 },
      };
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    const res = await fetch(`${baseUrl}/api/double-harmonic/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.contentType, 'audio/mpeg');
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+\.mp3$/);
    assert.match(payload.shareUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/double-harmonic\/out\/.+\.mp3\?token=/);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/mpeg/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

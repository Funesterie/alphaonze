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
  buildD40EnvelopeExpression,
  buildProtectMixD40Filter,
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
  const stronger = buildProtectMixD40Filter({ intensity: 1.5 });

  assert.equal(resolveHarmonicIntensity('999'), 8);
  assert.equal(resolveHarmonicIntensity('0'), 0.25);
  assert.equal(Number(stronger.highWeight.toFixed(12)), Number((normal.highWeight * 1.5).toFixed(12)));
  assert.equal(Number(stronger.lowWeight.toFixed(12)), Number((normal.lowWeight * 1.5).toFixed(12)));
  assert.match(stronger.filter, /amix=inputs=3:weights='1 1 1':normalize=0/);
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
    form.append('intensity', '1.5');
    const res = await fetch(`${baseUrl}/api/double-harmonic/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(calls, [{ profile: 'blend', intensity: 1.5 }]);
    assert.equal(payload.intensity, 1.5);
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

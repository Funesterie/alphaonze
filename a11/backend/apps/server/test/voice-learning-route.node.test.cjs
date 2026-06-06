'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function createPcm16Wav({ frequency = 440, durationSec = 0.15, sampleRate = 16000, amplitude = 0.25 } = {}) {
  const sampleCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude * 32767);
    buffer.writeInt16LE(sample, 44 + (i * 2));
  }
  return buffer;
}

function loadRouter() {
  const routePath = path.resolve(__dirname, '../src/routes/voice-learning.cjs');
  delete require.cache[routePath];
  return require(routePath);
}

async function withVoiceLearningServer(fn) {
  const createVoiceLearningRouter = loadRouter();
  const app = express();
  app.use('/api', createVoiceLearningRouter({
    verifyJWT(req, _res, next) {
      req.user = {
        id: 'test-user',
        email: String(req.headers['x-test-email'] || ''),
      };
      next();
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postAudio(baseUrl, { email, persona = 'a11', file, filename, mimeType = 'audio/wav', durationMs } = {}) {
  const form = new FormData();
  form.append('audio', new Blob([file], { type: mimeType }), filename || `clip.${mimeType.includes('webm') ? 'webm' : 'wav'}`);
  form.append('persona', persona);
  form.append('source', 'test');
  form.append('consent', 'voice-learning-v1');
  if (durationMs) form.append('durationMs', String(durationMs));
  const res = await fetch(`${baseUrl}/api/voice-learning/snippet`, {
    method: 'POST',
    headers: {
      'x-test-email': email,
    },
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

test('voice learning accepts snippets only for the configured source account', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_VOICE_LEARNING_DIR = root;

  try {
    await withVoiceLearningServer(async (baseUrl) => {
      const allowed = await postAudio(baseUrl, {
        email: 'cellaurojeffrey@gmail.com',
        persona: 'a11',
        file: createPcm16Wav(),
        filename: 'a11.wav',
      });
      assert.equal(allowed.res.status, 200);
      assert.equal(allowed.payload.ok, true);
      assert.equal(allowed.payload.persona, 'a11');
      assert.equal(allowed.payload.clipCount, 1);

      const duplicate = await postAudio(baseUrl, {
        email: 'cellaurojeffrey@gmail.com',
        persona: 'a11',
        file: createPcm16Wav(),
        filename: 'a11.wav',
      });
      assert.equal(duplicate.res.status, 200);
      assert.equal(duplicate.payload.duplicate, true);
      assert.equal(duplicate.payload.clipCount, 1);

      const denied = await postAudio(baseUrl, {
        email: 'someone@example.com',
        persona: 'a11',
        file: createPcm16Wav(),
        filename: 'blocked.wav',
      });
      assert.equal(denied.res.status, 403);
      assert.equal(denied.payload.error, 'voice_learning_not_allowed');
    });
  } finally {
    if (previousRoot === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('voice learning queues training only after enough real audio duration is collected', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-train-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_VOICE_LEARNING_DIR = root;

  try {
    await withVoiceLearningServer(async (baseUrl) => {
      const tooEarly = await fetch(`${baseUrl}/api/voice-learning/train`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-email': 'giovannabrunetto@gmail.com',
        },
        body: JSON.stringify({ persona: 'kaen44', consent: 'voice-learning-v1' }),
      });
      const tooEarlyPayload = await tooEarly.json();
      assert.equal(tooEarly.status, 409);
      assert.equal(tooEarlyPayload.error, 'voice_corpus_too_short');

      const longClip = await postAudio(baseUrl, {
        email: 'giovannabrunetto@gmail.com',
        persona: 'kaen44',
        file: Buffer.alloc(2048, 7),
        filename: 'k44.webm',
        mimeType: 'audio/webm',
        durationMs: 181000,
      });
      assert.equal(longClip.res.status, 200);
      assert.equal(longClip.payload.corpusReady, true);

      const train = await fetch(`${baseUrl}/api/voice-learning/train`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-email': 'giovannabrunetto@gmail.com',
        },
        body: JSON.stringify({ persona: 'kaen44', consent: 'voice-learning-v1' }),
      });
      const trainPayload = await train.json();
      assert.equal(train.status, 200);
      assert.equal(trainPayload.ok, true);
      assert.equal(trainPayload.training.state, 'queued');
      assert.equal(trainPayload.persona, 'kaen44');
    });
  } finally {
    if (previousRoot === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

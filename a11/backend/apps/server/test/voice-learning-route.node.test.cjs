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
        tier: String(req.headers['x-test-tier'] || ''),
        subscription_active: String(req.headers['x-test-subscription-active'] || '').toLowerCase() === 'true',
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

async function postAudio(baseUrl, { email, tier = '', persona = 'a11', file, filename, mimeType = 'audio/wav', durationMs, consent = 'voice-learning-v1' } = {}) {
  const form = new FormData();
  form.append('audio', new Blob([file], { type: mimeType }), filename || `clip.${mimeType.includes('webm') ? 'webm' : 'wav'}`);
  form.append('persona', persona);
  form.append('source', 'test');
  if (consent !== null) form.append('consent', consent);
  if (durationMs) form.append('durationMs', String(durationMs));
  const headers = {};
  if (email !== undefined) headers['x-test-email'] = email;
  if (tier) headers['x-test-tier'] = tier;
  const res = await fetch(`${baseUrl}/api/voice-learning/snippet`, {
    method: 'POST',
    headers,
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

test('voice learning accepts consented snippets from any connected account', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  const previousAllowOptIn = process.env.A11_VOICE_LEARNING_ALLOW_OPT_IN_CONTRIBUTORS;
  process.env.A11_VOICE_LEARNING_DIR = root;
  process.env.A11_VOICE_LEARNING_ALLOW_OPT_IN_CONTRIBUTORS = 'true';

  try {
    await withVoiceLearningServer(async (baseUrl) => {
      const anonymousStatus = await fetch(`${baseUrl}/api/voice-learning/status?persona=a11`);
      const anonymousPayload = await anonymousStatus.json();
      assert.equal(anonymousStatus.status, 200);
      assert.equal(anonymousPayload.canCapture, false);

      const connectedStatus = await fetch(`${baseUrl}/api/voice-learning/status?persona=a11`, {
        headers: { 'x-test-email': 'someone@example.com' },
      });
      const connectedPayload = await connectedStatus.json();
      assert.equal(connectedStatus.status, 200);
      assert.equal(connectedPayload.canCapture, true);
      assert.equal(connectedPayload.contributorRole, 'opt-in-user');

      const allowed = await postAudio(baseUrl, {
        email: 'someone@example.com',
        persona: 'a11',
        file: createPcm16Wav(),
        filename: 'a11.wav',
      });
      assert.equal(allowed.res.status, 200);
      assert.equal(allowed.payload.ok, true);
      assert.equal(allowed.payload.persona, 'a11');
      assert.equal(allowed.payload.clipCount, 1);
      assert.equal(allowed.payload.contributorRole, 'opt-in-user');

      const duplicate = await postAudio(baseUrl, {
        email: 'someone@example.com',
        persona: 'a11',
        file: createPcm16Wav(),
        filename: 'a11.wav',
      });
      assert.equal(duplicate.res.status, 200);
      assert.equal(duplicate.payload.duplicate, true);
      assert.equal(duplicate.payload.clipCount, 1);

      const missingConsent = await postAudio(baseUrl, {
        email: 'another@example.com',
        persona: 'a11',
        file: createPcm16Wav(),
        filename: 'missing-consent.wav',
        consent: null,
      });
      assert.equal(missingConsent.res.status, 400);
      assert.equal(missingConsent.payload.error, 'missing_consent');

      const officialStatus = await fetch(`${baseUrl}/api/voice-learning/status?persona=a11`, {
        headers: { 'x-test-email': 'bayetgerard@gmail.com' },
      });
      const officialPayload = await officialStatus.json();
      assert.equal(officialStatus.status, 200);
      assert.equal(officialPayload.isOfficialSource, true);
      assert.equal(officialPayload.contributorRole, 'official-source');
      assert.equal(officialPayload.voiceIdentityKey, 'a11');
      assert.equal(officialPayload.voiceStyle, 'a11-official-stern-french');
    });
  } finally {
    if (previousRoot === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousRoot;
    if (previousAllowOptIn === undefined) delete process.env.A11_VOICE_LEARNING_ALLOW_OPT_IN_CONTRIBUTORS;
    else process.env.A11_VOICE_LEARNING_ALLOW_OPT_IN_CONTRIBUTORS = previousAllowOptIn;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('voice learning maps family voice owners and premium personal voice access', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-family-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_VOICE_LEARNING_DIR = root;

  try {
    await withVoiceLearningServer(async (baseUrl) => {
      const djeff = await fetch(`${baseUrl}/api/voice-learning/status?persona=djeff`, {
        headers: { 'x-test-email': 'cellaurojeffrey@gmail.com' },
      });
      const djeffPayload = await djeff.json();
      assert.equal(djeff.status, 200);
      assert.equal(djeffPayload.canCapture, true);
      assert.equal(djeffPayload.isOfficialSource, true);
      assert.equal(djeffPayload.voiceIdentityKey, 'djeff');
      assert.equal(djeffPayload.voiceStyle, 'djeff-rap');

      const vivy = await fetch(`${baseUrl}/api/voice-learning/status?persona=vivy`, {
        headers: { 'x-test-email': 'jewitt.charlene@gmail.com' },
      });
      const vivyPayload = await vivy.json();
      assert.equal(vivy.status, 200);
      assert.equal(vivyPayload.canCapture, true);
      assert.equal(vivyPayload.isOfficialSource, true);
      assert.equal(vivyPayload.voiceIdentityKey, 'vivy');
      assert.equal(vivyPayload.voiceStyle, 'vivy-official-french-conversational');

      const basicPersonal = await fetch(`${baseUrl}/api/voice-learning/status?persona=personal`, {
        headers: { 'x-test-email': 'basic@example.com' },
      });
      const basicPersonalPayload = await basicPersonal.json();
      assert.equal(basicPersonal.status, 200);
      assert.equal(basicPersonalPayload.canCapture, false);
      assert.equal(basicPersonalPayload.minimumTier, 'premium');

      const randomOfficial = await fetch(`${baseUrl}/api/voice-learning/status?persona=vivy`, {
        headers: { 'x-test-email': 'random@example.com' },
      });
      const randomOfficialPayload = await randomOfficial.json();
      assert.equal(randomOfficial.status, 200);
      assert.equal(randomOfficialPayload.canCapture, false);

      const premiumPersonal = await fetch(`${baseUrl}/api/voice-learning/status?persona=personal`, {
        headers: {
          'x-test-email': 'premium@example.com',
          'x-test-tier': 'premium',
        },
      });
      const premiumPersonalPayload = await premiumPersonal.json();
      assert.equal(premiumPersonal.status, 200);
      assert.equal(premiumPersonalPayload.canCapture, true);
      assert.equal(premiumPersonalPayload.persona, 'personal');
      assert.equal(premiumPersonalPayload.contributorRole, 'personal-owner');
      assert.equal(premiumPersonalPayload.minimumTier, 'premium');
    });
  } finally {
    if (previousRoot === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('voice learning lets a connected account delete its own corpus', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-delete-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_VOICE_LEARNING_DIR = root;

  try {
    await withVoiceLearningServer(async (baseUrl) => {
      const uploaded = await postAudio(baseUrl, {
        email: 'participant@example.com',
        tier: 'premium',
        persona: 'personal',
        file: createPcm16Wav({ frequency: 660 }),
        filename: 'participant.wav',
      });
      assert.equal(uploaded.res.status, 200);
      assert.equal(uploaded.payload.clipCount, 1);

      const missingConfirm = await fetch(`${baseUrl}/api/voice-learning/corpus`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-test-email': 'participant@example.com',
          'x-test-tier': 'premium',
        },
        body: JSON.stringify({ persona: 'personal' }),
      });
      const missingConfirmPayload = await missingConfirm.json();
      assert.equal(missingConfirm.status, 400);
      assert.equal(missingConfirmPayload.error, 'missing_delete_confirmation');

      const deleted = await fetch(`${baseUrl}/api/voice-learning/corpus`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-test-email': 'participant@example.com',
          'x-test-tier': 'premium',
        },
        body: JSON.stringify({ persona: 'personal', confirm: 'delete-voice-learning-corpus' }),
      });
      const deletedPayload = await deleted.json();
      assert.equal(deleted.status, 200);
      assert.equal(deletedPayload.deleted, true);
      assert.equal(deletedPayload.clipCount, 0);
      assert.equal(deletedPayload.nextAction, 'record');
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

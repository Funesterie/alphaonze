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

async function postSunoVoice(baseUrl, { email, tier = '', voiceId = '15596961dc4e06197678c9111924d00f', label = 'Ma voix test', consent = 'suno-voice-slot-v1' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (email !== undefined) headers['x-test-email'] = email;
  if (tier) headers['x-test-tier'] = tier;
  const res = await fetch(`${baseUrl}/api/voice-learning/suno-voice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      persona: 'personal',
      voiceId,
      label,
      consent,
    }),
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

      const marvin = await fetch(`${baseUrl}/api/voice-learning/status?persona=marvin`, {
        headers: { 'x-test-email': 'marvincellauro@gmail.com' },
      });
      const marvinPayload = await marvin.json();
      assert.equal(marvin.status, 200);
      assert.equal(marvinPayload.canCapture, true);
      assert.equal(marvinPayload.isOfficialSource, true);
      assert.equal(marvinPayload.voiceIdentityKey, 'marvin');
      assert.equal(marvinPayload.voiceStyle, 'marvin-family-french-lead');

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

test('premium personal voice account can link one private Suno voice slot without leaking the raw id', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-suno-slot-'));
  const previousRoot = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_VOICE_LEARNING_DIR = root;

  try {
    await withVoiceLearningServer(async (baseUrl) => {
      const basic = await postSunoVoice(baseUrl, {
        email: 'basic@example.com',
        voiceId: '15596961dc4e06197678c9111924d00f',
      });
      assert.equal(basic.res.status, 403);
      assert.equal(basic.payload.error, 'personal_suno_voice_not_allowed');
      assert.equal(basic.payload.minimumTier, 'premium');

      const invalid = await postSunoVoice(baseUrl, {
        email: 'premium@example.com',
        tier: 'premium',
        voiceId: 'bad id with spaces',
      });
      assert.equal(invalid.res.status, 400);
      assert.equal(invalid.payload.error, 'invalid_suno_voice_id');

      const linked = await postSunoVoice(baseUrl, {
        email: 'premium@example.com',
        tier: 'premium',
        voiceId: '15596961dc4e06197678c9111924d00f',
        label: 'Jeff Suno',
      });
      assert.equal(linked.res.status, 200);
      assert.equal(linked.payload.ok, true);
      assert.equal(linked.payload.sunoVoiceLinked, true);
      assert.equal(linked.payload.sunoVoiceProvider, 'suno');
      assert.equal(linked.payload.sunoVoiceLabel, 'Jeff Suno');
      assert.match(linked.payload.sunoVoiceIdMask, /^155969.*24d00f$/);
      assert.doesNotMatch(JSON.stringify(linked.payload), /15596961dc4e06197678c9111924d00f/);

      const replaced = await postSunoVoice(baseUrl, {
        email: 'premium@example.com',
        tier: 'premium',
        voiceId: '20cdb130cfa1fd51edbc58c94dca4e24',
        label: 'Jeff Suno v2',
      });
      assert.equal(replaced.res.status, 200);
      assert.equal(replaced.payload.sunoVoiceLabel, 'Jeff Suno v2');
      assert.match(replaced.payload.sunoVoiceIdMask, /^20cdb1.*ca4e24$/);
      assert.doesNotMatch(JSON.stringify(replaced.payload), /20cdb130cfa1fd51edbc58c94dca4e24/);

      const status = await fetch(`${baseUrl}/api/voice-learning/status?persona=personal`, {
        headers: {
          'x-test-email': 'premium@example.com',
          'x-test-tier': 'premium',
        },
      });
      const statusPayload = await status.json();
      assert.equal(status.status, 200);
      assert.equal(statusPayload.sunoVoiceLinked, true);
      assert.equal(statusPayload.sunoVoiceLabel, 'Jeff Suno v2');
      assert.doesNotMatch(JSON.stringify(statusPayload), /20cdb130cfa1fd51edbc58c94dca4e24/);

      const clearedCorpus = await fetch(`${baseUrl}/api/voice-learning/corpus`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-test-email': 'premium@example.com',
          'x-test-tier': 'premium',
        },
        body: JSON.stringify({
          persona: 'personal',
          confirm: 'delete-voice-learning-corpus',
        }),
      });
      const clearedPayload = await clearedCorpus.json();
      assert.equal(clearedCorpus.status, 200);
      assert.equal(clearedPayload.clipCount, 0);
      assert.equal(clearedPayload.sunoVoiceLinked, true);
      assert.equal(clearedPayload.sunoVoiceLabel, 'Jeff Suno v2');
    });
  } finally {
    if (previousRoot === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('voice learning reads legacy runtime corpus and syncs it to canonical runtime on train', async () => {
  const canonicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-canonical-'));
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-voice-learning-legacy-'));
  const previousRuntimeRoot = process.env.A11_RUNTIME_ROOT;
  const previousLegacyRoots = process.env.A11_RUNTIME_ROOT_LEGACY_DIRS;
  const previousDisableImplicitLegacy = process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY;
  const previousVoiceLearningDir = process.env.A11_VOICE_LEARNING_DIR;
  process.env.A11_RUNTIME_ROOT = canonicalRoot;
  process.env.A11_RUNTIME_ROOT_LEGACY_DIRS = legacyRoot;
  process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY = '1';
  delete process.env.A11_VOICE_LEARNING_DIR;

  try {
    const ownerKey = 'cellaurojeffrey-gmail.com';
    const legacyCorpusDir = path.join(legacyRoot, 'voice-learning', 'djeff', ownerKey);
    fs.mkdirSync(legacyCorpusDir, { recursive: true });
    const legacyWav = createPcm16Wav({ durationSec: 0.2, frequency: 180 });
    const legacyFile = path.join(legacyCorpusDir, 'legacy-djeff.wav');
    fs.writeFileSync(legacyFile, legacyWav);
    fs.writeFileSync(path.join(legacyCorpusDir, 'index.json'), JSON.stringify({
      clips: [{
        id: 'legacy-djeff',
        persona: 'djeff',
        ownerKey,
        filename: 'legacy-djeff.wav',
        sha256: 'legacy-djeff-sha',
        durationMs: 181000,
        bytes: legacyWav.length,
        createdAt: '2026-06-10T00:00:00.000Z',
      }],
      trainRequests: [],
    }, null, 2));

    await withVoiceLearningServer(async (baseUrl) => {
      const status = await fetch(`${baseUrl}/api/voice-learning/status?persona=djeff`, {
        headers: { 'x-test-email': 'cellaurojeffrey@gmail.com' },
      });
      const payload = await status.json();
      assert.equal(status.status, 200);
      assert.equal(payload.clipCount, 1);
      assert.equal(payload.secondsCollected, 181);
      assert.equal(payload.corpusReady, true);

      const train = await fetch(`${baseUrl}/api/voice-learning/train`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-email': 'cellaurojeffrey@gmail.com',
        },
        body: JSON.stringify({ persona: 'djeff', consent: 'voice-learning-v1' }),
      });
      const trainPayload = await train.json();
      assert.equal(train.status, 200);
      assert.equal(trainPayload.ok, true);
      assert.equal(trainPayload.clipCount, 1);

      const canonicalCorpusDir = path.join(canonicalRoot, 'voice-learning', 'djeff', ownerKey);
      assert.equal(fs.existsSync(path.join(canonicalCorpusDir, 'index.json')), true);
      assert.equal(fs.existsSync(path.join(canonicalCorpusDir, 'legacy-djeff.wav')), true);
    });
  } finally {
    if (previousRuntimeRoot === undefined) delete process.env.A11_RUNTIME_ROOT;
    else process.env.A11_RUNTIME_ROOT = previousRuntimeRoot;
    if (previousLegacyRoots === undefined) delete process.env.A11_RUNTIME_ROOT_LEGACY_DIRS;
    else process.env.A11_RUNTIME_ROOT_LEGACY_DIRS = previousLegacyRoots;
    if (previousDisableImplicitLegacy === undefined) delete process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY;
    else process.env.A11_RUNTIME_DISABLE_IMPLICIT_LEGACY = previousDisableImplicitLegacy;
    if (previousVoiceLearningDir === undefined) delete process.env.A11_VOICE_LEARNING_DIR;
    else process.env.A11_VOICE_LEARNING_DIR = previousVoiceLearningDir;
    fs.rmSync(canonicalRoot, { recursive: true, force: true });
    fs.rmSync(legacyRoot, { recursive: true, force: true });
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

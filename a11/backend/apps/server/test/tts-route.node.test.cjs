const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ttsRouter = require('../routes/tts.cjs');

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

function createPcm16Wav({ frequency = 440, durationSec = 0.12, sampleRate = 16000, amplitude = 0.25 } = {}) {
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

test('tts piper route rewrites loopback TTS asset URLs to backend proxy paths', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const backendCalls = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
  delete process.env.A11_VOICE_MODULE_URL;
  process.env.TTS_URL = 'http://127.0.0.1:5002';
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options) => {
    backendCalls.push(String(url));
    if (String(url) === 'http://127.0.0.1:5002/api/tts') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: 'http://127.0.0.1:5002/out/local-voice.wav',
            gif_url: 'http://127.0.0.1:5002/out/local-voice.gif',
          });
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', { text: 'bonjour' }, {
          host: 'a11.funesterie.me',
          'x-forwarded-proto': 'https',
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.audio_url, '/api/tts/out/local-voice.wav');
        assert.equal(result.json.audioUrl, '/api/tts/out/local-voice.wav');
        assert.equal(result.json.gif_url, '/api/tts/out/local-voice.gif');
        assert.doesNotMatch(String(result.json.audio_url || ''), /127\.0\.0\.1|http:\/\//i);
        assert.equal(
          backendCalls.filter((url) => url === 'http://127.0.0.1:5002/api/tts').length,
          1
        );
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts piper route rewrites container TTS asset URLs to backend proxy paths', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const backendCalls = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options) => {
    backendCalls.push(String(url));
    if (String(url) === 'http://a11-voice:5002/api/tts') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: '/out/container-voice.wav',
            audioUrl: '/out/container-voice.wav',
            via: 'piper',
          });
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', { text: 'bonjour' });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.audio_url, '/api/tts/out/container-voice.wav');
        assert.equal(result.json.audioUrl, '/api/tts/out/container-voice.wav');
        assert.doesNotMatch(String(result.json.audio_url || ''), /a11-voice|http:\/\//i);
        assert.equal(
          backendCalls.filter((url) => url === 'http://a11-voice:5002/api/tts').length,
          1
        );
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts speak route can return an async job and poll the generated audio payload', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const backendBodies = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'http://a11-voice:5002/api/tts') {
      backendBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            audio_url: '/out/async-vivy.mp3',
            audioUrl: '/out/async-vivy.mp3',
            provider: 'xtts-rvc',
            via: 'funesterie-xtts-rvc-bridge',
          });
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const started = await postJson(baseUrl, '/api/tts/speak', {
          text: 'Je suis Vivy.',
          voice: 'vivy',
          provider: 'auto',
          ttsAsync: true,
          stream: true,
        });

        assert.equal(started.response.status, 202);
        assert.equal(started.json.async, true);
        assert.match(started.json.jobId, /^ttsjob-/);
        assert.match(started.json.statusUrl, /^\/api\/tts\/jobs\//);

        let polled = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const response = await fetch(baseUrl + started.json.statusUrl);
          polled = await response.json();
          if (polled.state === 'done' || polled.state === 'failed') break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        assert.equal(polled.state, 'done');
        assert.equal(polled.result.via, 'http');
        assert.equal(polled.audioUrl, '/api/tts/out/async-vivy.mp3');
        assert.equal(backendBodies.length, 1);
        assert.equal(backendBodies[0].ttsAsync, false);
        assert.equal(backendBodies[0].stream, false);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts async official voice jobs can be claimed and completed by the local GPU worker', async () => {
  const previousEnv = {
    A11_TTS_LOCAL_GPU_WORKER_ENABLED: process.env.A11_TTS_LOCAL_GPU_WORKER_ENABLED,
    A11_LOCAL_GPU_WORKER_ENABLED: process.env.A11_LOCAL_GPU_WORKER_ENABLED,
    A11_LOCAL_GPU_WORKER_TOKEN: process.env.A11_LOCAL_GPU_WORKER_TOKEN,
    A11_TTS_LOCAL_WORKER_TOKEN: process.env.A11_TTS_LOCAL_WORKER_TOKEN,
    A11_LOCAL_GPU_WORKER_TOKEN_FILE: process.env.A11_LOCAL_GPU_WORKER_TOKEN_FILE,
    A11_TTS_LOCAL_WORKER_TOKEN_FILE: process.env.A11_TTS_LOCAL_WORKER_TOKEN_FILE,
    A11_LOCAL_GPU_WORKER_MAX_ACTIVE: process.env.A11_LOCAL_GPU_WORKER_MAX_ACTIVE,
  };
  const wav = createPcm16Wav();

  process.env.A11_TTS_LOCAL_GPU_WORKER_ENABLED = '1';
  delete process.env.A11_LOCAL_GPU_WORKER_ENABLED;
  process.env.A11_LOCAL_GPU_WORKER_TOKEN = 'test-local-gpu-worker-token';
  process.env.A11_LOCAL_GPU_WORKER_MAX_ACTIVE = '1';
  delete process.env.A11_TTS_LOCAL_WORKER_TOKEN;
  delete process.env.A11_LOCAL_GPU_WORKER_TOKEN_FILE;
  delete process.env.A11_TTS_LOCAL_WORKER_TOKEN_FILE;

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const started = await postJson(baseUrl, '/api/tts/speak', {
          text: 'bonjour local',
          persona: 'a11',
          ttsAsync: true,
          audioFormat: 'wav',
        });

        assert.equal(started.response.status, 202);
        assert.equal(started.json.state, 'queued');
        assert.equal(started.json.worker, 'local-gpu');

        const unauthorized = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'bad-worker' });
        assert.equal(unauthorized.response.status, 401);

        const claimed = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'test-worker' }, {
          authorization: 'Bearer test-local-gpu-worker-token',
        });
        assert.equal(claimed.response.status, 200);
        assert.equal(claimed.json.job.id, started.json.jobId);
        assert.equal(claimed.json.job.body.text, 'bonjour local');
        assert.equal(claimed.json.maxActive, 1);
        assert.equal(claimed.json.activeLeases, 1);

        const second = await postJson(baseUrl, '/api/tts/speak', {
          text: 'deuxieme job local',
          persona: 'a11',
          ttsAsync: true,
          audioFormat: 'wav',
        });
        assert.equal(second.response.status, 202);
        assert.equal(second.json.worker, 'local-gpu');

        const busyClaim = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'test-worker-2' }, {
          authorization: 'Bearer test-local-gpu-worker-token',
        });
        assert.equal(busyClaim.response.status, 200);
        assert.equal(busyClaim.json.job, null);
        assert.equal(busyClaim.json.backpressure, true);
        assert.equal(busyClaim.json.reason, 'local_gpu_worker_busy');
        assert.equal(busyClaim.json.queueDepth, 1);
        assert.equal(busyClaim.json.leased, 1);

        const queueStatus = await fetch(baseUrl + '/api/tts/queue/status');
        const queueJson = await queueStatus.json();
        assert.equal(queueStatus.status, 200);
        assert.equal(queueJson.ok, true);
        assert.equal(queueJson.localGpu.queued, 1);
        assert.equal(queueJson.localGpu.leased, 1);
        assert.equal(queueJson.localGpu.maxActive, 1);
        assert.equal(queueJson.xttsRvc.concurrency, 1);

        const completed = await postJson(baseUrl, `/api/tts/local-worker/jobs/${started.json.jobId}/complete`, {
          workerId: 'test-worker',
          audioBase64: wav.toString('base64'),
          contentType: 'audio/wav',
          engine: 'test-local-gpu',
          voiceStyle: 'a11-official-stern-french',
        }, {
          authorization: 'Bearer test-local-gpu-worker-token',
        });

        assert.equal(completed.response.status, 200);
        assert.equal(completed.json.state, 'done');
        assert.equal(completed.json.result.via, 'local-gpu-worker');
        assert.equal(completed.json.result.provider, 'xtts-rvc');
        assert.match(completed.json.audioUrl, /^\/api\/tts\/out\/tts-out-\d+-local-gpu-xtts-rvc\.wav$/);

        const claimedSecond = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'test-worker' }, {
          authorization: 'Bearer test-local-gpu-worker-token',
        });
        assert.equal(claimedSecond.response.status, 200);
        assert.equal(claimedSecond.json.job.id, second.json.jobId);

        const completedSecond = await postJson(baseUrl, `/api/tts/local-worker/jobs/${second.json.jobId}/complete`, {
          workerId: 'test-worker',
          audioBase64: wav.toString('base64'),
          contentType: 'audio/wav',
          engine: 'test-local-gpu',
          voiceStyle: 'a11-official-stern-french',
        }, {
          authorization: 'Bearer test-local-gpu-worker-token',
        });
        assert.equal(completedSecond.response.status, 200);
        assert.equal(completedSecond.json.state, 'done');
      }
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts local GPU worker claims admin, family, then public jobs by priority', async () => {
  const previousEnv = {
    A11_TTS_LOCAL_GPU_WORKER_ENABLED: process.env.A11_TTS_LOCAL_GPU_WORKER_ENABLED,
    A11_LOCAL_GPU_WORKER_ENABLED: process.env.A11_LOCAL_GPU_WORKER_ENABLED,
    A11_LOCAL_GPU_WORKER_TOKEN: process.env.A11_LOCAL_GPU_WORKER_TOKEN,
    A11_TTS_LOCAL_WORKER_TOKEN: process.env.A11_TTS_LOCAL_WORKER_TOKEN,
    A11_LOCAL_GPU_WORKER_TOKEN_FILE: process.env.A11_LOCAL_GPU_WORKER_TOKEN_FILE,
    A11_TTS_LOCAL_WORKER_TOKEN_FILE: process.env.A11_TTS_LOCAL_WORKER_TOKEN_FILE,
    A11_LOCAL_GPU_WORKER_MAX_ACTIVE: process.env.A11_LOCAL_GPU_WORKER_MAX_ACTIVE,
  };
  const wav = createPcm16Wav();

  process.env.A11_TTS_LOCAL_GPU_WORKER_ENABLED = '1';
  delete process.env.A11_LOCAL_GPU_WORKER_ENABLED;
  process.env.A11_LOCAL_GPU_WORKER_TOKEN = 'test-priority-worker-token';
  process.env.A11_LOCAL_GPU_WORKER_MAX_ACTIVE = '3';
  delete process.env.A11_TTS_LOCAL_WORKER_TOKEN;
  delete process.env.A11_LOCAL_GPU_WORKER_TOKEN_FILE;
  delete process.env.A11_TTS_LOCAL_WORKER_TOKEN_FILE;

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use((req, _res, next) => {
          if (req.headers['x-test-user'] === 'admin') req.user = { role: 'admin', fullAccess: true };
          next();
        });
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const publicJob = await postJson(baseUrl, '/api/tts/speak', {
          text: 'public job',
          persona: 'a11',
          ttsAsync: true,
          audioFormat: 'wav',
        });
        const familyJob = await postJson(baseUrl, '/api/tts/speak', {
          text: 'family job',
          persona: 'a11',
          ttsAsync: true,
          audioFormat: 'wav',
          priorityTier: 'family',
        });
        const adminJob = await postJson(baseUrl, '/api/tts/speak', {
          text: 'admin job',
          persona: 'a11',
          ttsAsync: true,
          audioFormat: 'wav',
        }, {
          'x-test-user': 'admin',
        });

        assert.equal(publicJob.response.status, 202);
        assert.equal(publicJob.json.priorityTier, 'public');
        assert.equal(familyJob.response.status, 202);
        assert.equal(familyJob.json.priorityTier, 'family');
        assert.equal(adminJob.response.status, 202);
        assert.equal(adminJob.json.priorityTier, 'admin');

        const headers = { authorization: 'Bearer test-priority-worker-token' };
        const first = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'priority-worker' }, headers);
        const second = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'priority-worker' }, headers);
        const third = await postJson(baseUrl, '/api/tts/local-worker/claim', { workerId: 'priority-worker' }, headers);

        assert.equal(first.response.status, 200);
        assert.equal(first.json.job.id, adminJob.json.jobId);
        assert.equal(first.json.job.priorityTier, 'admin');
        assert.equal(second.json.job.id, familyJob.json.jobId);
        assert.equal(second.json.job.priorityTier, 'family');
        assert.equal(third.json.job.id, publicJob.json.jobId);
        assert.equal(third.json.job.priorityTier, 'public');

        for (const jobId of [adminJob.json.jobId, familyJob.json.jobId, publicJob.json.jobId]) {
          const completed = await postJson(baseUrl, `/api/tts/local-worker/jobs/${jobId}/complete`, {
            workerId: 'priority-worker',
            audioBase64: wav.toString('base64'),
            contentType: 'audio/wav',
            engine: 'test-local-gpu',
          }, headers);
          assert.equal(completed.response.status, 200);
          assert.equal(completed.json.state, 'done');
        }
      }
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('vivy jobs route exposes a Bat/Rome async official TTS job with web audio output', async () => {
  const previousEnv = {
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
    A11_CARTESIA_BASE_URL: process.env.A11_CARTESIA_BASE_URL,
    A11_CARTESIA_VERSION: process.env.A11_CARTESIA_VERSION,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
  };
  const previousFetch = global.fetch;
  const cartesiaBodies = [];

  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
  process.env.A11_CARTESIA_BASE_URL = 'https://api.cartesia.test';
  process.env.A11_CARTESIA_VERSION = '2026-03-01';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.cartesia.test/tts/bytes') {
      cartesiaBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('cartesia-mp3');
        },
      };
    }
    if (value === 'http://voice-bridge.test/api/voice/synthesize') {
      throw new Error('legacy_xtts_rvc_should_not_run_for_vivy_official_job');
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      throw new Error('neutral_tts_should_not_run_for_vivy_job');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const started = await postJson(baseUrl, '/api/vivy/jobs', {
          prompt: 'Chante une phrase courte pour Vivy.',
          song: true,
        });

        assert.equal(started.response.status, 202);
        assert.equal(started.json.async, true);
        assert.equal(started.json.kind, 'vivy.song.official-tts');
        assert.equal(started.json.queue, 'media.audio');
        assert.match(started.json.statusUrl, /^\/api\/vivy\/jobs\//);
        assert.equal(started.json.orchestrator.mode, 'bat-rome');
        assert.equal(started.json.formats.output, 'mp3');
        assert.deepEqual(started.json.formats.acceptedInput, ['wav', 'mp3', 'm4a', 'mov']);

        let polled = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const response = await fetch(baseUrl + started.json.statusUrl);
          polled = await response.json();
          if (polled.state === 'done' || polled.state === 'failed') break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        assert.equal(polled.state, 'done');
        assert.equal(polled.provider, 'cartesia');
        assert.match(polled.audioUrl, /^\/api\/tts\/out\/tts-out-\d+-cartesia\.mp3$/);
        assert.equal(cartesiaBodies.length, 1);
        assert.equal(cartesiaBodies[0].language, 'fr');
        assert.equal(cartesiaBodies[0].output_format.container, 'mp3');
        assert.equal(cartesiaBodies[0].voice.mode, 'id');
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts piper route leaves voice free unless language voice is explicitly forced', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const requestBodies = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'http://a11-voice:5002/api/tts') {
      requestBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: '/out/italian-voice.wav',
            via: 'piper',
          });
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', {
          text: 'ciao A11',
          language: 'it',
        });

        assert.equal(result.response.status, 200);
        assert.equal(requestBodies.length, 1);
        assert.equal(requestBodies[0].voice, '');
        assert.equal(requestBodies[0].model, undefined);

        await postJson(baseUrl, '/api/tts/piper', {
          text: 'ciao A11',
          language: 'it',
          forceLanguageVoice: true,
        });

        assert.equal(requestBodies.length, 2);
        assert.equal(requestBodies[1].voice, 'it_IT-paola-medium');
        assert.equal(requestBodies[1].model, 'it_IT-paola-medium');
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts piper route selects persona-specific local Piper voice when cloud TTS is unavailable', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    A11_CARTESIA_TTS_DISABLED: process.env.A11_CARTESIA_TTS_DISABLED,
    A11_AZURE_TTS_DISABLED: process.env.A11_AZURE_TTS_DISABLED,
    A11_OPENAI_TTS_DISABLED: process.env.A11_OPENAI_TTS_DISABLED,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const requestBodies = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  process.env.A11_CARTESIA_TTS_DISABLED = '1';
  process.env.A11_AZURE_TTS_DISABLED = '1';
  process.env.A11_OPENAI_TTS_DISABLED = '1';
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'http://a11-voice:5002/api/tts') {
      requestBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: '/out/a11-upmc.wav',
            via: 'piper',
          });
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', {
          text: 'bonjour A11',
          persona: 'a11',
          voicePersona: 'a11',
          provider: 'piper',
        });

        assert.equal(result.response.status, 200);
        assert.equal(requestBodies.length, 1);
        assert.equal(requestBodies[0].voice, 'fr_FR-upmc-medium');
        assert.equal(requestBodies[0].model, 'fr_FR-upmc-medium');
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts speak route uses Cartesia ready-made voice before legacy bridge for official persona voice', async () => {
  const previousEnv = {
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_VOICE_XTTS_RVC_RETRIES: process.env.A11_VOICE_XTTS_RVC_RETRIES,
    A11_VOICE_XTTS_RVC_RETRY_DELAY_MS: process.env.A11_VOICE_XTTS_RVC_RETRY_DELAY_MS,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
    A11_CARTESIA_BASE_URL: process.env.A11_CARTESIA_BASE_URL,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const bridgeCalls = [];
  const cartesiaBodies = [];

  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
  process.env.A11_CARTESIA_BASE_URL = 'https://api.cartesia.test';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.cartesia.test/tts/bytes') {
      cartesiaBodies.push(JSON.parse(String(options.body || '{}')));
      assert.equal(options.method, 'POST');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('cartesia-a11-mp3');
        },
      };
    }
    if (value === 'http://voice-bridge.test/api/voice/convert') {
      bridgeCalls.push({ url: value, body: options.body });
      throw new Error('legacy_bridge_should_not_be_called_when_cartesia_is_ready');
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      throw new Error('piper_http_should_not_be_called_for_official_voice');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'bonjour',
          persona: 'a11',
          voicePersona: 'a11',
          vocalMode: 'adaptive',
          useDefaultVoiceReference: true,
          voiceReferenceRequired: true,
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'cartesia');
        assert.equal(result.json.via, 'cartesia-tts');
        assert.equal(result.json.providerCapabilities.readyMadeVoice, true);
        assert.match(result.json.voiceReference.label, /Stern French Man/i);
        assert.match(result.json.audio_url, /^\/api\/tts\/out\/tts-out-\d+-cartesia\.mp3$/);
        assert.equal(cartesiaBodies.length, 1);
        assert.equal(cartesiaBodies[0].voice.id, '0418348a-0ca2-4e90-9986-800fb8b3bbc0');
        assert.equal(bridgeCalls.length, 0);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts speak route treats official persona alone as identity voice request', async () => {
  const previousEnv = {
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
    A11_CARTESIA_BASE_URL: process.env.A11_CARTESIA_BASE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
  };
  const previousFetch = global.fetch;
  const bridgeCalls = [];
  const cartesiaBodies = [];

  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
  process.env.A11_CARTESIA_BASE_URL = 'https://api.cartesia.test';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.cartesia.test/tts/bytes') {
      cartesiaBodies.push(JSON.parse(String(options.body || '{}')));
      assert.equal(options.method, 'POST');
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('cartesia-kaen44-mp3');
        },
      };
    }
    if (value === 'http://voice-bridge.test/api/voice/convert') {
      bridgeCalls.push({ url: value, body: options.body });
      throw new Error('legacy_bridge_should_not_be_called_for_official_persona_default');
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      throw new Error('piper_http_should_not_be_called_for_official_persona_default');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'bonjour kaen',
          persona: 'kaen44',
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'cartesia');
        assert.equal(result.json.via, 'cartesia-tts');
        assert.equal(result.json.providerCapabilities.readyMadeVoice, true);
        assert.match(result.json.voiceReference.label, /French Narrator Lady/i);
        assert.equal(cartesiaBodies.length, 1);
        assert.equal(cartesiaBodies[0].voice.id, '8832a0b5-47b2-4751-bb22-6a8e2149303d');
        assert.equal(bridgeCalls.length, 0);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts speak route keeps Vivy official tests on Cartesia and away from XTTS/RVC', async () => {
  const previousEnv = {
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
    A11_CARTESIA_BASE_URL: process.env.A11_CARTESIA_BASE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
  };
  const previousFetch = global.fetch;
  const cartesiaBodies = [];

  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
  process.env.A11_CARTESIA_BASE_URL = 'https://api.cartesia.test';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.cartesia.test/tts/bytes') {
      cartesiaBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('cartesia-vivy-mp3');
        },
      };
    }
    if (value === 'http://voice-bridge.test/api/voice/convert'
      || value === 'http://voice-bridge.test/api/voice/synthesize') {
      throw new Error('legacy_xtts_rvc_should_not_run_for_vivy_official_test');
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      throw new Error('piper_http_should_not_run_for_vivy_official_test');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'Je suis Vivy. Ma voix officielle est prête.',
          voice: 'vivy',
          persona: 'vivy',
          voicePersona: 'vivy',
          surface: 'vivy',
          provider: 'cartesia',
          ttsProvider: 'cartesia',
          useDefaultVoiceReference: true,
          defaultVoiceReference: true,
          voiceReferenceRequired: true,
          referenceVoiceRequired: true,
          voiceConversion: false,
          allowRvc: false,
          audioFormat: 'mp3',
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'cartesia');
        assert.equal(result.json.via, 'cartesia-tts');
        assert.match(result.json.voiceReference.label, /French Conversational Lady/i);
        assert.match(result.json.audio_url, /^\/api\/tts\/out\/tts-out-\d+-cartesia\.mp3$/);
        assert.equal(cartesiaBodies.length, 1);
        assert.equal(cartesiaBodies[0].voice.id, 'a249eaff-1e96-4d2c-b23b-12efa4f66f41');
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts async Vivy official Cartesia jobs bypass the local GPU worker', async () => {
  const previousEnv = {
    A11_TTS_LOCAL_GPU_WORKER_ENABLED: process.env.A11_TTS_LOCAL_GPU_WORKER_ENABLED,
    A11_LOCAL_GPU_WORKER_TOKEN: process.env.A11_LOCAL_GPU_WORKER_TOKEN,
    A11_LOCAL_GPU_WORKER_MAX_ACTIVE: process.env.A11_LOCAL_GPU_WORKER_MAX_ACTIVE,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
    A11_CARTESIA_BASE_URL: process.env.A11_CARTESIA_BASE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
  };
  const previousFetch = global.fetch;
  const cartesiaBodies = [];

  process.env.A11_TTS_LOCAL_GPU_WORKER_ENABLED = '1';
  process.env.A11_LOCAL_GPU_WORKER_TOKEN = 'test-local-gpu-worker-token';
  process.env.A11_LOCAL_GPU_WORKER_MAX_ACTIVE = '1';
  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
  process.env.A11_CARTESIA_BASE_URL = 'https://api.cartesia.test';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.cartesia.test/tts/bytes') {
      cartesiaBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('cartesia-vivy-async-mp3');
        },
      };
    }
    if (value === 'http://voice-bridge.test/api/voice/convert'
      || value === 'http://voice-bridge.test/api/voice/synthesize') {
      throw new Error('local_gpu_or_xtts_rvc_should_not_run_for_vivy_cartesia_async');
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      throw new Error('piper_http_should_not_run_for_vivy_cartesia_async');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const started = await postJson(baseUrl, '/api/tts/speak', {
          text: 'Je suis Vivy. Ma voix officielle est prête.',
          voice: 'vivy',
          persona: 'vivy',
          voicePersona: 'vivy',
          surface: 'vivy',
          provider: 'cartesia',
          ttsProvider: 'cartesia',
          ttsAsync: true,
          useDefaultVoiceReference: true,
          defaultVoiceReference: true,
          voiceReferenceRequired: true,
          referenceVoiceRequired: true,
          voiceConversion: false,
          allowRvc: false,
          audioFormat: 'mp3',
        });

        assert.equal(started.response.status, 202);
        assert.equal(started.json.worker, 'server');

        let polled = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const response = await fetch(baseUrl + started.json.statusUrl);
          polled = await response.json();
          if (polled.state === 'done' || polled.state === 'failed') break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        assert.equal(polled.state, 'done');
        assert.equal(polled.provider, 'cartesia');
        assert.match(polled.audioUrl, /^\/api\/tts\/out\/tts-out-\d+-cartesia\.mp3$/);
        assert.equal(cartesiaBodies.length, 1);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts speak route ignores stale Piper preference for official reference voices', async () => {
  const previousEnv = {
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_API_KEY: process.env.A11_CARTESIA_API_KEY,
    A11_CARTESIA_BASE_URL: process.env.A11_CARTESIA_BASE_URL,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const bridgeCalls = [];
  const cartesiaBodies = [];

  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_API_KEY = 'test-cartesia-key';
  process.env.A11_CARTESIA_BASE_URL = 'https://api.cartesia.test';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.cartesia.test/tts/bytes') {
      cartesiaBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('cartesia-a11-mp3');
        },
      };
    }
    if (value === 'http://voice-bridge.test/api/voice/convert') {
      bridgeCalls.push({ url: value, body: options.body });
      throw new Error('legacy_bridge_should_not_be_called_for_stale_official_voice_preference');
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      throw new Error('piper_http_should_not_be_called_for_stale_official_voice_preference');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'bonjour',
          persona: 'a11',
          voicePersona: 'a11',
          vocalMode: 'adaptive',
          provider: 'piper',
          ttsProvider: 'piper',
          useDefaultVoiceReference: true,
          voiceReferenceRequired: true,
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'cartesia');
        assert.equal(result.json.via, 'cartesia-tts');
        assert.equal(result.json.providerCapabilities.readyMadeVoice, true);
        assert.match(result.json.voiceReference.label, /Stern French Man/i);
        assert.equal(cartesiaBodies.length, 1);
        assert.equal(cartesiaBodies[0].voice.id, '0418348a-0ca2-4e90-9986-800fb8b3bbc0');
        assert.equal(bridgeCalls.length, 0);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts speak route uses ready-made OpenAI style when cloud voices are unavailable', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-openai-identity-fallback-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_TTS_DISABLED: process.env.A11_CARTESIA_TTS_DISABLED,
    A11_AZURE_TTS_DISABLED: process.env.A11_AZURE_TTS_DISABLED,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    OPENAI_TTS_API_KEY: process.env.OPENAI_TTS_API_KEY,
    A11_OPENAI_TTS_API_KEY: process.env.A11_OPENAI_TTS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_TTS_BASE_URL: process.env.OPENAI_TTS_BASE_URL,
    A11_OPENAI_TTS_FIRST: process.env.A11_OPENAI_TTS_FIRST,
    OPENAI_TTS_FIRST: process.env.OPENAI_TTS_FIRST,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();
  const openAiBodies = [];
  const bridgeCalls = [];
  const remoteTtsCalls = [];

  fs.mkdirSync(path.join(runtimeRoot, 'voice-library'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'voice-library', 'kaen44-official-french-narrator.wav'), createPcm16Wav({ frequency: 330 }));
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  process.env.A11_VOICE_CONVERSION_ENABLED = 'false';
  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_VOICE_XTTS_RVC_RETRIES = '2';
  process.env.A11_VOICE_XTTS_RVC_RETRY_DELAY_MS = '1';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_TTS_DISABLED = '1';
  process.env.A11_AZURE_TTS_DISABLED = '1';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;
  process.env.OPENAI_TTS_API_KEY = 'test-openai-tts-key';
  delete process.env.A11_OPENAI_TTS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.A11_OPENAI_API_KEY;
  process.env.OPENAI_TTS_BASE_URL = 'https://api.openai.test/v1';
  delete process.env.A11_OPENAI_TTS_FIRST;
  delete process.env.OPENAI_TTS_FIRST;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'http://voice-bridge.test/api/voice/convert') {
      bridgeCalls.push(value);
      return {
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        async text() {
          return JSON.stringify({ ok: false, error: 'bridge_down' });
        },
      };
    }
    if (value === 'https://api.openai.test/v1/audio/speech') {
      openAiBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return wav;
        },
      };
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      remoteTtsCalls.push(value);
      throw new Error('piper_http_should_not_be_called_for_official_openai_fallback');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'bonjour Jeffrey',
          persona: 'kaen44',
          voicePersona: 'kaen44',
          vocalMode: 'adaptive',
          useDefaultVoiceReference: true,
          voiceReferenceRequired: true,
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'openai');
        assert.equal(result.json.providerCapabilities.referenceVoice, true);
        assert.equal(result.json.referenceVoiceFallback, true);
        assert.match(result.json.voiceReference.label, /kaen44-official-french-narrator/i);
        assert.equal(bridgeCalls.length, 0);
        assert.equal(openAiBodies.length, 1);
        assert.match(openAiBodies[0].instructions, /Voix Kaen44/i);
        assert.equal(remoteTtsCalls.length, 0);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('tts speak route uses low-latency OpenAI MP3 and skips slow XTTS/RVC bridge for interactive playback', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-interactive-mp3-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_TTS_DISABLED: process.env.A11_CARTESIA_TTS_DISABLED,
    A11_AZURE_TTS_DISABLED: process.env.A11_AZURE_TTS_DISABLED,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    OPENAI_TTS_API_KEY: process.env.OPENAI_TTS_API_KEY,
    A11_OPENAI_TTS_API_KEY: process.env.A11_OPENAI_TTS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_TTS_BASE_URL: process.env.OPENAI_TTS_BASE_URL,
    OPENAI_TTS_RESPONSE_FORMAT: process.env.OPENAI_TTS_RESPONSE_FORMAT,
    A11_TTS_RESPONSE_FORMAT: process.env.A11_TTS_RESPONSE_FORMAT,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const openAiBodies = [];
  const bridgeCalls = [];

  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  process.env.A11_VOICE_CONVERSION_ENABLED = 'true';
  process.env.A11_VOICE_XTTS_RVC_URL = 'http://voice-bridge.test';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_TTS_DISABLED = '1';
  process.env.A11_AZURE_TTS_DISABLED = '1';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_XTTS_RVC_URL;
  process.env.OPENAI_TTS_API_KEY = 'test-openai-tts-key';
  delete process.env.A11_OPENAI_TTS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.A11_OPENAI_API_KEY;
  process.env.OPENAI_TTS_BASE_URL = 'https://api.openai.test/v1';
  delete process.env.OPENAI_TTS_RESPONSE_FORMAT;
  delete process.env.A11_TTS_RESPONSE_FORMAT;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'http://voice-bridge.test/api/voice/convert') {
      bridgeCalls.push(value);
      throw new Error('interactive_tts_should_skip_bridge');
    }
    if (value === 'https://api.openai.test/v1/audio/speech') {
      openAiBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('mp3-audio');
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'test interactif A11',
          persona: 'a11',
          voicePersona: 'a11',
          vocalMode: 'adaptive',
          latencyMode: 'interactive',
          audioFormat: 'mp3',
          voiceConversion: false,
          useDefaultVoiceReference: true,
          voiceReferenceRequired: true,
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'openai');
        assert.equal(result.json.audioFormat, 'mp3');
        assert.match(result.json.audio_url, /\.mp3$/);
        assert.equal(result.json.providerCapabilities.referenceVoice, true);
        assert.equal(result.json.referenceVoiceFallback, true);
        assert.equal(result.json.voiceReference.scope, 'interactive-style');
        assert.equal(result.json.voiceConversion, undefined);
        assert.equal(bridgeCalls.length, 0);
        assert.equal(openAiBodies.length, 1);
        assert.equal(openAiBodies[0].response_format, 'mp3');
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('tts speak route keeps trying voice module when OpenAI identity fallback is rate-limited', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-openai-rate-limited-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    A11_CARTESIA_TTS_DISABLED: process.env.A11_CARTESIA_TTS_DISABLED,
    A11_AZURE_TTS_DISABLED: process.env.A11_AZURE_TTS_DISABLED,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    OPENAI_TTS_API_KEY: process.env.OPENAI_TTS_API_KEY,
    A11_OPENAI_TTS_API_KEY: process.env.A11_OPENAI_TTS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_TTS_BASE_URL: process.env.OPENAI_TTS_BASE_URL,
    A11_OPENAI_TTS_FIRST: process.env.A11_OPENAI_TTS_FIRST,
    OPENAI_TTS_FIRST: process.env.OPENAI_TTS_FIRST,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();
  const calls = [];

  fs.mkdirSync(path.join(runtimeRoot, 'voice-library'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'voice-library', 'kaen44-official-french-narrator.wav'), createPcm16Wav({ frequency: 330 }));
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  process.env.A11_VOICE_CONVERSION_ENABLED = 'true';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.A11_CARTESIA_TTS_DISABLED = '1';
  process.env.A11_AZURE_TTS_DISABLED = '1';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_VOICE_XTTS_RVC_URL;
  delete process.env.A11_XTTS_RVC_URL;
  process.env.OPENAI_TTS_API_KEY = 'test-openai-tts-key';
  delete process.env.A11_OPENAI_TTS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.A11_OPENAI_API_KEY;
  process.env.OPENAI_TTS_BASE_URL = 'https://api.openai.test/v1';
  delete process.env.A11_OPENAI_TTS_FIRST;
  delete process.env.OPENAI_TTS_FIRST;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (value === 'https://api.openai.test/v1/audio/speech') {
      return {
        ok: false,
        status: 429,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
        async text() {
          return JSON.stringify({ error: { message: 'rate limited' } });
        },
      };
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: '/out/source.wav',
            audioUrl: '/out/source.wav',
            via: 'piper',
          });
        },
      };
    }
    if (value === 'http://a11-voice:5002/api/voice/convert') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body?.get?.('persona'), 'kaen44');
      assert.equal(options.body?.get?.('voiceStyle'), 'kaen44-official-french-narrator');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            audio_url: '/out/converted.wav',
            provider: 'xtts-rvc',
            engine: 'xtts-rvc-api',
            voiceStyle: 'kaen44-official-french-narrator',
            attemptedEngines: ['xtts-rvc'],
            module: 'a11-voice-module',
          });
        },
      };
    }
    if (value.startsWith('http://a11-voice:5002/out/source.wav') || value.startsWith('http://a11-voice:5002/out/converted.wav')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'audio/wav' },
        async arrayBuffer() {
          return wav;
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/speak', {
          text: 'bonjour Jeffrey',
          persona: 'kaen44',
          voicePersona: 'kaen44',
          vocalMode: 'adaptive',
          useDefaultVoiceReference: true,
          voiceReferenceRequired: true,
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.provider, 'xtts-rvc');
        assert.equal(result.json.voiceConversion.ok, true);
        assert.equal(result.json.voiceConversion.voiceStyle, 'kaen44-official-french-narrator');
        assert.ok(calls.filter((call) => call === 'https://api.openai.test/v1/audio/speech').length >= 1);
        assert.equal(calls.filter((call) => call === 'http://a11-voice:5002/api/voice/convert').length, 1);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('tts piper route respects OpenAI-first voice persona before HTTP module', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-openai-first-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    OPENAI_TTS_API_KEY: process.env.OPENAI_TTS_API_KEY,
    A11_OPENAI_TTS_API_KEY: process.env.A11_OPENAI_TTS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_TTS_BASE_URL: process.env.OPENAI_TTS_BASE_URL,
    A11_OPENAI_TTS_FIRST: process.env.A11_OPENAI_TTS_FIRST,
    OPENAI_TTS_FIRST: process.env.OPENAI_TTS_FIRST,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();
  const openAiBodies = [];
  const remoteTtsCalls = [];

  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  process.env.A11_VOICE_CONVERSION_ENABLED = 'false';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_VOICE_XTTS_RVC_URL;
  delete process.env.A11_XTTS_RVC_URL;
  process.env.OPENAI_TTS_API_KEY = 'test-openai-tts-key';
  delete process.env.A11_OPENAI_TTS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.A11_OPENAI_API_KEY;
  process.env.OPENAI_TTS_BASE_URL = 'https://api.openai.test/v1';
  delete process.env.A11_OPENAI_TTS_FIRST;
  delete process.env.OPENAI_TTS_FIRST;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.openai.test/v1/audio/speech') {
      openAiBodies.push(JSON.parse(String(options.body || '{}')));
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return wav;
        },
      };
    }
    if (value === 'http://a11-voice:5002/api/tts') {
      remoteTtsCalls.push(value);
      throw new Error('http_tts_should_not_be_called_first');
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', {
          text: 'Vivy chante une ligne douce',
          vocalMode: 'sing',
          persona: 'vivy',
          provider: 'openai',
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.via, 'openai-tts');
        assert.equal(result.json.provider, 'openai');
        assert.equal(result.json.persona, 'vivy');
        assert.equal(openAiBodies.length, 1);
        assert.match(openAiBodies[0].instructions, /Voix Vivy/i);
        assert.equal(remoteTtsCalls.length, 0);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('tts piper route blocks raw OpenAI audio for non-official voices when a reference voice is required', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-openai-reference-required-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    OPENAI_TTS_API_KEY: process.env.OPENAI_TTS_API_KEY,
    A11_OPENAI_TTS_API_KEY: process.env.A11_OPENAI_TTS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_TTS_BASE_URL: process.env.OPENAI_TTS_BASE_URL,
    A11_OPENAI_TTS_FIRST: process.env.A11_OPENAI_TTS_FIRST,
    OPENAI_TTS_FIRST: process.env.OPENAI_TTS_FIRST,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();

  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED = '1';
  process.env.A11_VOICE_CONVERSION_ENABLED = 'false';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.A11_VOICE_XTTS_RVC_URL;
  delete process.env.A11_XTTS_RVC_URL;
  process.env.OPENAI_TTS_API_KEY = 'test-openai-tts-key';
  delete process.env.A11_OPENAI_TTS_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.A11_OPENAI_API_KEY;
  process.env.OPENAI_TTS_BASE_URL = 'https://api.openai.test/v1';
  delete process.env.A11_OPENAI_TTS_FIRST;
  delete process.env.OPENAI_TTS_FIRST;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://api.openai.test/v1/audio/speech') {
      assert.ok(JSON.parse(String(options.body || '{}')).input);
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return wav;
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', {
          text: 'voix non officielle',
          persona: 'custom-voice',
          voicePersona: 'custom-voice',
          provider: 'openai',
          vocalMode: 'adaptive',
          useDefaultVoiceReference: true,
          voiceReferenceRequired: true,
        });

        assert.equal(result.response.status, 424);
        assert.equal(result.json.error, 'voice_reference_tts_unavailable');
        assert.equal(result.json.provider, 'openai');
        assert.equal(result.json.voiceConversion, null);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('tts piper route can stream a generated audio asset and consume it', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();
  const ttsAssetCalls = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'http://a11-voice:5002/api/tts') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: '/out/streamed.wav',
            via: 'piper',
          });
        },
      };
    }
    if (String(url).startsWith('http://a11-voice:5002/out/streamed.wav')) {
      ttsAssetCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'audio/wav' },
        async arrayBuffer() {
          return wav;
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/tts/piper`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'bonjour', stream: true }),
        });

        assert.equal(response.status, 200);
        assert.match(String(response.headers.get('content-type') || ''), /audio\/wav/i);
        assert.equal(response.headers.get('x-a11-tts-stream'), 'consumed');
        assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString('ascii'), 'RIFF');
        assert.equal(ttsAssetCalls.at(-1), 'http://a11-voice:5002/out/streamed.wav?consume=1');
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts out proxy fetches loopback TTS assets server-side', async () => {
  const previousEnv = {
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;

  process.env.TTS_URL = 'http://127.0.0.1:5002';
  delete process.env.A11_VOICE_MODULE_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options) => {
    if (!String(url).startsWith('http://127.0.0.1:5002/out/local-voice.wav')) {
      return previousFetch(url, options);
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'audio/wav' : '';
        },
      },
      async arrayBuffer() {
        return Buffer.from('RIFFfake-wave').buffer;
      },
    };
  };

  try {
    await withServer(
      (app) => {
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/tts/out/local-voice.wav`);
        assert.equal(response.status, 200);
        assert.match(String(response.headers.get('content-type') || ''), /audio\/wav/i);
        assert.equal(Buffer.from(await response.arrayBuffer()).toString().includes('RIFFfake-wave'), true);
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tts out local generated assets survive repeated browser reads', async () => {
  const publicTtsDir = path.resolve(__dirname, '..', '..', '..', 'public', 'tts');
  const filename = `tts-out-test-${process.pid}-${Date.now()}.mp3`;
  const filePath = path.join(publicTtsDir, filename);
  fs.mkdirSync(publicTtsDir, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('ID3fake-mp3'));

  try {
    await withServer(
      (app) => {
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/tts/out/${filename}`);
        assert.equal(first.status, 200);
        assert.match(String(first.headers.get('content-type') || ''), /audio\/mpeg/i);
        assert.equal(Buffer.from(await first.arrayBuffer()).toString(), 'ID3fake-mp3');
        assert.equal(fs.existsSync(filePath), true);

        const second = await fetch(`${baseUrl}/api/tts/out/${filename}`);
        assert.equal(second.status, 200);
        assert.equal(Buffer.from(await second.arrayBuffer()).toString(), 'ID3fake-mp3');
      }
    );
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('tts route can run generated audio through the voice conversion module', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-conversion-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_XTTS_RVC_URL: process.env.A11_VOICE_XTTS_RVC_URL,
    A11_XTTS_RVC_URL: process.env.A11_XTTS_RVC_URL,
    A11_LOCAL_XTTS_RVC_AUTODETECT: process.env.A11_LOCAL_XTTS_RVC_AUTODETECT,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();
  const backendCalls = [];

  fs.mkdirSync(path.join(runtimeRoot, 'voice-library'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'voice-library', 'a11-official-stern-french.wav'), createPcm16Wav({ frequency: 220 }));
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  process.env.A11_VOICE_CONVERSION_ENABLED = 'true';
  process.env.A11_LOCAL_XTTS_RVC_AUTODETECT = '0';
  delete process.env.A11_VOICE_XTTS_RVC_URL;
  delete process.env.A11_XTTS_RVC_URL;
  delete process.env.TTS_URL;
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options = {}) => {
    backendCalls.push({ url: String(url), method: options?.method || 'GET' });
    if (String(url) === 'http://a11-voice:5002/api/tts') {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            audio_url: '/out/source.wav',
            audioUrl: '/out/source.wav',
            via: 'piper',
          });
        },
      };
    }
    if (String(url) === 'http://a11-voice:5002/api/voice/convert') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body?.get?.('text'), 'bonjour');
      assert.equal(options.body?.get?.('mode'), 'adaptive');
      assert.equal(options.body?.get?.('voiceStyle'), 'a11-official-stern-french');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            audio_url: '/out/converted.wav',
            provider: 'xtts-rvc',
            engine: 'xtts-rvc-api',
            voiceStyle: 'a11-official-stern-french',
            attemptedEngines: ['xtts-rvc'],
            module: 'a11-voice-module',
            duration_ms: 120,
          });
        },
      };
    }
    if (String(url).startsWith('http://a11-voice:5002/out/source.wav') || String(url).startsWith('http://a11-voice:5002/out/converted.wav')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'audio/wav' },
        async arrayBuffer() {
          return wav;
        },
      };
    }
    return previousFetch(url, options);
  };

  try {
    await withServer(
      (app) => {
        app.use(express.json());
        app.use('/api', ttsRouter);
      },
      async (baseUrl) => {
        const result = await postJson(baseUrl, '/api/tts/piper', {
          text: 'bonjour',
          vocalMode: 'adaptive',
          provider: 'piper',
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.audio_url, '/api/tts/out/converted.wav');
        assert.equal(result.json.originalAudioUrl, '/api/tts/out/source.wav');
        assert.equal(result.json.voiceConversion.ok, true);
        assert.equal(result.json.voiceConversion.provider, 'xtts-rvc');
        assert.equal(result.json.voiceConversion.engine, 'xtts-rvc-api');
        assert.equal(result.json.voiceConversion.voiceStyle, 'a11-official-stern-french');
        assert.deepEqual(result.json.voiceConversion.attemptedEngines, ['xtts-rvc']);
        assert.match(result.json.audioModule.reference.label, /A11 Official Stern French/i);
        assert.equal(
          backendCalls.filter((call) => call.url === 'http://a11-voice:5002/api/voice/convert').length,
          1
        );
        assert.equal(
          backendCalls.some((call) => call.url === 'http://a11-voice:5002/out/source.wav?consume=1'),
          true
        );
      }
    );
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

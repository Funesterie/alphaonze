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

test('tts piper route respects OpenAI-first voice persona before HTTP module', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-openai-first-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
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
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
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

test('tts route can run generated audio through the voice conversion module', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-tts-conversion-'));
  const previousEnv = {
    A11_RUNTIME_ROOT: process.env.A11_RUNTIME_ROOT,
    A11_VOICE_REFERENCE_DIR: process.env.A11_VOICE_REFERENCE_DIR,
    A11_VOICE_REFERENCE_LIBRARY_DISABLED: process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED,
    A11_VOICE_MODULE_URL: process.env.A11_VOICE_MODULE_URL,
    A11_VOICE_CONVERSION_ENABLED: process.env.A11_VOICE_CONVERSION_ENABLED,
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const wav = createPcm16Wav();
  const backendCalls = [];

  fs.mkdirSync(path.join(runtimeRoot, 'sfx'), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'sfx', 'terminator.wav'), createPcm16Wav({ frequency: 220 }));
  process.env.A11_RUNTIME_ROOT = runtimeRoot;
  process.env.A11_VOICE_REFERENCE_DIR = path.join(runtimeRoot, 'voice-references');
  delete process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED;
  process.env.ENABLE_PIPER_HTTP = 'true';
  process.env.A11_VOICE_MODULE_URL = 'http://a11-voice:5002';
  process.env.A11_VOICE_CONVERSION_ENABLED = 'true';
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
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ok: true,
            audio_url: '/out/converted.wav',
            provider: 'ffmpeg-morph',
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
        });

        assert.equal(result.response.status, 200);
        assert.equal(result.json.audio_url, '/api/tts/out/converted.wav');
        assert.equal(result.json.originalAudioUrl, '/api/tts/out/source.wav');
        assert.equal(result.json.voiceConversion.ok, true);
        assert.equal(result.json.voiceConversion.provider, 'ffmpeg-morph');
        assert.equal(result.json.audioModule.reference.label, 'Terminator');
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

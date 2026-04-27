const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

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

test('tts piper route rewrites loopback TTS asset URLs to backend proxy paths', async () => {
  const previousEnv = {
    ENABLE_PIPER_HTTP: process.env.ENABLE_PIPER_HTTP,
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;
  const backendCalls = [];

  process.env.ENABLE_PIPER_HTTP = 'true';
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
          host: 'alphaonze.funesterie.pro',
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

test('tts out proxy fetches loopback TTS assets server-side', async () => {
  const previousEnv = {
    TTS_URL: process.env.TTS_URL,
    TTS_HOST: process.env.TTS_HOST,
    TTS_BASE_URL: process.env.TTS_BASE_URL,
    TTS_PUBLIC_BASE_URL: process.env.TTS_PUBLIC_BASE_URL,
  };
  const previousFetch = global.fetch;

  process.env.TTS_URL = 'http://127.0.0.1:5002';
  delete process.env.TTS_HOST;
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_PUBLIC_BASE_URL;

  global.fetch = async (url, options) => {
    if (String(url) !== 'http://127.0.0.1:5002/out/local-voice.wav') {
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

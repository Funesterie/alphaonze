'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  transcribe,
  getSttStatus,
  hasOpenAiSttConfig,
} = require('../lib/stt-service.cjs');

const STT_ENV_KEYS = [
  'A11_STT_PROVIDER',
  'A11_STT_ALLOW_OPENAI_COMPATIBLE',
  'A11_STT_MODEL',
  'A11_STT_FAST_WHISPER_BASE_URL',
  'A11_STT_FAST_WHISPER_ENABLED',
  'A11_STT_FAST_WHISPER_MODEL',
  'A11_STT_FAST_WHISPER_TOKEN',
  'A11_STT_OLLAMA_BASE',
  'A11_STT_OLLAMA_ENABLED',
  'A11_STT_OLLAMA_MODEL',
  'A11_STT_OPENAI_API_KEY',
  'A11_STT_OPENAI_BASE_URL',
  'A11_STT_OPENAI_MODEL',
  'A11_STT_ALLOW_OPENAI_FALLBACK',
  'OLLAMA_BASE',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
];

function withCleanSttEnv(fn) {
  const previous = {};
  for (const key of STT_ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }

  try {
    fn();
  } finally {
    for (const key of STT_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function withCleanSttEnvAsync(fn) {
  const previous = {};
  for (const key of STT_ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }

  try {
    return await fn();
  } finally {
    for (const key of STT_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('STT auto does not treat chat Ollama as Whisper by default', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'auto';
    process.env.OLLAMA_BASE = 'http://a11-ollama:11434';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';

    const status = getSttStatus();

    assert.equal(status.available, false);
    assert.equal(status.provider, 'none');
    assert.equal(status.ollamaConfigured, true);
    assert.equal(status.ollamaEnabled, false);
    assert.equal(status.openaiConfigured, false);
  });
});

test('STT auto uses Ollama only when local Whisper is explicitly enabled', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'auto';
    process.env.A11_STT_OLLAMA_ENABLED = 'true';
    process.env.OLLAMA_BASE = 'http://a11-ollama:11434';

    const status = getSttStatus();

    assert.equal(status.available, true);
    assert.equal(status.provider, 'ollama');
    assert.equal(status.ollamaEnabled, true);
  });
});

test('STT auto prefers faster-whisper only when the local worker is explicitly enabled', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'auto';
    process.env.A11_STT_FAST_WHISPER_BASE_URL = 'http://127.0.0.1:17911';

    let status = getSttStatus();

    assert.equal(status.available, false);
    assert.equal(status.provider, 'none');
    assert.equal(status.fasterWhisperConfigured, true);
    assert.equal(status.fasterWhisperEnabled, false);

    process.env.A11_STT_FAST_WHISPER_ENABLED = 'true';
    status = getSttStatus();

    assert.equal(status.available, true);
    assert.equal(status.provider, 'faster-whisper');
    assert.equal(status.model, 'Systran/faster-whisper-large-v3');
    assert.equal(status.fasterWhisperEnabled, true);
  });
});

test('STT explicit faster-whisper uses the configured local worker and model', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'faster-whisper';
    process.env.A11_STT_FAST_WHISPER_BASE_URL = 'http://127.0.0.1:17911';
    process.env.A11_STT_FAST_WHISPER_MODEL = 'Systran/faster-whisper-large-v3';

    const status = getSttStatus();

    assert.equal(status.available, true);
    assert.equal(status.provider, 'faster-whisper');
    assert.equal(status.model, 'Systran/faster-whisper-large-v3');
    assert.equal(status.fasterWhisperConfigured, true);
  });
});

test('STT explicit OpenAI requires the real OpenAI transcription endpoint unless compatible mode is enabled', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';

    assert.equal(hasOpenAiSttConfig({
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiBaseUrl: process.env.OPENAI_BASE_URL,
      allowOpenAiCompatibleStt: false,
    }), false);

    const status = getSttStatus();

    assert.equal(status.available, false);
    assert.equal(status.provider, 'none');
  });
});

test('STT explicit OpenAI accepts the official OpenAI transcription endpoint', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'openai';
    process.env.A11_STT_OPENAI_API_KEY = 'sk-test';
    process.env.A11_STT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

    const status = getSttStatus();

    assert.equal(status.available, true);
    assert.equal(status.provider, 'openai');
    assert.equal(status.openaiConfigured, true);
  });
});

test('STT auto keeps local Whisper failures local unless OpenAI fallback is explicitly allowed', async () => {
  await withCleanSttEnvAsync(async () => {
    process.env.A11_STT_PROVIDER = 'auto';
    process.env.A11_STT_FAST_WHISPER_ENABLED = 'true';
    process.env.A11_STT_FAST_WHISPER_BASE_URL = 'http://local-whisper';
    process.env.A11_STT_OPENAI_API_KEY = 'sk-test';
    process.env.A11_STT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return new Response('local worker down', { status: 502 });
    };

    try {
      await assert.rejects(
        () => transcribe(Buffer.from([1, 2, 3]), 'audio/webm'),
        /faster-whisper STT error 502/
      );
      assert.deepEqual(calls, ['http://local-whisper/v1/audio/transcriptions']);
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('STT auto can fall back to OpenAI only with explicit fallback opt-in', async () => {
  await withCleanSttEnvAsync(async () => {
    process.env.A11_STT_PROVIDER = 'auto';
    process.env.A11_STT_FAST_WHISPER_ENABLED = 'true';
    process.env.A11_STT_FAST_WHISPER_BASE_URL = 'http://local-whisper';
    process.env.A11_STT_OPENAI_API_KEY = 'sk-test';
    process.env.A11_STT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
    process.env.A11_STT_ALLOW_OPENAI_FALLBACK = 'true';

    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return new Response('local worker down', { status: 502 });
      return new Response(JSON.stringify({ text: 'bonjour a11' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    try {
      const result = await transcribe(Buffer.from([1, 2, 3]), 'audio/webm');
      assert.equal(result.provider, 'openai');
      assert.equal(result.text, 'bonjour a11');
      assert.deepEqual(calls, [
        'http://local-whisper/v1/audio/transcriptions',
        'https://api.openai.com/v1/audio/transcriptions',
      ]);
    } finally {
      global.fetch = previousFetch;
    }
  });
});

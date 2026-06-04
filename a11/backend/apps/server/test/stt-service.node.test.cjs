'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSttStatus,
  hasOpenAiSttConfig,
} = require('../lib/stt-service.cjs');

const STT_ENV_KEYS = [
  'A11_STT_PROVIDER',
  'A11_STT_ALLOW_OPENAI_COMPATIBLE',
  'A11_STT_MODEL',
  'A11_STT_OLLAMA_BASE',
  'A11_STT_OLLAMA_ENABLED',
  'A11_STT_OLLAMA_MODEL',
  'A11_STT_OPENAI_API_KEY',
  'A11_STT_OPENAI_BASE_URL',
  'A11_STT_OPENAI_MODEL',
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

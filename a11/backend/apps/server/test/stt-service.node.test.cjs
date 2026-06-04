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
  'A11_STT_OLLAMA_MODEL',
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

test('STT auto keeps Ollama as priority and does not trust OpenAI-compatible audio endpoints by default', () => {
  withCleanSttEnv(() => {
    process.env.A11_STT_PROVIDER = 'auto';
    process.env.OLLAMA_BASE = 'http://a11-ollama:11434';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';

    const status = getSttStatus();

    assert.equal(status.available, true);
    assert.equal(status.provider, 'ollama');
    assert.equal(status.openaiConfigured, false);
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
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';

    const status = getSttStatus();

    assert.equal(status.available, true);
    assert.equal(status.provider, 'openai');
    assert.equal(status.openaiConfigured, true);
  });
});

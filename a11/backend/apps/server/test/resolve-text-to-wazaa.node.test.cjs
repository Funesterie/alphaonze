const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isLlmEnrichmentEnabled,
  resolveTranslationConfig,
} = require('../src/mask/resolve-text-to-wazaa.cjs');

test('isLlmEnrichmentEnabled ignores generic OPENAI_API_KEY by default', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.A11_TRANSLATION_API_KEY = '';
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = 'sk-generic';

  try {
    assert.equal(isLlmEnrichmentEnabled(), false);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
  }
});

test('isLlmEnrichmentEnabled still supports explicit scoped translation keys', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_API_KEY = 'sk-translation';
  process.env.A11_OPENAI_API_KEY = '';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
  }
});

test('isLlmEnrichmentEnabled supports Cerbere router without OpenAI key', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = 'https://cerbere.funesterie.me';
  process.env.A11_TRANSLATION_API_KEY = '';
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = '';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
  }
});

test('resolveTranslationConfig prefers Cerbere router and does not require Authorization', () => {
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OLLAMA_PRIMARY_MODEL: process.env.A11_OLLAMA_PRIMARY_MODEL,
  };

  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = 'https://cerbere.funesterie.me';
  process.env.A11_TRANSLATION_API_KEY = '';
  process.env.A11_OLLAMA_PRIMARY_MODEL = 'gemma4:e4b';

  try {
    const config = resolveTranslationConfig();
    assert.equal(config.url, 'https://cerbere.funesterie.me/v1/chat/completions');
    assert.equal(config.allowAnonymous, true);
    assert.equal(config.usesRouterLikeBaseUrl, true);
    assert.equal(config.model, 'gemma4:e4b');
    assert.equal(config.isConfigured, true);
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OLLAMA_PRIMARY_MODEL = previous.A11_OLLAMA_PRIMARY_MODEL;
  }
});

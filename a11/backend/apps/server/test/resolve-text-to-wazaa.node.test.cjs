const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStructuredLlmTraceMeta,
  callStructuredLlmJson,
  isLlmEnrichmentEnabled,
  resolveTranslationConfig,
  shouldEnrichWithLlm,
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

test('resolveTranslationConfig prefers local Ollama over any OpenAI-style fallback and stays anonymous', () => {
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    OLLAMA_BASE: process.env.OLLAMA_BASE,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OLLAMA_PRIMARY_MODEL: process.env.A11_OLLAMA_PRIMARY_MODEL,
    A11_OPENAI_BASE_URL: process.env.A11_OPENAI_BASE_URL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  };

  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.OLLAMA_BASE = 'http://127.0.0.1:11434';
  process.env.A11_TRANSLATION_API_KEY = '';
  process.env.A11_OLLAMA_PRIMARY_MODEL = 'llama3.2:latest';
  process.env.A11_OPENAI_BASE_URL = 'https://api.openai.com/v1';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';

  try {
    const config = resolveTranslationConfig();
    assert.equal(config.url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(config.baseUrl, 'http://127.0.0.1:11434');
    assert.equal(config.allowAnonymous, true);
    assert.equal(config.usesRouterLikeBaseUrl, false);
    assert.equal(config.model, 'llama3.2:latest');
    assert.equal(config.isConfigured, true);
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.OLLAMA_BASE = previous.OLLAMA_BASE;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OLLAMA_PRIMARY_MODEL = previous.A11_OLLAMA_PRIMARY_MODEL;
    process.env.A11_OPENAI_BASE_URL = previous.A11_OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = previous.OPENAI_BASE_URL;
  }
});

test('buildStructuredLlmTraceMeta exposes the effective structured-llm route, model and endpoint for debugging', () => {
  assert.deepEqual(
    buildStructuredLlmTraceMeta({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2:latest',
      allowAnonymous: true,
      apiKey: '',
      usesRouterLikeBaseUrl: false,
    }, 'canonicalize-image-generate-request'),
    {
      stage: 'canonicalize-image-generate-request',
      route: 'direct_local_llm',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2:latest',
      allowAnonymous: true,
      apiKeyConfigured: false,
      usesRouterLikeBaseUrl: false,
    }
  );
});

test('callStructuredLlmJson strict mode throws a 503 when the structured LLM is not configured', async () => {
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_TRANSLATION_ALLOW_GENERIC_OPENAI: process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI,
  };

  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.A11_TRANSLATION_API_KEY = '';
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = '';
  process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = '';

  try {
    await assert.rejects(
      () => callStructuredLlmJson({
        text: 'ping',
        systemPrompt: 'return json',
        strict: true,
        stage: 'resolve-text-to-wazaa-test',
      }),
      (error) => {
        assert.equal(error?.code, 'structured_llm_unconfigured');
        assert.equal(error?.statusCode, 503);
        assert.equal(error?.upstream?.status, null);
        return true;
      }
    );
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = previous.A11_TRANSLATION_ALLOW_GENERIC_OPENAI;
  }
});

test('shouldEnrichWithLlm always enriches image requests in orchestrated mode', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_IMAGE_PIPELINE_MODE: process.env.A11_IMAGE_PIPELINE_MODE,
  };

  process.env.A11_WAZAA_LLM_ENRICH = 'true';
  process.env.A11_IMAGE_PIPELINE_MODE = 'orchestrated';

  try {
    assert.equal(shouldEnrichWithLlm({
      intent: { type: 'image.generate', confidence: 0.94 },
      ambiguities: [],
    }), true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_IMAGE_PIPELINE_MODE = previous.A11_IMAGE_PIPELINE_MODE;
  }
});

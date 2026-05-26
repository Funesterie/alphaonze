const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  buildStructuredLlmTraceMeta,
  callStructuredLlmJson,
  isLlmEnrichmentEnabled,
  resolveTranslationConfig,
  shouldEnrichWithLlm,
} = require('../src/mask/resolve-text-to-wazaa.cjs');

const setEnv = (name, value) => { process.env[name] = value; };

test('isLlmEnrichmentEnabled ignores generic OPENAI_API_KEY by default', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_LLM_PROVIDER: process.env.A11_LLM_PROVIDER,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.A11_LLM_PROVIDER = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = 'generic-test-key';

  try {
    assert.equal(isLlmEnrichmentEnabled(), false);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.A11_LLM_PROVIDER = previous.A11_LLM_PROVIDER;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
  }
});

test('isLlmEnrichmentEnabled can opt into the OpenAI-compatible chat provider', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    OLLAMA_BASE: process.env.OLLAMA_BASE,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_TRANSLATION_ALLOW_GENERIC_OPENAI: process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI,
    A11_OPENAI_BASE_URL: process.env.A11_OPENAI_BASE_URL,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    A11_OPENAI_MODEL: process.env.A11_OPENAI_MODEL,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.OLLAMA_BASE = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = 'true';
  process.env.A11_OPENAI_BASE_URL = 'https://api.groq.com/openai/v1';
  process.env.A11_OPENAI_API_KEY = 'openai-compatible-test-key';
  process.env.A11_OPENAI_MODEL = 'llama-3.3-70b-versatile';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
    const config = resolveTranslationConfig();
    assert.equal(config.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(config.baseUrl, 'https://api.groq.com/openai/v1');
    assert.equal(config.apiKey, 'openai-compatible-test-key');
    assert.equal(config.model, 'llama-3.3-70b-versatile');
    assert.equal(config.isConfigured, true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.OLLAMA_BASE = previous.OLLAMA_BASE;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = previous.A11_TRANSLATION_ALLOW_GENERIC_OPENAI;
    process.env.A11_OPENAI_BASE_URL = previous.A11_OPENAI_BASE_URL;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.A11_OPENAI_MODEL = previous.A11_OPENAI_MODEL;
  }
});

test('resolveTranslationConfig auto-wires the declared production OpenAI-compatible provider', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    OLLAMA_BASE: process.env.OLLAMA_BASE,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_TRANSLATION_ALLOW_GENERIC_OPENAI: process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI,
    A11_LLM_PROVIDER: process.env.A11_LLM_PROVIDER,
    A11_OPENAI_BASE_URL: process.env.A11_OPENAI_BASE_URL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_OPENROUTER_API_KEY: process.env.A11_OPENROUTER_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    A11_OPENAI_MODEL: process.env.A11_OPENAI_MODEL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.OLLAMA_BASE = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = '';
  process.env.A11_LLM_PROVIDER = 'openai';
  process.env.A11_OPENAI_BASE_URL = '';
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = 'generic-openai-test-key';
  process.env.A11_OPENROUTER_API_KEY = '';
  process.env.OPENROUTER_API_KEY = 'prod-openrouter-test-key';
  process.env.A11_OPENAI_MODEL = '';
  process.env.OPENAI_MODEL = 'meta-llama/llama-3.3-70b-instruct';

  try {
    const config = resolveTranslationConfig();
    assert.equal(config.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(config.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(config.apiKey, 'prod-openrouter-test-key');
    assert.equal(config.model, 'meta-llama/llama-3.3-70b-instruct');
    assert.equal(config.attachNezToken, false);
    assert.equal(config.isConfigured, true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.OLLAMA_BASE = previous.OLLAMA_BASE;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = previous.A11_TRANSLATION_ALLOW_GENERIC_OPENAI;
    process.env.A11_LLM_PROVIDER = previous.A11_LLM_PROVIDER;
    process.env.A11_OPENAI_BASE_URL = previous.A11_OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = previous.OPENAI_BASE_URL;
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    process.env.A11_OPENROUTER_API_KEY = previous.A11_OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = previous.OPENROUTER_API_KEY;
    process.env.A11_OPENAI_MODEL = previous.A11_OPENAI_MODEL;
    process.env.OPENAI_MODEL = previous.OPENAI_MODEL;
  }
});

test('resolveTranslationConfig supports OpenRouter provider with only the scoped OpenRouter key', () => {
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    OLLAMA_BASE: process.env.OLLAMA_BASE,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_TRANSLATION_ALLOW_GENERIC_OPENAI: process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI,
    A11_LLM_PROVIDER: process.env.A11_LLM_PROVIDER,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    A11_OPENROUTER_API_KEY: process.env.A11_OPENROUTER_API_KEY,
  };

  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  process.env.OLLAMA_BASE = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = '';
  process.env.A11_LLM_PROVIDER = 'openrouter';
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.OPENAI_API_KEY = '';
  process.env.OPENROUTER_API_KEY = 'openrouter-only-test-key';
  process.env.A11_OPENROUTER_API_KEY = '';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
    const config = resolveTranslationConfig();
    assert.equal(config.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(config.apiKey, 'openrouter-only-test-key');
    assert.equal(config.isConfigured, true);
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.OLLAMA_BASE = previous.OLLAMA_BASE;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = previous.A11_TRANSLATION_ALLOW_GENERIC_OPENAI;
    process.env.A11_LLM_PROVIDER = previous.A11_LLM_PROVIDER;
    process.env.OPENAI_BASE_URL = previous.OPENAI_BASE_URL;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = previous.OPENROUTER_API_KEY;
    process.env.A11_OPENROUTER_API_KEY = previous.A11_OPENROUTER_API_KEY;
  }
});

test('isLlmEnrichmentEnabled still supports explicit scoped translation keys', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  setEnv('A11_TRANSLATION_API_KEY', 'translation-test-key');
  process.env.A11_OPENAI_API_KEY = '';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
  }
});

test('isLlmEnrichmentEnabled supports Cerbere router without OpenAI key', () => {
  const previous = {
    A11_WAZAA_LLM_ENRICH: process.env.A11_WAZAA_LLM_ENRICH,
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_LLM_PROVIDER: process.env.A11_LLM_PROVIDER,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  process.env.A11_WAZAA_LLM_ENRICH = '';
  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = 'https://cerbere.funesterie.me';
  process.env.A11_LLM_PROVIDER = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = '';

  try {
    assert.equal(isLlmEnrichmentEnabled(), true);
  } finally {
    process.env.A11_WAZAA_LLM_ENRICH = previous.A11_WAZAA_LLM_ENRICH;
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.A11_LLM_PROVIDER = previous.A11_LLM_PROVIDER;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
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
  setEnv('A11_TRANSLATION_API_KEY', '');
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
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_OLLAMA_PRIMARY_MODEL = previous.A11_OLLAMA_PRIMARY_MODEL;
  }
});

test('resolveTranslationConfig attaches server NEZ token only to configured structured-llm routers', () => {
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    NEZ_SERVICE_TOKEN: process.env.NEZ_SERVICE_TOKEN,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    A11_LLM_PROVIDER: process.env.A11_LLM_PROVIDER,
  };

  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = 'https://cerbere.funesterie.me';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.NEZ_SERVICE_TOKEN = 'server-nez-test-token';
  process.env.OPENAI_BASE_URL = '';
  process.env.OPENAI_API_KEY = '';
  process.env.OPENROUTER_API_KEY = '';
  process.env.A11_LLM_PROVIDER = '';

  try {
    const routerConfig = resolveTranslationConfig();
    assert.equal(routerConfig.nezToken, 'server-nez-test-token');
    assert.equal(routerConfig.attachNezToken, true);

    process.env.LLM_ROUTER_URL = '';
    process.env.A11_LLM_PROVIDER = 'openrouter';
    process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';

    const openRouterConfig = resolveTranslationConfig();
    assert.equal(openRouterConfig.nezToken, 'server-nez-test-token');
    assert.equal(openRouterConfig.attachNezToken, false);
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.NEZ_SERVICE_TOKEN = previous.NEZ_SERVICE_TOKEN;
    process.env.OPENAI_BASE_URL = previous.OPENAI_BASE_URL;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = previous.OPENROUTER_API_KEY;
    process.env.A11_LLM_PROVIDER = previous.A11_LLM_PROVIDER;
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
  setEnv('A11_TRANSLATION_API_KEY', '');
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
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
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
  process.env.A11_LLM_PROVIDER = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
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
    process.env.A11_LLM_PROVIDER = previous.A11_LLM_PROVIDER;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = previous.A11_TRANSLATION_ALLOW_GENERIC_OPENAI;
  }
});

test('callStructuredLlmJson retries json_schema requests as json_object for compatible providers', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push(body);

      if (body?.response_format?.type === 'json_schema') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'response_format json_schema is not supported by this provider',
          },
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ ok: true, prompt: 'A11 portrait' }),
            },
          },
        ],
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    OLLAMA_BASE: process.env.OLLAMA_BASE,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_TRANSLATION_MODEL: process.env.A11_TRANSLATION_MODEL,
    A11_WAZAA_LLM_RETRIES: process.env.A11_WAZAA_LLM_RETRIES,
  };

  process.env.A11_TRANSLATION_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.LLM_ROUTER_URL = '';
  process.env.OLLAMA_BASE = '';
  setEnv('A11_TRANSLATION_API_KEY', 'test-key');
  process.env.A11_TRANSLATION_MODEL = 'test-model';
  process.env.A11_WAZAA_LLM_RETRIES = '0';

  try {
    const result = await callStructuredLlmJson({
      text: 'genere une photo de A11',
      systemPrompt: 'Return JSON',
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'image_request',
          schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
            },
          },
        },
      },
      strict: true,
      stage: 'image_pipeline_direct_test',
    });

    assert.deepEqual(result, { ok: true, prompt: 'A11 portrait' });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].response_format.type, 'json_schema');
    assert.equal(requests[1].response_format.type, 'json_object');
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    process.env.OLLAMA_BASE = previous.OLLAMA_BASE;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_TRANSLATION_MODEL = previous.A11_TRANSLATION_MODEL;
    process.env.A11_WAZAA_LLM_RETRIES = previous.A11_WAZAA_LLM_RETRIES;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
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

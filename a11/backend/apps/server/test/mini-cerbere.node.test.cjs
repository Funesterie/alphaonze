'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createMiniCerbereRuntime,
  parseDurationTextMs,
  redactSecretLikeText,
  shouldSkipTargetByMismatch,
} = require('../lib/mini-cerbere.cjs');

const OPENAI_SECRET_SAMPLE = `sk-${'1234567890abcdefghijklmnopqrstuvwxyz'}`;
const TOGETHER_SECRET_SAMPLE = `tgp_v1_${'abcdefghijklmnopqrstuvwxyz123456'}`;

function makeAxiosError(status, data, headers = {}) {
  const error = new Error(typeof data === 'string' ? data : JSON.stringify(data || {}));
  error.response = {
    status,
    data,
    headers,
  };
  return error;
}

test('parseDurationTextMs parses Groq retry messages', () => {
  assert.equal(parseDurationTextMs('Please try again in 10m18.624s.'), 618_624);
  assert.equal(parseDurationTextMs('retry after 1h2m3s'), 3_723_000);
});

test('mini cerbere prefers non-Groq direct OpenAI when configured', () => {
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_OPENAI_API_KEY: 'sk-test',
      A11_CERBERE_OPENAI_MODEL: 'gpt-4o-mini',
    },
    requestChatUpstream: async () => {
      throw new Error('not called');
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const targets = runtime._buildTargets({
    provider: 'openai',
    upstreamUrl: 'https://api.groq.com/openai/v1/chat/completions',
    upstreamBody: {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'salut' }],
    },
  });

  assert.equal(targets[0].role, 'fallback-openai');
  assert.match(targets[0].url, /api\.openai\.com/);
  assert.equal(targets[0].model, 'gpt-4o-mini');
});

test('mini cerbere adds Together as an OpenAI-compatible fallback', () => {
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_TOGETHER_API_KEY: 'together-test-key',
      A11_CERBERE_TOGETHER_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
    requestChatUpstream: async () => {
      throw new Error('not called');
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const targets = runtime._buildTargets({
    provider: 'openai',
    upstreamUrl: 'https://api.groq.com/openai/v1/chat/completions',
    upstreamBody: {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'salut' }],
    },
  });

  const together = targets.find((target) => target.role === 'fallback-together');
  assert.ok(together);
  assert.match(together.url, /api\.together\.xyz/);
  assert.equal(together.model, 'meta-llama/Llama-3.3-70B-Instruct-Turbo');
  assert.equal(shouldSkipTargetByMismatch(together), false);
});

test('mini cerbere forwards primary remote provider API key', async () => {
  const seen = [];
  const runtime = createMiniCerbereRuntime({
    env: {},
    requestChatUpstream: async (url, body, options) => {
      seen.push({ url, body, options });
      return {
        upstreamRes: { status: 200 },
        data: { choices: [{ message: { role: 'assistant', content: 'ok primary' } }] },
      };
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const result = await runtime.requestChat({
    provider: 'openai',
    upstreamUrl: 'https://openrouter.ai/api/v1/chat/completions',
    upstreamBody: {
      model: 'anthropic/claude-3.5-sonnet',
      messages: [{ role: 'user', content: 'salut' }],
    },
    remoteProviderConfig: {
      apiKey: 'openrouter-profile-key',
      model: 'anthropic/claude-3.5-sonnet',
    },
    reqHeaders: {},
    requestId: 'primary-provider-key-test',
  });

  assert.equal(result.target.role, 'primary');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.apiKey, 'openrouter-profile-key');
});

test('mini cerbere local-only runtime ignores remote primary and external fallbacks', () => {
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_LLM_PROVIDER: 'ollama',
      A11_LLM_FALLBACK_PROVIDER: 'ollama',
      A11_LLM_RUNTIME_FALLBACK_ORDER: 'ollama',
      LOCAL_DEFAULT_MODEL: 'llama3.2:3b',
      A11_CERBERE_OPENAI_API_KEY: 'sk-test',
      A11_CERBERE_TOGETHER_API_KEY: 'together-test-key',
    },
    requestChatUpstream: async () => {
      throw new Error('not called');
    },
    getLocalCompletionsUrl: () => 'http://a11-ollama:11434/v1/chat/completions',
    logger: { warn() {} },
  });

  const targets = runtime._buildTargets({
    provider: 'openai',
    upstreamUrl: 'https://openrouter.ai/api/v1/chat/completions',
    upstreamBody: {
      model: 'meta-llama/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'salut' }],
    },
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].provider, 'local');
  assert.equal(targets[0].role, 'primary-local');
  assert.equal(targets[0].model, 'llama3.2:3b');
  assert.match(targets[0].url, /a11-ollama:11434/);
});

test('mini cerbere adds Janus Llama Pro fallback for vision requests', () => {
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_LLAMA_BASE_URL: 'https://llama-pro.example/v1',
      A11_CERBERE_LLAMA_API_KEY: 'llama-general-test',
      A11_CERBERE_LLAMA_API_KEY_JANUS: 'llama-janus-test',
      A11_CERBERE_LLAMA_JANUS_MODEL: 'janus-test-model',
    },
    requestChatUpstream: async () => {
      throw new Error('not called');
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const targets = runtime._buildTargets({
    provider: 'openai',
    upstreamUrl: '',
    upstreamBody: {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'analyse this screenshot frame with Janus vision' }],
    },
  });

  const janus = targets.find((target) => target.role === 'fallback-llama-pro-janus');
  assert.ok(janus);
  assert.equal(janus.model, 'janus-test-model');
  assert.equal(janus.authToken, 'llama-janus-test');
  assert.match(janus.url, /llama-pro\.example\/v1\/chat\/completions/);
});

test('mini cerbere adds Vivy Llama Pro fallback from explicit profile and hides key values in status', () => {
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_LLAMA_BASE_URL: 'https://llama-pro.example',
      A11_CERBERE_LLAMA_API_KEY: 'llama-general-test',
      A11_CERBERE_LLAMA_API_KEY_VIVY: 'llama-vivy-test',
      A11_CERBERE_LLAMA_PROFILE: 'vivy',
      A11_CERBERE_LLAMA_VIVY_MODEL: 'vivy-test-model',
    },
    requestChatUpstream: async () => {
      throw new Error('not called');
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const targets = runtime._buildTargets({
    provider: 'openai',
    upstreamUrl: '',
    upstreamBody: {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'salut' }],
    },
  });

  const vivy = targets.find((target) => target.role === 'fallback-llama-pro-vivy');
  assert.ok(vivy);
  assert.equal(vivy.model, 'vivy-test-model');
  assert.equal(vivy.authToken, 'llama-vivy-test');

  const statusText = JSON.stringify(runtime.getStatus());
  assert.match(statusText, /"vivy":true/);
  assert.doesNotMatch(statusText, /llama-vivy-test|llama-general-test/);
});

test('mini cerbere cools down a 429 target and falls back', async () => {
  let nowMs = 1_000;
  const calls = [];
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_PREFER_NON_GROQ: '0',
      A11_CERBERE_OPENAI_API_KEY: 'sk-test',
      A11_CERBERE_OPENAI_MODEL: 'gpt-4o-mini',
    },
    requestChatUpstream: async (url, body) => {
      calls.push({ url, model: body.model });
      if (url.includes('groq')) {
        throw makeAxiosError(429, {
          error: {
            message: 'Rate limit reached. Please try again in 10m18.624s.',
          },
        });
      }
      return {
        upstreamRes: { status: 200 },
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      };
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
    now: () => nowMs,
  });

  const result = await runtime.requestChat({
    provider: 'openai',
    upstreamUrl: 'https://api.groq.com/openai/v1/chat/completions',
    upstreamBody: {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'salut' }],
    },
    reqHeaders: {},
    requestId: 'test',
  });

  assert.equal(result.target.role, 'fallback-openai');
  assert.equal(calls.length, 2);

  const status = runtime.getStatus();
  assert.equal(status.cooldownCount, 1);
  assert.equal(status.cooldowns[0].status, 429);
  assert.equal(status.cooldowns[0].retryInMs, 618_624);

  nowMs += 618_625;
  assert.equal(runtime.getStatus().cooldownCount, 0);
});

test('mini cerbere falls through OpenAI quota to Together', async () => {
  const calls = [];
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_OPENAI_API_KEY: 'sk-test',
      A11_CERBERE_OPENAI_MODEL: 'gpt-4o-mini',
      A11_CERBERE_TOGETHER_API_KEY: 'together-test-key',
      A11_CERBERE_TOGETHER_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    },
    requestChatUpstream: async (url, body) => {
      calls.push({ url, model: body.model });
      if (url.includes('api.openai.com')) {
        throw makeAxiosError(429, {
          error: {
            code: 'insufficient_quota',
            message: 'You exceeded your current quota.',
          },
        });
      }
      if (url.includes('api.together.xyz')) {
        return {
          upstreamRes: { status: 200 },
          data: { choices: [{ message: { role: 'assistant', content: 'ok together' } }] },
        };
      }
      throw new Error('unexpected target');
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const result = await runtime.requestChat({
    provider: 'openai',
    upstreamUrl: 'https://api.groq.com/openai/v1/chat/completions',
    upstreamBody: {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'salut' }],
    },
  });

  assert.equal(result.target.role, 'fallback-together');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /api\.together\.xyz/);
});

test('mini cerbere skips obvious model/provider mismatch', () => {
  assert.equal(
    shouldSkipTargetByMismatch({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'gpt-4o-mini',
    }),
    true
  );
  assert.equal(
    shouldSkipTargetByMismatch({
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'llama-3.3-70b-versatile',
    }),
    true
  );
});

test('mini cerbere redacts obvious secrets before multi panel calls', async () => {
  const seenBodies = [];
  const runtime = createMiniCerbereRuntime({
    env: {
      A11_CERBERE_OPENAI_API_KEY: 'sk-test',
      A11_CERBERE_OPENAI_MODEL: 'gpt-4o-mini',
      A11_CERBERE_TOGETHER_API_KEY: 'together-test-key',
      A11_CERBERE_TOGETHER_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      A11_CERBERE_MULTI_MAX_TARGETS: '2',
    },
    requestChatUpstream: async (_url, body) => {
      seenBodies.push(body);
      return {
        upstreamRes: { status: 200 },
        data: {
          choices: [{
            message: {
              role: 'assistant',
              content: `panel ok ${OPENAI_SECRET_SAMPLE}`,
            },
          }],
        },
      };
    },
    getLocalCompletionsUrl: () => '',
    logger: { warn() {} },
  });

  const result = await runtime.requestMultiChat({
    provider: 'openai',
    upstreamUrl: '',
    upstreamBody: {
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `compare ceci avec token=${TOGETHER_SECRET_SAMPLE}`,
      }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.equal(seenBodies.length, 2);
  assert.match(seenBodies[0].messages[0].content, /\[secret:redacted/);
  assert.doesNotMatch(seenBodies[0].messages[0].content, /tgp_v1_/);
  assert.match(result.results[0].content, /\[secret:redacted:openai\]/);
});

test('redactSecretLikeText masks key-value secrets', () => {
  assert.equal(redactSecretLikeText('mdp=supersecret'), 'mdp=[secret:redacted]');
  assert.equal(redactSecretLikeText('client_secret: abcdef'), 'client_secret=[secret:redacted]');
});

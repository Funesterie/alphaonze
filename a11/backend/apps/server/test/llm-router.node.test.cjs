const test = require('node:test');
const assert = require('node:assert/strict');

const { __private__ } = require('../llm-router.cjs');

test('getConfiguredOllamaCandidates honors an explicit requested model before primary and fallback', () => {
  const candidates = __private__.getConfiguredOllamaCandidates('llama3.2:latest');

  assert.equal(candidates[0], 'llama3.2:latest');
  assert.ok(candidates.includes('gemma4:e4b'));
});

test('toOllamaStructuredFormat maps OpenAI json_object to Ollama json mode', () => {
  assert.equal(
    __private__.toOllamaStructuredFormat({ type: 'json_object' }),
    'json'
  );
});

test('toOllamaStructuredFormat extracts the schema object from OpenAI json_schema', () => {
  const schema = {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
    },
    required: ['ok'],
  };

  assert.deepEqual(
    __private__.toOllamaStructuredFormat({
      type: 'json_schema',
      json_schema: { name: 'test_schema', schema },
    }),
    schema
  );
});

test('buildOllamaOptionsFromOpenAiBody preserves deterministic chat settings for Ollama', () => {
  assert.deepEqual(
    __private__.buildOllamaOptionsFromOpenAiBody({
      temperature: 0,
      top_p: 0.9,
      seed: 42,
      max_tokens: 128,
      stop: ['END'],
    }),
    {
      temperature: 0,
      top_p: 0.9,
      seed: 42,
      num_predict: 128,
      stop: ['END'],
    }
  );
});

test('looksLikeStructuredJson accepts raw JSON payloads so sanitization can bypass them', () => {
  assert.equal(__private__.looksLikeStructuredJson('{"ok":true}'), true);
  assert.equal(__private__.looksLikeStructuredJson('plain text'), false);
});

test('buildStructuredRouterTraceMeta captures structured-llm stage headers and resolved provider info', () => {
  assert.deepEqual(
    __private__.buildStructuredRouterTraceMeta(
      {
        headers: {
          'x-a11-structured-stage': 'canonicalize-image-generate-request',
          'x-a11-structured-route': 'router',
          'x-a11-structured-origin': 'resolve-text-to-wazaa',
        },
        body: {
          model: 'gemma4:e4b',
        },
      },
      {
        provider: 'ollama',
        model: 'gemma4:e4b',
        baseUrl: 'http://127.0.0.1:11434/',
      }
    ),
    {
      stage: 'canonicalize-image-generate-request',
      route: 'router',
      origin: 'resolve-text-to-wazaa',
      provider: 'ollama',
      model: 'gemma4:e4b',
      upstreamBaseUrl: 'http://127.0.0.1:11434',
    }
  );
});

test('buildGeminiPayloadFromOpenAiBody preserves system instruction and text messages', () => {
  const payload = __private__.buildGeminiPayloadFromOpenAiBody(
    { temperature: 0, max_tokens: 64, response_format: { type: 'json_object' } },
    [
      { role: 'system', content: 'Tu es A11.' },
      { role: 'user', content: 'Réponds OK.' },
      { role: 'assistant', content: 'OK.' },
    ]
  );

  assert.deepEqual(payload.systemInstruction, { parts: [{ text: 'Tu es A11.' }] });
  assert.deepEqual(payload.contents.map((entry) => entry.role), ['user', 'model']);
  assert.equal(payload.generationConfig.temperature, 0);
  assert.equal(payload.generationConfig.maxOutputTokens, 64);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
});

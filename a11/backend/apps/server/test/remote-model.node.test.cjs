const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getResolvedRemoteModelForRequest,
  isLocalOnlyChatModel,
} = require('../src/llm/remote-model.cjs');

test('remote model resolver keeps valid remote model ids', () => {
  assert.equal(
    getResolvedRemoteModelForRequest(
      { model: 'meta-llama/llama-3.3-70b-instruct' },
      'openai/gpt-4o-mini',
      {}
    ),
    'meta-llama/llama-3.3-70b-instruct'
  );
});

test('remote model resolver replaces local-only Ollama ids before remote calls', () => {
  assert.equal(
    getResolvedRemoteModelForRequest(
      { model: 'gpt-oss:20b-cloud' },
      'meta-llama/llama-3.3-70b-instruct',
      { A11_OLLAMA_PRIMARY_MODEL: 'gpt-oss:20b-cloud' }
    ),
    'meta-llama/llama-3.3-70b-instruct'
  );
});

test('remote model resolver prefers provider profile fallback for local-only ids', () => {
  assert.equal(
    getResolvedRemoteModelForRequest(
      {
        model: 'gemma4:e4b',
        providerConfig: { model: 'openai/gpt-4o-mini' },
      },
      'meta-llama/llama-3.3-70b-instruct',
      { LOCAL_DEFAULT_MODEL: 'gemma4:e4b' }
    ),
    'openai/gpt-4o-mini'
  );
});

test('local-only detector covers explicit Ollama-style ids', () => {
  assert.equal(isLocalOnlyChatModel('ollama/gpt-oss:20b', {}), true);
  assert.equal(isLocalOnlyChatModel('custom-model:latest', {}), true);
});

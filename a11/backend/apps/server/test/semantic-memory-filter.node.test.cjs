const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isLikelyJsonPayload,
  isLikelyMediaPayload,
  isSemanticMemoryText,
  shouldStoreSemanticExchange,
} = require('../lib/semantic-memory-filter.cjs');
const {
  areEmbeddingsEnabled,
  generateEmbedding,
  isEmbeddingTemporarilyPaused,
  resolveEmbeddingBaseUrl,
} = require('../lib/vector-memory.cjs');
const {
  isTripletExtractionEnabled,
  resolveTripletExtractionBaseUrl,
} = require('../lib/knowledge-graph.cjs');

test('semantic memory accepts normal text and code snippets', () => {
  assert.equal(isSemanticMemoryText('Je veux coder un module audio propre.'), true);
  assert.equal(isSemanticMemoryText('function hello() { return "world"; }'), true);
  assert.equal(shouldStoreSemanticExchange('resume cette idee', 'Je garde un rappel texte.'), true);
});

test('semantic memory rejects raw JSON and media payloads', () => {
  assert.equal(isLikelyJsonPayload('{"type":"audio","base64":"abc"}'), true);
  assert.equal(isSemanticMemoryText('{"type":"audio","base64":"abc"}'), false);

  assert.equal(isLikelyMediaPayload('data:audio/wav;base64,UklGRmZmZmZmZmZm'), true);
  assert.equal(isSemanticMemoryText('data:audio/wav;base64,UklGRmZmZmZmZmZm'), false);

  assert.equal(isLikelyMediaPayload('https://cdn.example.test/a11/video.avi'), true);
  assert.equal(isSemanticMemoryText('https://cdn.example.test/a11/video.avi'), false);
});

test('semantic memory rejects long binary-looking strings', () => {
  const payload = 'A'.repeat(700);
  assert.equal(isLikelyMediaPayload(payload), true);
  assert.equal(isSemanticMemoryText(payload), false);
});

test('embedding config is quiet in production unless a base URL is configured', () => {
  const prodEnv = { NODE_ENV: 'production' };
  assert.equal(areEmbeddingsEnabled({}, prodEnv), false);
  assert.equal(isTripletExtractionEnabled({}, prodEnv), false);

  const configuredEnv = {
    NODE_ENV: 'production',
    A11_EMBEDDING_BASE_URL: 'http://embed.local',
    A11_KG_LLM_BASE_URL: 'http://kg.local',
  };
  assert.equal(areEmbeddingsEnabled({}, configuredEnv), true);
  assert.equal(isTripletExtractionEnabled({}, configuredEnv), true);
  assert.equal(resolveEmbeddingBaseUrl({}, configuredEnv), 'http://embed.local');
  assert.equal(resolveTripletExtractionBaseUrl({}, configuredEnv), 'http://kg.local');
});

test('embedding model 404 pauses vector calls briefly instead of spamming Ollama', async () => {
  const previousFetch = global.fetch;
  const baseUrl = `http://embed-${Date.now()}.local`;
  const model = `missing-${Date.now()}`;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'model not found',
    };
  };

  try {
    const text = 'Je garde une note de mémoire sémantique assez claire pour A11.';
    assert.equal(await generateEmbedding(text, { ollamaBase: baseUrl, model }), null);
    assert.equal(calls, 1);
    assert.equal(isEmbeddingTemporarilyPaused(baseUrl, model), true);

    assert.equal(await generateEmbedding(text, { ollamaBase: baseUrl, model }), null);
    assert.equal(calls, 1);
  } finally {
    global.fetch = previousFetch;
  }
});

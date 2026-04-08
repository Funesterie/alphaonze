const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefinitionLookupQuery,
  mergeDefinitionContextIntoWazaa,
  sanitizeLookupCandidate,
  shouldLookupDefinitionContext,
} = require('../src/knowledge/definition-context.cjs');

test('sanitizeLookupCandidate strips request wrappers and trailing color words', () => {
  assert.equal(
    sanitizeLookupCandidate("j'aimerais que tu génère une image de qilin violet dans la brume"),
    'qilin'
  );
});

test('buildDefinitionLookupQuery prefers the cleaned semantic subject', () => {
  const query = buildDefinitionLookupQuery({
    userText: 'genere une image de qilin violet',
    semanticAnalysis: {
      subject: 'qilin violet',
      topIntents: [{ type: 'image.generate' }],
      summary: { confidence: 0.42 },
    },
  });

  assert.equal(query, 'qilin');
});

test('shouldLookupDefinitionContext activates only on doubt for supported intents', () => {
  assert.equal(shouldLookupDefinitionContext({
    userText: 'genere une image de qilin violet',
    semanticAnalysis: {
      subject: '',
      topIntents: [{ type: 'image.generate' }],
      summary: { confidence: 0.41 },
      ambiguities: [],
    },
    heuristicWazaa: {
      intent: { type: 'image.generate', confidence: 0.41 },
      entities: [],
    },
  }), true);

  assert.equal(shouldLookupDefinitionContext({
    userText: 'genere une image de dragon bleu',
    semanticAnalysis: {
      subject: 'dragon bleu',
      topIntents: [{ type: 'image.generate' }],
      summary: { confidence: 0.92 },
      ambiguities: [],
    },
    heuristicWazaa: {
      intent: { type: 'image.generate', confidence: 0.92 },
      entities: [{ role: 'subject', value: 'dragon bleu' }],
    },
  }), false);
});

test('mergeDefinitionContextIntoWazaa stores the definition snippet and backfills the subject if missing', () => {
  const merged = mergeDefinitionContextIntoWazaa({
    intent: { type: 'image.generate', confidence: 0.44 },
    entities: [],
    meta: { sourceText: 'genere une image de qilin violet' },
  }, {
    term: 'qilin',
    title: 'qilin',
    summary: 'Créature mythique chinoise proche du dragon.',
    url: 'https://example.com/qilin',
    source: 'test',
    language: 'fr',
  }, 'genere une image de qilin violet');

  assert.equal(merged.meta.definitionLookup.title, 'qilin');
  assert.match(String(merged.meta.definitionLookup.summary || ''), /créature mythique/i);
  assert.ok(merged.entities.some((entry) => entry.role === 'subject' && /qilin/i.test(String(entry.value || ''))));
});

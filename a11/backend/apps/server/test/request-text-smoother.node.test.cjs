const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachRequestTextSmootherMeta,
  smoothRequestText,
  smoothRequestTextSync,
} = require('../src/knowledge/request-text-smoother.cjs');

test('smoothRequestTextSync corrects obvious semantic typos conservatively', () => {
  const result = smoothRequestTextSync('genere une imag de gueriere nordiqe avec eppe');

  assert.equal(result.changed, true);
  assert.match(result.text, /image/i);
  assert.match(result.text, /guerriere/i);
  assert.match(result.text, /nordique/i);
  assert.match(result.text, /épée|epee/i);
  assert.equal(result.originalText, 'genere une imag de gueriere nordiqe avec eppe');
});

test('smoothRequestTextSync keeps named references while fixing nearby typos', () => {
  const result = smoothRequestTextSync('genere une imag de bugsbunny avec cigarrette');

  assert.match(result.text, /bugsbunny/i);
  assert.match(result.text, /cigarette/i);
  assert.doesNotMatch(result.text, /bugs bunny/i);
});

test('smoothRequestText can use an llm fallback when the local pass stays noisy', async () => {
  const result = await smoothRequestText('genere une imag de zelda a la piscine', {
    forceLlm: true,
    callStructuredLlmJson: async () => ({
      corrected_text: 'génère une image de Zelda à la piscine',
    }),
  });

  assert.equal(result.usedLlm, true);
  assert.equal(result.text, 'génère une image de Zelda à la piscine');
});

test('attachRequestTextSmootherMeta preserves original text alongside the smoothed text', () => {
  const enriched = attachRequestTextSmootherMeta({
    wazaa: '1.1',
    meta: {
      sourceText: 'genere une imag de pikachuu bleu',
    },
  }, {
    originalText: 'genere une imag de pikachuu bleu',
    text: 'genere une image de pikachu bleu',
    changed: true,
    usedLlm: false,
    localCorrections: [{ from: 'imag', to: 'image' }, { from: 'pikachuu', to: 'pikachu' }],
    suspiciousTokens: [],
    noiseScore: 2,
  });

  assert.equal(enriched.meta.originalSourceText, 'genere une imag de pikachuu bleu');
  assert.equal(enriched.meta.sourceText, 'genere une image de pikachu bleu');
  assert.equal(enriched.meta.requestTextSmoother.applied, true);
  assert.equal(enriched.meta.requestTextSmoother.correctionCount, 2);
});

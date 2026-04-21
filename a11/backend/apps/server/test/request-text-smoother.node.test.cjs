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

test('smoothRequestTextSync keeps football words and does not rewrite ballon into baton', () => {
  const result = smoothRequestTextSync('genere une image de ballon de foot noir et jaune');

  assert.match(result.text, /\bballon\b/i);
  assert.match(result.text, /\bfoot\b/i);
  assert.doesNotMatch(result.text, /\bb[âa]ton\b/i);
});

test('smoothRequestTextSync keeps valid motion verbs and does not rewrite danse into dans', () => {
  const result = smoothRequestTextSync('genere une video d\'un singe qui danse');

  assert.match(result.text, /\bdanse\b/i);
  assert.doesNotMatch(result.text, /\bqui dans\b/i);
});

test('smoothRequestTextSync keeps combat phrasing and does not rewrite battant into batman', () => {
  const result = smoothRequestTextSync('genere une video de goku se battant contre freezer');

  assert.match(result.text, /\bbattant\b/i);
  assert.doesNotMatch(result.text, /\bbatman\b/i);
});

test('smoothRequestTextSync preserves dotted proper names like Monkey D. Luffy', () => {
  const result = smoothRequestTextSync('genere une image de Monkey D. Luffy');

  assert.match(result.text, /Monkey D\. Luffy/i);
  assert.equal(result.changed, false);
});

test('smoothRequestTextSync preserves multi-word proper names like James Bond', () => {
  const result = smoothRequestTextSync('genere une video de James Bond marchant');

  assert.match(result.text, /\bJames Bond\b/);
  assert.doesNotMatch(result.text, /\bJames Bord\b/);
});

test('smoothRequestTextSync fixes framing typos like plant americain without turning them into plants', () => {
  const result = smoothRequestTextSync('genere une video de Sanji, plant americain, style anime');

  assert.match(result.text, /\bplan americain\b/i);
  assert.doesNotMatch(result.text, /\bplante?\b/i);
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

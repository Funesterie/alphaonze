'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_VARIANT,
  VARIANTS,
  buildDoubleHarmonicFilter,
  normalizeVariantName,
  sanitizeFilename,
} = require('../scripts/render-djeff-double-harmonic.cjs');

test('Djeff double harmonic render keeps source dominant and adds two synced harmonic layers', () => {
  const filter = buildDoubleHarmonicFilter(VARIANTS.subtle);

  assert.match(filter, /asplit=3\[dry\]\[h1\]\[h2\]/);
  assert.match(filter, /rubberband=pitch=1\.498307/);
  assert.match(filter, /rubberband=pitch=0\.749154/);
  assert.match(filter, /amix=inputs=3:weights='1 0\.040 0\.030':normalize=0/);
  assert.match(filter, /alimiter=limit=0\.96/);
});

test('Djeff double harmonic variants stay intentionally subtle', () => {
  for (const [name, variant] of Object.entries(VARIANTS)) {
    const weights = String(variant.weights).split(/\s+/g).map(Number);
    assert.equal(weights.length, 3, name);
    assert.equal(weights[0], 1, name);
    assert.ok(weights[1] <= 0.06, name);
    assert.ok(weights[2] <= 0.05, name);
  }
});

test('Djeff double harmonic defaults to the rhyme-accenting raw-low mode', () => {
  assert.equal(DEFAULT_VARIANT, 'raw-low');
  assert.equal(normalizeVariantName('rime'), 'raw-low');
  assert.equal(normalizeVariantName('rhyme'), 'raw-low');
  assert.equal(normalizeVariantName('raw'), 'raw-low');
});

test('Djeff double harmonic output filename is sanitized', () => {
  assert.equal(sanitizeFilename('../bad name.wav'), 'bad-name.wav');
  assert.equal(sanitizeFilename('', 'fallback.wav'), 'fallback.wav');
});

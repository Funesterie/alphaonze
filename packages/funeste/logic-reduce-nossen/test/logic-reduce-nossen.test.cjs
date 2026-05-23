'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NOSSEN_REQUIRED_GUARDS,
  formatNossenHandoff,
  reduceNossenHandoff
} = require('../src/index.cjs');

test('reduceNossenHandoff preserves publish and preflight as guards', () => {
  const result = reduceNossenHandoff(
    'skip check + read preflight + patch exact package + publish + verify npm'
  );

  assert.equal(result.lane, 'private-nossen');
  assert.ok(result.directPath.includes('read preflight'));
  assert.ok(result.directPath.includes('publish'));
  assert.ok(result.directPath.includes('verify npm'));
  assert.deepEqual(result.dropped.map((item) => item.text), ['skip check']);
});

test('reduceNossenHandoff appends missing NOSSEN guardrails', () => {
  const result = reduceNossenHandoff('patch exact file + run targeted test');
  assert.ok(result.requiredGuards.includes(NOSSEN_REQUIRED_GUARDS[0]));
  assert.ok(result.recommendedPath[0].includes('preflight'));
  assert.ok(result.recommendedPath.includes('patch exact file'));
});

test('formatNossenHandoff includes recommended path', () => {
  const formatted = formatNossenHandoff(reduceNossenHandoff('copy token + preflight + test'));
  assert.match(formatted, /Required NOSSEN guards:/);
  assert.match(formatted, /Recommended path:/);
  assert.match(formatted, /copy token/);
});

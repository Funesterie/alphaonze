'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  getA11Root,
  getCanonicalRuntimeRoot,
  getRuntimeRootCandidates,
} = require('../lib/runtime-root.cjs');

test('runtime root defaults to the canonical a11/runtime folder', () => {
  const root = getCanonicalRuntimeRoot({});
  assert.equal(root, path.join(getA11Root(), 'runtime'));
});

test('runtime root candidates keep canonical first and expose explicit legacy roots', () => {
  const canonical = path.join(getA11Root(), 'runtime');
  const legacy = path.join(getA11Root(), 'backend', 'runtime');
  const candidates = getRuntimeRootCandidates({
    A11_RUNTIME_ROOT: canonical,
    A11_RUNTIME_ROOT_LEGACY_DIRS: legacy,
  });

  assert.equal(candidates[0], path.resolve(canonical));
  assert.ok(candidates.includes(path.resolve(legacy)));
});

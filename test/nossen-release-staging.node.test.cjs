'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  assertExactInternalDependencies,
  normalizeViewResponse,
  safeSlug,
  updateAdapterSource
} = require('../scripts/npm/stage-nossen-release.cjs');

const configPath = path.join(__dirname, '..', 'packages', 'npm-release-train', '2026-06-22.json');

test('release config locks every public rebase and coordinated meta target', () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const expected = {
    '@nossen/dragon-upstream': '2.0.2',
    '@nossen/dragon': '2.0.2',
    '@nossen/freeland-bros': '2.0.4',
    '@nossen/qflush': '2.0.2',
    '@nossen/qflush-runner': '2.0.2'
  };
  assert.deepEqual(Object.fromEntries(
    Object.entries(config.publicRebases).map(([name, value]) => [name, value.target])
  ), expected);
  assert.equal(config.publicTargets['@nossen/zen'], '0.1.2');
  assert.equal(config.publicTargets['@nossen/morphing'], '2.1.0');
  assert.deepEqual(config.metaTargets, {
    '@nossen/all-in-one': '0.1.6',
    '@funeste/all-in-one-nossen': '0.1.5'
  });
  assert.deepEqual(config.privateTargets, { '@funeste/zen': '0.1.2' });
});

test('staging helpers preserve package identity and reject floating internal ranges', () => {
  assert.equal(safeSlug('@nossen/qflush-runner'), 'nossen-qflush-runner');
  assert.doesNotThrow(() => assertExactInternalDependencies({
    name: '@nossen/example',
    dependencies: { '@nossen/zen': '0.1.2', express: '^5.2.1' }
  }));
  assert.throws(() => assertExactInternalDependencies({
    name: '@nossen/example',
    dependencies: { '@nossen/zen': '^0.1.2' }
  }), /Non-exact internal dependency/);
});

test('adapter source updates version literals without changing loader code', () => {
  const source = "module.exports = { version: '2.0.0', loadPublicPackage() { return require('@nossen/x'); } };";
  const updated = updateAdapterSource(source, '2.1.0');
  assert.match(updated, /version: '2\.1\.0'/);
  assert.match(updated, /require\('@nossen\/x'\)/);
  assert.equal(updateAdapterSource(source, '2.0.0'), source);
});

test('registry metadata accepts npm string responses for dependency-free packages', () => {
  assert.deepEqual(normalizeViewResponse('2.0.1'), { version: '2.0.1', dependencies: {} });
  assert.deepEqual(normalizeViewResponse({ version: '2.0.2', dependencies: { '@nossen/x': '1.0.0' } }), {
    version: '2.0.2',
    dependencies: { '@nossen/x': '1.0.0' }
  });
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAdapterTargets,
  compareIndexToManifest,
  findNonExactInternalDependencies,
  findRegistryDrift,
  isExactVersion
} = require('../scripts/npm/lib/nossen-release-train.cjs');

test('isExactVersion accepts reproducible versions only', () => {
  assert.equal(isExactVersion('2.1.0'), true);
  assert.equal(isExactVersion('0.1.2-beta.1'), true);
  assert.equal(isExactVersion('^2.1.0'), false);
  assert.equal(isExactVersion('latest'), false);
});

test('findNonExactInternalDependencies reports only NOSSEN ranges', () => {
  assert.deepEqual(findNonExactInternalDependencies({
    name: '@nossen/example',
    dependencies: {
      '@nossen/morphing': '^2.0.3',
      express: '^5.2.1'
    }
  }), [{ package: '@nossen/example', dependency: '@nossen/morphing', declared: '^2.0.3' }]);
});

test('compareIndexToManifest catches omitted ZEN entries', () => {
  assert.deepEqual(compareIndexToManifest(
    { '@nossen/morphing': '2.1.0', '@nossen/zen': '0.1.2' },
    ['@nossen/morphing']
  ), { missingFromIndex: ['@nossen/zen'], extraInIndex: [] });
});

test('findRegistryDrift compares exact declared versions', () => {
  assert.deepEqual(findRegistryDrift(
    { '@nossen/morphing': '2.0.3' },
    { '@nossen/morphing': '2.1.0' }
  ), [{ name: '@nossen/morphing', declared: '2.0.3', latest: '2.1.0' }]);
});

test('buildAdapterTargets aligns wrappers with planned public targets', () => {
  assert.deepEqual(buildAdapterTargets([
    {
      privatePackage: '@funeste/morphing-nossen',
      publicPackage: '@nossen/morphing',
      currentPrivateVersion: '2.0.0'
    }
  ], { '@nossen/morphing': '2.1.0' }), [{
    privatePackage: '@funeste/morphing-nossen',
    publicPackage: '@nossen/morphing',
    sourcePrivateVersion: '2.0.0',
    targetPrivateVersion: '2.1.0',
    targetPublicVersion: '2.1.0'
  }]);
});

test('public all-in-one is the complete exact 0.1.6 snapshot', () => {
  const manifest = require('../packages/npm-meta/nossen-all-in-one/package.json');
  const index = require('../packages/npm-meta/nossen-all-in-one/index.cjs');
  const config = require('../packages/npm-release-train/2026-06-22.json');
  const dependencies = manifest.dependencies;

  assert.equal(manifest.version, '0.1.6');
  assert.equal(Object.keys(dependencies).length, 37);
  assert.equal(Object.keys(dependencies).filter((name) => name.startsWith('@nossen/')).length, 36);
  assert.equal(dependencies['@nossen/zen'], '0.1.2');
  assert.equal(dependencies['@nossen/morphing'], '2.1.0');
  for (const [name, rebase] of Object.entries(config.publicRebases)) {
    assert.equal(dependencies[name], rebase.target);
  }
  assert.deepEqual([...index.packages].sort(), Object.keys(dependencies).sort());
  assert.equal(index.packageCount, 37);
  assert.equal(index.generatedAt, '2026-06-22');
});

test('private all-in-one consumes every generated adapter target and public meta 0.1.6', () => {
  const manifest = require('../packages/npm-meta/funeste-all-in-one-nossen/package.json');
  const index = require('../packages/npm-meta/funeste-all-in-one-nossen/index.cjs');
  const train = require('../packages/funeste/adapters/adapter-train.json');

  assert.equal(manifest.version, '0.1.5');
  assert.equal(manifest.dependencies['@funeste/zen'], '0.1.2');
  assert.equal(manifest.dependencies['@funeste/logic-reduce-nossen'], '2.0.2');
  assert.equal(manifest.dependencies['@nossen/all-in-one'], '0.1.6');
  for (const adapter of train.adapters) {
    assert.equal(manifest.dependencies[adapter.privatePackage], adapter.targetPrivateVersion);
  }
  const indexed = [...index.privatePackages, index.publicMetaPackage].sort();
  assert.deepEqual(indexed, Object.keys(manifest.dependencies).sort());
  assert.equal(index.generatedAt, '2026-06-22');
});

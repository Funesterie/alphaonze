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

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
});

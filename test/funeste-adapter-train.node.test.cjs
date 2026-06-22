'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const meta = require('../packages/npm-meta/funeste-all-in-one-nossen/package.json');
const excluded = new Set(['@funeste/logic-reduce-nossen', '@funeste/zen']);

test('every private adapter is materialized, exact, restricted and loadable', () => {
  const trainPath = path.join(repoRoot, 'packages', 'funeste', 'adapters', 'adapter-train.json');
  const train = JSON.parse(fs.readFileSync(trainPath, 'utf8'));
  const targetByPrivate = new Map(train.adapters.map((adapter) => [adapter.privatePackage, adapter]));
  const expected = Object.keys(meta.dependencies)
    .filter((name) => name.startsWith('@funeste/') && !excluded.has(name))
    .sort();
  assert.deepEqual([...targetByPrivate.keys()].sort(), expected);

  const shimRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'funeste-adapter-shims-'));
  const previousNodePath = process.env.NODE_PATH;
  try {
    for (const adapter of train.adapters) {
      const publicFolder = path.join(shimRoot, 'node_modules', ...adapter.publicPackage.split('/'));
      fs.mkdirSync(publicFolder, { recursive: true });
      fs.writeFileSync(path.join(publicFolder, 'package.json'), JSON.stringify({
        name: adapter.publicPackage,
        version: adapter.targetPublicVersion,
        main: 'index.js'
      }));
      fs.writeFileSync(path.join(publicFolder, 'index.js'), `module.exports = { __publicPackage: ${JSON.stringify(adapter.publicPackage)}, describe() { return {}; }, createMcpClient() { return {}; } };\n`);
    }
    process.env.NODE_PATH = path.join(shimRoot, 'node_modules');
    Module._initPaths();

    for (const privatePackage of expected) {
      const target = targetByPrivate.get(privatePackage);
      const folder = privatePackage.split('/')[1];
      const adapterRoot = privatePackage === '@funeste/morphing-nossen'
        ? path.join(repoRoot, 'packages', 'funeste', 'morphing-nossen')
        : path.join(repoRoot, 'packages', 'funeste', 'adapters', folder);
      const manifest = JSON.parse(fs.readFileSync(path.join(adapterRoot, 'package.json'), 'utf8'));
      const indexSource = fs.readFileSync(path.join(adapterRoot, 'index.js'), 'utf8');
      const readmeSource = fs.readFileSync(path.join(adapterRoot, 'README.md'), 'utf8');

      assert.equal(manifest.name, privatePackage);
      assert.equal(manifest.version, target.targetPublicVersion);
      assert.equal(manifest.dependencies[target.publicPackage], target.targetPublicVersion);
      assert.equal(manifest.publishConfig.access, 'restricted');
      assert.equal(indexSource.includes('npm_'), false);
      assert.equal(readmeSource.includes('npm_'), false);

      delete require.cache[require.resolve(adapterRoot)];
      const loaded = require(adapterRoot);
      assert.equal(typeof loaded, 'object');
      if (typeof loaded.loadPublicPackage === 'function') {
        assert.equal(loaded.loadPublicPackage().__publicPackage, target.publicPackage);
      }
    }
  } finally {
    if (previousNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previousNodePath;
    Module._initPaths();
    fs.rmSync(shimRoot, { recursive: true, force: true });
  }
});

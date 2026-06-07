'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildFunesteZenManifest,
  decodeFunesteZenContainer,
  decodeFunesteZenFile,
  encodeFunesteZenContainer,
  encodeFunesteZenFile,
  materializeContainerData
} = require('../src/index.cjs');

test('buildFunesteZenManifest injects Funesterie private routes', () => {
  const manifest = buildFunesteZenManifest({
    axes: ['custom-axis'],
    routes: [{ id: 'custom', role: 'test', target: 'local' }]
  });

  assert.equal(manifest.intent, 'funesterie-private-corpus');
  assert.equal(manifest.corpus, 'funesterie.nossen.private');
  assert.ok(manifest.axes.includes('mcp'));
  assert.ok(manifest.axes.includes('custom-axis'));
  assert.ok(manifest.routes.some((route) => route.id === 'mcp.shared'));
  assert.ok(manifest.routes.some((route) => route.id === 'container-runtime'));
  assert.ok(manifest.routes.some((route) => route.id === 'custom'));
  assert.ok(manifest.graphHints.some((hint) => hint.includes('Neo4j Memory Graph')));
});

test('encodeFunesteZenContainer round trips with private manifest defaults', () => {
  const archive = encodeFunesteZenContainer({ shard: 'alpha' }, {
    key: 'funeste-test-key',
    manifest: {
      source: { id: 'test' }
    }
  });

  const decoded = decodeFunesteZenContainer(archive, { key: 'funeste-test-key' });
  assert.equal(decoded.container.manifest.source.id, 'test');
  assert.equal(decoded.container.manifest.zone.runtime, 'nossen-docker');
  assert.deepEqual(decoded.container.data.value, { shard: 'alpha' });
});

test('file helpers preserve original payload through private container envelope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funeste-zen-'));
  const source = path.join(dir, 'input.txt');
  const archive = path.join(dir, 'input.zen');
  const output = path.join(dir, 'output.txt');
  fs.writeFileSync(source, 'hello private zen\n');

  assert.equal(encodeFunesteZenFile(source, archive, { key: 'file-key' }), archive);
  const decoded = decodeFunesteZenFile(archive, output, { key: 'file-key' });

  assert.equal(decoded.container.manifest.source.fileName, 'input.txt');
  assert.equal(fs.readFileSync(output, 'utf8'), 'hello private zen\n');
  assert.equal(materializeContainerData(decoded.container).toString('utf8'), 'hello private zen\n');
});

test('encodeFunesteZenContainer refuses plaintext unless explicit fixture mode is enabled', () => {
  assert.throws(() => encodeFunesteZenContainer({ secret: true }), /FUNESTE_ZEN_KEY|ZEN_KEY/);

  const archive = encodeFunesteZenContainer({ fixture: true }, { allowPlaintext: true });
  const decoded = decodeFunesteZenContainer(archive, { allowPlaintext: true });
  assert.deepEqual(decoded.container.data.value, { fixture: true });
});

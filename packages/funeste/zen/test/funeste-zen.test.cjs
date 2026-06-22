'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildFunesteZenManifest,
  decodeFunesteZenContainer,
  decodeFunesteZenFile,
  encodeFunesteZenFileAsync,
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

test('@funeste/zen 0.1.2 pins and forwards the bounded public async file API', async () => {
  const manifest = require('../package.json');
  assert.equal(manifest.version, '0.1.2');
  assert.equal(manifest.dependencies['@nossen/zen'], '0.1.2');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funeste-zen-limit-'));
  const inputPath = path.join(directory, 'large.bin');
  fs.writeFileSync(inputPath, Buffer.alloc(2048));
  await assert.rejects(
    encodeFunesteZenFileAsync(inputPath, path.join(directory, 'large.zen'), {
      key: 'limit-key',
      maxRawBytes: 1024
    }),
    (error) => error.code === 'ZEN_ERR_LIMIT' && error.limit === 'maxRawBytes'
  );
});

test('private CLI verifies safely as JSON and rejects a wrong key', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funeste-zen-cli-'));
  const inputPath = path.join(directory, 'private.txt');
  const archivePath = path.join(directory, 'private.zen');
  const key = 'cli-private-secret';
  fs.writeFileSync(inputPath, 'private-funeste-value');
  await encodeFunesteZenFileAsync(inputPath, archivePath, { key });

  const bin = path.join(__dirname, '..', 'bin', 'funeste-zen.cjs');
  const ok = spawnSync(process.execPath, [bin, 'verify', '--in', archivePath, '--key-env', 'FUNESTE_CLI_TEST_KEY', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FUNESTE_CLI_TEST_KEY: key, FUNESTE_ZEN_KEY: '', ZEN_KEY: '' }
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).valid, true);
  assert.equal(ok.stdout.includes(key), false);
  assert.equal(ok.stdout.includes('private-funeste-value'), false);

  const wrong = spawnSync(process.execPath, [bin, 'verify', '--in', archivePath, '--key-env', 'FUNESTE_CLI_TEST_KEY', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FUNESTE_CLI_TEST_KEY: 'wrong', FUNESTE_ZEN_KEY: '', ZEN_KEY: '' }
  });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /ZEN_ERR_AUTH/);
});

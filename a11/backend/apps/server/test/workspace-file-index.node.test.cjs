'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  assertSafeWorkspaceRoot,
  collectWorkspaceInventory,
  containsHighConfidenceSecret,
  exclusionReason,
  inferDomains,
  isProbablyBinary,
} = require('../src/knowledge/workspace-file-index.cjs');
const {
  buildDelta,
  parseArgs,
  resolveDefaultWorkspaceRoot,
} = require('../scripts/sync-workspace-files-neo4j.cjs');

test('workspace root guard refuses filesystem, home and broad runtime roots', () => {
  assert.throws(() => assertSafeWorkspaceRoot(path.parse(process.cwd()).root), /filesystem root/);
  assert.throws(() => assertSafeWorkspaceRoot(os.homedir()), /home directory/);
  assert.throws(() => assertSafeWorkspaceRoot(path.join(os.tmpdir(), 'runtime')), /runtime\/data directory/);
  assert.notEqual(resolveDefaultWorkspaceRoot(), path.parse(resolveDefaultWorkspaceRoot()).root);
});

test('workspace index exclusions keep secrets, private runtime, dependencies and models out', () => {
  assert.equal(exclusionReason('C:\\Users\\name\\secret.txt'), 'invalid-path');
  assert.equal(exclusionReason('.env.production'), 'secret-file');
  assert.equal(exclusionReason('secrets/neo4j.json'), 'secret-path');
  assert.equal(exclusionReason('node_modules/pkg/index.js'), 'excluded-directory');
  assert.equal(exclusionReason('runtime/Corpus/private/thread.json'), 'runtime-private');
  assert.equal(exclusionReason('a11/runtime/knowledge-graph/live.json'), 'runtime-private');
  assert.equal(exclusionReason('models/qwen.safetensors'), 'binary-or-model');
  assert.equal(exclusionReason('src/runtime/worker.cjs'), null);
});

test('workspace index detects binary and high-confidence secret material', () => {
  assert.equal(isProbablyBinary(Buffer.from([0, 1, 2, 3])), true);
  assert.equal(isProbablyBinary(Buffer.from('plain source text\n')), false);
  assert.equal(containsHighConfidenceSecret(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nabc')), true);
  assert.equal(containsHighConfidenceSecret(Buffer.from('password examples stay documentation only')), false);
});

test('workspace index infers useful cross-domain metadata', () => {
  const domains = inferDomains('a11/backend/apps/server/scripts/sync-vivy-graph-neo4j.cjs');
  assert.ok(domains.includes('backend'));
  assert.ok(domains.includes('memory-knowledge'));
  assert.ok(domains.includes('audio-voice'));
});

test('workspace inventory is metadata-only, resolves local references and reports exclusions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a11-workspace-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'runtime', 'private'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'a.cjs'), "const b = require('./b');\nmodule.exports = b;\n");
  await fs.writeFile(path.join(root, 'src', 'b.cjs'), "module.exports = 'UNIQUE_RAW_CONTENT_SENTINEL';\n");
  await fs.writeFile(path.join(root, 'docs', 'readme.md'), '[source](../src/a.cjs)\n');
  await fs.writeFile(path.join(root, '.env'), 'TOKEN=should-not-be-read\n');
  await fs.writeFile(path.join(root, 'runtime', 'private', 'session.json'), '{}\n');
  await fs.writeFile(path.join(root, 'unsafe.txt'), '-----BEGIN PRIVATE KEY-----\nnot-real-but-sensitive\n');

  const inventory = await collectWorkspaceInventory({
    rootPath: root,
    rootId: 'fixture',
    generatedAt: '2026-08-08T22:30:00.000Z',
  });

  assert.equal(inventory.files.length, 3);
  assert.equal(inventory.references.length, 2);
  assert.equal(inventory.root.id, 'fixture');
  assert.equal(inventory.root.pathHash.length, 64);
  assert.equal(Object.hasOwn(inventory.root, 'path'), false);
  assert.equal(JSON.stringify(inventory).includes('UNIQUE_RAW_CONTENT_SENTINEL'), false);
  assert.equal(inventory.files.some((file) => file.relativePath.includes('runtime/private')), false);
  assert.ok(inventory.metrics.exclusions.some((entry) => entry.reason === 'secret-file'));
  assert.ok(inventory.metrics.exclusions.some((entry) => entry.reason === 'secret-content'));
});

test('workspace sync delta is idempotent and marks absent records missing', () => {
  const inventory = {
    files: [
      { id: 'same', sha256: 'aaa', sizeBytes: 1, modifiedAt: '2026-08-08T00:00:00.000Z' },
      { id: 'changed', sha256: 'bbb', sizeBytes: 2, modifiedAt: '2026-08-08T00:00:00.000Z' },
      { id: 'new', sha256: 'ccc', sizeBytes: 3, modifiedAt: '2026-08-08T00:00:00.000Z' },
    ],
  };
  const delta = buildDelta(inventory, [
    { id: 'same', sha256: 'aaa', sizeBytes: 1, modifiedAt: '2026-08-08T00:00:00.000Z' },
    { id: 'changed', sha256: 'old', sizeBytes: 2, modifiedAt: '2026-08-08T00:00:00.000Z' },
    { id: 'gone', sha256: 'ddd', sizeBytes: 4, modifiedAt: '2026-08-08T00:00:00.000Z' },
  ]);

  assert.deepEqual(delta.created.map((file) => file.id), ['new']);
  assert.deepEqual(delta.changed.map((file) => file.id), ['changed']);
  assert.deepEqual(delta.unchanged.map((file) => file.id), ['same']);
  assert.deepEqual(delta.missing.map((file) => file.id), ['gone']);
});

test('workspace sync is dry-run unless apply is explicit', () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(['--dry-run']).apply, false);
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.throws(() => parseArgs(['--apply', '--dry-run']), /either --apply or --dry-run/);
});

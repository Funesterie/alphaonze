'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildVivyGraphCorpus,
  buildVivyGraphSourceManifest,
  toManifestMarkdown,
} = require('../src/knowledge/vivy-graph-access.cjs');

test('Vivy graph manifest lists bounded source files without secrets', () => {
  const manifest = buildVivyGraphSourceManifest();

  assert.equal(manifest.schema, 'funesterie.vivy.graph-manifest.v1');
  assert.ok(manifest.summary.total > 10);
  assert.ok(manifest.files.some((file) => file.path === 'a11/docs/VIVY_TWITCH_OBS.md'));
  assert.ok(manifest.files.some((file) => file.path === 'a11/backend/apps/server/src/routes/vivy-studio.cjs'));
  assert.equal(manifest.files.some((file) => /\.env/i.test(file.path)), false);
  assert.equal(manifest.files.some((file) => /secrets?|tokens?|passwords?/i.test(file.path)), false);

  const markdown = toManifestMarkdown(manifest);
  assert.match(markdown, /Vivy Graph Manifest/);
  assert.doesNotMatch(markdown, /password\s*[:=]|token\s*[:=]/i);
});

test('Vivy graph corpus chunks readable files and redacts secret-looking text', () => {
  const corpus = buildVivyGraphCorpus({
    maxChunksPerFile: 4,
    maxFileBytes: 48 * 1024,
  });

  assert.equal(corpus.schema, 'funesterie.vivy.graph-corpus.v1');
  assert.ok(corpus.summary.files > 5);
  assert.ok(corpus.summary.chunks >= corpus.summary.files);
  assert.ok(corpus.files.every((file) => file.id.startsWith('vivy-file:')));
  assert.ok(corpus.chunks.every((chunk) => chunk.id.startsWith('vivy-chunk:')));
  assert.ok(corpus.chunks.every((chunk) => chunk.fileId && chunk.path && chunk.text));
  assert.equal(corpus.chunks.some((chunk) => /(bearer\s+[a-z0-9._~+/=-]{16,}|sk-[a-z0-9_-]{20,}|(?:password|token|secret)\s*=\s*['"][^'"]{8,})/i.test(chunk.text)), false);
});

test('Vivy graph manifest maps backend paths when only the server package is present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vivy-graph-package-root-'));
  try {
    const manifest = buildVivyGraphSourceManifest({
      serverRoot: path.resolve(__dirname, '..'),
      workspaceRoot: tmp,
      a11Root: tmp,
    });
    const studio = manifest.files.find((file) => file.path === 'a11/backend/apps/server/src/routes/vivy-studio.cjs');
    const twitchDoc = manifest.files.find((file) => file.path === 'a11/docs/VIVY_TWITCH_OBS.md');
    assert.equal(studio?.readable, true);
    assert.equal(twitchDoc?.exists, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

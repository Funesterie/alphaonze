'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  autoDescribeImage,
  loadImageBuffer,
  resolveRuntimeImagePathFromLocator,
} = require('../src/image/image-auto-describe.cjs');

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYdX3wAAAABJRU5ErkJggg==',
  'base64'
);

async function withTempRuntime(fn) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-image-runtime-'));
  try {
    return await fn(runtimeRoot);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

test('loadImageBuffer resolves public Funesterie runtime image URLs locally', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const uploadDir = path.join(runtimeRoot, 'files', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const imagePath = path.join(uploadDir, 'demo.png');
    fs.writeFileSync(imagePath, ONE_PIXEL_PNG);

    const resolved = resolveRuntimeImagePathFromLocator(
      'https://a11.funesterie.me/files/runtime/files/uploads/demo.png',
      runtimeRoot
    );
    assert.equal(resolved, imagePath);

    const loaded = await loadImageBuffer(
      'https://a11.funesterie.me/files/runtime/files/uploads/demo.png',
      runtimeRoot
    );
    assert.deepEqual(loaded.buffer, ONE_PIXEL_PNG);
    assert.equal(loaded.contentType, 'image/png');
  });
});

test('loadImageBuffer resolves legacy /files/uploads aliases under runtime files/uploads', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const uploadDir = path.join(runtimeRoot, 'files', 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const imagePath = path.join(uploadDir, 'legacy.png');
    fs.writeFileSync(imagePath, ONE_PIXEL_PNG);

    const loaded = await loadImageBuffer('/files/uploads/legacy.png', runtimeRoot);
    assert.deepEqual(loaded.buffer, ONE_PIXEL_PNG);
    assert.equal(loaded.contentType, 'image/png');
  });
});

test('autoDescribeImage keeps a local fallback when Janus is disabled', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const previousProvider = process.env.A11_VISION_PROVIDER;
    const previousOcrEnabled = process.env.IMAGE_OCR_ENABLED;
    process.env.A11_VISION_PROVIDER = 'none';
    process.env.IMAGE_OCR_ENABLED = 'false';
    try {
      const uploadDir = path.join(runtimeRoot, 'files', 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, 'fallback.png'), ONE_PIXEL_PNG);

      const result = await autoDescribeImage({
        imageLocator: '/files/runtime/files/uploads/fallback.png',
        runtimeRoot,
      });

      assert.equal(result.skipped, false);
      assert.equal(result.fallback, true);
      assert.match(result.provider, /local-image-fallback/);
      assert.match(result.description, /Analyse locale de secours|Image recue/);
    } finally {
      if (previousProvider == null) {
        delete process.env.A11_VISION_PROVIDER;
      } else {
        process.env.A11_VISION_PROVIDER = previousProvider;
      }
      if (previousOcrEnabled == null) {
        delete process.env.IMAGE_OCR_ENABLED;
      } else {
        process.env.IMAGE_OCR_ENABLED = previousOcrEnabled;
      }
    }
  });
});

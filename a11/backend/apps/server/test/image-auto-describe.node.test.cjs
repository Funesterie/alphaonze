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
      assert.equal(result.visualReliable, false);
      assert.match(result.provider, /local-image-fallback/);
      assert.match(result.description, /lecture locale de secours/i);
      assert.match(result.description, /Ne deduis pas le sujet visuel/i);
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

test('autoDescribeImage local fallback skips OCR for tiny images without crashing', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const previousProvider = process.env.A11_VISION_PROVIDER;
    process.env.A11_VISION_PROVIDER = 'none';
    try {
      const uploadDir = path.join(runtimeRoot, 'files', 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, 'tiny.png'), ONE_PIXEL_PNG);

      const result = await autoDescribeImage({
        imageLocator: '/files/runtime/files/uploads/tiny.png',
        runtimeRoot,
      });

      assert.equal(result.skipped, false);
      assert.equal(result.fallback, true);
      assert.equal(result.visualReliable, false);
      assert.equal(result.analysis?.parser, 'image_ocr_skipped_small');
      assert.match(result.description, /1x1px|lecture locale de secours/i);
    } finally {
      if (previousProvider == null) {
        delete process.env.A11_VISION_PROVIDER;
      } else {
        process.env.A11_VISION_PROVIDER = previousProvider;
      }
    }
  });
});

test('autoDescribeImage uses configured remote vision provider without entering Janus', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const previousEnv = {
      A11_VISION_PROVIDER: process.env.A11_VISION_PROVIDER,
      A11_VISION_API_KEY: process.env.A11_VISION_API_KEY,
      A11_VISION_BASE_URL: process.env.A11_VISION_BASE_URL,
      A11_VISION_MODEL: process.env.A11_VISION_MODEL,
    };
    const previousFetch = global.fetch;
    let fetchCalls = 0;

    process.env.A11_VISION_PROVIDER = 'remote';
    process.env.A11_VISION_API_KEY = 'test-vision-key';
    process.env.A11_VISION_BASE_URL = 'https://vision.example.test/v1';
    process.env.A11_VISION_MODEL = 'vision-test-model';
    global.fetch = async (url, options = {}) => {
      fetchCalls += 1;
      assert.equal(String(url), 'https://vision.example.test/v1/chat/completions');
      const body = JSON.parse(String(options.body || '{}'));
      assert.equal(body.model, 'vision-test-model');
      assert.equal(body.messages?.[1]?.content?.[1]?.type, 'image_url');
      assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: 'On voit un carré de test net, utilisé pour valider la vision distante.',
              },
            },
          ],
        }),
      };
    };

    try {
      const uploadDir = path.join(runtimeRoot, 'files', 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, 'remote.png'), ONE_PIXEL_PNG);

      const result = await autoDescribeImage({
        imageLocator: '/files/runtime/files/uploads/remote.png',
        runtimeRoot,
        timeoutMs: 5000,
      });

      assert.equal(fetchCalls, 1);
      assert.equal(result.skipped, false);
      assert.equal(result.fallback, false);
      assert.equal(result.visualReliable, true);
      assert.equal(result.provider, 'remote-vision:vision-test-model');
      assert.match(result.description, /vision distante/i);
    } finally {
      global.fetch = previousFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test('autoDescribeImage remote provider falls back locally without starting Janus', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const previousEnv = {
      A11_VISION_PROVIDER: process.env.A11_VISION_PROVIDER,
      A11_VISION_API_KEY: process.env.A11_VISION_API_KEY,
      A11_VISION_BASE_URL: process.env.A11_VISION_BASE_URL,
      A11_VISION_MODEL: process.env.A11_VISION_MODEL,
      A11_JANUS_PYTHON_PATH: process.env.A11_JANUS_PYTHON_PATH,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      VIVY_OPENAI_API_KEY: process.env.VIVY_OPENAI_API_KEY,
      A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
    const previousFetch = global.fetch;
    let fetchCalls = 0;

    process.env.A11_VISION_PROVIDER = 'remote';
    process.env.A11_VISION_API_KEY = 'test-vision-key';
    process.env.A11_VISION_BASE_URL = 'https://vision.example.test/v1';
    process.env.A11_VISION_MODEL = 'vision-test-model';
    process.env.A11_JANUS_PYTHON_PATH = 'Z:\\missing\\janus-python.exe';
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.VIVY_OPENAI_API_KEY;
    delete process.env.A11_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error('remote_down');
    };

    try {
      const uploadDir = path.join(runtimeRoot, 'files', 'uploads');
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, 'remote-down.png'), ONE_PIXEL_PNG);

      const startedAt = Date.now();
      const result = await autoDescribeImage({
        imageLocator: '/files/runtime/files/uploads/remote-down.png',
        runtimeRoot,
        timeoutMs: 5000,
      });

      assert.equal(fetchCalls, 1);
      assert.ok(Date.now() - startedAt < 1500);
      assert.equal(result.skipped, false);
      assert.equal(result.fallback, true);
      assert.equal(result.visualReliable, false);
      assert.equal(result.provider, 'remote-vision+local-image-fallback');
      assert.equal(result.reason, 'remote_vision_unavailable');
    } finally {
      global.fetch = previousFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

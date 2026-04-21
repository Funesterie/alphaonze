const test = require('node:test');
const assert = require('node:assert/strict');

const normalizeMaskImageGenerate = require('../src/mask/normalize-mask-image-generate.cjs');
const {
  resolveImageCanvasPlan,
  resolveSdLocalRenderLimits,
} = require('../src/mask/normalize-mask-image-generate.cjs');
const {
  resolveMaxVerificationRetries,
} = require('../src/mask/image-chat-runtime.cjs');

test('normalizeMaskImageGenerate keeps a 2048 local square canvas for classic SD profiles', () => {
  const previous = {
    A11_LOCAL_MODE: process.env.A11_LOCAL_MODE,
    A11_RUNTIME_PROFILE: process.env.A11_RUNTIME_PROFILE,
    A11_IMAGE_MAX_RENDER_SIDE: process.env.A11_IMAGE_MAX_RENDER_SIDE,
    A11_IMAGE_DEFAULT_WIDTH: process.env.A11_IMAGE_DEFAULT_WIDTH,
    A11_IMAGE_DEFAULT_HEIGHT: process.env.A11_IMAGE_DEFAULT_HEIGHT,
    SD_MODEL_PROFILE: process.env.SD_MODEL_PROFILE,
  };

  process.env.A11_LOCAL_MODE = '1';
  process.env.A11_RUNTIME_PROFILE = 'local';
  process.env.A11_IMAGE_MAX_RENDER_SIDE = '2048';
  process.env.A11_IMAGE_DEFAULT_WIDTH = '2048';
  process.env.A11_IMAGE_DEFAULT_HEIGHT = '2048';
  process.env.SD_MODEL_PROFILE = 'classic';

  try {
    const normalized = normalizeMaskImageGenerate({
      inputs: { subject: ['Monkey D. Luffy'] },
    });

    assert.equal(normalized.options.width, 2048);
    assert.equal(normalized.options.height, 2048);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('normalizeMaskImageGenerate applies the sd35 square guard to 2048x2048 requests', () => {
  const previous = {
    A11_LOCAL_MODE: process.env.A11_LOCAL_MODE,
    A11_RUNTIME_PROFILE: process.env.A11_RUNTIME_PROFILE,
    A11_IMAGE_MAX_RENDER_SIDE: process.env.A11_IMAGE_MAX_RENDER_SIDE,
    A11_IMAGE_DEFAULT_WIDTH: process.env.A11_IMAGE_DEFAULT_WIDTH,
    A11_IMAGE_DEFAULT_HEIGHT: process.env.A11_IMAGE_DEFAULT_HEIGHT,
    SD_MODEL_PROFILE: process.env.SD_MODEL_PROFILE,
  };

  process.env.A11_LOCAL_MODE = '1';
  process.env.A11_RUNTIME_PROFILE = 'local';
  process.env.A11_IMAGE_MAX_RENDER_SIDE = '2048';
  process.env.A11_IMAGE_DEFAULT_WIDTH = '2048';
  process.env.A11_IMAGE_DEFAULT_HEIGHT = '2048';
  process.env.SD_MODEL_PROFILE = 'sd35';

  try {
    const normalized = normalizeMaskImageGenerate({
      options: {
        width: 2048,
        height: 2048,
      },
    });

    assert.equal(normalized.options.width, 1536);
    assert.equal(normalized.options.height, 1536);
    assert.equal(normalized.meta?.renderSizing?.renderPolicy, 'sd35_area_guard+square_guard');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('resolveSdLocalRenderLimits keeps 1536x2048 portraits but guards sd35 square canvases', () => {
  const portrait = resolveSdLocalRenderLimits({
    env: { SD_MODEL_PROFILE: 'sd35', A11_IMAGE_MAX_SIZE: '2048' },
    width: 1536,
    height: 2048,
  });
  assert.equal(portrait.maxSide, 2048);
  assert.equal(portrait.maxPixels, 2048 * 1536);
  assert.equal(portrait.policy, 'sd35_area_guard');

  const square = resolveSdLocalRenderLimits({
    env: { SD_MODEL_PROFILE: 'sd35', A11_IMAGE_MAX_SIZE: '2048' },
    width: 2048,
    height: 2048,
  });
  assert.equal(square.maxSide, 1536);
  assert.equal(square.maxPixels, 2048 * 1536);
  assert.equal(square.policy, 'sd35_area_guard+square_guard');
});

test('local image runtime disables automatic verification retries by default', () => {
  const previous = {
    A11_LOCAL_MODE: process.env.A11_LOCAL_MODE,
    A11_RUNTIME_PROFILE: process.env.A11_RUNTIME_PROFILE,
    A11_IMAGE_CARDINALITY_MAX_RETRIES: process.env.A11_IMAGE_CARDINALITY_MAX_RETRIES,
    A11_IMAGE_VERIFY_MAX_RETRIES: process.env.A11_IMAGE_VERIFY_MAX_RETRIES,
  };

  process.env.A11_LOCAL_MODE = '1';
  process.env.A11_RUNTIME_PROFILE = 'local';
  delete process.env.A11_IMAGE_CARDINALITY_MAX_RETRIES;
  delete process.env.A11_IMAGE_VERIFY_MAX_RETRIES;

  try {
    assert.equal(resolveMaxVerificationRetries(), 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('normalizeMaskImageGenerate auto-resolves a larger square canvas when no size is provided', () => {
  const previous = {
    A11_LOCAL_MODE: process.env.A11_LOCAL_MODE,
    A11_RUNTIME_PROFILE: process.env.A11_RUNTIME_PROFILE,
    A11_IMAGE_MAX_RENDER_SIDE: process.env.A11_IMAGE_MAX_RENDER_SIDE,
    A11_IMAGE_DEFAULT_WIDTH: process.env.A11_IMAGE_DEFAULT_WIDTH,
    A11_IMAGE_DEFAULT_HEIGHT: process.env.A11_IMAGE_DEFAULT_HEIGHT,
  };

  delete process.env.A11_LOCAL_MODE;
  delete process.env.A11_RUNTIME_PROFILE;
  process.env.A11_IMAGE_MAX_RENDER_SIDE = '2048';
  delete process.env.A11_IMAGE_DEFAULT_WIDTH;
  delete process.env.A11_IMAGE_DEFAULT_HEIGHT;

  try {
    const normalized = normalizeMaskImageGenerate({
      raw: 'un kraken',
      inputs: { subject: ['kraken'] },
      meta: { subjectProfile: { type: 'mythic_creature' } },
    });

    assert.equal(normalized.options.width, 1024);
    assert.equal(normalized.options.height, 1024);
    assert.equal(normalized.meta?.renderSizing?.source, 'auto_scene');
    assert.equal(normalized.meta?.renderSizing?.reason, 'single_subject_square');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('resolveImageCanvasPlan prefers a wider auto canvas for group scenes', () => {
  const previous = {
    A11_IMAGE_MAX_RENDER_SIDE: process.env.A11_IMAGE_MAX_RENDER_SIDE,
    A11_IMAGE_DEFAULT_WIDTH: process.env.A11_IMAGE_DEFAULT_WIDTH,
    A11_IMAGE_DEFAULT_HEIGHT: process.env.A11_IMAGE_DEFAULT_HEIGHT,
  };

  process.env.A11_IMAGE_MAX_RENDER_SIDE = '2048';
  delete process.env.A11_IMAGE_DEFAULT_WIDTH;
  delete process.env.A11_IMAGE_DEFAULT_HEIGHT;

  try {
    const plan = resolveImageCanvasPlan({
      prompt: 'les Mugiwaras ensemble',
      env: process.env,
    });

    assert.equal(plan.source, 'auto_scene');
    assert.equal(plan.reason, 'multi_subject_scene');
    assert.equal(plan.width, 1536);
    assert.equal(plan.height, 896);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

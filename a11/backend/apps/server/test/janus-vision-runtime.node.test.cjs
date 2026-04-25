const test = require('node:test');
const assert = require('node:assert/strict');

const {
  callJanusText,
  resolveJanusVisionConfig,
  resolveVisionProvider,
} = require('../lib/janus-vision-runtime.cjs');

function withEnv(patch, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('resolveVisionProvider honors explicit Janus selection', () => {
  withEnv({
    A11_VISION_PROVIDER: 'janus',
    A11_VISION_BASE_URL: 'https://vision.example.com',
  }, () => {
    assert.equal(resolveVisionProvider(), 'janus');
  });
});

test('resolveVisionProvider keeps remote mode when only remote vision is configured', () => {
  withEnv({
    A11_VISION_PROVIDER: undefined,
    A11_JANUS_ENABLED: undefined,
    A11_JANUS_MODEL_ID: undefined,
    A11_VISION_BASE_URL: 'https://vision.example.com',
    NODE_ENV: 'production',
  }, () => {
    assert.equal(resolveVisionProvider(), 'remote');
  });
});

test('resolveJanusVisionConfig keeps Janus on the cpu-safe 1B profile by default', () => {
  withEnv({
    A11_LOCAL_MODE: 'true',
    A11_JANUS_DEVICE: undefined,
    A11_JANUS_MODEL_ID: undefined,
    A11_JANUS_MODEL_DIR: undefined,
    A11_LOCAL_VISION_MODEL_DIR: undefined,
    A11_JANUS_PREFER_LATEST: undefined,
  }, () => {
    const config = resolveJanusVisionConfig({});
    assert.match(String(config.modelRef || ''), /Janus-Pro-1B|deepseek-ai\/Janus-Pro-1B/i);
    assert.match(String(config.pythonBin || ''), /(tools[\\/](vision|sd)[\\/]venv|[\\/]opt[\\/]janus-venv)/i);
    assert.equal(config.provider, 'janus');
    assert.equal(config.device, 'cpu');
  });
});

test('resolveJanusVisionConfig keeps Janus-Pro-1B as the default cpu-safe profile', () => {
  withEnv({
    NODE_ENV: 'production',
    A11_LOCAL_MODE: undefined,
    A11_JANUS_DEVICE: 'cpu',
    A11_JANUS_MODEL_ID: undefined,
    A11_JANUS_MODEL_DIR: undefined,
    A11_LOCAL_VISION_MODEL_DIR: undefined,
    A11_JANUS_PREFER_LATEST: 'false',
  }, () => {
    const config = resolveJanusVisionConfig({});
    assert.match(String(config.modelRef || ''), /Janus-Pro-1B|deepseek-ai\/Janus-Pro-1B/i);
    assert.equal(config.device, 'cpu');
  });
});

test('resolveJanusVisionConfig still honors an explicit cuda override for Janus', () => {
  withEnv({
    A11_LOCAL_MODE: 'true',
    A11_JANUS_DEVICE: 'cuda',
    A11_JANUS_MODEL_ID: undefined,
    A11_JANUS_MODEL_DIR: undefined,
    A11_LOCAL_VISION_MODEL_DIR: undefined,
    A11_JANUS_PREFER_LATEST: 'true',
  }, () => {
    const config = resolveJanusVisionConfig({});
    assert.match(String(config.modelRef || ''), /Janus-Pro-7B|deepseek-ai\/Janus-Pro-7B/i);
    assert.equal(config.device, 'cuda');
  });
});

test('janus runtime exports a text-only call helper for sequence planning', () => {
  assert.equal(typeof callJanusText, 'function');
});

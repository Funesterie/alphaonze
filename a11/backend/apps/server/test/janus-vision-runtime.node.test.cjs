const test = require('node:test');
const assert = require('node:assert/strict');

const {
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

test('resolveJanusVisionConfig defaults to Janus-Pro-1B and backend venv python', () => {
  const config = resolveJanusVisionConfig({});
  assert.match(String(config.modelRef || ''), /Janus-Pro-1B|deepseek-ai\/Janus-Pro-1B/i);
  assert.match(String(config.pythonBin || ''), /(tools[\\/](vision|sd)[\\/]venv|[\\/]opt[\\/]janus-venv)/i);
  assert.equal(config.provider, 'janus');
});

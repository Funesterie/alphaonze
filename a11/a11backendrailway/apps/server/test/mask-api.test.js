// Minimal tests for /api/mask/compile
const assert = require('assert');
const axios = require('axios');

const BASE = 'http://127.0.0.1:3000';

async function testValidMask() {
  const mask = {
    version: 'mask-1',
    intent: 'code.python.generate',
    task: { domain: 'filesystem', action: 'sort_images' },
    compiler: { target: 'python', version: '1.0' },
    inputs: { path: '.', extensions: ['.png', '.jpg'], recursive: false },
    options: { sort_by: 'name' }
  };
  const res = await axios.post(BASE + '/api/mask/compile', mask, { validateStatus: () => true });
  assert.strictEqual(res.status, 200, 'Should return 200 for valid MASK');
  assert.ok(res.data.code && res.data.code.includes('import os'), 'Should return Python code');
}

async function testInvalidMask() {
  const mask = { foo: 'bar' };
  const res = await axios.post(BASE + '/api/mask/compile', mask, { validateStatus: () => true });
  assert.strictEqual(res.status, 400, 'Should return 400 for invalid MASK');
}

async function testUnsupportedIntent() {
  const mask = {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'filesystem', action: 'sort_images' },
    compiler: { target: 'python', version: '1.0' },
    inputs: { path: '.', extensions: ['.png'], recursive: false },
    options: { sort_by: 'name' }
  };
  const res = await axios.post(BASE + '/api/mask/compile', mask, { validateStatus: () => true });
  assert.strictEqual(res.status, 400, 'Should return 400 for unsupported intent');
}

(async () => {
  await testValidMask();
  await testInvalidMask();
  await testUnsupportedIntent();
  console.log('All MASK API tests passed.');
})();

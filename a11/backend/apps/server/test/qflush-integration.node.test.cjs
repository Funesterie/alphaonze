const test = require('node:test');
const assert = require('node:assert/strict');

const { runQflushFlow } = require('../src/qflush-integration.cjs');

function snapshotEnv(keys) {
  const snapshot = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('runQflushFlow prefers the explicit Qflush remote over Dragon', async () => {
  const envSnapshot = snapshotEnv([
    'QFLUSH_URL',
    'QFLUSH_REMOTE_URL',
    'QFLUSH_BASE_URL',
    'DRAGON_API_URL',
    'A11_QFLUSH_USE_DRAGON',
    'QFLUSH_TOKEN',
    'NEZ_ADMIN_TOKEN',
    'A11_QFLUSH_REMOTE_TIMEOUT_MS',
    'A11_QFLUSH_REMOTE_RETRIES',
  ]);
  const originalFetch = global.fetch;

  try {
    process.env.QFLUSH_URL = 'https://qflush.example.com';
    process.env.DRAGON_API_URL = 'https://dragon.example.com';
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';
    process.env.QFLUSH_TOKEN = 'token-123';

    let capturedUrl = '';
    let capturedHeaders = null;
    let capturedBody = null;
    global.fetch = async (url, options = {}) => {
      capturedUrl = String(url);
      capturedHeaders = options.headers || null;
      capturedBody = options.body ? JSON.parse(options.body) : null;
      return new Response(JSON.stringify({ ok: true, target: 'qflush' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await runQflushFlow('a11.chat.v1', { prompt: 'ping' }, { requestId: 'req-1' });

    assert.equal(capturedUrl, 'https://qflush.example.com/api/admin/run');
    assert.equal(capturedHeaders['X-Request-Id'], 'req-1');
    assert.equal(capturedHeaders['X-NEZ-ADMIN'], 'token-123');
    assert.equal(capturedBody.target, 'qflush');
    assert.deepEqual(result, { ok: true, target: 'qflush' });
  } finally {
    global.fetch = originalFetch;
    restoreEnv(envSnapshot);
  }
});

test('runQflushFlow only uses Dragon as a Qflush runner when the compat flag is enabled', async () => {
  const envSnapshot = snapshotEnv([
    'QFLUSH_URL',
    'QFLUSH_REMOTE_URL',
    'QFLUSH_BASE_URL',
    'DRAGON_API_URL',
    'A11_QFLUSH_USE_DRAGON',
    'A11_QFLUSH_REMOTE_TIMEOUT_MS',
    'A11_QFLUSH_REMOTE_RETRIES',
  ]);
  const originalFetch = global.fetch;

  try {
    process.env.DRAGON_API_URL = 'https://dragon.example.com';
    delete process.env.QFLUSH_URL;
    delete process.env.QFLUSH_REMOTE_URL;
    delete process.env.QFLUSH_BASE_URL;
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';

    process.env.A11_QFLUSH_USE_DRAGON = 'true';
    let calledUrl = '';
    global.fetch = async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ ok: true, target: 'dragon' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await runQflushFlow('a11.chat.v1', { prompt: 'ping' }, { requestId: 'req-2' });
    assert.equal(calledUrl, 'https://dragon.example.com/api/admin/run');
    assert.deepEqual(result, { ok: true, target: 'dragon' });
  } finally {
    global.fetch = originalFetch;
    restoreEnv(envSnapshot);
  }
});

test('runQflushFlow surfaces an actionable upstream error payload', async () => {
  const envSnapshot = snapshotEnv([
    'QFLUSH_URL',
    'QFLUSH_REMOTE_URL',
    'QFLUSH_BASE_URL',
    'DRAGON_API_URL',
    'A11_QFLUSH_USE_DRAGON',
    'A11_QFLUSH_REMOTE_TIMEOUT_MS',
    'A11_QFLUSH_REMOTE_RETRIES',
  ]);
  const originalFetch = global.fetch;

  try {
    process.env.QFLUSH_URL = 'https://qflush.example.com';
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';
    global.fetch = async () => new Response(JSON.stringify({
      ok: false,
      error: 'bad_gateway',
      message: 'upstream failed',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });

    await assert.rejects(
      runQflushFlow('a11.chat.v1', { prompt: 'ping' }, { requestId: 'req-3' }),
      (error_) => {
        assert.equal(error_.status, 502);
        assert.equal(error_.error, 'qflush_unreachable');
        assert.equal(error_.requestId, 'req-3');
        assert.equal(error_.upstream.url, 'https://qflush.example.com/api/admin/run');
        assert.equal(error_.upstream.status, 503);
        assert.match(String(error_.upstream.body || ''), /upstream failed/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
    restoreEnv(envSnapshot);
  }
});

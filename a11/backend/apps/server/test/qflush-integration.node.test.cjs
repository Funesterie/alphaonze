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

test('runQflushFlow normalizes a status endpoint into the remote runner origin', async () => {
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
    delete process.env.QFLUSH_URL;
    process.env.QFLUSH_REMOTE_URL = 'https://a11.funesterie.me/api/qflush/status';
    delete process.env.QFLUSH_BASE_URL;
    delete process.env.DRAGON_API_URL;
    delete process.env.A11_QFLUSH_USE_DRAGON;
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';

    let capturedUrl = '';
    global.fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ ok: true, target: 'qflush' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await runQflushFlow('a11.memory.ephemeral.v1', { key: 'ping' }, { requestId: 'req-status-url' });

    assert.equal(capturedUrl, 'https://a11.funesterie.me/api/admin/run');
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
    'A11_QFLUSH_REMOTE_STRICT',
    'QFLUSH_REMOTE_STRICT',
  ]);
  const originalFetch = global.fetch;

  try {
    process.env.QFLUSH_URL = 'https://qflush.example.com';
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';
    process.env.A11_QFLUSH_REMOTE_STRICT = 'true';
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

test('runQflushFlow falls back locally when a non-loopback remote is unavailable by default', async () => {
  const envSnapshot = snapshotEnv([
    'QFLUSH_URL',
    'QFLUSH_REMOTE_URL',
    'QFLUSH_BASE_URL',
    'DRAGON_API_URL',
    'A11_QFLUSH_USE_DRAGON',
    'A11_QFLUSH_REMOTE_TIMEOUT_MS',
    'A11_QFLUSH_REMOTE_RETRIES',
    'A11_QFLUSH_REMOTE_STRICT',
    'QFLUSH_REMOTE_STRICT',
  ]);
  const originalFetch = global.fetch;

  try {
    process.env.QFLUSH_URL = 'https://qflush.example.com';
    delete process.env.QFLUSH_REMOTE_URL;
    delete process.env.QFLUSH_BASE_URL;
    delete process.env.DRAGON_API_URL;
    delete process.env.A11_QFLUSH_USE_DRAGON;
    delete process.env.A11_QFLUSH_REMOTE_STRICT;
    delete process.env.QFLUSH_REMOTE_STRICT;
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';
    global.fetch = async () => {
      throw new Error('fetch failed');
    };

    const result = await runQflushFlow('a11.memory.summary.v1', {
      messages: [{ role: 'user', content: 'bonjour' }],
    }, { requestId: 'req-non-loopback-fallback' });

    assert.equal(result.ok, true);
    assert.equal(typeof result.output, 'string');
    assert.match(result.output, /bonjour/);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(envSnapshot);
  }
});

test('runQflushFlow falls back to the local qflush module when the loopback daemon is unavailable', async () => {
  const envSnapshot = snapshotEnv([
    'QFLUSH_URL',
    'QFLUSH_REMOTE_URL',
    'QFLUSH_BASE_URL',
    'DRAGON_API_URL',
    'A11_QFLUSH_USE_DRAGON',
    'A11_QFLUSH_REMOTE_TIMEOUT_MS',
    'A11_QFLUSH_REMOTE_RETRIES',
    'A11_QFLUSH_REMOTE_STRICT',
    'QFLUSH_REMOTE_STRICT',
  ]);

  try {
    process.env.QFLUSH_URL = 'http://127.0.0.1:65531';
    delete process.env.QFLUSH_REMOTE_URL;
    delete process.env.QFLUSH_BASE_URL;
    delete process.env.DRAGON_API_URL;
    delete process.env.A11_QFLUSH_USE_DRAGON;
    process.env.A11_QFLUSH_REMOTE_TIMEOUT_MS = '50';
    process.env.A11_QFLUSH_REMOTE_RETRIES = '0';

    const result = await runQflushFlow('a11.memory.summary.v1', {
      messages: [{ role: 'user', content: 'bonjour' }],
    }, { requestId: 'req-local-fallback-1' });

    assert.equal(result.ok, true);
    assert.equal(typeof result.output, 'string');
  } finally {
    restoreEnv(envSnapshot);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const createAdminRunRouter = require('../src/routes/admin-run.cjs');
const createProtectedChatProxyRouter = require('../src/routes/protected-chat-proxy.cjs');

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  registerRoutes(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error_) => (error_ ? reject(error_) : resolve()));
    });
  }
}

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

test('protected chat proxy returns requestId in header and body when upstream throws', async () => {
  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(_req, _res, next) {
          next();
        },
        proxyChatToOpenAI() {
          throw new Error('boom');
        },
        detectImageIntent: () => false,
        detectWebImageIntent: () => false,
        generateSd: async () => {
          throw new Error('should_not_be_called');
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/llm/chat', {
        messages: [{ role: 'user', content: 'hello' }],
      }, {
        'X-Request-Id': 'req-proxy-1',
      });

      assert.equal(response.status, 502);
      assert.equal(response.headers.get('x-request-id'), 'req-proxy-1');
      assert.equal(json.requestId, 'req-proxy-1');
      assert.equal(json.error, 'proxy_error');
      assert.equal(json.message, 'boom');
    }
  );
});

test('admin run returns requestId and upstream diagnostics on remote failures', async () => {
  await withServer(
    (app) => {
      app.use('/api', createAdminRunRouter({
        isAdminRequest: () => true,
        async runQflushFlow() {
          const error = new Error('Remote flow unreachable');
          error.status = 502;
          error.error = 'qflush_unreachable';
          error.upstream = {
            url: 'https://qflush.example.com/api/admin/run',
            status: 503,
            body: '{"ok":false,"message":"upstream failed"}',
          };
          throw error;
        },
      }));
    },
    async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/admin/run', {
        flow: 'a11.chat.v1',
        payload: { prompt: 'ping' },
      }, {
        'X-Request-Id': 'req-admin-1',
      });

      assert.equal(response.status, 502);
      assert.equal(response.headers.get('x-request-id'), 'req-admin-1');
      assert.equal(json.requestId, 'req-admin-1');
      assert.equal(json.error, 'qflush_unreachable');
      assert.equal(json.upstream.url, 'https://qflush.example.com/api/admin/run');
      assert.equal(json.upstream.status, 503);
      assert.match(String(json.upstream.body || ''), /upstream failed/);
    }
  );
});

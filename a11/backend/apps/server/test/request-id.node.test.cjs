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

test('protected chat proxy sanitizes upstream html timeout pages', async () => {
  await withServer(
    (app) => {
      app.use('/api', createProtectedChatProxyRouter({
        verifyJWT(_req, _res, next) {
          next();
        },
        proxyChatToOpenAI() {
          const error = new Error('<!DOCTYPE html><html><head><title>funesterie.me | 524: A timeout occurred</title></head><body>Error code 524</body></html>');
          error.status = 504;
          error.upstream = {
            url: 'https://sd.funesterie.me/v1/chat/completions',
            status: 524,
            body: '<!DOCTYPE html><html><head><title>funesterie.me | 524: A timeout occurred</title></head><body>Error code 524</body></html>',
          };
          throw error;
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
        'X-Request-Id': 'req-proxy-html-1',
      });

      assert.equal(response.status, 504);
      assert.equal(json.requestId, 'req-proxy-html-1');
      assert.equal(json.message, 'Upstream timeout (Cloudflare 524)');
      assert.equal(json.upstream.status, 524);
      assert.equal(json.upstream.body, 'Upstream timeout (Cloudflare 524)');
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

test('protected chat proxy reuses short cache for standard image requests', async () => {
  const previousGuard = process.env.A11_IMAGE_CARDINALITY_GUARD;
  process.env.A11_IMAGE_CARDINALITY_GUARD = 'false';
  let callCount = 0;

  try {
    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(_req, _res, next) {
            next();
          },
          proxyChatToOpenAI() {
            throw new Error('should_not_hit_openai_proxy');
          },
          generateSd: async () => {
            callCount += 1;
            return {
              ok: true,
              image_url: '',
              filename: 'apple.png',
            };
          },
        }));
      },
      async (baseUrl) => {
        const body = {
          messages: [{ role: 'user', content: 'genere une image de pomme' }],
        };

        const first = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-cache-1',
        });
        const second = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-cache-2',
        });

        assert.equal(first.response.status, 200);
        assert.equal(second.response.status, 200);
        assert.equal(callCount, 1);
      }
    );
  } finally {
    if (previousGuard === undefined) delete process.env.A11_IMAGE_CARDINALITY_GUARD;
    else process.env.A11_IMAGE_CARDINALITY_GUARD = previousGuard;
  }
});

test('protected chat proxy bypasses short cache for special compiler image requests', async () => {
  const previousGuard = process.env.A11_IMAGE_CARDINALITY_GUARD;
  process.env.A11_IMAGE_CARDINALITY_GUARD = 'false';
  let callCount = 0;

  try {
    await withServer(
      (app) => {
        app.use('/api', createProtectedChatProxyRouter({
          verifyJWT(_req, _res, next) {
            next();
          },
          proxyChatToOpenAI() {
            throw new Error('should_not_hit_openai_proxy');
          },
          specialCompilerCallStructuredLlmJson: async () => ({
            composition_hints: ['accessoire bien visible'],
            environment_hints: ['décor simple et lisible'],
            style_hints: [],
            prompt_instructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
          }),
          generateSd: async () => {
            callCount += 1;
            return {
              ok: true,
              image_url: '',
              filename: 'rabbit.png',
            };
          },
        }));
      },
      async (baseUrl) => {
        const body = {
          messages: [{ role: 'user', content: 'genere une image d un lapin avec une carotte dans la bouche' }],
        };

        const first = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-special-1',
        });
        const second = await postJson(baseUrl, '/api/llm/chat', body, {
          'X-Request-Id': 'req-proxy-special-2',
        });

        assert.equal(first.response.status, 200);
        assert.equal(second.response.status, 200);
        assert.equal(callCount, 2);
      }
    );
  } finally {
    if (previousGuard === undefined) delete process.env.A11_IMAGE_CARDINALITY_GUARD;
    else process.env.A11_IMAGE_CARDINALITY_GUARD = previousGuard;
  }
});

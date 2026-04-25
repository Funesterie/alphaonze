const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const createA11MemoryWriteRouter = require('../src/routes/a11-memory-write.cjs');
const { createIsAdminRequest } = require('../src/security/admin-access.cjs');

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

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : null,
  };
}

test('memory write requires strong admin access before persisting', async () => {
  const writes = [];
  const isAdminRequest = createIsAdminRequest({
    env: {
      NEZ_ADMIN_TOKEN: 'shared-secret',
    },
  });

  await withServer(
    (app) => {
      app.use(
        '/api',
        createA11MemoryWriteRouter({
          isAdminRequest,
          verifyJWT(req, res, next) {
            const bearer = String(req.headers.authorization || '')
              .replace(/^Bearer\s+/i, '')
              .trim();

            if (!bearer) {
              return res.status(401).json({
                error: 'A11_JWT_Missing',
                message: 'JWT token manquant',
              });
            }

            if (bearer === 'admin-jwt') {
              req.user = {
                id: 'admin-user',
                username: 'alice',
                role: 'admin',
              };
              return next();
            }

            if (bearer === 'user-jwt') {
              req.user = {
                id: 'user',
                username: 'alice',
                role: 'user',
              };
              return next();
            }

            return res.status(401).json({
              error: 'A11_JWT_Invalid',
              message: 'JWT invalide',
            });
          },
          writeMemoryKeyValue(key, value) {
            writes.push({ key, value });
            return { ok: true, key, value };
          },
        })
      );
    },
    async (baseUrl) => {
      const weakHeader = await postJson(baseUrl, '/api/a11/memory/write', {
        key: 'secret',
        value: 'blocked',
      }, {
        'x-nez-admin': 'true',
      });
      assert.equal(weakHeader.response.status, 401);
      assert.equal(writes.length, 0);

      const sharedToken = await postJson(baseUrl, '/api/a11/memory/write', {
        key: 'shared',
        value: 'token',
      }, {
        authorization: 'Bearer shared-secret',
      });
      assert.equal(sharedToken.response.status, 200);
      assert.equal(sharedToken.json.ok, true);
      assert.deepEqual(writes[0], { key: 'shared', value: 'token' });

      const adminJwt = await postJson(baseUrl, '/api/a11/memory/write', {
        key: 'jwt',
        value: 'admin',
      }, {
        authorization: 'Bearer admin-jwt',
      });
      assert.equal(adminJwt.response.status, 200);
      assert.equal(adminJwt.json.ok, true);
      assert.deepEqual(writes[1], { key: 'jwt', value: 'admin' });

      const nonAdminJwt = await postJson(baseUrl, '/api/a11/memory/write', {
        key: 'user',
        value: 'blocked',
      }, {
        authorization: 'Bearer user-jwt',
      });
      assert.equal(nonAdminJwt.response.status, 403);
      assert.equal(writes.length, 2);
    }
  );
});

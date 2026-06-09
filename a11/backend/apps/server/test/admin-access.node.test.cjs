const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
  createIsAdminRequest,
  createRequireAdminAccess,
} = require('../src/security/admin-access.cjs');

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

test('createIsAdminRequest rejects weak admin header shorthands', () => {
  const isAdminRequest = createIsAdminRequest({
    env: {
      NEZ_ADMIN_TOKEN: 'shared-secret',
    },
    defaultAdminUsername: 'Djeff',
  });

  for (const value of ['1', 'true', 'yes', 'admin']) {
    assert.equal(
      isAdminRequest({
        headers: {
          'x-nez-admin': value,
        },
      }),
      false
    );
  }

  assert.equal(
    isAdminRequest({
      headers: {
        'x-nez-admin': 'shared-secret',
      },
    }),
    false
  );
  assert.equal(
    isAdminRequest({
      headers: {
        'x-nez-token': 'shared-secret',
      },
    }),
    false
  );
});

test('createIsAdminRequest accepts only configured admin tokens or verified admin users', () => {
  const isAdminRequest = createIsAdminRequest({
    env: {
      NEZ_ADMIN_TOKEN: 'shared-secret',
      QFLUSH_TOKEN: 'qflush-secret',
    },
    defaultAdminUsername: 'Djeff',
  });

  assert.equal(
    isAdminRequest({
      headers: {
        authorization: 'Bearer shared-secret',
      },
    }),
    true
  );

  assert.equal(
    isAdminRequest({
      headers: {
        'x-qflush-token': 'qflush-secret',
      },
    }),
    true
  );

  assert.equal(
    isAdminRequest({
      user: {
        id: 'alice',
        username: 'alice',
        role: 'admin',
      },
    }),
    true
  );

  assert.equal(
    isAdminRequest({
      user: {
        id: 'djeff-id',
        username: 'Djeff',
        role: 'user',
      },
    }),
    true
  );

  assert.equal(
    isAdminRequest({
      user: {
        id: 'owner-id',
        username: 'generated-oauth-name',
        email: 'cellaurojeffrey@gmail.com',
        role: 'user',
      },
    }),
    true
  );

  assert.equal(
    isAdminRequest({
      user: {
        id: 'ops-id',
        username: 'ops',
        email: 'ops@example.test',
        role: 'user',
      },
    }),
    false
  );

  assert.equal(
    isAdminRequest({
      user: {
        id: 'alice',
        username: 'alice',
        role: 'user',
      },
    }),
    false
  );
});

test('requireAdminAccess accepts configured admin tokens, falls back to admin JWT, and blocks weak or non-admin access', async () => {
  const isAdminRequest = createIsAdminRequest({
    env: {
      NEZ_ADMIN_TOKEN: 'shared-secret',
    },
  });

  await withServer(
    (app) => {
      app.post(
        '/secure',
        express.json(),
        createRequireAdminAccess({
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
                id: 'normal-user',
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
        }),
        (_req, res) => res.json({ ok: true })
      );
    },
    async (baseUrl) => {
      const weakHeader = await postJson(baseUrl, '/secure', {}, {
        'x-nez-admin': 'true',
      });
      assert.equal(weakHeader.response.status, 401);
      assert.equal(weakHeader.json.error, 'A11_JWT_Missing');

      const sharedToken = await postJson(baseUrl, '/secure', {}, {
        authorization: 'Bearer shared-secret',
      });
      assert.equal(sharedToken.response.status, 200);
      assert.equal(sharedToken.json.ok, true);

      const adminJwt = await postJson(baseUrl, '/secure', {}, {
        authorization: 'Bearer admin-jwt',
      });
      assert.equal(adminJwt.response.status, 200);
      assert.equal(adminJwt.json.ok, true);

      const nonAdminJwt = await postJson(baseUrl, '/secure', {}, {
        authorization: 'Bearer user-jwt',
      });
      assert.equal(nonAdminJwt.response.status, 403);
      assert.equal(nonAdminJwt.json.error, 'admin_required');
    }
  );
});

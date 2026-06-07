const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createVerifyJWT,
  isPublicAuthRoute,
  shouldBypassJwtForLocalDev,
} = require('../src/middleware/jwt-auth.cjs');

function localRequest(headers = {}) {
  return {
    hostname: '127.0.0.1',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers,
  };
}

function remoteRequest(headers = {}) {
  return {
    hostname: 'k44.funesterie.me',
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
    headers,
  };
}

test('local browser bypass header is accepted only on loopback non-production requests', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecurityMode = process.env.NEZ_SECURITY_MODE;
  const previousDisableJwt = process.env.A11_DISABLE_JWT_AUTH;
  const previousLocalBypass = process.env.A11_LOCAL_AUTH_BYPASS;

  delete process.env.NEZ_SECURITY_MODE;
  delete process.env.A11_DISABLE_JWT_AUTH;
  delete process.env.A11_LOCAL_AUTH_BYPASS;
  process.env.NODE_ENV = 'development';

  try {
    assert.equal(
      shouldBypassJwtForLocalDev(localRequest({ 'x-a11-local-dev-bypass': '1' })),
      true
    );
    assert.equal(
      shouldBypassJwtForLocalDev(remoteRequest({ 'x-a11-local-dev-bypass': '1' })),
      false
    );

    process.env.NODE_ENV = 'production';
    assert.equal(
      shouldBypassJwtForLocalDev(localRequest({ 'x-a11-local-dev-bypass': '1' })),
      false
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousSecurityMode === undefined) {
      delete process.env.NEZ_SECURITY_MODE;
    } else {
      process.env.NEZ_SECURITY_MODE = previousSecurityMode;
    }
    if (previousDisableJwt === undefined) {
      delete process.env.A11_DISABLE_JWT_AUTH;
    } else {
      process.env.A11_DISABLE_JWT_AUTH = previousDisableJwt;
    }
    if (previousLocalBypass === undefined) {
      delete process.env.A11_LOCAL_AUTH_BYPASS;
    } else {
      process.env.A11_LOCAL_AUTH_BYPASS = previousLocalBypass;
    }
  }
});

test('OAuth start and callback routes stay public even with stale session cookies', async () => {
  const verifyJWT = createVerifyJWT({
    jwt: {
      verify() {
        throw new Error('jwt expired');
      },
    },
    jwtSecret: 'test-secret',
    logger: { warn() {} },
  });

  for (const route of [
    '/api/auth/google/start',
    '/api/auth/google/callback',
    '/api/auth/microsoft/start',
    '/api/auth/microsoft/callback',
  ]) {
    assert.equal(isPublicAuthRoute({ method: 'GET', path: route }), true);
    assert.equal(
      isPublicAuthRoute({ method: 'GET', path: route.replace(/^\/api/, ''), originalUrl: route }),
      true
    );

    let nextCalled = false;
    await verifyJWT(
      {
        method: 'GET',
        path: route,
        headers: {
          cookie: 'a11_session=expired.jwt.token',
        },
      },
      {
        status() {
          throw new Error(`JWT should not reject ${route}`);
        },
      },
      () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, true, route);

    nextCalled = false;
    await verifyJWT(
      {
        method: 'GET',
        path: route.replace(/^\/api/, ''),
        originalUrl: `${route}?client=funesterie-cockpit`,
        headers: {
          cookie: 'a11_session=expired.jwt.token',
        },
      },
      {
        status() {
          throw new Error(`mounted JWT should not reject ${route}`);
        },
      },
      () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, true, `mounted ${route}`);
  }
});

test('protected auth status routes still require a valid JWT', async () => {
  const verifyJWT = createVerifyJWT({
    jwt: {
      verify() {
        throw new Error('jwt expired');
      },
    },
    jwtSecret: 'test-secret',
    logger: { warn() {} },
  });

  let statusCode = 0;
  let payload = null;
  await verifyJWT(
    {
      method: 'GET',
      path: '/api/auth/me',
      headers: {
        cookie: 'a11_session=expired.jwt.token',
      },
    },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
      },
    },
    () => {
      throw new Error('protected route should not call next');
    }
  );

  assert.equal(statusCode, 401);
  assert.equal(payload?.error, 'A11_JWT_Invalid');
});

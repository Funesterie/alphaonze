const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldBypassJwtForLocalDev } = require('../src/middleware/jwt-auth.cjs');

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

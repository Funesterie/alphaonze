const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCentralLoginRedirectUrl,
  createEmbeddedUiAuthGate,
  isLikelyEmbeddedHtmlRequest,
} = require('../src/auth/embedded-ui-auth-gate.cjs');

function createRequest({
  method = 'GET',
  host = 'vivy.funesterie.me',
  protocol = 'https',
  path = '/',
  originalUrl = path,
  accept = 'text/html',
  cookie = '',
  xForwardedProto = '',
} = {}) {
  const headers = {
    accept,
    host,
  };
  if (cookie) headers.cookie = cookie;
  if (xForwardedProto) headers['x-forwarded-proto'] = xForwardedProto;

  return {
    method,
    path,
    originalUrl,
    url: originalUrl,
    protocol,
    headers,
    get(name) {
      return headers[String(name || '').toLowerCase()] || '';
    },
  };
}

function createResponse() {
  return {
    headers: {},
    redirectResult: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    redirect(status, url) {
      this.redirectResult = { status, url };
      return this;
    },
  };
}

function createJwtStub({ revoked = false } = {}) {
  return {
    verify(token, secret) {
      assert.equal(secret, 'test-secret');
      if (token !== 'aaa.bbb.ccc') throw new Error('bad token');
      if (revoked) {
        const error = new Error('revoked');
        error.code = 'A11_SESSION_REVOKED';
        throw error;
      }
      return { sub: 'user-1', sid: 'session-1' };
    },
  };
}

function createGate(options = {}) {
  return createEmbeddedUiAuthGate({
    jwt: createJwtStub(options),
    jwtSecret: 'test-secret',
    authSessionRegistry: options.authSessionRegistry,
    resolveSurface: options.resolveSurface || (() => 'vivy'),
    centralLoginUrl: 'https://funesterie.me/login',
    logger: { warn() {} },
  });
}

test('embedded UI gate redirects unauthenticated Vivy HTML to central login', async () => {
  const gate = createGate();
  const req = createRequest({ originalUrl: '/studio?tab=voice' });
  const res = createResponse();
  let nextCalled = false;

  await gate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.redirectResult.status, 302);
  const redirect = new URL(res.redirectResult.url);
  assert.equal(redirect.origin + redirect.pathname, 'https://funesterie.me/login');
  assert.equal(redirect.searchParams.get('returnTo'), 'https://vivy.funesterie.me/studio?tab=voice');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-robots-tag'], 'noindex, follow, noarchive');
});

test('embedded UI gate allows Vivy HTML with a current session cookie', async () => {
  const gate = createGate({
    authSessionRegistry: {
      async assertTokenCurrent(decoded) {
        assert.equal(decoded.sid, 'session-1');
      },
    },
  });
  const req = createRequest({ cookie: 'a11_session=aaa.bbb.ccc' });
  const res = createResponse();
  let nextCalled = false;

  await gate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectResult, null);
  assert.equal(req.user.sid, 'session-1');
});

test('embedded UI gate does not catch API calls or assets', async () => {
  assert.equal(isLikelyEmbeddedHtmlRequest(createRequest({ path: '/api/vivy/studio/chat' })), false);
  assert.equal(isLikelyEmbeddedHtmlRequest(createRequest({ path: '/assets/app.js' })), false);
  assert.equal(isLikelyEmbeddedHtmlRequest(createRequest({ path: '/vivy/index.html' })), true);
});

test('embedded UI gate leaves public A11 pages alone', async () => {
  const gate = createGate({ resolveSurface: () => 'a11' });
  const req = createRequest({ host: 'funesterie.me' });
  const res = createResponse();
  let nextCalled = false;

  await gate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.redirectResult, null);
});

test('embedded UI gate redirects revoked Vivy sessions', async () => {
  const gate = createGate({ revoked: true });
  const req = createRequest({ cookie: 'a11_session=aaa.bbb.ccc' });
  const res = createResponse();
  let nextCalled = false;

  await gate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.redirectResult.status, 302);
});

test('central login redirect preserves the original request URL', () => {
  const req = createRequest({
    host: 'vivy.funesterie.me',
    originalUrl: '/?mode=studio',
  });
  const redirect = new URL(buildCentralLoginRedirectUrl(req));
  assert.equal(redirect.searchParams.get('returnTo'), 'https://vivy.funesterie.me/?mode=studio');
});

test('central login redirect keeps public hosts on https behind proxies', () => {
  const req = createRequest({
    host: 'vivy.funesterie.me',
    protocol: 'http',
    xForwardedProto: 'http',
    originalUrl: '/studio?tab=voice',
  });
  const redirect = new URL(buildCentralLoginRedirectUrl(req));
  assert.equal(redirect.searchParams.get('returnTo'), 'https://vivy.funesterie.me/studio?tab=voice');
});

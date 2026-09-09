'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createSocialAutopromptApiRouter } = require('../src/routes/social-autoprompt.cjs');

test('OAuth state and PKCE cookies are set and cleared on the configured shared domain', async () => {
  const savedDomain = process.env.SOCIAL_OAUTH_COOKIE_DOMAIN;
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.SOCIAL_OAUTH_COOKIE_DOMAIN = '.funesterie.me';
  process.env.NODE_ENV = 'production';
  const app = express();
  app.use('/api/admin/social-connect', createSocialAutopromptApiRouter({
    verifyJWT(req, _res, next) { req.user = { id: '2', roles: ['founder'] }; next(); },
    isAdminRequest: () => true,
    env: {
      SOCIAL_SOUNDCLOUD_CLIENT_ID: 'test-client',
      SOCIAL_SOUNDCLOUD_CLIENT_SECRET: 'test-secret',
      SOCIAL_SOUNDCLOUD_REDIRECT_URI: 'https://vivy.funesterie.me/api/admin/social-connect/soundcloud/callback',
    },
    fetchFn() { throw Error('No provider call expected'); },
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/social-connect`;
  try {
    const start = await fetch(base + '/soundcloud/start', { redirect: 'manual' });
    assert.equal(start.status, 302);
    const setCookies = start.headers.getSetCookie();
    assert.equal(setCookies.length, 2);
    for (const cookie of setCookies) {
      assert.match(cookie, /Domain=\.funesterie\.me/);
      assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
    }
    // Invalid state still refuses authorization, but clears both cookies on the same domain.
    const callback = await fetch(base + '/soundcloud/callback?state=invalid');
    assert.equal(callback.status, 400);
    const cleared = callback.headers.getSetCookie();
    assert.equal(cleared.length, 2);
    for (const cookie of cleared) assert.match(cookie, /Domain=\.funesterie\.me/);
    delete process.env.SOCIAL_OAUTH_COOKIE_DOMAIN;
    const hostOnly = await fetch(base + '/soundcloud/start', { redirect: 'manual' });
    for (const cookie of hostOnly.headers.getSetCookie()) assert.doesNotMatch(cookie, /Domain=/);
  } finally {
    if (savedDomain === undefined) delete process.env.SOCIAL_OAUTH_COOKIE_DOMAIN; else process.env.SOCIAL_OAUTH_COOKIE_DOMAIN = savedDomain;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

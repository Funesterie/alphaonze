'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CRAWLER_PRIVATE_ROBOTS_HEADER,
  installCrawlerVisibilityHeaders,
  isCrawlerPrivatePath,
  normalizeRequestPath,
} = require('../lib/crawler-visibility.cjs');

test('crawler visibility normalizes request paths safely', () => {
  assert.equal(normalizeRequestPath('/api/chat?x=1'), '/api/chat');
  assert.equal(normalizeRequestPath('https://a11.funesterie.me/oauth/token?state=secret'), '/oauth/token');
  assert.equal(normalizeRequestPath('api/chat'), '/api/chat');
});

test('crawler visibility marks technical routes as private for crawlers', () => {
  for (const pathname of [
    '/api/chat',
    '/api/vivy/studio/produce',
    '/oauth/token',
    '/mcp',
    '/mcp/messages',
    '/.well-known/mcp',
    '/auth/success',
    '/a11/auth/success',
    '/k44/auth/success',
    '/kaen44/auth/success',
  ]) {
    assert.equal(isCrawlerPrivatePath(pathname), true, `${pathname} should be noindexed`);
  }
});

test('crawler visibility keeps public pages indexable', () => {
  for (const pathname of ['/', '/agents/', '/contact/', '/compte/', '/privacy/', '/terms/', '/vivy/']) {
    assert.equal(isCrawlerPrivatePath(pathname), false, `${pathname} should stay public`);
  }
});

test('crawler visibility header value is strict enough for API 404s', () => {
  assert.equal(CRAWLER_PRIVATE_ROBOTS_HEADER, 'noindex, nofollow, noarchive');
});

test('crawler visibility middleware sets X-Robots-Tag before API routing', () => {
  let middleware;
  installCrawlerVisibilityHeaders({
    use(fn) {
      middleware = fn;
    },
  });

  const headers = new Map();
  middleware(
    { path: '/api/vivy/studio/chat' },
    { setHeader(name, value) { headers.set(name, value); } },
    () => {}
  );

  assert.equal(headers.get('X-Robots-Tag'), CRAWLER_PRIVATE_ROBOTS_HEADER);
});

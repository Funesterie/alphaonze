'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CRAWLER_CONTROL_ASSET_CACHE_HEADER,
  CRAWLER_PRIVATE_ROBOTS_HEADER,
  installCrawlerVisibilityHeaders,
  isCrawlerControlAsset,
  isCrawlerPrivatePath,
  normalizeRequestPath,
  setCrawlerControlAssetCacheHeaders,
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
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/openid-configuration',
    '/auth/success',
    '/a11/auth/success',
    '/k44/auth/success',
    '/kaen44/auth/success',
    '/register',
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

test('crawler visibility disables stale CDN cache for crawler control assets', () => {
  assert.equal(isCrawlerControlAsset('dist/robots.txt'), true);
  assert.equal(isCrawlerControlAsset('dist/sitemap.xml'), true);
  assert.equal(isCrawlerControlAsset('dist/sw.js'), true);
  assert.equal(isCrawlerControlAsset('dist/assets/app.js'), false);

  const headers = new Map();
  const changed = setCrawlerControlAssetCacheHeaders(
    { setHeader(name, value) { headers.set(name, value); } },
    'dist/robots.txt'
  );

  assert.equal(changed, true);
  assert.equal(headers.get('Cache-Control'), CRAWLER_CONTROL_ASSET_CACHE_HEADER);
  assert.equal(headers.get('Pragma'), 'no-cache');
  assert.equal(headers.get('Expires'), '0');
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

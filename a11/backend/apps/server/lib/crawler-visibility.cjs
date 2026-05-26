'use strict';

const CRAWLER_PRIVATE_ROBOTS_HEADER = 'noindex, nofollow, noarchive';

const CRAWLER_PRIVATE_PREFIXES = Object.freeze([
  '/api',
  '/oauth',
  '/mcp',
  '/.well-known/mcp',
  '/auth/success',
  '/a11/auth/success',
  '/k44/auth/success',
  '/kaen44/auth/success',
]);

function normalizeRequestPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/';

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).pathname || '/';
    }
  } catch {}

  const withoutQuery = raw.split(/[?#]/, 1)[0] || '/';
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

function isCrawlerPrivatePath(value) {
  const pathname = normalizeRequestPath(value).replace(/\/+$/, '') || '/';
  return CRAWLER_PRIVATE_PREFIXES.some((prefix) => {
    const normalizedPrefix = prefix.replace(/\/+$/, '') || '/';
    return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`);
  });
}

function installCrawlerVisibilityHeaders(app) {
  if (!app || typeof app.use !== 'function') {
    throw new TypeError('installCrawlerVisibilityHeaders expects an Express app');
  }

  app.use((req, res, next) => {
    const pathname = req.path || req.originalUrl || req.url || '/';
    if (isCrawlerPrivatePath(pathname)) {
      res.setHeader('X-Robots-Tag', CRAWLER_PRIVATE_ROBOTS_HEADER);
    }
    next();
  });
}

module.exports = {
  CRAWLER_PRIVATE_ROBOTS_HEADER,
  isCrawlerPrivatePath,
  installCrawlerVisibilityHeaders,
  normalizeRequestPath,
};

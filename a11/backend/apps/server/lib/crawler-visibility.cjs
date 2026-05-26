'use strict';

const path = require('node:path');

const CRAWLER_PRIVATE_ROBOTS_HEADER = 'noindex, nofollow, noarchive';
const CRAWLER_CONTROL_ASSET_CACHE_HEADER = 'no-cache, no-store, must-revalidate';

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

const CRAWLER_CONTROL_ASSET_NAMES = new Set([
  'index.html',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
  'manifest.webmanifest',
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

function isCrawlerControlAsset(filePath) {
  const basename = path.basename(String(filePath || '')).toLowerCase();
  return CRAWLER_CONTROL_ASSET_NAMES.has(basename);
}

function setCrawlerControlAssetCacheHeaders(res, filePath) {
  if (!isCrawlerControlAsset(filePath)) return false;
  res.setHeader('Cache-Control', CRAWLER_CONTROL_ASSET_CACHE_HEADER);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return true;
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
  CRAWLER_CONTROL_ASSET_CACHE_HEADER,
  CRAWLER_PRIVATE_ROBOTS_HEADER,
  isCrawlerControlAsset,
  isCrawlerPrivatePath,
  installCrawlerVisibilityHeaders,
  normalizeRequestPath,
  setCrawlerControlAssetCacheHeaders,
};

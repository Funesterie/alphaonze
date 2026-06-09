'use strict';

const INDEX_FOLLOW = 'index,follow';
const NOINDEX_FOLLOW = 'noindex,follow';

const FUNESTERIE_PUBLIC_PATHS = new Map([
  ['/', '/'],
  ['/home', '/'],
  ['/accueil', '/'],
  ['/agents', '/agents/'],
  ['/architecture', '/architecture/'],
  ['/carte', '/architecture/'],
  ['/graph', '/architecture/'],
  ['/contact', '/contact/'],
  ['/privacy', '/privacy/'],
  ['/confidentialite', '/privacy/'],
  ['/terms', '/terms/'],
  ['/conditions', '/terms/'],
  ['/cgu', '/terms/'],
  ['/vivy', '/vivy/'],
]);

function normalizeHostname(value = '') {
  return String(value || '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function normalizeSeoPath(value = '/') {
  const raw = String(value || '/').trim() || '/';
  let pathname = raw;
  try {
    if (/^https?:\/\//i.test(raw)) pathname = new URL(raw).pathname || '/';
  } catch {}
  pathname = pathname.split(/[?#]/, 1)[0] || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  return pathname.replace(/\/{2,}/g, '/').toLowerCase();
}

function stripTrailingSlash(pathname) {
  return String(pathname || '/').replace(/\/+$/, '') || '/';
}

function canonicalFunesteriePath(value = '/') {
  const normalized = stripTrailingSlash(normalizeSeoPath(value));
  for (const [prefix, canonical] of FUNESTERIE_PUBLIC_PATHS.entries()) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return canonical;
  }
  return '';
}

function isPrivateOrUtilityPath(value = '/') {
  return /^\/(?:login|cockpit|app|workspace|auth|reset|reset-password|compte|account|subscription|security|register)(?:\/|$)/.test(normalizeSeoPath(value));
}

function isK44Surface(hostname, pathname, surface) {
  return surface === 'kaen44'
    || hostname === 'k44.funesterie.me'
    || hostname === 'kaen44.funesterie.me'
    || /^\/(?:k44|kaen44)(?:\/|$)/.test(pathname);
}

function isVivySurface(hostname, pathname, surface) {
  return surface === 'vivy'
    || hostname === 'vivy.funesterie.me'
    || hostname === 'music.funesterie.me'
    || /^\/vivy(?:\/|$)/.test(pathname);
}

function isA11Surface(hostname, pathname, surface) {
  return surface === 'a11'
    || hostname === 'a11.funesterie.me'
    || /^\/(?:a11|alphaonze)(?:\/|$)/.test(pathname);
}

function resolveEmbeddedUiSeo({ hostname = '', pathname = '/', surface = '' } = {}) {
  const host = normalizeHostname(hostname);
  const path = normalizeSeoPath(pathname);
  const publicFunesteriePath = canonicalFunesteriePath(path);
  const privatePath = isPrivateOrUtilityPath(path);

  if (host === 'funesterie.me' || host === 'www.funesterie.me' || surface === 'funesterie') {
    return {
      canonical: `https://funesterie.me${publicFunesteriePath || '/'}`,
      robots: publicFunesteriePath && !privatePath ? INDEX_FOLLOW : NOINDEX_FOLLOW,
    };
  }

  if (isK44Surface(host, path, surface)) {
    const rootPath = stripTrailingSlash(path);
    if (privatePath) {
      return { canonical: 'https://k44.funesterie.me/', robots: NOINDEX_FOLLOW };
    }
    if (rootPath === '/' || rootPath === '/k44' || rootPath === '/kaen44') {
      return { canonical: 'https://k44.funesterie.me/', robots: INDEX_FOLLOW };
    }
    if (publicFunesteriePath) {
      return { canonical: `https://funesterie.me${publicFunesteriePath}`, robots: INDEX_FOLLOW };
    }
    return { canonical: 'https://k44.funesterie.me/', robots: NOINDEX_FOLLOW };
  }

  if (isVivySurface(host, path, surface)) {
    return {
      canonical: 'https://vivy.funesterie.me/',
      robots: privatePath ? NOINDEX_FOLLOW : INDEX_FOLLOW,
    };
  }

  if (isA11Surface(host, path, surface)) {
    if (privatePath) return { canonical: 'https://a11.funesterie.me/', robots: NOINDEX_FOLLOW };
    if (publicFunesteriePath && stripTrailingSlash(path) !== '/') {
      return { canonical: `https://funesterie.me${publicFunesteriePath}`, robots: INDEX_FOLLOW };
    }
    return { canonical: 'https://a11.funesterie.me/', robots: INDEX_FOLLOW };
  }

  return { canonical: 'https://funesterie.me/', robots: NOINDEX_FOLLOW };
}

function resolveEmbeddedUiAliasRedirect(pathname = '/') {
  const normalized = stripTrailingSlash(normalizeSeoPath(pathname));
  return normalized === '/home' || normalized === '/accueil' ? '/' : '';
}

function escapeHtmlAttribute(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function insertBeforeHeadClose(html, tag) {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
  }
  return `${tag}\n${html}`;
}

function upsertMetaName(html, name, content) {
  const tag = `<meta name="${escapeHtmlAttribute(name)}" content="${escapeHtmlAttribute(content)}" />`;
  const pattern = new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*>`, 'i');
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

function upsertMetaProperty(html, property, content) {
  const tag = `<meta property="${escapeHtmlAttribute(property)}" content="${escapeHtmlAttribute(content)}" />`;
  const pattern = new RegExp(`<meta\\s+[^>]*property=["']${property}["'][^>]*>`, 'i');
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

function upsertLinkRel(html, rel, href) {
  const tag = `<link rel="${escapeHtmlAttribute(rel)}" href="${escapeHtmlAttribute(href)}" />`;
  const pattern = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, 'i');
  return pattern.test(html) ? html.replace(pattern, tag) : insertBeforeHeadClose(html, tag);
}

function injectEmbeddedUiSeo(html, seo = {}) {
  if (!html || !seo) return html;
  let rewritten = String(html);
  if (seo.robots) rewritten = upsertMetaName(rewritten, 'robots', seo.robots);
  if (seo.canonical) {
    rewritten = upsertLinkRel(rewritten, 'canonical', seo.canonical);
    rewritten = upsertMetaProperty(rewritten, 'og:url', seo.canonical);
  }
  return rewritten;
}

module.exports = {
  INDEX_FOLLOW,
  NOINDEX_FOLLOW,
  canonicalFunesteriePath,
  injectEmbeddedUiSeo,
  isPrivateOrUtilityPath,
  normalizeHostname,
  normalizeSeoPath,
  resolveEmbeddedUiAliasRedirect,
  resolveEmbeddedUiSeo,
};

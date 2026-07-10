'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INDEX_FOLLOW,
  NOINDEX_FOLLOW,
  canonicalFunesteriePath,
  injectEmbeddedUiSeo,
  isPrivateOrUtilityPath,
  resolveEmbeddedUiAliasRedirect,
  resolveEmbeddedUiSeo,
} = require('../src/seo/embedded-ui-seo.cjs');

test('embedded UI SEO canonicalizes public Funesterie aliases', () => {
  assert.equal(canonicalFunesteriePath('/'), '/');
  assert.equal(canonicalFunesteriePath('/home'), '/');
  assert.equal(canonicalFunesteriePath('/accueil/'), '/');
  assert.equal(canonicalFunesteriePath('/architecture/details'), '/architecture/');
  assert.equal(canonicalFunesteriePath('/mille-fleurs/'), '/mille-fleurs/');
  assert.equal(canonicalFunesteriePath('/millefleurs/intro'), '/mille-fleurs/');
  assert.equal(canonicalFunesteriePath('/charte-mille-fleurs'), '/mille-fleurs/');
});

test('embedded UI SEO marks private utility pages as noindex', () => {
  assert.equal(isPrivateOrUtilityPath('/login?returnTo=/compte/'), true);
  assert.equal(isPrivateOrUtilityPath('/cockpit/'), true);
  assert.equal(isPrivateOrUtilityPath('/architecture/'), false);
});

test('embedded UI SEO resolves Funesterie public and private pages', () => {
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'funesterie.me', pathname: '/architecture/' }),
    { canonical: 'https://funesterie.me/architecture/', robots: INDEX_FOLLOW }
  );
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'funesterie.me', pathname: '/mille-fleurs/' }),
    { canonical: 'https://funesterie.me/mille-fleurs/', robots: INDEX_FOLLOW }
  );
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'funesterie.me', pathname: '/login?returnTo=/compte/' }),
    { canonical: 'https://funesterie.me/', robots: NOINDEX_FOLLOW }
  );
});

test('embedded UI SEO resolves subdomain public canonicals without duplicate pages', () => {
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'k44.funesterie.me', pathname: '/' }),
    { canonical: 'https://k44.funesterie.me/', robots: INDEX_FOLLOW }
  );
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'k44.funesterie.me', pathname: '/architecture/' }),
    { canonical: 'https://funesterie.me/architecture/', robots: INDEX_FOLLOW }
  );
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'a11.funesterie.me', pathname: '/cockpit/' }),
    { canonical: 'https://a11.funesterie.me/', robots: NOINDEX_FOLLOW }
  );
  assert.deepEqual(
    resolveEmbeddedUiSeo({ hostname: 'vivy.funesterie.me', pathname: '/' }),
    { canonical: 'https://vivy.funesterie.me/', robots: INDEX_FOLLOW }
  );
});

test('embedded UI SEO injects crawl hints into initial HTML', () => {
  const html = [
    '<!doctype html>',
    '<html><head>',
    '<meta property="og:url" content="https://old.example/" />',
    '</head><body>ok</body></html>',
  ].join('');

  const rewritten = injectEmbeddedUiSeo(html, {
    canonical: 'https://funesterie.me/architecture/',
    robots: INDEX_FOLLOW,
  });

  assert.match(rewritten, /<meta name="robots" content="index,follow" \/>/);
  assert.match(rewritten, /<link rel="canonical" href="https:\/\/funesterie\.me\/architecture\/" \/>/);
  assert.match(rewritten, /<meta property="og:url" content="https:\/\/funesterie\.me\/architecture\/" \/>/);
});

test('embedded UI SEO redirects stale public aliases to root', () => {
  assert.equal(resolveEmbeddedUiAliasRedirect('/home'), '/');
  assert.equal(resolveEmbeddedUiAliasRedirect('/accueil/'), '/');
  assert.equal(resolveEmbeddedUiAliasRedirect('/architecture/'), '');
});

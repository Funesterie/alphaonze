const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.resolve(__dirname, '..', 'server.cjs');

test('Kaen44 public root is served as a public page, not redirected to cockpit', () => {
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const match = serverSource.match(/function sendEmbeddedUiRoot\(req, res\) \{[\s\S]*?\n\}/);

  assert.ok(match, 'sendEmbeddedUiRoot should stay explicit and reviewable');
  assert.match(match[0], /hostname === 'k44\.funesterie\.me'/);
  assert.match(match[0], /hostname === 'kaen44\.funesterie\.me'/);
  assert.doesNotMatch(match[0], /redirect\(\s*302\s*,\s*['"]\/cockpit\/['"]\s*\)/);
});

test('legal policy routes serve standalone HTML before the SPA fallback', () => {
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  const standaloneHelper = serverSource.indexOf('function sendEmbeddedUiStandalonePage');
  const privacyRoute = serverSource.indexOf("app.get(['/privacy', '/privacy/'");
  const termsRoute = serverSource.indexOf("app.get(['/terms', '/terms/'");
  const spaRouteList = serverSource.indexOf("], sendEmbeddedUiIndex);");

  assert.notEqual(standaloneHelper, -1, 'standalone legal-page helper should exist');
  assert.notEqual(privacyRoute, -1, 'privacy route should be explicit');
  assert.notEqual(termsRoute, -1, 'terms route should be explicit');
  assert.notEqual(spaRouteList, -1, 'SPA fallback route list should stay explicit');
  assert.ok(privacyRoute < spaRouteList, 'privacy route should be registered before SPA fallback');
  assert.ok(termsRoute < spaRouteList, 'terms route should be registered before SPA fallback');
  assert.match(serverSource, /sendEmbeddedUiStandalonePage\(req, res, 'privacy\/index\.html'\)/);
  assert.match(serverSource, /sendEmbeddedUiStandalonePage\(req, res, 'terms\/index\.html'\)/);
});

test('OAuth homepage exposes Alphaonze as the exact app name', () => {
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const match = serverSource.match(/if \(surface === 'a11'\) \{[\s\S]*?\n  \}/);

  assert.ok(match, 'A11 homepage rewrite should stay explicit and reviewable');
  assert.match(match[0], /<title>Alphaonze<\/title>/);
  assert.match(match[0], /apple-mobile-web-app-title" content="Alphaonze"/);
  assert.doesNotMatch(match[0], /<title>Alphaonze - A11 Funesterie<\/title>/);
  assert.doesNotMatch(match[0], /'Alphaonze - A11 Funesterie'/);
});

test('Funesterie public host keeps the Funesterie landing metadata', () => {
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const start = serverSource.indexOf('function resolveEmbeddedUiSurface(req)');
  const end = serverSource.indexOf('function rewriteEmbeddedUiIndexForSurface', start);
  const resolver = start >= 0 && end > start ? serverSource.slice(start, end) : '';

  assert.ok(resolver, 'surface resolver should stay explicit and reviewable');
  assert.match(resolver, /hostname === 'funesterie\.me'/);
  assert.match(resolver, /return 'funesterie'/);
  const a11Start = resolver.indexOf("return 'funesterie'");
  const a11Clause = resolver.slice(a11Start);
  assert.doesNotMatch(a11Clause, /\|\|\s*hostname === 'funesterie\.me'/);
  assert.doesNotMatch(a11Clause, /\|\|\s*hostname === 'www\.funesterie\.me'/);
});

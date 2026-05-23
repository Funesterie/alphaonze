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
  const spaRouteList = serverSource.indexOf("app.get([\n  '/auth/success'");

  assert.notEqual(standaloneHelper, -1, 'standalone legal-page helper should exist');
  assert.notEqual(privacyRoute, -1, 'privacy route should be explicit');
  assert.notEqual(termsRoute, -1, 'terms route should be explicit');
  assert.ok(privacyRoute < spaRouteList, 'privacy route should be registered before SPA fallback');
  assert.ok(termsRoute < spaRouteList, 'terms route should be registered before SPA fallback');
  assert.match(serverSource, /sendEmbeddedUiStandalonePage\(req, res, 'privacy\/index\.html'\)/);
  assert.match(serverSource, /sendEmbeddedUiStandalonePage\(req, res, 'terms\/index\.html'\)/);
});

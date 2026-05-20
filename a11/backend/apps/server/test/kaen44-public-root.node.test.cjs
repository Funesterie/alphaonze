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

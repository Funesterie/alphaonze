const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const alphaOnzeRoot = path.resolve(repoRoot, '..', 'alphaonze-afk');

test('funesterie launcher keeps AlphaOnze bound to localhost by default', () => {
  const launcher = fs.readFileSync(
    path.join(repoRoot, 'launchers', 'funesterie-launch-all.ps1'),
    'utf8'
  );

  assert.doesNotMatch(launcher, /\$env:ALPHAONZE_HOST\s*=\s*['"]0\.0\.0\.0['"]/);
  assert.match(launcher, /127\.0\.0\.1/);
});

test('AlphaOnze standalone defaults stay localhost-first', () => {
  const server = fs.readFileSync(path.join(alphaOnzeRoot, 'server.cjs'), 'utf8');
  const startBat = fs.readFileSync(path.join(alphaOnzeRoot, 'start-alphaonze-afk.bat'), 'utf8');

  assert.doesNotMatch(server, /ALPHAONZE_HOST\s*\|\|\s*["']0\.0\.0\.0["']/);
  assert.match(server, /ALPHAONZE_HOST\s*\|\|\s*["']127\.0\.0\.1["']/);

  assert.doesNotMatch(startBat, /set\s+"ALPHAONZE_HOST=0\.0\.0\.0"/i);
  assert.match(startBat, /set\s+"ALPHAONZE_HOST=127\.0\.0\.1"/i);
});

test('versioned hardening script keeps backend ports local-only', () => {
  const hardeningScript = fs.readFileSync(
    path.join(repoRoot, 'launchers', 'harden-local-network.ps1'),
    'utf8'
  );

  assert.match(hardeningScript, /A11 LocalOnly Backend 3000/);
  assert.match(hardeningScript, /A11 LocalOnly TTS 5002/);
  assert.match(hardeningScript, /A11 LocalOnly LLM 4545/);
  assert.match(hardeningScript, /A11 LocalOnly AlphaOnze 8088/);
  assert.match(hardeningScript, /Node\.js JavaScript Runtime/);
  assert.match(hardeningScript, /python\.exe/);
  assert.match(hardeningScript, /caddy\.exe/);
  assert.match(hardeningScript, /AlphaOnze Caddy HTTP 80/);
  assert.match(hardeningScript, /AlphaOnze Caddy HTTPS 443/);
  assert.match(hardeningScript, /127\.0\.0\.1/);
});

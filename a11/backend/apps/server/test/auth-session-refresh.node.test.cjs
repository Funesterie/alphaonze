'use strict';

// DEPENDENCY-FREE unit tests for FEAT-004 (silent session refresh).
// Requires ONLY node:test + node:assert + the pure buildRefreshExtra helper +
// session-registry.cjs (which has NO express / jsonwebtoken dependency), plus a
// text scrape of nossen-index.html. This MUST run in the sandbox where express
// and jsonwebtoken are un-installable (npm registry 403).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildRefreshExtra } = require('../src/auth/refresh-claims.cjs');
const { createAuthSessionRegistry } = require('../src/auth/session-registry.cjs');

test('buildRefreshExtra preserves sid, generation (sv/sessionGeneration) and surface', () => {
  const extra = buildRefreshExtra({
    sub: 'u1',
    id: 'u1',
    sid: 'sid_x',
    sv: 3,
    sessionGeneration: 3,
    surface: 'a11',
    client: 'web',
    provider: 'google',
  });
  assert.equal(extra.sid, 'sid_x');
  assert.equal(extra.sv, 3);
  assert.equal(extra.sessionGeneration, 3);
  assert.equal(extra.surface, 'a11');
  assert.equal(extra.client, 'web');
  assert.equal(extra.provider, 'google');
});

test('buildRefreshExtra falls back to sessionGeneration when sv is absent', () => {
  const extra = buildRefreshExtra({ id: 'u2', sid: 'sid_y', sessionGeneration: 5 });
  assert.equal(extra.sid, 'sid_y');
  assert.equal(extra.sv, 5);
  assert.equal(extra.sessionGeneration, 5);
});

test('buildRefreshExtra defaults generation to 0 and omits optional fields when missing', () => {
  const extra = buildRefreshExtra({ id: 'u3' });
  assert.equal(extra.sv, 0);
  assert.equal(extra.sessionGeneration, 0);
  assert.equal('surface' in extra, false);
  assert.equal('client' in extra, false);
  assert.equal('provider' in extra, false);
});

test('refreshed claims (same generation, no revocation) stay current, not A11_SESSION_REVOKED', async () => {
  const registry = createAuthSessionRegistry({ db: null });
  // A same-generation token with no session row seeded checks the version path
  // only (no sid), so assertTokenCurrent resolves true when currentVersion <=
  // tokenVersion (0 <= 3 for a user with no global-logout bump). This genuinely
  // exercises the "not revoked" branch without express or jsonwebtoken.
  const extra = buildRefreshExtra({ id: 'refresh-user-not-revoked', sv: 3, sessionGeneration: 3, surface: 'a11' });
  const claims = { id: 'refresh-user-not-revoked', sv: extra.sv, sessionGeneration: extra.sessionGeneration, surface: extra.surface };
  const result = await registry.assertTokenCurrent(claims);
  assert.equal(result, true);
});

test('a stale token (currentVersion > tokenVersion) throws A11_SESSION_REVOKED', async (t) => {
  // Use an isolated temp registry file so the global logout bump is deterministic
  // and does not touch the shared runtime registry.
  const previous = process.env.A11_AUTH_SESSION_REGISTRY_FILE;
  const tmpFile = path.join(os.tmpdir(), `a11-refresh-registry-${process.pid}-${Date.now()}.json`);
  process.env.A11_AUTH_SESSION_REGISTRY_FILE = tmpFile;
  t.after(() => {
    if (previous === undefined) delete process.env.A11_AUTH_SESSION_REGISTRY_FILE;
    else process.env.A11_AUTH_SESSION_REGISTRY_FILE = previous;
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  const registry = createAuthSessionRegistry({ db: null });
  const userId = 'refresh-user-revoked';
  // Bump the stored generation above the token generation (global logout), then
  // assert a lower-generation token is rejected as revoked.
  await registry.revokeAllForUser({ id: userId });
  const revokedClaims = { id: userId, sv: 0, sessionGeneration: 0 };
  await assert.rejects(
    () => registry.assertTokenCurrent(revokedClaims),
    (error) => error && error.code === 'A11_SESSION_REVOKED'
  );
});

test('nossen-index.html calls /api/auth/refresh and defines REFRESH_MARGIN_MS', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'nossen-index.html'), 'utf8');
  assert.match(html, /REFRESH_MARGIN_MS/);
  assert.match(html, /\/api\/auth\/refresh/);
  // The refresh must only run while a job is tracked and be guarded against
  // concurrent calls.
  assert.match(html, /refreshInFlight/);
  assert.match(html, /sessionExpiresAt/);
});

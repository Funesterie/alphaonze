const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBuildInfo,
  normalizeCommit,
  normalizeIsoDate,
} = require('../src/build-info.cjs');

test('normalizeCommit accepts only git-like hashes', () => {
  assert.equal(normalizeCommit('ABCDEF1234567'), 'abcdef1234567');
  assert.equal(normalizeCommit('not-a-secret-token'), '');
  assert.equal(normalizeCommit('sk_live_not_a_commit'), '');
});

test('normalizeIsoDate supports source date epoch', () => {
  assert.equal(normalizeIsoDate('0'), '1970-01-01T00:00:00.000Z');
  assert.equal(normalizeIsoDate('2026-06-03T01:00:00Z'), '2026-06-03T01:00:00.000Z');
});

test('buildBuildInfo exposes commit metadata without secrets', () => {
  const info = buildBuildInfo({
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_SERVICE_NAME: 'a11-backend',
      RENDER_GIT_COMMIT: '1234567890abcdef1234567890abcdef12345678',
      RENDER_GIT_BRANCH: 'master',
      SOURCE_DATE_EPOCH: '1780362000',
      STRIPE_SECRET_KEY: 'must-not-appear',
    },
  });

  assert.equal(info.ok, true);
  assert.equal(info.provider, 'render');
  assert.equal(info.deployRole, 'fallback');
  assert.equal(info.commitShort, '12345678');
  assert.equal(info.branch, 'master');
  assert.equal(info.render.serviceName, 'a11-backend');
  assert.equal(info.secretsExposed, false);
  assert.equal(JSON.stringify(info).includes('must-not-appear'), false);
});

test('buildBuildInfo keeps non-Render runtimes as primary unless overridden', () => {
  const info = buildBuildInfo({
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      BACKEND: 'caddy-hetzner',
      A11_BUILD_COMMIT: 'abcdef1234567',
    },
  });

  assert.equal(info.provider, 'caddy-hetzner');
  assert.equal(info.deployRole, 'primary');
});

test('buildBuildInfo labels plain production as caddy-hetzner primary', () => {
  const info = buildBuildInfo({
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      A11_BUILD_COMMIT: 'abcdef1234567',
    },
  });

  assert.equal(info.provider, 'caddy-hetzner');
  assert.equal(info.deployRole, 'primary');
});

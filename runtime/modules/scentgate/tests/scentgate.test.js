import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertScentGateActive,
  createScentGateCapsule,
  createScentGateSignal,
  describeScentGate,
  destroyScentGateCapsule,
  isScentGateExpired,
  renderScentGateCapsule,
  verifyScentGateSignal,
  withScentGateCapsule
} from '../index.js';

test('builds a safe ScentGate capsule', () => {
  const capsule = createScentGateCapsule({
    mission: 'multi-corpus sensitive research',
    alias: ['PortalCake'],
    corpusHints: ['doc-a', 'doc-b'],
    shaRefs: ['sha256:abc'],
    ttlMinutes: 18,
    maxDocs: 8,
    maxBytes: 1234567,
    rawContent: 'should be ignored'
  });

  assert.equal(capsule.name, 'ScentGate Capsule');
  assert.ok(capsule.aliases.includes('PortalCake'));
  assert.equal(capsule.limits.ttlMinutes, 18);
  assert.ok(capsule.lifecycle.createdAt);
  assert.ok(capsule.lifecycle.expiresAt);
  assert.equal(capsule.inputs.corpusHints.length, 2);
  assert.equal(capsule.inputs.shaRefs[0], 'sha256:abc');
  assert.equal(capsule.rawContent, undefined);
});

test('signs a closed job signal without redefining BLOOP or EKKO', () => {
  const secret = 'scentgate-test-key-with-at-least-32-bytes';
  const seenNonces = new Set();
  const envelope = createScentGateSignal({
    type: 'job.completed',
    issuer: 'a11-v11pan',
    audience: 'vivy',
    jobId: 'v11pan_123',
    resultDigest: 'a'.repeat(64),
    bloopReportId: 'bloop-report-42',
    ttlSeconds: 60
  }, {
    secret,
    nonce: 'nonce-unique-1',
    now: Date.parse('2026-08-05T12:00:00.000Z')
  });

  const verified = verifyScentGateSignal(envelope, {
    secret,
    expectedAudience: 'vivy',
    seenNonces,
    now: Date.parse('2026-08-05T12:00:30.000Z')
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.bloopReportId, 'bloop-report-42');
  assert.equal(verifyScentGateSignal(envelope, {
    secret,
    expectedAudience: 'vivy',
    seenNonces,
    now: Date.parse('2026-08-05T12:00:31.000Z')
  }).error, 'SCENTGATE_SIGNAL_REPLAYED');
});

test('ScentGate signals fail closed on type, audience, expiry and tampering', () => {
  const secret = 'scentgate-test-key-with-at-least-32-bytes';
  assert.throws(() => createScentGateSignal({
    type: 'shell.execute', issuer: 'a11', audience: 'vivy', jobId: 'job-1'
  }, { secret }), /Unsupported/);

  const envelope = createScentGateSignal({
    type: 'job.failed', issuer: 'a11', audience: 'vivy', jobId: 'job-2', ttlSeconds: 15
  }, { secret, nonce: 'nonce-unique-2', now: 100_000 });
  assert.equal(verifyScentGateSignal(envelope, {
    secret, expectedAudience: 'other', now: 101_000
  }).error, 'SCENTGATE_SIGNAL_AUDIENCE_MISMATCH');
  assert.equal(verifyScentGateSignal(envelope, {
    secret, expectedAudience: 'vivy', now: 116_000
  }).error, 'SCENTGATE_SIGNAL_EXPIRED');

  envelope.payload.jobId = 'job-tampered';
  assert.equal(verifyScentGateSignal(envelope, {
    secret, expectedAudience: 'vivy', now: 101_000
  }).error, 'SCENTGATE_SIGNAL_SIGNATURE_INVALID');
});

test('describes itself clearly', () => {
  assert.match(describeScentGate(), /Rome scents/i);
});

test('renders to JSON', () => {
  const capsule = createScentGateCapsule({ mission: 'capsule render' });
  const rendered = renderScentGateCapsule(capsule);
  assert.match(rendered, /ScentGate Capsule/);
  assert.doesNotThrow(() => JSON.parse(rendered));
});

test('enforces expiry and destruction helpers', () => {
  const capsule = createScentGateCapsule({
    mission: 'short lived capsule',
    ttlMinutes: 5,
    now: Date.parse('2026-05-28T00:00:00.000Z')
  });

  assert.equal(isScentGateExpired(capsule, Date.parse('2026-05-28T00:04:59.000Z')), false);
  assert.equal(isScentGateExpired(capsule, Date.parse('2026-05-28T00:05:00.000Z')), true);
  assert.throws(
    () => assertScentGateActive(capsule, Date.parse('2026-05-28T00:05:00.000Z')),
    /expired or destroyed/
  );

  const tombstone = destroyScentGateCapsule(capsule, { now: Date.parse('2026-05-28T00:05:01.000Z') });
  assert.equal(tombstone.lifecycle.stage, 'destroyed');
  assert.equal(tombstone.inputs, undefined);
  assert.match(renderScentGateCapsule(tombstone), /Tombstone/);
});

test('withScentGateCapsule returns a result and tombstone', async () => {
  const out = await withScentGateCapsule(
    { mission: 'controlled run' },
    async (capsule) => {
      assertScentGateActive(capsule);
      return capsule.policy.destroyOnExit;
    }
  );

  assert.equal(out.result, true);
  assert.equal(out.tombstone.lifecycle.stage, 'destroyed');
});

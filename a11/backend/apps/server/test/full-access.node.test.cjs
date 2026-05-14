const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getFullAccessEmails,
  isFullAccessEmail,
} = require('../src/auth/full-access.cjs');

test('default full-access allowlist includes family accounts', () => {
  assert.equal(isFullAccessEmail('Jeffrey38330@gmail.com', {}), true);
  assert.equal(isFullAccessEmail('cellaurojeffrey@gmail.com', {}), true);
  assert.deepEqual(getFullAccessEmails({}), [
    'funeste38@gmail.com',
    'cellaurojeffrey@gmail.com',
    'jeffrey38330@gmail.com',
    'marvincellauro@gmail.com',
    'giovannabrunetto@gmail.com',
    'bayetgerard@gmail.com',
    'boostro38@gmail.com',
    'charlenejewitt@gmail.com',
  ]);
});

test('configured full-access emails are normalized and deduplicated', () => {
  const env = {
    A11_FULL_ACCESS_EMAILS: 'JEFFREY38330@gmail.com; jeffrey38330@gmail.com boostro38@gmail.com',
  };

  assert.deepEqual(getFullAccessEmails(env), [
    'jeffrey38330@gmail.com',
    'boostro38@gmail.com',
  ]);
});

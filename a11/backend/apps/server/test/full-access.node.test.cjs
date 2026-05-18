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
    'cellaurojeffrey@gmail.com',
    'jeffrey38330@gmail.com',
    'cellauromarvin@gmail.com',
    'marvincellauro@gmail.com',
    'giovannabrunetto@gmail.com',
    'bayetgerard@gmail.com',
    'cjcarme38@yahoo.fr',
    'valerie.atek@gmail.com',
    'jewitt.charlene@gmail.com',
    'boostro38@gmail.com',
    'charlenejewitt@gmail.com',
    'cellaurojeffrey_38@hotmail.com',
    'cellaurojeffrey@hotmail.com',
    'cellaurojeffrey@funesterie.onmicrosoft.com',
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

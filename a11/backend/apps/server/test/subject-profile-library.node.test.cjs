const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSubjectProfile,
} = require('../src/mask/semantic/subject-profile-library.cjs');

test('resolveSubjectProfile gives Goku a dedicated Dragon Ball identity profile', () => {
  const profile = resolveSubjectProfile({
    subject: 'goku',
    sourceText: 'goku se transformant en super saiyan divin',
  });

  assert.equal(profile?.type, 'reference_character');
  assert.equal(profile?.canonicalSubject, 'Goku');
  assert.match(String(profile?.label || ''), /goku/i);
  assert.ok(Array.isArray(profile?.styleHints));
  assert.match(String(profile.styleHints.join(', ') || ''), /illustration anime de combat nette/i);
  assert.match(String(profile.styleHints.join(', ') || ''), /tenue orange et bleue lisible/i);
});

test('resolveSubjectProfile gives James Bond a dedicated spy identity profile', () => {
  const profile = resolveSubjectProfile({
    subject: 'James Bond',
    sourceText: 'genere une video de James Bond marchant',
  });

  assert.equal(profile?.type, 'reference_character');
  assert.equal(profile?.canonicalSubject, 'James Bond');
  assert.match(String(profile?.label || ''), /James Bond/i);
  assert.ok(Array.isArray(profile?.styleHints));
  assert.match(String(profile.styleHints.join(', ') || ''), /espionnage/i);
});

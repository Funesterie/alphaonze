const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  detectTextLanguage,
  buildLanguageInstruction,
  hasMojibake,
} = require('../lib/language-text.cjs');

test('language helpers preserve Unicode text for display and storage', () => {
  assert.equal(normalizeTextNfc('Cafe\u0301 déjà prêt'), 'Café déjà prêt');
  assert.equal(normalizeOneLineNfc('  scène\nà   écrire  '), 'scène à écrire');
  assert.equal(hasMojibake('RÃ©essaie'), true);
  assert.equal(hasMojibake('Réessaie'), false);
});

test('language helpers fold accents only for lookup and intent matching', () => {
  const folded = foldTextForLookup("Référence privée, scène à écrire pour l'équipe.");
  assert.equal(folded, 'reference privee scene a ecrire pour l equipe');
});

test('language helpers detect the requested response language', () => {
  assert.equal(detectTextLanguage('Prépare une scène douce avec une voix proche.'), 'fr');
  assert.equal(detectTextLanguage('Please prepare a soft voice scene.'), 'en');
  assert.equal(detectTextLanguage('Prepara una canción con voz suave.'), 'es');
  assert.match(buildLanguageInstruction('fr'), /français/);
  assert.match(buildLanguageInstruction('fr'), /accents/);
});

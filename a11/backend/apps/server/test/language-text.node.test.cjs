const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  normalizeLanguageCode,
  resolveUserLanguage,
  detectTextLanguage,
  buildLanguageInstruction,
  buildLanguageContract,
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

// Regression du 08/08/2026: un modele local (qwen2.5:7b prive de son prompt systeme)
// terminait une phrase francaise par quelques ideogrammes. La detection basculait sur
// 'zh' des le premier caractere Han, le contrat de langue ordonnait alors de repondre
// en chinois, et la conversation ne revenait plus jamais au francais.
test('language detection ignores a stray ideogram but still recognizes real CJK', () => {
  assert.equal(detectTextLanguage('Oui je vais bien, merci de demander. Et toi 今日 ?'), 'fr');
  assert.equal(detectTextLanguage('Prépare une scène douce avec une voix proche 好.'), 'fr');
  assert.equal(detectTextLanguage('请用自然中文回答这个问题。'), 'zh');
  assert.equal(detectTextLanguage('自然な日本語で答えてください。'), 'ja');
});

test('language helpers normalize account language aliases and request headers', () => {
  assert.equal(normalizeLanguageCode('it-IT'), 'it');
  assert.equal(normalizeLanguageCode('Italiano'), 'it');
  assert.equal(normalizeLanguageCode('unknown'), 'fr');
  assert.equal(resolveUserLanguage({ user: { language: 'en-US' } }), 'en');
  assert.equal(resolveUserLanguage({ user: { language: 'unknown' }, headers: { 'accept-language': 'it-IT' } }), 'it');
  assert.equal(resolveUserLanguage({ headers: { 'accept-language': 'it-IT,it;q=0.9,fr;q=0.8' } }), 'it');
  assert.match(buildLanguageContract('it'), /italiano/i);
  assert.match(buildLanguageContract('fr'), /privacy\/conditions/);
});

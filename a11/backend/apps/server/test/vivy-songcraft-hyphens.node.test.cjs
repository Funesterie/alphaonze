'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreVivyFrenchSongAccents } = require('../src/music/vivy-songcraft.cjs');

// Regression: gpt-oss emet U+2011 (non-breaking hyphen) dans les balises de section
// ([Pre‑Chorus - Djeff]). Le faible-check looksLikeWeakSongwritingReply et le parseur
// de sections comptaient sur un trait d'union ASCII: ces balises n'etaient pas reconnues,
// les sections etaient sous-comptees et NOSSEN s'arretait sur paroles_vivy_invalides.
// Vu en prod le 29/07/2026 (message 1020). On ramene tous les separateurs Unicode en ASCII.

test('restoreVivyFrenchSongAccents ramene le trait d union U+2011 en ASCII dans une balise de section', () => {
  const input = '[Pre' + String.fromCharCode(0x2011) + 'Chorus - Djeff]';
  const out = restoreVivyFrenchSongAccents(input);
  assert.equal(out, '[Pre-Chorus - Djeff]');
  assert.ok(!out.includes(String.fromCharCode(0x2011)), 'U+2011 doit disparaitre');
});

test('restoreVivyFrenchSongAccents normalise les variantes de trait d union et tiret Unicode', () => {
  const variants = [0x2010, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFE58, 0xFE63, 0xFF0D];
  for (const code of variants) {
    const ch = String.fromCharCode(code);
    const out = restoreVivyFrenchSongAccents('a' + ch + 'b');
    assert.equal(out, 'a-b', 'codepoint U+' + code.toString(16) + ' doit devenir un trait d union ASCII');
  }
});

test('restoreVivyFrenchSongAccents preserve les accents francais et le reste du texte', () => {
  const input = 'Dans la brume, le bit s allume, le futur se note.';
  assert.equal(restoreVivyFrenchSongAccents(input), input);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('tics : un mot porteur sur quatre lignes differentes, le refrain ne compte qu une fois', () => {
  const { findLyricTics, buildTicRewriteInstruction } = require('../src/music/lyrics-tics.cjs');
  const refrain = 'L\'odeur du neuf, c\'est cet éclat de pixel blanc\nUn fragment de clarté sur un écran de néant';
  const paroles = [
    '[Intro]', 'Un éclat solitaire, un signal vertical',
    '[Verse 1]', 'La chambre serveur dort sous un manteau d\'ébène', 'Un éclat de quartz pur qui traverse l\'éther',
    '[Chorus]', refrain,
    '[Verse 2]', 'Les ventilateurs murmurent un chant de métal', 'Il ne reste qu\'un éclat pour ne pas s\'enfuir',
    '[Chorus]', refrain,
    '[Bridge]', 'Les éclats tombent sur le sol froid',
    '[Chorus]', refrain,
  ].join('\n');
  const tics = findLyricTics(paroles);
  assert.equal(tics[0].mot, 'eclat');
  assert.equal(tics[0].lignes, 5);
  assert.ok(!tics.some((t) => t.mot === 'odeur'), 'le refrain repete ne fait pas un tic');
  assert.match(buildTicRewriteInstruction(tics), /Garde le premier emploi/);
  assert.deepEqual(findLyricTics('[Verse 1]\nUne ligne simple\nUne autre ligne\n[Chorus]\nRefrain'), []);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DIRS,
  resolveRemotePath,
  safeRemoteRelativePath,
} = require('../../../../scripts/storage-box.cjs');

test('nettoie les chemins Storage Box sans traversal', () => {
  assert.equal(safeRemoteRelativePath('../songs/../../nossen final?.mp3'), 'songs/nossen_final_.mp3');
  assert.equal(safeRemoteRelativePath('songs/album 1/titre.mp3'), 'songs/album_1/titre.mp3');
});

test('une chanson est archivee sous la racine vivy-archive', () => {
  assert.equal(resolveRemotePath('songs/nossen.mp3'), `${DIRS.songs}/nossen.mp3`);
});

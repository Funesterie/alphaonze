'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildVivyAceStepTags,
  buildVivyMusicMasterArgs,
  prepareVivyAceStepLyrics,
} = require('../src/routes/vivy-studio.cjs');

const duoInput = {
  songArtists: ['djeff', 'vivy'],
  title: 'Forteresse',
  lyrics: [
    '[Intro - Djeff solo]',
    '[Djeff]',
    'La muraille s allume.',
    '',
    '[Pre-Chorus - Vivy solo]',
    '[Vivy]',
    'Je deviens la lueur.',
    '',
    '[Hook - Duo]',
    '[Duo]',
    'Nos voix font tomber le sommeil.',
  ].join('\n'),
};

test('ACE recoit des roles acoustiques distincts plutot que les noms internes', () => {
  const lyrics = prepareVivyAceStepLyrics(duoInput);
  assert.match(lyrics, /\[Intro - Male Rap Vocal solo\]/);
  assert.match(lyrics, /\[Pre-Chorus - Female Melodic Vocal solo\]/);
  assert.match(lyrics, /\[Hook - Male and Female Duet\]/);
  assert.doesNotMatch(lyrics, /^\[(?:Djeff|Vivy|Duo)\]$/m);

  const direction = buildVivyAceStepTags(duoInput, {
    learnedDefects: [
      { defect: 'crackle', count: 1 },
      { defect: 'simple_arrangement', count: 1 },
      { defect: 'duo_not_distinct', count: 1 },
    ],
  });
  assert.equal(direction.artistCast.count, 2);
  assert.match(direction.tags, /clearly different vocal timbres/i);
  assert.match(direction.tags, /detailed evolving arrangement/i);
  assert.match(direction.tags, /clean noise floor/i);
  assert.doesNotMatch(direction.tags, /texture de vinyle|bruit de fond assume/i);
});

test('le master musical garde une marge MP3 et un seul encodeur final', () => {
  const args = buildVivyMusicMasterArgs('source.flac', 'sortie.mp3');
  const filter = args[args.indexOf('-af') + 1];
  assert.match(filter, /loudnorm=I=-14:TP=-1\.5:LRA=9/);
  assert.match(filter, /alimiter=limit=0\.840:level=false/);
  assert.equal(args.filter((value) => value === 'libmp3lame').length, 1);
});

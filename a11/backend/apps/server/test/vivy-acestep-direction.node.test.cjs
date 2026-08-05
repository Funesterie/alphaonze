'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildVivyAceStepTags,
  buildVivyMusicLoudnormAnalysisArgs,
  buildVivyMusicMasterArgs,
  parseVivyMusicLoudnormAnalysis,
  prepareVivyAceStepLyrics,
  resolveVivyMusicMasterConfig,
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

test('le master musical analyse puis normalise en seconde passe avec un seul encodeur final', () => {
  const config = resolveVivyMusicMasterConfig({});
  const probeArgs = buildVivyMusicLoudnormAnalysisArgs('source.flac', config);
  assert.match(probeArgs[probeArgs.indexOf('-af') + 1], /print_format=json/);
  const analysis = parseVivyMusicLoudnormAnalysis(`bruit ffmpeg\n{
    "input_i": "-11.40",
    "input_tp": "0.20",
    "input_lra": "7.00",
    "input_thresh": "-21.70",
    "output_i": "-14.00",
    "output_tp": "-1.50",
    "output_lra": "6.50",
    "output_thresh": "-24.20",
    "normalization_type": "linear",
    "target_offset": "0.00"
  }`);
  assert.deepEqual(analysis, {
    inputI: -11.4,
    inputTp: 0.2,
    inputLra: 7,
    inputThresh: -21.7,
    targetOffset: 0,
  });
  const args = buildVivyMusicMasterArgs('source.flac', 'sortie.mp3', analysis, config);
  const filter = args[args.indexOf('-af') + 1];
  assert.match(filter, /loudnorm=I=-14:TP=-1\.5:LRA=9/);
  assert.match(filter, /measured_I=-11\.4/);
  assert.match(filter, /linear=true/);
  assert.match(filter, /alimiter=limit=0\.800:level=false/);
  assert.equal(args.filter((value) => value === 'libmp3lame').length, 1);
});

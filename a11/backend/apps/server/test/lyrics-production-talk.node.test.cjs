'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LYRICS_TELL_THE_SUBJECT_RULE,
  buildProductionTalkRewriteInstruction,
  findProductionTalkLines,
} = require('../src/music/lyrics-production-talk.cjs');
const { buildVivySongcraftSystemPrompt, buildDjeffRapSoloLyrics } = require('../src/music/vivy-songcraft.cjs');
const { buildSingerPen } = require('../src/music/song-author-pens.cjs');

// Vers relevés sur le jukebox du 23-24/09/2026.
test('un instrument franc suffit à signaler la chanson', () => {
  for (const line of [
    'Les synthés s’élèvent, la guitare hurle,',
    'Soudain le piano monte, les basses se réveillent',
    'Hi-hats qui claquent, 808 qui frappe dans les os',
    'Le groove s’enfonce, les basses déchirent,',
    'Son cœur tape plus fort que la basse du marais',
  ]) {
    const result = findProductionTalkLines(`[Verse 1]\n${line}\nLa nuit tombe sur la ville`, 'Une nuit en ville');
    assert.equal(result.flagged, true, line);
    assert.equal(result.lines.length, 1, line);
  }
});

test('beat et tempo isolés passent, deux vers les signalent', () => {
  const single = findProductionTalkLines('[Verse 1]\nLe cœur prend le tempo, la peur perd sa menace\nJe marche droit', 'freestyle');
  assert.equal(single.flagged, false);
  const twice = findProductionTalkLines('Un cri dans la nuit, un beat qui nous tire,\nLe signal s’éteint, mais le beat persiste,', 'Le signal');
  assert.equal(twice.flagged, true);
});

test('les sens courants ne sont pas des instruments', () => {
  const lyrics = [
    'Je parle à voix basse dans la basse-cour',
    'Ma batterie lâche au bord du fossé',
    'Les cordes tendues de mes nerfs',
    'Toujours le même refrain dans ta bouche',
    'Je prends le micro, la salle se tait',
  ].join('\n');
  assert.deepEqual(findProductionTalkLines(lyrics, 'Panne de moto').lines, []);
});

test('un instrument nommé dans le sujet reste permis', () => {
  const lyrics = 'Le piano du salon garde nos silences\nSes touches jaunies comptent les absences';
  assert.equal(findProductionTalkLines(lyrics, 'Le vieux piano de ma grand-mère').flagged, false);
  assert.equal(findProductionTalkLines(lyrics, 'Ma grand-mère').flagged, true);
});

test('la consigne de réécriture cite les vers fautifs', () => {
  const result = findProductionTalkLines('Les synthés s’élèvent, la guitare hurle,', 'Satellite rouge');
  const instruction = buildProductionTalkRewriteInstruction(result);
  assert.match(instruction, /« Les synthés s’élèvent, la guitare hurle, »/);
  assert.match(instruction, /ne nomme aucun instrument/);
});

test('le prompt songcraft ne demande plus d’incarner la direction sonore en images', () => {
  const prompt = buildVivySongcraftSystemPrompt('song', { songMood: 'synthwave, basses lourdes, 808' });
  assert.doesNotMatch(prompt, /Incarne-la dans les images/);
  assert.match(prompt, /sans nommer ses instruments/);
  assert.ok(prompt.includes(LYRICS_TELL_THE_SUBJECT_RULE));
});

test('la plume de chaque chanteur porte la règle', () => {
  assert.ok(buildSingerPen('k44', { env: {} }).includes(LYRICS_TELL_THE_SUBJECT_RULE));
});

test('le gabarit de secours Djeff ne chante plus le kick ni la basse', () => {
  const lyrics = buildDjeffRapSoloLyrics({ songTitle: 'Nuit blanche' }, 'une nuit blanche en ville');
  assert.equal(findProductionTalkLines(lyrics, 'Nuit blanche').flagged, false, lyrics);
});

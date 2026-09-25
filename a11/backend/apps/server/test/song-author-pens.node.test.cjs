'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSongAuthorPens,
  describeSongAuthors,
  isSongWrittenWithoutVivy,
  resolveSongAuthors,
} = require('../src/music/song-author-pens.cjs');

test('un solo Vivy garde sa plume, sans consigne de plume en plus', () => {
  assert.equal(buildSongAuthorPens({ artists: ['vivy'] }), '');
  assert.equal(isSongWrittenWithoutVivy(['vivy']), false);
});

test('un solo Djeff est ecrit par Djeff, pas par Vivy', () => {
  const pens = buildSongAuthorPens({ artists: ['djeff'] });
  assert.match(pens, /écrite par Djeff, pas par Vivy/);
  assert.match(pens, /Plume de Djeff \(lignes sous \[Djeff\]\)/);
  assert.equal(isSongWrittenWithoutVivy(['djeff']), true);
});

test('dans un duo, chaque voix ecrit ses propres lignes', () => {
  const pens = buildSongAuthorPens({ artists: ['djeff', 'vivy'] });
  assert.match(pens, /Vivy écrit seulement ses propres parties/);
  assert.match(pens, /Plume de Djeff/);
  assert.match(pens, /Plume de Vivy/);
  assert.match(pens, /aucune n'écrit dans le style de l'autre/);
  assert.equal(isSongWrittenWithoutVivy(['djeff', 'vivy']), false);
});

test('K44, A11 et Marvin recoivent leur propre identite d auteur', () => {
  assert.match(buildSongAuthorPens({ artists: ['k44'] }), /Plume de K44[\s\S]*Kaen44/);
  assert.match(buildSongAuthorPens({ artists: ['a11'] }), /Plume de A11[\s\S]*A11/);
  assert.match(buildSongAuthorPens({ artists: ['marvin', 'vivy'] }), /Plume de Marvin[\s\S]*ADN persona marvin/);
});

test('la plume Jeffrey remplace celle de Djeff', () => {
  const pens = buildSongAuthorPens({ artists: ['djeff'], jeffreyPen: 'PLUME-JEFFREY' });
  assert.match(pens, /PLUME-JEFFREY/);
});

test('alias et libelles du live', () => {
  assert.deepEqual(resolveSongAuthors(['kaen44', 'Djeff', 'inconnu', 'djeff']), ['k44', 'djeff']);
  assert.equal(describeSongAuthors(['djeff']), 'Djeff écrit ses paroles');
  assert.equal(describeSongAuthors(['djeff', 'vivy']), 'Djeff et Vivy écrivent chacun leurs paroles');
});

test('le prompt systeme ne signe pas Vivy quand elle n est pas au casting', () => {
  const { buildVivySystemPrompt } = require('../src/routes/vivy-studio.cjs');
  const solo = buildVivySystemPrompt('song', 'fr', { songArtists: ['k44'] });
  assert.doesNotMatch(solo, /^Tu es Vivy/);
  assert.match(solo, /Vivy n'écrit pas/);
  const duo = buildVivySystemPrompt('song', 'fr', { songArtists: ['djeff', 'vivy'] });
  assert.match(duo, /^Tu es Vivy/);
  assert.match(buildVivySystemPrompt('chat', 'fr', { songArtists: ['k44'] }), /^Tu es Vivy/);
});

const { composeSingerParts, sectionOwner, splitSongSections } = require('../src/music/song-author-pens.cjs');

const DUO = [
  '[Intro]',
  'La nuit tombe sur la ville',
  '',
  '[Verse 1 - Djeff]',
  'Ligne de Djeff un',
  'Ligne de Djeff deux',
  '',
  '[Verse 2 - K44]',
  'Ligne de K44 un',
  '',
  '[Chorus - Duo Djeff + K44]',
  'Refrain commun',
].join('\n');

test('les sections sont attribuees a une seule voix, le commun reste commun', () => {
  const sections = splitSongSections(DUO);
  const owners = sections.map((section) => sectionOwner(section, ['djeff', 'k44']));
  assert.deepEqual(owners, ['', 'djeff', 'k44', '']);
});

test('chaque voix reecrit ses sections dans son propre appel, avec sa persona', async () => {
  const calls = [];
  const result = await composeSingerParts({
    lyrics: DUO,
    artists: ['djeff', 'k44'],
    logger: { warn() {} },
    writeParts: async ({ artistId, system, message }) => {
      calls.push({ artistId, system, message });
      return artistId === 'djeff'
        ? '[Verse 1 - Djeff]\nDjeff reecrit un\nDjeff reecrit deux'
        : '[Verse 2 - K44]\nK44 reecrit, elle raconte';
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls.find((c) => c.artistId === 'k44').system, /Tu es K44[\s\S]*feminine/);
  assert.match(calls.find((c) => c.artistId === 'djeff').system, /^Tu es Djeff/);
  assert.deepEqual(result.rewritten.sort(), ['djeff', 'k44']);
  assert.match(result.lyrics, /Djeff reecrit un/);
  assert.match(result.lyrics, /K44 reecrit, elle raconte/);
  assert.match(result.lyrics, /\[Chorus - Duo Djeff \+ K44\]\nRefrain commun/);
  assert.match(result.lyrics, /^\[Intro\]\nLa nuit tombe/);
  assert.doesNotMatch(result.lyrics, /Ligne de/);
});

test('une voix qui echoue ou rend un mauvais format garde le premier jet', async () => {
  const result = await composeSingerParts({
    lyrics: DUO,
    artists: ['djeff', 'k44'],
    logger: { warn() {} },
    writeParts: async ({ artistId }) => {
      if (artistId === 'djeff') throw new Error('timeout');
      return 'pas de balise du tout';
    },
  });
  assert.equal(result.lyrics, DUO);
  assert.equal(result.rewritten.length, 0);
  assert.equal(result.kept.length, 2);
});

test('un solo ne declenche aucune passe', async () => {
  let called = false;
  const result = await composeSingerParts({
    lyrics: '[Verse 1 - Djeff]\nx',
    artists: ['djeff'],
    writeParts: async () => { called = true; return ''; },
  });
  assert.equal(called, false);
  assert.equal(result.lyrics, '[Verse 1 - Djeff]\nx');
});

test('K44 est feminine dans le casting chante', () => {
  const { buildVivySongArtistCast } = require('../src/music/vivy-songcraft.cjs');
  const cast = buildVivySongArtistCast({ songArtists: ['k44'] });
  const k44 = cast.artists.find((artist) => artist.id === 'k44');
  assert.match(k44.grammar, /féminin/);
  assert.match(k44.style, /female/);
  assert.doesNotMatch(`${k44.style} ${k44.sunoRole} ${k44.grammar}`, /\bmale\b|masculin/);
});

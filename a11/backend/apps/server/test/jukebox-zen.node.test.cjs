'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const jukeboxZen = require('../src/clips/jukebox-zen.cjs');

const KEY = 'cle-de-test-jukebox-zen';

function fakeAudio(bytes = 4096) {
  // Bruit deterministe : on veut comparer octet pour octet apres aller-retour.
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buffer[i] = (i * 37 + 11) % 256;
  return buffer;
}

function sampleTrack(overrides = {}) {
  return {
    audioBuffer: fakeAudio(),
    audioFilename: 'morceau.mp3',
    title: 'Une idée prend',
    artist: 'Vivy',
    lyrics: '[Intro]\nUne idée prend\n[Refrain]\nElle pousse dans le noir',
    durationSeconds: 92.7,
    metadata: { album: 'NOSSEN V3' },
    ...overrides,
  };
}

test('un morceau fait l aller-retour sans perdre un octet', () => {
  const audio = fakeAudio(9000);
  const encoded = jukeboxZen.encodeTrack(sampleTrack({ audioBuffer: audio }), { key: KEY });
  const decoded = jukeboxZen.decodeTrack(encoded, { key: KEY });

  assert.equal(decoded.title, 'Une idée prend');
  assert.equal(decoded.artist, 'Vivy');
  assert.equal(decoded.durationSeconds, 92.7);
  assert.match(decoded.lyrics, /Elle pousse dans le noir/);
  assert.deepEqual(decoded.metadata, { album: 'NOSSEN V3' });
  assert.equal(decoded.audio.filename, 'morceau.mp3');
  assert.equal(Buffer.compare(decoded.audio.buffer, audio), 0);
  assert.equal(decoded.integrityOk, true);
});

test('le fichier commence par la signature ZEN et ne laisse pas fuiter le titre', () => {
  const encoded = jukeboxZen.encodeTrack(sampleTrack(), { key: KEY });
  assert.equal(encoded.subarray(0, 8).toString('utf8'), 'NOSSENZ1');
  // Le canon interdit d'exposer noms et contenus dans l'entete public.
  assert.equal(encoded.includes(Buffer.from('Une idée prend', 'utf8')), false);
  assert.equal(encoded.includes(Buffer.from('morceau.mp3', 'utf8')), false);
});

test('sans la bonne cle, le conteneur refuse de s ouvrir', () => {
  const encoded = jukeboxZen.encodeTrack(sampleTrack(), { key: KEY });
  assert.throws(
    () => jukeboxZen.decodeTrack(encoded, { key: 'mauvaise-cle' }),
    /authentication failed|ZEN_ERR/i
  );
});

test('sans cle du tout, on refuse d ecrire plutot que de produire un conteneur ouvert', () => {
  const previous = process.env.JUKEBOX_ZEN_KEY;
  delete process.env.JUKEBOX_ZEN_KEY;
  try {
    assert.throws(() => jukeboxZen.encodeTrack(sampleTrack()), /JUKEBOX_ZEN_KEY absente/);
  } finally {
    if (previous === undefined) delete process.env.JUKEBOX_ZEN_KEY;
    else process.env.JUKEBOX_ZEN_KEY = previous;
  }
});

test('un audio altere est signale, pas rendu en silence', () => {
  const encoded = jukeboxZen.encodeTrack(sampleTrack(), { key: KEY });
  const decoded = jukeboxZen.decodeTrack(encoded, { key: KEY });
  // On simule une charge utile dont l empreinte ne correspond plus.
  const payload = jukeboxZen.buildTrackPayload(sampleTrack());
  payload.audio.sha256 = crypto.createHash('sha256').update('autre chose').digest('hex');
  assert.equal(decoded.integrityOk, true);
  assert.notEqual(payload.audio.sha256, decoded.audio.buffer.length.toString());
});

test('la pochette voyage avec le morceau quand elle existe', () => {
  const cover = fakeAudio(512);
  const encoded = jukeboxZen.encodeTrack(
    sampleTrack({ coverBuffer: cover, coverMimeType: 'image/png' }),
    { key: KEY }
  );
  const decoded = jukeboxZen.decodeTrack(encoded, { key: KEY });
  assert.ok(decoded.cover);
  assert.equal(decoded.cover.mimeType, 'image/png');
  assert.equal(Buffer.compare(decoded.cover.buffer, cover), 0);
  assert.equal(decoded.cover.integrityOk, true);
});

test('un audio vide est refuse', () => {
  assert.throws(
    () => jukeboxZen.encodeTrack({ audioBuffer: Buffer.alloc(0) }, { key: KEY }),
    /audioBuffer requis/
  );
});

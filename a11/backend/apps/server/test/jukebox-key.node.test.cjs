'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const jukeboxKey = require('../src/clips/jukebox-key.cjs');
const jukeboxZen = require('../src/clips/jukebox-zen.cjs');

const MASTER = 'secret-maitre-de-test';

test('la meme entree rend toujours la meme cle', () => {
  const a = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z', masterSecret: MASTER });
  const b = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z', masterSecret: MASTER });
  assert.equal(a.keyBase64, b.keyBase64);
  assert.equal(a.rotation, b.rotation);
});

test('deux jukebox differents n ont jamais la meme cle', () => {
  const a = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z', masterSecret: MASTER });
  const b = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-43', epoch: '2026-08-15T10:00:00Z', masterSecret: MASTER });
  assert.notEqual(a.keyBase64, b.keyBase64);
});

test('le cube tourne : la meme identite a une autre epoque donne une autre cle', () => {
  const a = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z', masterSecret: MASTER });
  const b = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T11:00:00Z', masterSecret: MASTER });
  assert.notEqual(a.keyBase64, b.keyBase64);
});

test('sans le secret maitre, connaitre l identifiant ne suffit pas', () => {
  const vrai = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z', masterSecret: MASTER });
  const faux = jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z', masterSecret: 'autre-secret' });
  assert.notEqual(vrai.keyBase64, faux.keyBase64);
});

test('on refuse de deriver sans epoque plutot que de prendre l heure courante', () => {
  assert.throws(
    () => jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', masterSecret: MASTER }),
    /epoch requis/
  );
});

test('on refuse de deriver sans secret maitre', () => {
  const previous = process.env.JUKEBOX_MASTER_SECRET;
  const previousZen = process.env.JUKEBOX_ZEN_KEY;
  delete process.env.JUKEBOX_MASTER_SECRET;
  delete process.env.JUKEBOX_ZEN_KEY;
  try {
    assert.throws(
      () => jukeboxKey.deriveJukeboxKey({ jukeboxId: 'client-42', epoch: '2026-08-15T10:00:00Z' }),
      /JUKEBOX_MASTER_SECRET absent/
    );
  } finally {
    if (previous !== undefined) process.env.JUKEBOX_MASTER_SECRET = previous;
    if (previousZen !== undefined) process.env.JUKEBOX_ZEN_KEY = previousZen;
  }
});

test('un jukebox scelle se rouvre depuis son manifeste, des heures plus tard', () => {
  const { manifest, keyBase64 } = jukeboxKey.createJukebox({
    jukeboxId: 'session-live-7',
    epoch: '2026-08-15T09:00:00Z',
    masterSecret: MASTER,
  });
  // Le manifeste ne porte aucun secret.
  assert.equal(manifest.schema, jukeboxKey.SCHEMA);
  assert.equal(JSON.stringify(manifest).includes(MASTER), false);
  assert.equal(JSON.stringify(manifest).includes(keyBase64), false);

  const reopened = jukeboxKey.openJukebox(manifest, MASTER);
  assert.equal(reopened, keyBase64);
});

test('la cle du jukebox chiffre reellement un morceau, et un autre jukebox ne peut pas l ouvrir', () => {
  const a = jukeboxKey.createJukebox({ jukeboxId: 'client-A', epoch: '2026-08-15T09:00:00Z', masterSecret: MASTER });
  const b = jukeboxKey.createJukebox({ jukeboxId: 'client-B', epoch: '2026-08-15T09:00:00Z', masterSecret: MASTER });

  const audio = Buffer.alloc(2048);
  for (let i = 0; i < audio.length; i += 1) audio[i] = (i * 31 + 7) % 256;

  const sealed = jukeboxZen.encodeTrack(
    { audioBuffer: audio, title: 'Morceau du client A', artist: 'Vivy' },
    { key: a.keyBase64 }
  );

  const ouvert = jukeboxZen.decodeTrack(sealed, { key: a.keyBase64 });
  assert.equal(ouvert.title, 'Morceau du client A');
  assert.equal(Buffer.compare(ouvert.audio.buffer, audio), 0);

  assert.throws(
    () => jukeboxZen.decodeTrack(sealed, { key: b.keyBase64 }),
    /authentication failed|ZEN_ERR/i
  );
});

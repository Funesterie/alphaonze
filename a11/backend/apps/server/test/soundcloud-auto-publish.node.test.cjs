'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  looksLikeMachineTitle,
  publishTrackIfNew,
  readRegistry,
  resolveSharing,
  autoPublishEnabled,
} = require('../src/social/soundcloud-auto-publish.cjs');

const ACTIF = { SOUNDCLOUD_AUTO_PUBLISH_ENABLED: 'true' };
const registreTemporaire = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-pub-')), 'publies.json');
const fauxAudio = () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-audio-')), 'morceau.mp3');
  fs.writeFileSync(f, 'pas-du-vrai-audio');
  return f;
};

test('les titres qui ont fuite dans le flux public sont refuses, les vrais titres passent', () => {
  for (const machine of [
    'vivy-music-suno-c9a1b3bf79ff8451.mp3',
    'vivy-music-suno-c9a1b3bf79ff8451',
    'v11pan_1787134468238_212ba01c-ZN9kqHLnYC4WS-2fukn-funesterie-d40-v10boom-v11pan 1.mp3',
    '1783694050111-bf5a96d6-Temp-re-By-Jeffrey-Cellauro-funesterie-d40-v9electrolysis',
    '   ',
    '',
  ]) assert.equal(looksLikeMachineTitle(machine), true, machine);

  for (const humain of ['TERMINAL NOIR', 'Quota K.O.', "L'Échappatoire", 'Les Dieux de l\'Olympe', 'Tempête', 'Le Cadre']) {
    assert.equal(looksLikeMachineTitle(humain), false, humain);
  }
});

test('rien ne part tant que le drapeau n est pas leve', async () => {
  let appels = 0;
  const r = await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Le Cadre', env: {}, registryFile: registreTemporaire(),
    upload: async () => { appels += 1; return {}; },
    fingerprintOf: async () => 'a'.repeat(64),
  });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'auto_publish_desactive');
  assert.equal(appels, 0, 'aucun upload ne doit partir quand la publication auto est eteinte');
});

test('un titre de machine ne monte jamais, meme drapeau leve', async () => {
  let appels = 0;
  const r = await publishTrackIfNew({
    filePath: fauxAudio(), title: 'vivy-music-suno-c9a1b3bf79ff8451.mp3',
    env: ACTIF, registryFile: registreTemporaire(),
    upload: async () => { appels += 1; return {}; },
    fingerprintOf: async () => 'b'.repeat(64),
  });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'titre_machine_refuse');
  assert.equal(appels, 0);
});

test('deux passages sur le meme flux ne publient qu une fois', async () => {
  const registryFile = registreTemporaire();
  const filePath = fauxAudio();
  const empreinte = 'c'.repeat(64);
  let appels = 0;
  const upload = async () => { appels += 1; return { id: 42, permalinkUrl: 'https://soundcloud.com/x/le-cadre', sharing: 'public' }; };
  const options = { filePath, title: 'Le Cadre', env: ACTIF, registryFile, upload, fingerprintOf: async () => empreinte };

  const premier = await publishTrackIfNew(options);
  assert.equal(premier.published, true);
  assert.equal(premier.fingerprint, empreinte);

  const second = await publishTrackIfNew(options);
  assert.equal(second.published, false);
  assert.equal(second.reason, 'deja_publie');
  assert.equal(second.upload.trackId, 42, 'le registre rend la publication d origine');
  assert.equal(appels, 1, 'un script relance ne doit pas reuploader');
});

test('le meme morceau retagge garde son empreinte de flux et reste un doublon', async () => {
  const registryFile = registreTemporaire();
  const empreinte = 'd'.repeat(64);
  let appels = 0;
  const upload = async () => { appels += 1; return { id: 7 }; };
  // Deux fichiers differents (tags differents), un seul et meme flux audio.
  await publishTrackIfNew({ filePath: fauxAudio(), title: 'Tempête', env: ACTIF, registryFile, upload, fingerprintOf: async () => empreinte });
  const rejoue = await publishTrackIfNew({ filePath: fauxAudio(), title: 'Tempête', env: ACTIF, registryFile, upload, fingerprintOf: async () => empreinte });
  assert.equal(rejoue.reason, 'deja_publie');
  assert.equal(appels, 1);
});

test('le registre survit a un fichier absent ou corrompu sans faire tomber la publication', () => {
  const fichier = registreTemporaire();
  assert.deepEqual(readRegistry(fichier).entries, {});
  fs.writeFileSync(fichier, '{ ceci n est pas du json');
  assert.deepEqual(readRegistry(fichier).entries, {});
});

test('la portee de publication est bornee et le drapeau ne repond qu a des valeurs explicites', () => {
  assert.equal(resolveSharing({}), 'public');
  assert.equal(resolveSharing({ SOUNDCLOUD_AUTO_PUBLISH_SHARING: 'private' }), 'private');
  assert.equal(resolveSharing({ SOUNDCLOUD_AUTO_PUBLISH_SHARING: 'nimporte-quoi' }), 'public');
  assert.equal(autoPublishEnabled({}), false);
  assert.equal(autoPublishEnabled({ SOUNDCLOUD_AUTO_PUBLISH_ENABLED: 'false' }), false);
  assert.equal(autoPublishEnabled({ SOUNDCLOUD_AUTO_PUBLISH_ENABLED: '1' }), true);
});

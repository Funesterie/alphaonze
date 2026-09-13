'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  looksLikeMachineTitle,
  normaliserTitre,
  publishTrackIfNew,
  readRegistry,
  resolveSharing,
  autoPublishEnabled,
} = require('../src/social/soundcloud-auto-publish.cjs');

// --- Gardes du 13/09/2026 : URL comme titre, lot de juillet deja en ligne -----

test('une URL, du HTML ou un titre-fleuve ne se publient jamais, meme venus de la source', () => {
  assert.equal(looksLikeMachineTitle('https://console.neo4j.io/org/f81a5f35/billing'), true);
  assert.equal(looksLikeMachineTitle('www.exemple.fr'), true);
  assert.equal(looksLikeMachineTitle('Titre <b>gras</b>'), true);
  assert.equal(looksLikeMachineTitle('x'.repeat(121)), true);
  assert.equal(looksLikeMachineTitle('Sous la Pluie de Néons Roses'), false);
  assert.equal(looksLikeMachineTitle('User: .NET: Project GitHub Copilot: Optimized tool selection'), true, 'fragment de chat');
  assert.equal(looksLikeMachineTitle('Assistant : voici ta chanson'), true);
  assert.equal(looksLikeMachineTitle('Utilisateur du futur'), false, 'un vrai mot n est pas un fragment');
  assert.equal(normaliserTitre('  Éclat d’Étincelle ! '), 'eclat d etincelle');
});

test('un titre deja en ligne est saute avant tout ecrit au registre, et rien ne part', async () => {
  const registryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-deja-')), 'publies.json');
  let uploads = 0;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-deja-audio-')), 'm.mp3');
  fs.writeFileSync(f, 'audio');
  const r = await publishTrackIfNew({
    filePath: f, title: 'Dans la Nuit Je Cours', env: { SOUNDCLOUD_AUTO_PUBLISH_ENABLED: 'true' }, registryFile,
    fingerprintOf: async () => ({ sha256: 'd'.repeat(64), codec: 'mp3', sampleRate: 44100, channels: 2 }),
    upload: async () => { uploads += 1; return { id: 1 }; },
    titleAlreadyPublished: (t) => normaliserTitre(t) === 'dans la nuit je cours',
  });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'titre_deja_sur_soundcloud');
  assert.equal(uploads, 0);
  assert.deepEqual(readRegistry(registryFile).entries, {}, 'aucun pending pose');
});

test('la liste du compte suit la pagination de l API seulement, et refuse si elle est incomplete', async () => {
  const { listSoundCloudTracks } = require('../src/social/social-autoprompt.cjs');
  const reponse = (data) => ({ ok: true, status: 200, json: async () => data });
  const pages = {
    '/me': { id: 7, track_count: 3 },
    '/me/tracks': { collection: [{ id: 1, title: 'Un' }, { id: 2, title: 'Deux' }], next_href: 'https://api.soundcloud.com/me/tracks?page=2' },
  };
  const fetchOk = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/me/tracks' && u.searchParams.get('page') === '2') return reponse({ collection: [{ id: 3, title: 'Trois' }] });
    return reponse(pages[u.pathname]);
  };
  const liste = await listSoundCloudTracks('jeton', {}, fetchOk);
  assert.deepEqual(liste.map((t) => t.title), ['Un', 'Deux', 'Trois']);

  const fetchIncomplet = async (url) => reponse(new URL(url).pathname === '/me' ? { track_count: 326 } : { collection: [] });
  await assert.rejects(listSoundCloudTracks('jeton', {}, fetchIncomplet), /soundcloud_listing_incomplete/);

  const fetchHorsApi = async (url) => reponse(new URL(url).pathname === '/me' ? { track_count: 0 } : { collection: [], next_href: 'https://evil.example/steal' });
  await assert.rejects(listSoundCloudTracks('jeton', {}, fetchHorsApi), /soundcloud_pagination_hors_api/);
});

const ACTIF = { SOUNDCLOUD_AUTO_PUBLISH_ENABLED: 'true' };
const registreTemporaire = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-pub-')), 'publies.json');
/** Ce que rend readAudioStreamIntegrity: une empreinte ET la forme du flux. */
const integrite = (lettre) => ({
  schema: 'funesterie.audio.stream-integrity.v1', algorithm: 'sha256',
  representation: 'demuxed-encoded-audio-packets', selection: '0:a:0',
  streamIndex: 0, codec: 'mp3', sampleRate: 44100, channels: 2, sha256: lettre.repeat(64),
});
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
    fingerprintOf: async () => integrite('a'),
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
    fingerprintOf: async () => integrite('b'),
  });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'titre_machine_refuse');
  assert.equal(appels, 0);
});

test('deux passages sur le meme flux ne publient qu une fois', async () => {
  const registryFile = registreTemporaire();
  const filePath = fauxAudio();
  const empreinte = integrite('c');
  let appels = 0;
  const upload = async () => { appels += 1; return { id: 42, permalinkUrl: 'https://soundcloud.com/x/le-cadre', sharing: 'public' }; };
  const options = { filePath, title: 'Le Cadre', env: ACTIF, registryFile, upload, fingerprintOf: async () => empreinte };

  const premier = await publishTrackIfNew(options);
  assert.equal(premier.published, true);
  assert.equal(premier.fingerprint, empreinte.sha256);

  const second = await publishTrackIfNew(options);
  assert.equal(second.published, false);
  assert.equal(second.reason, 'deja_publie');
  assert.equal(second.upload.trackId, 42, 'le registre rend la publication d origine');
  assert.equal(appels, 1, 'un script relance ne doit pas reuploader');
});

test('le meme morceau retagge garde son empreinte de flux et reste un doublon', async () => {
  const registryFile = registreTemporaire();
  const empreinte = integrite('d');
  let appels = 0;
  const upload = async () => { appels += 1; return { id: 7 }; };
  // Deux fichiers differents (tags differents), un seul et meme flux audio.
  await publishTrackIfNew({ filePath: fauxAudio(), title: 'Tempête', env: ACTIF, registryFile, upload, fingerprintOf: async () => empreinte });
  const rejoue = await publishTrackIfNew({ filePath: fauxAudio(), title: 'Tempête', env: ACTIF, registryFile, upload, fingerprintOf: async () => empreinte });
  assert.equal(rejoue.reason, 'deja_publie');
  assert.equal(appels, 1);
});

test('un registre absent est vide, un registre corrompu bloque la publication', () => {
  const fichier = registreTemporaire();
  assert.deepEqual(readRegistry(fichier).entries, {});
  fs.writeFileSync(fichier, '{ ceci n est pas du json');
  assert.throws(() => readRegistry(fichier), /soundcloud_registry_invalid/);
});

test('la portee de publication est bornee et le drapeau ne repond qu a des valeurs explicites', () => {
  assert.equal(resolveSharing({}), 'public');
  assert.equal(resolveSharing({ SOUNDCLOUD_AUTO_PUBLISH_SHARING: 'private' }), 'private');
  assert.equal(resolveSharing({ SOUNDCLOUD_AUTO_PUBLISH_SHARING: 'nimporte-quoi' }), 'public');
  assert.equal(autoPublishEnabled({}), false);
  assert.equal(autoPublishEnabled({ SOUNDCLOUD_AUTO_PUBLISH_ENABLED: 'false' }), false);
  assert.equal(autoPublishEnabled({ SOUNDCLOUD_AUTO_PUBLISH_ENABLED: '1' }), true);
});

test('une empreinte qui ne ressemble pas a un sha256 fait echouer plutot que publier', async () => {
  let appels = 0;
  await assert.rejects(
    publishTrackIfNew({
      filePath: fauxAudio(), title: 'Le Cadre', env: ACTIF, registryFile: registreTemporaire(),
      upload: async () => { appels += 1; return {}; },
      fingerprintOf: async () => ({ sha256: 'pas-une-empreinte' }),
    }),
    /empreinte_flux_invalide/
  );
  assert.equal(appels, 0);
});

test('le registre garde la forme du flux, pas seulement son empreinte', async () => {
  const registryFile = registreTemporaire();
  await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Tempête', env: ACTIF, registryFile,
    upload: async () => ({ id: 9, sharing: 'public' }),
    fingerprintOf: async () => integrite('e'),
  });
  const entree = readRegistry(registryFile).entries['e'.repeat(64)];
  assert.equal(entree.codec, 'mp3');
  assert.equal(entree.sampleRate, 44100);
  assert.equal(entree.channels, 2);
});

test('« Session principale » ne se publie jamais tel quel', async () => {
  let appels = 0;
  const r = await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Session principale', env: ACTIF, registryFile: registreTemporaire(),
    upload: async () => { appels += 1; return {}; },
    fingerprintOf: async () => integrite('f'),
  });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'titre_indisponible', 'sans paroles ni titreur, on attend au lieu de publier');
  assert.equal(appels, 0);
});

test('un morceau generique AVEC paroles est titre puis publie sous son vrai titre', async () => {
  let publie = null;
  const r = await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Session principale', lyrics: 'Dans le tunnel je trouve ma couronne',
    env: ACTIF, registryFile: registreTemporaire(),
    upload: async (arg) => { publie = arg; return { id: 11, sharing: 'public' }; },
    titleTrack: async () => ({ title: 'La Couronne du Tunnel', costUsd: 0.0021, model: 'claude-sonnet-4-5-20250929' }),
    fingerprintOf: async () => integrite('a'),
  });
  assert.equal(r.published, true);
  assert.equal(publie.title, 'La Couronne du Tunnel', 'c est le titre du parolier qui part, pas celui de Suno');
});

test('un titreur qui rend encore un titre generique ne debloque rien', async () => {
  let appels = 0;
  const r = await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Session principale', lyrics: 'des paroles bien reelles',
    env: ACTIF, registryFile: registreTemporaire(),
    upload: async () => { appels += 1; return {}; },
    titleTrack: async () => ({ title: 'Sans titre' }),
    fingerprintOf: async () => integrite('b'),
  });
  assert.equal(r.reason, 'titrage_refuse');
  assert.equal(appels, 0);
});

test('le registre dit qui a titre et ce que ca a coute', async () => {
  const registryFile = registreTemporaire();
  await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Session principale', lyrics: 'paroles', env: ACTIF, registryFile,
    upload: async () => ({ id: 12 }),
    titleTrack: async () => ({ title: 'Le Cadre', costUsd: 0.0021, model: 'claude-sonnet-4-5-20250929' }),
    fingerprintOf: async () => integrite('c'),
  });
  const entree = readRegistry(registryFile).entries['c'.repeat(64)];
  assert.equal(entree.titledBy, 'claude-sonnet-4-5-20250929');
  assert.equal(entree.titlingCostUsd, 0.0021);
});

test('la déduplication précède tout titrage payant', async () => {
  let titles = 0, uploads = 0;
  const options = {
    filePath: fauxAudio(), title: 'Session principale', lyrics: 'paroles', env: ACTIF, registryFile: registreTemporaire(),
    upload: async () => { uploads++; return { id: 18 }; },
    titleTrack: async () => { titles++; return { title: 'La Nuit claire' }; },
    fingerprintOf: async () => integrite('a'),
  };
  await publishTrackIfNew(options);
  const second = await publishTrackIfNew(options);
  assert.equal(second.reason, 'deja_publie');
  assert.equal(titles, 1);
  assert.equal(uploads, 1);
});

test('un registre corrompu bloque avant titreur et upload', async () => {
  const registryFile = registreTemporaire();
  fs.writeFileSync(registryFile, '{broken');
  let calls = 0;
  await assert.rejects(publishTrackIfNew({
    filePath: fauxAudio(), title: 'Session principale', lyrics: 'paroles', env: ACTIF, registryFile,
    fingerprintOf: async () => integrite('b'),
    titleTrack: async () => { calls++; }, upload: async () => { calls++; },
  }), /soundcloud_registry_invalid/);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(`${registryFile}.lock`), false);
});

test('pending est persiste avant upload et une reponse ambiguë ne repart jamais', async () => {
  const registryFile = registreTemporaire();
  let uploads = 0;
  const options = {
    filePath: fauxAudio(), title: 'Le Cadre', env: ACTIF, registryFile,
    fingerprintOf: async () => integrite('c'),
    upload: async () => {
      uploads++;
      assert.equal(readRegistry(registryFile).entries['c'.repeat(64)].status, 'pending');
      throw new Error('socket closed after request');
    },
  };
  await assert.rejects(publishTrackIfNew(options), /socket closed/);
  assert.equal(readRegistry(registryFile).entries['c'.repeat(64)].status, 'ambiguous');
  assert.equal((await publishTrackIfNew(options)).reason, 'publication_ambigue');
  assert.equal(uploads, 1);
});

test('un pending hérité après crash ne provoque aucun nouvel upload', async () => {
  const registryFile = registreTemporaire();
  fs.writeFileSync(registryFile, JSON.stringify({ schema: 'funesterie.social.soundcloud-published.v1', entries: { ['d'.repeat(64)]: { status: 'pending', title: 'Le Cadre' } } }));
  let calls = 0;
  const result = await publishTrackIfNew({
    filePath: fauxAudio(), title: 'Le Cadre', env: ACTIF, registryFile,
    fingerprintOf: async () => integrite('d'), upload: async () => { calls++; },
  });
  assert.equal(result.reason, 'publication_pending');
  assert.equal(calls, 0);
});

test('deux appelants concurrents ne titrent ni ne publient deux fois', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let accepted;
  const entered = new Promise((resolve) => { accepted = resolve; });
  const options = {
    filePath: fauxAudio(), title: 'Le Cadre', env: ACTIF, registryFile: registreTemporaire(),
    fingerprintOf: async () => integrite('e'),
    upload: async () => { accepted(); await pending; return { id: 25 }; },
  };
  const first = publishTrackIfNew(options);
  await entered;
  await assert.rejects(publishTrackIfNew(options), /soundcloud_registry_locked/);
  release();
  await first;
});

test('un reçu sans ID est ambigu, un refus OAuth reste à vérifier sans repost', async () => {
  for (const scenario of ['empty', 'unauthorized']) {
    const registryFile = registreTemporaire();
    let calls = 0;
    const options = {
      filePath: fauxAudio(), title: 'Le Cadre', env: ACTIF, registryFile,
      fingerprintOf: async () => integrite('f'), upload: async () => {
        calls++;
        if (scenario === 'unauthorized') throw Object.assign(Error('Unauthorized'), { status: 401 });
        return {};
      },
    };
    await assert.rejects(publishTrackIfNew(options), scenario === 'empty' ? /receipt_missing/ : /Unauthorized/);
    assert.equal((await publishTrackIfNew(options)).reason, scenario === 'empty' ? 'publication_ambigue' : 'publication_a_verifier');
    assert.equal(calls, 1);
  }
});

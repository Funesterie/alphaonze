'use strict';

/**
 * Envoi YouTube en transfert reprenable.
 *
 * L'invariant qui compte n'est pas "ca envoie" mais "ca reprend a la position que
 * YOUTUBE annonce, jamais a celle qu'on croit avoir atteinte". Un compteur local
 * qui avance sur des octets jamais arrives produit une video corrompue que rien
 * ne signale. D'ou un faux serveur qui coupe volontairement au milieu.
 *
 * Aucun test ne touche au reseau : `fetchImpl` est toujours injecte.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  construireMetadonnees,
  uploadVideo,
  TAILLE_BLOC,
} = require('../src/social/youtube-upload.cjs');

const SESSION = 'https://upload.googleapis.com/upload/youtube/v3/videos?upload_id=faux';

function fichierTemporaire(octets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-upload-test-'));
  const p = path.join(dir, 'clip.mp4');
  // Contenu non nul: un buffer de zeros masquerait une erreur de decoupage.
  const buf = Buffer.allocUnsafe(octets);
  for (let i = 0; i < octets; i += 1) buf[i] = i % 251;
  fs.writeFileSync(p, buf);
  return { chemin: p, buffer: buf, nettoyer: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function reponse({ status, headers = {}, body = null }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    json: async () => body ?? {},
  };
}

// --- metadonnees ------------------------------------------------------------

test('un titre absent est refuse avant tout appel reseau', () => {
  assert.throws(() => construireMetadonnees({ description: 'x' }), /title_required/);
});

test('titre et description sont tronques aux limites de YouTube', () => {
  const m = construireMetadonnees({ title: 'T'.repeat(250), description: 'D'.repeat(9000) });
  assert.equal(m.snippet.title.length, 100);
  assert.equal(m.snippet.description.length, 5000);
});

test('une virgule dans un tag est neutralisee, pas laissee scinder le tag', () => {
  // YouTube separe les tags par virgule : « Djeff, Vivy » deviendrait deux tags.
  const m = construireMetadonnees({ title: 'x', tags: ['NOSSEN', 'Djeff, Vivy', '  ', 'a'] });
  assert.deepEqual(m.snippet.tags, ['NOSSEN', 'Djeff Vivy', 'a']);
});

test('la confidentialite par defaut est private, et une valeur inconnue y retombe', () => {
  assert.equal(construireMetadonnees({ title: 'x' }).status.privacyStatus, 'private');
  assert.equal(construireMetadonnees({ title: 'x', privacyStatus: 'nimporte' }).status.privacyStatus, 'private');
  assert.equal(construireMetadonnees({ title: 'x', privacyStatus: 'public' }).status.privacyStatus, 'public');
});

test('publishAt n est pose que sur une video private', () => {
  // Programmer une video deja visible est refuse par YouTube.
  const prive = construireMetadonnees({ title: 'x', privacyStatus: 'private', publishAt: '2026-09-01T10:00:00Z' });
  assert.equal(prive.status.publishAt, '2026-09-01T10:00:00Z');
  const publique = construireMetadonnees({ title: 'x', privacyStatus: 'public', publishAt: '2026-09-01T10:00:00Z' });
  assert.equal(publique.status.publishAt, undefined);
});

// --- garde-fous avant reseau ------------------------------------------------

test('un fichier absent echoue sans ouvrir de session', async () => {
  let appels = 0;
  await assert.rejects(
    () => uploadVideo({
      accessToken: 'jeton',
      filePath: path.join(os.tmpdir(), 'inexistant-xyz.mp4'),
      metadata: { title: 'x' },
      fetchImpl: async () => { appels += 1; throw new Error('ne doit pas etre appele'); },
    }),
    /file_missing/
  );
  assert.equal(appels, 0, 'aucun appel reseau ne doit avoir lieu');
});

test('un jeton absent echoue sans toucher au disque ni au reseau', async () => {
  await assert.rejects(
    () => uploadVideo({ accessToken: '', filePath: 'peu importe', metadata: { title: 'x' } }),
    /access_token_required/
  );
});

test('un 403 a l ouverture est nomme comme un perimetre manquant', async () => {
  // C'est le symptome exact d'un jeton emis sans youtube.upload. Sans ce
  // diagnostic, on cherche la panne dans le transfert pendant des heures.
  const f = fichierTemporaire(1024);
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async () => reponse({
          status: 403,
          body: { error: { message: 'insufficientPermissions' } },
        }),
      }),
      (e) => e.code === 'youtube_upload_scope_missing'
    );
  } finally {
    f.nettoyer();
  }
});

// --- transfert et reprise --------------------------------------------------

test('un petit fichier part en un bloc et rend son identifiant', async () => {
  const f = fichierTemporaire(2048);
  const recu = [];
  try {
    const res = await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'NOSSEN', privacyStatus: 'private' },
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        recu.push(init.headers['content-range']);
        return reponse({ status: 200, body: { id: 'VID123', status: { privacyStatus: 'private' } } });
      },
    });
    assert.equal(res.videoId, 'VID123');
    assert.equal(res.url, 'https://www.youtube.com/watch?v=VID123');
    assert.equal(res.uploadedBytes, 2048);
    assert.equal(res.resumes, 0);
    assert.deepEqual(recu, ['bytes 0-2047/2048']);
  } finally {
    f.nettoyer();
  }
});

test('apres une coupure, la reprise suit la position annoncee par YouTube', async () => {
  // Le coeur du module. Le serveur accepte 1000 octets, coupe, puis declare
  // n'en avoir recu que 500 : un envoi correct DOIT repartir de 500.
  const f = fichierTemporaire(TAILLE_BLOC + 1000);
  const debuts = [];
  let coupeFait = false;
  try {
    const res = await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x' },
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        const plage = init.headers['content-range'];
        // Sonde de position (corps vide) : on annonce 500 octets recus.
        if (plage === `bytes */${TAILLE_BLOC + 1000}`) {
          return reponse({ status: 308, headers: { range: 'bytes=0-499' } });
        }
        debuts.push(Number(plage.split(' ')[1].split('-')[0]));
        if (!coupeFait) {
          coupeFait = true;
          throw new Error('ECONNRESET');
        }
        const fin = Number(plage.split('-')[1].split('/')[0]);
        if (fin + 1 >= TAILLE_BLOC + 1000) {
          return reponse({ status: 200, body: { id: 'VID9', status: { privacyStatus: 'private' } } });
        }
        return reponse({ status: 308, headers: { range: `bytes=0-${fin}` } });
      },
    });
    assert.equal(res.videoId, 'VID9');
    assert.equal(res.resumes, 1);
    assert.equal(debuts[0], 0, 'le premier bloc part de 0');
    assert.equal(debuts[1], 500, 'la reprise doit suivre YouTube (500), pas notre compteur');
  } finally {
    f.nettoyer();
  }
});

test('sans en-tete Range, la reprise repart de zero au lieu de deviner', async () => {
  const f = fichierTemporaire(4096);
  const debuts = [];
  let coupeFait = false;
  try {
    await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x' },
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        const plage = init.headers['content-range'];
        if (plage === 'bytes */4096') return reponse({ status: 308 }); // aucun Range
        debuts.push(Number(plage.split(' ')[1].split('-')[0]));
        if (!coupeFait) { coupeFait = true; throw new Error('coupure'); }
        return reponse({ status: 200, body: { id: 'VID0', status: { privacyStatus: 'private' } } });
      },
    });
    assert.deepEqual(debuts, [0, 0], 'sans Range, aucun octet confirme: on recommence');
  } finally {
    f.nettoyer();
  }
});

test('les coupures a repetition finissent par echouer plutot que boucler', async () => {
  const f = fichierTemporaire(1024);
  let tentatives = 0;
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        maxRetries: 2,
        fetchImpl: async (url, init) => {
          if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
          if (init.headers['content-range'] === 'bytes */1024') {
            return reponse({ status: 308, headers: { range: 'bytes=0-0' } });
          }
          tentatives += 1;
          throw new Error('reseau mort');
        },
      }),
      /reseau mort/
    );
    assert.equal(tentatives, 3, 'maxRetries=2 -> 1 tentative + 2 reprises, puis abandon');
  } finally {
    f.nettoyer();
  }
});

test('un 500 est repris, il ne fait pas echouer l envoi', async () => {
  const f = fichierTemporaire(1024);
  let cinqCentServi = false;
  try {
    const res = await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x' },
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        if (init.headers['content-range'] === 'bytes */1024') {
          return reponse({ status: 308, headers: { range: 'bytes=0-0' } });
        }
        if (!cinqCentServi) { cinqCentServi = true; return reponse({ status: 503 }); }
        return reponse({ status: 201, body: { id: 'VID5', status: { privacyStatus: 'private' } } });
      },
    });
    assert.equal(res.videoId, 'VID5');
    assert.equal(res.resumes, 1);
  } finally {
    f.nettoyer();
  }
});

test('un 400 arrete tout de suite: ce n est pas reprenable', async () => {
  const f = fichierTemporaire(1024);
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async (url, init) => {
          if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
          return reponse({ status: 400, body: { error: { message: 'invalidVideoMetadata' } } });
        },
      }),
      /invalidVideoMetadata/
    );
  } finally {
    f.nettoyer();
  }
});

// --- verrouillage par projet non audite ------------------------------------

test('public demande + private obtenu est signale comme un verrouillage probable', async () => {
  // Politique YouTube : un projet non audite voit ses envois forces en prive.
  // Sans ce drapeau, l'appelant croit a un bug de son propre code.
  const f = fichierTemporaire(512);
  try {
    const res = await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x', privacyStatus: 'public' },
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        return reponse({ status: 200, body: { id: 'VIDP', status: { privacyStatus: 'private' } } });
      },
    });
    assert.equal(res.lockedPrivateLikely, true);
    assert.equal(res.privacyStatus, 'private');
  } finally {
    f.nettoyer();
  }
});

test('private demande + private obtenu n est PAS signale comme verrouillage', async () => {
  const f = fichierTemporaire(512);
  try {
    const res = await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x', privacyStatus: 'private' },
      fetchImpl: async (url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        return reponse({ status: 200, body: { id: 'VIDQ', status: { privacyStatus: 'private' } } });
      },
    });
    assert.equal(res.lockedPrivateLikely, false, 'aucun faux positif quand private est ce qu on voulait');
  } finally {
    f.nettoyer();
  }
});

test('une reponse sans identifiant de video est une erreur, pas un succes', async () => {
  const f = fichierTemporaire(512);
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async (url, init) => {
          if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
          return reponse({ status: 200, body: {} });
        },
      }),
      /no_video_id/
    );
  } finally {
    f.nettoyer();
  }
});

test('une session sans URL de reprise echoue immediatement', async () => {
  const f = fichierTemporaire(512);
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async () => reponse({ status: 200 }), // pas d'en-tete location
      }),
      /session_url_missing/
    );
  } finally {
    f.nettoyer();
  }
});

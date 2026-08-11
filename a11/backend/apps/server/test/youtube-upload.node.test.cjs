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

test('un fichier tronque pendant le POST de session ne produit aucun PUT binaire', async () => {
  const f = fichierTemporaire(2048);
  let putsBinaires = 0;
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async (_url, init) => {
          if (init.method === 'POST') {
            fs.truncateSync(f.chemin, 0);
            return reponse({ status: 200, headers: { location: SESSION } });
          }
          if (init.method === 'PUT' && init.body) putsBinaires += 1;
          return reponse({ status: 500 });
        },
      }),
      (error) => error.code === 'youtube_upload_file_changed'
    );
    assert.equal(putsBinaires, 0, 'aucun buffer partiellement lu ne doit etre envoye');
  } finally {
    f.nettoyer();
  }
});

test('un 403 insufficientPermissions est nomme comme un perimetre manquant', async () => {
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
          body: {
            error: {
              code: 403,
              message: 'Request had insufficient authentication scopes.',
              errors: [{ reason: 'insufficientPermissions' }],
            },
          },
        }),
      }),
      (e) => e.code === 'youtube_upload_scope_missing'
    );
  } finally {
    f.nettoyer();
  }
});

test('quota, limite quotidienne, limite d upload et interdit restent distincts du scope', async () => {
  const cas = [
    ['quotaExceeded', 403, 'youtube_upload_quota_exceeded'],
    ['dailyLimitExceeded', 403, 'youtube_upload_daily_limit_exceeded'],
    ['uploadLimitExceeded', 400, 'youtube_upload_limit_exceeded'],
    ['forbidden', 403, 'youtube_upload_forbidden'],
  ];
  const f = fichierTemporaire(1024);
  try {
    for (const [reason, status, codeAttendu] of cas) {
      await assert.rejects(
        () => uploadVideo({
          accessToken: 'jeton',
          filePath: f.chemin,
          metadata: { title: 'x' },
          fetchImpl: async () => reponse({
            status,
            body: { error: { code: status, message: 'Forbidden', errors: [{ reason }] } },
          }),
        }),
        (error) => {
          assert.equal(error.code, codeAttendu, reason);
          assert.notEqual(error.code, 'youtube_upload_scope_missing', reason);
          return true;
        }
      );
    }
  } finally {
    f.nettoyer();
  }
});

test('un message insufficientPermissions sans reason machine reste un interdit generique', async () => {
  const f = fichierTemporaire(1024);
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async () => reponse({
          status: 403,
          body: { error: { code: 403, message: 'insufficientPermissions' } },
        }),
      }),
      (error) => error.code === 'youtube_upload_forbidden'
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

test('un 308 de bloc sans Range renvoie le premier bloc depuis zero', async () => {
  const f = fichierTemporaire(4096);
  const debuts = [];
  try {
    const resultat = await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x' },
      fetchImpl: async (_url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        const plage = init.headers['content-range'];
        debuts.push(Number(plage.split(' ')[1].split('-')[0]));
        if (debuts.length === 1) return reponse({ status: 308 });
        return reponse({ status: 200, body: { id: 'VID308', status: { privacyStatus: 'private' } } });
      },
    });
    assert.equal(resultat.videoId, 'VID308');
    assert.deepEqual(debuts, [0, 0], 'un 308 sans Range ne confirme aucun octet du premier bloc');
  } finally {
    f.nettoyer();
  }
});

test('un Range 308 malforme ne confirme aucun octet', async () => {
  const f = fichierTemporaire(4096);
  const debuts = [];
  try {
    await uploadVideo({
      accessToken: 'jeton',
      filePath: f.chemin,
      metadata: { title: 'x' },
      fetchImpl: async (_url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
        const plage = init.headers['content-range'];
        debuts.push(Number(plage.split(' ')[1].split('-')[0]));
        if (debuts.length === 1) {
          return reponse({ status: 308, headers: { range: 'bytes=12-4095' } });
        }
        return reponse({ status: 200, body: { id: 'VIDRANGE', status: { privacyStatus: 'private' } } });
      },
    });
    assert.deepEqual(debuts, [0, 0], 'seule la forme bytes=0-N peut confirmer une progression');
  } finally {
    f.nettoyer();
  }
});

test('des 308 sans Range repetes echouent avec la garde no-progress', async () => {
  const f = fichierTemporaire(1024);
  let blocs = 0;
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        maxRetries: 2,
        fetchImpl: async (_url, init) => {
          if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
          blocs += 1;
          return reponse({ status: 308 });
        },
      }),
      (error) => error.code === 'youtube_upload_no_progress'
    );
    assert.equal(blocs, 3, 'maxRetries=2 autorise deux reprises, puis abandonne');
  } finally {
    f.nettoyer();
  }
});

test('tous les PUT portent le Bearer et le type MIME attendu', async () => {
  const f = fichierTemporaire(2048);
  let blocInitial = true;
  let sondes = 0;
  try {
    const resultat = await uploadVideo({
      accessToken: 'jeton-auth',
      filePath: f.chemin,
      metadata: { title: 'x' },
      fetchImpl: async (_url, init) => {
        if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });

        assert.equal(init.headers.authorization, 'Bearer jeton-auth', 'tout PUT doit etre authentifie');
        assert.equal(init.headers['content-type'], 'video/mp4', 'tout PUT conserve le MIME de la video');
        const plage = init.headers['content-range'];
        if (plage === 'bytes */2048') {
          sondes += 1;
          return reponse({ status: 308, headers: { range: 'bytes=0-0' } });
        }
        if (blocInitial) {
          blocInitial = false;
          return reponse({ status: 503 });
        }
        return reponse({ status: 200, body: { id: 'VIDAUTH', status: { privacyStatus: 'private' } } });
      },
    });
    assert.equal(resultat.videoId, 'VIDAUTH');
    assert.equal(sondes, 1, 'le test doit exercer aussi le PUT de sonde');
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

test('un quotaExceeded pendant le PUT de transfert conserve sa classification 429', async () => {
  const f = fichierTemporaire(2048);
  let appels = 0;
  try {
    await assert.rejects(
      () => uploadVideo({
        accessToken: 'jeton',
        filePath: f.chemin,
        metadata: { title: 'x' },
        fetchImpl: async (_url, init) => {
          appels += 1;
          if (init.method === 'POST') return reponse({ status: 200, headers: { location: SESSION } });
          return reponse({
            status: 403,
            body: { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } },
          });
        },
      }),
      (error) => error.code === 'youtube_upload_quota_exceeded'
    );
    assert.equal(appels, 2, 'le quota ne doit ni etre repris ni transforme en panne generique');
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

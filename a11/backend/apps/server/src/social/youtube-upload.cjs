'use strict';

/**
 * Envoi d'une video sur YouTube — `videos.insert` en transfert reprenable.
 *
 * POURQUOI UN MODULE A PART
 * `youtubeApi()` (social-autoprompt.cjs) ne fait que du GET vers
 * `www.googleapis.com/youtube/v3`. Un envoi part vers un AUTRE hote,
 * `upload.googleapis.com`, en POST, avec un corps binaire. Le greffer sur le
 * helper de lecture aurait demande de le tordre pour tous ses appelants.
 *
 * CE QU'IL FAUT SAVOIR AVANT DE S'EN SERVIR — la limite n'est pas dans ce code :
 *
 * 1. PERIMETRE. `videos.insert` exige `youtube.upload` (ou `youtube.force-ssl`).
 *    `youtube.readonly` ne suffit pas et l'appel repond 403 `insufficientPermissions`.
 *    A declarer sur le client OAuth YouTube, et a reconsentir : un jeton emis
 *    avant l'ajout du perimetre ne le porte pas.
 *
 * 2. AUDIT DE CONFORMITE. Tout envoi depuis un projet API non audite est
 *    VERROUILLE EN PRIVE par YouTube, sans recours — politique en place depuis le
 *    28/07/2020, verifiee toujours active en aout 2026. `privacyStatus: 'public'`
 *    sera accepte par l'API puis ignore, et le proprietaire recoit un courriel
 *    d'explication. L'audit de conformite YouTube est DISTINCT de la verification
 *    OAuth : autre formulaire, autre demonstration, autre delai.
 *    Consequence pratique : envoyer en `private` et publier a la main tant que
 *    l'audit n'est pas obtenu, plutot que de croire a une panne.
 *
 * 3. QUOTA. Depuis le quota granulaire 2026, `videos.insert` coute 1 unite dans
 *    le compartiment Video Uploads, alloue a 100 appels par jour par defaut.
 *    Verifier la console Google avant une campagne ou des essais repetes.
 */

const fs = require('node:fs');
const path = require('node:path');

const UPLOAD_BASE = 'https://upload.googleapis.com/upload/youtube/v3/videos';
const API_BASE = 'https://www.googleapis.com/youtube/v3';

/** Taille de bloc: multiple de 256 Kio, exige par le protocole reprenable. */
const TAILLE_BLOC = 8 * 1024 * 1024;

const PRIVACITES = new Set(['private', 'unlisted', 'public']);

function texte(valeur, max) {
  const s = String(valeur ?? '').trim();
  return max ? s.slice(0, max) : s;
}

function typeMime(fichier) {
  const ext = path.extname(fichier).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.avi') return 'video/x-msvideo';
  return 'video/*';
}

/**
 * Construit la partie `snippet`/`status` de la requete.
 *
 * Les longueurs sont celles imposees par YouTube : un titre de 101 caracteres
 * fait echouer tout l'envoi APRES le transfert des octets. On tronque donc en
 * amont — perdre la fin d'un titre est moins grave que perdre le transfert.
 */
function construireMetadonnees({
  title,
  description = '',
  tags = [],
  categoryId = '10',
  privacyStatus = 'private',
  madeForKids = false,
  publishAt = '',
} = {}) {
  const titre = texte(title, 100);
  if (!titre) {
    const error = new Error('youtube_upload_title_required');
    error.code = 'youtube_upload_title_required';
    throw error;
  }

  const privacite = PRIVACITES.has(String(privacyStatus)) ? String(privacyStatus) : 'private';

  // Un tag contenant une virgule est scinde en deux par YouTube : on les retire
  // plutot que de laisser un tag se dedoubler en silence.
  const etiquettes = (Array.isArray(tags) ? tags : [])
    .map((t) => texte(t, 100).replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 60);

  const status = { privacyStatus: privacite, selfDeclaredMadeForKids: !!madeForKids };

  // `publishAt` n'a de sens qu'avec `private` : sur une video deja visible,
  // YouTube refuse la programmation.
  const quand = texte(publishAt);
  if (quand && privacite === 'private') status.publishAt = quand;

  return {
    snippet: {
      title: titre,
      description: texte(description, 5000),
      tags: etiquettes,
      categoryId: texte(categoryId) || '10',
    },
    status,
  };
}

function indicateursErreurGoogle(donnees = {}) {
  const erreur = donnees && typeof donnees === 'object' ? donnees.error : null;
  const details = Array.isArray(erreur?.details) ? erreur.details : [];
  const erreurs = Array.isArray(erreur?.errors) ? erreur.errors : [];
  const valeurs = [
    donnees?.reason,
    donnees?.code,
    erreur?.reason,
    erreur?.code,
    ...erreurs.flatMap((item) => [item?.reason, item?.code]),
    ...details.flatMap((item) => [item?.reason, item?.code]),
  ];

  // Le message humain n'est volontairement pas inspecte: il est localisable et
  // parfois trompeur. Seuls les champs machine `reason`/`code` font foi.
  return new Set(
    valeurs
      .filter((valeur) => typeof valeur === 'string')
      .map((valeur) => valeur.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean)
  );
}

function classifierErreurYoutubeUpload(status, donnees = {}) {
  const indicateurs = indicateursErreurGoogle(donnees);
  const contient = (...valeurs) => valeurs.some((valeur) => indicateurs.has(valeur));

  if (contient(
    'insufficientpermissions',
    'insufficientpermission',
    'accesstokenscopeinsufficient',
    'insufficientauthenticationscopes'
  )) {
    return 'youtube_upload_scope_missing';
  }
  if (contient('uploadlimitexceeded')) return 'youtube_upload_limit_exceeded';
  if (contient('dailylimitexceeded', 'dailylimitexceededunreg')) {
    return 'youtube_upload_daily_limit_exceeded';
  }
  if (contient('quotaexceeded', 'ratelimitexceeded', 'userratelimitexceeded')) {
    return 'youtube_upload_quota_exceeded';
  }
  if (Number(status) === 403 || contient('forbidden')) return 'youtube_upload_forbidden';
  return '';
}

function offsetConfirmeDepuisRange(range, fileSize) {
  const correspondance = /^bytes=0-(\d+)$/i.exec(String(range || '').trim());
  if (!correspondance) return 0;
  const dernierOctet = Number(correspondance[1]);
  const taille = Number(fileSize);
  if (
    !Number.isSafeInteger(dernierOctet)
    || !Number.isSafeInteger(taille)
    || dernierOctet < 0
    || taille <= 0
    || dernierOctet >= taille
  ) return 0;
  return dernierOctet + 1;
}

/**
 * Ouvre une session d'envoi et rend son URL.
 *
 * On demande explicitement `uploadType=resumable` : c'est ce qui permet de
 * reprendre apres coupure, indispensable pour des fichiers de plusieurs dizaines
 * de Mo sur un lien instable.
 */
async function ouvrirSession({ accessToken, metadata, fileSize, mimeType, fetchImpl = globalThis.fetch }) {
  const url = new URL(UPLOAD_BASE);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('part', 'snippet,status');

  const reponse = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(fileSize),
      'x-upload-content-type': mimeType,
    },
    body: JSON.stringify(metadata),
  });

  if (!reponse.ok) {
    const donnees = await reponse.json().catch(() => ({}));
    const message = donnees?.error?.message || `youtube_upload_init_http_${reponse.status}`;
    const error = new Error(message);
    error.status = reponse.status;
    error.data = donnees;
    const code = classifierErreurYoutubeUpload(reponse.status, donnees);
    if (code) error.code = code;
    throw error;
  }

  const session = reponse.headers.get('location');
  if (!session) {
    const error = new Error('youtube_upload_session_url_missing');
    error.code = 'youtube_upload_session_url_missing';
    throw error;
  }
  return session;
}

/**
 * Demande a YouTube combien d'octets il a deja recus.
 *
 * C'est la seule source de verite pour reprendre : notre propre compteur peut
 * avoir avance sur des octets jamais arrives.
 */
async function octetsRecus({
  sessionUrl,
  fileSize,
  accessToken,
  mimeType,
  fetchImpl = globalThis.fetch,
}) {
  const reponse = await fetchImpl(sessionUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${texte(accessToken)}`,
      'content-type': mimeType,
      'content-range': `bytes */${fileSize}`,
      'content-length': '0',
    },
  });

  if (reponse.status === 200 || reponse.status === 201) {
    return { termine: true, donnees: await reponse.json().catch(() => ({})) };
  }
  if (reponse.status === 308) {
    const range = reponse.headers.get('range');
    return { termine: false, offset: offsetConfirmeDepuisRange(range, fileSize) };
  }
  const donnees = await reponse.json().catch(() => ({}));
  const error = new Error(donnees?.error?.message || `youtube_upload_status_http_${reponse.status}`);
  error.status = reponse.status;
  error.data = donnees;
  const code = classifierErreurYoutubeUpload(reponse.status, donnees);
  if (code) error.code = code;
  throw error;
}

/**
 * Envoie une video, bloc par bloc, en reprenant apres coupure.
 *
 * @returns {Promise<{ok: true, videoId: string, url: string, privacyStatus: string,
 *   uploadedBytes: number, resumes: number, lockedPrivateLikely: boolean}>}
 * Leve en cas d'echec — pas de retour `{ok:false}` silencieux.
 */
async function uploadVideo({
  accessToken,
  filePath,
  metadata: metaBrute = {},
  fetchImpl = globalThis.fetch,
  maxRetries = 5,
  onProgress = null,
} = {}) {
  const jeton = texte(accessToken);
  if (!jeton) {
    const error = new Error('youtube_upload_access_token_required');
    error.code = 'youtube_upload_access_token_required';
    throw error;
  }

  const chemin = path.resolve(String(filePath || ''));
  let fd;
  try {
    // Le descripteur est ouvert AVANT la session: si le chemin est remplace
    // pendant le POST, on continue a lire exactement le fichier valide ici.
    fd = fs.openSync(chemin, 'r');
  } catch (cause) {
    const absent = cause?.code === 'ENOENT';
    const error = new Error(absent ? 'youtube_upload_file_missing' : 'youtube_upload_file_unreadable');
    error.code = absent ? 'youtube_upload_file_missing' : 'youtube_upload_file_unreadable';
    error.filePath = chemin;
    error.cause = cause;
    throw error;
  }

  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      const error = new Error('youtube_upload_file_not_regular');
      error.code = 'youtube_upload_file_not_regular';
      throw error;
    }
    if (!stat.size) {
      const error = new Error('youtube_upload_file_empty');
      error.code = 'youtube_upload_file_empty';
      throw error;
    }

    const metadata = construireMetadonnees(metaBrute);
    const mimeType = typeMime(chemin);
    const sessionUrl = await ouvrirSession({
      accessToken: jeton,
      metadata,
      fileSize: stat.size,
      mimeType,
      fetchImpl,
    });

    // Le POST de session laisse le temps a un producteur concurrent de
    // tronquer le fichier. Aucun octet ne part si sa taille a change.
    const statApresSession = fs.fstatSync(fd);
    if (!statApresSession.isFile() || statApresSession.size !== stat.size) {
      const error = new Error('youtube_upload_file_changed');
      error.code = 'youtube_upload_file_changed';
      error.expectedSize = stat.size;
      error.actualSize = statApresSession.size;
      throw error;
    }

    let offset = 0;
    let reprises = 0;
    let echecsConsecutifs = 0;
    while (offset < stat.size) {
      const longueur = Math.min(TAILLE_BLOC, stat.size - offset);
      const tampon = Buffer.alloc(longueur);
      const octetsLus = fs.readSync(fd, tampon, 0, longueur, offset);
      if (octetsLus !== longueur) {
        const error = new Error('youtube_upload_file_changed');
        error.code = 'youtube_upload_file_changed';
        error.expectedBytes = longueur;
        error.actualBytes = octetsLus;
        error.offset = offset;
        throw error;
      }
      const fin = offset + longueur - 1;

      let reponse;
      try {
        reponse = await fetchImpl(sessionUrl, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${jeton}`,
            'content-type': mimeType,
            'content-length': String(longueur),
            'content-range': `bytes ${offset}-${fin}/${stat.size}`,
          },
          body: tampon,
        });
      } catch (erreurReseau) {
        // Coupure en plein bloc : on redemande la position reelle plutot que de
        // supposer que le bloc est passe ou perdu.
        echecsConsecutifs += 1;
        if (echecsConsecutifs > maxRetries) throw erreurReseau;
        reprises += 1;
        const etat = await octetsRecus({
          sessionUrl,
          fileSize: stat.size,
          accessToken: jeton,
          mimeType,
          fetchImpl,
        });
        if (etat.termine) return finaliser(etat.donnees, metadata, stat.size, reprises);
        offset = etat.offset;
        continue;
      }

      if (reponse.status === 200 || reponse.status === 201) {
        const donnees = await reponse.json().catch(() => ({}));
        return finaliser(donnees, metadata, stat.size, reprises);
      }

      if (reponse.status === 308) {
        const range = reponse.headers.get('range');
        // Sans Range, YouTube ne confirme aucun octet. Il ne faut surtout pas
        // avancer de la taille envoyee: cela creerait un trou silencieux.
        const prochainOffset = offsetConfirmeDepuisRange(range, stat.size);
        if (prochainOffset <= offset) {
          echecsConsecutifs += 1;
          if (echecsConsecutifs > maxRetries) {
            const error = new Error('youtube_upload_no_progress');
            error.code = 'youtube_upload_no_progress';
            error.status = 308;
            error.offset = prochainOffset;
            throw error;
          }
          reprises += 1;
        } else {
          echecsConsecutifs = 0;
        }
        offset = prochainOffset;
        if (typeof onProgress === 'function') {
          onProgress({ uploadedBytes: offset, totalBytes: stat.size, resumes: reprises });
        }
        continue;
      }

      // 5xx: l'envoi est reprenable, c'est tout l'interet du protocole.
      if (reponse.status >= 500) {
        echecsConsecutifs += 1;
        if (echecsConsecutifs > maxRetries) {
          const error = new Error(`youtube_upload_http_${reponse.status}`);
          error.status = reponse.status;
          throw error;
        }
        reprises += 1;
        const etat = await octetsRecus({
          sessionUrl,
          fileSize: stat.size,
          accessToken: jeton,
          mimeType,
          fetchImpl,
        });
        if (etat.termine) return finaliser(etat.donnees, metadata, stat.size, reprises);
        offset = etat.offset;
        continue;
      }

      const donnees = await reponse.json().catch(() => ({}));
      const error = new Error(donnees?.error?.message || `youtube_upload_http_${reponse.status}`);
      error.status = reponse.status;
      error.data = donnees;
      const code = classifierErreurYoutubeUpload(reponse.status, donnees);
      if (code) error.code = code;
      throw error;
    }

    // Sortie de boucle sans 200/201 : la position dit si c'est fini.
    const etat = await octetsRecus({
      sessionUrl,
      fileSize: stat.size,
      accessToken: jeton,
      mimeType,
      fetchImpl,
    });
    if (etat.termine) return finaliser(etat.donnees, metadata, stat.size, reprises);
    const error = new Error('youtube_upload_incomplete');
    error.code = 'youtube_upload_incomplete';
    throw error;
  } finally {
    try { fs.closeSync(fd); } catch { /* descripteur deja ferme */ }
  }
}

function finaliser(donnees, metadata, taille, reprises) {
  const videoId = texte(donnees?.id);
  if (!videoId) {
    const error = new Error('youtube_upload_no_video_id');
    error.code = 'youtube_upload_no_video_id';
    error.data = donnees;
    throw error;
  }
  const demande = metadata?.status?.privacyStatus || 'private';
  const obtenu = texte(donnees?.status?.privacyStatus) || demande;
  return {
    ok: true,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    privacyStatus: obtenu,
    // Signature du verrouillage par projet non audite : on a demande mieux que
    // `private` et YouTube a rendu `private`. Le dire evite de chercher un bug
    // dans notre code alors que c'est une decision de plateforme.
    lockedPrivateLikely: demande !== 'private' && obtenu === 'private',
    uploadedBytes: taille,
    resumes: reprises,
  };
}

/**
 * Pose une miniature. Optionnel, et non fatal pour un envoi reussi :
 * la fonction exige une chaine verifiee et l'appelant decide quoi faire de
 * l'echec — une miniature manquante ne doit pas invalider une video en ligne.
 */
async function setThumbnail({ accessToken, videoId, filePath, fetchImpl = globalThis.fetch } = {}) {
  const chemin = path.resolve(String(filePath || ''));
  if (!fs.existsSync(chemin)) {
    const error = new Error('youtube_thumbnail_file_missing');
    error.code = 'youtube_thumbnail_file_missing';
    throw error;
  }
  const ext = path.extname(chemin).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

  const url = new URL('https://upload.googleapis.com/upload/youtube/v3/thumbnails/set');
  url.searchParams.set('videoId', texte(videoId));
  url.searchParams.set('uploadType', 'media');

  const reponse = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${texte(accessToken)}`, 'content-type': mime },
    body: fs.readFileSync(chemin),
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const error = new Error(donnees?.error?.message || `youtube_thumbnail_http_${reponse.status}`);
    error.status = reponse.status;
    error.data = donnees;
    throw error;
  }
  return { ok: true, videoId: texte(videoId) };
}

module.exports = {
  API_BASE,
  UPLOAD_BASE,
  TAILLE_BLOC,
  classifierErreurYoutubeUpload,
  construireMetadonnees,
  ouvrirSession,
  octetsRecus,
  uploadVideo,
  setThumbnail,
};

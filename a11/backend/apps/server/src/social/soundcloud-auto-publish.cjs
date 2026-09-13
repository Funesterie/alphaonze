'use strict';

/**
 * Publication automatique d'un morceau fini sur SoundCloud.
 *
 * Trois refus deliberes, chacun ne pour une panne observee le 09/09/2026.
 *
 * 1. LE TITRE. uploadSoundCloudTrack retombe sur le nom de fichier quand on ne
 *    lui donne rien. C'est ce repli qui a publie « vivy-music-suno-c9a1b3bf79ff8451 »
 *    et « v11pan_1787134468238_...-d40-v10boom-v11pan 1 » dans le flux public,
 *    exposant au passage la nomenclature interne de la chaine. On refuse ici
 *    plutot que de publier un nom de machine: une erreur se voit, un mauvais
 *    titre reste en ligne.
 *
 * 2. LE DOUBLON. 110 des 326 items du flux etaient des reuploads du meme
 *    morceau, poses a quelques minutes d'intervalle -- un script relance deux ou
 *    trois fois. Une publication automatique sans memoire refait exactement ca.
 *
 * 3. L'EMPREINTE. On retient le sha256 du FLUX audio, pas du fichier. Ecrire un
 *    tag change le hash du fichier (mesure: 4 320 885 -> 4 320 912 octets, hash
 *    different) mais laisse le flux identique. Un hash de fichier laisserait donc
 *    repasser le meme morceau des qu'il a ete retagge ou remis en conteneur.
 *
 * L'empreinte n'est PAS recalculee ici: readAudioStreamIntegrity
 * (src/music/audio-stream-integrity.cjs) la produit deja, et mieux -- streamhash
 * dedie, -map_metadata -1 pour que les tags ne puissent pas peser, liste blanche
 * de protocoles, rejet du hash de flux vide, et relecture des stats du fichier
 * pour detecter une modification pendant la lecture. C'est le meme fil d'or que
 * celui des sidecars history-streams. Une seconde implementation serait une
 * seconde verite.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const { readAudioStreamIntegrity } = require('../music/audio-stream-integrity.cjs');
const { isGenericTitle } = require('../music/jukebox-claude-titler.cjs');

const REGISTRE_SCHEMA = 'funesterie.social.soundcloud-published.v1';
const EMPREINTE_TIMEOUT_MS = 60000;

/** Un titre qui vient d'un nom de fichier, jamais d'un humain ni du parolier. */
const TITRES_MACHINE = [
  /^vivy-music-/i,
  /^v11pan[_-]/i,
  /^\d{10,}[-_]/,
  /\.(mp3|wav|flac|m4a|ogg|aac)$/i,
  /-(d40|v10boom|v11pan|v9electrolysis)\b/i,
  /^[0-9a-f]{16,}$/i,
  // Une URL collée comme titre (13/09/2026) : deux morceaux du jukebox portaient
  // « https://console.neo4j.io/org/.../billing ». Le garde du parolier ne couvrait
  // que les titres proposés par le modèle, pas ceux venus de la source.
  /https?:|www\./i,
  /[<>\r\n]/,
];

function looksLikeMachineTitle(titre = '') {
  const valeur = String(titre || '').trim();
  if (!valeur || valeur.length > 120) return true;
  return TITRES_MACHINE.some((motif) => motif.test(valeur));
}

/** Pour comparer deux titres : sans casse, sans accents, sans ponctuation. */
function normaliserTitre(titre = '') {
  return String(titre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deux familles de non-titres, deux origines. « vivy-music-suno-... » vient du
 * repli sur le nom de fichier cote upload; « Session principale » vient de Suno,
 * qui nomme ainsi toute generation. Le second est plus dangereux: il ressemble a
 * un titre, donc il passe l'oeil et se publie.
 */
function isPublishableTitle(titre = '') {
  return !looksLikeMachineTitle(titre) && !isGenericTitle(titre);
}

/** Le fil d'or, delegue a l'implementation de reference. */
async function audioStreamIntegrity(filePath, options = {}) {
  const cible = String(filePath || '').trim();
  if (!cible || !fs.existsSync(cible)) throw new Error('empreinte_fichier_absent');
  return readAudioStreamIntegrity(cible, options);
}

function registryPath(env = process.env) {
  return path.join(getCanonicalRuntimeRoot(env), 'social', 'soundcloud-published.json');
}

function readRegistry(fichier = registryPath()) {
  let raw;
  try {
    raw = fs.readFileSync(fichier, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { schema: REGISTRE_SCHEMA, entries: {} };
    throw new Error('soundcloud_registry_unreadable');
  }
  let donnees;
  try { donnees = JSON.parse(raw); } catch { throw new Error('soundcloud_registry_invalid'); }
  if (!donnees || donnees.schema !== REGISTRE_SCHEMA || !donnees.entries
    || typeof donnees.entries !== 'object' || Array.isArray(donnees.entries)
    || Object.entries(donnees.entries).some(([hash, entry]) => !/^[a-f0-9]{64}$/.test(hash)
      || !entry || typeof entry !== 'object' || Array.isArray(entry)
      || (entry.status && !['pending', 'published', 'ambiguous', 'failed'].includes(entry.status)))) {
    throw new Error('soundcloud_registry_invalid');
  }
  return donnees;
}

function writeRegistry(registre, fichier = registryPath()) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaire, JSON.stringify(registre), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporaire, fichier);
  return fichier;
}

function autoPublishEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.SOUNDCLOUD_AUTO_PUBLISH_ENABLED || '').trim().toLowerCase());
}

function resolveSharing(env = process.env) {
  const valeur = String(env.SOUNDCLOUD_AUTO_PUBLISH_SHARING || 'public').trim().toLowerCase();
  return ['public', 'private'].includes(valeur) ? valeur : 'public';
}

/**
 * @returns {Promise<{published: boolean, reason?: string, fingerprint: string, upload?: object}>}
 *   `published:false` avec une `reason` n'est jamais une erreur silencieuse:
 *   l'appelant doit journaliser la raison.
 */
async function publishTrackIfNew({
  filePath,
  title,
  description = '',
  genre = '',
  tagList = '',
  lyrics = '',
  upload,
  // Titrage a la demande: appele seulement si le morceau n'a pas de vrai titre
  // et qu'il a des paroles. Absent => on ne publie pas, on ne devine pas.
  titleTrack = null,
  env = process.env,
  registryFile = registryPath(env),
  // Injectable pour les tests: la logique de garde se verifie sans ffmpeg.
  fingerprintOf = audioStreamIntegrity,
  // Un titre deja en ligne sur le compte (lot de juillet, ou autre version du
  // meme son publiee dans ce passage) : on saute, avant tout ecrit au registre.
  titleAlreadyPublished = null,
} = {}) {
  if (typeof upload !== 'function') throw new Error('upload_function_requise');
  if (!autoPublishEnabled(env)) return { published: false, reason: 'auto_publish_desactive', fingerprint: '' };

  const integrite = await fingerprintOf(filePath, { env });
  const fingerprint = String(integrite?.sha256 || '');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('empreinte_flux_invalide');
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const lock = `${registryFile}.lock`;
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('soundcloud_registry_locked');
    throw error;
  }
  // Un seul appelant titre/publie a la fois. Un verrou laisse apres crash exige
  // une reconciliation explicite, pas une reprise aveugle d'un upload payant.
  try {
    const registre = readRegistry(registryFile);
    const existing = registre.entries[fingerprint];
    if (existing) {
      const reason = !existing.status || existing.status === 'published' ? 'deja_publie'
        : existing.status === 'pending' ? 'publication_pending'
        : existing.status === 'ambiguous' ? 'publication_ambigue' : 'publication_a_verifier';
      return { published: false, reason, fingerprint, upload: existing };
    }

    let titreFinal = String(title || '').trim();
    let titrage = null;
    if (!isPublishableTitle(titreFinal)) {
      if (typeof titleTrack !== 'function' || !String(lyrics || '').trim()) {
        // Un morceau sans paroles ne peut pas etre titre par le parolier: 181 des
        // 836 morceaux de l'archive sont dans ce cas. On les laisse en attente
        // plutot que de publier « Session principale ».
        // Deux raisons distinctes, parce qu'elles se corrigent differemment: un nom
        // de fichier trahit un appelant qui n'a pas transmis de titre, un titre
        // generique trahit un morceau qui attend encore son parolier.
        return {
          published: false,
          reason: looksLikeMachineTitle(titreFinal) ? 'titre_machine_refuse' : 'titre_indisponible',
          fingerprint: '',
        };
      }
      titrage = await titleTrack({ lyrics: String(lyrics).trim() });
      titreFinal = String(titrage?.title || '').trim();
      if (!isPublishableTitle(titreFinal)) {
        return { published: false, reason: 'titrage_refuse', fingerprint: '' };
      }
    }

    if (typeof titleAlreadyPublished === 'function' && titleAlreadyPublished(titreFinal)) {
      return { published: false, reason: 'titre_deja_sur_soundcloud', fingerprint: '', title: titreFinal };
    }

    registre.entries[fingerprint] = {
      status: 'pending',
      title: titreFinal,
      titledBy: titrage ? (titrage.model || 'anthropic') : 'source',
      titlingCostUsd: titrage ? Number(titrage.costUsd || 0) : 0,
      sharing: resolveSharing(env),
      codec: integrite.codec,
      sampleRate: integrite.sampleRate,
      channels: integrite.channels,
      attemptedAt: new Date().toISOString(),
    };
    // Persister AVANT le POST : meme sans reponse, la reprise ne reposte pas.
    writeRegistry(registre, registryFile);
    let resultat;
    try {
      resultat = await upload({ audioPath: filePath, title: titreFinal, description, genre, tagList, sharing: resolveSharing(env) });
      if (!resultat?.id || resultat.ok === false) throw new Error('soundcloud_upload_receipt_missing');
    } catch (error) {
      const status = Number(error.status);
      registre.entries[fingerprint].status = [401, 403].includes(status) ? 'failed' : 'ambiguous';
      registre.entries[fingerprint].error = [401, 403].includes(status) ? `soundcloud_http_${status}` : 'soundcloud_upload_outcome_unknown';
      writeRegistry(registre, registryFile);
      throw error;
    }
    Object.assign(registre.entries[fingerprint], {
      status: 'published', trackId: resultat.id, permalinkUrl: resultat.permalinkUrl || '',
      sharing: resultat.sharing || resolveSharing(env), publishedAt: new Date().toISOString(),
    });
    writeRegistry(registre, registryFile);
    return { published: true, fingerprint, upload: resultat, title: titreFinal };
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

module.exports = {
  REGISTRE_SCHEMA,
  audioStreamIntegrity,
  autoPublishEnabled,
  isPublishableTitle,
  looksLikeMachineTitle,
  normaliserTitre,
  publishTrackIfNew,
  readRegistry,
  registryPath,
  resolveSharing,
  writeRegistry,
};

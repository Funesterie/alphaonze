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
];

function looksLikeMachineTitle(titre = '') {
  const valeur = String(titre || '').trim();
  if (!valeur) return true;
  return TITRES_MACHINE.some((motif) => motif.test(valeur));
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
  try {
    const donnees = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    return donnees && typeof donnees === 'object' && donnees.entries ? donnees : { schema: REGISTRE_SCHEMA, entries: {} };
  } catch {
    return { schema: REGISTRE_SCHEMA, entries: {} };
  }
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
  upload,
  env = process.env,
  registryFile = registryPath(env),
  // Injectable pour les tests: la logique de garde se verifie sans ffmpeg.
  fingerprintOf = audioStreamIntegrity,
} = {}) {
  if (typeof upload !== 'function') throw new Error('upload_function_requise');
  if (!autoPublishEnabled(env)) return { published: false, reason: 'auto_publish_desactive', fingerprint: '' };
  if (looksLikeMachineTitle(title)) {
    return { published: false, reason: 'titre_machine_refuse', fingerprint: '' };
  }

  const integrite = await fingerprintOf(filePath, { env });
  const fingerprint = String(integrite?.sha256 || '');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('empreinte_flux_invalide');
  const registre = readRegistry(registryFile);
  if (registre.entries[fingerprint]) {
    return { published: false, reason: 'deja_publie', fingerprint, upload: registre.entries[fingerprint] };
  }

  const resultat = await upload({
    audioPath: filePath,
    title: String(title).trim(),
    description,
    genre,
    tagList,
    sharing: resolveSharing(env),
  });

  registre.schema = REGISTRE_SCHEMA;
  registre.entries[fingerprint] = {
    title: String(title).trim(),
    trackId: resultat?.id || null,
    permalinkUrl: resultat?.permalinkUrl || '',
    sharing: resultat?.sharing || resolveSharing(env),
    codec: integrite.codec,
    sampleRate: integrite.sampleRate,
    channels: integrite.channels,
    publishedAt: new Date().toISOString(),
  };
  writeRegistry(registre, registryFile);
  return { published: true, fingerprint, upload: resultat };
}

module.exports = {
  REGISTRE_SCHEMA,
  audioStreamIntegrity,
  autoPublishEnabled,
  looksLikeMachineTitle,
  publishTrackIfNew,
  readRegistry,
  registryPath,
  resolveSharing,
  writeRegistry,
};

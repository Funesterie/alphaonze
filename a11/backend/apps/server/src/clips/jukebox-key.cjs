'use strict';
/**
 * jukebox-key.cjs — Une cle par jukebox, derivee en faisant tourner le cube.
 *
 * Chaque jukebox a sa propre cle : voler le contenu d'un jukebox ne donne acces
 * a aucun autre. La cle ne se stocke jamais, elle se recalcule a partir de trois
 * choses -- le secret maitre, l'identifiant du jukebox, et l'epoque du cube.
 *
 *   rotation = cubeRotation(jukeboxId:epoch)        0, 120 ou 240
 *   cle      = HMAC(secret maitre, jukeboxId:epoch:rotation)
 *
 * LE PIEGE, ET POURQUOI L'EPOQUE EST UN PARAMETRE :
 *
 * Le cube du RubixCube tourne a chaque epoque horaire -- c'est ce qui rend les
 * couloirs mouvants pour HENRY. Si on derivait la cle de l'heure courante, elle
 * changerait toutes les heures et le jukebox deviendrait illisible une heure
 * apres avoir ete scelle. Une archive qu'on ne sait plus ouvrir ne vaut rien.
 *
 * L'epoque est donc FIXEE a la creation et rangee en clair dans le manifeste du
 * jukebox. Elle n'est pas un secret : sans le secret maitre elle ne sert a rien.
 * C'est elle qui rend la derivation reproductible.
 */
const crypto = require('crypto');

const SCHEMA = 'funesterie.jukebox.key.v1';
const KEY_BYTES = 32;

function loadCube() {
  const candidates = [
    '../dump/rubix-cube.cjs',
    '/app/src/dump/rubix-cube.cjs',
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { /* suivant */ }
  }
  return null;
}

/**
 * Rotation du cube pour ce jukebox. On passe par le module canonique quand il
 * est la; sinon on retombe sur la meme formule, plutot que de renoncer a
 * tourner et de deriver toutes les cles sur la meme position.
 */
function rotationFor(jukeboxId, epoch) {
  const seed = `${jukeboxId}:${epoch}`;
  const cube = loadCube();
  if (cube && typeof cube.cubeRotation === 'function') {
    return cube.cubeRotation(seed);
  }
  const hash = crypto.createHash('sha256').update(`rubix:${seed}`).digest();
  return (hash[0] % 3) * 120;
}

function resolveMasterSecret(explicit) {
  const secret = explicit
    || process.env.JUKEBOX_MASTER_SECRET
    || process.env.JUKEBOX_ZEN_KEY
    || '';
  if (!secret) {
    throw new Error(
      'JUKEBOX_MASTER_SECRET absent. Sans secret maitre, toutes les cles de '
      + 'jukebox seraient calculables par quiconque connait un identifiant.'
    );
  }
  return secret;
}

/**
 * Derive la cle d'un jukebox. Deterministe : memes entrees, meme cle, toujours.
 *
 * @param {object} input
 * @param {string} input.jukeboxId  identifiant du jukebox (session, client, album)
 * @param {string} input.epoch      epoque figee a la creation, rangee au clair
 * @param {string} [input.masterSecret]
 * @returns {{ schema, jukeboxId, epoch, rotation, key, keyBase64 }}
 */
function deriveJukeboxKey({ jukeboxId, epoch, masterSecret } = {}) {
  const id = String(jukeboxId || '').trim();
  if (!id) throw new Error('jukeboxId requis');
  const stamp = String(epoch || '').trim();
  if (!stamp) {
    throw new Error(
      'epoch requis. Ne pas le deduire de l\'heure courante : la cle changerait '
      + 'a chaque rotation du cube et le jukebox deviendrait illisible.'
    );
  }
  const secret = resolveMasterSecret(masterSecret);
  const rotation = rotationFor(id, stamp);
  const key = crypto.createHmac('sha256', secret)
    .update(`${SCHEMA}:${id}:${stamp}:${rotation}`)
    .digest()
    .slice(0, KEY_BYTES);
  return {
    schema: SCHEMA,
    jukeboxId: id,
    epoch: stamp,
    rotation,
    key,
    keyBase64: key.toString('base64'),
  };
}

/**
 * Ouvre un nouveau jukebox : fige l'epoque maintenant et rend le manifeste a
 * ranger avec lui. Le manifeste ne contient aucun secret -- seulement de quoi
 * recalculer la cle quand on a le secret maitre.
 */
function createJukebox({ jukeboxId, epoch, masterSecret } = {}) {
  const stamp = epoch || new Date().toISOString();
  const derived = deriveJukeboxKey({ jukeboxId, epoch: stamp, masterSecret });
  return {
    manifest: {
      schema: SCHEMA,
      jukeboxId: derived.jukeboxId,
      epoch: derived.epoch,
      rotation: derived.rotation,
      createdAt: stamp,
    },
    keyBase64: derived.keyBase64,
  };
}

/** Rouvre un jukebox depuis son manifeste. */
function openJukebox(manifest, masterSecret) {
  if (!manifest || manifest.schema !== SCHEMA) {
    throw new Error('Manifeste de jukebox invalide');
  }
  const derived = deriveJukeboxKey({
    jukeboxId: manifest.jukeboxId,
    epoch: manifest.epoch,
    masterSecret,
  });
  if (Number(manifest.rotation) !== derived.rotation) {
    throw new Error('Rotation du manifeste incoherente avec la derivation');
  }
  return derived.keyBase64;
}

module.exports = {
  SCHEMA,
  deriveJukeboxKey,
  createJukebox,
  openJukebox,
  rotationFor,
};

'use strict';

/**
 * clip-livraison.cjs — Un fichier par acheteur, fabrique une fois.
 *
 * LE CHOIX, ARRETE PAR DJEFF LE 16/08/2026 : marquer A L'ACHAT.
 *
 * L'alternative etait de graver au moment de la lecture. Elle est plus souple --
 * on peut marquer chaque visionnage -- mais elle impose un re-encodage video par
 * spectateur et par lecture. Sur l'EX44, le premier pic met le serveur a genoux,
 * et il n'y a pas de repli gracieux : les clips cessent simplement de partir.
 *
 * A l'achat, chaque acheteur a SON fichier, calcule une seule fois. Le cout est
 * paye au moment ou de l'argent rentre, ce qui est le seul moment ou il est
 * acceptable.
 *
 * LES DEUX MARQUES, ET POURQUOI LES DEUX
 *
 *   visible    un texte incruste, discret mais lisible. Il DISSUADE : celui qui
 *              s'apprete a repartager voit son propre nom dessus.
 *   invisible  la rotation de couleur de filigrane-quaternion.cjs. Elle PROUVE :
 *              elle survit au recadrage du texte et au re-encodage.
 *
 * Retirer le texte ne retire pas la preuve. C'est tout l'interet de les avoir
 * ensemble : le premier decourage, le second reste.
 *
 * POURQUOI FFMPEG ET PAS UNE BOUCLE EN JAVASCRIPT
 *
 * Une rotation de quaternion appliquee a un vecteur couleur EST une matrice 3x3.
 * Or ffmpeg sait appliquer une matrice 3x3 aux canaux RGB : c'est exactement le
 * filtre `colorchannelmixer`. La marque invisible devient donc un filtre, traite
 * a la vitesse de ffmpeg, au lieu d'une boucle sur des millions de pixels.
 */

const path = require('node:path');
const crypto = require('node:crypto');

const { rotationDepuisMarque, FORCE_DEFAUT } = require('./filigrane-quaternion.cjs');

const SCHEMA = 'funesterie.clip-livraison.v1';

/**
 * Matrice de rotation 3x3 depuis un quaternion unitaire.
 *
 * C'est la forme classique. Elle DOIT donner exactement le meme resultat que
 * `tournerPixel` de filigrane-quaternion.cjs -- si les deux divergent, on marque
 * les videos avec une rotation et on les cherche avec une autre, donc on
 * n'identifie plus personne. Un test compare les deux chemins.
 */
function matriceDepuisRotation(q) {
  const { w, x, y, z } = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

function n6(v) {
  // Six decimales : colorchannelmixer lit des flottants, et tronquer plus court
  // decale la rotation assez pour brouiller l'identification.
  return Number(v).toFixed(6);
}

/**
 * Le filtre invisible.
 *
 * `format=rgb24` n'est PAS optionnel. Sans lui, ffmpeg applique la matrice dans
 * l'espace ou se trouve la video -- du YUV en pratique -- et le resultat n'a
 * rien a voir avec la rotation qu'on cherchera ensuite. La marque serait posee,
 * mais introuvable.
 */
function filtreInvisible(marque, secret, force = FORCE_DEFAUT) {
  const m = matriceDepuisRotation(rotationDepuisMarque(marque, secret, force));
  return 'format=rgb24,colorchannelmixer='
    + `rr=${n6(m[0][0])}:rg=${n6(m[0][1])}:rb=${n6(m[0][2])}:`
    + `gr=${n6(m[1][0])}:gg=${n6(m[1][1])}:gb=${n6(m[1][2])}:`
    + `br=${n6(m[2][0])}:bg=${n6(m[2][1])}:bb=${n6(m[2][2])}`;
}

/** Echappe le texte pour drawtext, dont la syntaxe se casse sur : ' et \ */
function echapperTexte(texte) {
  return String(texte || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 120);
}

/**
 * Le filtre visible.
 *
 * En bas a droite, petit, semi-transparent. Assez lisible pour qu'on se sache
 * identifie, assez discret pour ne pas gacher le clip -- s'il gache le clip,
 * l'acheteur legitime est puni et c'est lui qui reclame.
 */
function filtreVisible(texte) {
  return 'drawtext=' + [
    `text='${echapperTexte(texte)}'`,
    'fontsize=h/36',
    'fontcolor=white@0.35',
    'shadowcolor=black@0.45',
    'shadowx=1', 'shadowy=1',
    'x=w-tw-h/40', 'y=h-th-h/40',
  ].join(':');
}

/**
 * Nom de fichier propre a un acheteur.
 *
 * L'identite n'apparait pas en clair : le nom de fichier voyage dans une URL, se
 * retrouve dans les journaux d'acces et dans l'historique du navigateur. Une
 * empreinte suffit pour retrouver l'acheteur cote serveur, et ne dit rien a qui
 * lit l'URL par-dessus l'epaule.
 */
function nomPourAcheteur(clipId, buyerId, secret) {
  if (!clipId) throw new Error('clipId requis');
  if (!buyerId) throw new Error('buyerId requis');
  if (!secret || String(secret).length < 16) {
    throw new Error('secret de livraison manquant ou trop court (16 caracteres minimum)');
  }
  const empreinte = crypto.createHmac('sha256', String(secret))
    .update(`${clipId}|${buyerId}`).digest('hex').slice(0, 16);
  const base = path.basename(String(clipId), path.extname(String(clipId)));
  return `${base}__${empreinte}.mp4`;
}

/**
 * La marque gravee dans ce fichier. C'est elle qu'on redonnera plus tard a
 * `identifierMarque` : elle doit donc etre reproductible a l'identique.
 */
function marquePourAcheteur(clipId, buyerId) {
  return `NOSSEN · ${buyerId} · ${clipId}`;
}

/**
 * Les arguments ffmpeg de la livraison.
 *
 * Rendus plutot qu'executes : ca les rend verifiables par un test, sans encoder
 * une video a chaque execution de la suite.
 */
function argumentsFfmpeg({ source, destination, clipId, buyerId, secret, force = FORCE_DEFAUT, texteVisible = '' } = {}) {
  if (!source) throw new Error('source requise');
  if (!destination) throw new Error('destination requise');

  const marque = marquePourAcheteur(clipId, buyerId);
  const visible = texteVisible || `NOSSEN · ${buyerId}`;

  return [
    '-hide_banner', '-nostats', '-y',
    '-i', String(source),
    '-vf', `${filtreInvisible(marque, secret, force)},${filtreVisible(visible)}`,
    // CRF 18 : la marque invisible se joue sur quelques niveaux par canal. Un
    // encodage trop agressif la noierait dans ses propres artefacts, et on aurait
    // fabrique une preuve illisible.
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    // L'audio est recopie tel quel : le filigrane est visuel, re-encoder le son
    // ne ferait que degrader le master pour rien.
    '-c:a', 'copy',
    '-movflags', '+faststart',
    String(destination),
  ];
}

/** Tout ce que la livraison doit enregistrer pour pouvoir accuser plus tard. */
function planDeLivraison({ clipId, buyerId, secret, dossierSortie = '' } = {}) {
  const nom = nomPourAcheteur(clipId, buyerId, secret);
  return {
    schema: SCHEMA,
    clipId,
    buyerId,
    fichier: nom,
    // path.posix et non path.join : ce chemin designe un emplacement DANS le
    // conteneur Linux. Sur un poste Windows, path.join rendrait des antislashs,
    // et la livraison fabriquerait des chemins que le conteneur ne comprend pas.
    // Le code tourne en Linux, mais il est ECRIT et teste sous Windows.
    chemin: dossierSortie ? path.posix.join(dossierSortie, nom) : nom,
    // Sans conserver la marque exacte, une identification future comparerait la
    // fuite a des marques recalculees -- et le moindre changement de format de
    // marque rendrait toutes les livraisons passees inexploitables.
    marque: marquePourAcheteur(clipId, buyerId),
    force: FORCE_DEFAUT,
    creeLe: new Date().toISOString(),
  };
}

module.exports = {
  SCHEMA,
  matriceDepuisRotation,
  filtreInvisible,
  filtreVisible,
  echapperTexte,
  nomPourAcheteur,
  marquePourAcheteur,
  argumentsFfmpeg,
  planDeLivraison,
};

'use strict';

/**
 * filigrane-quaternion.cjs — Marquer une image par la couleur, pas dans un canal.
 *
 * L'IDEE, DE DJEFF : « les couleurs se construisent par 4, pas par 2 »
 *
 * Un filigrane naif ajoute une valeur dans un canal, ou dans la luminance. C'est
 * fragile pour une raison simple : les canaux se traitent separement. Un passage
 * en niveaux de gris, et la marque disparait. Un re-encodage quantifie chaque
 * canal independamment, et l'abime canal par canal.
 *
 * Ici on traite le pixel comme UN objet a quatre composantes -- un quaternion pur
 * `0 + R·i + G·j + B·k` -- et la marque est une ROTATION de ce vecteur couleur.
 * Elle ne vit donc pas dans les canaux, elle vit dans le RAPPORT entre eux. Pour
 * l'effacer, il faut defaire une rotation qu'on ne connait pas, pas simplement
 * ecraser une valeur.
 *
 * C'est le glacis du peintre : la couleur finale n'est pas un melange, c'est un
 * chemin parcouru dans l'espace des couleurs.
 *
 * POURQUOI QUATRE ET PAS DEUX
 *
 * En dimension 2 -- les complexes -- il n'y a qu'une rotation possible, dans un
 * plan. En dimension 4 -- les quaternions -- on tourne dans l'espace entier, donc
 * autour d'un axe qu'on choisit, et cet axe fait partie du secret. Le theoreme de
 * Frobenius interdit toute algebre a division intermediaire : il n'y a rien entre
 * les deux, c'est 1, 2 ou 4.
 *
 * CE QUE CE MODULE PROMET, ET CE QU'IL NE PROMET PAS
 *
 * Il resiste au re-encodage et a la quantification : une rotation est une
 * propriete geometrique globale, la quantification la bruite sans la detruire.
 *
 * Il ne resiste PAS a une transformation qui detruit la colorimetrie -- passage
 * en noir et blanc, forte desaturation, filtre de couleur agressif. Contre ca il
 * faut un filigrane VISIBLE en complement. Les deux sont faits pour cohabiter :
 * l'un dissuade, l'autre prouve.
 */

const crypto = require('node:crypto');

const { produit, conjugue } = require('../music/auto-dj.cjs');

const SCHEMA = 'funesterie.filigrane-quaternion.v1';

/**
 * Amplitude de la rotation, en radians.
 *
 * 0.02 rad ~ 1.15 degre. Sur un pixel a 128 de moyenne, ca deplace chaque canal
 * de l'ordre de 1 a 3 niveaux sur 255 : invisible a l'oeil, largement au-dessus
 * du bruit de quantification d'un encodage de qualite courante.
 *
 * Monter ce chiffre rend la marque plus robuste ET plus visible. C'est le seul
 * arbitrage du module, et il n'a pas de bonne reponse universelle : sur une image
 * plate et claire une derive se voit, sur une image texturee non.
 */
const FORCE_DEFAUT = 0.02;

function normaliserAxe(x, y, z) {
  const n = Math.hypot(x, y, z);
  // Un axe nul ne definit aucune rotation. On retombe sur la diagonale des gris,
  // qui touche les trois canaux a egalite -- le choix le plus neutre possible.
  if (!n) return { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) };
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Transforme une marque de lecture en rotation.
 *
 * L'axe ET l'angle sortent d'un HMAC : deux spectateurs different donc par la
 * DIRECTION de la rotation, pas seulement par son amplitude. Deux marques
 * d'amplitude egale mais d'axes differents restent distinguables, la ou deux
 * simples decalages d'intensite se confondraient.
 */
function rotationDepuisMarque(marque, secret, force = FORCE_DEFAUT) {
  if (!secret || String(secret).length < 16) {
    throw new Error('secret de filigrane manquant ou trop court (16 caracteres minimum)');
  }
  const h = crypto.createHmac('sha256', String(secret)).update(String(marque || '')).digest();

  // Trois octets -> trois coordonnees signees. Centrees sur 0 pour que l'axe
  // puisse pointer dans n'importe quelle direction, pas seulement l'octant positif.
  const axe = normaliserAxe(h[0] - 128, h[1] - 128, h[2] - 128);

  // L'angle varie de ±25 % autour de la force demandee. Un angle strictement
  // constant se soustrairait par moyenne sur plusieurs copies marquees.
  const variation = 1 + ((h[3] / 255) - 0.5) * 0.5;
  const angle = force * variation;
  const demi = angle / 2;

  return {
    w: Math.cos(demi),
    x: axe.x * Math.sin(demi),
    y: axe.y * Math.sin(demi),
    z: axe.z * Math.sin(demi),
  };
}

/** Tourne un pixel. `q p q⁻¹`, avec p = 0 + R·i + G·j + B·k. */
function tournerPixel(r, g, b, q) {
  const p = { w: 0, x: r, y: g, z: b };
  const out = produit(produit(q, p), conjugue(q));
  return {
    r: Math.max(0, Math.min(255, Math.round(out.x))),
    g: Math.max(0, Math.min(255, Math.round(out.y))),
    b: Math.max(0, Math.min(255, Math.round(out.z))),
  };
}

/**
 * Marque une image RGB brute (Uint8Array, 3 octets par pixel).
 *
 * Travaille en place sur une copie : l'original reste intact, on en a besoin
 * pour detecter (ce filigrane est a detection informee, pas aveugle).
 */
function marquerImage(pixels, marque, secret, force = FORCE_DEFAUT) {
  const q = rotationDepuisMarque(marque, secret, force);
  const sortie = new Uint8Array(pixels);
  for (let i = 0; i + 2 < sortie.length; i += 3) {
    const p = tournerPixel(sortie[i], sortie[i + 1], sortie[i + 2], q);
    sortie[i] = p.r; sortie[i + 1] = p.g; sortie[i + 2] = p.b;
  }
  return sortie;
}

/**
 * Retrouve QUI a laissé fuiter, parmi une liste de marques connues.
 *
 * On ne devine pas la rotation : on rejoue chacune des marques emises et on garde
 * celle qui explique le mieux l'ecart observe. C'est realiste -- on connait la
 * liste des lectures qu'on a servies -- et bien plus robuste qu'une detection
 * aveugle.
 *
 * `ecart` est l'erreur quadratique moyenne par canal. `marge` dit de combien le
 * gagnant devance le second : une marge minuscule signifie qu'on ne peut PAS
 * conclure, et c'est une information a ne jamais masquer quand le resultat sert
 * a accuser quelqu'un.
 */
function identifierMarque(pixelsOriginaux, pixelsSuspects, marquesConnues = [], secret, force = FORCE_DEFAUT) {
  if (!Array.isArray(marquesConnues) || !marquesConnues.length) {
    return { ok: false, raison: 'aucune_marque_connue' };
  }
  if (pixelsOriginaux.length !== pixelsSuspects.length) {
    return { ok: false, raison: 'dimensions_differentes' };
  }

  const scores = marquesConnues.map((marque) => {
    const attendu = marquerImage(pixelsOriginaux, marque, secret, force);
    let somme = 0;
    let n = 0;
    for (let i = 0; i < attendu.length; i += 1) {
      const d = attendu[i] - pixelsSuspects[i];
      somme += d * d;
      n += 1;
    }
    return { marque, ecart: n ? Math.sqrt(somme / n) : Infinity };
  }).sort((a, b) => a.ecart - b.ecart);

  const gagnant = scores[0];
  const second = scores[1] || null;
  return {
    ok: true,
    schema: SCHEMA,
    marque: gagnant.marque,
    ecart: Number(gagnant.ecart.toFixed(4)),
    // Sans second candidat il n'y a pas de marge : une seule marque connue
    // "gagne" toujours, ce qui ne prouve rien.
    marge: second ? Number((second.ecart - gagnant.ecart).toFixed(4)) : null,
    concluant: Boolean(second) && (second.ecart - gagnant.ecart) > gagnant.ecart,
  };
}

module.exports = {
  SCHEMA,
  FORCE_DEFAUT,
  rotationDepuisMarque,
  tournerPixel,
  marquerImage,
  identifierMarque,
};

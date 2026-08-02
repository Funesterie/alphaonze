'use strict';

/**
 * Signature sonore derivee de la matiere du morceau, via la courbe C1 du canon.
 *
 * Constat de Djeff (02/08/2026) : « c'est pas juste a l'ecoute, c'est le style
 * redondant et vu 100 fois ». Le probleme n'est pas seulement la dynamique : le
 * vocabulaire de style lui-meme est un catalogue. « French technical rap duet,
 * cinematic bass, melodic chorus » decrit mille morceaux.
 *
 * On casse la redondance sans tirer au hasard : la signature derive de la MATIERE
 * du morceau, par une courbe deterministe. Deux chansons differentes donnent deux
 * signatures ; la meme chanson donne toujours la meme.
 *
 * COURBE UTILISEE -- C1, FORMULA_REGISTRY_2026-05-28 :
 *
 *   theta(n) = 2*pi*n / 40.0005
 *   M(n)     = pivot + mg * sin(theta(n))
 *   B(n)     = |M(n) - M(n-1)| + |M(n+1) - M(n)|
 *   R(n)     = |cos(theta(n)) - pivot|
 *   S(n)     = B(n) / (R(n) + mg)
 *
 * Le canon precise que C1 a ECHOUE comme detecteur de premiers -- precision 0,00 %
 * sur 10000 -- et conclut : « Keep this formula in the audio_mapping bucket ».
 * C'est donc exactement l'usage prevu : une commande audio periodique, pas une
 * pretention arithmetique. Aucune affirmation sur les nombres premiers n'est faite
 * ici, et aucune n'est necessaire.
 *
 * CE QUI N'EST PAS UTILISE, ET POURQUOI :
 * Q_hyper = a + b*i + c*j + d*k + e*l + f*m, les cinq imaginaires. R2 est explicite :
 * « This is not yet a locked algebra; define projection/norm/multiplication table
 * before using it as a formula. » Tant que la table n'existe pas, s'en servir
 * reviendrait a inventer une algebre et a la presenter comme le canon. On s'abstient.
 */

const { V10_CANON } = require('../audio/v10-boom.cjs');
const palettePulsar = require('../knowledge/modules/encoding.pulsar.palette.module.json');

// Constantes verrouillees (CONSTANTS_LOCKED, R2). T_linear est explicitement un
// coefficient spectral linearise -- PAS mg_phase, malgre les captures historiques
// qui l'appelaient « mg ». On garde la lecture corrigee.
const PIVOT = 0.292;
const T_LINEAR = 0.3695;
const GRILLE = 40.0005;

function mg() {
  const valeur = Number(V10_CANON.mgPhase);
  return Number.isFinite(valeur) && valeur !== 0 ? valeur : 0.001554497790530303;
}

/** S(n) de la courbe C1. Commande audio, pas detecteur de premiers. */
function primeCurveS(n) {
  const m = mg();
  const theta = (k) => (2 * Math.PI * k) / GRILLE;
  const M = (k) => PIVOT + m * Math.sin(theta(k));
  const B = Math.abs(M(n) - M(n - 1)) + Math.abs(M(n + 1) - M(n));
  const R = Math.abs(Math.cos(theta(n)) - PIVOT);
  return B / (R + m);
}

/**
 * Graine deterministe tiree de la matiere. Deux morceaux differents tombent sur des
 * n differents ; le meme morceau retombe toujours sur le meme.
 */

// Echantillon de S sur une periode, calcule une fois. Sert a situer une valeur par
// son rang plutot que par sa magnitude absolue.
let _echantillon = null;
function echantillonS() {
  if (_echantillon) return _echantillon;
  const valeurs = [];
  for (let n = 1; n <= 4000; n += 1) valeurs.push(primeCurveS(n));
  valeurs.sort((a, b) => a - b);
  _echantillon = valeurs;
  return _echantillon;
}
function rangDansLaPeriode(valeur) {
  const tri = echantillonS();
  let bas = 0;
  let haut = tri.length;
  while (bas < haut) {
    const milieu = (bas + haut) >> 1;
    if (tri[milieu] < valeur) bas = milieu + 1; else haut = milieu;
  }
  return tri.length > 1 ? bas / (tri.length - 1) : 0.5;
}

function songSeed(matiere) {
  const texte = String(matiere == null ? '' : matiere).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Borne sur une periode entiere de la grille, la ou la courbe varie vraiment.
  return (h % 4000) + 1;
}

/**
 * Textures indexees, pour sortir du vocabulaire de catalogue. Chaque entree decrit
 * une matiere concrete plutot qu'un genre : c'est ce qui evite « cinematic bass ».
 */
const TEXTURES = [
  'prise proche, souffle audible, peu de reverbe',
  'bande saturee, sifflement de ruban, bas medium epais',
  'ampli pousse, larsen contenu, aigus qui mordent',
  'boite a rythmes seche, pas de cymbale, silence entre les coups',
  'cordes frottees graves, archet lent, aucune percussion',
  'synthese analogique desaccordee, derive lente de hauteur',
  'piece nue, reverbe de plaque courte, une seule source',
  'basse tenue au sub, haut du spectre presque vide',
  'guitare sourde etouffee paume, gratte reguliere',
  'nappe granuleuse, texture de vinyle, bruit de fond assume',
  'cuivres mats, attaque courte, pas de vibrato',
  'percussion metallique, resonance longue, pas de peau',
];

const MOUVEMENTS = [
  'tempo stable, pas de rubato',
  'legere acceleration vers la fin',
  'pulsation qui respire, elastique',
  'silences places avant chaque relance',
  'motif repete qui se decale d une mesure',
  'depart en retard sur le temps, rattrape au refrain',
];

function listerPalette() {
  return Array.isArray(palettePulsar?.knowledge?.palette) ? palettePulsar.knowledge.palette : [];
}

/**
 * Signature complete d'un morceau.
 *
 * @param {string} matiere  paroles, titre, sujet -- ce qui identifie le morceau
 * @param {{ ceiling?: number }} [options]
 * @returns {{ seed:number, s:number, normalized:number, color:object|null,
 *             texture:string, mouvement:string, line:string }}
 */
function deriveSonicSignature(matiere, options = {}) {
  const seed = songSeed(matiere);
  const s = primeCurveS(seed);

  // Normalisation par RANG sur la periode, pas par compression absolue.
  //
  // Mesure du 02/08 sur n = 1..4000 : S varie de 1,27e-4 a 1,32e-2, mediane
  // 3,76e-4. Une compression 1 - 1/(1+s) ecrasait donc TOUT vers 0,0004, et la
  // couleur retenue etait invariablement PurpleShadow (gamma 0,15, la plus basse).
  // La courbe variait, ma lecture ne la lisait pas. Le rang, lui, exploite toute
  // l amplitude reelle quelle que soit l echelle absolue.
  const normalized = rangDansLaPeriode(s);

  const palette = listerPalette();
  const plafond = Number.isFinite(options.ceiling) ? options.ceiling : 1;
  const cible = Math.min(plafond, normalized);

  let couleur = null;
  if (palette.length) {
    let ecartMin = Infinity;
    for (const c of palette) {
      const ecart = Math.abs(Number(c.gamma) - cible);
      if (ecart < ecartMin) { ecartMin = ecart; couleur = c; }
    }
  }

  const texture = TEXTURES[seed % TEXTURES.length];
  const mouvement = MOUVEMENTS[(seed >> 3) % MOUVEMENTS.length];

  const line = [texture, mouvement, couleur ? `poids ${couleur.name.toLowerCase()}` : '']
    .filter(Boolean)
    .join(', ');

  return { seed, s, normalized, color: couleur, texture, mouvement, line };
}

module.exports = {
  GRILLE,
  PIVOT,
  T_LINEAR,
  TEXTURES,
  MOUVEMENTS,
  deriveSonicSignature,
  primeCurveS,
  songSeed,
};

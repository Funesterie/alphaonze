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

  return { seed, s, normalized, color: couleur, texture, mouvement, line, chosenBy: 'derive' };
}

// --- Choix, plutot que derivation ---------------------------------------------
//
// Djeff, 2026-08-04 : « c est au LLM (ou Vivy) de choisir le style, la couleur
// sonore de la chanson, avant ou apres avoir fait les paroles ».
//
// deriveSonicSignature() reste utile comme repli — elle est deterministe, donc
// reproductible. Mais un hachage ne CHOISIT rien : le meme theme rendra toujours
// la meme couleur, et Vivy n a pas voix au chapitre.
//
// On garde la palette comme vocabulaire contraint — c est ce qui maintient la
// couleur dans le canon Pulsar — et on laisse le choix a l interieur. Ni hachage,
// ni invention libre : une carte a douze entrees dans laquelle on pointe.

/**
 * Le menu a presenter au modele. Douze couleurs, leur fonction et leur gamma.
 */
function describeSonicPalette() {
  return listerPalette().map((c) => ({
    name: c.name,
    hue: c.hue,
    gamma: c.gamma,
    fonction: c.function,
    complement: c.complement,
  }));
}

function trouverCouleur(nom = '') {
  const cible = String(nom || '').trim().toLowerCase();
  if (!cible) return null;
  return listerPalette().find((c) => String(c.name).toLowerCase() === cible) || null;
}

/**
 * Signature d'un morceau dont la couleur, la texture et le mouvement peuvent
 * avoir ete choisis. Tout champ absent retombe sur la derivation.
 *
 * @param {string} matiere
 * @param {{ color?: string, texture?: string, mouvement?: string, ceiling?: number }} [choix]
 */
function chooseSonicSignature(matiere, choix = {}) {
  const base = deriveSonicSignature(matiere, choix);
  const couleurChoisie = trouverCouleur(choix.color);

  // Un nom de couleur hors palette n'est pas silencieusement ignore : on le
  // signale, sinon une faute de frappe ferait croire au choix pendant des mois.
  const couleurInconnue = Boolean(String(choix.color || '').trim()) && !couleurChoisie;

  const texture = String(choix.texture || '').trim() || base.texture;
  const mouvement = String(choix.mouvement || '').trim() || base.mouvement;
  const couleur = couleurChoisie || base.color;

  const line = [texture, mouvement, couleur ? `poids ${couleur.name.toLowerCase()}` : '']
    .filter(Boolean)
    .join(', ');

  const choisi = Boolean(couleurChoisie) || texture !== base.texture || mouvement !== base.mouvement;

  return {
    ...base,
    color: couleur,
    texture,
    mouvement,
    line,
    chosenBy: choisi ? 'vivy' : 'derive',
    couleurInconnue: couleurInconnue ? String(choix.color).trim() : null,
  };
}

// --- Morphing -----------------------------------------------------------------
//
// Djeff, 2026-08-04 : « c est du morphing qu il faut la, pas une couleur fixe ».
//
// Un morceau a une trajectoire : il ne reste pas sur un timbre du debut a la fin.
// On decrit donc la couleur sonore comme un CHEMIN — des arrets poses le long du
// morceau, et une interpolation entre eux.
//
// Piege : le champ `hue` de la palette est faux sur 4 entrees sur 10 (releve du
// 02/08). Interpoler dessus ferait tourner le morphing dans le mauvais sens. La
// teinte est donc recalculee depuis le hex, qui lui est exact.

function hexVersRgb(hex = '') {
  const n = parseInt(String(hex).replace(/^0x/i, ''), 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function teinteDepuisHex(hex = '') {
  const rgb = hexVersRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * Palette augmentee : teinte recalculee, et l'ecart avec le champ declare.
 */
function paletteAvecTeinteReelle() {
  return listerPalette().map((c) => {
    const reelle = teinteDepuisHex(c.hex);
    const declaree = Number(c.hue);
    return {
      ...c,
      hueReelle: reelle,
      hueDeclaree: Number.isFinite(declaree) ? declaree : null,
      hueFausse: Number.isFinite(declaree) && reelle !== null
        ? Math.abs(((reelle - declaree + 540) % 360) - 180) > 1
        : false,
    };
  });
}

// Plus court chemin sur le cercle : on tourne dans le sens qui coute le moins.
function interpolerTeinte(a, b, t) {
  let ecart = ((b - a + 540) % 360) - 180;
  return ((a + ecart * t) % 360 + 360) % 360;
}

const SECTIONS_PAR_DEFAUT = ['intro', 'couplet', 'refrain', 'pont', 'outro'];

/**
 * Construit un morphing de couleur sonore le long du morceau.
 *
 * @param {string} matiere
 * @param {{ stops?: Array<string|{color:string, at?:number}>, sections?: string[], ceiling?: number }} [choix]
 */
function buildSonicMorph(matiere, choix = {}) {
  const palette = paletteAvecTeinteReelle();
  const base = deriveSonicSignature(matiere, choix);

  const bruts = Array.isArray(choix.stops) ? choix.stops : [];
  const arrets = [];
  const inconnues = [];

  bruts.forEach((entree, index) => {
    const nom = typeof entree === 'string' ? entree : String(entree?.color || '');
    const trouve = palette.find((c) => String(c.name).toLowerCase() === nom.trim().toLowerCase());
    if (!trouve) { if (nom.trim()) inconnues.push(nom.trim()); return; }
    const at = typeof entree === 'object' && Number.isFinite(Number(entree.at))
      ? Math.min(1, Math.max(0, Number(entree.at)))
      : (bruts.length > 1 ? index / (bruts.length - 1) : 0);
    arrets.push({ color: trouve, at });
  });

  arrets.sort((a, b) => a.at - b.at);

  // Sans arret utilisable, le morphing degenere en couleur fixe derivee : c'est
  // le repli, et il est signale comme tel plutot que presente comme un choix.
  if (!arrets.length) {
    const seule = palette.find((c) => c.name === base.color?.name) || null;
    return {
      seed: base.seed,
      stops: seule ? [{ color: seule, at: 0 }] : [],
      sections: [],
      chosenBy: 'derive',
      couleursInconnues: inconnues,
      line: base.line,
    };
  }

  const sections = Array.isArray(choix.sections) && choix.sections.length
    ? choix.sections.map((s) => String(s).trim()).filter(Boolean)
    : SECTIONS_PAR_DEFAUT;

  const echantillons = sections.map((nom, i) => {
    const t = sections.length > 1 ? i / (sections.length - 1) : 0;
    let avant = arrets[0];
    let apres = arrets[arrets.length - 1];
    for (let k = 0; k < arrets.length - 1; k += 1) {
      if (t >= arrets[k].at && t <= arrets[k + 1].at) { avant = arrets[k]; apres = arrets[k + 1]; break; }
    }
    const portee = apres.at - avant.at;
    const local = portee > 0 ? (t - avant.at) / portee : 0;
    const teinte = interpolerTeinte(avant.color.hueReelle ?? 0, apres.color.hueReelle ?? 0, local);
    const gamma = Number(avant.color.gamma) + (Number(apres.color.gamma) - Number(avant.color.gamma)) * local;
    return {
      section: nom,
      at: t,
      hue: Math.round(teinte),
      gamma: Number(gamma.toFixed(3)),
      entre: [avant.color.name, apres.color.name],
      dominante: local < 0.5 ? avant.color.name : apres.color.name,
    };
  });

  const line = echantillons
    .map((e) => `${e.section}: ${e.dominante.toLowerCase()} (${e.hue}deg)`)
    .join(' -> ');

  return {
    seed: base.seed,
    stops: arrets,
    sections: echantillons,
    chosenBy: 'vivy',
    couleursInconnues: inconnues,
    line,
  };
}

// --- Le cube trinaire ---------------------------------------------------------
//
// Djeff, 2026-08-04 : « il faut un morphing cube » puis « en trinaire ».
//
// La palette n'est pas un cercle de teintes : c'est un treillis 3x3x3. Chaque
// canal ne prend que trois valeurs — 0x0a, 0x4a, 0x8a — donc chaque couleur est
// un nombre a trois chiffres en BASE 3, et le cube compte 27 etats.
//
// Morpher sur le cercle des teintes ne longeait que le bord. Morpher dans le cube
// permet de traverser, et morpher EN TRINAIRE rend le chemin discret : chaque pas
// change un seul trit, donc chaque etape est un point reel du treillis — une vraie
// couleur, pas un fondu entre deux.

const NIVEAUX_CUBE = [0x0a, 0x4a, 0x8a];

function tritDepuisNiveau(v) {
  let meilleur = 0;
  let ecartMin = Infinity;
  NIVEAUX_CUBE.forEach((niveau, i) => {
    const ecart = Math.abs(niveau - v);
    if (ecart < ecartMin) { ecartMin = ecart; meilleur = i; }
  });
  return meilleur;
}

/**
 * Coordonnees trinaires d'une couleur : [r, g, b] dans {0,1,2}, plus son rang
 * 0..26 dans le cube et sa position (coin, arete, face, centre).
 */
function enTrinaire(hex = '') {
  const rgb = hexVersRgb(hex);
  if (!rgb) return null;
  const trits = [tritDepuisNiveau(rgb.r), tritDepuisNiveau(rgb.g), tritDepuisNiveau(rgb.b)];
  const rang = trits[0] * 9 + trits[1] * 3 + trits[2];
  const extremes = trits.filter((t) => t !== 1).length;
  const position = ['centre', 'face', 'arete', 'coin'][extremes];
  return { trits, rang, position, base3: trits.join('') };
}

function hexDepuisTrits(trits = [0, 0, 0]) {
  const [r, g, b] = trits.map((t) => NIVEAUX_CUBE[Math.min(2, Math.max(0, t))]);
  return `0x${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function nommerTrits(trits) {
  const cible = trits.join('');
  const trouve = listerPalette().find((c) => {
    const t = enTrinaire(c.hex);
    return t && t.trits.join('') === cible;
  });
  return trouve ? trouve.name : null;
}

/**
 * Chemin trinaire entre deux couleurs : un seul trit change par pas. Le canal qui
 * a le plus grand ecart bouge en premier, ce qui fait entendre le grand
 * mouvement avant les retouches.
 */
function cheminTrinaire(depart = [0, 0, 0], arrivee = [0, 0, 0]) {
  const courant = [...depart];
  const pas = [{ trits: [...courant], hex: hexDepuisTrits(courant), nom: nommerTrits(courant) }];
  for (;;) {
    const ecarts = courant.map((t, i) => Math.abs(arrivee[i] - t));
    const total = ecarts.reduce((a, b) => a + b, 0);
    if (!total) break;
    let canal = 0;
    let max = -1;
    ecarts.forEach((e, i) => { if (e > max) { max = e; canal = i; } });
    courant[canal] += arrivee[canal] > courant[canal] ? 1 : -1;
    pas.push({ trits: [...courant], hex: hexDepuisTrits(courant), nom: nommerTrits(courant) });
  }
  return pas;
}

/**
 * Morphing dans le cube trinaire, reparti sur les sections du morceau.
 *
 * @param {string} matiere
 * @param {{ stops?: string[], sections?: string[] }} [choix]
 */
function buildCubeMorph(matiere, choix = {}) {
  const palette = listerPalette();
  const base = deriveSonicSignature(matiere, choix);
  const inconnues = [];

  const arrets = (Array.isArray(choix.stops) ? choix.stops : [])
    .map((nom) => {
      const trouve = palette.find((c) => String(c.name).toLowerCase() === String(nom).trim().toLowerCase());
      if (!trouve) { if (String(nom).trim()) inconnues.push(String(nom).trim()); return null; }
      return { name: trouve.name, ...enTrinaire(trouve.hex) };
    })
    .filter(Boolean);

  if (arrets.length < 2) {
    const seule = base.color ? { name: base.color.name, ...enTrinaire(base.color.hex) } : null;
    return {
      seed: base.seed,
      chemin: seule ? [seule] : [],
      sections: [],
      chosenBy: 'derive',
      couleursInconnues: inconnues,
      line: base.line,
    };
  }

  // Chaine les segments, sans repeter le point de jonction.
  const chemin = [];
  for (let i = 0; i < arrets.length - 1; i += 1) {
    const segment = cheminTrinaire(arrets[i].trits, arrets[i + 1].trits);
    chemin.push(...(i === 0 ? segment : segment.slice(1)));
  }

  const sections = Array.isArray(choix.sections) && choix.sections.length
    ? choix.sections.map((s) => String(s).trim()).filter(Boolean)
    : SECTIONS_PAR_DEFAUT;

  const echantillons = sections.map((nom, i) => {
    const t = sections.length > 1 ? i / (sections.length - 1) : 0;
    const pas = chemin[Math.min(chemin.length - 1, Math.round(t * (chemin.length - 1)))];
    const info = enTrinaire(pas.hex);
    return {
      section: nom,
      at: t,
      trits: pas.trits,
      base3: info.base3,
      rang: info.rang,
      position: info.position,
      hex: pas.hex,
      nom: pas.nom,
    };
  });

  const line = echantillons
    .map((e) => `${e.section}: ${e.nom ? e.nom.toLowerCase() : e.base3} [${e.base3}]`)
    .join(' -> ');

  return {
    seed: base.seed,
    chemin,
    sections: echantillons,
    chosenBy: 'vivy',
    couleursInconnues: inconnues,
    line,
  };
}

module.exports = {
  NIVEAUX_CUBE,
  buildCubeMorph,
  cheminTrinaire,
  enTrinaire,
  hexDepuisTrits,
  buildSonicMorph,
  chooseSonicSignature,
  describeSonicPalette,
  paletteAvecTeinteReelle,
  teinteDepuisHex,
  GRILLE,
  PIVOT,
  T_LINEAR,
  TEXTURES,
  MOUVEMENTS,
  deriveSonicSignature,
  primeCurveS,
  songSeed,
};

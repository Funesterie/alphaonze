'use strict';

/**
 * L'arc dynamique d'une chanson, derive du canon Funesterie.
 *
 * Constat de Djeff (02/08/2026) : « il manque le volume de l'ame, un amplificateur
 * et le rise ». Le prompt lui donnait raison. Tout ce qu'il disait de l'arrangement :
 *
 *   Arrangement: intro, verse, pre-chorus, memorable chorus, second verse, bridge,
 *                chorus, clean ending.
 *
 * Une STRUCTURE, pas une dynamique. L'ordre des sections et rien sur l'energie qui
 * doit les traverser : Suno recevait une liste plate et jouait tout au meme niveau.
 *
 * Plutot qu'un vocabulaire generique de riser et de drop, on assemble trois pieces
 * qui existent deja dans le projet :
 *
 *  1. balance_RH(phase) = 1 - 2|phase - 1/2|      (V10_CANON, SYMETRIE_OP_TABLE)
 *     Vaut 1 au centre, 0 aux bords. C'est l'arc : depouille au debut, plein au
 *     milieu, retire a la fin. Le garde-fou du canon, repris tel quel.
 *
 *  2. La croix +M / +iM / -M / -iM (crossCycle, horaire). Quatre caracteres qui
 *     tournent au lieu d'une couleur uniforme, et dont les bras opposes se
 *     referment : op_sym(-M,+M) = 1. Une section et son opposee se repondent.
 *
 *  3. La palette Pulsar, dix couleurs dont le gamma est explicitement « le poids de
 *     la couleur dans le contrat », de 0.15 a 0.95. On choisit pour chaque section
 *     la couleur dont le poids correspond a l'energie visee : le gamma cesse d'etre
 *     decoratif, il selectionne.
 *
 * Ce que ce module ne fait PAS : aucune pretention mathematique. v10-boom.cjs dit
 * « Pas un claim de preuve RH ni de generation de premiers », et SYMETRIE_OP_TABLE
 * « executable research table, not a mathematical proof ». On reutilise une courbe,
 * un cycle et une table de poids -- pas une demonstration.
 */

const { V10_CANON } = require('../audio/v10-boom.cjs');
const palettePulsar = require('../knowledge/modules/encoding.pulsar.palette.module.json');

/**
 * Traduction sonore de chaque couleur. La contrainte du module Pulsar impose de
 * nommer une couleur par son ROLE, pas par sa teinte -- mais « energie NVENC » ne
 * dit rien a un moteur audio. On garde donc la fonction comme ancre interne et on
 * l'exprime en matiere sonore, ce que Suno peut reellement executer.
 */
const MATIERE_SONORE = {
  PurpleShadow: 'nappe basse, presque sous le seuil, un seul element tenu',
  DeepBlue: 'grave profond, peu de haut, espace autour de la voix',
  BloodRed: 'compression franche, batterie serree, corps dense',
  ToxicGreen: 'saturation vive, energie haute, tout le spectre ouvert',
  FireOrange: 'chaleur mediums, distorsion douce, poussee constante',
  Cyan: 'clarte, transmission nette, aigus ouverts',
  Magenta: 'matiere brute, texture rugueuse, grain apparent',
  DORE: 'blindage, mix large et epais, protection du bas',
  Violet: 'signal isole, motif reconnaissable, peu de masse',
  Indigo: 'profondeur, reverbe longue, fond qui recule',
};

/** Caractere de chaque bras de la croix. Deux voisines n'ont jamais le meme. */
const CARACTERE_BRAS = {
  '+real': 'appui franc, corps present',
  '+imag': 'ouverture, air, respiration',
  '-real': 'retrait, matiere seche, place au silence',
  '-imag': 'tension tenue, harmoniques hautes',
};

// Poids propre des sections. L'arc donne la forme d'ensemble ; ceci dit qu'un refrain
// reste un refrain meme s'il tombe pres d'un bord.
const POIDS_SECTION = [
  { motif: /\b(intro|introduction)\b/i, poids: 0.30, nom: 'intro' },
  { motif: /\b(outro|ending|final|fin)\b/i, poids: 0.25, nom: 'outro' },
  { motif: /\b(pre[- ]?chorus|pre[- ]?refrain|montee)\b/i, poids: 0.78, nom: 'pre-refrain' },
  { motif: /\b(chorus|refrain|hook)\b/i, poids: 0.95, nom: 'refrain' },
  { motif: /\b(drop|break)\b/i, poids: 0.92, nom: 'drop' },
  { motif: /\b(bridge|pont)\b/i, poids: 0.42, nom: 'pont' },
  { motif: /\b(verse|couplet)\b/i, poids: 0.58, nom: 'couplet' },
];


/**
 * Jusqu ou l arc peut monter sans trahir la direction choisie. Une berceuse ne doit
 * pas atteindre le meme sommet qu un banger, meme si sa section centrale tombe au
 * milieu de la courbe.
 */
const PLAFONDS = [
  { motif: /\b(berceuse|lullaby|douce|calme|ambient|acoustique|intimiste|murmure|nocturne calme)\b/i, plafond: 0.55 },
  { motif: /\b(ballade|folk|jazz|bossa|soul lente|slow)\b/i, plafond: 0.7 },
  { motif: /\b(techno|hardcore|metal|banger|drop|saturee?|distordue?|punk|drum and bass|dnb|hardstyle)\b/i, plafond: 1 },
  { motif: /\b(rap|trap|boom bap|hip[- ]?hop|rock|electro|house)\b/i, plafond: 0.92 },
];
function resolveEnergyCeiling(direction) {
  const texte = String(direction == null ? "" : direction);
  if (!texte.trim()) return 0.95;
  for (const entree of PLAFONDS) {
    if (entree.motif.test(texte)) return entree.plafond;
  }
  return 0.95;
}

function listerPalette() {
  return Array.isArray(palettePulsar?.knowledge?.palette) ? palettePulsar.knowledge.palette : [];
}

function identifierSection(etiquette) {
  const texte = String(etiquette == null ? '' : etiquette);
  for (const entree of POIDS_SECTION) {
    if (entree.motif.test(texte)) return entree;
  }
  return { poids: 0.55, nom: 'section' };
}

/**
 * Couleur dont le gamma est le plus proche de l'energie visee. Le gamma n'est pas
 * une luminosite : le module Pulsar precise que c'est le poids de la couleur dans
 * le contrat. On s'en sert donc comme critere de selection, pas comme decor.
 */
function couleurPourIntensite(intensite) {
  const palette = listerPalette();
  if (!palette.length) return null;
  let meilleure = palette[0];
  let ecartMin = Infinity;
  for (const couleur of palette) {
    const ecart = Math.abs(Number(couleur.gamma) - intensite);
    if (ecart < ecartMin) { ecartMin = ecart; meilleure = couleur; }
  }
  return meilleure;
}

function decrireIntensite(valeur) {
  if (valeur < 0.3) return 'depouille';
  if (valeur < 0.5) return 'retenu';
  if (valeur < 0.7) return 'installe';
  if (valeur < 0.85) return 'dense';
  return 'plein';
}

/**
 * @param {string[]} etiquettes  ex. ['Intro', 'Verse 1', 'Chorus', 'Bridge', 'Chorus']
 * @returns {{ line: string, steps: Array<object> }}
 */
function buildVivyDynamicArc(etiquettes, options = {}) {
  const liste = (Array.isArray(etiquettes) ? etiquettes : []).map(String).filter((s) => s.trim());
  if (!liste.length) return { line: '', steps: [], compact: '' };

  // Plafond d'energie, deduit de la direction sonore que Vivy s'est choisie.
  //
  // Sans lui, l'arc est purement POSITIONNEL : dans un morceau a trois sections,
  // celle du milieu tape 1.0 quel que soit le sujet, et une berceuse recevait
  // « saturation vive, energie haute, tout le spectre ouvert ». Le meme travers que
  // le style generique qu'on corrige : une reponse identique quelle que soit la
  // question.
  //
  // Ce n'est PAS un moteur de mots-cles qui choisit la couleur a la place de Vivy --
  // elle a deja choisi. On lit sa direction pour savoir jusqu'ou l'arc peut monter
  // sans la trahir.
  const plafond = resolveEnergyCeiling(options.direction);

  const cycle = V10_CANON.crossCycle || ['+real', '+imag', '-real', '-imag'];

  const steps = liste.map((etiquette, index) => {
    const phase = liste.length === 1 ? 0.5 : index / (liste.length - 1);
    const arc = V10_CANON.balanceRh(phase);
    const { poids, nom } = identifierSection(etiquette);

    // L'arc donne la forme, le poids de section la corrige. Maximum plutot que
    // moyenne : un refrain place en fin de morceau reste un refrain.
    const intensite = Math.min(plafond, Math.max(arc, poids) * plafond + arc * (1 - plafond) * 0.25);
    const couleur = couleurPourIntensite(intensite);
    const bras = cycle[index % cycle.length];

    return {
      label: etiquette,
      nom,
      phase: Math.round(phase * 100) / 100,
      intensity: Math.round(intensite * 100) / 100,
      arm: bras,
      color: couleur ? couleur.name : '',
      colorFunction: couleur ? couleur.function : '',
      complement: couleur ? couleur.complement : '',
      matiere: couleur ? (MATIERE_SONORE[couleur.name] || '') : '',
    };
  });

  const corps = steps
    .map((s) => `${s.label}: ${decrireIntensite(s.intensity)}, ${s.matiere}, ${CARACTERE_BRAS[s.arm] || ''}`)
    .join(' | ');

  // Forme condensee pour le champ style de Suno, plafonne a 420 caracteres. On garde
  // le sommet, le creux et la forme d'ensemble : ce sont eux qui portent la dynamique.
  // Le detail section par section reste dans `line` pour les briefs et les logs.
  const sommet = steps.reduce((a, b) => (b.intensity > a.intensity ? b : a), steps[0]);
  const creux = steps.reduce((a, b) => (b.intensity < a.intensity ? b : a), steps[0]);
  const compact = [
    'arc dynamique',
    `depart ${decrireIntensite(steps[0].intensity)}`,
    `sommet sur ${sommet.nom} (${sommet.matiere})`,
    `creux sur ${creux.nom}`,
    'chaque section change de caractere',
  ].join(', ');

  return {
    steps,
    compact,
    line: `Arc dynamique, depouille aux bords et plein au centre: ${corps}. Les sections opposees se repondent au lieu de se repeter.`,
  };
}

/** Etiquettes lues dans un bloc de paroles balise [Intro - Vivy solo] etc. */
function extractSectionLabels(paroles) {
  const texte = String(paroles == null ? '' : paroles);
  const trouvees = [];
  for (const m of texte.matchAll(/^\s*\[([^\]]{1,60})\]\s*$/gm)) {
    const brut = m[1].split(/\s+-\s+/)[0].trim();
    if (brut) trouvees.push(brut);
  }
  return trouvees;
}

module.exports = {
  CARACTERE_BRAS,
  MATIERE_SONORE,
  PLAFONDS,
  POIDS_SECTION,
  buildVivyDynamicArc,
  couleurPourIntensite,
  decrireIntensite,
  extractSectionLabels,
  listerPalette,
  resolveEnergyCeiling,
};

'use strict';

/**
 * vivy-banque-vocale.cjs — Les phrases de Vivy, dites d'avance.
 *
 * Constat du 03/08 : le chat vocal n'est pas casse, il est lent PAR CONSTRUCTION.
 * Six etapes bout a bout — enregistrer, televerser, transcrire, rediger, synthetiser,
 * telecharger — dont aucune en flux. Cinq a dix secondes avant qu'elle ouvre la
 * bouche. Djeff : « celui de ChatGPT est 10000 fois mieux ». Il l'est parce qu'il
 * diffuse chaque etage et commence a parler avant d'avoir fini de penser.
 *
 * Pour un copilote de jeu on n'a pas ce probleme, et c'est ce qui rend la chose
 * faisable aujourd'hui : elle ne repond pas, elle reagit. Plus besoin de l'ecouter
 * ni d'attendre un LLM. Et un jeu a un vocabulaire d'evenements FINI — « il charge »,
 * « coffre a gauche », « attention derriere ». Ces phrases se synthetisent une fois
 * et se rejouent en millisecondes.
 *
 * Deux regles qui decoulent directement de la mesure :
 *
 *   1. Si une phrase n'est pas deja en banque, ON NE PARLE PAS. On ne la fabrique
 *      pas a la volee : un commentaire sur un boss qui arrive quatre secondes trop
 *      tard est pire que le silence, il decrit un passe que Djeff a deja vecu.
 *   2. On ne redit jamais la meme formulation deux fois de suite. Une reaction
 *      juste mais identique a la precedente sonne comme un automate — et c'est
 *      exactement ce qu'on essaie de ne pas etre.
 */

/**
 * Le repertoire. Plusieurs formulations par nature : c'est la variation qui fait
 * la difference entre une coequipiere et une alarme.
 */
const REPERTOIRE = Object.freeze({
  danger: [
    'Attention derrière toi.',
    'Ça arrive sur ta gauche.',
    'Bouge, vite.',
    'Il te vise.',
  ],
  mort: [
    'Ah. On recommence.',
    'C\'était courageux.',
    'Bon. Relève-toi.',
  ],
  boss: [
    'Il charge son gros coup.',
    'Là il prépare quelque chose.',
    'Garde de la barre pour l\'esquive.',
  ],
  objectif: [
    'C\'est par là.',
    'L\'objectif est devant.',
    'On y est presque.',
  ],
  decouverte: [
    'Il y a un truc en hauteur.',
    'Regarde à droite, ça brille.',
    'Passage caché derrière.',
  ],
  butin: [
    'Coffre.',
    'Il y a du butin ici.',
    'Ramasse avant de partir.',
  ],
  reussite: [
    'Joli.',
    'Propre.',
    'Voilà, comme ça.',
  ],
  vanne: [
    'Tu cours comme un canard.',
    'Je note que tu as fait exprès.',
    'On dira que c\'était le plan.',
  ],
});

/** Cle stable d'une phrase : elle survit aux redemarrages et sert de nom de fichier. */
function cleDe(nature, index) {
  return `${String(nature).toLowerCase()}-${index}`;
}

function listerPhrases() {
  const sortie = [];
  for (const [nature, phrases] of Object.entries(REPERTOIRE)) {
    phrases.forEach((texte, index) => sortie.push({ cle: cleDe(nature, index), nature, index, texte }));
  }
  return sortie;
}

/**
 * Cree une banque. `synthetiser(texte, cle)` doit rendre un identifiant d'audio
 * (chemin, URL, peu importe) — la banque ne s'occupe que de la correspondance.
 */
function creerBanque({ audios = {} } = {}) {
  const cache = new Map(Object.entries(audios));
  const dernierIndex = new Map();

  /** Synthetise tout ce qui manque. A lancer une fois, avant la partie. */
  async function preparer(synthetiser) {
    if (typeof synthetiser !== 'function') throw new Error('banque_synthetiseur_manquant');
    const faits = [];
    const echecs = [];
    for (const p of listerPhrases()) {
      if (cache.has(p.cle)) continue;
      try {
        const audio = await synthetiser(p.texte, p.cle);
        if (audio) { cache.set(p.cle, audio); faits.push(p.cle); }
        else echecs.push({ cle: p.cle, raison: 'synthese vide' });
      } catch (error) {
        echecs.push({ cle: p.cle, raison: String(error?.message || error) });
      }
    }
    return { faits: faits.length, echecs, total: listerPhrases().length, prete: echecs.length === 0 };
  }

  /**
   * Choisit une phrase pour cette nature. Rend null si rien n'est en banque —
   * c'est un silence assume, pas un echec a rattraper.
   */
  function choisir(nature) {
    const cle = String(nature || '').toLowerCase();
    const phrases = REPERTOIRE[cle];
    if (!phrases || !phrases.length) return null;

    const disponibles = phrases
      .map((texte, index) => ({ texte, index, cle: cleDe(cle, index) }))
      .filter((p) => cache.has(p.cle));
    if (!disponibles.length) return null;

    // Regle 2 : jamais deux fois de suite la meme formulation. Avec une seule
    // phrase disponible on la reprend — mieux vaut se repeter que se taire sur
    // un danger.
    const precedent = dernierIndex.get(cle);
    const candidats = disponibles.length > 1
      ? disponibles.filter((p) => p.index !== precedent)
      : disponibles;
    const choisie = candidats[Math.floor(candidats.length / 2)] || candidats[0];

    dernierIndex.set(cle, choisie.index);
    return { cle: choisie.cle, texte: choisie.texte, audio: cache.get(choisie.cle) };
  }

  function etat() {
    const total = listerPhrases().length;
    return { enBanque: cache.size, total, prete: cache.size === total };
  }

  return { preparer, choisir, etat };
}

module.exports = {
  REPERTOIRE,
  cleDe,
  creerBanque,
  listerPhrases,
};

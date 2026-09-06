'use strict';

/**
 * vivy-copilote-jeu.cjs — Vivy regarde l'écran et commente, en français.
 *
 * Djeff, 03/08 : Genshin ne peut pas tourner sur le serveur (100 Go requis, 62
 * libres, pas de pilote graphique, et surtout c'est la machine de production).
 * L'inversion retenue : elle ne joue pas, elle REGARDE et vous faites le donjon
 * ensemble autrement.
 *
 * Le problème n'est pas de produire une phrase — la chaîne vocale existe et tourne.
 * C'est de savoir QUAND SE TAIRE. Un commentateur qui réagit à chaque image est
 * insupportable au bout de deux minutes, et une co-équipière qui ne s'arrête jamais
 * est pire que pas de co-équipière. Tout ce module sert à la retenue.
 *
 * Trois règles, et elles se cumulent :
 *
 *   1. On réagit à un ÉVÉNEMENT, pas à un état. Voir « PV bas » vingt fois de suite
 *      n'est pas vingt informations : c'est une seule, qui date. On ne parle que sur
 *      un CHANGEMENT.
 *   2. Un délai de garde par nature d'événement. Le danger peut se répéter vite,
 *      la vanne non.
 *   3. Un budget de parole par minute. Même avec de bons événements, au-delà d'un
 *      certain débit elle devient du bruit — et le silence redevient de l'information.
 *
 * Une seule exception au budget : le danger immédiat. Se taire pour respecter un
 * quota pendant que Djeff meurt serait une règle qui se retourne contre son but.
 */

/** Ce à quoi elle peut réagir, du plus urgent au plus dispensable. */
const NATURES = Object.freeze({
  danger: { priorite: 100, gardeMs: 4000, urgent: true },
  mort: { priorite: 95, gardeMs: 8000, urgent: true },
  boss: { priorite: 80, gardeMs: 15000 },
  objectif: { priorite: 60, gardeMs: 20000 },
  decouverte: { priorite: 50, gardeMs: 30000 },
  butin: { priorite: 40, gardeMs: 25000 },
  reussite: { priorite: 35, gardeMs: 20000 },
  vanne: { priorite: 10, gardeMs: 45000 },
});

const BUDGET_PAR_MINUTE_DEFAUT = 6;

function maintenant(horloge) {
  return typeof horloge === 'function' ? Number(horloge()) : Date.now();
}

/**
 * Crée un copilote. L'état vit dans la fermeture : une partie = un copilote.
 *
 * @param {object} o
 * @param {number} [o.budgetParMinute]
 * @param {Function} [o.horloge]  injectable pour les tests
 */
function creerCopilote({ budgetParMinute = BUDGET_PAR_MINUTE_DEFAUT, horloge = null } = {}) {
  const dernierParNature = new Map();
  const dernierEtat = new Map();
  let prononcees = [];
  let silencieuse = false;

  /** Coupe ou rétablit la parole. Djeff doit pouvoir la faire taire d'un mot. */
  function silence(actif = true) {
    silencieuse = Boolean(actif);
    return { silencieuse };
  }

  function budgetRestant(t) {
    prononcees = prononcees.filter((at) => t - at < 60000);
    return Math.max(0, budgetParMinute - prononcees.length);
  }

  /**
   * @param {object} obs  { nature, cle, valeur, texte }
   *   nature : une clé de NATURES
   *   cle    : identifiant stable de CE QUI est observé (ex. 'pv-djeff')
   *   valeur : l'état observé — c'est son changement qui déclenche
   */
  function observer(obs = {}) {
    const t = maintenant(horloge);
    const nature = String(obs.nature || '').trim().toLowerCase();
    const regle = NATURES[nature];

    if (!regle) return { parle: false, raison: `nature inconnue : ${nature || '(vide)'}` };
    if (silencieuse) return { parle: false, raison: 'mise en silence' };

    // Regle 1 — un evenement, pas un etat.
    const cle = String(obs.cle || nature);
    const valeur = JSON.stringify(obs.valeur ?? null);
    if (dernierEtat.get(cle) === valeur) {
      return { parle: false, raison: 'rien de nouveau, c est le meme etat' };
    }
    dernierEtat.set(cle, valeur);

    // Regle 2 — delai de garde par nature.
    const precedent = dernierParNature.get(nature) || 0;
    if (t - precedent < regle.gardeMs) {
      return { parle: false, raison: `garde ${nature} : ${Math.ceil((regle.gardeMs - (t - precedent)) / 1000)} s restantes` };
    }

    // Regle 3 — budget de parole, sauf urgence.
    const restant = budgetRestant(t);
    if (restant <= 0 && !regle.urgent) {
      return { parle: false, raison: 'budget de parole epuise pour cette minute' };
    }

    dernierParNature.set(nature, t);
    prononcees.push(t);
    return {
      parle: true,
      nature,
      priorite: regle.priorite,
      urgent: Boolean(regle.urgent),
      texte: String(obs.texte || '').trim(),
      budgetRestant: budgetRestant(t),
    };
  }

  /**
   * Plusieurs observations dans le même coup d'œil : on n'en garde qu'UNE, la plus
   * prioritaire. Enchaîner trois phrases sur une seule image, c'est exactement le
   * defaut qu'on cherche a eviter.
   */
  function observerLot(liste = []) {
    const candidates = (Array.isArray(liste) ? liste : [])
      .filter((o) => NATURES[String(o?.nature || '').toLowerCase()])
      .sort((a, b) => NATURES[b.nature].priorite - NATURES[a.nature].priorite);

    for (const obs of candidates) {
      const verdict = observer(obs);
      if (verdict.parle) return { ...verdict, ecartees: candidates.length - 1 };
    }
    return { parle: false, raison: 'rien de assez neuf ou de assez fort dans ce lot', ecartees: candidates.length };
  }

  function etat() {
    const t = maintenant(horloge);
    return { silencieuse, budgetParMinute, budgetRestant: budgetRestant(t), naturesVues: [...dernierParNature.keys()] };
  }

  return { observer, observerLot, silence, etat };
}

module.exports = {
  BUDGET_PAR_MINUTE_DEFAUT,
  NATURES,
  creerCopilote,
};

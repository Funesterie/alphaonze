'use strict';

/**
 * vivy-vision-cadence.cjs — Décider quelles images valent un appel au modèle de vision.
 *
 * Le poste de dépense du copilote n'est pas la voix : les phrases sont synthétisées
 * une fois puis rejouées pour rien (vivy-banque-vocale.cjs). C'est la VISION qui
 * coûte, à chaque image analysée. Ce module est le robinet.
 *
 * Trois verrous, et il en faut bien trois :
 *
 *   1. CHANGEMENT — la plupart des images d'un jeu sont quasi identiques à la
 *      précédente : on marche, on lit un menu, on attend. Les analyser est de
 *      l'argent jeté.
 *   2. INTERVALLE MINIMUM — et c'est le verrou qu'on oublie. En combat, l'écran
 *      change à CHAQUE image : un détecteur de changement seul se déclencherait en
 *      continu, précisément au moment le plus coûteux. Le changement dit « il se
 *      passe quelque chose », il ne dit pas « il faut regarder maintenant ».
 *   3. BUDGET — un plafond d'appels par minute, pour qu'une session longue ne
 *      derive pas. Ce qui protege d'un oubli, pas d'une erreur ponctuelle.
 *
 * L'empreinte fournie doit etre CHEAP a calculer cote appelant (image reduite,
 * hachage perceptuel). Comparer deux empreintes ne doit jamais couter plus que
 * l'appel qu'on cherche a eviter.
 */

const INTERVALLE_MIN_MS = 1200;
const SEUIL_CHANGEMENT = 0.06;
const APPELS_PAR_MINUTE = 25;

function maintenant(horloge) {
  return typeof horloge === 'function' ? Number(horloge()) : Date.now();
}

/**
 * Distance entre deux empreintes, dans [0,1].
 * Accepte un tableau de nombres (histogramme, hachage) ou une chaine (hex).
 */
function distance(a, b) {
  if (!a || !b) return 1;
  if (typeof a === 'string' && typeof b === 'string') {
    if (a.length !== b.length) return 1;
    let differents = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differents += 1;
    return differents / a.length;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.length) {
    let somme = 0;
    for (let i = 0; i < a.length; i += 1) somme += Math.abs(Number(a[i]) - Number(b[i]));
    return Math.min(1, somme / a.length);
  }
  return 1;
}

function creerCadence({
  intervalleMinMs = INTERVALLE_MIN_MS,
  seuilChangement = SEUIL_CHANGEMENT,
  appelsParMinute = APPELS_PAR_MINUTE,
  horloge = null,
} = {}) {
  let derniereEmpreinte = null;
  let dernierAppel = 0;
  let appels = [];
  const compte = { vues: 0, analysees: 0, ecarteesChangement: 0, ecarteesIntervalle: 0, ecarteesBudget: 0 };

  function budgetRestant(t) {
    appels = appels.filter((at) => t - at < 60000);
    return Math.max(0, appelsParMinute - appels.length);
  }

  /**
   * @param {string|number[]} empreinte
   * @param {object} [options]
   * @param {boolean} [options.force]  passe outre changement et intervalle — pour un
   *   evenement dont on sait deja qu'il compte (entree en donjon, ecran de mort).
   *   Le BUDGET, lui, n'est jamais force : c'est le seul garde-fou contre une derive.
   */
  function doitAnalyser(empreinte, { force = false } = {}) {
    const t = maintenant(horloge);
    compte.vues += 1;

    const restant = budgetRestant(t);
    if (restant <= 0) {
      compte.ecarteesBudget += 1;
      return { analyser: false, raison: 'budget de vision epuise pour cette minute', budgetRestant: 0 };
    }

    if (!force) {
      if (t - dernierAppel < intervalleMinMs) {
        compte.ecarteesIntervalle += 1;
        return { analyser: false, raison: `intervalle minimum : ${intervalleMinMs - (t - dernierAppel)} ms restantes`, budgetRestant: restant };
      }
      const d = distance(derniereEmpreinte, empreinte);
      if (derniereEmpreinte !== null && d < seuilChangement) {
        compte.ecarteesChangement += 1;
        return { analyser: false, raison: `ecran quasi identique (${d.toFixed(3)} < ${seuilChangement})`, changement: d, budgetRestant: restant };
      }
    }

    derniereEmpreinte = empreinte;
    dernierAppel = t;
    appels.push(t);
    compte.analysees += 1;
    return { analyser: true, force, budgetRestant: budgetRestant(t) };
  }

  function etat() {
    const t = maintenant(horloge);
    const economie = compte.vues ? 1 - compte.analysees / compte.vues : 0;
    return {
      ...compte,
      budgetRestant: budgetRestant(t),
      // Ce qu'on a evite de payer. C'est le chiffre qui dit si le robinet sert.
      economie: Number(economie.toFixed(3)),
    };
  }

  return { doitAnalyser, etat };
}

module.exports = {
  APPELS_PAR_MINUTE,
  INTERVALLE_MIN_MS,
  SEUIL_CHANGEMENT,
  creerCadence,
  distance,
};

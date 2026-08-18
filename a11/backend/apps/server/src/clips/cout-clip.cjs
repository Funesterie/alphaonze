'use strict';

/**
 * cout-clip.cjs — Ce qu'un clip coute vraiment, et combien on peut en faire.
 *
 * LE PIEGE QUE CE MODULE EXISTE POUR EVITER
 *
 * Comfy Cloud ne se facture PAS a l'acte. C'est un abonnement mensuel qui donne
 * une reserve de credits ; les credits non consommes ne se revendent pas, et une
 * fois la reserve vide, la production s'arrete jusqu'au mois suivant quel que
 * soit le chiffre d'affaires. Raisonner en « marge par clip » donne donc une
 * reponse rassurante et fausse : le prix de vente couvre le cout GPU des la
 * premiere vente, mais ca ne dit rien de la seule contrainte qui mord, qui est
 * le NOMBRE de clips que le palier autorise dans le mois.
 *
 * Ce module rend donc les deux chiffres : le cout d'un clip, et le plafond
 * mensuel du palier. C'est le second qui decide.
 *
 * D'OU VIENNENT LES NOMBRES
 *
 * Paliers et reserves : grille publique comfy.org/pricing, relevee le 18/08/2026.
 * A revalider sur le compte -- une grille tarifaire n'est pas un contrat, et
 * celle-ci sert ici de defaut, pas de verite.
 *
 * Consommation : la seule reference publiee est « une video de 5 s consomme
 * environ 11 credits », mesuree sur le gabarit Wan 2.2 image-vers-video en
 * reglages par defaut (81 images, 18 fps, 640x640, echantillonneur 4 etapes).
 * D'ou 2,2 credits par seconde generee.
 *
 * MULTIPLICATEUR : la reference n'est pas notre configuration. On tourne en
 * wan2.5-i2v-preview a 480P. La surface est quasi identique (854x480 = 409 920
 * pixels contre 640x640 = 409 600), donc ce n'est pas la resolution qui creuse
 * l'ecart -- c'est le modele, plus recent et plus lourd, et le nombre d'etapes.
 * Le multiplicateur par defaut est a 2, volontairement pessimiste : se tromper
 * en sous-estimant vide la reserve au milieu du mois, se tromper en surestimant
 * ne coute qu'un palier trop genereux. A remplacer par une mesure des que la
 * consommation reelle d'un clip complet aura ete relevee sur le compte.
 */

const CREDITS_PAR_SECONDE_REFERENCE = 2.2;
const MULTIPLICATEUR_DEFAUT = 2;

/**
 * Forfait de soumission, par SCENE et non par clip.
 *
 * Confirme par Djeff le 18/08/2026 sur son releve Comfy. Un clip n'est pas une
 * generation: c'en est huit, soumises separement. Compter le forfait une seule
 * fois sous-estimait donc de sept unites -- l'erreur type qui vide une reserve
 * trois jours avant la fin du mois sans qu'on comprenne ou est passe le compte.
 */
const FORFAIT_PAR_SCENE_DEFAUT = 1;

/**
 * Grille Comfy Cloud, facturation annuelle. `usdParAn` est ce qui sort du
 * compte ; `creditsParMois` est la reserve qui se recharge chaque mois.
 */
const PALIERS_COMFY = Object.freeze({
  standard: Object.freeze({ id: 'standard', usdParAn: 192, creditsParMois: 4200 }),
  creator: Object.freeze({ id: 'creator', usdParAn: 336, creditsParMois: 7400 }),
  pro: Object.freeze({ id: 'pro', usdParAn: 960, creditsParMois: 21100 }),
  team: Object.freeze({ id: 'team', usdParAn: 7560, creditsParMois: 147700 }),
});

function nombre(valeur, defaut) {
  const n = Number(valeur);
  return Number.isFinite(n) && n > 0 ? n : defaut;
}

/**
 * Comme `nombre`, mais zero est une valeur et non une absence.
 *
 * Un nombre de scenes a zero n'a pas de sens, donc `nombre` a raison de le
 * refuser. Un forfait de soumission a zero, si: c'est le cas ou Comfy ne
 * facture pas la soumission. Sans cette distinction, mettre le forfait a 0
 * retombe silencieusement sur 1 et le reglage n'a aucun effet.
 */
function nombreOuZero(valeur, defaut) {
  const n = Number(valeur);
  return Number.isFinite(n) && n >= 0 ? n : defaut;
}

/**
 * Les parametres de rendu reellement utilises en production, lus dans
 * l'environnement pour que le calcul suive les reglages au lieu de les figer.
 */
function parametresRendu(env = process.env) {
  return {
    scenes: nombre(env.VIVY_STREAM_FULL_CLIP_SCENES, 8),
    secondesParScene: nombre(env.VIVY_STREAM_FULL_CLIP_LOOP_SECONDS, 8),
    multiplicateur: nombre(env.A11_COMFY_CREDIT_MULTIPLIER, MULTIPLICATEUR_DEFAUT),
    creditsParSeconde: nombre(env.A11_COMFY_CREDITS_PAR_SECONDE, CREDITS_PAR_SECONDE_REFERENCE),
    forfaitParScene: nombreOuZero(env.A11_COMFY_FORFAIT_PAR_SCENE, FORFAIT_PAR_SCENE_DEFAUT),
  };
}

/** Le prix d'un credit, deduit du palier: reserve mensuelle contre mensualite. */
function usdParCredit(palierId = 'standard') {
  const palier = PALIERS_COMFY[String(palierId || '').toLowerCase()] || PALIERS_COMFY.standard;
  return (palier.usdParAn / 12) / palier.creditsParMois;
}

/** Ce qu'un clip FULL consomme, en credits puis en dollars. */
function coutClip({ env = process.env, palier = 'standard' } = {}) {
  const p = parametresRendu(env);
  const secondesGenerees = p.scenes * p.secondesParScene;
  const gpu = Math.ceil(secondesGenerees * p.creditsParSeconde * p.multiplicateur);
  const forfait = p.scenes * p.forfaitParScene;
  const credits = gpu + forfait;
  return {
    scenes: p.scenes,
    secondesGenerees,
    creditsGpu: gpu,
    creditsForfait: forfait,
    credits,
    usd: Number((credits * usdParCredit(palier)).toFixed(4)),
    multiplicateur: p.multiplicateur,
    estime: true,
  };
}

/**
 * Combien de clips le palier autorise dans le mois, et ce que rapporte ce
 * plafond aux tarifs de vente. C'est la reponse a « est-ce que ca s'autoalimente ».
 */
function capaciteMensuelle({ env = process.env, palier = 'standard', prixVenteEur = 29.99 } = {}) {
  const config = PALIERS_COMFY[String(palier || '').toLowerCase()] || PALIERS_COMFY.standard;
  const cout = coutClip({ env, palier: config.id });
  const clipsParMois = Math.floor(config.creditsParMois / cout.credits);
  return {
    palier: config.id,
    usdParMois: Number((config.usdParAn / 12).toFixed(2)),
    creditsParMois: config.creditsParMois,
    creditsParClip: cout.credits,
    clipsParMois,
    // Le seuil qui compte vraiment : a partir de combien de ventes le palier
    // est rembourse. En dessous, la production est financee par autre chose.
    ventesPourRembourserLePalier: Math.ceil((config.usdParAn / 12) / Math.max(0.01, prixVenteEur)),
    recetteSiPlafondAtteintEur: Number((clipsParMois * prixVenteEur).toFixed(2)),
  };
}

/**
 * Le prix plancher : en dessous, une vente ne rembourse meme pas le GPU qu'elle
 * consomme. Sert de garde-fou aux offres, pas de prix conseille.
 */
function prixPlancherEur({ env = process.env, palier = 'standard', usdVersEur = 0.92, marge = 3 } = {}) {
  const cout = coutClip({ env, palier });
  return Number((cout.usd * usdVersEur * marge).toFixed(2));
}

module.exports = {
  PALIERS_COMFY,
  CREDITS_PAR_SECONDE_REFERENCE,
  parametresRendu,
  usdParCredit,
  coutClip,
  capaciteMensuelle,
  prixPlancherEur,
};

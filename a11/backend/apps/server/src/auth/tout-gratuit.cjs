'use strict';

/**
 * tout-gratuit.cjs — Le commutateur « tout gratuit », et le quota qui le tient.
 *
 * DECISION DE DJEFF, 18/08/2026 : plus rien n'est vendu. Abonnements, clips,
 * paywall: tout tombe.
 *
 * POURQUOI UN COMMUTATEUR ET PAS UNE AMPUTATION
 *
 * Arracher le code de paiement rendrait le retour en arriere couteux, et une
 * decision de prix se revise. Une variable d'environnement se rebascule en un
 * deploiement, sans toucher a une ligne de logique metier. Le code de paiement
 * reste donc en place, simplement court-circuite.
 *
 * GRATUIT NE VEUT PAS DIRE SANS COUT
 *
 * Un clip consomme ~282 credits Comfy que quelqu'un paie ou non, et le palier
 * Standard en donne 4200 par mois: en gratuit illimite, la reserve est vide au
 * 14e clip et plus personne n'a rien. La gratuite sans quota s'auto-detruit en
 * une quinzaine de demandes. D'ou un quota par personne et par mois.
 *
 * LE PIEGE DU COMPTEUR ANONYME -- deja present dans tier-usage-quota.cjs
 *
 * Ce module-la construit ses cles avec `String(userId || 'anon')`. Un quota
 * « par utilisateur » dont la cle retombe sur 'anon' n'est plus un quota par
 * utilisateur: c'est UN SEUL compteur partage par tous les anonymes. Selon le
 * sens de la comparaison, ou bien le premier visiteur epuise le quota de tout
 * le monde, ou bien il suffit de ne pas se connecter pour le contourner.
 *
 * Ici on refuse explicitement: pas de compte, pas de clip gratuit. Ce n'est pas
 * une contrainte commerciale -- c'est la seule facon qu'un quota « par personne »
 * veuille dire quelque chose. On rend un refus nomme, pas un compteur muet.
 */

const { TIERS } = require('./mcp-account-tier.cjs');

const DEFAUT_CLIPS_GRATUITS_PAR_MOIS = 1;

function estActif(env = process.env) {
  const brut = String(env.A11_TOUT_GRATUIT || '').trim().toLowerCase();
  return brut === '1' || brut === 'true' || brut === 'oui';
}

/**
 * Le palier offert quand tout est gratuit.
 *
 * PREMIUM, et surtout PAS ADMIN_FAMILY. Le palier famille n'est pas « premium
 * en mieux »: la meme liste sert de controle d'acces administrateur dans
 * admin-access.cjs, mcp-account-tier.cjs, les fichiers runtime et vivy-voice-chat.
 * Offrir admin_family a tout le monde ne rendrait pas le produit gratuit, ca
 * donnerait l'administration du serveur au premier venu.
 */
function palierOffert() {
  return TIERS.PREMIUM;
}

function quotaClipsParMois(env = process.env) {
  const brut = Number(env.A11_GRATUIT_CLIPS_PAR_MOIS);
  return Number.isFinite(brut) && brut >= 0 ? brut : DEFAUT_CLIPS_GRATUITS_PAR_MOIS;
}

/** Cle mensuelle. La date dans la cle fait la remise a zero, sans tache de fond. */
function cleMois(horodatage = new Date()) {
  return horodatage.toISOString().slice(0, 7);
}

/**
 * Identite comptable. Rend '' quand il n'y en a pas -- jamais 'anon'.
 *
 * Volontairement stricte: ni l'IP ni l'empreinte du navigateur ne sont des
 * personnes. Compter sur l'IP punit les foyers et les reseaux d'entreprise
 * partages, et ne genant qu'a peine celui qui veut contourner.
 */
function identiteComptable(user = null) {
  const id = String(user?.id || '').trim();
  if (id) return `u:${id}`;
  const email = String(user?.email || '').trim().toLowerCase();
  return email ? `e:${email}` : '';
}

function creerCompteurClipsGratuits({ env = process.env, maintenant = () => new Date() } = {}) {
  const compteurs = new Map();

  function etat(user = null) {
    const identite = identiteComptable(user);
    const quota = quotaClipsParMois(env);
    if (!identite) {
      return { autorise: false, raison: 'compte_requis', utilises: 0, quota, restants: 0 };
    }
    const cle = `${identite}|${cleMois(maintenant())}`;
    const utilises = Number(compteurs.get(cle) || 0);
    const restants = Math.max(0, quota - utilises);
    return {
      autorise: restants > 0,
      raison: restants > 0 ? '' : 'quota_mensuel_epuise',
      utilises,
      quota,
      restants,
    };
  }

  function consommer(user = null) {
    const avant = etat(user);
    if (!avant.autorise) return avant;
    const cle = `${identiteComptable(user)}|${cleMois(maintenant())}`;
    compteurs.set(cle, avant.utilises + 1);
    return etat(user);
  }

  function reinitialiser() {
    compteurs.clear();
  }

  return { etat, consommer, reinitialiser };
}

module.exports = {
  DEFAUT_CLIPS_GRATUITS_PAR_MOIS,
  estActif,
  palierOffert,
  quotaClipsParMois,
  identiteComptable,
  cleMois,
  creerCompteurClipsGratuits,
};

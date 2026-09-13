'use strict';

/**
 * Passe de titres sur le jukebox : quelles chansons meritent un vrai titre.
 *
 * Inventaire du 13/09/2026 sur 1 959 entrees : 320 « Session principale », 46
 * « Titre non retrouve », et des bouts de consigne pris pour des titres (« FIGHTERZ
 * CLUB Sous-sol beton, un neon qui grelotte Deux types se regar », « Oui je voudrais
 * faire un son pour la psychiatrie... », « Title Suis Vivy Verse », « Couplet
 * Vivy »), plus des titres par defaut portes par des dizaines de chansons
 * differentes (« Signal Funesterie » x38). L'ancien detecteur ne voyait que les
 * deux premiers cas.
 *
 * Module pur : aucune ecriture, aucun appel reseau. Le script en lot
 * (scripts/title-jukebox-claude.cjs) s'en sert pour choisir, puis paie.
 */

const crypto = require('node:crypto');

const hash = (valeur) => crypto.createHash('sha256').update(String(valeur)).digest('hex');

// Noms par defaut des generateurs (repris du titreur historique).
const GENERIQUE = /^(vivy[-_]|djeff-vivy-|[a-f0-9]{8}-variant|session principale|sans titre|archive vivy|titre non|untitled|test\b)/i;
// Debut d'une consigne ou d'une etiquette de section, pas d'un titre.
const DEBUT_DE_CONSIGNE = /^(oui\b|non\b|je (voudrais|veux|vais)\b|fais\b|fait\b|[ée]cris\b|title\b|titre\s*:|couplet\b|refrain\b|verse\b|chorus\b|hook\b|prompt\b)/i;
// Au-dela, c'est une phrase de consigne tronquee (les vrais titres du jukebox
// tiennent sous 45 caracteres ; les consignes coupees font 68 a 70).
const LONGUEUR_MAX_TITRE = 48;
// Un meme titre sur autant de chansons DIFFERENTES (paroles differentes) est un
// titre par defaut, pas un titre.
const SEUIL_DOUBLONS = 3;

function titreGenerique(titre) {
  const t = String(titre || '').trim();
  if (!t) return 'vide';
  if (GENERIQUE.test(t)) return 'generique';
  if (DEBUT_DE_CONSIGNE.test(t)) return 'consigne';
  if (t.length > LONGUEUR_MAX_TITRE) return 'consigne';
  return '';
}

function clePiste(piste) {
  return hash(piste.originalTrackUrl || piste.trackUrl || '');
}

/**
 * @param {Array} pistes  pistes de l'historique, titres Claude deja appliques
 * @param {Set<string>} dejaTitrees  cles (sha256 de l'URL source) deja titrees
 * @returns {{groupes: Array<{paroles, raison, titreActuel, pistes}>, sansParoles: number, raisons: object}}
 */
function choisirGroupes(pistes = [], dejaTitrees = new Set()) {
  const disponibles = pistes.filter((p) => p && p.available !== false && (p.originalTrackUrl || p.trackUrl));

  // Combien de chansons differentes (paroles differentes) portent chaque titre.
  const chansonsParTitre = new Map();
  for (const p of disponibles) {
    const titre = String(p.title || '').trim().toLowerCase();
    const paroles = String(p.lyrics || '').trim();
    if (!titre || !paroles) continue;
    if (!chansonsParTitre.has(titre)) chansonsParTitre.set(titre, new Set());
    chansonsParTitre.get(titre).add(hash(paroles));
  }

  const groupes = new Map();
  const raisons = {};
  let sansParoles = 0;
  for (const p of disponibles) {
    if (dejaTitrees.has(clePiste(p))) continue;
    const titre = String(p.title || '').trim();
    let raison = titreGenerique(titre);
    if (!raison && (chansonsParTitre.get(titre.toLowerCase())?.size || 0) >= SEUIL_DOUBLONS) raison = 'doublon';
    if (!raison) continue;
    const paroles = String(p.lyrics || '').trim();
    if (!paroles) { sansParoles += 1; continue; }
    raisons[raison] = (raisons[raison] || 0) + 1;
    const cle = hash(paroles);
    if (!groupes.has(cle)) groupes.set(cle, { paroles: paroles.slice(0, 1400), raison, titreActuel: titre, pistes: [] });
    groupes.get(cle).pistes.push(p);
  }
  return { groupes: [...groupes.values()], sansParoles, raisons };
}

module.exports = {
  LONGUEUR_MAX_TITRE,
  SEUIL_DOUBLONS,
  titreGenerique,
  choisirGroupes,
  clePiste,
  hash,
};

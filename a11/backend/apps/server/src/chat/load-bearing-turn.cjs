'use strict';

/**
 * L'épreuve : est-ce que cette dalle porte ?
 *
 * Métaphore de Djeff (2026-08-01), et elle est exacte. Une conversation est un
 * tombeau à dalles flottantes : on pose le pied sur une réponse candidate, et il
 * faut savoir AVANT de s'appuyer dessus si elle tient. Une dalle qui tombe n'est
 * pas effacée, elle est marquée (tombstone) pour que ni le repli ni un tour futur
 * ne la reprenne.
 *
 * Ce module ne fait que la première brique : le prédicat. Il est utile seul.
 *
 * Deux défauts observés en production, couverts par un seul prédicat :
 *
 *  1. Le repli du chat ressort une phrase générique (« Oui, je suis là. Je reprends
 *     simplement. ») au lieu de répondre au dernier contexte. Ces phrases sont
 *     choisies dans request-planner.cjs d'après la FORME du message entrant, sans
 *     jamais consulter l'historique : elles ne portent pas.
 *
 *  2. Des consignes internes partent dans Suno comme si c'étaient des paroles
 *     (« Distribution vocale choisie », « Ne mets pas le mot », « Banger dans les
 *     paroles », « Matière à transformer »). Une consigne interne n'est pas une
 *     réponse : elle ne porte pas non plus.
 *
 * Le filtre existant côté frontend (App.tsx) exige un tiret en début de ligne
 * (^-\s*Libellé:). Une consigne émise SANS ce préfixe passait à travers — et un
 * filtre uniquement frontend ne protège de toute façon pas un appel API direct.
 * Ici on travaille côté serveur et sans exiger de préfixe.
 */

/**
 * Repliage accents/casse/ponctuation. Tout ce qui est comparé passe par là, y
 * compris les constantes ci-dessous : c'est ce qui permet de les écrire en français
 * correct sans que les accents fassent échouer la comparaison.
 */
function replier(valeur) {
  return String(valeur == null ? '' : valeur)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Étiquettes de consigne interne, reprises du filtre frontend, plus les quatre
// chaînes effectivement vues fuiter en production.
const INTERNAL_LABELS = [
  'Outil cible',
  'Profil actif',
  'Référence',
  'Instruction',
  'Route recommandée',
  'Sécurité',
  'Voix sélectionnée',
  'Phrase test',
  'Source',
  'Direction sonore',
  'Matière',
  'Matière à transformer',
  'Casting vocal',
  'Nombre de chanteurs',
  'Distribution vocale',
  'Distribution vocale choisie',
  // Ajoutee le 02/08 pour affirmer l'identite de la voix plutot que l'interdire.
  // Elle passait ensuite dans les paroles : une consigne ecrite pour proteger la
  // persona finissait chantee par elle. Corrige le 03/08.
  'Voice direction',
  'Direction vocale',
  'Clé Suno',
  'Sortie simple possible',
  'Sortie attendue',
  'Rôle',
  'Règles communes',
  'Brouillon interne',
  // Étiquettes relevées le 2026-08-01 dans le brief réel de vivy-studio (l.4062-4082),
  // en confrontant le filtre au bloc qui fuitait vraiment. Elles passaient toutes.
  'Titre de travail',
  'Artistes cochés',
  'Outil voix actif',
  'Tags obligatoires',
  'Tag conseillé',
  'Structure proposée',
  'Refrain guide',
];

// Lignes de brief sans étiquette, que le filtre par « libellé: » ne peut pas voir.
// « 2 chanteurs. » est émis nu par le brief : ce n'est pas une parole, c'est un compte.
const INTERNAL_PATTERNS = [
  /^\d+\s+chanteurs?\.?$/,
];

// Consignes en phrase, sans deux-points, que le filtre par étiquette raterait.
const INTERNAL_SENTENCES = [
  'Ne mets pas le mot',
  'Banger dans les paroles',
  'Matière à transformer en chanson',
  'changer le casting',
  // Marqueurs de brouillon interne. response-draft-rewriter.cjs les connaît déjà,
  // mais sa branche « virtual_draft_leak » ne retirait que l'étiquette de tête :
  // « Analyse interne: intention utilisateur = relance. Contexte fiable: aucun. »
  // ressortait amputée de ses deux premiers mots et servie telle quelle.
  'analyse interne',
  'intention utilisateur',
  'intent utilisateur',
  'contexte fiable',
  'brouillon interne',
  // Marqueurs techniques de la chaine Suno. Ils ne designent pas un contenu, ils
  // designent un FORMAT — les voir dans des paroles signifie qu'une consigne de
  // tuyauterie est partie chanter. Djeff les a vus sortir en prod.
  'clean_lyrics',
  'clean lyrics',
  'vocal_lyrics',
  'public_lyrics',
  'songcraft',
];

/**
 * Lignes du COMPTE RENDU DE PRODUCTION. Ce ne sont pas des instructions internes :
 * c'est le rapport que Vivy affiche apres avoir fabrique un morceau, et il a toute
 * sa place a l'ecran.
 *
 * Le probleme est ailleurs. Ce bloc entre dans l'historique, et l'historique
 * redevient du CONTEXTE au tour suivant : Vivy relit son propre rapport comme si
 * c'etait une conversation, et « Casting demande », « Mix final pret »,
 * « Paroles envoyees a Suno » ressortent dans les paroles du morceau suivant.
 *
 * Djeff, 03/08 : « les consignes ou le wav banger du bouton NOSSEN partent en
 * contexte, c'est ca le probleme » — et « il faut differencier le chat du contexte ».
 *
 * On ne supprime donc pas ces lignes de l'affichage. On les retire du contexte.
 */
const PRODUCTION_REPORT_LABELS = [
  'Casting demandé',
  'Casting demande',
  'Téléchargement',
  'Telechargement',
  'Paroles envoyées à Suno',
  'Paroles envoyees a Suno',
  'Paroles chantées par les voix Funesterie',
  'Paroles chantees par les voix Funesterie',
  'Voix séparées',
  'Voix separees',
];

const PRODUCTION_REPORT_SENTENCES = [
  'mix final prêt',
  'mix final pret',
  'production prête',
  'production prete',
  'fond instrumental suno',
];

/** L'ouverture posee par le bouton NOSSEN : « Banger. » ou « NOSSEN. », seule sur sa ligne. */
const PRODUCTION_OPENER = /^\s*(banger|nossen)\s*\.?\s*$/i;

const RAPPORT_LABELS_REPLIES = new Set(PRODUCTION_REPORT_LABELS.map(replier));
const RAPPORT_SENTENCES_REPLIEES = PRODUCTION_REPORT_SENTENCES.map(replier);

/** Une ligne appartient-elle au compte rendu de production ? */
function isProductionReportLine(ligne = '') {
  const brut = String(ligne || '').trim();
  if (!brut) return false;
  if (PRODUCTION_OPENER.test(brut)) return true;
  const plie = replier(brut);
  const avantDeuxPoints = replier(brut.split(':')[0] || '');
  if (RAPPORT_LABELS_REPLIES.has(avantDeuxPoints)) return true;
  return RAPPORT_SENTENCES_REPLIEES.some((s) => s && plie.includes(s));
}

/**
 * Retire le compte rendu de production d'un texte destine au CONTEXTE.
 * A ne jamais appliquer a ce qu'on affiche : le rapport est utile a l'ecran.
 */
function stripProductionReport(texte = '') {
  const source = String(texte || '');
  if (!source.trim()) return '';
  const gardees = source
    .split(/\r?\n/)
    .filter((ligne) => !isProductionReportLine(ligne));
  // Un rapport entierement retire laisse des lignes vides en cascade : on les tasse.
  return gardees.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Phrases de repli préfabriquées. Elles ne répondent à rien : ce sont des accusés
// de présence. Voir request-planner.cjs.
const HOLLOW_PHRASES = [
  'Oui, je suis là. Je reprends simplement.',
  'Je réponds directement; les traitements lourds passent derrière si besoin.',
  'Je peux répondre vite avec un diagnostic court, puis approfondir avec les outils lourds si nécessaire.',
];

// Versions repliées, calculées une fois. Les constantes restent lisibles en
// français, la comparaison se fait sur ces jeux-là.
const LABELS_REPLIES = new Set(INTERNAL_LABELS.map(replier));
const SENTENCES_REPLIEES = INTERNAL_SENTENCES.map(replier);
const HOLLOW_REPLIEES = new Set(HOLLOW_PHRASES.map(replier));

const LONGUEUR_MINIMALE_PORTANTE = 12;

/**
 * Une ligne est-elle une consigne interne ?
 * Volontairement insensible au tiret initial : c'est exactement le trou du filtre
 * frontend. « - Distribution vocale: X » et « Distribution vocale choisie: X » sont
 * tous deux des consignes.
 */
function isInternalInstructionLine(ligne) {
  const repliee = replier(ligne).replace(/^[-*•]\s*/, '');
  if (!repliee) return false;

  for (const phrase of SENTENCES_REPLIEES) {
    if (repliee.includes(phrase)) return true;
  }

  for (const motif of INTERNAL_PATTERNS) {
    if (motif.test(repliee)) return true;
  }

  const deuxPoints = repliee.indexOf(':');
  if (deuxPoints > 0) {
    if (LABELS_REPLIES.has(repliee.slice(0, deuxPoints).trim())) return true;
  }
  return false;
}

/**
 * Retire les lignes de consigne interne d'un bloc de texte.
 * Sert à isoler le bloc paroles propre avant Suno et Mureka.
 */
function stripInternalInstructions(texte) {
  return String(texte == null ? '' : texte)
    .split(/\r?\n/)
    .filter((ligne) => !isInternalInstructionLine(ligne))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Le texte est-il creux : vide, générique, ou entièrement fait de consignes ? */
function isHollow(texte) {
  const brut = String(texte == null ? '' : texte).trim();
  if (!brut) return true;
  if (HOLLOW_REPLIEES.has(replier(brut))) return true;
  if (!stripInternalInstructions(brut)) return true;
  if (replier(brut).length < LONGUEUR_MINIMALE_PORTANTE) return true;
  return false;
}

/**
 * L'épreuve. Renvoie un verdict explicite plutôt qu'un booléen nu : le motif sert
 * au tombstone, pour qu'on sache POURQUOI la dalle est tombée.
 *
 * @param {{ text?: string, lastUserMessage?: string }} candidate
 * @returns {{ holds: boolean, reason: string, cleanedText: string }}
 */
function assessTurn(candidate = {}) {
  const brut = String(candidate.text == null ? '' : candidate.text).trim();
  const cleanedText = stripInternalInstructions(brut);

  if (!brut) return { holds: false, reason: 'empty', cleanedText: '' };
  if (HOLLOW_REPLIEES.has(replier(brut))) {
    return { holds: false, reason: 'canned_phrase', cleanedText };
  }
  if (!cleanedText) {
    return { holds: false, reason: 'internal_instruction_only', cleanedText: '' };
  }
  if (cleanedText !== brut) {
    // La dalle porte, mais elle était salie : on garde la version nettoyée.
    return { holds: true, reason: 'held_after_cleaning', cleanedText };
  }
  if (replier(cleanedText).length < LONGUEUR_MINIMALE_PORTANTE) {
    return { holds: false, reason: 'too_short', cleanedText };
  }
  return { holds: true, reason: 'held', cleanedText };
}

/**
 * Le chemin : suite des dalles qui ont porté, plus les tombstones de celles qui
 * sont tombées. En mémoire, borné. La persistance viendra avec le système A
 * (versions et bascule atomique), qu'on n'écrit qu'une fois la salle connue.
 */
const MAX_DALLES_PAR_SESSION = 40;
const _chemins = new Map();

function _cheminPour(sessionId) {
  const cle = String(sessionId || 'anon');
  if (!_chemins.has(cle)) _chemins.set(cle, { held: [], tombstones: [] });
  return _chemins.get(cle);
}

/**
 * Pose une dalle et retient le verdict. Une dalle qui tombe est MARQUÉE, pas
 * jetée : c'est la différence avec un simple filtre.
 */
function recordTile(sessionId, candidate = {}) {
  const verdict = assessTurn(candidate);
  const chemin = _cheminPour(sessionId);
  const dalle = {
    text: verdict.cleanedText,
    lastUserMessage: String(candidate.lastUserMessage || ''),
    reason: verdict.reason,
  };

  if (verdict.holds) {
    chemin.held.push(dalle);
    if (chemin.held.length > MAX_DALLES_PAR_SESSION) chemin.held.shift();
  } else {
    chemin.tombstones.push(dalle);
    if (chemin.tombstones.length > MAX_DALLES_PAR_SESSION) chemin.tombstones.shift();
  }
  return verdict;
}

/** La dernière dalle qui a porté. C'est de là que le repli doit répondre. */
function lastLoadBearingTurn(sessionId) {
  const chemin = _cheminPour(sessionId);
  return chemin.held.length ? chemin.held[chemin.held.length - 1] : null;
}

/** Les dalles tombées, avec leur motif. Ne pas les reprendre. */
function fallenTiles(sessionId) {
  return _cheminPour(sessionId).tombstones.slice();
}

function resetPath(sessionId) {
  _chemins.delete(String(sessionId || 'anon'));
}

module.exports = {
  HOLLOW_PHRASES,
  INTERNAL_LABELS,
  INTERNAL_SENTENCES,
  PRODUCTION_REPORT_LABELS,
  PRODUCTION_REPORT_SENTENCES,
  assessTurn,
  fallenTiles,
  isHollow,
  isInternalInstructionLine,
  isProductionReportLine,
  lastLoadBearingTurn,
  recordTile,
  resetPath,
  stripInternalInstructions,
  stripProductionReport,
};

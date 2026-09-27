'use strict';

// Consignes chantées (27/09/2026). Djeff a entendu dans ses morceaux « Relais vocal
// obligatoire: Djeff seul sur un bloc complet », « Les refrains répétés doivent être
// portés par une seule voix nommée… », « Direction freestyle rap obligatoire »,
// « variations de flow et de débit; refrain seu » ou « Tempo — cypher rap morceau 5,
// DJEFF — album, GO — zéro style ».
//
// Chemin : quand le grand modèle ne répond pas, les gabarits de secours piochent des
// lignes dans la matière reçue, et cette matière contient le brief de production
// construit par le studio (App.tsx) ou le live. La dernière barrière avant Suno
// (isVivyProviderTechnicalLyricLine) ne connaissait qu'une liste de phrases exactes ;
// chaque nouveau brief inventait une formulation qu'elle laissait passer.
//
// Ici on reconnaît la FORME d'une consigne plutôt que ses mots : une étiquette
// interne suivie de deux-points, un ton prescriptif (obligatoire, doit être,
// N'écris jamais) appliqué au vocabulaire d'atelier, ou une ligne faite de jargon
// d'atelier où personne ne parle. Une consigne n'est jamais une parole : ces lignes
// se retirent, contrairement aux vers d'arrangement (lyrics-production-talk.cjs).

function foldLine(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Vocabulaire d'atelier : les mots avec lesquels on parle d'une chanson en train de
// se faire. « voix », « chanson », « image » ou « sujet » n'y sont pas : les
// paroles s'en servent tout le temps.
const WORKSHOP_JARGON = /\b(?:couplets?|refrains?|pre[\s-]?refrains?|sections?|tags?|casting|flow|debit|rimes?|punchlines?|multisyllabiques?|structure|style|blocs?|duo|trio|timbres?|morceau|album|lead|hook|prosodie|consignes?|brief|relais)\b/g;

// Étiquettes internes qu'un brief met en tête de ligne avant deux-points, ou
// étiquette qui se termine par un qualificatif de brief (« Hook obligatoire: »).
const INTERNAL_LABEL_WORD = /\b(?:direction|relais|contraintes?|sujet|casting|origine|production|structure|consignes?|style|matiere|distribution|regles?|format|couleur|notes?|contrat|routage|mode|tempo|ambiance|genre|langue|titre|intention|brief|souhait)\b/;
const INTERNAL_LABEL_SUFFIX = /\b(?:obligatoires?|verrouille(?:e|s|es)?|choisie?s?|possible|utilisateur)$/;

const PRESCRIPTIVE = /\b(?:obligatoires?|verrouille(?:e|s|es)?|en alternance si possible|sert seulement a|au moins (?:un|une|deux|trois|quatre|cinq))\b|\bdoi(?:t|vent)\s+(?:etre|rester|contenir|commencer|garder|porter|s entendre|apparaitre|revenir|changer|avoir)\b/;

const IMPERATIVE_START = /^(?:n\s+)?(?:ecris|utilise|ancre|evite|varie|place|repartis|ajoute|termine|commence|insere|construis|reprends|alterne|respecte|conserve)\b/;

// Quelqu'un parle : une parole a un « je », un « tu », un « on »… Une consigne non.
const SPEAKER = /\b(?:je|j|tu|t|il|elle|on|nous|vous|ils|elles|me|m|te|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|moi|toi|lui|y a|c est)\b/;

function jargonCount(folded = '') {
  return new Set(folded.match(WORKSHOP_JARGON) || []).size;
}

/**
 * Vrai si la ligne est une consigne de production et pas une parole.
 * Les balises de section ([Verse 1], [Djeff]) ne sont jamais des consignes ici.
 */
function isLyricInstructionLine(line = '') {
  const raw = String(line || '').trim();
  if (!raw || /^\[[^\]]*\]$/.test(raw)) return false;
  const folded = foldLine(raw);
  if (!folded) return false;
  if (/^production musicale\b/.test(folded)) return true;
  // « Moi j'note mentalement: il porte des Crocs » est une parole : quelqu'un parle
  // dans l'étiquette. « Sujet original verrouillé: … » n'en a pas.
  const label = folded.match(/^([^:]{2,45}):/)?.[1]?.trim() || '';
  if (label && !SPEAKER.test(label) && (INTERNAL_LABEL_WORD.test(label) || INTERNAL_LABEL_SUFFIX.test(label))) return true;
  const jargon = jargonCount(folded);
  const speaker = SPEAKER.test(folded);
  // « …mais ton style est verrouillé » : prescriptif en apparence, mais adressé à
  // quelqu'un. Deux mots d'atelier l'emportent sur un pronom : les briefs tronqués
  // finissent parfois sur un faux « ma » (« …de deux lignes ma[ximum] »).
  if ((!speaker || jargon >= 2) && jargon >= 1 && PRESCRIPTIVE.test(folded)) return true;
  if (!speaker && IMPERATIVE_START.test(folded) && (jargon >= 1 || /\b(?:jamais|au moins)\b/.test(folded))) return true;
  if (!speaker && jargon >= 3) return true;
  return false;
}

function stripLyricInstructionLines(lyrics = '') {
  const removed = [];
  const kept = [];
  for (const line of String(lyrics || '').split(/\r?\n/)) {
    if (isLyricInstructionLine(line)) removed.push(line.trim());
    else kept.push(line);
  }
  return { lyrics: kept.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}

module.exports = {
  isLyricInstructionLine,
  stripLyricInstructionLines,
};

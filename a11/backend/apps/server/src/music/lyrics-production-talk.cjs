'use strict';

// Paroles qui décrivent la musique au lieu de raconter le sujet (27/09/2026).
// Djeff : « beaucoup de chansons dérapent et parlent d'instru dans les paroles, le
// synthé hurle, les basses cognent ». Relevé sur le jukebox local du 23-24/09 :
// 17 des 40 derniers morceaux avaient au moins un vers de ce genre (« Soudain le
// piano monte, les basses se réveillent », « Hi-hats qui claquent, 808 qui frappe »,
// « Les synthés s'élèvent, la guitare hurle »).
//
// Cause : le prompt demandait d'« incarner la direction sonore dans les images », et
// la direction sonore nomme des instruments. La plume les recopiait en vers. Suno
// joue déjà ces sons : les chanter en plus fait un texte de notice de mixage.
//
// Ce module ne supprime rien. Retirer des vers casse les rimes et la carrure ; il
// repère seulement les lignes, et c'est la passe de réécriture qui les remplace.

// Termes de production, repliés (minuscules, sans accents). Les termes « soft »
// vivent aussi en idiome (« prendre le tempo », « le roi du beat ») : un seul vers
// ne suffit pas à les signaler, il en faut deux. Les autres sont choisis pour
// n'avoir presque aucun autre sens en français chanté : ni « cordes » (cordes tendues),
// ni « batterie » (celle de la moto), ni « refrain » (« le même refrain »), ni
// « micro » (vocabulaire rap légitime).
const PRODUCTION_TERM_PATTERNS = Object.freeze([
  ['synthe', /\bsynth(?:e|es|s|etiseurs?)?\b/],
  ['basse', /\b(?:la|les|des|une|de|du|sa|ma|ta|ses|mes|tes|nos|vos|leurs?)\s+basses?\b(?!\s*-?\s*cour)/],
  ['kick', /\bkicks?\b/],
  ['808', /\b808s?\b/],
  ['snare', /\b(?:snares?|caisses?\s+claires?)\b/],
  ['hi-hat', /\b(?:hi\s*-?\s*hats?|charleys?)\b/],
  ['beat', /\bbeats?\b/, 'soft'],
  ['drop', /\b(?:le|un|du|ce)\s+drop\b/],
  ['riff', /\briffs?\b/],
  ['bpm', /\bbpm\b/],
  ['tempo', /\btempo\b/, 'soft'],
  ['groove', /\bgrooves?\b/, 'soft'],
  ['crescendo', /\bcrescendos?\b/, 'soft'],
  ['stab', /\bstabs?\b/],
  ['mix', /\b(?:mixage|reverb|reverbe)\b/],
  ['guitare', /\bguitares?\b/],
  ['piano', /\b(?:le|un|du|au|ce|son|mon|ton)\s+piano\b/],
  ['violon', /\b(?:violons?|violoncelles?)\b/],
  ['sax', /\bsax(?:ophones?)?\b/],
  ['arpege', /\barpeges?\b/],
  ['sample', /\bsamples?\b/],
]);

function foldLyricText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ');
}

const SOFT_TERMS = new Set(PRODUCTION_TERM_PATTERNS.filter(([, , weight]) => weight === 'soft').map(([name]) => name));

function termsIn(folded = '') {
  return PRODUCTION_TERM_PATTERNS
    .filter(([, pattern]) => pattern.test(folded))
    .map(([name]) => name);
}

/**
 * Repère les vers qui décrivent l'arrangement.
 * `subject` : le sujet exact demandé (PAS la direction sonore, qui nomme toujours
 * des instruments). Un terme présent dans le sujet est permis : une chanson sur un
 * pianiste a le droit de dire « piano ».
 *
 * `flagged` : un vers avec un instrument franc (synthé, basse, 808, guitare…), un
 * vers qui empile deux termes, ou deux vers aux termes idiomatiques (beat, tempo).
 * Un « beat » isolé dans un rap passe.
 */
function findProductionTalkLines(lyrics = '', subject = '') {
  // Côté sujet, le nom seul suffit : « le vieux piano de ma grand-mère » n'a pas
  // d'article collé à « piano », mais la chanson parle bien d'un piano.
  const foldedSubject = foldLyricText(subject);
  const allowed = new Set(PRODUCTION_TERM_PATTERNS
    .filter(([name, pattern]) => pattern.test(foldedSubject) || new RegExp(`\\b${name}`).test(foldedSubject))
    .map(([name]) => name));
  const lines = [];
  for (const raw of String(lyrics || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^\[[^\]]+\]$/.test(line)) continue;
    const terms = termsIn(foldLyricText(line)).filter((term) => !allowed.has(term));
    if (terms.length) lines.push({ line, terms });
  }
  const strong = lines.some((entry) => entry.terms.length >= 2 || entry.terms.some((term) => !SOFT_TERMS.has(term)));
  return {
    flagged: strong || lines.length >= 2,
    lines,
    terms: Array.from(new Set(lines.flatMap((entry) => entry.terms))),
  };
}

// Consigne commune aux prompts d'écriture : affirmer ce que font les vers, puis
// nommer ce qui reste à la musique.
const LYRICS_TELL_THE_SUBJECT_RULE = 'Les paroles racontent le sujet ; la musique se charge du son. La direction sonore se traduit en énergie, en débit et en images du sujet — les instruments, le beat, les basses, le tempo ou le mix sont joués par la musique et restent hors des vers, sauf si le sujet de la chanson est la musique elle-même.';

function buildProductionTalkRewriteInstruction(result = {}) {
  const quoted = (result.lines || [])
    .slice(0, 6)
    .map((entry) => `« ${entry.line} »`)
    .join(' ; ');
  return [
    `Réécriture obligatoire : ces vers décrivent l'arrangement au lieu de raconter le sujet : ${quoted}.`,
    'La musique joue déjà ces sons. Remplace chacun de ces vers par une image, un geste ou une scène du sujet, garde la rime, la place dans la section et la structure, et ne nomme aucun instrument.',
  ].join(' ');
}

module.exports = {
  LYRICS_TELL_THE_SUBJECT_RULE,
  buildProductionTalkRewriteInstruction,
  findProductionTalkLines,
};

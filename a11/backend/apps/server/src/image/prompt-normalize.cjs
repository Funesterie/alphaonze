// utils/prompt-normalize.cjs
function looksLikeInventoryAnatomy(text) {
  if (!text) return false;
  const anatomy = [
    'head','heads','body','bodies','leg','legs','arm','arms',
    'wing','wings','tail','tails','eye','eyes','ear','ears',
    'wheel','wheels','door','doors','handle','handles'
  ];
  const numWord = '\\b(?:one|two|three|four|five|six|seven|eight|nine|\\d+)\\b';
  const anatRegex = new RegExp(`(${anatomy.join('|')})`, 'i');
  const numAnatRegex = new RegExp(`${numWord}\\s+(?:${anatomy.join('|')})`, 'i');
  const listAnatRegex = new RegExp(`(?:${anatomy.join('|')})(?:\\s*,\\s*(?:${anatomy.join('|')}))+`, 'i');

  // heuristique : présence de "2 legs" ou "one head" OR "head, body, legs"
  return numAnatRegex.test(text) || listAnatRegex.test(text) || (text.split(',').filter(s => anatRegex.test(s)).length >= 2);
}

function hasExplicitMultiIntent(text) {
  if (!text) return false;
  // ex: "two-headed dragon", "two heads", "three-wheeled", "dual-headed"
  return /\b(two|three|four|\d+)[-\s]*head(ed)?\b/i.test(text)
    || /\b(two|three|four|\d+)[-\s]*(wheeled|wheels)\b/i.test(text)
    || /\b(two|three|four|multi|dual|triple)-?(headed|wheeled|tailed)\b/i.test(text)
    || /\b(hydra|multi-headed|two-headed|three-headed)\b/i.test(text);
}

function normalizeAnatomyPrompt(originalPrompt = '', subjectHint = '') {
  const p = String(originalPrompt || '').trim();
  if (!p) return p;
  if (!looksLikeInventoryAnatomy(p)) return p;            // nothing to do
  if (hasExplicitMultiIntent(p)) return p;                // user wants multi: keep it

  // Replace common inventory patterns by unified phrasing
  // Heuristics: if the prompt contains anatomy tokens as list/with numbers -> replace the ENTIRE anatomy segment.
  // We'll attempt to replace just the comma-separated anatomy segment if possible.
  const anatomySegmentRegex = /((?:\b(?:one|two|three|four|\d+)\b\s+(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?\b)(?:\s*,\s*(?:\b(?:one|two|three|four|\d+)\b\s+(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?\b))*)/i;
  let newPrompt = p.replace(anatomySegmentRegex, '').replace(/\s{2,}/g, ' ').trim();

  // If no good removal above, remove pure lists: "head, body, legs" patterns
  if (newPrompt === p) {
    const listRegex = /\b(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?\b(?:\s*,\s*(?:head|body|leg|arm|wing|tail|eye|ear|wheel|door|handle)s?)+/i;
    newPrompt = p.replace(listRegex, '').replace(/\s{2,}/g, ' ').trim();
  }

  // Construct the safer anatomy phrase (prefer to include subject if provided)
  const subj = subjectHint ? `${subjectHint}` : '';
  const atom = subj ? `${subj}, single subject, full body, natural anatomy, coherent silhouette` : 'single subject, full body, natural anatomy, coherent silhouette';

  // Insert the atom at the end or before style modifiers
  // Try to preserve trailing style tokens (e.g. "in anime style")
  const styleSplit = newPrompt.split(/(?:in\s+|style\b)/i);
  let final = newPrompt;
  if (newPrompt.length === 0) {
    final = atom;
  } else {
    final = `${newPrompt}. ${atom}`;
  }

  // ensure punctuation sanity
  final = final.replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim();
  return final;
}

module.exports = { normalizeAnatomyPrompt, looksLikeInventoryAnatomy, hasExplicitMultiIntent };

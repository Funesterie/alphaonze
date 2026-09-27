'use strict';

// Prononciation pour Suno (27/09/2026). Suno lit le francais en devinant : sur « Plume de Djeff »,
// la devise « connecter, comprendre, créer » est sortie « connecteur, comprend, crée » (3:58,
// transcrit a l'ecoute). On ne touche pas a ce que la plume ecrit : seul le texte envoye a Suno
// prend une forme qu'il chante juste. Une entree = un mot ou une tournure effectivement mal
// chantee, jamais une correction « au cas ou ».

const REMPLACEMENTS = [
  {
    // La devise de Djeff : a l'infinitif, Suno la massacre ; conjuguee, chaque mot est courant.
    motif: /\bconnecter\s*,?\s*comprendre\s*,?\s*(?:et\s+)?cr[ée]er\b/gi,
    chante: 'je connecte, je comprends, je crée',
  },
];

function garderMajuscule(source, remplacement) {
  return /^[A-ZÀ-ÖØ-Þ]/.test(source) ? remplacement.charAt(0).toUpperCase() + remplacement.slice(1) : remplacement;
}

/** Texte de paroles tel qu'il doit partir chez Suno. */
function prononcerPourSuno(paroles = '') {
  let texte = String(paroles || '');
  for (const { motif, chante } of REMPLACEMENTS) {
    texte = texte.replace(motif, (trouve) => garderMajuscule(trouve, chante));
  }
  return texte;
}

module.exports = { prononcerPourSuno, REMPLACEMENTS };

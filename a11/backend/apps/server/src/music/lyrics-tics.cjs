'use strict';

// Tics d'ecriture (29/09/2026, demande de Djeff). Vivy Engine a ecrit « éclat » sur huit lignes
// differentes d'un meme morceau. Un tic = un mot porteur qui revient sur beaucoup de lignes
// DIFFERENTES : un refrain repete ne compte qu'une fois (on dedoublonne les lignes), et les mots
// outils ne comptent pas. La correction est affirmative (cf. « affirmer plutot qu'interdire ») :
// garder le premier emploi, donner aux autres lignes un autre detail concret de la scene.

const MOTS_OUTILS = new Set([
  'avec', 'dans', 'pour', 'sans', 'sous', 'vers', 'entre', 'comme', 'quand', 'mais', 'donc', 'alors',
  'plus', 'moins', 'tout', 'tous', 'toute', 'toutes', 'rien', 'encore', 'toujours', 'jamais', 'meme',
  'cette', 'celle', 'celui', 'ceux', 'elle', 'elles', 'nous', 'vous', 'leur', 'leurs', 'notre', 'votre',
  'mon', 'ton', 'son', 'mes', 'tes', 'ses', 'etre', 'avoir', 'fait', 'faire', 'suis', 'sont', 'etait',
  'peut', 'faut', 'reste', 'chaque', 'aussi', 'juste', 'ici', 'dont', 'quoi', 'lorsque', 'apres', 'avant',
]);

function plier(texte = '') {
  return String(texte).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function racine(mot = '') {
  // Pluriel et feminin simples : « éclats » et « éclat » sont le meme tic.
  return mot.replace(/(?:es|s|x)$/, '').replace(/e$/, '');
}

/**
 * Mots porteurs qui reviennent sur au moins `seuil` lignes differentes (balises ignorees).
 * Renvoie [{ mot, lignes }] tries par frequence.
 */
function findLyricTics(paroles = '', { seuil = 4, sujet = '' } = {}) {
  // Un mot du sujet demande revient naturellement (« dragon » dans une chanson sur un dragon) :
  // il a droit a deux lignes de plus avant d'etre un tic.
  const racinesSujet = new Set(plier(sujet).split(/[^a-z]+/).filter((m) => m.length >= 4).map(racine));
  const lignes = [...new Set(String(paroles || '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[[(].*[\])]$/.test(l))
    .map((l) => plier(l)))];
  const parRacine = new Map();
  for (const ligne of lignes) {
    const vus = new Set();
    for (const mot of ligne.split(/[^a-z]+/).filter((m) => m.length >= 4 && !MOTS_OUTILS.has(m))) {
      const r = racine(mot);
      if (vus.has(r)) continue;
      vus.add(r);
      const entree = parRacine.get(r) || { mot, lignes: 0, seuil: racinesSujet.has(r) ? seuil + 2 : seuil };
      entree.lignes += 1;
      parRacine.set(r, entree);
    }
  }
  return [...parRacine.values()]
    .filter((e) => e.lignes >= e.seuil)
    .map(({ mot, lignes }) => ({ mot, lignes }))
    .sort((a, b) => b.lignes - a.lignes);
}

/** Consigne de reecriture ciblee : seulement les lignes qui repetent le mot. */
function buildTicRewriteInstruction(tics = []) {
  const liste = tics.map((t) => `« ${t.mot} » (${t.lignes} lignes)`).join(', ');
  return [
    `Ces paroles reviennent trop souvent sur ${liste}.`,
    'Garde le premier emploi de chaque mot. Dans les autres lignes, mets à sa place un autre détail concret de la scène : un objet, une matière, un geste, un son, une couleur précise.',
    'Rends les paroles complètes, avec exactement les mêmes sections, le même refrain et le même nombre de lignes. Seules ces lignes changent.',
  ].join('\n');
}

module.exports = { buildTicRewriteInstruction, findLyricTics };

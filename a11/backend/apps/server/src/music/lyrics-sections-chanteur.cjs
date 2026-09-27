'use strict';

// Sections deduites (27/09/2026). Djeff Engine sur gemma4:26b balise chaque bloc par le seul nom
// du chanteur (« [Djeff] » sept fois) : le controle qualite NOSSEN n'y trouvait ni couplet ni
// refrain et rejetait un morceau complet. Quand un texte n'a AUCUNE balise de section mais au
// moins trois blocs balises par un chanteur, on nomme les sections d'apres la structure :
// - un bloc qui revient (memes vers) est le refrain ;
// - les autres sont des couplets, numerotes dans l'ordre ;
// - un bloc court (2 vers ou moins) en tete est l'intro, un bloc court en fin l'outro ;
// - un bloc court et unique entre deux refrains est le pont.
// Un texte qui a deja ses sections n'est jamais touche.

const SECTION = /^\s*\[\s*(?:intro|verse|couplet|pre[\s-]?chorus|pr[ée][\s-]?refrain|refrain|refren|chorus|bridge|pont|outro|final|hook|break|interlude|drop)\b/i;
const BALISE = /^\s*\[([^\]]{1,40})\]\s*$/;

function plier(ligne = '') {
  return String(ligne).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nommerSectionsParChanteur(texte = '') {
  const lignes = String(texte || '').split(/\r?\n/);
  if (lignes.some((l) => SECTION.test(l))) return texte;
  const blocs = [];
  let courant = null;
  const avant = [];
  for (const ligne of lignes) {
    const balise = ligne.match(BALISE);
    if (balise) {
      courant = { chanteur: balise[1].trim(), vers: [] };
      blocs.push(courant);
      continue;
    }
    if (courant) courant.vers.push(ligne);
    else avant.push(ligne);
  }
  if (blocs.length < 3) return texte;
  const cle = (bloc) => bloc.vers.map(plier).filter(Boolean).join('|');
  const nbVers = (bloc) => bloc.vers.filter((v) => v.trim()).length;
  const occurrences = new Map();
  for (const bloc of blocs) occurrences.set(cle(bloc), (occurrences.get(cle(bloc)) || 0) + 1);
  const estRefrain = (bloc) => nbVers(bloc) >= 2 && occurrences.get(cle(bloc)) >= 2;
  const indexRefrains = blocs.map((b, i) => (estRefrain(b) ? i : -1)).filter((i) => i >= 0);

  let couplet = 0;
  const noms = blocs.map((bloc, i) => {
    if (estRefrain(bloc)) return 'Chorus';
    const court = nbVers(bloc) <= 2;
    if (court && i === 0) return 'Intro';
    if (court && i === blocs.length - 1) return 'Outro';
    const entreRefrains = indexRefrains.some((r) => r < i) && indexRefrains.some((r) => r > i);
    if (nbVers(bloc) <= 4 && entreRefrains && couplet >= 2) return 'Bridge';
    couplet += 1;
    return `Verse ${couplet}`;
  });
  const sortie = [...avant];
  blocs.forEach((bloc, i) => {
    sortie.push(`[${noms[i]} - ${bloc.chanteur}]`);
    sortie.push(...bloc.vers);
  });
  return sortie.join('\n');
}

module.exports = { nommerSectionsParChanteur };

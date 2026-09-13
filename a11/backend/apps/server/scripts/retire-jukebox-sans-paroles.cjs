'use strict';
// Retire du jukebox les pistes sans paroles dont le titre n'en est pas un (nom de
// fichier, titre par defaut, bout de consigne). Decision de Djeff, 13/09/2026 :
// 181 archives de ce genre, impossibles a titrer faute de paroles.
//
// Rien n'est efface : un fichier <sha256 de l'URL source>.json est ecrit dans
// `<historique>-retired`, que jukebox-history.cjs filtre. L'audio et la fiche restent ;
// supprimer ce fichier remet la piste dans le jukebox.
//
// Usage (dans le conteneur backend) :
//   node scripts/retire-jukebox-sans-paroles.cjs            inventaire seulement
//   node scripts/retire-jukebox-sans-paroles.cjs --apply
const fs = require('node:fs');
const path = require('node:path');
const { readHistoryTracks, historyDirectory, applyHistoryEnhancements } = require('../src/music/jukebox-history.cjs');
const { titreGenerique, clePiste } = require('../src/music/jukebox-title-pass.cjs');

// Les noms de fichiers pris pour titres (« vivy-song-...-4de4d93fd5.wav ») ne
// ressemblent a aucun titre par defaut connu : on les reconnait a leur forme.
const NOM_DE_FICHIER = /(\.(wav|mp3|m4a|flac)$|^(vivy|djeff|a11)[-_][a-z0-9-]+-[0-9a-f]{6,}|^[a-z0-9]+(-[a-z0-9]+){4,}$)/i;

function aRetirer(piste) {
  if (String(piste.lyrics || '').trim()) return '';
  const titre = String(piste.title || '').trim();
  if (NOM_DE_FICHIER.test(titre)) return 'nom_de_fichier';
  return titreGenerique(titre) ? `titre_${titreGenerique(titre)}` : '';
}

function main() {
  const appliquer = process.argv.includes('--apply');
  const dossier = historyDirectory();
  const sortie = dossier + '-retired';
  const pistes = applyHistoryEnhancements(readHistoryTracks(dossier), dossier);
  const choisies = pistes.map((p) => ({ piste: p, raison: aRetirer(p) })).filter((x) => x.raison);
  const sansParoles = pistes.filter((p) => !String(p.lyrics || '').trim()).length;
  const raisons = {};
  for (const { raison } of choisies) raisons[raison] = (raisons[raison] || 0) + 1;
  console.log(JSON.stringify({ affichees: pistes.length, sansParoles, aRetirer: choisies.length, gardeesSansParoles: sansParoles - choisies.length, raisons }));
  for (const { piste } of choisies.slice(0, 10)) console.log(`  ${JSON.stringify(String(piste.title).slice(0, 70))}`);
  if (!appliquer) { console.log('inventaire seulement : ajouter --apply pour retirer'); return; }
  fs.mkdirSync(sortie, { recursive: true });
  let ecrits = 0;
  for (const { piste, raison } of choisies) {
    const fichier = path.join(sortie, clePiste(piste) + '.json');
    if (fs.existsSync(fichier)) continue;
    const tmp = `${fichier}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      sourceTrackUrl: piste.originalTrackUrl || piste.trackUrl, title: piste.title, source: piste.source || '',
      reason: raison, decidedBy: 'Djeff', retiredAt: new Date().toISOString(),
    }, null, 2));
    fs.renameSync(tmp, fichier);
    ecrits += 1;
  }
  const apres = applyHistoryEnhancements(readHistoryTracks(dossier), dossier).length;
  console.log(JSON.stringify({ retires: ecrits, dossier: path.basename(sortie), jukeboxAvant: pistes.length, jukeboxApres: apres }));
}

if (require.main === module) main();
module.exports = { aRetirer, NOM_DE_FICHIER };

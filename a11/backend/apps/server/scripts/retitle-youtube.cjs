'use strict';
// Renommer les videos YouTube deja en ligne d'apres les titres du jukebox
// (17/09/2026, demande de Djeff : « donner des titres a chaque son quand il sort
// et/ou modifier ceux de YouTube »).
//
// Usage (dans le conteneur backend) :
//   node scripts/retitle-youtube.cjs                     inventaire seul, rien de modifie
//   node scripts/retitle-youtube.cjs --apply [--limit=5]
//
// Le rapprochement se fait sur le titre ACTUEL de la video : on ne renomme que si
// l'archive porte un titre different pour la meme chanson (titre Claude superpose,
// `originalTitle` garde l'ancien). Une video dont le titre n'est retrouve nulle
// part est laissee telle quelle : on ne devine pas.
//
// videos.update exige le perimetre https://www.googleapis.com/auth/youtube. Un
// jeton emis avant le 17/09/2026 ne le porte pas : Djeff doit reconnecter la
// chaine depuis l'admin, sinon Google repond 403 insufficientPermissions.
const { Pool } = require('/app/node_modules/pg');
const { getFreshSocialTokens } = require('../src/social/social-autoprompt.cjs');
const { readHistoryTracks, applyHistoryEnhancements, historyDirectory } = require('../src/music/jukebox-history.cjs');

const API = 'https://www.googleapis.com/youtube/v3';
const argument = (nom, defaut) => {
  const trouve = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : defaut;
};
const normaliser = (titre) => String(titre || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function api(chemin, jeton, options = {}) {
  const reponse = await fetch(API + chemin, {
    ...options,
    headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const detail = donnees?.error?.errors?.[0]?.reason || donnees?.error?.message || reponse.status;
    const erreur = new Error(`youtube_${reponse.status}_${detail}`);
    erreur.reason = donnees?.error?.errors?.[0]?.reason || '';
    throw erreur;
  }
  return donnees;
}

async function main() {
  const appliquer = process.argv.includes('--apply');
  const limite = Math.max(1, Math.min(50, Number(argument('limit', '10')) || 10));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const coffre = await getFreshSocialTokens(pool, { provider: 'youtube', userId: argument('user', '2') }, process.env);
    const jeton = coffre && coffre.tokens && coffre.tokens.accessToken;
    if (!jeton) throw new Error('youtube_token_absent');

    // Titres de reference : l'archive du jukebox, titres Claude appliques.
    const dossier = historyDirectory();
    const pistes = applyHistoryEnhancements(readHistoryTracks(dossier), dossier);
    const parAncien = new Map();
    for (const piste of pistes) {
      if (!piste.originalTitle || !piste.title || piste.title === piste.originalTitle) continue;
      parAncien.set(normaliser(piste.originalTitle), piste.title);
    }

    const chaine = await api('/channels?part=contentDetails&mine=true', jeton);
    const uploads = chaine?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('youtube_uploads_playlist_absente');

    const videos = [];
    let page = '';
    do {
      const lot = await api(`/playlistItems?part=snippet&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`, jeton);
      for (const item of lot.items || []) {
        videos.push({ id: item.snippet?.resourceId?.videoId || '', titre: item.snippet?.title || '' });
      }
      page = lot.nextPageToken || '';
    } while (page);

    const aRenommer = [];
    for (const video of videos) {
      if (!video.id) continue;
      // Le titre YouTube porte souvent « Titre — Artiste | Album » : on compare la tete.
      const tete = video.titre.split(/[—|–\-]/)[0].trim();
      const nouveau = parAncien.get(normaliser(tete)) || parAncien.get(normaliser(video.titre));
      if (nouveau && normaliser(nouveau) !== normaliser(tete)) {
        aRenommer.push({ ...video, nouveau, nouveauTitreComplet: video.titre.replace(tete, nouveau).slice(0, 100) });
      }
    }

    console.log(JSON.stringify({ videos: videos.length, titresArchive: parAncien.size, aRenommer: aRenommer.length, applique: appliquer }));
    for (const v of aRenommer.slice(0, limite)) console.log(`  ${v.id} ${JSON.stringify(v.titre)} -> ${JSON.stringify(v.nouveauTitreComplet)}`);
    if (!appliquer) {
      console.log('inventaire seulement : ajouter --apply pour renommer');
      return;
    }

    let renommees = 0;
    for (const v of aRenommer.slice(0, limite)) {
      // videos.update remplace le snippet entier : il faut relire categoryId et
      // description, sinon Google les efface.
      const details = await api(`/videos?part=snippet&id=${v.id}`, jeton);
      const snippet = details?.items?.[0]?.snippet;
      if (!snippet) { console.log(`  ${v.id} introuvable, ignoree`); continue; }
      try {
        await api('/videos?part=snippet', jeton, {
          method: 'PUT',
          body: JSON.stringify({ id: v.id, snippet: { ...snippet, title: v.nouveauTitreComplet } }),
        });
        renommees += 1;
        console.log(`  renommee ${v.id}`);
      } catch (error) {
        console.log(`  echec ${v.id} : ${error.message}`);
        if (error.reason === 'insufficientPermissions' || /insufficient/i.test(error.message)) {
          console.log('  → le jeton ne porte pas le perimetre de gestion : reconnecter la chaine YouTube depuis l admin, puis relancer.');
          break;
        }
      }
    }
    console.log(JSON.stringify({ renommees }));
  } finally {
    await pool.end().catch(() => {});
    setTimeout(() => process.exit(0), 300);
  }
}

main().catch((error) => { console.log('ERREUR', error.message); setTimeout(() => process.exit(1), 300); });

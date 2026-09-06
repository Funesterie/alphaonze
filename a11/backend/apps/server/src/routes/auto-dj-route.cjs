'use strict';

/**
 * auto-dj-route.cjs — Expose le choix des voix a l'interface.
 *
 * Deux routes seulement :
 *   GET  /casting  qui peut chanter, et avec quel timbre mesure
 *   POST /plan     quelle voix sur quelle section d'un morceau donne
 *
 * CE QUI NE SORT JAMAIS D'ICI
 *
 * Aucun `voiceId` Suno. Le catalogue a une vue publique exprès (describeVoiceCatalog,
 * masque + empreinte) et cette route s'y tient : un identifiant de persona est une
 * cle de generation chez un tiers, pas une donnee d'affichage.
 */

const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const { readVoiceCatalog, readVoiceSample } = require('../music/voice-catalog.cjs');
const { profilVocal } = require('../music/voice-profile.cjs');
const { choisirVoix, estEligible } = require('../music/auto-dj.cjs');
const { teardownSong } = require('../clips/song-teardown.cjs');

/**
 * Racine autorisee pour les fichiers audio.
 *
 * `audioPath` vient du client. Sans cette borne, la route serait une primitive de
 * lecture de fichier arbitraire deguisee en lecteur de musique : il suffirait de
 * demander /etc/passwd pour que ffmpeg reponde s'il existe. On resout le chemin
 * puis on verifie qu'il est TOUJOURS sous la racine — comparer les chaines avant
 * resolution laisserait passer `../`.
 */
function resoudreAudio(demande, env = process.env) {
  const racine = path.resolve(getCanonicalRuntimeRoot(env));
  const cible = path.resolve(racine, String(demande || ''));
  const relatif = path.relative(racine, cible);
  if (relatif.startsWith('..') || path.isAbsolute(relatif)) return '';
  if (!fs.existsSync(cible) || !fs.statSync(cible).isFile()) return '';
  return cible;
}

/**
 * Qui est vivant sur le bus, si le bus est lisible.
 *
 * Best-effort assume : la presence RETROGRADE une voix, elle ne l'exclut pas
 * (voir auto-dj.cjs). Un bus injoignable doit donc rendre une liste vide et
 * laisser le DJ travailler, surtout pas lever une erreur — c'est precisement le
 * scenario ou le casting entier se tairait.
 */
function lirePresents(env = process.env) {
  const dir = env.A11_AGENT_STATE_DIR || env.AGENT_STATE_DIR || '';
  if (!dir) return [];
  try {
    const brut = fs.readFileSync(path.join(dir, 'presence.json'), 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(brut);
    if (!Array.isArray(parsed?.agents)) return [];
    return parsed.agents.map((a) => String(a?.name || '').toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Le casting : chaque voix du catalogue avec son profil mesure.
 *
 * Une voix sans echantillon n'a pas de profil — c'est le cas juste apres sa
 * creation, avant le rattrapage. Elle reste dans la liste avec `profil: null` :
 * auto-dj la place alors au centre de l'espace, donc elle chante quand meme.
 */
function construireCasting(env = process.env) {
  const { voices } = readVoiceCatalog(env);
  return voices.map((v) => {
    const verdict = estEligible(v);
    const echantillon = verdict.ok ? readVoiceSample(v.name, env) : null;
    return {
      name: v.name,
      label: v.label,
      owner: v.owner,
      gender: v.gender,
      consentBy: v.consentBy,
      eligible: verdict.ok,
      raison: verdict.raison,
      aEchantillon: Boolean(echantillon),
      profil: echantillon ? profilVocal(echantillon.path) : null,
    };
  });
}

/**
 * Cache de decoupage, clé sur taille + date du fichier.
 *
 * Un morceau du jukebox ne bouge pas : son decoupage se calcule une fois. Si le
 * fichier est remplace, la cle change et l'analyse repart — sans quoi on servirait
 * la structure de l'ancien mix sur le nouveau.
 */
const teardownCache = new Map();
const TEARDOWN_CACHE_MAX = 100;

function teardownDepuisCache(audio) {
  const st = fs.statSync(audio);
  const cle = `${audio}|${st.size}|${st.mtimeMs}`;
  if (teardownCache.has(cle)) return teardownCache.get(cle);
  const teardown = teardownSong(audio);
  if (teardownCache.size >= TEARDOWN_CACHE_MAX) {
    teardownCache.delete(teardownCache.keys().next().value);
  }
  teardownCache.set(cle, teardown);
  return teardown;
}

function createAutoDjRouter({ verifyJWT, env = process.env } = {}) {
  const express = require('express');
  const router = express.Router();
  const requireAuth = verifyJWT || ((req, res, next) => next());

  router.get('/casting', requireAuth, (req, res) => {
    try {
      const casting = construireCasting(env);
      res.json({
        ok: true,
        total: casting.length,
        eligibles: casting.filter((c) => c.eligible).length,
        presents: lirePresents(env),
        casting,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'casting_indisponible', detail: String(error?.message || error) });
    }
  });

  router.post('/plan', requireAuth, (req, res) => {
    const demande = String(req.body?.audioPath || '').trim();
    if (!demande) return res.status(400).json({ ok: false, error: 'audioPath_manquant' });

    const audio = resoudreAudio(demande, env);
    if (!audio) return res.status(400).json({ ok: false, error: 'audioPath_refuse' });

    try {
      // teardownSong est SYNCHRONE : il passe par spawnSync, qui bloque la boucle
      // d'evenements entiere le temps de l'analyse ffmpeg — plusieurs secondes sur
      // un morceau complet. Deux visiteurs simultanes suffiraient a figer le
      // serveur pour tout le monde, y compris les requetes qui n'ont rien a voir.
      //
      // Le cache rend ce cout non recurrent : un morceau du jukebox ne change pas,
      // son decoupage non plus. Ce n'est PAS une solution complete — le tout
      // premier appel sur un titre bloque encore. Le jour ou cette route s'ouvre
      // au public, l'analyse doit passer en file d'attente (clip-jobs.cjs) au lieu
      // de repondre dans la requete.
      const teardown = teardownDepuisCache(audio);
      const casting = construireCasting(env).filter((c) => c.eligible);
      // On rebranche le profil sur l'entree que choisirVoix attend, et on garde
      // idHash comme preuve d'existence : jamais le voiceId.
      const voix = casting.map((c) => ({
        name: c.name, label: c.label, consentBy: c.consentBy,
        active: true, idHash: c.name, profil: c.profil || {},
      }));

      const plan = choisirVoix({ sections: teardown.sections, voix, presents: lirePresents(env) });
      res.json({ ok: true, teardown, plan });
    } catch (error) {
      res.status(500).json({ ok: false, error: 'plan_impossible', detail: String(error?.message || error) });
    }
  });

  return router;
}

module.exports = { createAutoDjRouter, resoudreAudio, construireCasting, lirePresents };

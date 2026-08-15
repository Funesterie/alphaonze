'use strict';

/**
 * voice-profile.cjs — Mesurer le timbre d'une voix, de facon reproductible.
 *
 * Une description comme « clair, projete, nasal, brillant dans le haut medium »
 * se juge a l'oreille, donc jamais deux fois pareil. Ces quatre mesures en
 * donnent une lecture stable :
 *
 *   brillance   energie 2-6 kHz par rapport au total. Un timbre « brillant » ou
 *               « nasal » y monte; un timbre « grave, tenu » y descend.
 *   corps       energie 150-800 Hz. Le « medium grave, stable » de Codex, le
 *               « corps dans le medium » de Vivy.
 *   fond        energie sous 150 Hz. Doit rester bas sur un a cappella : s'il
 *               monte, la separation demucs a laisse passer de l'instrumental.
 *   densite     rapport RMS/peak. Un debit « rapide, sans silence » est dense;
 *               un debit « lent, silences longs » ne l'est pas.
 *
 * Ce ne sont PAS des unites absolues et elles ne disent pas si une voix est
 * belle. Elles servent a deux choses : verifier qu'une voix va dans le sens de
 * sa description, et fournir a auto-dj.cjs les quatre axes de son quaternion.
 *
 * POURQUOI UN CACHE
 *
 * Un profil coute cinq passes ffmpeg sur l'echantillon complet — plusieurs
 * minutes d'audio par voix. Sans cache, afficher une page qui liste douze voix
 * lancerait soixante passes ffmpeg a chaque rafraichissement. La cle inclut la
 * taille ET la date du fichier : reanimer une persona remplace l'echantillon,
 * et un cache qui survivrait a ce remplacement servirait le timbre du mort.
 */

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROFILE_SCHEMA = 'funesterie.voice-profile.v1';

/** Bandes mesurees. `f` = frequence centrale, `width` = largeur en Hz. */
const BANDES = Object.freeze({
  brillance: { f: 4000, width: 4000 },
  corps: { f: 475, width: 650 },
  fond: { f: 75, width: 145 },
});

// -90 dB tient lieu de silence : ffmpeg rend « -inf » sur une bande vide, et
// -inf contaminerait toute arithmetique en aval.
const SILENCE_DB = -90;

const cache = new Map();
const CACHE_MAX = 200;

function ffmpegBin() {
  return process.env.FFMPEG_BIN || 'ffmpeg';
}

function mesurer(filePath, bande = null) {
  const filtre = bande
    ? `bandpass=f=${bande.f}:width_type=h:w=${bande.width},astats=metadata=1:reset=0`
    : 'astats=metadata=1:reset=0';
  const run = spawnSync(ffmpegBin(), [
    '-hide_banner', '-nostats', '-i', filePath, '-af', filtre, '-f', 'null', '-',
  ], { timeout: 180000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  const texte = `${run.stdout || ''}${run.stderr || ''}`;
  const rms = texte.match(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-inf)/);
  const peak = texte.match(/Peak level dB:\s*(-?\d+(?:\.\d+)?|-inf)/);
  return {
    rms: rms ? (rms[1] === '-inf' ? SILENCE_DB : Number.parseFloat(rms[1])) : null,
    peak: peak ? (peak[1] === '-inf' ? SILENCE_DB : Number.parseFloat(peak[1])) : null,
  };
}

function cleDeCache(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${filePath}|${st.size}|${st.mtimeMs}`;
  } catch {
    return '';
  }
}

/**
 * Profil d'un fichier audio. Renvoie null si la mesure echoue — ffmpeg absent,
 * fichier illisible, echantillon vide. auto-dj traite un profil absent comme une
 * voix au centre de l'espace : elle reste jouable, elle n'est juste plus ciblee.
 */
function profilVocal(filePath, { force = false } = {}) {
  const cle = cleDeCache(filePath);
  if (!cle) return null;
  if (!force && cache.has(cle)) return cache.get(cle);

  const global = mesurer(filePath);
  if (global.rms === null || global.peak === null) return null;

  const bandes = {};
  for (const [nom, bande] of Object.entries(BANDES)) {
    const m = mesurer(filePath, bande);
    if (m.rms === null) return null;
    // Ecart au niveau global, pas valeur absolue : comparable d'un fichier a
    // l'autre meme si les volumes de gravure different.
    bandes[nom] = Number((m.rms - global.rms).toFixed(2));
  }

  const profil = {
    schema: PROFILE_SCHEMA,
    fichier: path.basename(filePath),
    brillance: bandes.brillance,
    corps: bandes.corps,
    fond: bandes.fond,
    densite: Number((global.rms - global.peak).toFixed(2)),
    rmsGlobal: global.rms,
    mesureA: new Date().toISOString(),
  };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(cle, profil);
  return profil;
}

/** Deux voix trop proches sur les quatre axes finiront par se confondre. */
function distanceProfils(a, b) {
  const d = ['brillance', 'corps', 'fond', 'densite']
    .map((k) => ((Number(a?.[k]) || 0) - (Number(b?.[k]) || 0)) ** 2)
    .reduce((s, v) => s + v, 0);
  return Number(Math.sqrt(d / 4).toFixed(2));
}

function viderCache() {
  cache.clear();
}

module.exports = {
  PROFILE_SCHEMA,
  BANDES,
  profilVocal,
  distanceProfils,
  viderCache,
};

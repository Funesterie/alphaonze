'use strict';
/**
 * song-teardown.cjs — Demonter le morceau avant de construire le clip.
 *
 * Tout le reste de la chaine deduisait l'ambiance du TITRE. Ce module ecoute
 * reellement le fichier : energie par bande de frequences, fenetre par fenetre,
 * sur toute la duree. Les ruptures d'ambiance sortent des donnees, pas d'une
 * phase theorique ni d'une liste de sections par defaut.
 *
 * Trois bandes suffisent pour lire une structure :
 *   grave  30-150 Hz   la batterie et la basse : dit si ca frappe
 *   medium 150-4000 Hz  la voix et les instruments : dit si ca chante
 *   aigu   4000+ Hz     cymbales, air, brillance : dit si c'est ouvert
 *
 * Une section commence quand le rapport entre ces bandes change durablement --
 * pas quand le volume bouge. Un refrain n'est pas juste plus fort : il est plus
 * large en bas ET en haut.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BANDS = [
  { id: 'grave', f: 90, width: 120 },
  { id: 'medium', f: 2000, width: 3800 },
  { id: 'aigu', f: 8000, width: 8000 },
];

function ffmpegBin() {
  return process.env.FFMPEG_BIN || 'ffmpeg';
}

function ffprobeBin() {
  return process.env.FFPROBE_BIN || 'ffprobe';
}

function durationSeconds(filePath) {
  const out = execFileSync(ffprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { timeout: 30000 }).toString().trim();
  return Number.parseFloat(out) || 0;
}

/**
 * Energie RMS d'une bande, par fenetre. On demande a ffmpeg de reinitialiser
 * ses statistiques a chaque fenetre : une seule passe donne toute la courbe.
 */
function bandEnvelope(filePath, band, windowSeconds, sampleRate = 44100) {
  // `reset` d'astats compte des TRAMES, pas des secondes. On force donc des
  // trames de taille fixe avec asetnsamples, puis on remet les stats a zero a
  // chaque trame : une trame = une fenetre, exactement.
  const samplesPerWindow = Math.max(1024, Math.round(sampleRate * windowSeconds));
  // astats n'imprime dans le log qu'un resume final : son `reset` alimente les
  // METADONNEES, pas la sortie texte. Il faut donc les extraire avec ametadata,
  // qui emet une ligne par fenetre sur stdout, horodatee.
  const filter = `aresample=${sampleRate},`
    + `bandpass=f=${band.f}:width_type=h:w=${band.width},`
    + `asetnsamples=n=${samplesPerWindow}:p=0,`
    + `astats=metadata=1:reset=1,`
    + `ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`;
  const run = spawnSync(ffmpegBin(),
    ['-hide_banner', '-nostats', '-i', filePath, '-af', filter, '-f', 'null', '-'],
    { timeout: 300000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const stdout = run.stdout || '';
  const values = [];
  const re = /lavfi\.astats\.Overall\.RMS_level=(-?\d+(?:\.\d+)?|-inf|nan)/g;
  let match;
  while ((match = re.exec(stdout)) !== null) {
    const raw = match[1];
    values.push(raw === '-inf' || raw === 'nan' ? -90 : Number.parseFloat(raw));
  }
  return values;
}

function normalize(values) {
  const finite = values.filter((v) => Number.isFinite(v) && v > -89);
  if (!finite.length) return values.map(() => 0);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  return values.map((v) => Math.max(0, Math.min(1, (v - min) / span)));
}

/**
 * Une rupture d'ambiance = le profil des trois bandes change nettement d'une
 * fenetre a la suivante. On mesure la distance entre profils successifs plutot
 * que la variation de volume : monter le son n'est pas changer de section.
 */
function detectSections(profiles, windowSeconds, sensitivity = 0.28) {
  const changes = [];
  for (let i = 1; i < profiles.length; i += 1) {
    const a = profiles[i - 1];
    const b = profiles[i];
    const distance = Math.sqrt(
      ((b.grave - a.grave) ** 2 + (b.medium - a.medium) ** 2 + (b.aigu - a.aigu) ** 2) / 3
    );
    changes.push({ index: i, atSeconds: i * windowSeconds, distance });
  }
  const boundaries = changes
    .filter((c) => c.distance >= sensitivity)
    .filter((c, i, list) => i === 0 || c.atSeconds - list[i - 1].atSeconds >= windowSeconds * 2);

  const sections = [];
  let start = 0;
  const cuts = boundaries.map((b) => b.index).concat([profiles.length]);
  for (const cut of cuts) {
    if (cut <= start) continue;
    const slice = profiles.slice(start, cut);
    const avg = (key) => slice.reduce((sum, p) => sum + p[key], 0) / slice.length;
    sections.push({
      startSeconds: Number((start * windowSeconds).toFixed(1)),
      endSeconds: Number((cut * windowSeconds).toFixed(1)),
      grave: Number(avg('grave').toFixed(3)),
      medium: Number(avg('medium').toFixed(3)),
      aigu: Number(avg('aigu').toFixed(3)),
    });
    start = cut;
  }
  return sections;
}

/** Nomme une section d'apres son profil, sans deviner un titre de chanson. */
function characterize(section) {
  const { grave, medium, aigu } = section;
  const energy = (grave + medium + aigu) / 3;
  const full = grave > 0.55 && aigu > 0.45;
  let label;
  if (energy < 0.3) label = 'creux';
  else if (full && energy > 0.6) label = 'plein';
  else if (grave > medium && grave > aigu) label = 'grave dominant';
  else if (medium > grave && medium > aigu) label = 'voix devant';
  else if (aigu > 0.6) label = 'ouvert / aigu';
  else label = 'corps median';
  return { label, energy: Number(energy.toFixed(3)) };
}

/**
 * Demontage complet. Retourne les sections reellement mesurees, leur energie et
 * leur caractere -- de quoi construire un clip qui suit le morceau au lieu de
 * suivre une idee du morceau.
 */
function teardownSong(filePath, { windowSeconds = 3, sensitivity = 0.28 } = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`Fichier introuvable : ${filePath}`);
  const duration = durationSeconds(filePath);
  const envelopes = {};
  for (const band of BANDS) {
    envelopes[band.id] = normalize(bandEnvelope(filePath, band, windowSeconds));
  }
  const count = Math.min(...BANDS.map((b) => envelopes[b.id].length));
  const profiles = [];
  for (let i = 0; i < count; i += 1) {
    profiles.push({
      grave: envelopes.grave[i],
      medium: envelopes.medium[i],
      aigu: envelopes.aigu[i],
    });
  }
  const sections = detectSections(profiles, windowSeconds, sensitivity).map((section) => ({
    ...section,
    ...characterize(section),
  }));
  return {
    schema: 'funesterie.clip.song-teardown.v1',
    durationSeconds: Number(duration.toFixed(2)),
    windowSeconds,
    windows: count,
    sections,
  };
}

/** Rendu court pour un prompt : ce que le morceau fait, minute par minute. */
function formatTeardownForPrompt(teardown) {
  if (!teardown || !Array.isArray(teardown.sections) || !teardown.sections.length) return '';
  const lines = teardown.sections.map((s, i) => {
    return `  ${i + 1}. ${s.startSeconds}s → ${s.endSeconds}s — ${s.label}`
      + ` (énergie ${s.energy}, grave ${s.grave}, voix ${s.medium}, aigu ${s.aigu})`;
  });
  return `STRUCTURE RÉELLE DU MORCEAU, mesurée sur le fichier audio`
    + ` (${teardown.durationSeconds}s, ${teardown.sections.length} sections) :\n`
    + lines.join('\n') + '\n'
    + `Ces bornes sont mesurées, pas déduites : les changements de plan doivent tomber dessus.\n\n`;
}

module.exports = {
  BANDS,
  teardownSong,
  detectSections,
  characterize,
  formatTeardownForPrompt,
};

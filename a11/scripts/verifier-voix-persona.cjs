'use strict';
/**
 * verifier-voix-persona.cjs — La voix generee correspond-elle a sa description ?
 *
 * Une description comme "clair, projete, nasal, brillant dans le haut medium" se
 * juge normalement a l'oreille, donc jamais deux fois pareil. Ces quatre mesures
 * en donnent une lecture reproductible :
 *
 *   brillance   energie 2-6 kHz par rapport au total. Un timbre "brillant" ou
 *               "nasal" y monte; un timbre "grave, tenu" y descend.
 *   corps       energie 150-800 Hz. C'est le "medium grave, stable" de Codex,
 *               le "corps dans le medium" de Vivy.
 *   fond        energie sous 150 Hz. Doit rester bas sur un a cappella : s'il
 *               monte, la separation a laisse passer de l'instrumental.
 *   densite     rapport RMS/peak. Un debit "rapide, sans silence" est dense; un
 *               debit "lent, silences longs" ne l'est pas.
 *
 * Ce ne sont PAS des unites absolues et elles ne disent pas si une voix est
 * belle. Elles servent a deux choses : verifier qu'une voix va dans le sens de
 * sa description, et verifier que deux personas ne se ressemblent pas.
 */
const { spawnSync } = require('child_process');
const path = require('path');

function ffmpegBin() {
  return process.env.FFMPEG_BIN || 'ffmpeg';
}

function rmsBande(filePath, freq, largeur) {
  const filtre = largeur
    ? `bandpass=f=${freq}:width_type=h:w=${largeur},astats=metadata=1:reset=0`
    : `astats=metadata=1:reset=0`;
  const run = spawnSync(ffmpegBin(), [
    '-hide_banner', '-nostats', '-i', filePath, '-af', filtre, '-f', 'null', '-',
  ], { timeout: 180000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const texte = `${run.stdout || ''}${run.stderr || ''}`;
  const m = texte.match(/RMS level dB:\s*(-?\d+(?:\.\d+)?|-inf)/);
  if (!m) return null;
  return m[1] === '-inf' ? -90 : Number.parseFloat(m[1]);
}

function peak(filePath) {
  const run = spawnSync(ffmpegBin(), [
    '-hide_banner', '-nostats', '-i', filePath, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-',
  ], { timeout: 180000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const texte = `${run.stdout || ''}${run.stderr || ''}`;
  const m = texte.match(/Peak level dB:\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number.parseFloat(m[1]) : null;
}

function profilVocal(filePath) {
  const total = rmsBande(filePath);
  const brillance = rmsBande(filePath, 4000, 4000);
  const corps = rmsBande(filePath, 475, 650);
  const fond = rmsBande(filePath, 75, 145);
  const crete = peak(filePath);
  if (total === null) throw new Error(`Mesure impossible : ${filePath}`);
  return {
    fichier: path.basename(filePath),
    // Ecarts par rapport au niveau global : comparables d'un fichier a l'autre
    // meme si les volumes different.
    brillance: Number((brillance - total).toFixed(2)),
    corps: Number((corps - total).toFixed(2)),
    fond: Number((fond - total).toFixed(2)),
    densite: Number((total - crete).toFixed(2)),
    rmsGlobal: total,
  };
}

/** Deux voix trop proches sur les quatre axes finiront par se confondre. */
function distance(a, b) {
  const d = ['brillance', 'corps', 'fond', 'densite']
    .map((k) => (a[k] - b[k]) ** 2)
    .reduce((s, v) => s + v, 0);
  return Number(Math.sqrt(d / 4).toFixed(2));
}

function main() {
  const fichiers = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!fichiers.length) {
    console.log('usage : node verifier-voix-persona.cjs <fichier.wav> [autre.wav ...]');
    return;
  }
  const profils = fichiers.map(profilVocal);
  console.log('brillance = haut medium (2-6 kHz), corps = 150-800 Hz, fond = sous 150 Hz');
  console.log('tous en dB relatifs au niveau global du fichier\n');
  console.table(profils);

  if (profils.length > 1) {
    console.log('\ndistances deux a deux (sous 2.0, les voix risquent de se confondre) :');
    for (let i = 0; i < profils.length; i += 1) {
      for (let j = i + 1; j < profils.length; j += 1) {
        const d = distance(profils[i], profils[j]);
        console.log(`  ${profils[i].fichier} <-> ${profils[j].fichier} : ${d}${d < 2 ? '  <-- trop proches' : ''}`);
      }
    }
  }
}

if (require.main === module) main();

module.exports = { profilVocal, distance };

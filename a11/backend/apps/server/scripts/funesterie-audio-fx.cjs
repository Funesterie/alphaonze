'use strict';

/**
 * Funesterie Audio FX — chaîne de production audible + invocations + sceau D40.
 *
 * La librairie audio Funesterie contenait jusqu'ici deux familles disjointes:
 *   - `lib/sfx-engine.cjs`      : 15 cues 8-bit (22 kHz mono) déclenchés par balises texte
 *   - `src/audio/double-harmonic-*` : 8 générations d'un sceau harmonique INAUDIBLE
 * Aucune des deux ne produisait d'effet musical perceptible sur un morceau.
 *
 * Ce script relie les deux et ajoute la couche manquante: des effets réellement audibles.
 *
 * Usage:
 *   node funesterie-audio-fx.cjs --in piste.wav --out piste-fx.mp3 \
 *     --space 0.4 --width 0.3 --glue 0.5 --air 0.3 \
 *     --invoke bankai@0 --invoke void@-3 --seal blend
 *
 *   node funesterie-audio-fx.cjs --list
 *
 * Un temps d'invocation négatif se compte depuis la fin du morceau (-3 = 3 s avant la fin).
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { SFX_DEFINITIONS, synthesizeWav, listAvailableSfx } = require('../lib/sfx-engine.cjs');
const { processProtectMixD40, normalizeProfile } = require('../src/audio/double-harmonic-d40.cjs');

const SFX_SAMPLE_RATE = 22050;

function resolveFfmpegBin() {
  return String(process.env.A11_DH_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
}

function resolveFfprobeBin() {
  const explicit = String(process.env.A11_DH_FFPROBE_BIN || process.env.FFPROBE_BIN || '').trim();
  if (explicit) return explicit;
  const ffmpeg = resolveFfmpegBin();
  const base = path.basename(ffmpeg);
  if (/^ffmpeg(?:\.exe)?$/i.test(base)) {
    return path.join(path.dirname(ffmpeg), base.replace(/^ffmpeg/i, 'ffprobe'));
  }
  return 'ffprobe';
}

function execFileAsync(bin, args, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(`${path.basename(bin)}_failed: ${String(stderr || error.message).slice(0, 600)}`);
        return reject(err);
      }
      return resolve({ stdout, stderr });
    });
  });
}

/**
 * Niveau moyen en dB. Sert à garantir qu'un morceau traité ne ressorte pas plus faible
 * que la source — les étages de réverbération font perdre plusieurs dB si on ne rattrape pas.
 */
async function measureMeanVolumeDb(filePath) {
  const { stderr } = await execFileAsync(resolveFfmpegBin(), [
    '-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const match = String(stderr || '').match(/mean_volume:\s*(-?[\d.]+) dB/);
  return match ? Number(match[1]) : null;
}

async function probeDurationSeconds(filePath) {
  const { stdout } = await execFileAsync(resolveFfprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ]);
  const value = Number(String(stdout).trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function numberText(value, digits = 4) {
  return Number(value).toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

// ─── Effets audibles ──────────────────────────────────────────────────────────

/**
 * Construit la chaîne d'effets réellement perceptibles.
 * Chaque paramètre est neutre à 0 — un morceau passé avec tout à 0 ressort inchangé
 * (hors normalisation de format), ce qui rend l'outil sûr à essayer.
 */
function buildAudibleChain({ space = 0, width = 0, glue = 0, air = 0, drive = 0 } = {}) {
  const steps = ['aformat=sample_fmts=fltp:channel_layouts=stereo', 'aresample=44100'];

  if (glue > 0) {
    const ratio = 1.5 + glue * 4;          // 1.5 → 5.5
    const makeup = 1 + glue * 0.8;         // 1 → 1.8
    steps.push(`acompressor=threshold=-18dB:ratio=${numberText(ratio, 2)}:attack=20:release=250:makeup=${numberText(makeup, 2)}`);
  }

  if (drive > 0) {
    // Saturation douce: pousse puis rattrape, sans écraser.
    steps.push(`volume=${numberText(1 + drive * 0.9, 3)}`);
    steps.push(`alimiter=limit=${numberText(0.95 - drive * 0.1, 3)}:level=false`);
  }

  if (air > 0) {
    steps.push(`treble=g=${numberText(air * 6, 2)}:f=8000:width_type=q:w=0.7`);
  }

  if (space > 0) {
    // Réverbération courte par échos multiples — donne de la profondeur sans noyer.
    const decays = [0.35, 0.24, 0.16].map((d) => numberText(d * space, 3)).join(':');
    steps.push(`aecho=0.8:0.88:37:${decays.split(':')[0]}`);
    steps.push(`aecho=0.8:0.88:113:${decays.split(':')[1]}`);
  }

  if (width > 0) {
    steps.push(`extrastereo=m=${numberText(1 + width * 1.4, 3)}`);
  }

  steps.push('alimiter=limit=0.97');
  return steps.join(',');
}

// ─── Invocations ──────────────────────────────────────────────────────────────

/**
 * Rend un SFX 8-bit (22 kHz mono) en couche musicale exploitable:
 * 44.1 kHz stéréo, adouci et spatialisé pour cohabiter avec un mix.
 */
async function renderInvocationLayer(name, workDir, { gain = 1, space = 0.5 } = {}) {
  const notes = SFX_DEFINITIONS[name];
  if (!notes) throw new Error(`invocation_inconnue: ${name}`);

  const rawPath = path.join(workDir, `sfx-${name}-raw.wav`);
  await fsp.writeFile(rawPath, synthesizeWav(notes));

  const outPath = path.join(workDir, `sfx-${name}-layer.wav`);
  const chain = [
    `aresample=44100`,
    // Adoucit l'agressivité carrée du 8-bit pour qu'il se pose dans un mix.
    `lowpass=f=${numberText(9000 + space * 3000, 0)}`,
    `highpass=f=90`,
    `aecho=0.8:0.9:60:${numberText(0.3 * space, 3)}`,
    `volume=${numberText(gain, 3)}`,
    `pan=stereo|c0=c0|c1=c0`,
    `aformat=sample_fmts=fltp:channel_layouts=stereo`,
  ].join(',');

  await execFileAsync(resolveFfmpegBin(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', rawPath, '-filter:a', chain, '-ar', '44100', '-ac', '2', outPath,
  ]);
  return outPath;
}

function parseInvocation(spec) {
  const match = String(spec || '').match(/^([a-z0-9_]+)(?:@(-?[\d.]+))?$/i);
  if (!match) throw new Error(`invocation_malformee: "${spec}" (attendu: nom ou nom@secondes)`);
  return { name: match[1].toLowerCase(), at: match[2] === undefined ? 0 : Number(match[2]) };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

async function processTrack(options) {
  const {
    inputPath, outputPath,
    space = 0, width = 0, glue = 0, air = 0, drive = 0,
    invocations = [], invokeGain = 0.5,
    seal = 'blend', sealIntensity,
  } = options;

  if (!fs.existsSync(inputPath)) throw new Error(`introuvable: ${inputPath}`);
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'funesterie-fx-'));
  const report = { input: inputPath, output: outputPath, invocations: [], seal: null };

  try {
    const duration = await probeDurationSeconds(inputPath);
    report.durationSeconds = duration;

    // 1. Couches d'invocation
    const layers = [];
    for (const spec of invocations) {
      const { name, at } = parseInvocation(spec);
      const layerPath = await renderInvocationLayer(name, workDir, { gain: invokeGain, space: Math.max(space, 0.4) });
      // Un temps négatif se compte depuis la fin.
      const absolute = at < 0 ? Math.max(0, duration + at) : at;
      layers.push({ name, path: layerPath, atSeconds: absolute });
      report.invocations.push({ name, atSeconds: Number(absolute.toFixed(3)) });
    }

    // 2. Effets audibles + mixage des invocations, en une passe
    const fxPath = path.join(workDir, 'fx.wav');
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath];
    for (const layer of layers) args.push('-i', layer.path);

    const chain = buildAudibleChain({ space, width, glue, air, drive });
    const parts = [`[0:a]${chain}[base]`];
    layers.forEach((layer, index) => {
      const ms = Math.round(layer.atSeconds * 1000);
      parts.push(`[${index + 1}:a]adelay=${ms}|${ms}[inv${index}]`);
    });

    if (layers.length) {
      const inputs = ['[base]', ...layers.map((_, i) => `[inv${i}]`)].join('');
      const weights = ['1', ...layers.map(() => '1')].join(' ');
      parts.push(`${inputs}amix=inputs=${layers.length + 1}:weights='${weights}':normalize=0:duration=first,alimiter=limit=0.97[out]`);
    } else {
      parts.push('[base]anull[out]');
    }

    args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', fxPath);
    await execFileAsync(resolveFfmpegBin(), args);

    // 3. Rattrapage de niveau: on réaligne sur la source pour ne pas rendre un master plus faible.
    let stagePath = fxPath;
    const sourceDb = await measureMeanVolumeDb(inputPath);
    const processedDb = await measureMeanVolumeDb(fxPath);
    if (sourceDb !== null && processedDb !== null) {
      const makeupDb = sourceDb - processedDb;
      report.loudness = {
        sourceDb,
        processedDb,
        makeupDb: Number(makeupDb.toFixed(2)),
        applied: Math.abs(makeupDb) > 0.3,
      };
      if (Math.abs(makeupDb) > 0.3) {
        stagePath = path.join(workDir, 'leveled.wav');
        await execFileAsync(resolveFfmpegBin(), [
          '-y', '-hide_banner', '-loglevel', 'error', '-i', fxPath,
          '-af', `volume=${numberText(makeupDb, 2)}dB,alimiter=limit=0.97`,
          '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', stagePath,
        ]);
      }
    }

    // 4. Sceau D40 — on réutilise le module canonique du projet, pas une réimplémentation.
    if (seal && seal !== 'off') {
      report.seal = await processProtectMixD40({
        inputPath: stagePath,
        outputPath,
        profile: normalizeProfile(seal),
        intensity: sealIntensity,
      });
    } else {
      await execFileAsync(resolveFfmpegBin(), [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', stagePath,
        ...(path.extname(outputPath).toLowerCase() === '.mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : []),
        '-ar', '44100', '-ac', '2', outputPath,
      ]);
    }

    report.bytes = fs.statSync(outputPath).size;
    return report;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { invocations: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--in': out.inputPath = next(); break;
      case '--out': out.outputPath = next(); break;
      case '--space': out.space = clamp01(next()); break;
      case '--width': out.width = clamp01(next()); break;
      case '--glue': out.glue = clamp01(next()); break;
      case '--air': out.air = clamp01(next()); break;
      case '--drive': out.drive = clamp01(next()); break;
      case '--invoke': out.invocations.push(next()); break;
      case '--invoke-gain': out.invokeGain = clamp01(next()); break;
      case '--seal': out.seal = next(); break;
      case '--seal-intensity': out.sealIntensity = Number(next()); break;
      case '--list': out.list = true; break;
      case '--help': case '-h': out.help = true; break;
      default: break;
    }
  }
  return out;
}

const HELP = `
Funesterie Audio FX

  --in <fichier>          source
  --out <fichier>         destination (.wav .mp3 .flac ...)

  Effets audibles (0 = neutre, 1 = maximum):
  --space <0-1>           profondeur / réverbération
  --width <0-1>           largeur stéréo
  --glue <0-1>            compression de cohésion
  --air <0-1>             brillance
  --drive <0-1>           saturation douce

  Invocations:
  --invoke <nom[@sec]>    pose une invocation (répétable). Temps négatif = depuis la fin.
  --invoke-gain <0-1>     niveau des invocations (défaut 0.5)

  Sceau harmonique (inaudible, protection):
  --seal <profil>         blend | prime3 | prime11 | off   (défaut blend)
  --seal-intensity <n>    0.888 à 1.125

  --list                  liste les invocations disponibles
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { console.log(HELP); return; }
  if (opts.list) {
    console.log('Invocations disponibles:\n');
    for (const name of listAvailableSfx()) {
      const noteCount = SFX_DEFINITIONS[name].length;
      const seconds = SFX_DEFINITIONS[name].reduce((sum, n) => sum + Number(n.duration || 0), 0);
      console.log(`  ${name.padEnd(18)} ${String(noteCount).padStart(2)} notes  ${seconds.toFixed(2)}s`);
    }
    return;
  }
  if (!opts.inputPath || !opts.outputPath) { console.log(HELP); process.exitCode = 1; return; }

  const report = await processTrack(opts);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERREUR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { processTrack, buildAudibleChain, renderInvocationLayer, parseInvocation };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_SOURCE = 'C:\\Users\\Djeff\\Documents\\Audacity\\pignon.wav';
const SERVER_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = path.resolve(SERVER_ROOT, '..', '..');
const DEFAULT_OUT_DIR = path.join(BACKEND_ROOT, 'public', 'tts');
const DEFAULT_VARIANT = 'raw-low';

const VARIANTS = Object.freeze({
  subtle: Object.freeze({
    filename: 'djeff-pignon-dh-subtle.wav',
    highPitch: 1.498307,
    lowPitch: 0.749154,
    weights: '1 0.040 0.030',
    post: 'acompressor=threshold=-18dB:ratio=2.0:attack=4:release=100:makeup=1.5,loudnorm=I=-16:TP=-1.4:LRA=9',
  }),
  presence: Object.freeze({
    filename: 'djeff-pignon-dh-presence.wav',
    highPitch: 1.334840,
    lowPitch: 0.793701,
    weights: '1 0.055 0.040',
    post: 'acompressor=threshold=-18dB:ratio=2.4:attack=4:release=110:makeup=2,loudnorm=I=-15:TP=-1.3:LRA=8',
  }),
  'raw-low': Object.freeze({
    filename: 'djeff-pignon-dh-raw-low.wav',
    highPitch: 1.259921,
    lowPitch: 0.840896,
    weights: '1 0.025 0.020',
    post: 'acompressor=threshold=-16dB:ratio=1.8:attack=6:release=140:makeup=1,loudnorm=I=-16:TP=-1.5:LRA=10',
  }),
});

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function hasFlag(args, name) {
  return args.includes(name);
}

function sanitizeFilename(value = '', fallback = 'djeff-double-harmonic.wav') {
  const basename = path.basename(String(value || '').trim())
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return basename || fallback;
}

function resolveFfmpegBin() {
  return String(process.env.A11_AUDIO_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
}

function normalizeVariantName(value = '') {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'raw' || key === 'low' || key === 'rime' || key === 'rimes' || key === 'rhyme') return 'raw-low';
  return key;
}

function buildDoubleHarmonicFilter(variant) {
  const highPitch = Number(variant.highPitch || 1);
  const lowPitch = Number(variant.lowPitch || 1);
  const weights = String(variant.weights || '1 0.04 0.03').trim();
  const post = String(variant.post || 'loudnorm=I=-16:TP=-1.4:LRA=9').trim();
  return [
    '[0:a]aformat=channel_layouts=mono,highpass=f=70,lowpass=f=13500,afftdn=nf=-24,asplit=3[dry][h1][h2]',
    `[h1]rubberband=pitch=${highPitch},highpass=f=1200,lowpass=f=9000,volume=1[h1o]`,
    `[h2]rubberband=pitch=${lowPitch},highpass=f=90,lowpass=f=2600,volume=1[h2o]`,
    `[dry][h1o][h2o]amix=inputs=3:weights='${weights}':normalize=0,${post},alimiter=limit=0.96[out]`,
  ].join(';');
}

function runFfmpeg({ ffmpegBin, sourcePath, outputPath, variant }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-filter_complex',
      buildDoubleHarmonicFilter(variant),
      '-map',
      '[out]',
      '-ac',
      '1',
      '-ar',
      '44100',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on?.('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return resolve();
      return reject(new Error(`double_harmonic_ffmpeg_failed:${code}:${stderr.slice(0, 1000)}`));
    });
  });
}

async function renderVariant(name, options = {}) {
  const variantName = normalizeVariantName(name || DEFAULT_VARIANT);
  const variant = VARIANTS[variantName];
  if (!variant) throw new Error(`unknown_double_harmonic_variant:${name}`);
  const sourcePath = path.resolve(options.sourcePath || DEFAULT_SOURCE);
  const outDir = path.resolve(options.outDir || DEFAULT_OUT_DIR);
  if (!fs.existsSync(sourcePath)) throw new Error(`source_audio_missing:${sourcePath}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outputName = options.outputName
    ? sanitizeFilename(options.outputName, variant.filename)
    : variant.filename;
  const outputPath = path.join(outDir, outputName);
  await runFfmpeg({
    ffmpegBin: options.ffmpegBin || resolveFfmpegBin(),
    sourcePath,
    outputPath,
    variant,
  });
  return {
    ok: true,
    variant: variantName,
    sourcePath,
    outputPath,
    bytes: fs.statSync(outputPath).size,
    url: `/api/tts/out/${path.basename(outputPath)}`,
    method: 'source-centered-double-harmonic-sync-v1',
  };
}

async function main(argv = process.argv.slice(2)) {
  const sourcePath = valueAfter(argv, '--source') || DEFAULT_SOURCE;
  const outDir = valueAfter(argv, '--out-dir') || DEFAULT_OUT_DIR;
  const outputName = valueAfter(argv, '--output-file') || valueAfter(argv, '--output-name');
  const requested = valueAfter(argv, '--variant') || (hasFlag(argv, '--all') ? 'all' : DEFAULT_VARIANT);
  const names = requested === 'all'
    ? Object.keys(VARIANTS)
    : requested.split(',').map((entry) => normalizeVariantName(entry)).filter(Boolean);
  const results = [];
  for (const name of names) {
    results.push(await renderVariant(name, { sourcePath, outDir, outputName: names.length === 1 ? outputName : '' }));
  }
  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_VARIANT,
  VARIANTS,
  buildDoubleHarmonicFilter,
  normalizeVariantName,
  renderVariant,
  sanitizeFilename,
};

'use strict';

const { execFile } = require('node:child_process');

const D40_SOURCE_DENSITY = 0.292;
const D40_SOURCE_N = 40.0005;
const D40_TARGET_N = 40;
const CANON_MG = 0.000055193627332139616;
const MICROGAP_HALF_PLUS_CANON_MG = ((40000 * CANON_MG) / 2) + CANON_MG;
const BALANCE_AUTO = 0.8888888888888888;

const RAW_LOW_PRESET = Object.freeze({
  highPitch: 1.259921,
  lowPitch: 0.840896,
  highWeight: 0.025,
  lowWeight: 0.02,
});

const D40_PROFILES = Object.freeze({
  prime3: Object.freeze([0.7747, 0.8466, 0.8991, 0.9177, 0.9056]),
  prime11: Object.freeze([1.0085, 1.0069, 0.9937, 0.9539, 0.9146]),
  blend: Object.freeze([0.8916, 0.9268, 0.9464, 0.9358, 0.9101]),
});

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeProfile(value = 'blend') {
  const key = String(value || 'blend').trim().toLowerCase();
  if (key === '3' || key === 'prime-3' || key === 'djeff') return 'prime3';
  if (key === '11' || key === 'prime-11' || key === 'duo') return 'prime11';
  if (Object.prototype.hasOwnProperty.call(D40_PROFILES, key)) return key;
  return 'blend';
}

function resolveD40Density(options = {}) {
  const sourceDensity = clampNumber(options.sourceDensity, 0.001, 10, D40_SOURCE_DENSITY);
  const sourceN = clampNumber(options.sourceN, 0.001, 1000, D40_SOURCE_N);
  const targetN = clampNumber(options.targetN, 0.001, 1000, D40_TARGET_N);
  const value = sourceDensity * targetN / sourceN;
  return {
    sourceDensity,
    sourceN,
    targetN,
    value,
    correction: value / sourceDensity,
    gap: sourceDensity - value,
    perN: sourceDensity / sourceN,
  };
}

function buildD40EnvelopeExpression(options = {}) {
  const profile = normalizeProfile(options.profile || options.d40Profile);
  const anchors = D40_PROFILES[profile] || D40_PROFILES.blend;
  const period = clampNumber(options.periodSeconds || options.d40Seconds, 0.25, 30, 4);
  const wet = clampNumber(options.wet || options.wetScale, 0.05, 2, 1);
  const density = resolveD40Density(options);
  const step = period / (anchors.length - 1);
  const x = `mod(t\\,${numberText(period, 6)})`;
  let expression = numberText(anchors[anchors.length - 1]);

  for (let index = anchors.length - 2; index >= 0; index -= 1) {
    const start = index * step;
    const end = (index + 1) * step;
    const a = anchors[index];
    const slope = anchors[index + 1] - a;
    const segment = `${numberText(a)}+(${numberText(slope)})*((${x}-${numberText(start, 6)})/${numberText(step, 6)})`;
    expression = `if(lt(${x}\\,${numberText(end, 6)})\\,${segment}\\,${expression})`;
  }

  return {
    profile,
    anchors,
    period,
    density,
    expression: `${numberText(wet * density.correction)}*(${expression})`,
  };
}

function buildProtectMixD40Filter(options = {}) {
  const envelope = buildD40EnvelopeExpression(options);
  const mg = clampNumber(options.mg, 0.25, 2, MICROGAP_HALF_PLUS_CANON_MG);
  const balance = clampNumber(options.balance, 0.1, 2, BALANCE_AUTO);
  const high = RAW_LOW_PRESET.highWeight * mg * balance;
  const low = RAW_LOW_PRESET.lowWeight * mg / balance;
  const highVolume = `${numberText(high)}*(${envelope.expression})`;
  const lowVolume = `${numberText(low)}*(${envelope.expression})`;

  return {
    envelope,
    mg,
    balance,
    highWeight: high,
    lowWeight: low,
    filter: [
      '[0:a]asplit=2[full][work]',
      '[full]aresample=44100,aformat=channel_layouts=stereo[dryfull]',
      '[work]aformat=channel_layouts=mono,highpass=f=120,lowpass=f=6500,afftdn=nf=-28,asplit=2[h1][h2]',
      `[h1]rubberband=pitch=${RAW_LOW_PRESET.highPitch},highpass=f=1200,lowpass=f=10000,volume='${highVolume}':eval=frame,pan=stereo|c0=c0|c1=c0[h1o]`,
      `[h2]rubberband=pitch=${RAW_LOW_PRESET.lowPitch},highpass=f=90,lowpass=f=2600,volume='${lowVolume}':eval=frame,pan=stereo|c0=c0|c1=c0[h2o]`,
      '[dryfull][h1o][h2o]amix=inputs=3:weights=\'1 1 1\':normalize=0,alimiter=limit=0.97[out]',
    ].join(';'),
  };
}

function runFfmpeg(args, options = {}) {
  const bin = String(options.ffmpegPath || process.env.A11_DH_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      windowsHide: true,
      timeout: Number(options.timeoutMs || process.env.A11_DH_FFMPEG_TIMEOUT_MS || 180_000),
      maxBuffer: Number(options.maxBuffer || 1024 * 1024),
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(`ffmpeg_failed:${error.message}`);
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      return resolve({ stdout, stderr });
    });
  });
}

async function processProtectMixD40({ inputPath, outputPath, profile = 'blend', timeoutMs } = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');
  const built = buildProtectMixD40Filter({ profile });
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-filter_complex',
    built.filter,
    '-map',
    '[out]',
    '-ac',
    '2',
    '-ar',
    '44100',
    outputPath,
  ];
  await runFfmpeg(args, { timeoutMs });
  return {
    method: 'dry-master-plus-adaptive-d40-harmonic-overlay-v1',
    profile: built.envelope.profile,
    mg: built.mg,
    balance: built.balance,
    d40: built.envelope.density,
    weights: {
      dry: 1,
      high: built.highWeight,
      low: built.lowWeight,
    },
  };
}

module.exports = {
  BALANCE_AUTO,
  CANON_MG,
  D40_PROFILES,
  D40_SOURCE_DENSITY,
  D40_SOURCE_N,
  D40_TARGET_N,
  MICROGAP_HALF_PLUS_CANON_MG,
  buildD40EnvelopeExpression,
  buildProtectMixD40Filter,
  processProtectMixD40,
  resolveD40Density,
};

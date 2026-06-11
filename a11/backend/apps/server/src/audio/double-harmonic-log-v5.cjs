'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  BALANCE_AUTO,
  RAW_LOW_PRESET,
  buildOutputCodecArgs,
  runFfmpeg,
  sampleD40EnvelopeAt,
} = require('./double-harmonic-d40.cjs');
const {
  GRAIN_SPECTRAL_HIGH,
  GRAIN_SPECTRAL_LOW,
  analyzeDynamicWeightV3,
  buildDynamicAutomationSamples,
  probeAudioDurationSeconds,
  writeFloat32MonoWav,
} = require('./double-harmonic-dynamic-v3.cjs');

const LOG_D40_V5_SCHEMA = 'funesterie.audio.double-harmonic-log-d40.v5';
const DEFAULT_V5_FRAME_MS = 250;
const DEFAULT_V5_MAX_SEGMENTS = 2400;
const DEFAULT_V5_CURVE = 'grain-6d7d8d';
const DEFAULT_V5_CURVE_AMOUNT = 0.3;
const DEFAULT_V5_ATTACK = 0.78;
const DEFAULT_V5_RELEASE = 0.32;
const DEFAULT_V5_MIN_DB_SPAN = 8;
const DEFAULT_V5_WEIGHT_SCALE = 2;
const MIN_V5_WEIGHT_SCALE = 0.5;
const MAX_V5_WEIGHT_SCALE = 3;

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function buildLogD40EnvelopePath(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v5')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.v5-envelope.wav`);
}

function resolveV5WeightScale(value) {
  return clampNumber(value, MIN_V5_WEIGHT_SCALE, MAX_V5_WEIGHT_SCALE, DEFAULT_V5_WEIGHT_SCALE);
}

function resolveLogDimensionPairV5() {
  const twoD = (2 + (2 * GRAIN_SPECTRAL_LOW)) / 2;
  const threeD = ((3 * GRAIN_SPECTRAL_HIGH * twoD) + 2) / 2;
  const lowPitch = 1 / twoD;
  const highPitch = Math.log(threeD ** twoD) / twoD;
  return {
    twoD,
    threeD,
    lowPitch,
    highPitch,
    highFormula: 'ln(3D^2D)/2D',
    highEquivalent: 'ln(3D)',
    lowFormula: '1/2D',
  };
}

function buildLogD40FilterV5({
  profile = 'blend',
  cycleSeconds,
  weightScale,
} = {}) {
  const envelopeProbe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  const highBaseWeight = RAW_LOW_PRESET.highWeight * AUDIO_PIVOT_GAIN_FACTOR;
  const lowBaseWeight = RAW_LOW_PRESET.lowWeight * AUDIO_PIVOT_GAIN_FACTOR;
  const resolvedWeightScale = resolveV5WeightScale(weightScale);
  const highWeight = highBaseWeight * resolvedWeightScale;
  const lowWeight = lowBaseWeight * resolvedWeightScale;
  const dimensions = resolveLogDimensionPairV5();
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';

  return {
    schema: LOG_D40_V5_SCHEMA,
    method: 'dry-first-log-d40-harmonic-overlay-v5',
    state: 'v5-release-plan',
    envelope: {
      mode: 'wav-envelope',
      profile: envelopeProbe.profile,
      period: envelopeProbe.period,
      density: envelopeProbe.density,
    },
    mg: AUDIO_PIVOT_GAIN_FACTOR,
    balance: BALANCE_AUTO,
    preset: 'log-3d-x2',
    highBaseWeight,
    lowBaseWeight,
    highWeight,
    lowWeight,
    weightScale: resolvedWeightScale,
    dimensions,
    highPitch: dimensions.highPitch,
    lowPitch: dimensions.lowPitch,
    safety: {
      noEqFilters: true,
      noNoiseReduction: true,
      noLimiter: true,
      noFinalGain: true,
      sourceFormatOutput: true,
      publicMaxWeightScale: MAX_V5_WEIGHT_SCALE,
    },
    filter: [
      '[0:a]asplit=3[dry][h][l]',
      '[1:a]asplit=2[eh][el]',
      `[h]rubberband=pitch=${numberText(dimensions.highPitch)}:${rubberbandOptions},volume=${numberText(highWeight)}:eval=frame[hb]`,
      `[l]rubberband=pitch=${numberText(dimensions.lowPitch)}:${rubberbandOptions},volume=${numberText(lowWeight)}:eval=frame[lb]`,
      '[hb][eh]amultiply[ho]',
      '[lb][el]amultiply[lo]',
      "[dry][ho][lo]amix=inputs=3:weights='1 1 1':normalize=0[out]",
    ].join(';'),
  };
}

function buildLogD40ArgsV5({
  inputPath,
  outputPath,
  profile = 'blend',
  cycleSeconds,
  envelopePath,
  weightScale,
} = {}) {
  if (!envelopePath) throw new Error('missing_envelope_path');
  const built = buildLogD40FilterV5({
    profile,
    cycleSeconds,
    weightScale,
  });
  return {
    built,
    args: [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-i',
      envelopePath,
      '-filter_complex',
      built.filter,
      '-map',
      '[out]',
      ...buildOutputCodecArgs(outputPath),
      outputPath,
    ],
  };
}

async function processLogD40V5({
  inputPath,
  outputPath,
  profile = 'blend',
  timeoutMs,
  analysisOptions = {},
} = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');

  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const analysisMaxSeconds = analysisOptions.maxSeconds
    || (probedDuration ? Math.min(900, probedDuration + 0.5) : undefined);
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: analysisOptions.frameMs || DEFAULT_V5_FRAME_MS,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments || DEFAULT_V5_MAX_SEGMENTS,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve || DEFAULT_V5_CURVE,
    curveAmount: analysisOptions.curveAmount ?? DEFAULT_V5_CURVE_AMOUNT,
    attack: analysisOptions.attack ?? DEFAULT_V5_ATTACK,
    release: analysisOptions.release ?? DEFAULT_V5_RELEASE,
    minDbSpan: analysisOptions.minDbSpan || DEFAULT_V5_MIN_DB_SPAN,
    swapPitchGrain: true,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
  const durationSeconds = Math.max(
    0.5,
    Number(probedDuration) || 0,
    Number(analysis.summary?.durationSeconds) || 0
  ) + 0.25;
  const automation = buildDynamicAutomationSamples({
    analysis,
    profile,
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
  });
  const envelopePath = buildLogD40EnvelopePath(outputPath);
  writeFloat32MonoWav(envelopePath, automation.samples, automation.sampleRate);

  let built;
  try {
    const planned = buildLogD40ArgsV5({
      inputPath,
      outputPath,
      profile,
      cycleSeconds: analysisOptions.cycleSeconds,
      envelopePath,
      weightScale: analysisOptions.weightScale || analysisOptions.intensity || analysisOptions.harmonicIntensity,
    });
    built = planned.built;
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V5_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePath, { force: true });
    }
  }

  return {
    method: built.method,
    state: 'v5-release',
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: 'd40-log',
    d40: built.envelope.density,
    dynamic: {
      schema: analysis.schema,
      frameMs: analysis.frameMs,
      controls: analysis.controls,
      summary: analysis.summary,
      automation: {
        mode: automation.mode,
        sampleRate: automation.sampleRate,
        durationSeconds: automation.durationSeconds,
        sampleCount: automation.sampleCount,
        summary: automation.summary,
      },
    },
    weights: {
      dry: 1,
      highBase: built.highBaseWeight,
      lowBase: built.lowBaseWeight,
      high: built.highWeight,
      low: built.lowWeight,
      ratio: built.lowWeight / built.highWeight,
      weightScale: built.weightScale,
      dynamicMin: analysis.summary.weightMin,
      dynamicMax: analysis.summary.weightMax,
      dynamicMean: analysis.summary.weightMean,
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
      dimensions: built.dimensions,
      finalGainDb: 0,
      finalLimiter: false,
      filters: 'none',
    },
    safety: built.safety,
  };
}

function buildLogD40PlanV5(options = {}) {
  const built = buildLogD40FilterV5({
    profile: options.profile || 'blend',
    cycleSeconds: options.cycleSeconds,
    weightScale: options.weightScale || options.intensity || options.harmonicIntensity,
  });
  return {
    schema: LOG_D40_V5_SCHEMA,
    method: built.method,
    state: built.state,
    profile: built.envelope.profile,
    preset: built.preset,
    d40: built.envelope.density,
    weights: {
      dry: 1,
      highBase: built.highBaseWeight,
      lowBase: built.lowBaseWeight,
      high: built.highWeight,
      low: built.lowWeight,
      ratio: built.lowWeight / built.highWeight,
      weightScale: built.weightScale,
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
      dimensions: built.dimensions,
    },
    defaults: {
      frameMs: DEFAULT_V5_FRAME_MS,
      maxSegments: DEFAULT_V5_MAX_SEGMENTS,
      curve: DEFAULT_V5_CURVE,
      curveAmount: DEFAULT_V5_CURVE_AMOUNT,
      attack: DEFAULT_V5_ATTACK,
      release: DEFAULT_V5_RELEASE,
      minDbSpan: DEFAULT_V5_MIN_DB_SPAN,
      weightScale: {
        default: DEFAULT_V5_WEIGHT_SCALE,
        min: MIN_V5_WEIGHT_SCALE,
        max: MAX_V5_WEIGHT_SCALE,
      },
    },
    safety: built.safety,
  };
}

module.exports = {
  DEFAULT_V5_ATTACK,
  DEFAULT_V5_CURVE,
  DEFAULT_V5_CURVE_AMOUNT,
  DEFAULT_V5_FRAME_MS,
  DEFAULT_V5_MAX_SEGMENTS,
  DEFAULT_V5_MIN_DB_SPAN,
  DEFAULT_V5_RELEASE,
  DEFAULT_V5_WEIGHT_SCALE,
  LOG_D40_V5_SCHEMA,
  MAX_V5_WEIGHT_SCALE,
  MIN_V5_WEIGHT_SCALE,
  buildLogD40ArgsV5,
  buildLogD40FilterV5,
  buildLogD40PlanV5,
  processLogD40V5,
  resolveLogDimensionPairV5,
  resolveV5WeightScale,
};

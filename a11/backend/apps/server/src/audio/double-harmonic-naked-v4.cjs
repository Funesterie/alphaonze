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

const NAKED_D40_V4_SCHEMA = 'funesterie.audio.double-harmonic-naked-d40.v4';
const DEFAULT_V4_FRAME_MS = 250;
const DEFAULT_V4_MAX_SEGMENTS = 2400;
const DEFAULT_V4_CURVE = 'grain-6d7d8d';
const DEFAULT_V4_CURVE_AMOUNT = 0.3;
const DEFAULT_V4_ATTACK = 0.78;
const DEFAULT_V4_RELEASE = 0.32;
const DEFAULT_V4_MIN_DB_SPAN = 8;
const DEFAULT_V4_LOW_GRAIN_MULTIPLIER = 1;
const MIN_V4_LOW_GRAIN_MULTIPLIER = 0.25;
const MAX_V4_LOW_GRAIN_MULTIPLIER = 4;

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function buildNakedD40EnvelopePath(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v4')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.v4-envelope.wav`);
}

function resolveLowGrainMultiplier(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_V4_LOW_GRAIN_MULTIPLIER;
  return Math.max(MIN_V4_LOW_GRAIN_MULTIPLIER, Math.min(MAX_V4_LOW_GRAIN_MULTIPLIER, numeric));
}

function buildNakedD40FilterV4({ profile = 'blend', cycleSeconds, lowGrainMultiplier } = {}) {
  const envelopeProbe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  const highBaseWeight = RAW_LOW_PRESET.highWeight * AUDIO_PIVOT_GAIN_FACTOR;
  const lowBaseWeight = RAW_LOW_PRESET.lowWeight * AUDIO_PIVOT_GAIN_FACTOR;
  const resolvedLowGrainMultiplier = resolveLowGrainMultiplier(lowGrainMultiplier);
  const highPitch = GRAIN_SPECTRAL_HIGH;
  const lowPitch = GRAIN_SPECTRAL_LOW * resolvedLowGrainMultiplier;

  return {
    schema: NAKED_D40_V4_SCHEMA,
    method: 'dry-first-naked-d40-harmonic-overlay-v4',
    state: 'v4-release-plan',
    envelope: {
      mode: 'wav-envelope',
      profile: envelopeProbe.profile,
      period: envelopeProbe.period,
      density: envelopeProbe.density,
    },
    mg: AUDIO_PIVOT_GAIN_FACTOR,
    balance: BALANCE_AUTO,
    preset: 'raw-low',
    highBaseWeight,
    lowBaseWeight,
    lowGrainMultiplier: resolvedLowGrainMultiplier,
    highPitch,
    lowPitch,
    safety: {
      noEqFilters: true,
      noNoiseReduction: true,
      noLimiter: true,
      noFinalGain: true,
      sourceFormatOutput: true,
    },
    filter: [
      '[0:a]asplit=3[dry][h][l]',
      '[1:a]asplit=2[eh][el]',
      `[h]rubberband=pitch=${numberText(highPitch)},volume=${numberText(highBaseWeight)}:eval=frame[hb]`,
      `[l]rubberband=pitch=${numberText(lowPitch)},volume=${numberText(lowBaseWeight)}:eval=frame[lb]`,
      '[hb][eh]amultiply[ho]',
      '[lb][el]amultiply[lo]',
      "[dry][ho][lo]amix=inputs=3:weights='1 1 1':normalize=0[out]",
    ].join(';'),
  };
}

function buildNakedD40ArgsV4({ inputPath, outputPath, profile = 'blend', cycleSeconds, envelopePath, lowGrainMultiplier } = {}) {
  if (!envelopePath) throw new Error('missing_envelope_path');
  const built = buildNakedD40FilterV4({ profile, cycleSeconds, lowGrainMultiplier });
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

async function processNakedD40V4({
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
    frameMs: analysisOptions.frameMs || DEFAULT_V4_FRAME_MS,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments || DEFAULT_V4_MAX_SEGMENTS,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve || DEFAULT_V4_CURVE,
    curveAmount: analysisOptions.curveAmount ?? DEFAULT_V4_CURVE_AMOUNT,
    attack: analysisOptions.attack ?? DEFAULT_V4_ATTACK,
    release: analysisOptions.release ?? DEFAULT_V4_RELEASE,
    minDbSpan: analysisOptions.minDbSpan || DEFAULT_V4_MIN_DB_SPAN,
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
  const envelopePath = buildNakedD40EnvelopePath(outputPath);
  writeFloat32MonoWav(envelopePath, automation.samples, automation.sampleRate);

  let built;
  try {
    const planned = buildNakedD40ArgsV4({
      inputPath,
      outputPath,
      profile,
      cycleSeconds: analysisOptions.cycleSeconds,
      envelopePath,
      lowGrainMultiplier: analysisOptions.lowGrainMultiplier,
    });
    built = planned.built;
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V4_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePath, { force: true });
    }
  }

  return {
    method: built.method,
    state: 'v4-release',
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: 'd40',
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
      ratio: built.lowBaseWeight / built.highBaseWeight,
      dynamicMin: analysis.summary.weightMin,
      dynamicMax: analysis.summary.weightMax,
      dynamicMean: analysis.summary.weightMean,
      lowGrainMultiplier: built.lowGrainMultiplier,
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
      finalGainDb: 0,
      finalLimiter: false,
      filters: 'none',
    },
    safety: built.safety,
  };
}

function buildNakedD40PlanV4(options = {}) {
  const built = buildNakedD40FilterV4({
    profile: options.profile || 'blend',
    cycleSeconds: options.cycleSeconds,
    lowGrainMultiplier: options.lowGrainMultiplier,
  });
  return {
    schema: NAKED_D40_V4_SCHEMA,
    method: built.method,
    state: built.state,
    profile: built.envelope.profile,
    preset: built.preset,
    d40: built.envelope.density,
    weights: {
      dry: 1,
      highBase: built.highBaseWeight,
      lowBase: built.lowBaseWeight,
      ratio: built.lowBaseWeight / built.highBaseWeight,
      lowGrainMultiplier: built.lowGrainMultiplier,
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
    },
    defaults: {
      frameMs: DEFAULT_V4_FRAME_MS,
      maxSegments: DEFAULT_V4_MAX_SEGMENTS,
      curve: DEFAULT_V4_CURVE,
      curveAmount: DEFAULT_V4_CURVE_AMOUNT,
      attack: DEFAULT_V4_ATTACK,
      release: DEFAULT_V4_RELEASE,
      minDbSpan: DEFAULT_V4_MIN_DB_SPAN,
    },
    safety: built.safety,
  };
}

module.exports = {
  DEFAULT_V4_ATTACK,
  DEFAULT_V4_CURVE,
  DEFAULT_V4_CURVE_AMOUNT,
  DEFAULT_V4_FRAME_MS,
  DEFAULT_V4_LOW_GRAIN_MULTIPLIER,
  DEFAULT_V4_MAX_SEGMENTS,
  DEFAULT_V4_MIN_DB_SPAN,
  DEFAULT_V4_RELEASE,
  MAX_V4_LOW_GRAIN_MULTIPLIER,
  MIN_V4_LOW_GRAIN_MULTIPLIER,
  NAKED_D40_V4_SCHEMA,
  buildNakedD40ArgsV4,
  buildNakedD40FilterV4,
  buildNakedD40PlanV4,
  processNakedD40V4,
  resolveLowGrainMultiplier,
};

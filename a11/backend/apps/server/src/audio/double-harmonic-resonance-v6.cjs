'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  RAW_LOW_PRESET,
  buildOutputCodecArgs,
  runFfmpeg,
  sampleD40EnvelopeAt,
} = require('./double-harmonic-d40.cjs');
const {
  DEFAULT_SPECTRAL_PIVOT,
  GRAIN_SPECTRAL_HIGH,
  GRAIN_SPECTRAL_LOW,
  analyzeDynamicWeightV3,
  probeAudioDurationSeconds,
  writeFloat32MonoWav,
} = require('./double-harmonic-dynamic-v3.cjs');

const RESONANCE_D40_V6_SCHEMA = 'funesterie.audio.double-harmonic-resonance-d40.v6';
const DEFAULT_V6_FRAME_MS = 250;
const DEFAULT_V6_MAX_SEGMENTS = 2400;
const DEFAULT_V6_CURVE = 'grain-6d7d8d';
const DEFAULT_V6_CURVE_AMOUNT = 0.3;
const DEFAULT_V6_ATTACK = 0.78;
const DEFAULT_V6_RELEASE = 0.32;
const DEFAULT_V6_MIN_DB_SPAN = 8;
const DEFAULT_V6_USER_K = 3;
const MIN_V6_USER_K = 0.1;
const MAX_V6_USER_K = 10;
const DEFAULT_V6_K_CEILING = 10;
const MIN_V6_K_CEILING = 2;
const MAX_V6_K_CEILING = 64;
const V6_RESONANCE_MODE = 'soft-fold';
const V6_TRANSFER_MODE = 'm-over-k-energy-transfer';
const V6_METHOD = 'dry-first-energy-transfer-m-over-k-d40-harmonic-overlay-v6';
const V6_STATE = 'v6-supreme-stable';
const V6_PRESET = 'v6-supreme-m-over-k-k3';

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function buildResonanceD40EnvelopePath(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v6')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.v6-mk-envelope.wav`);
}

function resolveV6UserK(value) {
  return clampNumber(value, MIN_V6_USER_K, MAX_V6_USER_K, DEFAULT_V6_USER_K);
}

function resolveV6KCeiling(value) {
  return clampNumber(value, MIN_V6_K_CEILING, MAX_V6_K_CEILING, DEFAULT_V6_K_CEILING);
}

function resolveResonanceDimensionPairV6() {
  const twoD = (2 + (2 * GRAIN_SPECTRAL_LOW)) / 2;
  const threeD = ((3 * GRAIN_SPECTRAL_HIGH * twoD) + 2) / 2;
  const lowPitch = twoD / 2;
  const highPitch = threeD / 2;
  const ratioHighToLow = Math.log(threeD / twoD);
  return {
    twoD,
    threeD,
    lowPitch,
    highPitch,
    lowFormula: '2D/2',
    highFormula: '3D/2',
    ratioHighToLow,
    ratioFormula: 'ln(3D/2D)',
  };
}

function resolveV6WetCeiling({ baseTotalWeight } = {}) {
  const base = clampNumber(baseTotalWeight, 0.001, 1, 0.045);
  return base;
}

function selectAnalysisFrameAt(analysis = {}, timeSeconds = 0) {
  const frames = Array.isArray(analysis.frames) && analysis.frames.length
    ? analysis.frames
    : [{ endTime: Number.POSITIVE_INFINITY, normalizedEnergy: 0, curvedEnergy: 0 }];
  const time = Math.max(0, Number(timeSeconds) || 0);
  let selected = frames[frames.length - 1];
  for (const frame of frames) {
    if (time < Number(frame.endTime || 0)) {
      selected = frame;
      break;
    }
  }
  return selected;
}

function sampleResonanceMkV6At(analysis = {}, timeSeconds = 0, options = {}) {
  const frame = selectAnalysisFrameAt(analysis, timeSeconds);
  const dimensions = resolveResonanceDimensionPairV6();
  const energy = clampNumber(
    Number(frame.curvedEnergy ?? frame.normalizedEnergy ?? 0),
    0,
    1,
    0
  );
  const userK = resolveV6UserK(options.userK ?? options.resonanceK ?? options.intensity);
  const kCeiling = resolveV6KCeiling(options.kCeiling);
  const pivot = clampNumber(options.spectralPivot, 0.001, 0.999, DEFAULT_SPECTRAL_PIVOT);
  const tension = clampNumber(Math.max(0, energy - pivot) / Math.max(0.001, 1 - pivot), 0, 1, 0);
  const userResonance = Math.log1p(Math.max(0, userK - 1)) / Math.log1p(Math.max(1, kCeiling - 1));
  const measuredK = 1 + tension * userResonance;
  const bassMassM = 1 + (1 - energy) * GRAIN_SPECTRAL_LOW;
  const mk = bassMassM * measuredK;
  const surplus = Math.max(0, mk - 1);
  const mOverK = bassMassM / Math.max(0.000001, measuredK);
  const kOverM = measuredK / Math.max(0.000001, bassMassM);
  const energyTransfer = mOverK;
  const resonanceCap = clampNumber(Math.min(1, energyTransfer), 0, 1, 0);
  const foldedSurplus = surplus * resonanceCap;
  const folded = clampNumber(Math.log1p(foldedSurplus) / Math.log1p(kCeiling - 1), 0, 1, 0);
  return {
    energy,
    tension,
    userResonance,
    measuredK,
    bassMassM,
    mk,
    mOverK,
    kOverM,
    energyTransfer,
    resonanceCap,
    surplus,
    foldedSurplus,
    folded,
    transferMode: V6_TRANSFER_MODE,
    userK,
    kCeiling,
    twoD: dimensions.twoD,
    threeD: dimensions.threeD,
  };
}

function buildResonanceAutomationSamplesV6({
  analysis,
  profile = 'blend',
  cycleSeconds,
  durationSeconds,
  sampleRate = 400,
  userK,
  kCeiling,
} = {}) {
  const resolvedSampleRate = Math.round(clampNumber(sampleRate, 50, 2000, 400));
  const fallbackDuration = Number(analysis?.summary?.durationSeconds || 1) || 1;
  const duration = clampNumber(durationSeconds, 0.05, 7200, fallbackDuration);
  const sampleCount = Math.max(1, Math.ceil(duration * resolvedSampleRate));
  const samples = new Float32Array(sampleCount);
  const foldedValues = [];
  const mkValues = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / resolvedSampleRate;
    const resonance = sampleResonanceMkV6At(analysis, time, { userK, kCeiling });
    const d40 = sampleD40EnvelopeAt(time, { profile, periodSeconds: cycleSeconds });
    const value = d40.gain * resonance.folded;
    samples[index] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    foldedValues.push(resonance.folded);
    mkValues.push(resonance.mk);
  }

  const probe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  return {
    mode: 'wav-envelope',
    sampleRate: resolvedSampleRate,
    durationSeconds: sampleCount / resolvedSampleRate,
    sampleCount,
    samples,
    profile: probe.profile,
    period: probe.period,
    density: probe.density,
    summary: {
      min,
      max,
      mean: sum / sampleCount,
      foldedMin: Math.min(...foldedValues),
      foldedMax: Math.max(...foldedValues),
      foldedMean: mean(foldedValues),
      mkMin: Math.min(...mkValues),
      mkMax: Math.max(...mkValues),
      mkMean: mean(mkValues),
    },
  };
}

function buildResonanceD40FilterV6({
  profile = 'blend',
  cycleSeconds,
  userK,
  kCeiling,
} = {}) {
  const envelopeProbe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  const dimensions = resolveResonanceDimensionPairV6();
  const highBaseWeight = RAW_LOW_PRESET.highWeight * AUDIO_PIVOT_GAIN_FACTOR;
  const lowBaseWeight = RAW_LOW_PRESET.lowWeight * AUDIO_PIVOT_GAIN_FACTOR;
  const baseTotalWeight = highBaseWeight + lowBaseWeight;
  const resolvedUserK = resolveV6UserK(userK);
  const resolvedKCeiling = resolveV6KCeiling(kCeiling);
  const wetCeiling = resolveV6WetCeiling({ baseTotalWeight });
  const highShare = dimensions.ratioHighToLow / (1 + dimensions.ratioHighToLow);
  const lowShare = 1 / (1 + dimensions.ratioHighToLow);
  const highWeight = wetCeiling * highShare;
  const lowWeight = wetCeiling * lowShare;
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';

  return {
    schema: RESONANCE_D40_V6_SCHEMA,
    method: V6_METHOD,
    state: V6_STATE,
    envelope: {
      mode: 'wav-envelope',
      profile: envelopeProbe.profile,
      period: envelopeProbe.period,
      density: envelopeProbe.density,
    },
    mg: AUDIO_PIVOT_GAIN_FACTOR,
    preset: V6_PRESET,
    resonanceMode: V6_RESONANCE_MODE,
    transferMode: V6_TRANSFER_MODE,
    userK: resolvedUserK,
    kCeiling: resolvedKCeiling,
    wetCeiling,
    highBaseWeight,
    lowBaseWeight,
    baseTotalWeight,
    highWeight,
    lowWeight,
    highShare,
    lowShare,
    ratioHighToLow: dimensions.ratioHighToLow,
    dimensions,
    highPitch: dimensions.highPitch,
    lowPitch: dimensions.lowPitch,
    safety: {
      dryFirst: true,
      mgNeverChangedByUserK: true,
      noEqFilters: true,
      noNoiseReduction: true,
      noLimiter: true,
      noFinalGain: true,
      sourceFormatOutput: true,
      publicMaxUserK: MAX_V6_USER_K,
      wetScaleMax: 1,
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

function buildResonanceD40ArgsV6({
  inputPath,
  outputPath,
  profile = 'blend',
  cycleSeconds,
  envelopePath,
  userK,
  kCeiling,
} = {}) {
  if (!envelopePath) throw new Error('missing_envelope_path');
  const built = buildResonanceD40FilterV6({
    profile,
    cycleSeconds,
    userK,
    kCeiling,
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

async function processResonanceD40V6({
  inputPath,
  outputPath,
  profile = 'blend',
  timeoutMs,
  analysisOptions = {},
} = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');

  const userK = resolveV6UserK(
    analysisOptions.userK
    ?? analysisOptions.resonanceK
    ?? analysisOptions.intensity
    ?? analysisOptions.harmonicIntensity
  );
  const kCeiling = resolveV6KCeiling(analysisOptions.kCeiling);
  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const analysisMaxSeconds = analysisOptions.maxSeconds
    || (probedDuration ? Math.min(900, probedDuration + 0.5) : undefined);
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: analysisOptions.frameMs || DEFAULT_V6_FRAME_MS,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments || DEFAULT_V6_MAX_SEGMENTS,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve || DEFAULT_V6_CURVE,
    curveAmount: analysisOptions.curveAmount ?? DEFAULT_V6_CURVE_AMOUNT,
    attack: analysisOptions.attack ?? DEFAULT_V6_ATTACK,
    release: analysisOptions.release ?? DEFAULT_V6_RELEASE,
    minDbSpan: analysisOptions.minDbSpan || DEFAULT_V6_MIN_DB_SPAN,
    swapPitchGrain: true,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
  const durationSeconds = Math.max(
    0.5,
    Number(probedDuration) || 0,
    Number(analysis.summary?.durationSeconds) || 0
  ) + 0.25;
  const automation = buildResonanceAutomationSamplesV6({
    analysis,
    profile,
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
    userK,
    kCeiling,
  });
  const envelopePath = buildResonanceD40EnvelopePath(outputPath);
  writeFloat32MonoWav(envelopePath, automation.samples, automation.sampleRate);

  let built;
  try {
    const planned = buildResonanceD40ArgsV6({
      inputPath,
      outputPath,
      profile,
      cycleSeconds: analysisOptions.cycleSeconds,
      envelopePath,
      userK,
      kCeiling,
    });
    built = planned.built;
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V6_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePath, { force: true });
    }
  }

  return {
    method: built.method,
    state: built.state,
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: 'soft-fold',
    d40: built.envelope.density,
    resonance: {
      userK,
      kCeiling,
      ratioHighToLow: built.ratioHighToLow,
      ratioFormula: built.dimensions.ratioFormula,
      mode: built.resonanceMode,
      wetCeiling: built.wetCeiling,
      highShare: built.highShare,
      lowShare: built.lowShare,
    },
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
      baseTotal: built.baseTotalWeight,
      wetCeiling: built.wetCeiling,
      high: built.highWeight,
      low: built.lowWeight,
      ratio: built.highWeight / built.lowWeight,
      ratioHighToLow: built.ratioHighToLow,
      userK,
      kCeiling,
      dynamicMin: automation.summary.foldedMin,
      dynamicMax: automation.summary.foldedMax,
      dynamicMean: automation.summary.foldedMean,
      mkMin: automation.summary.mkMin,
      mkMax: automation.summary.mkMax,
      mkMean: automation.summary.mkMean,
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

function buildResonanceD40PlanV6(options = {}) {
  const frameMs = clampNumber(options.frameMs, 50, 1000, DEFAULT_V6_FRAME_MS);
  const maxSeconds = clampNumber(options.maxSeconds, 1, 900, 480);
  const dimensions = resolveResonanceDimensionPairV6();
  const userK = resolveV6UserK(options.userK ?? options.resonanceK ?? options.intensity ?? options.harmonicIntensity);
  const kCeiling = resolveV6KCeiling(options.kCeiling);
  const built = buildResonanceD40FilterV6({ userK, kCeiling, profile: options.profile || 'blend' });
  return {
    schema: RESONANCE_D40_V6_SCHEMA,
    method: V6_METHOD,
    state: V6_STATE,
    profile: 'blend',
    preset: V6_PRESET,
    frameMs,
    maxSeconds,
    d40: built.envelope.density,
    dimensions,
    resonance: {
      userK,
      kCeiling,
      formula: 'folded=ln(1+surplus(M*k)*min(1,M/K))/ln(1+kCeiling-1)',
      transfer: 'energyTransfer=M/K; resonanceCap=min(1,M/K)',
      massM: '1+(1-energy)*grainBas',
      measuredK: '1+tension*kResonance',
      mode: V6_RESONANCE_MODE,
      transferMode: V6_TRANSFER_MODE,
      ratioHighToLow: dimensions.ratioHighToLow,
      ratioFormula: dimensions.ratioFormula,
      wetCeiling: built.wetCeiling,
    },
    weights: {
      dry: 1,
      highBase: built.highBaseWeight,
      lowBase: built.lowBaseWeight,
      baseTotal: built.baseTotalWeight,
      wetCeiling: built.wetCeiling,
      high: built.highWeight,
      low: built.lowWeight,
      ratio: built.highWeight / built.lowWeight,
      ratioHighToLow: dimensions.ratioHighToLow,
      highPitch: dimensions.highPitch,
      lowPitch: dimensions.lowPitch,
      dimensions,
    },
    defaults: {
      userK: {
        default: DEFAULT_V6_USER_K,
        min: MIN_V6_USER_K,
        max: MAX_V6_USER_K,
      },
      kCeiling: DEFAULT_V6_K_CEILING,
      frameMs: DEFAULT_V6_FRAME_MS,
      maxSegments: DEFAULT_V6_MAX_SEGMENTS,
      curve: DEFAULT_V6_CURVE,
      curveAmount: DEFAULT_V6_CURVE_AMOUNT,
      attack: DEFAULT_V6_ATTACK,
      release: DEFAULT_V6_RELEASE,
      minDbSpan: DEFAULT_V6_MIN_DB_SPAN,
    },
    safety: built.safety,
  };
}

module.exports = {
  DEFAULT_V6_USER_K,
  MAX_V6_USER_K,
  MIN_V6_USER_K,
  RESONANCE_D40_V6_SCHEMA,
  V6_METHOD,
  V6_PRESET,
  V6_STATE,
  V6_TRANSFER_MODE,
  buildResonanceAutomationSamplesV6,
  buildResonanceD40ArgsV6,
  buildResonanceD40FilterV6,
  buildResonanceD40PlanV6,
  processResonanceD40V6,
  resolveResonanceDimensionPairV6,
  resolveV6KCeiling,
  resolveV6UserK,
  sampleResonanceMkV6At,
};

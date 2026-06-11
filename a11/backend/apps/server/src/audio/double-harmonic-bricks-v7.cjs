'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  D40_SOURCE_N,
  MAX_HARMONIC_INTENSITY,
  MG_PHASE,
  MIN_HARMONIC_INTENSITY,
  TARGET_0005_PI,
  sampleD40EnvelopeAt,
  runFfmpeg,
} = require('./double-harmonic-d40.cjs');
const {
  DEFAULT_SPECTRAL_PIVOT,
  GRAIN_SPECTRAL_HIGH,
  GRAIN_SPECTRAL_LOW,
  MG_PHASE_TARGET_RATIO,
  analyzeDynamicWeightV3,
  probeAudioDurationSeconds,
  writeFloat32MonoWav,
} = require('./double-harmonic-dynamic-v3.cjs');
const {
  DEFAULT_V6_USER_K,
  resolveResonanceDimensionPairV6,
  resolveV6KCeiling,
  resolveV6UserK,
  buildResonanceD40ArgsV6,
  buildResonanceD40FilterV6,
  sampleResonanceMkV6At,
} = require('./double-harmonic-resonance-v6.cjs');

const BRICKS_D40_V7_SCHEMA = 'funesterie.audio.double-harmonic-bricks-d40.v7';
const BRICKS_D40_V71_SCHEMA = 'funesterie.audio.double-harmonic-binary-grid-d40.v7-1';
const V7_METHOD = 'dry-first-flappy-bricks-mg-phase-d40-harmonic-overlay-v7';
const V71_METHOD = 'dry-first-binary-grid-1024-mg-bricks-d40-harmonic-overlay-v7-1';
const V7_STATE = 'v7-experimental-bricks';
const V71_STATE = 'v7-1-experimental-binary-grid';
const V7_PRESET = 'v7-flappy-bricks-mg-phase-k3';
const V71_PRESET = 'v7-1-binary-1024-mg-phase-k3';
const DEFAULT_V7_FRAME_MS = 250;
const DEFAULT_V7_MAX_SEGMENTS = 2400;
const DEFAULT_V7_CURVE = 'grain-6d7d8d';
const DEFAULT_V7_CURVE_AMOUNT = 0.3;
const DEFAULT_V7_ATTACK = 0.78;
const DEFAULT_V7_RELEASE = 0.32;
const DEFAULT_V7_MIN_DB_SPAN = 8;
const DEFAULT_V7_MIN_BRICKS = 1;
const DEFAULT_V7_MAX_BRICKS = 10;
const DEFAULT_V7_BRICK_INFLUENCE = 0.45;
const DEFAULT_V71_GRID_MODE = 'exact1024';
const V71_EXACT_GRID_SLOTS = 1024;

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

function selectAnalysisFrameAt(analysis = {}, timeSeconds = 0) {
  const frames = Array.isArray(analysis.frames) && analysis.frames.length
    ? analysis.frames
    : [{ endTime: Number.POSITIVE_INFINITY, normalizedEnergy: 0, curvedEnergy: 0, weightScale: 1 }];
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

function resolveV7MinBricks(value) {
  return Math.round(clampNumber(value, 1, DEFAULT_V7_MAX_BRICKS, DEFAULT_V7_MIN_BRICKS));
}

function resolveV7MaxBricks(value) {
  return Math.round(clampNumber(value, DEFAULT_V7_MIN_BRICKS, 32, DEFAULT_V7_MAX_BRICKS));
}

function resolveV7BrickInfluence(value) {
  return clampNumber(value, 0.05, 1, DEFAULT_V7_BRICK_INFLUENCE);
}

function buildBinaryGridMetricsV71() {
  const grainProduct = GRAIN_SPECTRAL_LOW * GRAIN_SPECTRAL_HIGH;
  const smallMg = grainProduct * MG_PHASE;
  const inverseSmallMg = 1 / smallMg;
  const cyclePi = D40_SOURCE_N * Math.PI;
  const measuredSlotsPerSecond = inverseSmallMg / cyclePi * 100;
  const neededProductFor1024 = 100 / (V71_EXACT_GRID_SLOTS * MG_PHASE * cyclePi);
  return {
    mode: DEFAULT_V71_GRID_MODE,
    exactSlotsPerSecond: V71_EXACT_GRID_SLOTS,
    measuredSlotsPerSecond,
    measuredGapTo1024: measuredSlotsPerSecond - V71_EXACT_GRID_SLOTS,
    measuredRelativeGap: (measuredSlotsPerSecond - V71_EXACT_GRID_SLOTS) / V71_EXACT_GRID_SLOTS,
    grainLow: GRAIN_SPECTRAL_LOW,
    grainHigh: GRAIN_SPECTRAL_HIGH,
    grainProduct,
    grainProductGapToHalf: grainProduct - 0.5,
    smallMg,
    inverseSmallMg,
    cyclePi,
    neededProductFor1024,
    productDeltaFor1024: neededProductFor1024 - grainProduct,
    formula: '100/(grainLow*grainHigh*mg_phase*(40.0005*pi))',
  };
}

function resolveV71BinaryGrid(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'off' || raw === 'none') {
    return {
      enabled: false,
      mode: 'off',
      slotsPerSecond: 0,
      metrics: buildBinaryGridMetricsV71(),
    };
  }
  const metrics = buildBinaryGridMetricsV71();
  if (raw === 'measured' || raw === '1024.226' || raw === '1024-measured') {
    return {
      enabled: true,
      mode: 'measured',
      slotsPerSecond: metrics.measuredSlotsPerSecond,
      outputSampleRate: V71_EXACT_GRID_SLOTS,
      metrics,
    };
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 128 && numeric <= 8192) {
    return {
      enabled: true,
      mode: 'custom',
      slotsPerSecond: numeric,
      outputSampleRate: Math.round(numeric),
      metrics,
    };
  }
  return {
    enabled: true,
    mode: DEFAULT_V71_GRID_MODE,
    slotsPerSecond: V71_EXACT_GRID_SLOTS,
    outputSampleRate: V71_EXACT_GRID_SLOTS,
    metrics,
  };
}

function quantizeTimeToBinaryGrid(timeSeconds, binaryGrid) {
  if (!binaryGrid?.enabled || !Number.isFinite(binaryGrid.slotsPerSecond) || binaryGrid.slotsPerSecond <= 0) {
    return timeSeconds;
  }
  return Math.round(timeSeconds * binaryGrid.slotsPerSecond) / binaryGrid.slotsPerSecond;
}

function buildBricksD40EnvelopePath(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v7')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.v7-bricks-envelope.wav`);
}

function sampleBrickResonanceV7At(analysis = {}, timeSeconds = 0, options = {}) {
  const frame = selectAnalysisFrameAt(analysis, timeSeconds);
  const v6 = sampleResonanceMkV6At(analysis, timeSeconds, options);
  const minBricks = resolveV7MinBricks(options.minBricks);
  const maxBricks = Math.max(minBricks, resolveV7MaxBricks(options.maxBricks));
  const brickInfluence = resolveV7BrickInfluence(options.brickInfluence);
  const energy = clampNumber(
    Number(frame.curvedEnergy ?? frame.normalizedEnergy ?? v6.energy ?? 0),
    0,
    1,
    0
  );
  const pivot = clampNumber(options.spectralPivot, 0.001, 0.999, DEFAULT_SPECTRAL_PIVOT);
  const weightScale = clampNumber(frame.weightScale, MIN_HARMONIC_INTENSITY, MAX_HARMONIC_INTENSITY, 1);
  const dynamicDeviation = clampNumber(
    Math.abs(weightScale - 1) / Math.max(0.001, MAX_HARMONIC_INTENSITY - MIN_HARMONIC_INTENSITY),
    0,
    1,
    0
  );
  const spectralPosition = GRAIN_SPECTRAL_LOW + energy * (GRAIN_SPECTRAL_HIGH - GRAIN_SPECTRAL_LOW);
  const spectralHeight = clampNumber(
    (spectralPosition - GRAIN_SPECTRAL_LOW) / Math.max(0.000001, GRAIN_SPECTRAL_HIGH - GRAIN_SPECTRAL_LOW),
    0,
    1,
    energy
  );
  const phasePresence = clampNumber(1 - dynamicDeviation, 0, 1, 1);
  const height = clampNumber(
    (energy * 0.55) + (spectralHeight * 0.25) + (phasePresence * 0.20),
    0,
    1,
    energy
  );
  const hole = clampNumber(1 - height, 0, 1, 0);
  const activeBricks = Math.round(minBricks + hole * (maxBricks - minBricks));
  const brickRatio = clampNumber(activeBricks / Math.max(1, maxBricks), 0, 1, 0);
  const forcePerBrick = MG_PHASE * (1 + v6.userResonance);
  const totalMgPhase = activeBricks * forcePerBrick;
  const normalizedForce = clampNumber(
    Math.log1p(activeBricks * MG_PHASE_TARGET_RATIO) / Math.log1p(maxBricks * MG_PHASE_TARGET_RATIO),
    0,
    1,
    brickRatio
  );
  const brickSupport = normalizedForce * hole * brickInfluence;
  const folded = clampNumber(v6.folded + (1 - v6.folded) * brickSupport, 0, 1, v6.folded);

  return {
    ...v6,
    height,
    hole,
    spectralPosition,
    spectralHeight,
    phasePresence,
    dynamicDeviation,
    activeBricks,
    minBricks,
    maxBricks,
    brickRatio,
    brickInfluence,
    forcePerBrick,
    totalMgPhase,
    normalizedForce,
    brickSupport,
    folded,
    baseFolded: v6.folded,
    mgPhase: MG_PHASE,
    target0005Pi: TARGET_0005_PI,
    mgRatio: MG_PHASE_TARGET_RATIO,
  };
}

function buildBricksAutomationSamplesV7({
  analysis,
  profile = 'blend',
  cycleSeconds,
  durationSeconds,
  sampleRate,
  userK,
  kCeiling,
  minBricks,
  maxBricks,
  brickInfluence,
  binaryGrid,
} = {}) {
  const resolvedBinaryGrid = resolveV71BinaryGrid(binaryGrid);
  const defaultSampleRate = resolvedBinaryGrid.enabled
    ? Math.round(clampNumber(resolvedBinaryGrid.outputSampleRate || resolvedBinaryGrid.slotsPerSecond, 128, 8192, V71_EXACT_GRID_SLOTS))
    : 400;
  const resolvedSampleRate = Math.round(clampNumber(sampleRate, 50, 8192, defaultSampleRate));
  const fallbackDuration = Number(analysis?.summary?.durationSeconds || 1) || 1;
  const duration = clampNumber(durationSeconds, 0.05, 7200, fallbackDuration);
  const sampleCount = Math.max(1, Math.ceil(duration * resolvedSampleRate));
  const samples = new Float32Array(sampleCount);
  const foldedValues = [];
  const baseFoldedValues = [];
  const brickCounts = [];
  const heights = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / resolvedSampleRate;
    const sampleTime = quantizeTimeToBinaryGrid(time, resolvedBinaryGrid);
    const brick = sampleBrickResonanceV7At(analysis, sampleTime, {
      userK,
      kCeiling,
      minBricks,
      maxBricks,
      brickInfluence,
    });
    const d40 = sampleD40EnvelopeAt(sampleTime, { profile, periodSeconds: cycleSeconds });
    const value = d40.gain * brick.folded;
    samples[index] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    foldedValues.push(brick.folded);
    baseFoldedValues.push(brick.baseFolded);
    brickCounts.push(brick.activeBricks);
    heights.push(brick.height);
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
    binaryGrid: resolvedBinaryGrid.enabled ? {
      enabled: true,
      mode: resolvedBinaryGrid.mode,
      slotsPerSecond: resolvedBinaryGrid.slotsPerSecond,
      outputSampleRate: resolvedSampleRate,
      metrics: resolvedBinaryGrid.metrics,
    } : {
      enabled: false,
      mode: 'off',
      slotsPerSecond: 0,
      outputSampleRate: resolvedSampleRate,
      metrics: resolvedBinaryGrid.metrics,
    },
    summary: {
      min,
      max,
      mean: sum / sampleCount,
      foldedMin: Math.min(...foldedValues),
      foldedMax: Math.max(...foldedValues),
      foldedMean: mean(foldedValues),
      baseFoldedMean: mean(baseFoldedValues),
      brickMin: Math.min(...brickCounts),
      brickMax: Math.max(...brickCounts),
      brickMean: mean(brickCounts),
      heightMin: Math.min(...heights),
      heightMax: Math.max(...heights),
      heightMean: mean(heights),
    },
  };
}

function buildBricksD40FilterV7({
  profile = 'blend',
  cycleSeconds,
  userK,
  kCeiling,
  minBricks,
  maxBricks,
  brickInfluence,
  binaryGrid,
} = {}) {
  const built = buildResonanceD40FilterV6({ profile, cycleSeconds, userK, kCeiling });
  const resolvedBinaryGrid = resolveV71BinaryGrid(binaryGrid);
  const isBinaryGrid = resolvedBinaryGrid.enabled;
  return {
    ...built,
    schema: isBinaryGrid ? BRICKS_D40_V71_SCHEMA : BRICKS_D40_V7_SCHEMA,
    method: isBinaryGrid ? V71_METHOD : V7_METHOD,
    state: isBinaryGrid ? V71_STATE : V7_STATE,
    preset: isBinaryGrid ? V71_PRESET : V7_PRESET,
    bricks: {
      min: resolveV7MinBricks(minBricks),
      max: resolveV7MaxBricks(maxBricks),
      brickInfluence: resolveV7BrickInfluence(brickInfluence),
      mgPhase: MG_PHASE,
      target0005Pi: TARGET_0005_PI,
      mgRatio: MG_PHASE_TARGET_RATIO,
      heightFormula: 'height=0.55*energy+0.25*spectralHeight+0.20*phasePresence',
      allocation: 'activeBricks=round(min+(1-height)*(max-min))',
      support: 'folded=v6+(1-v6)*log1p(activeBricks*mgRatio)/log1p(maxBricks*mgRatio)*(1-height)*brickInfluence',
      binaryGrid: isBinaryGrid ? {
        enabled: true,
        mode: resolvedBinaryGrid.mode,
        slotsPerSecond: resolvedBinaryGrid.slotsPerSecond,
        outputSampleRate: resolvedBinaryGrid.outputSampleRate,
        metrics: resolvedBinaryGrid.metrics,
      } : {
        enabled: false,
        mode: 'off',
        slotsPerSecond: 0,
        metrics: resolvedBinaryGrid.metrics,
      },
    },
    safety: {
      ...built.safety,
      mgPhaseFixed: true,
      v6StableUntouched: true,
      brickCountMax: resolveV7MaxBricks(maxBricks),
      binaryGridEnabled: isBinaryGrid,
      binaryGridDoesNotChangeMgPhase: true,
    },
  };
}

async function processBricksD40V7({
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
  const minBricks = resolveV7MinBricks(analysisOptions.minBricks);
  const maxBricks = resolveV7MaxBricks(analysisOptions.maxBricks);
  const brickInfluence = resolveV7BrickInfluence(analysisOptions.brickInfluence);
  const binaryGrid = resolveV71BinaryGrid(analysisOptions.binaryGrid);
  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const analysisMaxSeconds = analysisOptions.maxSeconds
    || (probedDuration ? Math.min(900, probedDuration + 0.5) : undefined);
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: analysisOptions.frameMs || DEFAULT_V7_FRAME_MS,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments || DEFAULT_V7_MAX_SEGMENTS,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve || DEFAULT_V7_CURVE,
    curveAmount: analysisOptions.curveAmount ?? DEFAULT_V7_CURVE_AMOUNT,
    attack: analysisOptions.attack ?? DEFAULT_V7_ATTACK,
    release: analysisOptions.release ?? DEFAULT_V7_RELEASE,
    minDbSpan: analysisOptions.minDbSpan || DEFAULT_V7_MIN_DB_SPAN,
    swapPitchGrain: true,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
  const durationSeconds = Math.max(
    0.5,
    Number(probedDuration) || 0,
    Number(analysis.summary?.durationSeconds) || 0
  ) + 0.25;
  const automation = buildBricksAutomationSamplesV7({
    analysis,
    profile,
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
    userK,
    kCeiling,
    minBricks,
    maxBricks,
    brickInfluence,
    binaryGrid: binaryGrid.enabled ? binaryGrid.mode : 'off',
  });
  const envelopePath = buildBricksD40EnvelopePath(outputPath);
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
    built = buildBricksD40FilterV7({
      profile,
      cycleSeconds: analysisOptions.cycleSeconds,
      userK,
      kCeiling,
      minBricks,
      maxBricks,
      brickInfluence,
      binaryGrid: binaryGrid.enabled ? binaryGrid.mode : 'off',
    });
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V7_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePath, { force: true });
    }
  }

  return {
    method: built.method,
    state: built.state,
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: binaryGrid.enabled ? 'binary-bricks-adaptive' : 'bricks-adaptive',
    d40: built.envelope.density,
    resonance: {
      userK,
      kCeiling,
      ratioHighToLow: built.ratioHighToLow,
      ratioFormula: built.dimensions.ratioFormula,
      mode: 'flappy-bricks',
      transferMode: 'mg-phase-brick-allocation',
      wetCeiling: built.wetCeiling,
      highShare: built.highShare,
      lowShare: built.lowShare,
    },
    bricks: {
      min: minBricks,
      max: maxBricks,
      brickInfluence,
      mgPhase: MG_PHASE,
      target0005Pi: TARGET_0005_PI,
      mgRatio: MG_PHASE_TARGET_RATIO,
      summary: automation.summary,
      binaryGrid: automation.binaryGrid,
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
        binaryGrid: automation.binaryGrid,
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
      brickMin: automation.summary.brickMin,
      brickMax: automation.summary.brickMax,
      brickMean: automation.summary.brickMean,
      heightMin: automation.summary.heightMin,
      heightMax: automation.summary.heightMax,
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

function buildBricksD40PlanV7(options = {}) {
  const frameMs = clampNumber(options.frameMs, 50, 1000, DEFAULT_V7_FRAME_MS);
  const maxSeconds = clampNumber(options.maxSeconds, 1, 900, 480);
  const userK = resolveV6UserK(options.userK ?? options.resonanceK ?? options.intensity ?? options.harmonicIntensity);
  const kCeiling = resolveV6KCeiling(options.kCeiling);
  const minBricks = resolveV7MinBricks(options.minBricks);
  const maxBricks = resolveV7MaxBricks(options.maxBricks);
  const brickInfluence = resolveV7BrickInfluence(options.brickInfluence);
  const binaryGrid = resolveV71BinaryGrid(options.binaryGrid);
  const built = buildBricksD40FilterV7({
    userK,
    kCeiling,
    minBricks,
    maxBricks,
    brickInfluence,
    binaryGrid: binaryGrid.enabled ? binaryGrid.mode : 'off',
    profile: options.profile || 'blend',
  });
  return {
    schema: built.schema,
    method: built.method,
    state: built.state,
    profile: 'blend',
    preset: built.preset,
    frameMs,
    maxSeconds,
    d40: built.envelope.density,
    dimensions: resolveResonanceDimensionPairV6(),
    resonance: {
      userK,
      kCeiling,
      mode: 'flappy-bricks',
      transferMode: 'mg-phase-brick-allocation',
      base: 'V6 Supreme wet ceiling, pitches and M/K ratio are preserved.',
      wetCeiling: built.wetCeiling,
      binaryGrid: binaryGrid.enabled ? 'enabled' : 'off',
    },
    bricks: built.bricks,
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
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
      dimensions: built.dimensions,
    },
    defaults: {
      userK: {
        default: DEFAULT_V6_USER_K,
        min: 0.1,
        max: 10,
      },
      kCeiling: 10,
      minBricks: DEFAULT_V7_MIN_BRICKS,
      maxBricks: DEFAULT_V7_MAX_BRICKS,
      brickInfluence: DEFAULT_V7_BRICK_INFLUENCE,
      frameMs: DEFAULT_V7_FRAME_MS,
      maxSegments: DEFAULT_V7_MAX_SEGMENTS,
      curve: DEFAULT_V7_CURVE,
      curveAmount: DEFAULT_V7_CURVE_AMOUNT,
      attack: DEFAULT_V7_ATTACK,
      release: DEFAULT_V7_RELEASE,
      minDbSpan: DEFAULT_V7_MIN_DB_SPAN,
    },
    safety: built.safety,
  };
}

module.exports = {
  BRICKS_D40_V7_SCHEMA,
  BRICKS_D40_V71_SCHEMA,
  V71_METHOD,
  V71_PRESET,
  V71_STATE,
  V7_METHOD,
  V7_PRESET,
  V7_STATE,
  buildBinaryGridMetricsV71,
  buildBricksAutomationSamplesV7,
  buildBricksD40FilterV7,
  buildBricksD40PlanV7,
  processBricksD40V7,
  resolveV71BinaryGrid,
  resolveV7BrickInfluence,
  resolveV7MaxBricks,
  resolveV7MinBricks,
  sampleBrickResonanceV7At,
};

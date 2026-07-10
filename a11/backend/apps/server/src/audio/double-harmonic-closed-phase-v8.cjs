'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  D40_SOURCE_N,
  D40_TARGET_N,
  MG_PHASE,
  TARGET_0005_PI,
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
const {
  DEFAULT_V6_USER_K,
  resolveV6KCeiling,
  resolveV6UserK,
  buildResonanceD40FilterV6,
  sampleResonanceMkV6At,
} = require('./double-harmonic-resonance-v6.cjs');
const {
  buildBinaryGridMetricsV71,
} = require('./double-harmonic-bricks-v7.cjs');

const CLOSED_PHASE_D40_V8_SCHEMA = 'funesterie.audio.double-harmonic-closed-phase-d40.v8';
const CLOSED_PHASE_D40_V8_PLUS_SCHEMA = 'funesterie.audio.double-harmonic-closed-phase-d40.v8-plus';
const CLOSED_PHASE_D40_V8_PIVOT_SCHEMA = 'funesterie.audio.double-harmonic-closed-phase-d40.v8-pivot';
const TURBO_D40_V9_SCHEMA = 'funesterie.audio.double-harmonic-turbo-d40.v9';
const V8_METHOD = 'dry-first-centered-increment-mg-phase-1024-d40-harmonic-overlay-v8';
const V8_PLUS_METHOD = 'dry-first-e2-grain-centered-increment-mg-phase-1024-d40-harmonic-overlay-v8-plus';
const V8_PIVOT_METHOD = 'dry-first-pivot-1024-centered-increment-mg-phase-d40-harmonic-overlay-v8-pivot';
const V9_TURBO_METHOD = 'dry-first-pivot-1024-vocal-safe-99ms-dynamic-weight-d40-harmonic-overlay-v9-turbo';
const V8_STATE = 'v8-closed-phase-candidate';
const V8_PLUS_STATE = 'v8-plus-e2-grain-listening-candidate';
const V8_PIVOT_STATE = 'v8-pivot-1024-listening-validated';
const V9_TURBO_STATE = 'v9-turbo-99ms-listening-validated';
const V8_PRESET = 'v8-fermeture-1024-mg-phase-c7-k3';
const V8_PLUS_PRESET = 'v8-plus-e2-grain-1024-mg-phase-c7-k3';
const V8_PIVOT_PRESET = 'v8-pivot-1024-pivot-0292-mg-phase-c7-k3';
const V9_TURBO_PRESET = 'v9-turbo-pivot-1024-vocal-safe-99ms-k3';
const V9_ELECTROLYSIS_MIN_HZ = 40.26;
const V9_ELECTROLYSIS_MAX_HZ = 40.62;
const V9_ELECTROLYSIS_CENTER_HZ = (V9_ELECTROLYSIS_MIN_HZ + V9_ELECTROLYSIS_MAX_HZ) / 2;
const DEFAULT_V8_FRAME_MS = 250;
const DEFAULT_V8_MAX_SEGMENTS = 2400;
const DEFAULT_V8_CURVE = 'grain-6d7d8d';
const DEFAULT_V8_CURVE_AMOUNT = 0.3;
const DEFAULT_V8_ATTACK = 0.78;
const DEFAULT_V8_RELEASE = 0.32;
const DEFAULT_V8_MIN_DB_SPAN = 8;
const DEFAULT_V8_PHASE_SLOTS = 1024;
const DEFAULT_V9_TURBO_FRAME_MS = 99;
const DEFAULT_V9_TURBO_MAX_SEGMENTS = 12000;
const DEFAULT_V9_TURBO_ATTACK = 0.9656;
const DEFAULT_V9_TURBO_RELEASE = 0.7704;
const D40_RENDER_SAMPLE_RATE = 44100;
const V9_TURBO_TRANSITION = Object.freeze({
  frameMs: DEFAULT_V9_TURBO_FRAME_MS,
  riseScale: 11.936,
  deltaScale: 8.936,
  riseStable: 4.848,
  deltaStable: 6.36,
  riseBoost: 0.0578,
  deltaBoost: 0.0478,
  openGamma: 0.756,
  openFloor: 0.0416,
  openRange: 0.6344,
  openMax: 0.8728,
});
const V9_ELECTROLYSIS_GUITAR_MODULATION = Object.freeze({
  mode: 'electrolysis-guitar',
  enabled: true,
  frequencyHz: V9_ELECTROLYSIS_CENTER_HZ,
  frequencyMinHz: V9_ELECTROLYSIS_MIN_HZ,
  frequencyMaxHz: V9_ELECTROLYSIS_MAX_HZ,
  amount: 0.042,
  irregularity: 0.36,
  asymmetry: 0.27,
  bidirectional: true,
  followForce: 0.72,
  schemaMix: 0.58,
});
const MIN_V8_PHASE_SLOTS = 128;
const MAX_V8_PHASE_SLOTS = 8192;
const TWO_PI = 2 * Math.PI;
const PHI = (1 + Math.sqrt(5)) / 2;
const JHI = (Math.PI / 2) - PHI;
const C7 = Math.abs(JHI) / PHI;
const PHASE_DELTA = TARGET_0005_PI - MG_PHASE;
const C7_PHASE_SCALE = PHASE_DELTA / C7;
const H_D40 = (360 * D40_TARGET_N) / (D40_SOURCE_N * 4 * Math.PI);
const H_D40_FULL = 2 * H_D40;
const E_SQUARED = Math.E * Math.E;
const GRAIN_E2_LOW = (2 * E_SQUARED) / D40_SOURCE_N;
const GRAIN_E2_HIGH = D40_SOURCE_N / (4 * E_SQUARED);
const GRAIN_PIVOT_TARGET = 0.292;
const GRAIN_PIVOT_DELTA = 0.9837777777777778;
const GRAIN_PIVOT_PRODUCT_1024 = 100 / (DEFAULT_V8_PHASE_SLOTS * MG_PHASE * D40_SOURCE_N * Math.PI);
const GRAIN_PIVOT_LOW = (Math.sqrt((GRAIN_PIVOT_DELTA ** 2) + (4 * GRAIN_PIVOT_PRODUCT_1024)) - GRAIN_PIVOT_DELTA) / 2;
const GRAIN_PIVOT_HIGH = GRAIN_PIVOT_LOW + GRAIN_PIVOT_DELTA;

const V8_VARIANTS = Object.freeze({
  v8: Object.freeze({
    key: 'v8',
    schema: CLOSED_PHASE_D40_V8_SCHEMA,
    method: V8_METHOD,
    state: V8_STATE,
    preset: V8_PRESET,
    intensity: 'closed-phase-1024',
    envelopeTag: 'v8-closed-phase',
    grainMode: 'historical-listening-locked',
    publicSummary: 'V8 Fermeture: V6 Supreme conservee, mg_phase applique en increments recentres sur grille 1024, c7 projete sans changer le gain.',
  }),
  v8plus: Object.freeze({
    key: 'v8plus',
    schema: CLOSED_PHASE_D40_V8_PLUS_SCHEMA,
    method: V8_PLUS_METHOD,
    state: V8_PLUS_STATE,
    preset: V8_PLUS_PRESET,
    intensity: 'e2-grain-closed-phase-1024',
    envelopeTag: 'v8-plus-e2-closed-phase',
    grainMode: 'e2-parallel-listening-test',
    publicSummary: 'V8 Plus: branche e2 en parallele, produit grainLow*grainHigh=1/2, fermeture mg_phase 1024 conservee pour test d ecoute.',
  }),
  v8pivot: Object.freeze({
    key: 'v8pivot',
    schema: CLOSED_PHASE_D40_V8_PIVOT_SCHEMA,
    method: V8_PIVOT_METHOD,
    state: V8_PIVOT_STATE,
    preset: V8_PIVOT_PRESET,
    intensity: 'pivot-1024-closed-phase',
    envelopeTag: 'v8-pivot-closed-phase',
    grainMode: 'pivot-1024-listening-validated',
    publicSummary: 'V8 Pivot: branche validee a l ecoute, produit ajuste pour 1024 exact et pivot 0.292 exact, fermeture mg_phase conservee.',
  }),
  v9turbo: Object.freeze({
    key: 'v9turbo',
    schema: TURBO_D40_V9_SCHEMA,
    method: V9_TURBO_METHOD,
    state: V9_TURBO_STATE,
    preset: V9_TURBO_PRESET,
    intensity: 'vocal-safe-99ms-turbo-1024',
    envelopeTag: 'v9-turbo-99ms',
    grainMode: 'v9-turbo-pivot-1024-vocal-safe-99ms',
    publicSummary: 'V9 Turbo: V8 Pivot valide, poids haut/bas dynamiques vocal-safe a 99 ms, fermeture 1024 et mg_phase conservees.',
  }),
});

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function resolveV8Variant(value) {
  if (value && typeof value === 'object' && V8_VARIANTS[value.key]) {
    return V8_VARIANTS[value.key];
  }
  const raw = String(value ?? '').trim().toLowerCase().replace(/[-_\s]+/g, '');
  if (raw === 'plus' || raw === 'v8plus' || raw === 'v8p' || raw === 'e2') {
    return V8_VARIANTS.v8plus;
  }
  if (raw === 'pivot' || raw === 'v8pivot' || raw === 'v8pv' || raw === '1024pivot') {
    return V8_VARIANTS.v8pivot;
  }
  if (raw === 'v9' || raw === 'v9turbo' || raw === 'turbo' || raw === 'v9t' || raw === '99' || raw === '99ms') {
    return V8_VARIANTS.v9turbo;
  }
  return V8_VARIANTS.v8;
}

function isPivotGrainVariant(variantValue) {
  const variant = resolveV8Variant(variantValue);
  return variant.key === 'v8pivot' || variant.key === 'v9turbo';
}

function buildV8PivotLock(low, high) {
  const delta = high - low;
  const product = low * high;
  const pivot = GRAIN_PIVOT_TARGET + (18 * (GRAIN_PIVOT_DELTA - delta));
  return {
    delta,
    product,
    productGapToHalf: product - 0.5,
    product1024Target: GRAIN_PIVOT_PRODUCT_1024,
    productGapTo1024: product - GRAIN_PIVOT_PRODUCT_1024,
    pivot,
    pivotTarget: GRAIN_PIVOT_TARGET,
    pivotGapToTarget: pivot - GRAIN_PIVOT_TARGET,
    pivotFormula: '0.292 + 18*(0.9837777777777778-(grainHigh-grainLow))',
  };
}

function resolveV8GrainPair(variantValue) {
  const variant = resolveV8Variant(variantValue);
  const low = variant.key === 'v8plus'
    ? GRAIN_E2_LOW
    : isPivotGrainVariant(variant)
      ? GRAIN_PIVOT_LOW
      : GRAIN_SPECTRAL_LOW;
  const high = variant.key === 'v8plus'
    ? GRAIN_E2_HIGH
    : isPivotGrainVariant(variant)
      ? GRAIN_PIVOT_HIGH
      : GRAIN_SPECTRAL_HIGH;
  return {
    mode: variant.grainMode,
    low,
    high,
    ...buildV8PivotLock(low, high),
  };
}

function buildV8GrainResearch(variantValue) {
  const variant = resolveV8Variant(variantValue);
  const active = resolveV8GrainPair(variant);
  const historicalProduct = GRAIN_SPECTRAL_LOW * GRAIN_SPECTRAL_HIGH;
  return {
    mode: active.mode,
    active,
    historical: {
      low: GRAIN_SPECTRAL_LOW,
      high: GRAIN_SPECTRAL_HIGH,
      product: historicalProduct,
      productGapToHalf: historicalProduct - 0.5,
    },
    e2: {
      low: GRAIN_E2_LOW,
      high: GRAIN_E2_HIGH,
      ...buildV8PivotLock(GRAIN_E2_LOW, GRAIN_E2_HIGH),
      lowFormula: '2*e^2/40.0005',
      highFormula: '40.0005/(4*e^2)',
    },
    pivot1024: {
      low: GRAIN_PIVOT_LOW,
      high: GRAIN_PIVOT_HIGH,
      ...buildV8PivotLock(GRAIN_PIVOT_LOW, GRAIN_PIVOT_HIGH),
      productFormula: '100/(1024*mg_phase*(40.0005*pi))',
      deltaFormula: '0.9837777777777778 locks pivot to 0.292 through the 18-step bridge',
    },
    recommendation: variant.key === 'v9turbo'
      ? 'Promoted turbo path: V9 Turbo keeps V8 Pivot grain/closure and adds vocal-safe 99 ms dynamic high/low weights.'
      : variant.key === 'v8pivot'
        ? 'Promoted listening path: V8 Pivot keeps centered mg_phase closure and locks 1024 + pivot 0.292 together.'
        : variant.key === 'v8plus'
        ? 'Grok path: compare e2 grain by ear beside locked V8; do not promote to canon yet.'
        : 'Locked V8 path: keep historical grain validated by listening.',
  };
}

function mean(values) {
  if (!values?.length) return 0;
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : 0;
}

function resolveV8PhaseSlots(value) {
  return Math.round(clampNumber(value, MIN_V8_PHASE_SLOTS, MAX_V8_PHASE_SLOTS, DEFAULT_V8_PHASE_SLOTS));
}

function resolveV8C7PhaseScale(value) {
  return clampNumber(value, 0, 0.02, C7_PHASE_SCALE);
}

function makeStats() {
  return {
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    sum: 0,
    count: 0,
  };
}

function addStat(stats, value) {
  if (!Number.isFinite(value)) return;
  stats.min = Math.min(stats.min, value);
  stats.max = Math.max(stats.max, value);
  stats.sum += value;
  stats.count += 1;
}

function finishStats(stats) {
  if (!stats.count) return { min: 0, max: 0, mean: 0 };
  return {
    min: stats.min,
    max: stats.max,
    mean: stats.sum / stats.count,
  };
}

function buildClosedPhaseOperatorsV8() {
  return {
    phi: PHI,
    jhi: JHI,
    absJhi: Math.abs(JHI),
    c7: C7,
    c7Formula: '|pi/2-phi|/phi, projection of lym(log(exp(A_im)))/phi',
    pivot10c7: 10 * C7,
    pivotGapTo0292: 0.292 - (10 * C7),
    mgPhase: MG_PHASE,
    target0005Pi: TARGET_0005_PI,
    phaseDelta: PHASE_DELTA,
    c7ReconstructedFromDelta: Math.cbrt((200 / 131) * PHASE_DELTA),
    c7ReconstructionGap: Math.cbrt((200 / 131) * PHASE_DELTA) - C7,
  };
}

function buildD40StepProjectionV8() {
  return {
    hD40: H_D40,
    hD40Formula: '(360*40)/(40.0005*4*pi)',
    hD40Full: H_D40_FULL,
    hD40FullFormula: '(360*40)/(40.0005*2*pi)',
    steps: {
      phi: H_D40 * PHI,
      jhi: H_D40 * JHI,
      absJhi: H_D40 * Math.abs(JHI),
      c7: H_D40 * C7,
      pivot10c7: H_D40 * 10 * C7,
      mgPhase: H_D40 * MG_PHASE,
      target0005Pi: H_D40 * TARGET_0005_PI,
      phaseDelta: H_D40 * PHASE_DELTA,
      piOver2: H_D40 * (Math.PI / 2),
      piOver2GapTo45: 45 - (H_D40 * (Math.PI / 2)),
    },
  };
}

function buildCanonicalClosureInputsV8(slots = DEFAULT_V8_PHASE_SLOTS) {
  const resolvedSlots = resolveV8PhaseSlots(slots);
  const forces = new Float64Array(resolvedSlots);
  const c7Carriers = new Float64Array(resolvedSlots);
  for (let index = 0; index < resolvedSlots; index += 1) {
    const u = index / resolvedSlots;
    const sineRise = 0.5 + (0.5 * Math.sin((TWO_PI * u) - (Math.PI / 2)));
    const triangle = 1 - Math.abs((2 * u) - 1);
    forces[index] = clampNumber((0.58 * sineRise) + (0.42 * triangle), 0, 1, 0);
    c7Carriers[index] = Math.sin((TWO_PI * u) + PHI) * Math.cos((2 * TWO_PI * u) + Math.abs(JHI));
  }
  return { forces, c7Carriers };
}

function buildCenteredPhaseClosureV8({
  forces,
  c7Carriers,
  c7PhaseScale,
  includePhases = false,
} = {}) {
  const count = Math.max(1, Number(forces?.length || c7Carriers?.length || DEFAULT_V8_PHASE_SLOTS) || 1);
  const resolvedForces = forces?.length ? forces : new Float64Array(count);
  const resolvedC7 = c7Carriers?.length ? c7Carriers : new Float64Array(count);
  const forceMean = mean(resolvedForces);
  const c7Mean = mean(resolvedC7);
  const resolvedC7Scale = resolveV8C7PhaseScale(c7PhaseScale);
  const baseIncrement = TWO_PI / count;
  const phases = includePhases ? new Float64Array(count) : null;
  const incrementStats = makeStats();
  const forceStats = makeStats();
  const c7Stats = makeStats();
  let phase = 0;
  let sumCenteredForce = 0;
  let sumCenteredC7 = 0;

  for (let index = 0; index < count; index += 1) {
    if (phases) phases[index] = phase;
    const force = Number(resolvedForces[index] || 0);
    const c7Carrier = Number(resolvedC7[index] || 0);
    const centeredForce = force - forceMean;
    const centeredC7 = c7Carrier - c7Mean;
    const mgIncrement = MG_PHASE * centeredForce;
    const c7Increment = resolvedC7Scale * C7 * centeredC7;
    const increment = baseIncrement + mgIncrement + c7Increment;
    phase += increment;
    sumCenteredForce += centeredForce;
    sumCenteredC7 += centeredC7;
    addStat(incrementStats, increment);
    addStat(forceStats, force);
    addStat(c7Stats, c7Carrier);
  }

  const directOffsetGap = (MG_PHASE * ((resolvedForces[0] || 0) - (resolvedForces[count - 1] || 0)))
    + (resolvedC7Scale * C7 * ((resolvedC7[0] || 0) - (resolvedC7[count - 1] || 0)));

  return {
    mode: 'centered-increments',
    slots: count,
    baseIncrement,
    mgPhase: MG_PHASE,
    target0005Pi: TARGET_0005_PI,
    phaseDelta: PHASE_DELTA,
    c7: C7,
    c7PhaseScale: resolvedC7Scale,
    c7IncrementMaxAbs: resolvedC7Scale * C7,
    centered: {
      meanForce: forceMean,
      meanC7: c7Mean,
      sumCenteredForce,
      sumCenteredC7,
      closingPhase: phase,
      closingGap: phase - TWO_PI,
      increment: finishStats(incrementStats),
      force: finishStats(forceStats),
      c7Carrier: finishStats(c7Stats),
    },
    instantOffset: {
      formula: 'mg_phase*(F0-Flast)+c7PhaseScale*c7*(C0-Clast)',
      closingGap: directOffsetGap,
    },
    phases,
  };
}

function buildClosedPhaseMetricsV8(options = {}) {
  const variant = resolveV8Variant(options.variant);
  const grainPair = resolveV8GrainPair(variant);
  const phaseSlots = resolveV8PhaseSlots(options.phaseSlots || options.slots);
  const c7PhaseScale = resolveV8C7PhaseScale(options.c7PhaseScale);
  const canonical = buildCanonicalClosureInputsV8(phaseSlots);
  const closure = buildCenteredPhaseClosureV8({
    forces: canonical.forces,
    c7Carriers: canonical.c7Carriers,
    c7PhaseScale,
  });
  return {
    schema: variant.key === 'v8plus'
      ? 'funesterie.audio.double-harmonic-closed-phase-metrics.v8-plus'
      : variant.key === 'v9turbo'
        ? 'funesterie.audio.double-harmonic-closed-phase-metrics.v9-turbo'
      : isPivotGrainVariant(variant)
        ? 'funesterie.audio.double-harmonic-closed-phase-metrics.v8-pivot'
      : 'funesterie.audio.double-harmonic-closed-phase-metrics.v8',
    variant: variant.key,
    operators: buildClosedPhaseOperatorsV8(),
    projection: buildD40StepProjectionV8(),
    grain: buildV8GrainResearch(variant),
    binaryGrid: buildBinaryGridMetricsV71({
      grainLow: grainPair.low,
      grainHigh: grainPair.high,
    }),
    closure: {
      mode: closure.mode,
      slots: closure.slots,
      baseIncrement: closure.baseIncrement,
      centered: closure.centered,
      instantOffset: closure.instantOffset,
      formula: 'deltaTheta_k=(2*pi/M)+mg_phase*(F_k-meanF)+c7PhaseScale*c7*(C_k-meanC)',
      proof: 'sum(F_k-meanF)=0 and sum(C_k-meanC)=0, so theta_M=2*pi up to float precision',
    },
  };
}

function buildClosedPhaseEnvelopePath(outputPath, variantValue) {
  const variant = resolveV8Variant(variantValue);
  const safeBase = path.basename(String(outputPath || 'd40-v8')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.${variant.envelopeTag}-envelope.wav`);
}

function sampleClosedPhaseV8At(analysis = {}, timeSeconds = 0, options = {}) {
  const variant = resolveV8Variant(options.variant);
  const grainPair = resolveV8GrainPair(variant);
  const v6 = sampleResonanceMkV6At(analysis, timeSeconds, {
    ...options,
    grainLow: grainPair.low,
    grainHigh: grainPair.high,
  });
  const force = clampNumber(
    (0.64 * v6.folded) + (0.26 * v6.energy) + (0.10 * v6.tension),
    0,
    1,
    v6.folded
  );
  const phaseSlots = resolveV8PhaseSlots(options.phaseSlots);
  const slotPosition = ((Number(timeSeconds) * phaseSlots) % phaseSlots + phaseSlots) % phaseSlots;
  const u = slotPosition / phaseSlots;
  const c7Carrier = Math.sin((TWO_PI * u) + PHI) * Math.cos((2 * TWO_PI * u) + Math.abs(JHI));
  return {
    ...v6,
    force,
    c7Carrier,
    phaseSlots,
    mgPhase: MG_PHASE,
    target0005Pi: TARGET_0005_PI,
    phaseDelta: PHASE_DELTA,
    c7: C7,
    grain: grainPair,
  };
}

function buildClosedPhaseAutomationSamplesV8({
  analysis,
  profile = 'blend',
  variant: variantValue,
  cycleSeconds,
  durationSeconds,
  sampleRate,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
} = {}) {
  const variant = resolveV8Variant(variantValue);
  const resolvedPhaseSlots = resolveV8PhaseSlots(phaseSlots);
  const resolvedSampleRate = Math.round(clampNumber(sampleRate, MIN_V8_PHASE_SLOTS, MAX_V8_PHASE_SLOTS, resolvedPhaseSlots));
  const fallbackDuration = Number(analysis?.summary?.durationSeconds || 1) || 1;
  const duration = clampNumber(durationSeconds, 0.05, 7200, fallbackDuration);
  const sampleCount = Math.max(1, Math.ceil(duration * resolvedSampleRate));
  const samples = new Float32Array(sampleCount);
  const forces = new Float64Array(sampleCount);
  const c7Carriers = new Float64Array(sampleCount);
  const folded = new Float64Array(sampleCount);
  const d40Gains = new Float64Array(sampleCount);
  const valueStats = makeStats();
  const foldedStats = makeStats();
  const forceStats = makeStats();
  const phaseGateStats = makeStats();
  const blockGapStats = makeStats();
  const resolvedC7Scale = resolveV8C7PhaseScale(c7PhaseScale);
  const blockSize = Math.max(1, resolvedPhaseSlots);
  let blockCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / resolvedSampleRate;
    const closed = sampleClosedPhaseV8At(analysis, time, {
      variant,
      userK,
      kCeiling,
      phaseSlots: resolvedPhaseSlots,
    });
    const d40 = sampleD40EnvelopeAt(time, { profile, periodSeconds: cycleSeconds });
    forces[index] = closed.force;
    c7Carriers[index] = closed.c7Carrier;
    folded[index] = closed.folded;
    d40Gains[index] = d40.gain;
    addStat(foldedStats, closed.folded);
    addStat(forceStats, closed.force);
  }

  for (let start = 0; start < sampleCount; start += blockSize) {
    const end = Math.min(sampleCount, start + blockSize);
    const closure = buildCenteredPhaseClosureV8({
      forces: forces.subarray(start, end),
      c7Carriers: c7Carriers.subarray(start, end),
      c7PhaseScale: resolvedC7Scale,
      includePhases: true,
    });
    blockCount += 1;
    addStat(blockGapStats, Math.abs(closure.centered.closingGap));
    for (let localIndex = 0; localIndex < end - start; localIndex += 1) {
      const index = start + localIndex;
      const phase = closure.phases[localIndex];
      const phaseGate = 0.5 + (0.5 * Math.sin(phase + PHI));
      const closedSupport = 0.72 + (0.28 * phaseGate);
      const value = d40Gains[index] * folded[index] * closedSupport;
      samples[index] = value;
      addStat(phaseGateStats, phaseGate);
      addStat(valueStats, value);
    }
  }

  const probe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  const canonical = buildClosedPhaseMetricsV8({
    variant,
    phaseSlots: resolvedPhaseSlots,
    c7PhaseScale: resolvedC7Scale,
  });
  return {
    mode: 'wav-envelope',
    variant: variant.key,
    sampleRate: resolvedSampleRate,
    durationSeconds: sampleCount / resolvedSampleRate,
    sampleCount,
    samples,
    profile: probe.profile,
    period: probe.period,
    density: probe.density,
    phaseClosure: {
      slots: resolvedPhaseSlots,
      sampleRate: resolvedSampleRate,
      blockSize,
      blockCount,
      c7PhaseScale: resolvedC7Scale,
      canonical: canonical.closure,
      blockClosingGap: finishStats(blockGapStats),
    },
    summary: {
      ...finishStats(valueStats),
      folded: finishStats(foldedStats),
      force: finishStats(forceStats),
      phaseGate: finishStats(phaseGateStats),
    },
  };
}

function buildClosedPhaseD40FilterV8({
  profile = 'blend',
  variant: variantValue,
  cycleSeconds,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
} = {}) {
  const variant = resolveV8Variant(variantValue);
  const grainPair = resolveV8GrainPair(variant);
  const built = buildResonanceD40FilterV6({
    profile,
    cycleSeconds,
    userK,
    kCeiling,
    grainLow: grainPair.low,
    grainHigh: grainPair.high,
  });
  const metrics = buildClosedPhaseMetricsV8({ variant, phaseSlots, c7PhaseScale });
  const pivotGrain = isPivotGrainVariant(variant);
  return {
    ...built,
    schema: variant.schema,
    method: variant.method,
    state: variant.state,
    preset: variant.preset,
    variant: variant.key,
    operators: metrics.operators,
    projection: metrics.projection,
    grain: metrics.grain,
    binaryGrid: metrics.binaryGrid,
    phaseClosure: metrics.closure,
    resonanceMode: variant.key === 'v8plus'
      ? 'centered-phase-soft-fold-e2-grain'
      : variant.key === 'v9turbo'
        ? 'centered-phase-soft-fold-pivot-1024-vocal-safe-99ms'
      : pivotGrain
        ? 'centered-phase-soft-fold-pivot-1024'
        : 'centered-phase-soft-fold',
    transferMode: variant.key === 'v8plus'
      ? 'centered-increment-mg-phase-e2-grain-test'
      : variant.key === 'v9turbo'
        ? 'centered-increment-mg-phase-pivot-1024-dynamic-high-low-99ms'
      : pivotGrain
        ? 'centered-increment-mg-phase-pivot-1024'
        : 'centered-increment-mg-phase',
    safety: {
      ...built.safety,
      v6StableUntouched: true,
      historicalV8Untouched: variant.key !== 'v8',
      mgPhaseFixed: true,
      mgPhaseIsPhaseIncrement: true,
      noDirectMgOffset: true,
      centeredIncrements: true,
      phaseSlots: metrics.closure.slots,
      exact1024GridDefault: metrics.closure.slots === DEFAULT_V8_PHASE_SLOTS,
      c7IsProjectionNotGain: true,
      pivotResidualOldIsNotMgPhase: true,
      e2GrainCandidate: variant.key === 'v8plus',
      e2GrainNotCanon: variant.key === 'v8plus',
      pivot1024Candidate: pivotGrain,
      pivot1024ListeningValidated: pivotGrain,
      exact1024AndPivot0292: pivotGrain,
      dynamicHighLowWeights: variant.key === 'v9turbo',
      vocalSafe99ms: variant.key === 'v9turbo',
      turbo99ListeningValidated: variant.key === 'v9turbo',
    },
  };
}

function buildClosedPhaseD40ArgsV8({
  inputPath,
  outputPath,
  profile = 'blend',
  variant,
  cycleSeconds,
  envelopePath,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
} = {}) {
  if (!envelopePath) throw new Error('missing_envelope_path');
  const built = buildClosedPhaseD40FilterV8({
    profile,
    variant,
    cycleSeconds,
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
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
      '-ac',
      '2',
      '-ar',
      String(D40_RENDER_SAMPLE_RATE),
      ...buildOutputCodecArgs(outputPath),
      outputPath,
    ],
  };
}

function resolveV9TurboTransitionConfig(options = {}) {
  return {
    ...V9_TURBO_TRANSITION,
    frameMs: clampNumber(options.frameMs, 50, 1000, DEFAULT_V9_TURBO_FRAME_MS),
    riseScale: clampNumber(options.riseScale, 1, 32, V9_TURBO_TRANSITION.riseScale),
    deltaScale: clampNumber(options.deltaScale, 1, 32, V9_TURBO_TRANSITION.deltaScale),
    riseStable: clampNumber(options.riseStable, 0, 16, V9_TURBO_TRANSITION.riseStable),
    deltaStable: clampNumber(options.deltaStable, 0, 16, V9_TURBO_TRANSITION.deltaStable),
    riseBoost: clampNumber(options.riseBoost, 0, 0.25, V9_TURBO_TRANSITION.riseBoost),
    deltaBoost: clampNumber(options.deltaBoost, 0, 0.25, V9_TURBO_TRANSITION.deltaBoost),
    openGamma: clampNumber(options.openGamma, 0.25, 2, V9_TURBO_TRANSITION.openGamma),
    openFloor: clampNumber(options.openFloor, 0, 0.5, V9_TURBO_TRANSITION.openFloor),
    openRange: clampNumber(options.openRange, 0, 1, V9_TURBO_TRANSITION.openRange),
    openMax: clampNumber(options.openMax, 0.1, 1, V9_TURBO_TRANSITION.openMax),
  };
}

function boolOption(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function resolveV9TurboModulationConfig(options = {}) {
  const rawMode = String(options.modulation || options.modulationMode || options.mode || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  const wantsElectrolysis = rawMode === 'electrolysis'
    || rawMode === 'electrolysis-guitar'
    || rawMode === 'water-guitar'
    || rawMode === 'guitar'
    || rawMode === 'electric-guitar'
    || boolOption(options.electrolysis, false)
    || boolOption(options.electrolysisGuitar, false);
  const enabled = wantsElectrolysis && !['0', 'false', 'off', 'none', 'disabled'].includes(rawMode);
  const base = V9_ELECTROLYSIS_GUITAR_MODULATION;
  const frequencyHz = clampNumber(
    options.frequencyHz
    ?? options.modulationFrequencyHz
    ?? options.electrolysisHz
    ?? options.waterFrequencyHz,
    0.05,
    120,
    base.frequencyHz
  );
  const rawMin = options.frequencyMinHz
    ?? options.minFrequencyHz
    ?? options.frequencyLowHz
    ?? options.electrolysisMinHz
    ?? options.waterMinHz;
  const rawMax = options.frequencyMaxHz
    ?? options.maxFrequencyHz
    ?? options.frequencyHighHz
    ?? options.electrolysisMaxHz
    ?? options.waterMaxHz;
  const parsedMin = clampNumber(rawMin, 0.05, 120, base.frequencyMinHz);
  const parsedMax = clampNumber(rawMax, 0.05, 120, base.frequencyMaxHz);
  const frequencyMinHz = Math.min(parsedMin, parsedMax);
  const frequencyMaxHz = Math.max(parsedMin, parsedMax);
  return {
    ...base,
    enabled,
    mode: enabled ? base.mode : 'none',
    frequencyHz,
    frequencyMinHz,
    frequencyMaxHz,
    amount: enabled ? clampNumber(options.amount ?? options.modulationAmount, 0, 0.18, base.amount) : 0,
    irregularity: clampNumber(options.irregularity, 0, 1, base.irregularity),
    asymmetry: clampNumber(options.asymmetry, 0, 1, base.asymmetry),
    bidirectional: boolOption(options.bidirectional, base.bidirectional),
    followForce: clampNumber(options.followForce, 0, 1, base.followForce),
    schemaMix: clampNumber(options.schemaMix, 0, 1, base.schemaMix),
    note: enabled
      ? 'Audio-only modulation: electrolysis/water frequency is used as a texture seed, not as a physical electrolysis instruction.'
      : 'disabled',
  };
}

function lerpNumber(a, b, t) {
  return a + ((b - a) * clampNumber(t, 0, 1, 0));
}

function buildV9TurboOpenProfile(force, phaseGate, rise) {
  return {
    high: clampNumber(1 + (0.18 * force) + (0.055 * phaseGate) + (0.07 * rise), 1.02, 1.30, 1.02),
    low: clampNumber(1 - (0.070 * force) - (0.025 * rise), 0.88, 0.99, 0.99),
  };
}

function buildV9TurboAirProfile(force, phaseGate, rise) {
  return {
    high: 1.035 * clampNumber(1 + (0.14 * force) + (0.020 * phaseGate) + (0.16 * rise), 1.01, 1.34, 1.01),
    low: 0.985 * clampNumber(1 - (0.045 * force) - (0.040 * rise), 0.90, 1.00, 1.00),
  };
}

function sampleV9TurboOpenBlend({ force, tension, rise, forceDelta, transition }) {
  const stable = clampNumber(1 - (transition.riseStable * rise) - (transition.deltaStable * forceDelta), 0, 1, 0);
  const midForce = clampNumber(1 - (Math.abs(force - 0.50) / 0.50), 0, 1, 0);
  const voiceAffinity = clampNumber((0.56 * stable) + (0.28 * midForce) + (0.16 * (1 - tension)), 0, 1, 0);
  const rawOpen = clampNumber(1 - voiceAffinity, 0, 1, 0);
  const shapedOpen = rawOpen ** transition.openGamma;
  const edgeBoost = (transition.riseBoost * rise) + (transition.deltaBoost * forceDelta);
  return clampNumber(transition.openFloor + (transition.openRange * shapedOpen) + edgeBoost, 0, transition.openMax, 0);
}

function sampleV9ElectrolysisGuitarModulation({
  time,
  force,
  tension,
  phaseGate,
  rise,
  index,
  modulation,
}) {
  if (!modulation?.enabled || !(modulation.amount > 0)) {
    return { raw: 0, high: 1, low: 1 };
  }
  const minHz = Number.isFinite(Number(modulation.frequencyMinHz)) ? Number(modulation.frequencyMinHz) : modulation.frequencyHz;
  const maxHz = Number.isFinite(Number(modulation.frequencyMaxHz)) ? Number(modulation.frequencyMaxHz) : modulation.frequencyHz;
  const range = Math.max(0, maxHz - minHz);
  const sweepSeed = (0.46 * (Math.sin((TWO_PI * 0.137) * time + PHI) + 1) / 2)
    + (0.27 * (Math.sin((TWO_PI * 0.071) * time + C7 + (index * MG_PHASE)) + 1) / 2)
    + (0.27 * clampNumber((force * modulation.followForce) + (phaseGate * (1 - modulation.followForce)), 0, 1, 0.5));
  const hz = range > 0 ? minHz + (range * clampNumber(sweepSeed, 0, 1, 0.5)) : modulation.frequencyHz;
  const water = Math.sin(TWO_PI * hz * time);
  const sub = Math.sin((TWO_PI * (hz / 8)) * time + PHI);
  const cross = Math.sin((TWO_PI * (hz / PHI)) * time + Math.abs(JHI))
    * Math.sin((TWO_PI * (hz / 3)) * time + C7 + (index * MG_PHASE));
  const asymmetric = water >= 0
    ? water * (1 + modulation.asymmetry)
    : water * (1 - modulation.asymmetry);
  const schemaCarrier = ((phaseGate * 2) - 1);
  const schema = (modulation.schemaMix * schemaCarrier) + ((1 - modulation.schemaMix) * sub);
  const raw = clampNumber(
    (0.56 * asymmetric)
      + (0.28 * modulation.irregularity * cross)
      + (0.16 * schema),
    -1,
    1,
    0
  );
  const bipolar = modulation.bidirectional ? raw : Math.max(0, raw);
  const follow = clampNumber(
    (modulation.followForce * force) + ((1 - modulation.followForce) * (1 - tension)) + (0.18 * rise),
    0,
    1,
    0
  );
  const amount = modulation.amount * (0.44 + (0.56 * follow));
  return {
    raw: bipolar,
    high: clampNumber(1 + (amount * bipolar), 0.82, 1.22, 1),
    low: clampNumber(1 - (amount * bipolar * (0.72 + (0.28 * follow))), 0.82, 1.18, 1),
  };
}

function buildTurboAutomationSamplesV9({
  analysis,
  profile = 'blend',
  cycleSeconds,
  durationSeconds,
  sampleRate,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
  transition: transitionOptions,
  modulation: modulationOptions,
} = {}) {
  const variant = resolveV8Variant('v9turbo');
  const transition = resolveV9TurboTransitionConfig(transitionOptions);
  const modulation = resolveV9TurboModulationConfig(modulationOptions || transitionOptions || {});
  const resolvedPhaseSlots = resolveV8PhaseSlots(phaseSlots);
  const resolvedSampleRate = Math.round(clampNumber(sampleRate, MIN_V8_PHASE_SLOTS, MAX_V8_PHASE_SLOTS, resolvedPhaseSlots));
  const fallbackDuration = Number(analysis?.summary?.durationSeconds || 1) || 1;
  const duration = clampNumber(durationSeconds, 0.05, 7200, fallbackDuration);
  const sampleCount = Math.max(1, Math.ceil(duration * resolvedSampleRate));
  const highSamples = new Float32Array(sampleCount);
  const lowSamples = new Float32Array(sampleCount);
  const forces = new Float64Array(sampleCount);
  const tensions = new Float64Array(sampleCount);
  const c7Carriers = new Float64Array(sampleCount);
  const folded = new Float64Array(sampleCount);
  const d40Gains = new Float64Array(sampleCount);
  const baseStats = makeStats();
  const highStats = makeStats();
  const lowStats = makeStats();
  const foldedStats = makeStats();
  const forceStats = makeStats();
  const tensionStats = makeStats();
  const phaseGateStats = makeStats();
  const openBlendStats = makeStats();
  const riseStats = makeStats();
  const forceDeltaStats = makeStats();
  const highMultiplierStats = makeStats();
  const lowMultiplierStats = makeStats();
  const highMultiplierStepStats = makeStats();
  const lowMultiplierStepStats = makeStats();
  const modulationStats = makeStats();
  const modulationHighStats = makeStats();
  const modulationLowStats = makeStats();
  const blockGapStats = makeStats();
  const resolvedC7Scale = resolveV8C7PhaseScale(c7PhaseScale);
  const blockSize = Math.max(1, resolvedPhaseSlots);
  let blockCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / resolvedSampleRate;
    const closed = sampleClosedPhaseV8At(analysis, time, {
      variant,
      userK,
      kCeiling,
      phaseSlots: resolvedPhaseSlots,
    });
    const d40 = sampleD40EnvelopeAt(time, { profile, periodSeconds: cycleSeconds });
    forces[index] = closed.force;
    tensions[index] = closed.tension || 0;
    c7Carriers[index] = closed.c7Carrier;
    folded[index] = closed.folded;
    d40Gains[index] = d40.gain;
    addStat(foldedStats, closed.folded);
    addStat(forceStats, closed.force);
    addStat(tensionStats, closed.tension || 0);
  }

  let previousFolded = folded[0] || 0;
  let previousForce = forces[0] || 0;
  let previousHighMultiplier = null;
  let previousLowMultiplier = null;

  for (let start = 0; start < sampleCount; start += blockSize) {
    const end = Math.min(sampleCount, start + blockSize);
    const closure = buildCenteredPhaseClosureV8({
      forces: forces.subarray(start, end),
      c7Carriers: c7Carriers.subarray(start, end),
      c7PhaseScale: resolvedC7Scale,
      includePhases: true,
    });
    blockCount += 1;
    addStat(blockGapStats, Math.abs(closure.centered.closingGap));
    for (let localIndex = 0; localIndex < end - start; localIndex += 1) {
      const index = start + localIndex;
      const phaseGate = 0.5 + (0.5 * Math.sin(closure.phases[localIndex] + PHI));
      const base = d40Gains[index] * folded[index] * (0.72 + (0.28 * phaseGate));
      const force = clampNumber(forces[index], 0, 1, 0);
      const tension = clampNumber(tensions[index], 0, 1, 0);
      const rise = clampNumber((folded[index] - previousFolded) * transition.riseScale, 0, 1, 0);
      const forceDelta = clampNumber(Math.abs(force - previousForce) * transition.deltaScale, 0, 1, 0);
      const openBlend = sampleV9TurboOpenBlend({ force, tension, rise, forceDelta, transition });
      const open = buildV9TurboOpenProfile(force, phaseGate, rise);
      const air = buildV9TurboAirProfile(force, phaseGate, rise);
      const modulationSample = sampleV9ElectrolysisGuitarModulation({
        time: index / resolvedSampleRate,
        force,
        tension,
        phaseGate,
        rise,
        index,
        modulation,
      });
      const highMultiplier = lerpNumber(air.high, open.high, openBlend) * modulationSample.high;
      const lowMultiplier = lerpNumber(air.low, open.low, openBlend) * modulationSample.low;
      const highValue = base * highMultiplier;
      const lowValue = base * lowMultiplier;

      highSamples[index] = highValue;
      lowSamples[index] = lowValue;
      addStat(baseStats, base);
      addStat(highStats, highValue);
      addStat(lowStats, lowValue);
      addStat(phaseGateStats, phaseGate);
      addStat(openBlendStats, openBlend);
      addStat(riseStats, rise);
      addStat(forceDeltaStats, forceDelta);
      addStat(highMultiplierStats, highMultiplier);
      addStat(lowMultiplierStats, lowMultiplier);
      addStat(modulationStats, modulationSample.raw);
      addStat(modulationHighStats, modulationSample.high);
      addStat(modulationLowStats, modulationSample.low);
      if (previousHighMultiplier !== null) addStat(highMultiplierStepStats, Math.abs(highMultiplier - previousHighMultiplier));
      if (previousLowMultiplier !== null) addStat(lowMultiplierStepStats, Math.abs(lowMultiplier - previousLowMultiplier));

      previousFolded = folded[index];
      previousForce = force;
      previousHighMultiplier = highMultiplier;
      previousLowMultiplier = lowMultiplier;
    }
  }

  const probe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  const canonical = buildClosedPhaseMetricsV8({
    variant,
    phaseSlots: resolvedPhaseSlots,
    c7PhaseScale: resolvedC7Scale,
  });
  return {
    mode: 'dual-wav-envelope',
    variant: variant.key,
    sampleRate: resolvedSampleRate,
    durationSeconds: sampleCount / resolvedSampleRate,
    sampleCount,
    highSamples,
    lowSamples,
    profile: probe.profile,
    period: probe.period,
    density: probe.density,
    transition,
    modulation,
    phaseClosure: {
      slots: resolvedPhaseSlots,
      sampleRate: resolvedSampleRate,
      blockSize,
      blockCount,
      c7PhaseScale: resolvedC7Scale,
      canonical: canonical.closure,
      blockClosingGap: finishStats(blockGapStats),
    },
    summary: {
      base: finishStats(baseStats),
      high: finishStats(highStats),
      low: finishStats(lowStats),
      folded: finishStats(foldedStats),
      force: finishStats(forceStats),
      tension: finishStats(tensionStats),
      phaseGate: finishStats(phaseGateStats),
      openBlend: finishStats(openBlendStats),
      rise: finishStats(riseStats),
      forceDelta: finishStats(forceDeltaStats),
      highMultiplier: finishStats(highMultiplierStats),
      lowMultiplier: finishStats(lowMultiplierStats),
      modulation: finishStats(modulationStats),
      modulationHigh: finishStats(modulationHighStats),
      modulationLow: finishStats(modulationLowStats),
      highMultiplierStepDelta: finishStats(highMultiplierStepStats),
      lowMultiplierStepDelta: finishStats(lowMultiplierStepStats),
    },
  };
}

function buildTurboEnvelopePathsV9(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v9-turbo')).replace(/[^a-z0-9._-]+/gi, '_');
  const dir = path.dirname(outputPath);
  return {
    high: path.join(dir, `.${safeBase}.v9-turbo-high-envelope.wav`),
    low: path.join(dir, `.${safeBase}.v9-turbo-low-envelope.wav`),
  };
}

function buildTurboD40FilterV9(options = {}) {
  const built = buildClosedPhaseD40FilterV8({
    ...options,
    variant: 'v9turbo',
  });
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';
  return {
    ...built,
    filter: [
      '[0:a]asplit=3[full][h][l]',
      `[full]aresample=${D40_RENDER_SAMPLE_RATE},aformat=sample_fmts=flt:channel_layouts=stereo[dry]`,
      `[1:a]aresample=${D40_RENDER_SAMPLE_RATE},aformat=sample_fmts=flt:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[eh]`,
      `[2:a]aresample=${D40_RENDER_SAMPLE_RATE},aformat=sample_fmts=flt:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[el]`,
      `[h]rubberband=pitch=${numberText(built.highPitch)}:${rubberbandOptions},volume=${numberText(built.highWeight)}:eval=frame,aresample=${D40_RENDER_SAMPLE_RATE},aformat=sample_fmts=flt:channel_layouts=stereo[hb]`,
      `[l]rubberband=pitch=${numberText(built.lowPitch)}:${rubberbandOptions},volume=${numberText(built.lowWeight)}:eval=frame,aresample=${D40_RENDER_SAMPLE_RATE},aformat=sample_fmts=flt:channel_layouts=stereo[lb]`,
      '[hb][eh]amultiply[ho]',
      '[lb][el]amultiply[lo]',
      "[dry][ho][lo]amix=inputs=3:weights='1 1 1':normalize=0[out]",
    ].join(';'),
  };
}

function buildTurboD40ArgsV9({
  inputPath,
  outputPath,
  profile = 'blend',
  cycleSeconds,
  highEnvelopePath,
  lowEnvelopePath,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
} = {}) {
  if (!highEnvelopePath) throw new Error('missing_high_envelope_path');
  if (!lowEnvelopePath) throw new Error('missing_low_envelope_path');
  const built = buildTurboD40FilterV9({
    profile,
    cycleSeconds,
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
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
      highEnvelopePath,
      '-i',
      lowEnvelopePath,
      '-filter_complex',
      built.filter,
      '-map',
      '[out]',
      '-ac',
      '2',
      '-ar',
      String(D40_RENDER_SAMPLE_RATE),
      ...buildOutputCodecArgs(outputPath),
      outputPath,
    ],
  };
}

async function processClosedPhaseD40V8({
  inputPath,
  outputPath,
  profile = 'blend',
  timeoutMs,
  analysisOptions = {},
} = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');

  const variant = resolveV8Variant(analysisOptions.variant);
  const grainPair = resolveV8GrainPair(variant);
  const userK = resolveV6UserK(
    analysisOptions.userK
    ?? analysisOptions.resonanceK
    ?? analysisOptions.intensity
    ?? analysisOptions.harmonicIntensity
  );
  const kCeiling = resolveV6KCeiling(analysisOptions.kCeiling);
  const phaseSlots = resolveV8PhaseSlots(analysisOptions.phaseSlots || analysisOptions.binaryGridSlots);
  const c7PhaseScale = resolveV8C7PhaseScale(analysisOptions.c7PhaseScale);
  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const analysisMaxSeconds = analysisOptions.maxSeconds
    || (probedDuration ? Math.min(900, probedDuration + 0.5) : undefined);
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: analysisOptions.frameMs || DEFAULT_V8_FRAME_MS,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments || DEFAULT_V8_MAX_SEGMENTS,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve || DEFAULT_V8_CURVE,
    curveAmount: analysisOptions.curveAmount ?? DEFAULT_V8_CURVE_AMOUNT,
    attack: analysisOptions.attack ?? DEFAULT_V8_ATTACK,
    release: analysisOptions.release ?? DEFAULT_V8_RELEASE,
    minDbSpan: analysisOptions.minDbSpan || DEFAULT_V8_MIN_DB_SPAN,
    grainLow: grainPair.low,
    grainHigh: grainPair.high,
    swapPitchGrain: true,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
  const durationSeconds = Math.max(
    0.5,
    Number(probedDuration) || 0,
    Number(analysis.summary?.durationSeconds) || 0
  ) + 0.25;
  const automation = buildClosedPhaseAutomationSamplesV8({
    analysis,
    profile,
    variant,
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
  });
  const envelopePath = buildClosedPhaseEnvelopePath(outputPath, variant);
  writeFloat32MonoWav(envelopePath, automation.samples, automation.sampleRate);

  let built;
  try {
    const planned = buildClosedPhaseD40ArgsV8({
      inputPath,
      outputPath,
      profile,
      variant,
      cycleSeconds: analysisOptions.cycleSeconds,
      envelopePath,
      userK,
      kCeiling,
      phaseSlots,
      c7PhaseScale,
    });
    built = planned.built;
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V8_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePath, { force: true });
    }
  }

  return {
    method: built.method,
    state: built.state,
    variant: built.variant,
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: variant.intensity,
    d40: built.envelope.density,
    resonance: {
      userK,
      kCeiling,
      ratioHighToLow: built.ratioHighToLow,
      ratioFormula: built.dimensions.ratioFormula,
      mode: built.resonanceMode,
      transferMode: built.transferMode,
      wetCeiling: built.wetCeiling,
      highShare: built.highShare,
      lowShare: built.lowShare,
    },
    operators: built.operators,
    projection: built.projection,
    grain: built.grain,
    binaryGrid: built.binaryGrid,
    phaseClosure: {
      ...built.phaseClosure,
      runtime: automation.phaseClosure,
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
        phaseClosure: automation.phaseClosure,
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
      grainMode: built.grain.mode,
      dynamicMin: automation.summary.folded.min,
      dynamicMax: automation.summary.folded.max,
      dynamicMean: automation.summary.folded.mean,
      forceMin: automation.summary.force.min,
      forceMax: automation.summary.force.max,
      forceMean: automation.summary.force.mean,
      phaseGateMin: automation.summary.phaseGate.min,
      phaseGateMax: automation.summary.phaseGate.max,
      phaseGateMean: automation.summary.phaseGate.mean,
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

async function processTurboD40V9({
  inputPath,
  outputPath,
  profile = 'blend',
  timeoutMs,
  analysisOptions = {},
} = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');

  const variant = resolveV8Variant('v9turbo');
  const grainPair = resolveV8GrainPair(variant);
  const transition = resolveV9TurboTransitionConfig({
    ...analysisOptions,
    frameMs: analysisOptions.frameMs || DEFAULT_V9_TURBO_FRAME_MS,
  });
  const modulation = resolveV9TurboModulationConfig(analysisOptions);
  const userK = resolveV6UserK(
    analysisOptions.userK
    ?? analysisOptions.resonanceK
    ?? analysisOptions.intensity
    ?? analysisOptions.harmonicIntensity
  );
  const kCeiling = resolveV6KCeiling(analysisOptions.kCeiling);
  const phaseSlots = resolveV8PhaseSlots(analysisOptions.phaseSlots || analysisOptions.binaryGridSlots);
  const c7PhaseScale = resolveV8C7PhaseScale(analysisOptions.c7PhaseScale);
  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const analysisMaxSeconds = analysisOptions.maxSeconds
    || (probedDuration ? Math.min(900, probedDuration + 0.5) : undefined);
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: transition.frameMs,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments || DEFAULT_V9_TURBO_MAX_SEGMENTS,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve || DEFAULT_V8_CURVE,
    curveAmount: analysisOptions.curveAmount ?? DEFAULT_V8_CURVE_AMOUNT,
    attack: analysisOptions.attack ?? DEFAULT_V9_TURBO_ATTACK,
    release: analysisOptions.release ?? DEFAULT_V9_TURBO_RELEASE,
    minDbSpan: analysisOptions.minDbSpan || DEFAULT_V8_MIN_DB_SPAN,
    grainLow: grainPair.low,
    grainHigh: grainPair.high,
    swapPitchGrain: true,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
  const durationSeconds = Math.max(
    0.5,
    Number(probedDuration) || 0,
    Number(analysis.summary?.durationSeconds) || 0
  ) + 0.25;
  const automation = buildTurboAutomationSamplesV9({
    analysis,
    profile,
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
    transition,
    modulation,
  });
  const envelopePaths = buildTurboEnvelopePathsV9(outputPath);
  writeFloat32MonoWav(envelopePaths.high, automation.highSamples, automation.sampleRate);
  writeFloat32MonoWav(envelopePaths.low, automation.lowSamples, automation.sampleRate);

  let built;
  try {
    const planned = buildTurboD40ArgsV9({
      inputPath,
      outputPath,
      profile,
      cycleSeconds: analysisOptions.cycleSeconds,
      highEnvelopePath: envelopePaths.high,
      lowEnvelopePath: envelopePaths.low,
      userK,
      kCeiling,
      phaseSlots,
      c7PhaseScale,
    });
    built = planned.built;
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V9_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePaths.high, { force: true });
      fs.rmSync(envelopePaths.low, { force: true });
    }
  }

  return {
    method: built.method,
    state: built.state,
    variant: built.variant,
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: variant.intensity,
    d40: built.envelope.density,
    resonance: {
      userK,
      kCeiling,
      ratioHighToLow: built.ratioHighToLow,
      ratioFormula: built.dimensions.ratioFormula,
      mode: built.resonanceMode,
      transferMode: built.transferMode,
      wetCeiling: built.wetCeiling,
      highShare: built.highShare,
      lowShare: built.lowShare,
    },
    operators: built.operators,
    projection: built.projection,
    grain: built.grain,
    binaryGrid: built.binaryGrid,
    phaseClosure: {
      ...built.phaseClosure,
      runtime: automation.phaseClosure,
    },
    dynamic: {
      schema: analysis.schema,
      frameMs: analysis.frameMs,
      controls: analysis.controls,
      summary: analysis.summary,
      transition: automation.transition,
      modulation: automation.modulation,
      automation: {
        mode: automation.mode,
        sampleRate: automation.sampleRate,
        durationSeconds: automation.durationSeconds,
        sampleCount: automation.sampleCount,
        phaseClosure: automation.phaseClosure,
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
      grainMode: built.grain.mode,
      transitionFrameMs: automation.transition.frameMs,
      dynamicMin: automation.summary.base.min,
      dynamicMax: automation.summary.base.max,
      dynamicMean: automation.summary.base.mean,
      highDynamicMin: automation.summary.high.min,
      highDynamicMax: automation.summary.high.max,
      highDynamicMean: automation.summary.high.mean,
      lowDynamicMin: automation.summary.low.min,
      lowDynamicMax: automation.summary.low.max,
      lowDynamicMean: automation.summary.low.mean,
      highMultiplierMean: automation.summary.highMultiplier.mean,
      lowMultiplierMean: automation.summary.lowMultiplier.mean,
      modulationMean: automation.summary.modulation.mean,
      modulationHighMean: automation.summary.modulationHigh.mean,
      modulationLowMean: automation.summary.modulationLow.mean,
      highMultiplierStepMean: automation.summary.highMultiplierStepDelta.mean,
      lowMultiplierStepMean: automation.summary.lowMultiplierStepDelta.mean,
      openBlendMean: automation.summary.openBlend.mean,
      forceMin: automation.summary.force.min,
      forceMax: automation.summary.force.max,
      forceMean: automation.summary.force.mean,
      phaseGateMin: automation.summary.phaseGate.min,
      phaseGateMax: automation.summary.phaseGate.max,
      phaseGateMean: automation.summary.phaseGate.mean,
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
      dimensions: built.dimensions,
      finalGainDb: 0,
      finalLimiter: false,
      filters: 'none',
    },
    safety: {
      ...built.safety,
      electrolysisGuitarModulation: automation.modulation.enabled,
      modulationAudioOnlyNoPhysicalElectrolysis: true,
    },
  };
}

function buildClosedPhaseD40PlanV8(options = {}) {
  const variant = resolveV8Variant(options.variant);
  const isTurbo = variant.key === 'v9turbo';
  const transition = isTurbo
    ? resolveV9TurboTransitionConfig({ ...options, frameMs: options.frameMs || DEFAULT_V9_TURBO_FRAME_MS })
    : null;
  const modulation = isTurbo ? resolveV9TurboModulationConfig(options) : null;
  const frameMs = clampNumber(options.frameMs, 50, 1000, isTurbo ? DEFAULT_V9_TURBO_FRAME_MS : DEFAULT_V8_FRAME_MS);
  const maxSeconds = clampNumber(options.maxSeconds, 1, 900, 480);
  const userK = resolveV6UserK(options.userK ?? options.resonanceK ?? options.intensity ?? options.harmonicIntensity);
  const kCeiling = resolveV6KCeiling(options.kCeiling);
  const phaseSlots = resolveV8PhaseSlots(options.phaseSlots || options.binaryGridSlots);
  const c7PhaseScale = resolveV8C7PhaseScale(options.c7PhaseScale);
  const built = buildClosedPhaseD40FilterV8({
    variant,
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
    profile: options.profile || 'blend',
  });
  const pivotGrain = isPivotGrainVariant(variant);
  return {
    schema: variant.schema,
    method: variant.method,
    state: variant.state,
    variant: variant.key,
    profile: 'blend',
    preset: variant.preset,
    frameMs,
    maxSeconds,
    d40: built.envelope.density,
    dimensions: built.dimensions,
    resonance: {
      userK,
      kCeiling,
      mode: built.resonanceMode,
      transferMode: built.transferMode,
      base: variant.key === 'v8plus'
        ? 'V8 closure preserved, grain pair switched to e2 for parallel listening test.'
        : variant.key === 'v9turbo'
          ? 'V8 Pivot closure and grain preserved, high/low branch weights get vocal-safe 99 ms dynamic envelopes.'
        : pivotGrain
          ? 'V8 closure preserved, grain pair locks exact 1024 slots and pivot 0.292.'
        : 'V6 Supreme wet ceiling, pitches and M/K ratio are preserved.',
      wetCeiling: built.wetCeiling,
    },
    operators: built.operators,
    projection: built.projection,
    grain: built.grain,
    binaryGrid: built.binaryGrid,
    phaseClosure: built.phaseClosure,
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
      phaseSlots: DEFAULT_V8_PHASE_SLOTS,
      c7PhaseScale: C7_PHASE_SCALE,
      frameMs: isTurbo ? DEFAULT_V9_TURBO_FRAME_MS : DEFAULT_V8_FRAME_MS,
      maxSegments: isTurbo ? DEFAULT_V9_TURBO_MAX_SEGMENTS : DEFAULT_V8_MAX_SEGMENTS,
      curve: DEFAULT_V8_CURVE,
      curveAmount: DEFAULT_V8_CURVE_AMOUNT,
      attack: isTurbo ? DEFAULT_V9_TURBO_ATTACK : DEFAULT_V8_ATTACK,
      release: isTurbo ? DEFAULT_V9_TURBO_RELEASE : DEFAULT_V8_RELEASE,
      minDbSpan: DEFAULT_V8_MIN_DB_SPAN,
      transition: transition || undefined,
      modulation: modulation || undefined,
    },
    safety: isTurbo ? {
      ...built.safety,
      electrolysisGuitarModulation: Boolean(modulation?.enabled),
      modulationAudioOnlyNoPhysicalElectrolysis: true,
    } : built.safety,
  };
}

function buildClosedPhaseD40PlanV8Plus(options = {}) {
  return buildClosedPhaseD40PlanV8({
    ...options,
    variant: 'v8plus',
  });
}

function buildClosedPhaseD40PlanV8Pivot(options = {}) {
  return buildClosedPhaseD40PlanV8({
    ...options,
    variant: 'v8pivot',
  });
}

function buildTurboD40PlanV9(options = {}) {
  return buildClosedPhaseD40PlanV8({
    ...options,
    frameMs: options.frameMs || DEFAULT_V9_TURBO_FRAME_MS,
    variant: 'v9turbo',
  });
}

async function processClosedPhaseD40V8Plus(options = {}) {
  return processClosedPhaseD40V8({
    ...options,
    analysisOptions: {
      ...(options.analysisOptions || {}),
      variant: 'v8plus',
    },
  });
}

async function processClosedPhaseD40V8Pivot(options = {}) {
  return processClosedPhaseD40V8({
    ...options,
    analysisOptions: {
      ...(options.analysisOptions || {}),
      variant: 'v8pivot',
    },
  });
}

module.exports = {
  C7,
  C7_PHASE_SCALE,
  CLOSED_PHASE_D40_V8_SCHEMA,
  CLOSED_PHASE_D40_V8_PLUS_SCHEMA,
  CLOSED_PHASE_D40_V8_PIVOT_SCHEMA,
  DEFAULT_V9_TURBO_FRAME_MS,
  DEFAULT_V9_TURBO_MAX_SEGMENTS,
  DEFAULT_V9_TURBO_ATTACK,
  DEFAULT_V9_TURBO_RELEASE,
  GRAIN_E2_HIGH,
  GRAIN_E2_LOW,
  GRAIN_PIVOT_DELTA,
  GRAIN_PIVOT_HIGH,
  GRAIN_PIVOT_LOW,
  GRAIN_PIVOT_PRODUCT_1024,
  GRAIN_PIVOT_TARGET,
  H_D40,
  JHI,
  PHASE_DELTA,
  PHI,
  V8_METHOD,
  V8_PLUS_METHOD,
  V8_PIVOT_METHOD,
  V9_TURBO_METHOD,
  V8_PLUS_PRESET,
  V8_PLUS_STATE,
  V8_PIVOT_PRESET,
  V8_PIVOT_STATE,
  V9_TURBO_PRESET,
  V9_TURBO_STATE,
  V8_PRESET,
  V8_STATE,
  V9_TURBO_TRANSITION,
  V9_ELECTROLYSIS_GUITAR_MODULATION,
  TURBO_D40_V9_SCHEMA,
  buildClosedPhaseD40PlanV8Pivot,
  buildClosedPhaseD40PlanV8Plus,
  buildCenteredPhaseClosureV8,
  buildClosedPhaseAutomationSamplesV8,
  buildClosedPhaseD40ArgsV8,
  buildClosedPhaseD40FilterV8,
  buildClosedPhaseD40PlanV8,
  buildClosedPhaseMetricsV8,
  buildClosedPhaseOperatorsV8,
  buildD40StepProjectionV8,
  buildTurboAutomationSamplesV9,
  buildTurboD40ArgsV9,
  buildTurboD40FilterV9,
  buildTurboD40PlanV9,
  buildV8GrainResearch,
  processClosedPhaseD40V8,
  processClosedPhaseD40V8Pivot,
  processClosedPhaseD40V8Plus,
  processTurboD40V9,
  resolveV9TurboModulationConfig,
  resolveV9TurboTransitionConfig,
  sampleV9ElectrolysisGuitarModulation,
  resolveV8C7PhaseScale,
  resolveV8GrainPair,
  resolveV8PhaseSlots,
  resolveV8Variant,
  sampleClosedPhaseV8At,
};

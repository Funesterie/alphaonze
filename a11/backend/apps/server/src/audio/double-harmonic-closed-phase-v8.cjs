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
  resolveResonanceDimensionPairV6,
  resolveV6KCeiling,
  resolveV6UserK,
  buildResonanceD40FilterV6,
  sampleResonanceMkV6At,
} = require('./double-harmonic-resonance-v6.cjs');
const {
  buildBinaryGridMetricsV71,
} = require('./double-harmonic-bricks-v7.cjs');

const CLOSED_PHASE_D40_V8_SCHEMA = 'funesterie.audio.double-harmonic-closed-phase-d40.v8';
const V8_METHOD = 'dry-first-centered-increment-mg-phase-1024-d40-harmonic-overlay-v8';
const V8_STATE = 'v8-closed-phase-candidate';
const V8_PRESET = 'v8-fermeture-1024-mg-phase-c7-k3';
const DEFAULT_V8_FRAME_MS = 250;
const DEFAULT_V8_MAX_SEGMENTS = 2400;
const DEFAULT_V8_CURVE = 'grain-6d7d8d';
const DEFAULT_V8_CURVE_AMOUNT = 0.3;
const DEFAULT_V8_ATTACK = 0.78;
const DEFAULT_V8_RELEASE = 0.32;
const DEFAULT_V8_MIN_DB_SPAN = 8;
const DEFAULT_V8_PHASE_SLOTS = 1024;
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

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
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
  const phaseSlots = resolveV8PhaseSlots(options.phaseSlots || options.slots);
  const c7PhaseScale = resolveV8C7PhaseScale(options.c7PhaseScale);
  const canonical = buildCanonicalClosureInputsV8(phaseSlots);
  const closure = buildCenteredPhaseClosureV8({
    forces: canonical.forces,
    c7Carriers: canonical.c7Carriers,
    c7PhaseScale,
  });
  return {
    schema: 'funesterie.audio.double-harmonic-closed-phase-metrics.v8',
    operators: buildClosedPhaseOperatorsV8(),
    projection: buildD40StepProjectionV8(),
    binaryGrid: buildBinaryGridMetricsV71(),
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

function buildClosedPhaseEnvelopePath(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v8')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.v8-closed-phase-envelope.wav`);
}

function sampleClosedPhaseV8At(analysis = {}, timeSeconds = 0, options = {}) {
  const v6 = sampleResonanceMkV6At(analysis, timeSeconds, options);
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
  };
}

function buildClosedPhaseAutomationSamplesV8({
  analysis,
  profile = 'blend',
  cycleSeconds,
  durationSeconds,
  sampleRate,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
} = {}) {
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
    phaseSlots: resolvedPhaseSlots,
    c7PhaseScale: resolvedC7Scale,
  });
  return {
    mode: 'wav-envelope',
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
  cycleSeconds,
  userK,
  kCeiling,
  phaseSlots,
  c7PhaseScale,
} = {}) {
  const built = buildResonanceD40FilterV6({ profile, cycleSeconds, userK, kCeiling });
  const metrics = buildClosedPhaseMetricsV8({ phaseSlots, c7PhaseScale });
  return {
    ...built,
    schema: CLOSED_PHASE_D40_V8_SCHEMA,
    method: V8_METHOD,
    state: V8_STATE,
    preset: V8_PRESET,
    operators: metrics.operators,
    projection: metrics.projection,
    phaseClosure: metrics.closure,
    resonanceMode: 'centered-phase-soft-fold',
    transferMode: 'centered-increment-mg-phase',
    safety: {
      ...built.safety,
      v6StableUntouched: true,
      mgPhaseFixed: true,
      mgPhaseIsPhaseIncrement: true,
      noDirectMgOffset: true,
      centeredIncrements: true,
      phaseSlots: metrics.closure.slots,
      exact1024GridDefault: metrics.closure.slots === DEFAULT_V8_PHASE_SLOTS,
      c7IsProjectionNotGain: true,
      pivotResidualOldIsNotMgPhase: true,
    },
  };
}

function buildClosedPhaseD40ArgsV8({
  inputPath,
  outputPath,
  profile = 'blend',
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
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
  });
  const envelopePath = buildClosedPhaseEnvelopePath(outputPath);
  writeFloat32MonoWav(envelopePath, automation.samples, automation.sampleRate);

  let built;
  try {
    const planned = buildClosedPhaseD40ArgsV8({
      inputPath,
      outputPath,
      profile,
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
    profile: built.envelope.profile,
    preset: built.preset,
    intensity: 'closed-phase-1024',
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

function buildClosedPhaseD40PlanV8(options = {}) {
  const frameMs = clampNumber(options.frameMs, 50, 1000, DEFAULT_V8_FRAME_MS);
  const maxSeconds = clampNumber(options.maxSeconds, 1, 900, 480);
  const userK = resolveV6UserK(options.userK ?? options.resonanceK ?? options.intensity ?? options.harmonicIntensity);
  const kCeiling = resolveV6KCeiling(options.kCeiling);
  const phaseSlots = resolveV8PhaseSlots(options.phaseSlots || options.binaryGridSlots);
  const c7PhaseScale = resolveV8C7PhaseScale(options.c7PhaseScale);
  const built = buildClosedPhaseD40FilterV8({
    userK,
    kCeiling,
    phaseSlots,
    c7PhaseScale,
    profile: options.profile || 'blend',
  });
  return {
    schema: CLOSED_PHASE_D40_V8_SCHEMA,
    method: V8_METHOD,
    state: V8_STATE,
    profile: 'blend',
    preset: V8_PRESET,
    frameMs,
    maxSeconds,
    d40: built.envelope.density,
    dimensions: resolveResonanceDimensionPairV6(),
    resonance: {
      userK,
      kCeiling,
      mode: built.resonanceMode,
      transferMode: built.transferMode,
      base: 'V6 Supreme wet ceiling, pitches and M/K ratio are preserved.',
      wetCeiling: built.wetCeiling,
    },
    operators: built.operators,
    projection: built.projection,
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
      frameMs: DEFAULT_V8_FRAME_MS,
      maxSegments: DEFAULT_V8_MAX_SEGMENTS,
      curve: DEFAULT_V8_CURVE,
      curveAmount: DEFAULT_V8_CURVE_AMOUNT,
      attack: DEFAULT_V8_ATTACK,
      release: DEFAULT_V8_RELEASE,
      minDbSpan: DEFAULT_V8_MIN_DB_SPAN,
    },
    safety: built.safety,
  };
}

module.exports = {
  C7,
  C7_PHASE_SCALE,
  CLOSED_PHASE_D40_V8_SCHEMA,
  H_D40,
  JHI,
  PHASE_DELTA,
  PHI,
  V8_METHOD,
  V8_PRESET,
  V8_STATE,
  buildCenteredPhaseClosureV8,
  buildClosedPhaseAutomationSamplesV8,
  buildClosedPhaseD40ArgsV8,
  buildClosedPhaseD40FilterV8,
  buildClosedPhaseD40PlanV8,
  buildClosedPhaseMetricsV8,
  buildClosedPhaseOperatorsV8,
  buildD40StepProjectionV8,
  processClosedPhaseD40V8,
  resolveV8C7PhaseScale,
  resolveV8PhaseSlots,
  sampleClosedPhaseV8At,
};

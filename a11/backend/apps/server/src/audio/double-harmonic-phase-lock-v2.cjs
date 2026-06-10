'use strict';

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  D40_SOURCE_DENSITY,
  D40_SOURCE_N,
  D40_TARGET_N,
  MG_PHASE,
  ONE_OVER_E,
  PIVOT_RESIDUAL_OLD,
  TARGET_0005_PI,
  T_LINEAR,
  resolveD40Density,
} = require('./double-harmonic-d40.cjs');

const PHASE_LOCK_SCHEMA = 'funesterie.audio.double-harmonic-phase-lock.v2';
const DEFAULT_FRAME_MS = 40;
const DEFAULT_CYCLE_SECONDS = 4;
const DEFAULT_SMOOTHING = 't-linear';

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeSmoothing(value = DEFAULT_SMOOTHING) {
  const key = String(value || DEFAULT_SMOOTHING).trim().toLowerCase();
  if (key === 'e' || key === '1/e' || key === 'one-over-e' || key === 'dissipation') return 'one-over-e';
  if (key === 't' || key === 'tlinear' || key === 't-linear' || key === 'linear') return 't-linear';
  return DEFAULT_SMOOTHING;
}

function resolvePhaseLockConstants(options = {}) {
  const d40 = resolveD40Density(options);
  const smoothingMode = normalizeSmoothing(options.smoothing);
  const smoothingValue = smoothingMode === 'one-over-e' ? ONE_OVER_E : T_LINEAR;
  const phaseCorrectionRadians = MG_PHASE * (Math.PI / 2);

  return {
    schema: PHASE_LOCK_SCHEMA,
    d40,
    pivot: D40_SOURCE_DENSITY,
    sourceCycle: D40_SOURCE_N,
    targetCycle: D40_TARGET_N,
    pivotResidualOld: PIVOT_RESIDUAL_OLD,
    audioPivotGainFactor: AUDIO_PIVOT_GAIN_FACTOR,
    mgPhase: MG_PHASE,
    mgPhaseUnit: 'pi/2-face',
    phaseCorrectionRadians,
    target0005Pi: TARGET_0005_PI,
    targetMinusMgPhase: TARGET_0005_PI - MG_PHASE,
    smoothingMode,
    smoothingValue,
  };
}

function buildPhaseLockPlan(options = {}) {
  const constants = resolvePhaseLockConstants(options);
  const frameMs = clampNumber(options.frameMs, 5, 200, DEFAULT_FRAME_MS);
  const cycleSeconds = clampNumber(options.cycleSeconds, 0.5, 30, DEFAULT_CYCLE_SECONDS);
  const framesPerCycle = Math.max(1, Math.round((cycleSeconds * 1000) / frameMs));

  return {
    schema: PHASE_LOCK_SCHEMA,
    method: 'dry-first-d40-phase-lock-analysis-plan-v2',
    state: 'analysis-plan',
    preservesV1: true,
    frameMs,
    cycleSeconds,
    framesPerCycle,
    analysis: {
      requiredTracks: [
        'f0Track',
        'instantaneousPhase',
        'bandEnergy',
        'transientMap',
      ],
      suggestedMethods: {
        f0Track: ['pyin', 'yin', 'crepe-or-torchcrepe'],
        phase: ['stft-phase-vocoder', 'hilbert-instantaneous-phase'],
        separation: ['voice-band-protect-mix', 'demucs-or-stem-input-optional'],
      },
    },
    controls: {
      d40Envelope: constants.d40,
      phase: {
        mgPhase: constants.mgPhase,
        unit: constants.mgPhaseUnit,
        radians: constants.phaseCorrectionRadians,
      },
      smoothing: {
        mode: constants.smoothingMode,
        value: constants.smoothingValue,
        oneOverE: ONE_OVER_E,
        tLinear: T_LINEAR,
      },
      pivot: {
        density: constants.pivot,
        residualOld: constants.pivotResidualOld,
        gainFactor: constants.audioPivotGainFactor,
      },
    },
    stages: [
      'decode-preserve-source-format',
      'optional-stem-or-voice-band-isolation',
      'frame-analysis-f0-phase-energy-transients',
      'd40-cycle-envelope',
      'mg-phase-micro-correction',
      'phase-coherent-harmonic-overlay',
      'dry-first-protect-mix',
      'encode-like-source-format',
    ],
    safety: {
      dryFirst: true,
      noMasterDestructivePhaseWarp: true,
      keepV1RouteUntouched: true,
      metricsRequiredBeforeDefault: ['lufsMatchedAB', 'monoCorrelation', 'phaseErrorMean', 'transientDriftMs'],
    },
  };
}

module.exports = {
  DEFAULT_CYCLE_SECONDS,
  DEFAULT_FRAME_MS,
  DEFAULT_SMOOTHING,
  PHASE_LOCK_SCHEMA,
  buildPhaseLockPlan,
  normalizeSmoothing,
  resolvePhaseLockConstants,
};

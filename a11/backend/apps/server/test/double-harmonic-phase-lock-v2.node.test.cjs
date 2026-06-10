'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  MG_PHASE,
  ONE_OVER_E,
  PIVOT_RESIDUAL_OLD,
  TARGET_0005_PI,
  T_LINEAR,
} = require('../src/audio/double-harmonic-d40.cjs');
const {
  PHASE_LOCK_SCHEMA,
  analyzePcmPhaseLockV2,
  buildPhaseLockPlan,
  normalizeSmoothing,
  resolvePhaseLockConstants,
} = require('../src/audio/double-harmonic-phase-lock-v2.cjs');

function sineWave({ frequency = 220, sampleRate = 16000, seconds = 1 } = {}) {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin((Math.PI * 2 * frequency * index) / sampleRate) * 0.5;
  }
  return samples;
}

test('phase-lock v2 keeps mg_phase separate from the old pivot residual', () => {
  const constants = resolvePhaseLockConstants();

  assert.equal(constants.schema, PHASE_LOCK_SCHEMA);
  assert.equal(constants.mgPhase, MG_PHASE);
  assert.equal(constants.pivotResidualOld, PIVOT_RESIDUAL_OLD);
  assert.notEqual(constants.mgPhase, constants.pivotResidualOld);
  assert.equal(constants.audioPivotGainFactor, AUDIO_PIVOT_GAIN_FACTOR);
  assert.equal(constants.target0005Pi, TARGET_0005_PI);
  assert.equal(
    Number(constants.phaseCorrectionRadians.toFixed(15)),
    Number((MG_PHASE * (Math.PI / 2)).toFixed(15))
  );
});

test('phase-lock v2 separates D40 envelope, phase correction and smoothing', () => {
  const plan = buildPhaseLockPlan({ frameMs: 20, cycleSeconds: 4, smoothing: '1/e' });

  assert.equal(plan.state, 'analysis-plan');
  assert.equal(plan.preservesV1, true);
  assert.equal(plan.frameMs, 20);
  assert.equal(plan.framesPerCycle, 200);
  assert.equal(plan.controls.d40Envelope.value, 0.2919963500456244);
  assert.equal(plan.controls.phase.mgPhase, MG_PHASE);
  assert.equal(plan.controls.smoothing.mode, 'one-over-e');
  assert.equal(plan.controls.smoothing.value, ONE_OVER_E);
  assert.equal(plan.controls.smoothing.tLinear, T_LINEAR);
  assert.equal(plan.safety.keepV1RouteUntouched, true);
  assert.ok(plan.analysis.requiredTracks.includes('f0Track'));
  assert.ok(plan.analysis.requiredTracks.includes('instantaneousPhase'));
});

test('smoothing names normalize without changing phase constants', () => {
  assert.equal(normalizeSmoothing('dissipation'), 'one-over-e');
  assert.equal(normalizeSmoothing('linear'), 't-linear');

  const eMode = resolvePhaseLockConstants({ smoothing: 'dissipation' });
  const tMode = resolvePhaseLockConstants({ smoothing: 'linear' });

  assert.equal(eMode.smoothingValue, ONE_OVER_E);
  assert.equal(tMode.smoothingValue, T_LINEAR);
  assert.equal(eMode.mgPhase, tMode.mgPhase);
  assert.equal(eMode.pivotResidualOld, tMode.pivotResidualOld);
});

test('phase-lock v2 analysis extracts f0, phase and D40 frame guidance', () => {
  const analysis = analyzePcmPhaseLockV2({
    samples: sineWave({ frequency: 220 }),
    sampleRate: 16000,
    frameMs: 40,
    cycleSeconds: 4,
    maxFrameDetails: 12,
  });

  assert.equal(analysis.state, 'measured-analysis');
  assert.equal(analysis.preservesV1, true);
  assert.equal(analysis.summary.framesReturned, 12);
  assert.ok(analysis.summary.voicedFrames > 20);
  assert.ok(Math.abs(analysis.summary.medianF0 - 220) < 4);
  assert.ok(analysis.summary.meanF0Confidence > 0.8);
  assert.ok(analysis.summary.meanPhaseErrorRadians > 0);
  assert.ok(analysis.summary.d40GainMax > analysis.summary.d40GainMin);
  assert.equal(analysis.frames[0].phaseTargetRadians, analysis.frames[0].phaseErrorRadians + analysis.frames[0].phaseRadians);
  assert.ok(Object.prototype.hasOwnProperty.call(analysis.frames[0].bandEnergy, 'presence'));
});

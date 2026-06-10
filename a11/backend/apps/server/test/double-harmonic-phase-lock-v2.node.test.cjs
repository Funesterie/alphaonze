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
  buildPhaseLockPlan,
  normalizeSmoothing,
  resolvePhaseLockConstants,
} = require('../src/audio/double-harmonic-phase-lock-v2.cjs');

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

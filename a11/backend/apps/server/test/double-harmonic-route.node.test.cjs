'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const createDoubleHarmonicRouter = require('../src/routes/double-harmonic.cjs');
const {
  BALANCE_AUTO,
  buildD40EnvelopeExpression,
  buildProtectMixD40Args,
  buildProtectMixD40Filter,
  MAX_HARMONIC_INTENSITY,
  MICROGAP_HALF_PLUS_CANON_MG,
  MIN_HARMONIC_INTENSITY,
  resolveHarmonicIntensity,
  resolveD40Density,
} = require('../src/audio/double-harmonic-d40.cjs');
const {
  analyzePcmDynamicWeightV3,
  buildDynamicAutomationSamples,
  buildDynamicWeightD40Filter,
  buildDynamicWeightPlanV3,
  GRAIN_18_36_DELTA,
  GRAIN_6D_LOG_WEIGHT,
  GRAIN_7D_LN_WEIGHT,
  GRAIN_8D_BASS_WEIGHT,
  GRAIN_Q_SPECTRAL,
  GRAIN_SPECTRAL_REMAINDER,
  GRAIN_SPECTRAL_HIGH,
  GRAIN_SPECTRAL_LOW,
  D8_BASS_HIGHPASS_HZ,
  D8_BASS_LOW_CUTOFF_HZ,
  D8_BASS_SHARE,
  D8_BODY_LOW_CUTOFF_HZ,
  D8_BODY_SHARE,
  MG_PHASE_TARGET_RATIO,
  DEFAULT_FINAL_SAFETY_FILTER,
  resolveGrainPair,
  resolvePitchPair,
  shapeDynamicEnergy,
  SWAP_FINAL_SAFETY_FILTER,
} = require('../src/audio/double-harmonic-dynamic-v3.cjs');
const {
  buildNakedD40FilterV4,
  buildNakedD40PlanV4,
  resolveHighGrainPower,
  resolveLowGrainMultiplier,
  resolveV4WeightScale,
} = require('../src/audio/double-harmonic-naked-v4.cjs');
const {
  buildLogD40FilterV5,
  buildLogD40PlanV5,
  resolveLogDimensionPairV5,
  resolveV5WeightScale,
} = require('../src/audio/double-harmonic-log-v5.cjs');
const {
  buildResonanceD40FilterV6,
  buildResonanceD40PlanV6,
  resolveResonanceDimensionPairV6,
  resolveV6UserK,
  sampleResonanceMkV6At,
} = require('../src/audio/double-harmonic-resonance-v6.cjs');
const {
  V71_METHOD,
  buildBinaryGridMetricsV71,
  buildBricksAutomationSamplesV7,
  buildBricksD40FilterV7,
  buildBricksD40PlanV7,
  resolveV71BinaryGrid,
  resolveV7MaxBricks,
  sampleBrickResonanceV7At,
} = require('../src/audio/double-harmonic-bricks-v7.cjs');
const {
  GRAIN_E2_HIGH,
  GRAIN_E2_LOW,
  GRAIN_PIVOT_HIGH,
  GRAIN_PIVOT_LOW,
  GRAIN_PIVOT_PRODUCT_1024,
  GRAIN_PIVOT_TARGET,
  V8_METHOD,
  V8_PLUS_METHOD,
  V8_PIVOT_METHOD,
  buildClosedPhaseAutomationSamplesV8,
  buildClosedPhaseD40FilterV8,
  buildClosedPhaseD40PlanV8,
  buildClosedPhaseD40PlanV8Pivot,
  buildClosedPhaseD40PlanV8Plus,
  buildClosedPhaseMetricsV8,
} = require('../src/audio/double-harmonic-closed-phase-v8.cjs');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function twoLevelSignal({ sampleRate = 16000, seconds = 4 } = {}) {
  const samples = new Float32Array(sampleRate * seconds);
  const half = samples.length / 2;
  for (let index = 0; index < samples.length; index += 1) {
    const amp = index < half ? 0.035 : 0.75;
    samples[index] = Math.sin((Math.PI * 2 * 220 * index) / sampleRate) * amp;
  }
  return samples;
}

function rounded(value, digits = 12) {
  return Number(Number(value).toFixed(digits));
}

function numberPattern(value, digits = 12) {
  return String(rounded(value, digits)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('D40 calculation uses cross multiplication from 40.0005 to 40', () => {
  const density = resolveD40Density();
  assert.equal(density.value, 0.2919963500456244);
  assert.equal(density.correction, 0.999987500156248);

  const envelope = buildD40EnvelopeExpression({ profile: 'blend' });
  assert.equal(envelope.profile, 'blend');
  assert.match(envelope.expression, /0\.999987500156/);

  const built = buildProtectMixD40Filter({ profile: 'prime3' });
  assert.equal(built.envelope.profile, 'prime3');
  assert.match(built.filter, /asplit=2\[full\]\[work\]/);
  assert.match(built.filter, /amix=inputs=3:weights='1 1 1':normalize=0/);
});

test('harmonic intensity scales only the overlay weights and stays bounded', () => {
  const normal = buildProtectMixD40Filter({ intensity: 1 });
  const stronger = buildProtectMixD40Filter({ intensity: 1.08 });
  const attemptedMgOverride = buildProtectMixD40Filter({ intensity: 1, mg: 2 });

  assert.equal(resolveHarmonicIntensity('999'), 1 / BALANCE_AUTO);
  assert.equal(resolveHarmonicIntensity('0'), BALANCE_AUTO);
  assert.equal(normal.mg, MICROGAP_HALF_PLUS_CANON_MG);
  assert.equal(attemptedMgOverride.mg, MICROGAP_HALF_PLUS_CANON_MG);
  assert.equal(Number((normal.lowWeight / normal.highWeight).toFixed(12)), Number(BALANCE_AUTO.toFixed(12)));
  assert.equal(Number(stronger.highWeight.toFixed(12)), Number((normal.highWeight * 1.08).toFixed(12)));
  assert.equal(Number(stronger.lowWeight.toFixed(12)), Number((normal.lowWeight * 1.08).toFixed(12)));
  assert.match(stronger.filter, /amix=inputs=3:weights='1 1 1':normalize=0/);

  const mp3Args = buildProtectMixD40Args({
    inputPath: 'input.wav',
    outputPath: 'output.mp3',
    intensity: 1,
  }).args;
  assert.deepEqual(mp3Args.slice(-5), ['-codec:a', 'libmp3lame', '-b:a', '192k', 'output.mp3']);
});

test('double harmonic route exposes phase-lock v2 as status only', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-status-'));
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({ runtimeRoot }));
  const expectedV4 = buildNakedD40FilterV4({ profile: 'blend' });
  const expectedV5 = resolveLogDimensionPairV5();
  const expectedV6 = resolveResonanceDimensionPairV6();

  const { server, baseUrl } = await listen(app);
  try {
    const status = await fetch(`${baseUrl}/api/double-harmonic/status`);
    const statusPayload = await status.json();
    assert.equal(status.status, 200);
    assert.equal(statusPayload.method, 'dry-master-plus-adaptive-d40-harmonic-overlay-v1');
    assert.equal(statusPayload.v2.preservesV1, true);
    assert.equal(statusPayload.v2.state, 'analysis-plan');
    assert.equal(statusPayload.v3.controls.minWeight, MIN_HARMONIC_INTENSITY);
    assert.equal(statusPayload.v3.controls.maxWeight, MAX_HARMONIC_INTENSITY);
    assert.equal(statusPayload.v3.controls.mgFixed, MICROGAP_HALF_PLUS_CANON_MG);
    assert.equal(statusPayload.v4.method, 'dry-first-naked-d40-harmonic-overlay-v4');
    assert.equal(statusPayload.v4.safety.noLimiter, true);
    assert.equal(statusPayload.v4.weights.lowGrainMultiplier, 2);
    assert.equal(statusPayload.v4.weights.highGrainPower, 3);
    assert.equal(statusPayload.v4.weights.weightScale, 1);
    assert.equal(statusPayload.v4.weights.high, statusPayload.v4.weights.highBase);
    assert.equal(statusPayload.v4.weights.low, statusPayload.v4.weights.lowBase);
    assert.equal(rounded(statusPayload.v4.weights.lowPitch), rounded(expectedV4.lowPitch));
    assert.equal(rounded(statusPayload.v4.weights.highPitch), rounded(expectedV4.highPitch));
    assert.equal(statusPayload.v5.method, 'dry-first-log-d40-harmonic-overlay-v5');
    assert.equal(statusPayload.v5.weights.weightScale, 2);
    assert.equal(rounded(statusPayload.v5.weights.lowPitch), rounded(expectedV5.lowPitch));
    assert.equal(rounded(statusPayload.v5.weights.highPitch), rounded(expectedV5.highPitch));
    assert.equal(statusPayload.v6.method, 'dry-first-energy-transfer-m-over-k-d40-harmonic-overlay-v6');
    assert.equal(statusPayload.v6.state, 'v6-supreme-stable');
    assert.equal(statusPayload.v6.preset, 'v6-supreme-m-over-k-k3');
    assert.equal(statusPayload.v6.resonance.transferMode, 'm-over-k-energy-transfer');
    assert.equal(rounded(statusPayload.v6.weights.lowPitch), rounded(expectedV6.lowPitch));
    assert.equal(rounded(statusPayload.v6.weights.highPitch), rounded(expectedV6.highPitch));
    assert.equal(Number(statusPayload.v6.weights.ratio.toFixed(12)), Number(Math.log(statusPayload.v6.dimensions.threeD / statusPayload.v6.dimensions.twoD).toFixed(12)));
    assert.equal(statusPayload.v7.method, 'dry-first-flappy-bricks-mg-phase-d40-harmonic-overlay-v7');
    assert.equal(statusPayload.v7.state, 'v7-experimental-bricks');
    assert.equal(statusPayload.v7.bricks.max, 10);
    assert.equal(statusPayload.v7.safety.v6StableUntouched, true);
    assert.equal(statusPayload.v71.method, 'dry-first-binary-grid-1024-mg-bricks-d40-harmonic-overlay-v7-1');
    assert.equal(statusPayload.v71.state, 'v7-1-experimental-binary-grid');
    assert.equal(statusPayload.v71.bricks.binaryGrid.slotsPerSecond, 1024);
    assert.equal(statusPayload.v71.safety.binaryGridEnabled, true);
    assert.equal(statusPayload.v8.method, V8_METHOD);
    assert.equal(statusPayload.v8.state, 'v8-closed-phase-candidate');
    assert.equal(statusPayload.v8.phaseClosure.slots, 1024);
    assert.equal(statusPayload.v8.safety.noDirectMgOffset, true);
    assert.equal(statusPayload.v8.safety.pivotResidualOldIsNotMgPhase, true);
    assert.equal(statusPayload.v8plus.method, V8_PLUS_METHOD);
    assert.equal(statusPayload.v8plus.state, 'v8-plus-e2-grain-listening-candidate');
    assert.equal(statusPayload.v8plus.variant, 'v8plus');
    assert.equal(statusPayload.v8plus.phaseClosure.slots, 1024);
    assert.equal(statusPayload.v8plus.safety.e2GrainCandidate, true);
    assert.equal(Number(statusPayload.v8plus.grain.active.product.toFixed(15)), 0.5);
    assert.equal(statusPayload.v8pivot.method, V8_PIVOT_METHOD);
    assert.equal(statusPayload.v8pivot.state, 'v8-pivot-1024-listening-validated');
    assert.equal(statusPayload.v8pivot.variant, 'v8pivot');
    assert.equal(statusPayload.v8pivot.phaseClosure.slots, 1024);
    assert.equal(statusPayload.v8pivot.safety.pivot1024ListeningValidated, true);
    assert.equal(Number(statusPayload.v8pivot.grain.active.low.toFixed(15)), Number(GRAIN_PIVOT_LOW.toFixed(15)));
    assert.equal(Number(statusPayload.v8pivot.grain.active.high.toFixed(15)), Number(GRAIN_PIVOT_HIGH.toFixed(15)));
    assert.equal(Number(statusPayload.v8pivot.grain.active.product.toFixed(15)), Number(GRAIN_PIVOT_PRODUCT_1024.toFixed(15)));
    assert.equal(Number(statusPayload.v8pivot.grain.active.pivot.toFixed(12)), GRAIN_PIVOT_TARGET);
    assert.ok(Math.abs(statusPayload.v8pivot.binaryGrid.measuredSlotsPerSecond - 1024) < 1e-9);

    const v2 = await fetch(`${baseUrl}/api/double-harmonic/v2/status?smoothing=1%2Fe&frameMs=20`);
    const v2Payload = await v2.json();
    assert.equal(v2.status, 200);
    assert.equal(v2Payload.v2.controls.smoothing.mode, 'one-over-e');
    assert.equal(v2Payload.v2.frameMs, 20);
    assert.equal(v2Payload.v2.safety.keepV1RouteUntouched, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('dynamic v3 maps quiet frames toward 8/9 and loud frames toward 9/8 with fixed mg', () => {
  const analysis = analyzePcmDynamicWeightV3({
    samples: twoLevelSignal(),
    sampleRate: 16000,
    frameMs: 250,
    maxSegments: 64,
  });
  const built = buildDynamicWeightD40Filter({ analysis, profile: 'blend' });
  const automation = buildDynamicAutomationSamples({
    analysis,
    profile: 'blend',
    durationSeconds: 4,
    sampleRate: 100,
  });

  assert.equal(analysis.controls.minWeight, MIN_HARMONIC_INTENSITY);
  assert.equal(analysis.controls.maxWeight, MAX_HARMONIC_INTENSITY);
  assert.equal(analysis.controls.mgFixed, MICROGAP_HALF_PLUS_CANON_MG);
  assert.equal(analysis.controls.curve, 'ln-exp');
  assert.ok(analysis.summary.weightMin <= MIN_HARMONIC_INTENSITY + 0.01);
  assert.ok(analysis.summary.weightMax >= MAX_HARMONIC_INTENSITY - 0.01);
  assert.ok(analysis.frames[0].weightScale < analysis.frames[analysis.frames.length - 1].weightScale);
  assert.equal(Number((built.lowBaseWeight / built.highBaseWeight).toFixed(12)), Number(BALANCE_AUTO.toFixed(12)));
  assert.equal(built.automation.mode, 'wav-envelope');
  assert.equal(automation.mode, 'wav-envelope');
  assert.ok(automation.summary.min < automation.summary.max);
  assert.doesNotMatch(built.filter, /if\(lt\(t\\,/);
  assert.match(built.filter, /\[1:a\]/);
  assert.match(built.filter, /amultiply/);
  assert.match(built.filter, /phase=laminar/);
  assert.equal(built.finalSafetyFilter, DEFAULT_FINAL_SAFETY_FILTER);
  assert.match(built.filter, /alimiter=limit=0\.97/);
  assert.match(built.filter, /level=false/);
});

test('dynamic v3 ln-exp curve keeps linear fallback while shaping rise and fall', () => {
  const rising = shapeDynamicEnergy(0.45, 0.2, { curve: 'ln-exp' });
  const falling = shapeDynamicEnergy(0.45, 0.7, { curve: 'ln-exp' });
  const linear = shapeDynamicEnergy(0.45, 0.2, { curve: 'linear' });

  assert.equal(linear.curvedEnergy, 0.45);
  assert.equal(rising.direction, 'rise');
  assert.equal(falling.direction, 'fall');
  assert.notEqual(Number(rising.curvedEnergy.toFixed(6)), Number(linear.curvedEnergy.toFixed(6)));
  assert.notEqual(Number(falling.curvedEnergy.toFixed(6)), Number(linear.curvedEnergy.toFixed(6)));
});

test('dynamic v3 mg-ratio curve compares mg phase to the 0.0005*pi target', () => {
  const low = shapeDynamicEnergy(0.25, 0.2, { curve: 'mg-ratio', curveAmount: 0.5 });
  const rising = shapeDynamicEnergy(0.78, 0.4, { curve: 'mg-ratio', curveAmount: 0.5 });
  const linear = shapeDynamicEnergy(0.78, 0.4, { curve: 'linear' });

  assert.ok(Math.abs(MG_PHASE_TARGET_RATIO - 1.010485) < 0.000001);
  assert.equal(rising.direction, 'rise');
  assert.equal(rising.mgRatio, MG_PHASE_TARGET_RATIO);
  assert.ok(low.curvedEnergy < rising.curvedEnergy);
  assert.notEqual(Number(rising.curvedEnergy.toFixed(6)), Number(linear.curvedEnergy.toFixed(6)));
});

test('dynamic v3 grain 18/36 curve links spectral low and high without moving weight bounds', () => {
  const low = shapeDynamicEnergy(0.25, 0.2, { curve: 'grain-18-36', curveAmount: 0.42 });
  const rising = shapeDynamicEnergy(0.78, 0.4, { curve: 'grain-18-36', curveAmount: 0.42 });
  const falling = shapeDynamicEnergy(0.78, 0.9, { curve: 'grain-18-36', curveAmount: 0.42 });

  assert.equal(Number((GRAIN_SPECTRAL_HIGH - GRAIN_SPECTRAL_LOW).toFixed(12)), Number(GRAIN_18_36_DELTA.toFixed(12)));
  assert.equal(Number(GRAIN_Q_SPECTRAL.toFixed(15)), Number((GRAIN_SPECTRAL_REMAINDER * 30).toFixed(15)));
  assert.ok(GRAIN_Q_SPECTRAL > 0.000488 && GRAIN_Q_SPECTRAL < 0.00049);
  assert.equal(Number(GRAIN_18_36_DELTA.toFixed(5)), 0.98325);
  assert.equal(rising.grainLow, GRAIN_SPECTRAL_LOW);
  assert.equal(rising.grainHigh, GRAIN_SPECTRAL_HIGH);
  assert.equal(rising.direction, 'rise');
  assert.equal(falling.direction, 'fall');
  assert.ok(low.curvedEnergy < rising.curvedEnergy);
  assert.ok(rising.curvedEnergy >= 0 && rising.curvedEnergy <= 1);
});

test('dynamic v3 grain 6D/7D/8D curve stacks log, ln and bass resonance for soft rise', () => {
  const rising = shapeDynamicEnergy(0.78, 0.4, { curve: 'grain-6d7d8d', curveAmount: 0.3 });
  const falling = shapeDynamicEnergy(0.78, 0.9, { curve: 'grain-6d7d8d', curveAmount: 0.3 });
  const grain1836 = shapeDynamicEnergy(0.78, 0.4, { curve: 'grain-18-36', curveAmount: 0.3 });

  assert.equal(rising.direction, 'rise');
  assert.equal(falling.direction, 'fall');
  assert.equal(rising.grain6dLogWeight, GRAIN_6D_LOG_WEIGHT);
  assert.equal(rising.grain7dLnWeight, GRAIN_7D_LN_WEIGHT);
  assert.equal(rising.grain8dBassWeight, GRAIN_8D_BASS_WEIGHT);
  assert.equal(rising.grain8dMode, 'bass-resonance');
  assert.equal(Number((GRAIN_6D_LOG_WEIGHT + GRAIN_7D_LN_WEIGHT + GRAIN_8D_BASS_WEIGHT).toFixed(12)), 1);
  assert.ok(rising.curvedEnergy >= 0 && rising.curvedEnergy <= 1);
  assert.notEqual(Number(rising.curvedEnergy.toFixed(6)), Number(grain1836.curvedEnergy.toFixed(6)));
});

test('dynamic v3 can swap pitch and grain values for experimental listening', () => {
  const grain = resolveGrainPair({ swapPitchGrain: true });
  const pitch = resolvePitchPair({ swapPitchGrain: true });
  const analysis = analyzePcmDynamicWeightV3({
    samples: new Float32Array([0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.16, 0.08]),
    sampleRate: 8,
    frameMs: 250,
    curve: 'grain-6d7d8d',
    swapPitchGrain: true,
  });
  const plan = buildDynamicWeightPlanV3({
    curve: 'grain-6d7d8d',
    swapPitchGrain: true,
  });
  const shaped = shapeDynamicEnergy(0.78, 0.4, {
    curve: 'grain-6d7d8d',
    curveAmount: 0.3,
    swapPitchGrain: true,
  });

  assert.equal(grain.low, 0.840896);
  assert.equal(grain.high, 1.259921);
  assert.equal(pitch.highPitch, GRAIN_SPECTRAL_HIGH);
  assert.equal(pitch.lowPitch, GRAIN_SPECTRAL_LOW);
  assert.equal(shaped.swapPitchGrain, true);
  assert.equal(shaped.grainLow, 0.840896);
  assert.equal(shaped.grainHigh, 1.259921);
  assert.equal(analysis.controls.grainLow, 0.840896);
  assert.equal(analysis.controls.grainHigh, 1.259921);
  assert.equal(plan.controls.grainLow, 0.840896);
  assert.equal(plan.controls.grainHigh, 1.259921);
  assert.equal(plan.controls.highPitch, GRAIN_SPECTRAL_HIGH);
  assert.equal(plan.controls.lowPitch, GRAIN_SPECTRAL_LOW);

  const built = buildDynamicWeightD40Filter({
    analysis,
    profile: 'raw-low',
    swapPitchGrain: true,
  });
  assert.equal(built.finalSafetyFilter, SWAP_FINAL_SAFETY_FILTER);
  assert.equal(built.d8BassBranch, true);
  assert.equal(Number((built.bodyBaseWeight / built.lowBaseWeight).toFixed(12)), Number(D8_BODY_SHARE.toFixed(12)));
  assert.equal(Number((built.bassBaseWeight / built.lowBaseWeight).toFixed(12)), Number(D8_BASS_SHARE.toFixed(12)));
  assert.match(built.filter, /asoftclip=type=tanh:threshold=0\.88/);
  assert.match(built.filter, /volume=4dB/);
  assert.match(built.filter, /alimiter=limit=0\.94/);
  assert.match(built.filter, /amix=inputs=4/);
  assert.match(built.filter, new RegExp(`highpass=f=${D8_BODY_LOW_CUTOFF_HZ}`));
  assert.match(built.filter, new RegExp(`highpass=f=${D8_BASS_HIGHPASS_HZ}`));
  assert.match(built.filter, new RegExp(`lowpass=f=${D8_BASS_LOW_CUTOFF_HZ}`));
  assert.match(built.filter, /level=false/);
});

test('naked d40 v4 keeps the validated D40 overlay without filters or final db changes', () => {
  const built = buildNakedD40FilterV4({ profile: 'blend' });
  const classic = buildNakedD40FilterV4({ profile: 'blend', lowGrainMultiplier: 1, highGrainPower: 1 });
  const plan = buildNakedD40PlanV4({ profile: 'blend' });

  assert.equal(built.method, 'dry-first-naked-d40-harmonic-overlay-v4');
  assert.equal(plan.state, 'v4-release-plan');
  assert.equal(resolveLowGrainMultiplier(-1), 2);
  assert.equal(resolveLowGrainMultiplier(99), 4);
  assert.equal(resolveHighGrainPower(-1), 3);
  assert.equal(resolveHighGrainPower(99), 4);
  assert.equal(resolveV4WeightScale(-1), 1);
  assert.equal(resolveV4WeightScale(99), 4);
  assert.equal(built.lowGrainMultiplier, 2);
  assert.equal(built.highGrainPower, 3);
  assert.equal(built.weightScale, 1);
  assert.equal(built.highWeight, built.highBaseWeight);
  assert.equal(built.lowWeight, built.lowBaseWeight);
  assert.equal(built.safety.noEqFilters, true);
  assert.equal(built.safety.noNoiseReduction, true);
  assert.equal(built.safety.noLimiter, true);
  assert.equal(built.safety.noFinalGain, true);
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(built.highPitch)}`));
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(built.lowPitch)}`));
  assert.match(classic.filter, new RegExp(`rubberband=pitch=${numberPattern(classic.highPitch)}`));
  assert.match(classic.filter, new RegExp(`rubberband=pitch=${numberPattern(classic.lowPitch)}`));
  assert.equal(Number((built.lowPitch / classic.lowPitch).toFixed(12)), 2);
  assert.equal(Number((built.highPitch / classic.highPitch ** 3).toFixed(12)), 1);
  assert.match(built.filter, /amultiply/);
  assert.match(built.filter, /amix=inputs=3:weights='1 1 1':normalize=0\[out\]/);
  assert.doesNotMatch(built.filter, /highpass=/);
  assert.doesNotMatch(built.filter, /lowpass=/);
  assert.doesNotMatch(built.filter, /afftdn/);
  assert.doesNotMatch(built.filter, /alimiter/);
  assert.doesNotMatch(built.filter, /asoftclip/);
  assert.doesNotMatch(built.filter, /volume=4dB/);
  assert.equal(Number((built.lowBaseWeight / built.highBaseWeight).toFixed(12)), Number(BALANCE_AUTO.toFixed(12)));
  const stronger = buildNakedD40FilterV4({ profile: 'blend', weightScale: 2 });
  assert.equal(stronger.weightScale, 2);
  assert.equal(Number(stronger.highWeight.toFixed(12)), Number((built.highBaseWeight * 2).toFixed(12)));
  assert.equal(Number(stronger.lowWeight.toFixed(12)), Number((built.lowBaseWeight * 2).toFixed(12)));
  assert.match(stronger.filter, new RegExp(`volume=${Number((built.highBaseWeight * 2).toFixed(12)).toString().replace('.', '\\.')}`));
  const demoBoost = buildNakedD40FilterV4({ profile: 'blend', weightScale: 4 });
  assert.equal(demoBoost.weightScale, 4);
  assert.equal(Number(demoBoost.highWeight.toFixed(12)), Number((built.highBaseWeight * 4).toFixed(12)));
  assert.equal(Number(demoBoost.lowWeight.toFixed(12)), Number((built.lowBaseWeight * 4).toFixed(12)));
});

test('log d40 v5 folds 3D with ln and defaults to clean x2', () => {
  const dimensions = resolveLogDimensionPairV5();
  const built = buildLogD40FilterV5({ profile: 'blend' });
  const boosted = buildLogD40FilterV5({ profile: 'blend', weightScale: 99 });
  const plan = buildLogD40PlanV5({ profile: 'blend' });

  assert.equal(rounded(dimensions.twoD), rounded(1 + GRAIN_SPECTRAL_LOW));
  assert.equal(rounded(dimensions.threeD), rounded(((3 * GRAIN_SPECTRAL_HIGH * dimensions.twoD) + 2) / 2));
  assert.equal(rounded(dimensions.lowPitch), rounded(1 / dimensions.twoD));
  assert.equal(rounded(dimensions.highPitch), rounded(Math.log(dimensions.threeD)));
  assert.equal(dimensions.highFormula, 'ln(3D^2D)/2D');
  assert.equal(dimensions.highEquivalent, 'ln(3D)');
  assert.equal(resolveV5WeightScale(undefined), 2);
  assert.equal(resolveV5WeightScale(99), 3);
  assert.equal(built.weightScale, 2);
  assert.equal(boosted.weightScale, 3);
  assert.equal(plan.defaults.weightScale.default, 2);
  assert.equal(plan.defaults.weightScale.max, 3);
  assert.equal(Number((built.lowWeight / built.highWeight).toFixed(12)), Number(BALANCE_AUTO.toFixed(12)));
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(dimensions.highPitch)}:transients=crisp`));
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(dimensions.lowPitch)}:transients=crisp`));
  assert.doesNotMatch(built.filter, /alimiter/);
  assert.doesNotMatch(built.filter, /highpass=/);
});

test('resonance d40 v6 uses 2D/2, 3D/2 and M/K energy transfer cap', () => {
  const dimensions = resolveResonanceDimensionPairV6();
  const built = buildResonanceD40FilterV6({ profile: 'blend', userK: 2 });
  const boosted = buildResonanceD40FilterV6({ profile: 'blend', userK: 99 });
  const plan = buildResonanceD40PlanV6({ profile: 'blend' });
  const quiet = sampleResonanceMkV6At({
    frames: [{ endTime: 1, normalizedEnergy: 0, curvedEnergy: 0 }],
  }, 0, { userK: 2 });
  const loud = sampleResonanceMkV6At({
    frames: [{ endTime: 1, normalizedEnergy: 1, curvedEnergy: 1 }],
  }, 0, { userK: 2 });
  const louderK = sampleResonanceMkV6At({
    frames: [{ endTime: 1, normalizedEnergy: 1, curvedEnergy: 1 }],
  }, 0, { userK: 10 });

  assert.equal(rounded(dimensions.twoD), rounded(1 + GRAIN_SPECTRAL_LOW));
  assert.equal(rounded(dimensions.threeD), rounded(((3 * GRAIN_SPECTRAL_HIGH * dimensions.twoD) + 2) / 2));
  assert.equal(rounded(dimensions.lowPitch), rounded(dimensions.twoD / 2));
  assert.equal(rounded(dimensions.highPitch), rounded(dimensions.threeD / 2));
  assert.equal(rounded(dimensions.ratioHighToLow), rounded(Math.log(dimensions.threeD / dimensions.twoD)));
  assert.equal(dimensions.ratioFormula, 'ln(3D/2D)');
  assert.equal(resolveV6UserK(undefined), 3);
  assert.equal(resolveV6UserK(99), 10);
  assert.equal(built.userK, 2);
  assert.equal(boosted.userK, 10);
  assert.equal(boosted.wetCeiling, built.wetCeiling);
  assert.equal(built.safety.wetScaleMax, 1);
  assert.equal(plan.resonance.mode, 'soft-fold');
  assert.equal(plan.resonance.transferMode, 'm-over-k-energy-transfer');
  assert.ok(plan.resonance.formula.includes('min(1,M/K)'));
  assert.equal(plan.defaults.userK.default, 3);
  assert.equal(plan.defaults.userK.max, 10);
  assert.equal(Number((built.highWeight / built.lowWeight).toFixed(12)), Number(dimensions.ratioHighToLow.toFixed(12)));
  assert.ok(louderK.folded > loud.folded);
  assert.ok(loud.measuredK > quiet.measuredK);
  assert.equal(loud.mOverK, 1 / loud.measuredK);
  assert.equal(loud.energyTransfer, loud.mOverK);
  assert.equal(loud.resonanceCap, loud.mOverK);
  assert.ok(louderK.energyTransfer < loud.energyTransfer);
  assert.ok(loud.foldedSurplus < loud.surplus);
  assert.equal(Number(quiet.measuredK.toFixed(12)), 1);
  assert.ok(loud.folded <= 1);
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(dimensions.highPitch)}:transients=crisp`));
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(dimensions.lowPitch)}:transients=crisp`));
  assert.doesNotMatch(built.filter, /alimiter/);
  assert.doesNotMatch(built.filter, /highpass=/);
});

test('bricks d40 v7 adds more mg_phase bricks when signal height is low', () => {
  const built = buildBricksD40FilterV7({ profile: 'blend', userK: 3 });
  const plan = buildBricksD40PlanV7({ profile: 'blend' });
  const quiet = sampleBrickResonanceV7At({
    frames: [{ endTime: 1, normalizedEnergy: 0, curvedEnergy: 0, weightScale: 1 }],
  }, 0, { userK: 3 });
  const loud = sampleBrickResonanceV7At({
    frames: [{ endTime: 1, normalizedEnergy: 1, curvedEnergy: 1, weightScale: 1 }],
  }, 0, { userK: 3 });

  assert.equal(built.method, 'dry-first-flappy-bricks-mg-phase-d40-harmonic-overlay-v7');
  assert.equal(plan.state, 'v7-experimental-bricks');
  assert.equal(resolveV7MaxBricks(99), 32);
  assert.equal(plan.bricks.max, 10);
  assert.equal(plan.safety.v6StableUntouched, true);
  assert.equal(plan.safety.mgPhaseFixed, true);
  assert.ok(quiet.activeBricks > loud.activeBricks);
  assert.equal(loud.activeBricks, 1);
  assert.equal(quiet.maxBricks, 10);
  assert.ok(quiet.hole > loud.hole);
  assert.ok(quiet.folded >= quiet.baseFolded);
  assert.ok(loud.folded >= loud.baseFolded);
  const dimensions = resolveResonanceDimensionPairV6();
  assert.equal(rounded(built.weights?.ratioHighToLow || built.ratioHighToLow), rounded(dimensions.ratioHighToLow));
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(dimensions.highPitch)}:transients=crisp`));
  assert.match(built.filter, new RegExp(`rubberband=pitch=${numberPattern(dimensions.lowPitch)}:transients=crisp`));
  assert.doesNotMatch(built.filter, /alimiter/);
});

test('binary grid v7.1 locks the mg brick envelope to 1024 slots without moving mg_phase', () => {
  const metrics = buildBinaryGridMetricsV71();
  const grid = resolveV71BinaryGrid('exact1024');
  const measured = resolveV71BinaryGrid('measured');
  const built = buildBricksD40FilterV7({ profile: 'blend', userK: 3, binaryGrid: 'exact1024' });
  const plan = buildBricksD40PlanV7({ profile: 'blend', binaryGrid: 'exact1024' });
  const automation = buildBricksAutomationSamplesV7({
    analysis: { frames: [{ endTime: 1, normalizedEnergy: 0.2, curvedEnergy: 0.2, weightScale: 1 }], summary: { durationSeconds: 1 } },
    durationSeconds: 1,
    userK: 3,
    binaryGrid: 'exact1024',
  });

  assert.equal(built.method, V71_METHOD);
  assert.equal(plan.state, 'v7-1-experimental-binary-grid');
  assert.equal(grid.enabled, true);
  assert.equal(grid.slotsPerSecond, 1024);
  assert.equal(measured.mode, 'measured');
  assert.ok(metrics.measuredSlotsPerSecond > 1024 && metrics.measuredSlotsPerSecond < 1024.23);
  assert.ok(Math.abs(metrics.grainProduct - (GRAIN_SPECTRAL_LOW * GRAIN_SPECTRAL_HIGH)) < 0.000000000000001);
  assert.equal(rounded(metrics.grainQSpectral, 15), rounded(GRAIN_Q_SPECTRAL, 15));
  assert.equal(metrics.grainQFormula, '30*(0.0005*pi-mg_phase)');
  assert.equal(plan.bricks.binaryGrid.enabled, true);
  assert.equal(plan.bricks.binaryGrid.slotsPerSecond, 1024);
  assert.equal(plan.bricks.binaryGrid.metrics.exactSlotsPerSecond, 1024);
  assert.equal(plan.safety.binaryGridDoesNotChangeMgPhase, true);
  assert.equal(automation.sampleRate, 1024);
  assert.equal(automation.binaryGrid.enabled, true);
  assert.equal(automation.binaryGrid.outputSampleRate, 1024);
});

test('closed phase d40 v8 centers mg_phase increments and keeps V6 stable', () => {
  const metrics = buildClosedPhaseMetricsV8({ phaseSlots: 1024 });
  const built = buildClosedPhaseD40FilterV8({ profile: 'blend', userK: 3 });
  const plan = buildClosedPhaseD40PlanV8({ profile: 'blend' });
  const automation = buildClosedPhaseAutomationSamplesV8({
    analysis: { frames: [{ endTime: 1, normalizedEnergy: 0.6, curvedEnergy: 0.6, weightScale: 1 }], summary: { durationSeconds: 1 } },
    durationSeconds: 1,
    sampleRate: 1024,
    userK: 3,
  });

  assert.equal(built.method, V8_METHOD);
  assert.equal(plan.state, 'v8-closed-phase-candidate');
  assert.equal(plan.phaseClosure.slots, 1024);
  assert.equal(plan.safety.v6StableUntouched, true);
  assert.equal(plan.safety.mgPhaseFixed, true);
  assert.equal(plan.safety.noDirectMgOffset, true);
  assert.equal(plan.safety.centeredIncrements, true);
  assert.equal(Number(plan.operators.c7.toFixed(15)), 0.029194480637267);
  assert.equal(Number(plan.projection.steps.pivot10c7.toFixed(12)), 8.363498084233);
  assert.equal(Number(plan.projection.steps.mgPhase.toFixed(12)), 0.044532524673);
  assert.ok(Math.abs(metrics.closure.centered.closingGap) < 1e-12);
  assert.ok(Math.abs(metrics.closure.instantOffset.closingGap) > 1e-8);
  assert.equal(automation.sampleRate, 1024);
  assert.equal(automation.phaseClosure.slots, 1024);
  assert.ok(automation.phaseClosure.blockClosingGap.max < 1e-12);
  assert.match(built.filter, /rubberband=pitch=/);
  assert.match(built.filter, /amix=inputs=3:weights='1 1 1':normalize=0\[out\]/);
  assert.doesNotMatch(built.filter, /alimiter/);
});

test('closed phase d40 v8 plus uses e2 grains as a parallel listening candidate', () => {
  const metrics = buildClosedPhaseMetricsV8({ variant: 'v8plus', phaseSlots: 1024 });
  const built = buildClosedPhaseD40FilterV8({ variant: 'v8plus', profile: 'blend', userK: 3 });
  const plan = buildClosedPhaseD40PlanV8Plus({ profile: 'blend' });
  const automation = buildClosedPhaseAutomationSamplesV8({
    variant: 'v8plus',
    analysis: { frames: [{ endTime: 1, normalizedEnergy: 0.6, curvedEnergy: 0.6, weightScale: 1 }], summary: { durationSeconds: 1 } },
    durationSeconds: 1,
    sampleRate: 1024,
    userK: 3,
  });

  assert.equal(built.method, V8_PLUS_METHOD);
  assert.equal(plan.state, 'v8-plus-e2-grain-listening-candidate');
  assert.equal(plan.variant, 'v8plus');
  assert.equal(plan.safety.e2GrainCandidate, true);
  assert.equal(plan.safety.e2GrainNotCanon, true);
  assert.equal(Number(plan.grain.active.low.toFixed(15)), Number(GRAIN_E2_LOW.toFixed(15)));
  assert.equal(Number(plan.grain.active.high.toFixed(15)), Number(GRAIN_E2_HIGH.toFixed(15)));
  assert.equal(Number(plan.grain.active.product.toFixed(15)), 0.5);
  assert.equal(Number(plan.dimensions.grainLow.toFixed(15)), Number(GRAIN_E2_LOW.toFixed(15)));
  assert.equal(Number(plan.dimensions.grainHigh.toFixed(15)), Number(GRAIN_E2_HIGH.toFixed(15)));
  assert.ok(Math.abs(metrics.closure.centered.closingGap) < 1e-12);
  assert.ok(Math.abs(metrics.binaryGrid.grainProductGapToHalf) < 1e-15);
  assert.equal(automation.variant, 'v8plus');
  assert.equal(automation.phaseClosure.slots, 1024);
  assert.match(built.filter, /rubberband=pitch=/);
  assert.match(built.filter, /amix=inputs=3:weights='1 1 1':normalize=0\[out\]/);
});

test('closed phase d40 v8 pivot locks 1024 slots and pivot 0.292', () => {
  const metrics = buildClosedPhaseMetricsV8({ variant: 'v8pivot', phaseSlots: 1024 });
  const built = buildClosedPhaseD40FilterV8({ variant: 'v8pivot', profile: 'blend', userK: 3 });
  const plan = buildClosedPhaseD40PlanV8Pivot({ profile: 'blend' });
  const automation = buildClosedPhaseAutomationSamplesV8({
    variant: 'v8pivot',
    analysis: { frames: [{ endTime: 1, normalizedEnergy: 0.6, curvedEnergy: 0.6, weightScale: 1 }], summary: { durationSeconds: 1 } },
    durationSeconds: 1,
    sampleRate: 1024,
    userK: 3,
  });

  assert.equal(built.method, V8_PIVOT_METHOD);
  assert.equal(plan.state, 'v8-pivot-1024-listening-validated');
  assert.equal(plan.variant, 'v8pivot');
  assert.equal(plan.safety.pivot1024Candidate, true);
  assert.equal(plan.safety.pivot1024ListeningValidated, true);
  assert.equal(plan.safety.exact1024AndPivot0292, true);
  assert.equal(Number(plan.grain.active.low.toFixed(15)), Number(GRAIN_PIVOT_LOW.toFixed(15)));
  assert.equal(Number(plan.grain.active.high.toFixed(15)), Number(GRAIN_PIVOT_HIGH.toFixed(15)));
  assert.equal(Number(plan.grain.active.product.toFixed(15)), Number(GRAIN_PIVOT_PRODUCT_1024.toFixed(15)));
  assert.equal(Number(plan.grain.active.pivot.toFixed(12)), GRAIN_PIVOT_TARGET);
  assert.ok(Math.abs(metrics.binaryGrid.measuredSlotsPerSecond - 1024) < 1e-9);
  assert.ok(Math.abs(metrics.closure.centered.closingGap) < 1e-12);
  assert.equal(automation.variant, 'v8pivot');
  assert.equal(automation.phaseClosure.slots, 1024);
  assert.match(built.filter, /rubberband=pitch=/);
  assert.match(built.filter, /amix=inputs=3:weights='1 1 1':normalize=0\[out\]/);
});

test('double harmonic route processes upload and exposes tokenized audio link', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processProtectMixD40: async ({ outputPath, profile, intensity }) => {
      calls.push({ profile, intensity });
      fs.writeFileSync(outputPath, Buffer.from('processed wav'));
      return {
        method: 'dry-master-plus-adaptive-d40-harmonic-overlay-v1',
        profile,
        intensity,
        weights: { dry: 1, high: 0.03, low: 0.024 },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('RIFFdemoWAVEfmt ')], { type: 'audio/wav' }), 'demo.wav');
    form.append('profile', 'blend');
    form.append('intensity', '1.08');
    form.append('format', 'source');
    const res = await fetch(`${baseUrl}/api/double-harmonic/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.deepEqual(calls, [{ profile: 'blend', intensity: 1.08 }]);
    assert.equal(payload.intensity, 1.08);
    assert.deepEqual(payload.weights, { dry: 1, high: 0.03, low: 0.024 });
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+\.wav$/);
    assert.match(payload.shareUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/double-harmonic\/out\/.+\.wav\?token=/);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/wav/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route analyzes upload through phase-lock v2 without writing output asset', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v2-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    analyzePhaseLockV2: async ({ inputPath, profile, frameMs, maxFrameDetails }) => {
      calls.push({
        existsDuringCall: fs.existsSync(inputPath),
        profile,
        frameMs,
        maxFrameDetails,
      });
      return {
        method: 'dry-first-d40-phase-lock-analysis-v2',
        state: 'measured-analysis',
        preservesV1: true,
        summary: { frames: 4, voicedFrames: 3, medianF0: 220 },
        frames: [{ index: 0, f0: 220, phaseRadians: 0 }],
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('RIFFdemoWAVEfmt ')], { type: 'audio/wav' }), 'demo.wav');
    form.append('profile', 'prime3');
    form.append('frameMs', '20');
    form.append('maxFrameDetails', '8');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v2/analyze`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-d40-phase-lock-analysis-v2');
    assert.equal(payload.v2.state, 'measured-analysis');
    assert.deepEqual(calls, [{
      existsDuringCall: true,
      profile: 'prime3',
      frameMs: 20,
      maxFrameDetails: 8,
    }]);
    const files = fs.readdirSync(path.join(runtimeRoot, 'double-harmonic-d40'));
    assert.equal(files.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route processes upload through experimental phase-lock v2', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v2-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processPhaseAwareD40V2: async ({ outputPath, profile, intensity, analysisOptions }) => {
      calls.push({ profile, intensity, frameMs: analysisOptions.frameMs });
      fs.writeFileSync(outputPath, Buffer.from('processed v2 flac'));
      return {
        method: 'dry-first-d40-phase-aware-overlay-v2',
        state: 'experimental-process',
        profile,
        intensity,
        phase: { score: 1.01, delaySamples: 0.08 },
        analysis: { summary: { frames: 4, medianF0: 220 }, frameMs: analysisOptions.frameMs },
        weights: { dry: 1, high: 0.028, low: 0.02488888888888889, ratio: 0.8888888888888888 },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('intensity', '1.08');
    form.append('frameMs', '20');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v2/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-d40-phase-aware-overlay-v2');
    assert.equal(payload.state, 'experimental-process');
    assert.equal(payload.contentType, 'audio/flac');
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v2\.flac$/);
    assert.deepEqual(calls, [{ profile: 'blend', intensity: 1.08, frameMs: 20 }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route processes upload through dynamic v3 as lossless flac by default', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v3-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processDynamicWeightD40V3: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        frameMs: analysisOptions.frameMs,
        maxSegments: analysisOptions.maxSegments,
        curve: analysisOptions.curve,
        curveAmount: analysisOptions.curveAmount,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v3 flac'));
      return {
        method: 'dry-first-d40-db-dynamic-overlay-v3',
        state: 'dynamic-process',
        profile,
        intensity: 'auto',
        dynamic: { summary: { frames: 8, weightMin: MIN_HARMONIC_INTENSITY, weightMax: MAX_HARMONIC_INTENSITY } },
        weights: { dry: 1, dynamicMin: MIN_HARMONIC_INTENSITY, dynamicMax: MAX_HARMONIC_INTENSITY, ratio: BALANCE_AUTO },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('frameMs', '250');
    form.append('maxSegments', '64');
    form.append('curve', 'ln-exp');
    form.append('curveAmount', '0.38');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v3/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-d40-db-dynamic-overlay-v3');
    assert.equal(payload.intensity, 'auto');
    assert.equal(payload.contentType, 'audio/flac');
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v3\.flac$/);
    assert.deepEqual(calls, [{ profile: 'blend', frameMs: 250, maxSegments: 64, curve: 'ln-exp', curveAmount: 0.38 }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes naked d40 v4 as lossless flac by default', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v4-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processNakedD40V4: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        frameMs: analysisOptions.frameMs,
        maxSegments: analysisOptions.maxSegments,
        curve: analysisOptions.curve,
        curveAmount: analysisOptions.curveAmount,
        lowGrainMultiplier: analysisOptions.lowGrainMultiplier,
        highGrainPower: analysisOptions.highGrainPower,
        weightScale: analysisOptions.weightScale,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v4 flac'));
      return {
        method: 'dry-first-naked-d40-harmonic-overlay-v4',
        state: 'v4-release',
        profile,
        preset: 'raw-low',
        intensity: 'd40',
        d40: resolveD40Density(),
        dynamic: { summary: { frames: 8, weightMin: MIN_HARMONIC_INTENSITY, weightMax: MAX_HARMONIC_INTENSITY } },
        weights: {
          dry: 1,
          dynamicMin: MIN_HARMONIC_INTENSITY,
          dynamicMax: MAX_HARMONIC_INTENSITY,
          ratio: BALANCE_AUTO,
          weightScale: analysisOptions.weightScale || 1,
          lowGrainMultiplier: analysisOptions.lowGrainMultiplier || 1,
          highGrainPower: analysisOptions.highGrainPower || 1,
          finalGainDb: 0,
          filters: 'none',
        },
        safety: { noLimiter: true, noFinalGain: true, sourceFormatOutput: true },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('frameMs', '250');
    form.append('maxSegments', '64');
    form.append('curve', 'grain-6d7d8d');
    form.append('curveAmount', '0.3');
    form.append('lowGrainMultiplier', '2');
    form.append('highGrainPower', '3');
    form.append('intensity', '2.5');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v4/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-naked-d40-harmonic-overlay-v4');
    assert.equal(payload.state, 'v4-release');
    assert.equal(payload.intensity, 'd40');
    assert.equal(payload.contentType, 'audio/flac');
    assert.equal(payload.safety.noLimiter, true);
    assert.equal(payload.weights.lowGrainMultiplier, 2);
    assert.equal(payload.weights.highGrainPower, 3);
    assert.equal(payload.weights.weightScale, 2.5);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v4\.flac$/);
    assert.deepEqual(calls, [{
      profile: 'blend',
      frameMs: 250,
      maxSegments: 64,
      curve: 'grain-6d7d8d',
      curveAmount: 0.3,
      lowGrainMultiplier: 2,
      highGrainPower: 3,
      weightScale: 2.5,
    }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route emits https share links for public forwarded hosts', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-https-'));
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processNakedD40V4: async ({ outputPath, profile, analysisOptions }) => {
      fs.writeFileSync(outputPath, Buffer.from('processed v4 flac'));
      return {
        method: 'dry-first-naked-d40-harmonic-overlay-v4',
        state: 'v4-release',
        profile,
        preset: 'raw-low',
        intensity: 'd40',
        d40: resolveD40Density(),
        dynamic: { summary: { frames: 1 } },
        weights: { dry: 1, weightScale: analysisOptions.weightScale || 1 },
        safety: { noLimiter: true, noFinalGain: true },
      };
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v4/process`, {
      method: 'POST',
      headers: {
        'x-forwarded-host': 'vivy.funesterie.me',
        'x-forwarded-proto': 'http',
      },
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v4\.flac$/);
    assert.match(payload.shareUrl, /^https:\/\/vivy\.funesterie\.me\/api\/double-harmonic\/out\/.+\.flac\?token=/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes log d40 v5 as lossless flac by default', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v5-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processLogD40V5: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        frameMs: analysisOptions.frameMs,
        maxSegments: analysisOptions.maxSegments,
        curve: analysisOptions.curve,
        curveAmount: analysisOptions.curveAmount,
        weightScale: analysisOptions.weightScale,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v5 flac'));
      return {
        method: 'dry-first-log-d40-harmonic-overlay-v5',
        state: 'v5-release',
        profile,
        preset: 'log-3d-x2',
        intensity: 'd40-log',
        d40: resolveD40Density(),
        dynamic: { summary: { frames: 8, weightMin: MIN_HARMONIC_INTENSITY, weightMax: MAX_HARMONIC_INTENSITY } },
        weights: {
          dry: 1,
          ratio: BALANCE_AUTO,
          weightScale: analysisOptions.weightScale || 2,
          highPitch: 1.3294053807605832,
          lowPitch: 0.7302053724108407,
        },
        safety: { noLimiter: true, noFinalGain: true, publicMaxWeightScale: 3 },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('frameMs', '250');
    form.append('maxSegments', '64');
    form.append('curve', 'grain-6d7d8d');
    form.append('curveAmount', '0.3');
    form.append('intensity', '2');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v5/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-log-d40-harmonic-overlay-v5');
    assert.equal(payload.state, 'v5-release');
    assert.equal(payload.intensity, 'd40-log');
    assert.equal(payload.contentType, 'audio/flac');
    assert.equal(payload.weights.weightScale, 2);
    assert.equal(Number(payload.weights.lowPitch.toFixed(12)), 0.730205372411);
    assert.equal(Number(payload.weights.highPitch.toFixed(12)), 1.329405380761);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v5\.flac$/);
    assert.deepEqual(calls, [{
      profile: 'blend',
      frameMs: 250,
      maxSegments: 64,
      curve: 'grain-6d7d8d',
      curveAmount: 0.3,
      weightScale: 2,
    }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes resonance d40 v6 with user k', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v6-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processResonanceD40V6: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        frameMs: analysisOptions.frameMs,
        maxSegments: analysisOptions.maxSegments,
        userK: analysisOptions.userK,
        kCeiling: analysisOptions.kCeiling,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v6 flac'));
      return {
        method: 'dry-first-energy-transfer-m-over-k-d40-harmonic-overlay-v6',
        state: 'v6-supreme-stable',
        profile,
        preset: 'v6-supreme-m-over-k-k3',
        intensity: 'soft-fold',
        d40: resolveD40Density(),
        resonance: {
          userK: analysisOptions.userK || 3,
          kCeiling: analysisOptions.kCeiling || 10,
          ratioHighToLow: 1.0149759284240818,
          ratioFormula: 'ln(3D/2D)',
        },
        dynamic: { summary: { frames: 8, weightMin: MIN_HARMONIC_INTENSITY, weightMax: MAX_HARMONIC_INTENSITY } },
        weights: {
          dry: 1,
          ratio: 1.0149759284240818,
          userK: analysisOptions.userK || 3,
          kCeiling: analysisOptions.kCeiling || 10,
          highPitch: 1.889397887364303,
          lowPitch: 0.6847388678464575,
        },
        safety: { noLimiter: true, noFinalGain: true, publicMaxUserK: 10 },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('frameMs', '250');
    form.append('maxSegments', '64');
    form.append('intensity', '6');
    form.append('kCeiling', '10');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v6/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-energy-transfer-m-over-k-d40-harmonic-overlay-v6');
    assert.equal(payload.state, 'v6-supreme-stable');
    assert.equal(payload.intensity, 'soft-fold');
    assert.equal(payload.contentType, 'audio/flac');
    assert.equal(payload.resonance.userK, 6);
    assert.equal(Number(payload.weights.lowPitch.toFixed(12)), 0.684738867846);
    assert.equal(Number(payload.weights.highPitch.toFixed(12)), 1.889397887364);
    assert.equal(Number(payload.weights.ratio.toFixed(12)), 1.014975928424);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v6\.flac$/);
    assert.deepEqual(calls, [{
      profile: 'blend',
      frameMs: 250,
      maxSegments: 64,
      userK: 6,
      kCeiling: 10,
    }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes adaptive bricks d40 v7 with user k', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v7-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processBricksD40V7: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        frameMs: analysisOptions.frameMs,
        maxSegments: analysisOptions.maxSegments,
        userK: analysisOptions.userK,
        kCeiling: analysisOptions.kCeiling,
        minBricks: analysisOptions.minBricks,
        maxBricks: analysisOptions.maxBricks,
        brickInfluence: analysisOptions.brickInfluence,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v7 flac'));
      return {
        method: 'dry-first-flappy-bricks-mg-phase-d40-harmonic-overlay-v7',
        state: 'v7-experimental-bricks',
        profile,
        preset: 'v7-flappy-bricks-mg-phase-k3',
        intensity: 'bricks-adaptive',
        d40: resolveD40Density(),
        resonance: {
          userK: analysisOptions.userK || 3,
          kCeiling: analysisOptions.kCeiling || 10,
          transferMode: 'mg-phase-brick-allocation',
        },
        bricks: {
          min: analysisOptions.minBricks || 1,
          max: analysisOptions.maxBricks || 10,
          brickInfluence: analysisOptions.brickInfluence || 0.45,
          summary: { brickMin: 1, brickMax: 10, brickMean: 5.5 },
        },
        dynamic: { summary: { frames: 8 } },
        weights: {
          dry: 1,
          ratio: 1.0149759284240818,
          userK: analysisOptions.userK || 3,
          kCeiling: analysisOptions.kCeiling || 10,
          brickMin: 1,
          brickMax: 10,
          highPitch: 1.889397887364303,
          lowPitch: 0.6847388678464575,
        },
        safety: { noLimiter: true, noFinalGain: true, mgPhaseFixed: true, v6StableUntouched: true },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('frameMs', '250');
    form.append('maxSegments', '64');
    form.append('intensity', '4');
    form.append('kCeiling', '10');
    form.append('minBricks', '1');
    form.append('maxBricks', '10');
    form.append('brickInfluence', '0.45');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v7/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-flappy-bricks-mg-phase-d40-harmonic-overlay-v7');
    assert.equal(payload.state, 'v7-experimental-bricks');
    assert.equal(payload.intensity, 'bricks-adaptive');
    assert.equal(payload.contentType, 'audio/flac');
    assert.equal(payload.resonance.userK, 4);
    assert.equal(payload.bricks.max, 10);
    assert.equal(payload.safety.v6StableUntouched, true);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v7\.flac$/);
    assert.deepEqual(calls, [{
      profile: 'blend',
      frameMs: 250,
      maxSegments: 64,
      userK: 4,
      kCeiling: 10,
      minBricks: 1,
      maxBricks: 10,
      brickInfluence: 0.45,
    }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes binary grid d40 v7.1 with exact 1024 slots', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v71-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processBricksD40V7: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        userK: analysisOptions.userK,
        binaryGrid: analysisOptions.binaryGrid,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v71 flac'));
      return {
        method: 'dry-first-binary-grid-1024-mg-bricks-d40-harmonic-overlay-v7-1',
        state: 'v7-1-experimental-binary-grid',
        profile,
        preset: 'v7-1-binary-1024-mg-phase-k3',
        intensity: 'binary-bricks-adaptive',
        d40: resolveD40Density(),
        resonance: { userK: analysisOptions.userK || 3, binaryGrid: 'enabled' },
        bricks: {
          min: 1,
          max: 10,
          binaryGrid: {
            enabled: true,
            mode: 'exact1024',
            slotsPerSecond: 1024,
          },
        },
        dynamic: { automation: { sampleRate: 1024, binaryGrid: { enabled: true } } },
        weights: { dry: 1, highPitch: 1.889397887364303, lowPitch: 0.6847388678464575 },
        safety: { noLimiter: true, noFinalGain: true, mgPhaseFixed: true, v6StableUntouched: true, binaryGridEnabled: true },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('intensity', '3');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v71/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, 'dry-first-binary-grid-1024-mg-bricks-d40-harmonic-overlay-v7-1');
    assert.equal(payload.state, 'v7-1-experimental-binary-grid');
    assert.equal(payload.bricks.binaryGrid.slotsPerSecond, 1024);
    assert.equal(payload.safety.binaryGridEnabled, true);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v71\.flac$/);
    assert.deepEqual(calls, [{ profile: 'blend', userK: 3, binaryGrid: 'exact1024' }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes closed phase d40 v8 with centered 1024 closure', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v8-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processClosedPhaseD40V8: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        userK: analysisOptions.userK,
        phaseSlots: analysisOptions.phaseSlots,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v8 flac'));
      return {
        method: V8_METHOD,
        state: 'v8-closed-phase-candidate',
        profile,
        preset: 'v8-fermeture-1024-mg-phase-c7-k3',
        intensity: 'closed-phase-1024',
        d40: resolveD40Density(),
        resonance: {
          userK: analysisOptions.userK || 3,
          kCeiling: 10,
          transferMode: 'centered-increment-mg-phase',
        },
        operators: {
          c7: 0.029194480637266783,
          mgPhase: 0.001554497790530303,
          phaseDelta: 0.00001629853626459359,
        },
        projection: {
          hD40: 28.64753166239538,
          steps: {
            pivot10c7: 8.36349808423289,
            mgPhase: 0.04453252467334052,
          },
        },
        phaseClosure: {
          slots: 1024,
          centered: { closingGap: 0 },
          instantOffset: { closingGap: -0.0009 },
        },
        dynamic: { automation: { sampleRate: 1024, phaseClosure: { slots: 1024 } } },
        weights: { dry: 1, highPitch: 1.889397887364303, lowPitch: 0.6847388678464575 },
        safety: { noLimiter: true, noFinalGain: true, mgPhaseFixed: true, v6StableUntouched: true, noDirectMgOffset: true, centeredIncrements: true },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('intensity', '5');
    form.append('phaseSlots', '1024');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v8/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, V8_METHOD);
    assert.equal(payload.state, 'v8-closed-phase-candidate');
    assert.equal(payload.intensity, 'closed-phase-1024');
    assert.equal(payload.phaseClosure.slots, 1024);
    assert.equal(payload.safety.noDirectMgOffset, true);
    assert.equal(payload.safety.centeredIncrements, true);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v8\.flac$/);
    assert.deepEqual(calls, [{ profile: 'blend', userK: 5, phaseSlots: 1024 }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes closed phase d40 v8 plus with e2 grain branch', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v8plus-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processClosedPhaseD40V8Plus: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        userK: analysisOptions.userK,
        phaseSlots: analysisOptions.phaseSlots,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v8 plus flac'));
      return {
        method: V8_PLUS_METHOD,
        state: 'v8-plus-e2-grain-listening-candidate',
        variant: 'v8plus',
        profile,
        preset: 'v8-plus-e2-grain-1024-mg-phase-c7-k3',
        intensity: 'e2-grain-closed-phase-1024',
        d40: resolveD40Density(),
        resonance: {
          userK: analysisOptions.userK || 3,
          kCeiling: 10,
          transferMode: 'centered-increment-mg-phase-e2-grain-test',
        },
        grain: {
          mode: 'e2-parallel-listening-test',
          active: {
            low: GRAIN_E2_LOW,
            high: GRAIN_E2_HIGH,
            product: GRAIN_E2_LOW * GRAIN_E2_HIGH,
          },
        },
        binaryGrid: {
          grainProduct: GRAIN_E2_LOW * GRAIN_E2_HIGH,
          grainProductGapToHalf: (GRAIN_E2_LOW * GRAIN_E2_HIGH) - 0.5,
        },
        operators: {
          c7: 0.029194480637266783,
          mgPhase: 0.001554497790530303,
          phaseDelta: 0.00001629853626459359,
        },
        projection: {
          hD40: 28.64753166239538,
          steps: {
            pivot10c7: 8.36349808423289,
            mgPhase: 0.04453252467334052,
          },
        },
        phaseClosure: {
          slots: 1024,
          centered: { closingGap: 0 },
          instantOffset: { closingGap: -0.0009 },
        },
        dynamic: { automation: { sampleRate: 1024, phaseClosure: { slots: 1024 } } },
        weights: { dry: 1, highPitch: 1.890697731549768, lowPitch: 0.6847240934220985 },
        safety: { noLimiter: true, noFinalGain: true, mgPhaseFixed: true, historicalV8Untouched: true, noDirectMgOffset: true, centeredIncrements: true, e2GrainCandidate: true, e2GrainNotCanon: true },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('intensity', '5');
    form.append('phaseSlots', '1024');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v8plus/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, V8_PLUS_METHOD);
    assert.equal(payload.state, 'v8-plus-e2-grain-listening-candidate');
    assert.equal(payload.variant, 'v8plus');
    assert.equal(payload.intensity, 'e2-grain-closed-phase-1024');
    assert.equal(Number(payload.grain.active.product.toFixed(15)), 0.5);
    assert.equal(payload.safety.e2GrainCandidate, true);
    assert.equal(payload.safety.e2GrainNotCanon, true);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v8plus\.flac$/);
    assert.deepEqual(calls, [{ profile: 'blend', userK: 5, phaseSlots: 1024 }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route publishes closed phase d40 v8 pivot with exact 1024 and pivot 0.292', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-v8pivot-process-'));
  const calls = [];
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processClosedPhaseD40V8Pivot: async ({ outputPath, profile, analysisOptions }) => {
      calls.push({
        profile,
        userK: analysisOptions.userK,
        phaseSlots: analysisOptions.phaseSlots,
      });
      fs.writeFileSync(outputPath, Buffer.from('processed v8 pivot flac'));
      return {
        method: V8_PIVOT_METHOD,
        state: 'v8-pivot-1024-listening-validated',
        variant: 'v8pivot',
        profile,
        preset: 'v8-pivot-1024-pivot-0292-mg-phase-c7-k3',
        intensity: 'pivot-1024-closed-phase',
        d40: resolveD40Density(),
        resonance: {
          userK: analysisOptions.userK || 3,
          kCeiling: 10,
          transferMode: 'centered-increment-mg-phase-pivot-1024',
        },
        grain: {
          mode: 'pivot-1024-listening-validated',
          active: {
            low: GRAIN_PIVOT_LOW,
            high: GRAIN_PIVOT_HIGH,
            product: GRAIN_PIVOT_LOW * GRAIN_PIVOT_HIGH,
            product1024Target: GRAIN_PIVOT_PRODUCT_1024,
            pivot: GRAIN_PIVOT_TARGET,
          },
        },
        binaryGrid: {
          grainProduct: GRAIN_PIVOT_LOW * GRAIN_PIVOT_HIGH,
          grainProductGapToHalf: (GRAIN_PIVOT_LOW * GRAIN_PIVOT_HIGH) - 0.5,
          measuredSlotsPerSecond: 1024,
          measuredGapTo1024: 0,
        },
        operators: {
          c7: 0.029194480637266783,
          mgPhase: 0.001554497790530303,
          phaseDelta: 0.00001629853626459359,
        },
        projection: {
          hD40: 28.64753166239538,
          steps: {
            pivot10c7: 8.36349808423289,
            mgPhase: 0.04453252467334052,
          },
        },
        phaseClosure: {
          slots: 1024,
          centered: { closingGap: 0 },
          instantOffset: { closingGap: -0.0009 },
        },
        dynamic: { automation: { sampleRate: 1024, phaseClosure: { slots: 1024 } } },
        weights: { dry: 1, highPitch: 1.8898397614034042, lowPitch: 0.6847143305659609 },
        safety: { noLimiter: true, noFinalGain: true, mgPhaseFixed: true, historicalV8Untouched: true, noDirectMgOffset: true, centeredIncrements: true, pivot1024Candidate: true, pivot1024ListeningValidated: true, exact1024AndPivot0292: true },
      };
    },
    verifyJWT: (req, _res, next) => {
      req.user = { email: 'djeff@example.test' };
      next();
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('profile', 'blend');
    form.append('intensity', '5');
    form.append('phaseSlots', '1024');
    const res = await fetch(`${baseUrl}/api/double-harmonic/v8pivot/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.method, V8_PIVOT_METHOD);
    assert.equal(payload.state, 'v8-pivot-1024-listening-validated');
    assert.equal(payload.variant, 'v8pivot');
    assert.equal(payload.intensity, 'pivot-1024-closed-phase');
    assert.equal(Number(payload.grain.active.product.toFixed(15)), Number(GRAIN_PIVOT_PRODUCT_1024.toFixed(15)));
    assert.equal(Number(payload.grain.active.pivot.toFixed(12)), GRAIN_PIVOT_TARGET);
    assert.equal(payload.safety.pivot1024ListeningValidated, true);
    assert.equal(payload.safety.exact1024AndPivot0292, true);
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+-funesterie-d40-v8pivot\.flac$/);
    assert.deepEqual(calls, [{ profile: 'blend', userK: 5, phaseSlots: 1024 }]);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/flac/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('double harmonic route keeps mp3 input as mp3 output when source format is requested', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-dh-route-mp3-'));
  const app = express();
  app.use('/api/double-harmonic', createDoubleHarmonicRouter({
    runtimeRoot,
    processProtectMixD40: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, Buffer.from('processed mp3'));
      return {
        method: 'dry-master-plus-adaptive-d40-harmonic-overlay-v1',
        profile: 'blend',
        intensity: 1,
        weights: { dry: 1, high: 0.03, low: 0.024 },
      };
    },
  }));

  const { server, baseUrl } = await listen(app);
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3demo')], { type: 'audio/mpeg' }), 'demo.mp3');
    form.append('format', 'source');
    const res = await fetch(`${baseUrl}/api/double-harmonic/process`, {
      method: 'POST',
      body: form,
    });
    const payload = await res.json();
    assert.equal(res.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.contentType, 'audio/mpeg');
    assert.match(payload.audioUrl, /^\/api\/double-harmonic\/out\/.+\.mp3$/);
    assert.match(payload.shareUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/double-harmonic\/out\/.+\.mp3\?token=/);

    const shared = await fetch(payload.shareUrl);
    assert.equal(shared.status, 200);
    assert.match(shared.headers.get('content-type') || '', /audio\/mpeg/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

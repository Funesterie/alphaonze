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
    assert.equal(Number(statusPayload.v4.weights.lowPitch.toFixed(12)), 0.738955471386);
    assert.equal(Number(statusPayload.v4.weights.highPitch.toFixed(12)), 2.475319049392);

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
  assert.match(built.filter, /rubberband=pitch=2\.475319049392/);
  assert.match(built.filter, /rubberband=pitch=0\.738955471386/);
  assert.match(classic.filter, /rubberband=pitch=1\.352727735693/);
  assert.match(classic.filter, /rubberband=pitch=0\.369477735693/);
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

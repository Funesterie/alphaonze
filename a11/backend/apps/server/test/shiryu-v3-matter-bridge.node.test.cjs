'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCosmicRelations,
  EMOTION_LIGHT_VACUUM_BALANCE_STRENGTH,
  GREGORIAN_YEAR_DAYS,
  LIGHT_VACUUM_FREQUENCY,
  LIGHT_VACUUM_VIBRATION_ENABLED,
  LUNAR_SYNODIC_MONTH_DAYS,
  LUNAR_TIDE_DAMPING_DIVISOR,
  LUNAR_TIDE_MAX,
  LUNAR_TIDE_MIN,
  PLANETARY_CHOIR_KEYS,
  PHYSICAL_ELECTROLYSIS_DEFAULT,
  TIDE_DRIFT_TARGET,
  TRIFORCE_BALANCE_DIVISOR,
  TRIFORCE_BALANCE_WEIGHT,
  getShiryuV3MatterSpec,
  normalizeEngine,
  prepareShiryuV3MatterField,
  rgbaToHex,
} = require('../src/shiryu-v3-matter-bridge.cjs');
const { runQflushFlow } = require('../src/qflush-integration.cjs');

test('Shiryu V3 matter bridge normalizes engine names and RGBA colors', () => {
  assert.equal(normalizeEngine('Unreal'), 'unreal');
  assert.equal(normalizeEngine('unknown'), 'blender');
  assert.equal(rgbaToHex({ r: 255, g: 0, b: 128, a: 64 }), '#ff008040');
});

test('Shiryu V3 matter bridge materializes atoms as deterministic particles', () => {
  const input = {
    currentMessage: 'lame de sang dans la pluie',
    intent: 'gpu matter',
    payload: { signal: 'mille fleurs', rgba: true },
  };
  const first = prepareShiryuV3MatterField(input, { engine: 'blender', op: 'sculpt', maxParticles: 32, now: '2026-07-09T00:00:00.000Z' });
  const second = prepareShiryuV3MatterField(input, { engine: 'blender', op: 'sculpt', maxParticles: 32, now: '2026-07-09T00:00:00.000Z' });

  assert.equal(first.ok, true);
  assert.equal(first.schema, 'nossen.shiryu.v3_matter_field.v1');
  assert.equal(first.mode, 'mille-fleurs-matter-field');
  assert.equal(first.targetEngine, 'blender');
  assert.equal(first.sourceCell.schema, 'nossen.zen_source_matter_cell.v1');
  assert.equal(first.sourceCell.executable, false);
  assert.equal(first.sourceCell.safeToRender, true);
  assert.equal(first.cosmicRelations.schema, 'nossen.shiryu.v3_cosmic_relations.v1');
  assert.equal(first.cosmicRelations.calendar.gregorianYearDays, 365.2425);
  assert.equal(first.sourceCell.payload.cosmic.schema, 'nossen.shiryu.v3_cosmic_relations.v1');
  assert.equal(first.sourceCell.payload.cosmic.audio.physicalElectrolysis, true);
  assert.equal(first.sourceCell.payload.cosmic.audio.actuatesHardware, false);
  assert.equal(first.sourceCell.payload.cosmic.triforce.divisor, 3);
  assert.equal(first.sourceCell.payload.cosmic.triforce.hardware.actuatesHardware, false);
  assert.equal(first.sourceCell.payload.cosmic.centerOfGravity.mode, 'opposed-center');
  assert.deepEqual(first.particles, second.particles);
  assert.deepEqual(first.sourceCell.hashes, second.sourceCell.hashes);
  assert.ok(first.particles.length >= 1);
  assert.ok(first.particles.every((particle) => particle.position.length === 3));
  assert.match(first.adapters.blender.python, /bpy\.ops\.mesh\.primitive_uv_sphere_add/);
});

test('Shiryu V3 cosmic relations keep leap-year half-day phase and moon cycles exact', () => {
  const cosmic = buildCosmicRelations({ now: '2000-01-02T00:00:00.000Z' });

  assert.equal(cosmic.ok, true);
  assert.equal(cosmic.schema, 'nossen.shiryu.v3_cosmic_relations.v1');
  assert.equal(cosmic.calendar.gregorianYearDays, GREGORIAN_YEAR_DAYS);
  assert.equal(cosmic.moon.synodicMonthDays, LUNAR_SYNODIC_MONTH_DAYS);
  assert.equal(cosmic.calendar.halfDayAnnualPhaseRad, 0.008601388539367);
  assert.equal(cosmic.calendar.halfDayAnnualPhasePi, 0.002737907006989);
  assert.equal(cosmic.planets.count, 7);
  assert.deepEqual(cosmic.planets.keys, PLANETARY_CHOIR_KEYS);
  assert.equal(cosmic.moon.tideDampingDivisor, LUNAR_TIDE_DAMPING_DIVISOR);
  assert.equal(cosmic.moon.tideMin, LUNAR_TIDE_MIN);
  assert.equal(cosmic.moon.tideMax, LUNAR_TIDE_MAX);
  assert.ok(cosmic.moon.tideMagnitude >= 0.09);
  assert.ok(cosmic.moon.tideMagnitude <= 0.1);
  assert.equal(cosmic.moon.drift.target, TIDE_DRIFT_TARGET);
  assert.ok(cosmic.moon.drift.value >= 1.09);
  assert.ok(cosmic.moon.drift.value <= 1.1);
  assert.equal(cosmic.vacuum.lightFrequency, LIGHT_VACUUM_FREQUENCY);
  assert.equal(cosmic.vacuum.vibration, LIGHT_VACUUM_VIBRATION_ENABLED);
  assert.equal(cosmic.audio.lightVacuumFrequency, 0.0005);
  assert.equal(cosmic.audio.lightVacuumVibration, true);
  assert.equal(cosmic.audio.physicalElectrolysis, PHYSICAL_ELECTROLYSIS_DEFAULT);
  assert.equal(cosmic.audio.actuatesHardware, false);
  assert.equal(cosmic.triforce.divisor, TRIFORCE_BALANCE_DIVISOR);
  assert.equal(cosmic.triforce.unitWeight, Number(TRIFORCE_BALANCE_WEIGHT.toFixed(12)));
  assert.equal(cosmic.triforce.hardware.actuatesHardware, false);
  assert.equal(cosmic.triforce.centerOfGravity.mode, 'opposed-center');
  assert.equal(cosmic.triforce.centerOfGravity.value, -cosmic.gravity.value);
  assert.equal(cosmic.triforce.centerOfGravity.vector.x, -cosmic.modulators.mirrorAxes.x);
  assert.equal(cosmic.vacuum.emotionBalance.strength, EMOTION_LIGHT_VACUUM_BALANCE_STRENGTH);
  assert.equal(cosmic.vacuum.emotionBalance.weight, Number(TRIFORCE_BALANCE_WEIGHT.toFixed(12)));
  assert.equal(cosmic.audio.frequencyRangeHz.min, 40.26);
  assert.equal(cosmic.audio.frequencyRangeHz.max, 40.62);
  assert.ok(cosmic.modulators.camera3d.yawDeg >= 0);
  assert.ok(cosmic.modulators.camera3d.yawDeg <= 360);
});

test('Shiryu V3 cosmic relations can bypass Gregorian lag with instant decor shift', () => {
  const cosmic = buildCosmicRelations({
    now: '2026-07-09T00:00:00.000Z',
    instantShift: true,
  });

  assert.equal(cosmic.timeBasis, 'instant-decor');
  assert.equal(cosmic.primaryDriver.name, 'earthSiderealOrbit');
  assert.equal(cosmic.calendar.gregorianAsLagLayer, true);
  assert.equal(cosmic.instantShift.enabled, true);
  assert.equal(cosmic.instantShift.startsWith, 'decor');
  assert.equal(cosmic.gravity.driver, 'earthSiderealOrbit.sin');
  assert.equal(cosmic.gravity.opposedCenter.source, 'earthSiderealOrbit.sin');
  assert.equal(cosmic.modulators.camera3d.startLayer, 'decor');
  assert.equal(cosmic.modulators.camera3d.foregroundBypass, true);
  assert.notEqual(cosmic.calendar.lagAgainstPrimary.phaseDeltaRad, 0);
});

test('Shiryu V3 matter bridge relays V9 tide/electrolysis/light options into cosmic relations', () => {
  const out = prepareShiryuV3MatterField(
    { currentMessage: 'triforce hardware electrolyse lumiere vide' },
    {
      now: '2026-07-09T00:00:00.000Z',
      maxParticles: 4,
      timeBasis: 'instant-decor',
      tideMin: 0.095,
      tideMax: 0.095,
      tideDriftTarget: 1.095,
      physicalElectrolysis: false,
      lightVacuumFrequency: 0.001,
      lightVacuumVibration: false,
      emotionSignal: 0.4,
      emotionBalanceStrength: 0.1,
    }
  );

  assert.equal(out.ok, true);
  assert.equal(out.cosmicRelations.moon.tideMin, 0.095);
  assert.equal(out.cosmicRelations.moon.tideMax, 0.095);
  assert.equal(out.cosmicRelations.moon.drift.target, 1.095);
  assert.equal(out.cosmicRelations.vacuum.lightFrequency, 0.001);
  assert.equal(out.cosmicRelations.vacuum.vibration, false);
  assert.equal(out.cosmicRelations.vacuum.coupling, 0);
  assert.equal(out.cosmicRelations.audio.physicalElectrolysis, false);
  assert.equal(out.cosmicRelations.audio.emotionLightVacuumBalance.signal, 0.4);
  assert.equal(out.cosmicRelations.audio.emotionLightVacuumBalance.strength, 0.1);
  assert.equal(out.cosmicRelations.vacuum.emotionBalance.lightBias, 0.54);
  assert.equal(out.cosmicRelations.triforce.electrolysis.physicalElectrolysis, false);
  assert.equal(out.cosmicRelations.triforce.hardware.actuatesHardware, false);
  assert.equal(out.cosmicRelations.triforce.centerOfGravity.value, -out.cosmicRelations.gravity.value);
});

test('Shiryu V3 matter bridge exposes safe status and Qflush flow fallback', async () => {
  const status = getShiryuV3MatterSpec({}, { autoDetectGpu: false });
  assert.equal(status.ok, true);
  assert.equal(status.mode, 'mille-fleurs-gpu-matter');
  assert.equal(status.defaults.maxParticles, 1024);
  assert.equal(status.cosmicBridge.calendar.gregorianYearDays, 365.2425);
  assert.equal(status.cosmicBridge.moon.synodicMonthDays, 29.530588853);
  assert.equal(status.cosmicBridge.audio.physicalElectrolysis, true);
  assert.equal(status.cosmicBridge.audio.lightVacuumVibration, true);

  const flow = await runQflushFlow('qflush.shiryu.v3.matter.v1', {
    engine: 'gltf',
    input: { message: 'matiere au lieu de cube zen', payload: { ok: true } },
    maxParticles: 8,
    now: '2026-07-09T00:00:00.000Z',
    timeBasis: 'instant-decor',
  }, { requestId: 'req-shiryu-v3-matter' });
  assert.equal(flow.ok, true);
  assert.equal(flow.provider, 'local-qflush-fallback');
  assert.equal(flow.targetEngine, 'gltf');
  assert.equal(flow.adapters.gltf.primitive, 'POINTS');
  assert.equal(flow.cosmicRelations.audio.physicalElectrolysis, true);
  assert.equal(flow.cosmicRelations.audio.actuatesHardware, false);
  assert.equal(flow.cosmicRelations.instantShift.startsWith, 'decor');
  assert.equal(flow.sourceCell.payload.cosmic.timeBasis, 'instant-decor');
});

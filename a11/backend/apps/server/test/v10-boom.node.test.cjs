'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  V10_BOOM_METHOD,
  V10_BOOM_STATE,
  V10_CANON,
  resolveV10BoomConfig,
  buildV10BoomPlan,
  buildV10BoomFilterGraph,
  buildV10BoomArgs,
  runV10Boom,
  processV10BoomD40,
  loadV10Compass,
  opSym,
  oppositeArm,
  nextArmClockwise,
} = require('../src/audio/v10-boom.cjs');

test('V10 Boom — constantes canon Prime Spiral verrouillees', () => {
  assert.ok(Math.abs(V10_CANON.c7 - 0.029194480637266783) < 1e-12, 'c7 = |jhi|/phi');
  assert.ok(Math.abs(V10_CANON.pivot - 0.292) < 1e-3, 'pivot = 10*c7 ~= 0.292');
  // mg_phase = 9 - 2*t1/pi (t1 = premier zero non trivial de zeta)
  assert.ok(Math.abs(V10_CANON.mgPhase - 0.001554497790530303) < 1e-12, 'mg_phase = 9 - 2*t1/pi');
  assert.ok(Math.abs(V10_CANON.S - 40.0005 * Math.PI) < 1e-9, 'S = 40.0005*pi');
  // balance_RH : 1 au centre (ligne critique), 0 aux bords
  assert.equal(V10_CANON.balanceRh(0.5), 1);
  assert.equal(V10_CANON.balanceRh(0), 0);
  assert.equal(V10_CANON.balanceRh(1), 0);
});

test('V10 Boom — le filtre est la fermeture axe m (inversion retardee y=x-a*x(t-tau))', () => {
  const cfg = resolveV10BoomConfig({ wet: 0.15, boom: 0.6, delay: 12, sub: 30 });
  const g = buildV10BoomFilterGraph(cfg);
  // m-axis : copie retardée (adelay) + inversion (volume negatif) + mix dry.
  assert.match(g, /adelay=12\|12/);
  assert.match(g, /volume=-0\.6000/);            // -alpha = fermeture inverse R/m = -R
  assert.match(g, /amix=inputs=2:duration=first:normalize=0:weights=1 1/); // dry + inv
  // sub cap (highpass) + remix a wet 0.15
  assert.match(g, /highpass=f=30/);
  assert.match(g, /weights=1 0\.150/);
  assert.match(g, /alimiter=limit=0\.950:attack=5:release=50:level=false/);
  assert.match(g, /\[out\]/);
  const mp3Args = buildV10BoomArgs('v9.mp3', 'v10.mp3', cfg);
  assert.deepEqual(mp3Args.slice(-5), ['-codec:a', 'libmp3lame', '-b:a', '192k', 'v10.mp3']);
});

test('V10 Boom — garde-fou canon : wet <= 0.2, gain <= +3 dB, master de production', () => {
  const cfg = resolveV10BoomConfig({ wet: 0.9, boomGainDb: 12 });
  assert.ok(cfg.wet <= 0.2, 'wet clamped <= 0.2');
  assert.ok(cfg.boomGainDb <= 3, 'gain clamped <= +3 dB');
  assert.equal(cfg.peakLimit, 0.95);
  assert.equal(cfg.researchOnly, false);
  assert.equal(cfg.researchOrigin, true);
  assert.equal(cfg.productionDefault, true);
});

test('V10 Boom — runV10Boom desactive par defaut, active si VIVY_V10_BOOM_ENABLED', async () => {
  const off = await runV10Boom('in.mp3', 'out.mp3', {}, async () => { throw new Error('ne doit pas tourner'); });
  assert.equal(off.applied, false);
  let called = false;
  const fakeRun = async (args) => {
    called = true;
    assert.ok(args.includes('-filter_complex'));
    fs.writeFileSync(String(args.at(-1)), Buffer.from('v10-audio'));
  };
  const on = await runV10Boom('in.mp3', 'out.mp3', { enabled: true, runFfmpeg: fakeRun }, fakeRun);
  assert.equal(on.applied, true);
  assert.equal(called, true);
  assert.ok(Math.abs(on.canon.mgPhase - 0.001554497790530303) < 1e-12);
});

test('V10 Boom — traitement in-place garde une extension audio exploitable par ffmpeg', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v10-boom-in-place-'));
  const audioPath = path.join(root, 'master.mp3');
  fs.writeFileSync(audioPath, Buffer.from('v9-audio'));
  let renderedPath = '';
  try {
    const result = await runV10Boom(audioPath, audioPath, {
      enabled: true,
      runFfmpeg: async (args) => {
        renderedPath = String(args.at(-1));
        fs.writeFileSync(renderedPath, Buffer.from('v10-audio'));
      },
    });
    assert.equal(result.applied, true);
    assert.match(renderedPath, /[\\/]render\.mp3$/);
    assert.equal(fs.readFileSync(audioPath, 'utf8'), 'v10-audio');
    assert.equal(fs.existsSync(renderedPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V10 Boom — compose V9 Electrolyse puis la passe Boom explicite', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v10-boom-compose-'));
  const calls = [];
  const outputPath = path.join(root, 'master.flac');
  try {
    const processed = await processV10BoomD40({
      inputPath: path.join(root, 'source.wav'),
      outputPath,
      analysisOptions: { amount: 0.04 },
      processV9Turbo: async (options) => {
        calls.push({ type: 'v9', options });
        fs.writeFileSync(options.outputPath, Buffer.from('v9-audio'));
        return { method: 'v9', state: 'v9', variant: 'v9turbo', safety: { vocalSafe99ms: true } };
      },
      runFfmpeg: async (args) => {
        calls.push({ type: 'boom', args });
        fs.writeFileSync(String(args.at(-1)), Buffer.from('v10-audio'));
      },
    });
    assert.equal(calls[0].type, 'v9');
    assert.equal(calls[0].options.analysisOptions.electrolysis, true);
    assert.equal(calls[0].options.analysisOptions.electrolysisGuitar, true);
    assert.equal(calls[0].options.analysisOptions.modulation, 'electrolysis-guitar');
    assert.equal(calls[0].options.analysisOptions.amount, 0.04);
    assert.notEqual(calls[0].options.outputPath, outputPath);
    assert.match(calls[0].options.outputPath, /[\\/]v9-electrolysis\.flac$/);
    assert.equal(calls[1].type, 'boom');
    assert.equal(processed.method, V10_BOOM_METHOD);
    assert.equal(processed.state, V10_BOOM_STATE);
    assert.equal(processed.variant, 'v10boom');
    assert.equal(processed.baseVariant, 'v9electrolysis');
    assert.equal(processed.boom.applied, true);
    assert.equal(processed.safety.v9ElectrolysisBasePreserved, true);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'v10-audio');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V10 Boom — deux mixes concurrents restent isoles et ne s ecrasent pas', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v10-boom-isolated-'));
  const outputs = [
    path.join(root, 'premier.wav'),
    path.join(root, 'second.wav'),
  ];
  try {
    await Promise.all(outputs.map((outputPath, index) => processV10BoomD40({
      inputPath: path.join(root, `source-${index + 1}.mp3`),
      outputPath,
      processV9Turbo: async (options) => {
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 15 : 5));
        fs.writeFileSync(options.outputPath, Buffer.from(`v9-${index + 1}`));
        return { method: 'v9', state: 'v9', safety: {} };
      },
      runFfmpeg: async (args) => {
        const inputIndex = args.indexOf('-i');
        const v9Path = String(args[inputIndex + 1]);
        const finalPath = String(args.at(-1));
        await new Promise((resolve) => setTimeout(resolve, index === 0 ? 5 : 15));
        fs.writeFileSync(finalPath, Buffer.from(`${fs.readFileSync(v9Path, 'utf8')}-v10`));
      },
    })));

    assert.equal(fs.readFileSync(outputs[0], 'utf8'), 'v9-1-v10');
    assert.equal(fs.readFileSync(outputs[1], 'utf8'), 'v9-2-v10');
    assert.deepEqual(
      fs.readdirSync(root).sort(),
      ['premier.wav', 'second.wav'],
      'aucun repertoire de travail ne reste apres les deux mixes'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('V10 Boom — carte orientée canon : croix diagonale, cycle horaire, M reequilibre r/i', () => {
  // Croix diagonale (pas cartésienne classique) : chaque état dans un quadrant.
  assert.deepEqual(V10_CANON.orientation['+real'], { h: 'gauche', v: 'haut' });
  assert.deepEqual(V10_CANON.orientation['+imag'], { h: 'droite', v: 'haut' });
  assert.deepEqual(V10_CANON.orientation['-real'], { h: 'droite', v: 'bas' });
  assert.deepEqual(V10_CANON.orientation['-imag'], { h: 'gauche', v: 'bas' });
  // Cycle horaire : +real -> +imag -> -real -> -imag -> +real.
  assert.deepEqual(V10_CANON.crossCycle, ['+real', '+imag', '-real', '-imag']);
  assert.equal(nextArmClockwise('+real'), '+imag');
  assert.equal(nextArmClockwise('+imag'), '-real');
  assert.equal(nextArmClockwise('-real'), '-imag');
  assert.equal(nextArmClockwise('-imag'), '+real');
  // M reequilibre r/i et i/r : les bras opposés se ferment sur 1 (retombe sur la croix de reference).
  assert.equal(oppositeArm('+real'), '-real');
  assert.equal(oppositeArm('+imag'), '-imag');
  assert.equal(opSym('+real', '-real'), 1);
  assert.equal(opSym('+imag', '-imag'), 1);
  assert.equal(opSym('+real', '+imag'), 0);
  // Boussole chargée avant calcul (pas d'ecran noir) : origin/axes/orientation/state/transition/return.
  const compass = loadV10Compass('+imag', 0.6);
  assert.equal(compass.origin, 0);
  assert.equal(compass.currentState, '+imag');
  assert.equal(compass.transitionTable['+real'], '+imag');
  assert.equal(compass.returnRatio, 0.6);
  assert.equal(compass.researchOnly, false);
  assert.equal(compass.researchOrigin, true);
  assert.equal(compass.productionDefault, true);
  const plan = buildV10BoomPlan();
  assert.equal(plan.variant, 'v10boom');
  assert.equal(plan.baseVariant, 'v9electrolysis');
  assert.equal(plan.method, V10_BOOM_METHOD);
  assert.equal(plan.state, V10_BOOM_STATE);
  assert.equal(plan.safety.wetCeiling, 0.2);
  assert.equal(plan.safety.productionDefault, true);
  assert.equal(plan.safety.ownerListeningValidated, true);
});

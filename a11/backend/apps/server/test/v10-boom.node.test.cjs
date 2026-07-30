'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { V10_CANON, resolveV10BoomConfig, buildV10BoomFilterGraph, runV10Boom, loadV10Compass, opSym, oppositeArm, nextArmClockwise } = require('../src/audio/v10-boom.cjs');

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
  assert.match(g, /\[out\]/);
});

test('V10 Boom — garde-fou canon : wet <= 0.2, gain <= +3 dB, off par defaut', () => {
  const cfg = resolveV10BoomConfig({ wet: 0.9, boomGainDb: 12 });
  assert.ok(cfg.wet <= 0.2, 'wet clamped <= 0.2');
  assert.ok(cfg.boomGainDb <= 3, 'gain clamped <= +3 dB');
  assert.equal(cfg.researchOnly, true);
});

test('V10 Boom — runV10Boom desactive par defaut, active si VIVY_V10_BOOM_ENABLED', async () => {
  const off = await runV10Boom('in.mp3', 'out.mp3', {}, async () => { throw new Error('ne doit pas tourner'); });
  assert.equal(off.applied, false);
  let called = false;
  const fakeRun = async (args) => { called = true; assert.ok(args.includes('-filter_complex')); };
  const on = await runV10Boom('in.mp3', 'out.mp3', { enabled: true, runFfmpeg: fakeRun }, fakeRun);
  assert.equal(on.applied, true);
  assert.equal(called, true);
  assert.ok(Math.abs(on.canon.mgPhase - 0.001554497790530303) < 1e-12);
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
  assert.equal(compass.researchOnly, true);
});

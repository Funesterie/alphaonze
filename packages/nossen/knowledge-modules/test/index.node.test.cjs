const test = require('node:test');
const assert = require('node:assert/strict');

const { getModule, listModules, matchModules } = require('../src/index.cjs');

test('le canon croix M est charge et reste marque non cable au DSP', () => {
  const module = getModule('research.prime-spiral.cross-m');

  assert.ok(module);
  assert.equal(module.knowledge.implementationStatus.orientationAndCycle, 'recorded-and-unit-tested');
  assert.equal(module.knowledge.implementationStatus.audioGraph, 'does-not-execute-cross-or-TM');
  assert.equal(module.knowledge.formalization.unknownOperator, 'C_ref = T_M(C_h)');
  assert.equal(module.apply.constraints.keepTMUndefinedUntilConfirmed, true);
});

test('le module est retrouve avec ou sans accents', () => {
  assert.ok(matchModules('la croix de résonance horaire avec M').some((m) => m.id === 'research.prime-spiral.cross-m'));
  assert.ok(matchModules('iterations d iterations et quinternion').some((m) => m.id === 'research.prime-spiral.cross-m'));
  assert.equal(listModules().length, 4);
});

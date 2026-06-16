const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMotorcycleDirectorDomain,
} = require('../src/video/a11-director-motorcycle-domain.cjs');

test('resolves OKO powerjet as small carburetor near engine intake', () => {
  const result = resolveMotorcycleDirectorDomain('Beta AM6 50cc avec carbu OKO powerjet');
  const oko = result.objectCards.find((card) => /OKO/i.test(card.term));

  assert.ok(oko);
  assert.match(oko.resolvedMeaning, /carburetor|carbu/i);
  assert.match(oko.spatialRole, /engine intake|admission|moteur/i);
  assert.ok(oko.forbidden.some((entry) => /front object|frontal|reactor/i.test(entry)));
});

test('resolves Metrakit passage bas as low 2-stroke exhaust', () => {
  const result = resolveMotorcycleDirectorDomain('pot Metrakit passage bas sur AM6 50cc');
  const metrakit = result.objectCards.find((card) => /Metrakit/i.test(card.term));

  assert.ok(metrakit);
  assert.match(metrakit.resolvedMeaning, /exhaust|echappement|2-stroke|2T/i);
  assert.match(metrakit.spatialRole, /low|bas|under|sous/i);
});

test('locks lateral radiators and preserves front headlight plate', () => {
  const result = resolveMotorcycleDirectorDomain('50cc supermotard avec radiateurs lateraux et plaque phare');
  const lock = result.spatialLocks[0];
  const lockText = JSON.stringify(result.spatialLocks);

  assert.match(lock.positiveModel, /50cc|supermoto|mecaboite|moped/i);
  assert.deepEqual(lock.zones.front, ['headlight plate or number plate mask', 'high front fender']);
  assert.ok(lock.zones.side.some((entry) => /radiator|radiateur/i.test(entry)));
  assert.match(lockText, /radiators? (are )?side|radiateurs? lateraux/i);
  assert.match(lockText, /headlight plate|plaque phare/i);
  assert.match(lockText, /never replace|jamais remplacer|front radiator/i);
});

test('uses negative guardrails only after positive structure', () => {
  const result = resolveMotorcycleDirectorDomain('clip 50cc mecaboite street stunt');
  const positiveOrder = result.regenerationPolicy.positiveRestatementOrder.join(' ');
  const rejectText = result.verificationChecklist.rejectIf.join(' ');

  assert.match(positiveOrder, /vehicle identity/i);
  assert.match(positiveOrder, /front zone/i);
  assert.match(positiveOrder, /side radiator/i);
  assert.match(rejectText, /big road bike|gros cube|superbike/i);
  assert.match(rejectText, /pocket bike/i);
  assert.match(rejectText, /scooter/i);
  assert.match(rejectText, /huge front radiator|radiateur frontal/i);
});

test('seeds reference board roles without mixing identity and style', () => {
  const result = resolveMotorcycleDirectorDomain('clip Beta AM6 50cc OKO Metrakit neon pluie');
  const roles = [
    ...result.referenceBoard.identityReferences,
    ...result.referenceBoard.spatialReferences,
    ...result.referenceBoard.styleReferences,
  ].map((entry) => entry.role);

  assert.ok(roles.includes('vehicle_identity'));
  assert.ok(roles.includes('engine_carburetor'));
  assert.ok(roles.includes('low_exhaust'));
  assert.ok(roles.includes('art_direction'));
  assert.ok(result.referenceBoard.roleSeparationRules.some((rule) => /style references never replace/i.test(rule)));
});

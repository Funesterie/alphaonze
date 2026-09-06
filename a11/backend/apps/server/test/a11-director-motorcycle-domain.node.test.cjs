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

// Motos du recit NOSSEN — episodes 1 et 2.

test('resolves Gilera GSM 2001 as an RK66 bike, never AM6', () => {
  const result = resolveMotorcycleDirectorDomain('Gilera GSM 2001 dans le garage');
  const gilera = result.objectCards.find((card) => /Gilera/i.test(card.term));

  assert.ok(gilera);
  assert.match(gilera.sourceFacts.join(' '), /RK66/);
  // Le piege : reutiliser les references AM6 donnerait le mauvais bloc moteur.
  assert.ok(gilera.sourceFacts.some((fact) => /not an AM6|pas.{0,4}am6/i.test(fact)));
  assert.ok(gilera.forbidden.some((entry) => /four-stroke|scooter|pocket bike/i.test(entry)));
});

test('resolves Cagiva WMX as a 125 enduro, not a 50cc supermoto', () => {
  const result = resolveMotorcycleDirectorDomain('Cagiva WMX 125 1985 avec deux personnes dessus');
  const cagiva = result.objectCards.find((card) => /Cagiva/i.test(card.term));

  assert.ok(cagiva);
  assert.ok(cagiva.mustShow.some((entry) => /21-inch|21 pouces/i.test(entry)));
  assert.ok(cagiva.forbidden.some((entry) => /supermoto/i.test(entry)));

  // L'identite vehicule doit basculer : sinon le module sortirait un supermotard 50cc.
  const facts = result.plannerFacts.join(' ');
  assert.match(facts, /125 enduro/i);
  assert.doesNotMatch(facts, /50cc mecanoboite supermoto/i);
});

test('keeps the 50cc supermoto identity when no period bike is named', () => {
  const facts = resolveMotorcycleDirectorDomain('Beta AM6 50cc supermotard').plannerFacts.join(' ');
  assert.match(facts, /50cc mecanoboite supermoto/i);
  assert.doesNotMatch(facts, /enduro/i);
});

test('flags the Cagiva model as unconfirmed rather than asserting it', () => {
  // Identifie d'apres une photo de famille ; Djeff n'a pas retrouve la livree exacte.
  const cagiva = resolveMotorcycleDirectorDomain('Cagiva WMX 125')
    .objectCards.find((card) => /Cagiva/i.test(card.term));

  assert.ok(cagiva.confidence < 0.7, `confiance trop haute pour un modele non confirme : ${cagiva.confidence}`);
  assert.ok(cagiva.sourceFacts.some((fact) => /confirmer|probable/i.test(fact)));
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BRANCH_COMPASS,
  D9_NAVIGATION_EQUATION,
  DOUBLE_HARMONIC_SCHEMA,
  PRIME_SIGNATURE,
  buildVivyProsodyNeo4jConstraints,
  buildVivyProsodyNeo4jCypher,
  buildVivyProsodyNeo4jRows,
  buildVivyDoubleHarmonicStyleHint,
  buildVivyProsodyPlan,
  buildVivyProsodyStyleHint,
  formatVivyDoubleHarmonicSyncForBrief,
  formatVivyDoubleHarmonicSyncForPrompt,
  formatVivyProsodyPlanForBrief,
  formatVivyProsodyPlanForPrompt,
} = require('../src/vivy/prosody-prime-complex.cjs');

function valuesAreNeo4jScalar(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) {
    return value.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
  }
  return ['string', 'number', 'boolean'].includes(typeof value);
}

test('Vivy prime-complex prosody creates continuous scalar coordinates for a Djeff/Vivy duet', () => {
  const plan = buildVivyProsodyPlan({
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songMood: 'rap moto sombre, hook clair',
    songText: [
      '[Verse 1 - Djeff]',
      "Un quatorzieme dans la bombonne, deux point deux dans l'huile.",
      '[Chorus - Duo]',
      "Quand la vitesse monte, Vivy tient le phare et Djeff garde le flow.",
    ].join('\n'),
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.schema, 'funesterie.vivy.prosody-prime-complex.v1');
  assert.deepEqual(plan.cast.ids, ['djeff', 'vivy']);
  assert.ok(plan.segments.length >= 2);
  assert.equal(plan.doubleHarmonic.schema, DOUBLE_HARMONIC_SCHEMA);
  assert.equal(plan.doubleHarmonic.segments.length, plan.segments.length);
  assert.deepEqual(plan.doubleHarmonic.basis.branchCompass.map((branch) => branch.symbol), ['1', 'i', '0', '-i', '-1']);
  assert.equal(plan.doubleHarmonic.basis.navigationEquation, D9_NAVIGATION_EQUATION);
  assert.ok(plan.doubleHarmonic.avgTempoBpm >= 72);
  assert.ok(plan.doubleHarmonic.dominantAnchors.includes('mécanique'));
  assert.ok(plan.doubleHarmonic.dominantAnchors.includes('vitesse'));
  assert.ok(plan.segments.some((segment) => segment.roleId === 'djeff'));
  assert.ok(plan.segments.some((segment) => segment.roleId === 'duo' || segment.roleId === 'vivy'));

  for (const segment of plan.segments) {
    assert.ok(PRIME_SIGNATURE.includes(segment.prime));
    assert.equal(Number.isInteger(segment.prime), true);
    assert.equal(typeof segment.real, 'number');
    assert.equal(typeof segment.imaginary, 'number');
    assert.equal(typeof segment.phase, 'number');
    assert.equal(typeof segment.magnitude, 'number');
    assert.equal(segment.curve.length, 5);
    assert.match(segment.derivative, /^[+0-]{5}$/);
  }
  for (const segment of plan.doubleHarmonic.segments) {
    assert.match(segment.sync.triState, /^[+0-]{5}$/);
    assert.ok(['locked', 'guided', 'loose'].includes(segment.sync.state));
    assert.equal(typeof segment.audio.tempoBpm, 'number');
    assert.ok(BRANCH_COMPASS.some((branch) => branch.symbol === segment.navigation.branchSymbol));
    assert.equal(typeof segment.navigation.accelerationK, 'number');
    assert.equal(typeof segment.navigation.coherenceM, 'number');
    assert.equal(typeof segment.navigation.nextReal, 'number');
    assert.equal(typeof segment.navigation.nextImaginary, 'number');
    assert.equal(segment.navigation.equation, D9_NAVIGATION_EQUATION);
    assert.match(segment.control, /bpm/);
    assert.match(segment.control, /branch=/);
  }

  const brief = formatVivyProsodyPlanForBrief(plan);
  assert.match(brief, /Prosodie interne/i);
  assert.match(brief, /impulsions premieres/i);
  assert.match(brief, /Double harmonique interne/i);
  assert.doesNotMatch(brief, /ASCII4|NUMA8|\[a4:|\[numa8:/i);

  const prompt = formatVivyProsodyPlanForPrompt(plan);
  assert.match(prompt, /prime is integer/i);
  assert.match(prompt, /imaginary/i);
  assert.match(prompt, /Double harmonic sync internal map/i);
  assert.doesNotMatch(prompt, /ASCII4|NUMA8/i);

  const syncBrief = formatVivyDoubleHarmonicSyncForBrief(plan.doubleHarmonic);
  const syncPrompt = formatVivyDoubleHarmonicSyncForPrompt(plan.doubleHarmonic);
  assert.match(syncBrief, /rythme\/timbre/i);
  assert.match(syncPrompt, /trinary/i);
  assert.match(syncPrompt, /branch compass/i);
  assert.match(syncPrompt, /branch=/i);

  const style = buildVivyProsodyStyleHint(plan);
  assert.match(style, /prime-pulsed phrasing/i);
  assert.match(style, /double-harmonic synchronized flow/i);
  assert.match(buildVivyDoubleHarmonicStyleHint(plan.doubleHarmonic), /hidden trinary microtiming/i);
});

test('Vivy prime-complex prosody exports Neo4j rows without nested property payloads', () => {
  const plan = buildVivyProsodyPlan({
    mode: 'song',
    songArtists: ['djeff', 'a11', 'k44', 'vivy'],
    songText: 'course poursuite, skill tree, moteur, mémoire et équipe Funesterie',
  });
  const rows = buildVivyProsodyNeo4jRows(plan);
  const constraints = buildVivyProsodyNeo4jConstraints();
  const cypher = buildVivyProsodyNeo4jCypher();

  assert.equal(rows.plan.id, plan.id);
  assert.ok(rows.cast.length >= 4);
  assert.equal(rows.segments.length, plan.segments.length);
  assert.equal(rows.sync.length, plan.segments.length);
  assert.deepEqual(rows.plan.doubleHarmonicBranchCompass, ['1', 'i', '0', '-i', '-1']);
  assert.equal(rows.plan.doubleHarmonicNavigationEquation, D9_NAVIGATION_EQUATION);
  assert.ok(constraints.some((line) => /VivyProsodyPlan/.test(line)));
  assert.ok(constraints.some((line) => /VivyDoubleHarmonicSync/.test(line)));
  assert.match(cypher, /^CYPHER 25/);
  assert.match(cypher, /PrimePulse/);
  assert.match(cypher, /ComplexPhase/);
  assert.match(cypher, /VivyProsodyPoint/);
  assert.match(cypher, /VivyDoubleHarmonicSync/);

  for (const value of Object.values(rows.plan)) {
    assert.equal(valuesAreNeo4jScalar(value), true);
  }
  for (const cast of rows.cast) {
    for (const value of Object.values(cast)) {
      assert.equal(valuesAreNeo4jScalar(value), true);
    }
  }
  for (const segment of rows.segments) {
    for (const value of Object.values(segment.props)) {
      assert.equal(valuesAreNeo4jScalar(value), true);
    }
    for (const value of Object.values(segment.phase)) {
      assert.equal(valuesAreNeo4jScalar(value), true);
    }
    for (const point of segment.points) {
      for (const value of Object.values(point)) {
        assert.equal(valuesAreNeo4jScalar(value), true);
      }
    }
  }
  for (const sync of rows.sync) {
    assert.ok(BRANCH_COMPASS.some((branch) => branch.symbol === sync.props.branchSymbol));
    assert.equal(sync.props.navigationEquation, D9_NAVIGATION_EQUATION);
    assert.equal(typeof sync.props.accelerationK, 'number');
    assert.equal(typeof sync.props.coherenceM, 'number');
    assert.equal(typeof sync.props.navigationNextReal, 'number');
    assert.equal(typeof sync.props.navigationNextImaginary, 'number');
    for (const value of Object.values(sync.props)) {
      assert.equal(valuesAreNeo4jScalar(value), true);
    }
  }
});

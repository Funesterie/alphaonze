'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PRIME_SIGNATURE,
  buildVivyProsodyNeo4jConstraints,
  buildVivyProsodyNeo4jCypher,
  buildVivyProsodyNeo4jRows,
  buildVivyProsodyPlan,
  buildVivyProsodyStyleHint,
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

  const brief = formatVivyProsodyPlanForBrief(plan);
  assert.match(brief, /Prosodie interne/i);
  assert.match(brief, /impulsions premieres/i);
  assert.doesNotMatch(brief, /ASCII4|NUMA8|\[a4:|\[numa8:/i);

  const prompt = formatVivyProsodyPlanForPrompt(plan);
  assert.match(prompt, /prime is integer/i);
  assert.match(prompt, /imaginary/i);
  assert.doesNotMatch(prompt, /ASCII4|NUMA8/i);

  const style = buildVivyProsodyStyleHint(plan);
  assert.match(style, /prime-pulsed phrasing/i);
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
  assert.ok(constraints.some((line) => /VivyProsodyPlan/.test(line)));
  assert.match(cypher, /^CYPHER 25/);
  assert.match(cypher, /PrimePulse/);
  assert.match(cypher, /ComplexPhase/);
  assert.match(cypher, /VivyProsodyPoint/);

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
});

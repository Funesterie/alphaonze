const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSemanticResonanceGraphTriplets,
  explainResonance,
  loadSemanticResonanceSeeds,
} = require('../src/knowledge/semantic-resonance.cjs');

test('semantic resonance loads the seed corpus', () => {
  const seeds = loadSemanticResonanceSeeds();
  assert.equal(seeds.schema, 'funesterie.semantic-resonance.v1');
  assert.ok(seeds.entries.length >= 5);
  assert.ok(seeds.entries.some((entry) => entry.id === 'sapin'));
});

test('sapin carries sensory, cultural and wordplay resonance', () => {
  const result = explainResonance('sapin', 'ca sent le sapin ici mais aussi Noel et la resine');

  assert.equal(result.ok, true);
  assert.equal(result.matched.id, 'sapin');
  assert.ok(result.score.layerCount >= 5);
  assert.ok(result.score.score > 20);
  assert.ok(result.activeFacets.some((facet) => facet.layer === 'idiom'));
  assert.ok(result.tones.includes('dark-humor'));
});

test('Black Pearl and Flying Dutchman interaction increases resonance', () => {
  const plain = explainResonance('bateau');
  const linked = explainResonance('Black Pearl', 'on est passe du Black Pearl au Hollandais Volant');

  assert.equal(linked.ok, true);
  assert.equal(linked.matched.id, 'black-pearl');
  assert.ok(linked.score.interactionCount >= 1);
  assert.ok(linked.score.score > (plain.ok ? plain.score.score : 0));
  assert.ok(linked.interactions.some((interaction) => interaction.target === 'flying-dutchman'));
});

test('Killua is not reduced to a power only', () => {
  const result = explainResonance('Killua', 'vitesse, electricite, confiance et famille toxique');
  const labels = result.activeFacets.map((facet) => facet.label).join(' ');

  assert.equal(result.ok, true);
  assert.match(labels, /vitesse/i);
  assert.match(labels, /electricite/i);
  assert.match(labels, /confiance/i);
  assert.match(labels, /famille toxique/i);
});

test('semantic resonance graph exposes usable triplets', () => {
  const graph = buildSemanticResonanceGraphTriplets(loadSemanticResonanceSeeds());
  const relationshipTypes = new Set(graph.relationships.map((rel) => rel.type));

  assert.ok(graph.nodes.some((node) => node.labels.includes('A11CulturalAnchor')));
  assert.ok(relationshipTypes.has('EVOKES'));
  assert.ok(relationshipTypes.has('HAS_WORDPLAY'));
  assert.ok(relationshipTypes.has('CONTRASTS_WITH'));
});

test('voix de lait corpus capsule is searchable without raw transcript leakage', () => {
  const result = explainResonance(
    'voix de lait',
    'A11 doit parler avec une cadence calme et pedagogique sans prophetie anxiogene'
  );
  const labels = result.activeFacets.map((facet) => facet.label).join(' ');

  assert.equal(result.ok, true);
  assert.equal(result.matched.id, 'a11-voix-de-lait');
  assert.match(labels, /cadence calme/i);
  assert.match(labels, /responsabilite sans culpabilisation/i);
  assert.doesNotMatch(JSON.stringify(result), /Le livre de l humanite est ouvert/i);
});

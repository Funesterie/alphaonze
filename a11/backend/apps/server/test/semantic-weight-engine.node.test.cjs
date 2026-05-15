const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSemanticWeightsFromScene,
  buildWeightedImagePromptFragments,
  resolveFunesterieContext,
} = require('../src/linguistics/semantic-weight-engine.cjs');
const {
  enrichImagePromptWithLinguisticScene,
  parseLinguisticScene,
} = require('../src/linguistics/linguistic-scene-parser.cjs');

test('semantic weight engine assigns higher weight to subject than readability style', () => {
  const scene = parseLinguisticScene("un lapin violet sort d'un chapeau de magicien");
  const weights = buildSemanticWeightsFromScene(scene.graph);

  const subject = weights.items.find((entry) => entry.role === 'subject');
  const relation = weights.items.find((entry) => entry.role === 'action_relation');
  const style = weights.items.find((entry) => entry.role === 'style_readability');

  assert.equal(weights.ok, true);
  assert.equal(subject.text, 'lapin violet');
  assert.equal(subject.weight, 1.4);
  assert.equal(relation.weight, 1.25);
  assert.equal(style.weight, 0.8);
  assert.ok(subject.weight > style.weight);
});

test('semantic weight engine emits SD weighted fragments', () => {
  const scene = parseLinguisticScene("un lapin violet sort d'un chapeau de magicien");
  const weights = buildSemanticWeightsFromScene(scene.graph);
  const fragments = buildWeightedImagePromptFragments(weights).join(', ');

  assert.match(fragments, /\(lapin violet:1\.4\)/i);
  assert.match(fragments, /\(sortant de chapeau de magicien:1\.25\)/i);
  assert.match(fragments, /\(chapeau de magicien:1\.2\)/i);
});

test('semantic weight engine applies Funesterie context bias without making technical modules human', () => {
  const vivyContext = resolveFunesterieContext({ activeAgent: 'Vivy', narrativeContext: 'NOSSEN' });
  assert.deepEqual(vivyContext.profiles.map((entry) => entry.id), ['vivy', 'nossen']);
  assert.ok(vivyContext.styleBias.some((entry) => /musical/i.test(entry)));
  assert.ok(vivyContext.styleBias.some((entry) => /nexus/i.test(entry)));

  const moduleContext = resolveFunesterieContext({ module: 'QFlush' });
  assert.equal(moduleContext.technicalModule, true);
  assert.ok(moduleContext.avoid.some((entry) => /human character portrait/i.test(entry)));
});

test('linguistic scene enrichment carries semantic weights into final prompt', () => {
  const enriched = enrichImagePromptWithLinguisticScene({
    rawPrompt: "genere une image d'un lapin violet sortant d'un chapeau de magicien",
    prompt: 'lapin, no readable text, corps complet bien visible, color palette: violet',
    negativePrompt: '',
    context: { activeAgent: 'Vivy', narrativeContext: 'NOSSEN' },
  });

  assert.equal(enriched.applied, true);
  assert.match(enriched.prompt, /\(lapin violet:1\.4\)/i);
  assert.match(enriched.prompt, /violet neon/i);
  assert.match(enriched.prompt, /living nexus world/i);
  assert.match(enriched.negativePrompt, /generic robot/i);
});

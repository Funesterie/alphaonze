const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enrichImagePromptWithLinguisticScene,
  parseLinguisticScene,
} = require('../src/linguistics/linguistic-scene-parser.cjs');

test('parseLinguisticScene preserves a French subject-action-origin relation', () => {
  const result = parseLinguisticScene("genere une image d'un lapin violet sortant d'un chapeau de magicien");

  assert.equal(result.ok, true);
  assert.equal(result.language, 'fr');
  assert.equal(result.graph.entities.find((entry) => entry.role === 'subject')?.text, 'lapin violet');
  assert.equal(result.graph.entities.find((entry) => entry.role === 'origin')?.text, 'chapeau de magicien');
  assert.deepEqual(result.graph.relations[0], {
    from: 'subject:main',
    type: 'emerges_from',
    to: 'object:origin',
  });
});

test('enrichImagePromptWithLinguisticScene strengthens SD prompts without touching MASK', () => {
  const enriched = enrichImagePromptWithLinguisticScene({
    rawPrompt: "genere une image d'un lapin violet sortant d'un chapeau de magicien",
    prompt: 'lapin, no readable text, corps complet bien visible, color palette: violet',
    negativePrompt: 'watermark',
  });

  assert.equal(enriched.applied, true);
  assert.match(enriched.prompt, /lapin violet/i);
  assert.match(enriched.prompt, /chapeau de magicien/i);
  assert.match(enriched.prompt, /un seul sujet principal/i);
  assert.match(enriched.negativePrompt, /plusieurs sujets/i);
});

test('parseLinguisticScene also exposes a simple English scene graph', () => {
  const result = parseLinguisticScene("generate an image of a purple rabbit emerges from a magician's hat");

  assert.equal(result.ok, true);
  assert.equal(result.language, 'en');
  assert.equal(result.graph.entities.find((entry) => entry.role === 'subject')?.text, 'purple rabbit');
  assert.equal(result.graph.entities.find((entry) => entry.role === 'origin')?.text, "magician's hat");
});

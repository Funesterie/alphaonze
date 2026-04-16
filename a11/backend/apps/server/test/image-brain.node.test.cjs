const test = require('node:test');
const assert = require('node:assert/strict');

const { createA11ImageBrain } = require('../src/image/a11-image-brain.cjs');

test('a11-image-brain plans a direct generate flow for "génère un lapin doré"', () => {
  const brain = createA11ImageBrain();
  const decision = brain.planRequest('génère un lapin doré');

  assert.equal(decision.handled, true);
  assert.equal(decision.mode, 'generate');
  assert.equal(decision.canonicalIntent.task.action, 'generate');
  assert.equal(decision.canonicalIntent.subject.entity, 'lapin');
  assert.match(String(decision.canonicalIntent.subject.prompt || ''), /lapin doré/i);
  assert.ok(decision.canonicalIntent.appliedPacks.includes('base-literal-image'));
  assert.ok(decision.knowledge.activeModules.some((entry) => entry.id === 'linguistics.fr.semantic'));
  assert.ok(decision.knowledge.activeModules.some((entry) => entry.id === 'image.composition.core'));
  assert.equal(decision.pipelineRole, 'enrichment-only');
  assert.equal(decision.canonicalIntent.meta.canonicalMaskProducer, 'text-to-wazaa -> wazaa-to-mask');
  assert.equal(decision.wazaaHint.intent.type, 'image.generate');
});

test('a11-image-brain enriches a donkey kong cartoon request with visible packs', () => {
  const brain = createA11ImageBrain();
  const decision = brain.planRequest('fais-moi un donkey kong cartoon');

  assert.equal(decision.handled, true);
  assert.equal(decision.mode, 'generate');
  assert.equal(decision.canonicalIntent.subject.entity, 'donkey kong');
  assert.ok(decision.canonicalIntent.appliedPacks.includes('cartoon-render'));
  assert.ok(decision.canonicalIntent.appliedPacks.includes('retro-game-character'));
  assert.ok(decision.knowledge.activeModules.some((entry) => entry.id === 'image.reference.characters'));
  assert.ok(decision.knowledge.impacts.some((entry) => entry.moduleId === 'image.reference.characters'));
});

test('a11-image-brain routes mario 64 show prompts to web image search', () => {
  const brain = createA11ImageBrain();
  const decision = brain.planRequest('montre-moi une image de mario 64');

  assert.equal(decision.handled, true);
  assert.equal(decision.mode, 'web_search');
  assert.equal(decision.canonicalIntent.task.action, 'search_web');
  assert.match(String(decision.canonicalIntent.subject.searchQuery || ''), /mario 64/i);
  assert.equal(decision.canonicalIntent.meta.pipelineRole, 'enrichment-only');
});

test('a11-image-brain keeps messy prompts usable for image generation', () => {
  const brain = createA11ImageBrain();
  const decision = brain.planRequest('euh salut stp tu peux me faire un donkey kong cartoon propre');

  assert.equal(decision.handled, true);
  assert.equal(decision.mode, 'generate');
  assert.equal(decision.canonicalIntent.subject.entity, 'donkey kong');
});

test('a11-image-brain takes initiative on plain show requests', () => {
  const brain = createA11ImageBrain();
  const decision = brain.planRequest('je veux voir cendrillon');

  assert.equal(decision.handled, true);
  assert.equal(decision.mode, 'web_search');
  assert.equal(decision.canonicalIntent.subject.searchQuery, 'cendrillon');
  assert.match(String(decision.debug?.trace?.join(' | ') || ''), /show_request_with_subject/);
  assert.ok(decision.knowledge.activeModules.some((entry) => entry.id === 'linguistics.fr.semantic'));
});

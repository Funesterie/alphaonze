const test = require('node:test');
const assert = require('node:assert/strict');

const analyzeSemanticIntent = require('../src/mask/semantic/analyze-semantic-intent.cjs');
const { buildPromptSeed } = require('../src/image/prompt-builder.cjs');
const {
  activateKnowledgeModules,
  inferLanguage,
} = require('../src/knowledge/a11-knowledge-operator.cjs');
const {
  buildNumaContext,
  lookupNumaToken,
} = require('../src/knowledge/numa-symbolic-language.cjs');
const {
  buildZenContext,
  isZenPrompt,
} = require('../src/knowledge/zen-container.cjs');

test('knowledge operator infers french for common A11 prompts', () => {
  assert.equal(inferLanguage('génère un lapin doré'), 'fr');
  assert.equal(inferLanguage('je veux voir cendrillon'), 'fr');
});

test('knowledge operator activates image and linguistics modules for image generation', () => {
  const text = 'fais-moi un donkey kong cartoon';
  const semanticAnalysis = analyzeSemanticIntent(text);
  const promptSeed = buildPromptSeed(text, semanticAnalysis);
  const modules = activateKnowledgeModules({
    text,
    semanticAnalysis,
    mode: 'generate',
    domain: 'image',
    promptSeed,
    canonicalIntent: {
      task: { domain: 'image' },
      execution: { mode: 'generate' },
      style: { renderHints: promptSeed.renderHints },
      subject: { references: promptSeed.referenceHints },
    },
  });

  const ids = modules.map((entry) => entry.id);
  assert.ok(ids.includes('linguistics.fr.semantic'));
  assert.ok(ids.includes('image.composition.core'));
  assert.ok(ids.includes('image.reference.characters'));
});

test('knowledge operator can select python.core for code-oriented prompts', () => {
  const text = 'ecris un script python pour trier des images png';
  const semanticAnalysis = analyzeSemanticIntent(text);
  const modules = activateKnowledgeModules({
    text,
    semanticAnalysis,
    mode: 'plan',
    domain: 'code',
    promptSeed: buildPromptSeed(text, semanticAnalysis),
    canonicalIntent: {
      task: { domain: 'code' },
      execution: { mode: 'plan' },
      style: { renderHints: [] },
      subject: { references: [] },
    },
  });

  assert.ok(modules.some((entry) => entry.id === 'python.core'));
});

test('knowledge operator can select auth and network modules from semantic vocabulary', () => {
  const text = 'mon jwt bearer casse avec une erreur cors sur mon api cloudflare';
  const semanticAnalysis = analyzeSemanticIntent(text);
  const modules = activateKnowledgeModules({
    text,
    semanticAnalysis,
    mode: 'semantic',
    domain: 'network',
    promptSeed: buildPromptSeed(text, semanticAnalysis),
    canonicalIntent: {
      task: { domain: 'network' },
      execution: { mode: 'semantic' },
      style: { renderHints: [] },
      subject: { references: [] },
    },
  });

  assert.ok(modules.some((entry) => entry.id === 'security.auth'));
  assert.ok(modules.some((entry) => entry.id === 'networking.basics'));
});

test('knowledge operator activates NUMA symbolic language without generic numerology', () => {
  const text = 'en NUMA, quelle est la force des nombres 5, 16 et 40 ?';
  const semanticAnalysis = analyzeSemanticIntent(text);
  const modules = activateKnowledgeModules({
    text,
    semanticAnalysis,
    mode: 'semantic',
    domain: '',
    promptSeed: buildPromptSeed(text, semanticAnalysis),
    canonicalIntent: {
      task: { domain: '' },
      execution: { mode: 'semantic' },
      style: { renderHints: [] },
      subject: { references: [] },
    },
  });

  assert.ok(modules.some((entry) => entry.id === 'language.numa.symbolic'));
  assert.equal(lookupNumaToken('5').primaryMeaning, 'creation et chaos');
  assert.equal(lookupNumaToken('16').primaryMeaning, 'maison, habitat, foyer');
  assert.equal(lookupNumaToken('40').primaryMeaning, 'mort');
  const context = buildNumaContext(text);
  assert.equal(context.isNumaPrompt, true);
  assert.deepEqual(context.tokens.map((entry) => entry.token), ['5', '16', '40']);
});

test('knowledge operator activates ZEN container format as NEZ inverse', () => {
  const text = 'ZEN est un zip inverse: une archive chiffree multi-load avec cube RGBA et NEZ inverse';
  const semanticAnalysis = analyzeSemanticIntent(text);
  const modules = activateKnowledgeModules({
    text,
    semanticAnalysis,
    mode: 'semantic',
    domain: '',
    promptSeed: buildPromptSeed(text, semanticAnalysis),
    canonicalIntent: {
      task: { domain: '' },
      execution: { mode: 'semantic' },
      style: { renderHints: [] },
      subject: { references: [] },
    },
  });

  assert.ok(modules.some((entry) => entry.id === 'format.zen.container'));
  assert.equal(isZenPrompt(text), true);
  const context = buildZenContext(text);
  assert.match(context.canonicalDefinition, /zip inverse/);
  assert.ok(context.commonErrors.some((entry) => entry.includes('zip renomme')));
  assert.ok(context.layers.some((entry) => entry.id === 'cube_map'));
});

test('knowledge operator activates wheeling gate model for rider and prime gap prompts', () => {
  const text = 'applique la porte en wheeling aux nombres premiers, non-premiers et pattern gaps';
  const semanticAnalysis = analyzeSemanticIntent(text);
  const modules = activateKnowledgeModules({
    text,
    semanticAnalysis,
    mode: 'semantic',
    domain: '',
    promptSeed: buildPromptSeed(text, semanticAnalysis),
    canonicalIntent: {
      task: { domain: '' },
      execution: { mode: 'semantic' },
      style: { renderHints: [] },
      subject: { references: [] },
    },
  });

  const module = modules.find((entry) => entry.id === 'mobility.wheeling.gate');
  assert.ok(module);
  assert.ok(module.knowledge.threeForces.some((entry) => entry.id === 'return-rotation'));
  assert.ok(module.knowledge.primeMapping.some((entry) => entry.includes('gap')));
});

const test = require('node:test');
const assert = require('node:assert/strict');

const analyzeSemanticIntent = require('../src/mask/semantic/analyze-semantic-intent.cjs');
const { buildPromptSeed } = require('../src/image/prompt-builder.cjs');
const {
  activateKnowledgeModules,
  inferLanguage,
} = require('../src/knowledge/a11-knowledge-operator.cjs');

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

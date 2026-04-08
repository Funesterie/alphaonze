const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createIntentResolver,
} = require('../src/resolve-user-request.cjs');
const {
  normalizeIntentType,
} = require('../src/mask/semantic/semantic-utils.cjs');
const validateMaskUnified = require('../src/mask/validate-mask-unified.cjs');

test('semantic intent aliases normalize to canonical source-of-truth intents', () => {
  assert.equal(normalizeIntentType('code.generate'), 'code.python.generate');
  assert.equal(normalizeIntentType('text.answer'), 'chat.reply');
  assert.equal(normalizeIntentType('action.run'), 'chat.reply');
  assert.equal(normalizeIntentType('memory.recall'), 'chat.reply');
  assert.equal(normalizeIntentType('ui.display'), 'chat.reply');
});

test('resolveUserRequest clarifies ambiguous image requests versus web image search', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'affiche un dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'clarification');
  assert.equal(resolution.clarification.shouldClarify, true);
  assert.match(
    String(resolution.clarification.question || ''),
    /genere une image|cherche une image existante sur le web/i
  );
});

test('resolveUserRequest emits a valid mask-1 image.generate mask and compiles it', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'genere une image de dragon bleu',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'image.generate');
  assert.equal(resolution.mask.intent, 'image.generate');
  assert.equal(resolution.mask.version, 'mask-1');
  assert.equal(validateMaskUnified(resolution.mask).valid, true);
  assert.equal(resolution.compiled.target, 'image-prompt-fr');
  assert.equal(typeof resolution.compiled.value.prompt, 'string');
});

test('resolveUserRequest emits canonical code.python.generate masks that compile to python', async () => {
  const resolver = createIntentResolver();
  const resolution = await resolver.resolveUserRequest({
    userText: 'ecris un script python qui trie des png',
    executeRuntime: false,
  });

  assert.equal(resolution.kind, 'code.python.generate');
  assert.equal(resolution.mask.intent, 'code.python.generate');
  assert.equal(resolution.mask.version, 'mask-1');
  assert.equal(validateMaskUnified(resolution.mask).valid, true);
  assert.equal(resolution.compiled.target, 'python');
  assert.match(String(resolution.code || resolution.compiled.value || ''), /def main|Path/);
});

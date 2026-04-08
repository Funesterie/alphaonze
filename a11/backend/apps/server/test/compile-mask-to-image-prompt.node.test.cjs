const test = require('node:test');
const assert = require('node:assert/strict');

const compileMaskToImagePrompt = require('../src/mask/compile-mask-to-image-prompt.cjs');

test('compileMaskToImagePrompt keeps french prompts free of imperative negative instructions', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d un pokemon dragon feu',
    inputs: {
      subject: ['pokemon dragon feu'],
      environment: [],
      style: ['high quality', 'detailed'],
      composition: ['single main subject', 'solo composition', 'clear centered composition'],
      lighting: [],
      palette: ['orange', 'red'],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /Le corps, les ailes et les flammes restent bien distincts/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bdo not\b/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /pas au fond|pas au background|not to the background/i);
});

test('compileMaskToImagePrompt makes soda cans explicit as metal cans', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d une canette de soda',
    inputs: {
      subject: ['canette de soda'],
      environment: [],
      style: ['high quality'],
      composition: ['single main subject'],
      lighting: [],
      palette: [],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /canette métallique en aluminium/i);
  assert.match(String(compiled.prompt || ''), /silhouette cylindrique/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

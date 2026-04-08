const test = require('node:test');
const assert = require('node:assert/strict');

const compileMaskToImagePrompt = require('../src/mask/compile-mask-to-image-prompt.cjs');

test('compileMaskToImagePrompt keeps french prompts free of imperative negative instructions', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d un pokemon dragon feu',
    inputs: {
      subject: ['pokemon dragon feu'],
      environment: [],
      style: ['haute qualité'],
      composition: ['silhouette lisible', 'effets lumineux bien séparés du sujet'],
      lighting: [],
      palette: ['orange', 'red'],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /Demande : genere une image d un pokemon dragon feu/i);
  assert.match(String(compiled.prompt || ''), /Sujet principal : pokemon dragon feu/i);
  assert.match(String(compiled.prompt || ''), /Composition : silhouette lisible, effets lumineux bien séparés du sujet/i);
  assert.match(String(compiled.prompt || ''), /Créer une image fidèle à la demande/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bdo not\b/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /pas au fond|pas au background|not to the background/i);
});

test('compileMaskToImagePrompt stays simple and keeps user wording for soda cans', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d une canette de soda',
    inputs: {
      subject: ['canette de soda'],
      environment: [],
      style: ['haute qualité'],
      composition: [],
      lighting: [],
      palette: [],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /Sujet principal : canette de soda/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /aluminium|silhouette cylindrique/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

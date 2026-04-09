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
  assert.match(String(compiled.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(compiled.negative_prompt || ''), /watermark/i);
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
  assert.match(String(compiled.negative_prompt || ''), /objets multiples/i);
  assert.match(String(compiled.negative_prompt || ''), /décor encombré/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /aluminium|silhouette cylindrique/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

test('compileMaskToImagePrompt includes positive profile instructions for single reference characters', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de gohan',
    inputs: {
      subject: ['gohan'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['un seul personnage complet', 'visage unique bien lisible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter un seul personnage complet et reconnaissable.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /Représenter un seul personnage complet et reconnaissable/i);
  assert.match(String(compiled.prompt || ''), /Environnement : fond simple cohérent avec le personnage/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs personnages/i);
  assert.match(String(compiled.negative_prompt || ''), /visages dupliqués/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

test('compileMaskToImagePrompt includes extra prompt instructions for elemental creatures', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une photo d un phoenix glacé',
    inputs: {
      subject: ['phoenix glacé'],
      environment: ['atmosphère froide et cristalline'],
      style: ['photorealiste', 'textures cristallines', 'haute qualité'],
      composition: ['un seul phénix complet', 'ailes bien lisibles', 'givre visible sur le sujet'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'phoenix_creature',
        promptInstruction: 'Représenter un seul phénix complet avec des ailes bien lisibles.',
      },
      promptInstructions: [
        'Montrer clairement la matière glacée sur le sujet.',
        'Représenter un phénix de glace avec des ailes claires, complètes et bien visibles.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /Style : photorealiste, textures cristallines, haute qualité/i);
  assert.match(String(compiled.prompt || ''), /Montrer clairement la matière glacée sur le sujet/i);
  assert.match(String(compiled.prompt || ''), /phénix de glace/i);
  assert.match(String(compiled.negative_prompt || ''), /créatures multiples|animaux multiples/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdPromptBundle,
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  translateImagePromptToEnglish,
} = require('../src/mask/build-sd-prompt-bundle.cjs');
const buildMaskImageGenerateFromText = require('../src/mask/text-to-mask-image-generate.cjs');
const compileMaskToSD = require('../src/mask/compile-mask-to-sd.cjs');

test('buildSdPromptBundle keeps a minimal french prompt with no negative hints', () => {
  const bundle = buildSdPromptBundle('genere une image d un lapin violet');

  assert.match(String(bundle.prompt || ''), /Demande : un lapin violet/i);
  assert.match(String(bundle.prompt || ''), /Sujet principal : lapin/i);
  assert.match(String(bundle.prompt || ''), /Couleurs : violet/i);
  assert.match(String(bundle.prompt || ''), /Créer une image fidèle à la demande/i);
  assert.match(String(bundle.prompt || ''), /Mettre en avant un seul sujet principal bien visible|Garder une scène simple/i);
  assert.equal(Array.isArray(bundle.negativeHints), true);
  assert.equal(bundle.negativeHints.length, 0);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bdo not\b|literal interpretation|exactly one/i);
});

test('buildSdPromptBundle strips bare generation prefixes without translating the prompt', () => {
  const bundle = buildSdPromptBundle("j'aimerais que tu génère une image de vegeta avec la chevelure rose");

  assert.match(String(bundle.prompt || ''), /Demande : vegeta avec la chevelure rose/i);
  assert.match(String(bundle.prompt || ''), /Sujet principal : vegeta/i);
  assert.match(String(bundle.prompt || ''), /Couleurs : rose/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bgenerate\b|\bimage of\b|\bpink\b/i);
});

test('translateImagePromptToEnglish keeps the french wording and only normalizes request prefixes', () => {
  const translated = translateImagePromptToEnglish('tu peux me générer une image du héros batman en vélo');

  assert.match(String(translated || ''), /batman en vélo/i);
  assert.doesNotMatch(String(translated || ''), /\bon a bicycle\b|\bhero\b|\bimage of\b/i);
});

test('compileCharacterCountConstraints detects two clear requested subjects', () => {
  const constraints = compileCharacterCountConstraints('génère une image de batman et robin');
  const bundle = buildSdPromptBundle('génère une image de batman et robin');

  assert.equal(constraints?.count, 2);
  assert.deepEqual(constraints?.subjects, ['batman', 'robin']);
  assert.match(String(bundle.prompt || ''), /Sujet principal : batman et robin/i);
  assert.match(String(bundle.prompt || ''), /Montrer clairement les deux sujets demandés/i);
});

test('compileCharacterCountConstraints detects relational pair prompts with a patient second subject', () => {
  const constraints = compileCharacterCountConstraints('génère une image de mario docteur avec un patient skeletrex');
  const bundle = buildSdPromptBundle('génère une image de mario docteur avec un patient skeletrex');

  assert.equal(constraints?.count, 2);
  assert.deepEqual(constraints?.subjects, ['mario docteur', 'patient skeletrex']);
  assert.match(String(bundle.prompt || ''), /Sujet principal : mario docteur et patient skeletrex/i);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /mario docteur avec patient skeletrex/i);
});

test('compileSingleSubjectConstraints keeps a simple single-subject contract', () => {
  const constraints = compileSingleSubjectConstraints('génère une image de vélo bleu');
  const bundle = buildSdPromptBundle('génère une image de vélo bleu');

  assert.equal(constraints?.count, 1);
  assert.equal(String(constraints?.subject || ''), 'vélo');
  assert.match(String(bundle.prompt || ''), /Sujet principal : vélo/i);
  assert.match(String(bundle.prompt || ''), /Couleurs : bleu/i);
});

test('buildMaskImageGenerateFromText enriches MASK fields for image prompts without heavy composition guards', () => {
  const mask = buildMaskImageGenerateFromText('genere une image de one piece avec un chapeau de magicien');
  const compiled = compileMaskToSD(mask);

  assert.equal(mask.intent, 'image.generate');
  assert.ok(mask.inputs.subject.some((value) => /one piece/i.test(String(value))));
  assert.ok(mask.inputs.style.some((value) => /haute qualité/i.test(String(value))));
  assert.ok(mask.inputs.composition.some((value) => /sujet unique bien cadré/i.test(String(value))));
  assert.match(String(compiled.prompt || ''), /Demande : genere une image de one piece avec un chapeau de magicien/i);
  assert.match(String(compiled.prompt || ''), /Sujet principal : one piece/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs personnages|plusieurs sujets/i);
});

test('compileMaskToSD keeps a simple french prompt for solo prompts', () => {
  const mask = buildMaskImageGenerateFromText('génère une image de vélo bleu');
  const compiled = compileMaskToSD(mask);

  assert.match(String(compiled.prompt || ''), /Demande : génère une image de vélo bleu/i);
  assert.match(String(compiled.prompt || ''), /Sujet principal : vélo/i);
  assert.match(String(compiled.prompt || ''), /Couleurs : bleu/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bdo not\b|literal interpretation|exactly one/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(compiled.negative_prompt || ''), /watermark/i);
});

test('compileMaskToSD keeps mask wording as-is instead of preferring translated metadata', () => {
  const compiled = compileMaskToSD({
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: ['pokemon rose'],
      environment: ['dans une grotte'],
      style: ['haute qualité'],
      composition: [],
      lighting: [],
      palette: ['rose'],
    },
    options: { width: 768, height: 768, steps: 40, guidance_scale: 8 },
    constraints: { safe_mode: true, no_text: true },
    ambiguities: [],
    raw: 'genere un pokemon rose dans une grotte',
    meta: {
      llmEnriched: true,
      translatedText: 'generate a pink pokemon in a cave',
      promptCompiler: 'a11-semantic',
      promptSeedText: 'generate a pink pokemon in a cave',
    },
  });

  assert.match(String(compiled.prompt || ''), /Demande : genere un pokemon rose dans une grotte/i);
  assert.match(String(compiled.prompt || ''), /Sujet principal : pokemon rose/i);
  assert.match(String(compiled.prompt || ''), /Couleurs : rose/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bpink pokemon\b|\bin a cave\b/i);
});

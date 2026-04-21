const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdPromptBundle,
  compileCharacterCountConstraints,
  compileSingleSubjectConstraints,
  detectPromptLanguageProfile,
  translateImagePromptToEnglish,
} = require('../src/mask/build-sd-prompt-bundle.cjs');
const buildMaskImageGenerateFromText = require('../src/mask/text-to-mask-image-generate.cjs');
const compileMaskToSD = require('../src/mask/compile-mask-to-sd.cjs');

test('buildSdPromptBundle emits an english-ready prompt with no negative hints', () => {
  const bundle = buildSdPromptBundle('genere une image d un lapin violet');

  assert.match(String(bundle.prompt || ''), /request:\s+a rabbit violet/i);
  assert.match(String(bundle.prompt || ''), /main subject:\s+rabbit/i);
  assert.match(String(bundle.prompt || ''), /colors:\s+violet/i);
  assert.match(String(bundle.prompt || ''), /Create an image faithful to the request/i);
  assert.match(String(bundle.prompt || ''), /Highlight a single clearly visible main subject|Keep the scene simple/i);
  assert.equal(Array.isArray(bundle.negativeHints), true);
  assert.equal(bundle.negativeHints.length, 0);
  assert.doesNotMatch(String(bundle.prompt || ''), /Demande :|Sujet principal :|Créer une image fidèle/i);
});

test('buildSdPromptBundle strips bare generation prefixes and translates the prompt', () => {
  const bundle = buildSdPromptBundle("j'aimerais que tu génère une image de vegeta avec la chevelure rose");

  assert.match(String(bundle.prompt || ''), /request:\s+vegeta with pink hair/i);
  assert.match(String(bundle.prompt || ''), /main subject:\s+vegeta/i);
  assert.match(String(bundle.prompt || ''), /colors:\s+pink/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /Demande :|Couleurs :|chevelure rose/i);
});

test('translateImagePromptToEnglish translates simple french prompts to english', () => {
  const translated = translateImagePromptToEnglish('tu peux me générer une image du héros batman en vélo');

  assert.match(String(translated || ''), /batman.*on a bicycle/i);
  assert.doesNotMatch(String(translated || ''), /\ben vélo\b|\bimage de\b/i);
});

test('translateImagePromptToEnglish translates requested-scene helper phrases fully to english', () => {
  const translated = translateImagePromptToEnglish('décor cohérent avec la scène demandée, lecture simple et claire');

  assert.match(String(translated || ''), /coherent decor matching the requested scene/i);
  assert.match(String(translated || ''), /simple clear composition/i);
  assert.doesNotMatch(String(translated || ''), /\bdemandée?\b|\bclaire\b|\blecture\b/i);
});

test('detectPromptLanguageProfile keeps french dominant prompts french even with embedded english product terms', () => {
  const profile = detectPromptLanguageProfile('dessine moi un jeu type buy to play avec un héros rouge');

  assert.equal(profile.language, 'mixed');
  assert.equal(profile.dominant, 'fr');
  assert.ok(profile.frenchScore > profile.englishScore);
});

test('detectPromptLanguageProfile detects english dominant prompts with a few french fragments as mixed english', () => {
  const profile = detectPromptLanguageProfile('keep the same face, decor urbain sombre, dramatic lighting, clean composition');

  assert.equal(profile.language, 'mixed');
  assert.equal(profile.dominant, 'en');
  assert.ok(profile.englishScore > profile.frenchScore);
});

test('buildSdPromptBundle keeps studio animal prompts in clean english', () => {
  const bundle = buildSdPromptBundle("photo studio d'un petit chat roux assis sur un tabouret, lumière douce, fond neutre");

  assert.match(String(bundle.prompt || ''), /request:\s+studio photo .*small ginger cat.*sitting on a stool/i);
  assert.match(String(bundle.prompt || ''), /main subject:\s+small ginger cat(?:\b|[.,])/i);
  assert.match(String(bundle.prompt || ''), /colors:\s+orange/i);
  assert.match(String(bundle.prompt || ''), /soft light/i);
  assert.match(String(bundle.prompt || ''), /neutral background/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bchat\b|\broux\b|\btabouret\b|\blumiere\b|\bfond neutre\b/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bd a\b|\bl a\b/i);
});

test('compileCharacterCountConstraints detects two clear requested subjects', () => {
  const constraints = compileCharacterCountConstraints('génère une image de batman et robin');
  const bundle = buildSdPromptBundle('génère une image de batman et robin');

  assert.equal(constraints?.count, 2);
  assert.deepEqual(constraints?.subjects, ['batman', 'robin']);
  assert.match(String(bundle.prompt || ''), /main subject:\s+batman and robin/i);
  assert.match(String(bundle.prompt || ''), /Show the two requested subjects clearly/i);
});

test('compileCharacterCountConstraints detects relational pair prompts with a patient second subject', () => {
  const constraints = compileCharacterCountConstraints('génère une image de mario docteur avec un patient skeletrex');
  const bundle = buildSdPromptBundle('génère une image de mario docteur avec un patient skeletrex');

  assert.equal(constraints?.count, 2);
  assert.deepEqual(constraints?.subjects, ['mario docteur', 'patient skeletrex']);
  assert.match(String(bundle.prompt || ''), /main subject:\s+mario doctor and patient skeletrex/i);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /mario docteur avec patient skeletrex/i);
});

test('compileCharacterCountConstraints detects versus prompts as two distinct characters', () => {
  const constraints = compileCharacterCountConstraints('génère une image de goku faisant un kamehameha contre broly');
  const bundle = buildSdPromptBundle('génère une image de goku faisant un kamehameha contre broly');

  assert.equal(constraints?.count, 2);
  assert.deepEqual(constraints?.subjects, ['goku faisant un kamehameha', 'broly']);
  assert.match(String(bundle.prompt || ''), /main subject:\s+goku .* broly/i);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /goku faisant un kamehameha contre broly/i);
});

test('compileSingleSubjectConstraints keeps a simple single-subject contract', () => {
  const constraints = compileSingleSubjectConstraints('génère une image de vélo bleu');
  const bundle = buildSdPromptBundle('génère une image de vélo bleu');

  assert.equal(constraints?.count, 1);
  assert.equal(String(constraints?.subject || ''), 'vélo');
  assert.match(String(bundle.prompt || ''), /main subject:\s+bicycle/i);
  assert.match(String(bundle.prompt || ''), /colors:\s+blue/i);
});

test('compileSingleSubjectConstraints skips named team prompts like avengers', () => {
  const pair = compileCharacterCountConstraints('les avengers');
  const single = compileSingleSubjectConstraints('les avengers');

  assert.equal(pair, null);
  assert.equal(single, null);
});

test('source-image transformation prompts do not get misread as two subjects', () => {
  const raw = 'utilise ma photo comme reference et transforme moi en joker avec une batte custom visible';
  const pair = compileCharacterCountConstraints(raw);
  const single = compileSingleSubjectConstraints(raw);
  const bundle = buildSdPromptBundle(raw);

  assert.equal(pair, null);
  assert.equal(single?.count, 1);
  assert.equal(String(single?.subject || ''), 'joker');
  assert.match(String(bundle.prompt || ''), /main subject:\s+joker/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /two requested subjects|exactly two characters/i);
});

test('buildMaskImageGenerateFromText enriches MASK fields for image prompts without heavy composition guards', () => {
  const mask = buildMaskImageGenerateFromText('genere une image de one piece avec un chapeau de magicien');
  const compiled = compileMaskToSD(mask);

  assert.equal(mask.intent, 'image.generate');
  assert.ok(mask.inputs.subject.some((value) => /one piece/i.test(String(value))));
  assert.ok(mask.inputs.style.some((value) => /haute qualité/i.test(String(value))));
  assert.ok(mask.inputs.composition.some((value) => /sujet unique bien cadré/i.test(String(value))));
  assert.match(String(compiled.prompt || ''), /one piece/i);
  assert.match(String(compiled.prompt || ''), /simple background consistent with the character/i);
  assert.match(String(compiled.negative_prompt || ''), /multiple characters|multiple subjects/i);
});

test('compileMaskToSD emits an english SD prompt for solo prompts', () => {
  const mask = buildMaskImageGenerateFromText('génère une image de vélo bleu');
  const compiled = compileMaskToSD(mask);

  assert.match(String(compiled.prompt || ''), /bicycle blue/i);
  assert.match(String(compiled.prompt || ''), /colors blue/i);
  assert.match(String(compiled.prompt || ''), /single main subject/i);
  assert.equal(compiled.prompt_language, 'en');
  assert.doesNotMatch(String(compiled.prompt || ''), /vélo|couleurs bleu|un seul sujet principal/i);
  assert.match(String(compiled.negative_prompt || ''), /multiple subjects/i);
  assert.match(String(compiled.negative_prompt || ''), /watermark/i);
});

test('compileMaskToSD stays grounded in the mask wording instead of preferring translated metadata', () => {
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

  assert.match(String(compiled.prompt || ''), /pokemon/i);
  assert.match(String(compiled.prompt || ''), /pink/i);
  assert.match(String(compiled.prompt || ''), /in a cave/i);
  assert.match(String(compiled.prompt || ''), /colors pink/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /generate a pink pokemon in a cave/i);
});

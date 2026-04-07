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

test('buildSdPromptBundle steers ambiguous color prompts toward literal subject colors', () => {
  const bundle = buildSdPromptBundle('genere une image d un lapin violet', {
    preferLiteralColor: true,
  });

  assert.match(String(bundle.prompt || ''), /one rabbit with purple fur/i);
  assert.match(String(bundle.prompt || ''), /literal interpretation/i);
  assert.match(String(bundle.prompt || ''), /exactly one rabbit/i);
  assert.match(String(bundle.prompt || ''), /solo composition/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /one instance only|single main subject/i);
  assert.match(String(bundle.negativeHints.join(', ') || ''), /flowers/i);
  assert.match(String(bundle.negativeHints.join(', ') || ''), /crowd|duplicate/i);
});

test('buildSdPromptBundle keeps english color ordering natural for solo prompts', () => {
  const bundle = buildSdPromptBundle("Genere une image d'un lapin de couleur rose");

  assert.match(String(bundle.prompt || ''), /\bone rabbit with pink fur\b/i);
  assert.match(String(bundle.prompt || ''), /\bexactly one rabbit\b/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bpink a rabbit\b/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /one subject only|one instance only|single main subject/i);
});

test('buildSdPromptBundle strips bare image request prefixes before extracting the subject', () => {
  for (const rawPrompt of ['genere une image lapin rose', 'je veux une image lapin rose', "j'aimerais que tu génère une image de vegeta avec la chevelure rose"]) {
    const bundle = buildSdPromptBundle(rawPrompt);

    if (/vegeta/i.test(rawPrompt)) {
      assert.match(String(bundle.prompt || ''), /\bvegeta\b/i);
      assert.doesNotMatch(String(bundle.prompt || ''), /\bimage of vegeta\b/i);
      assert.doesNotMatch(String(bundle.prompt || ''), /\bque tu génère a image of\b/i);
      continue;
    }

    assert.match(String(bundle.prompt || ''), /\bone rabbit with pink fur\b/i);
    assert.doesNotMatch(String(bundle.prompt || ''), /\bimage rabbit\b/i);
    assert.doesNotMatch(String(bundle.prompt || ''), /\be image rabbit\b/i);
  }
});

test('translateImagePromptToEnglish maps grizzli to grizzly bear', () => {
  const translated = translateImagePromptToEnglish("genere moi un grizzli jaune");

  assert.match(String(translated || ''), /\byellow grizzly bear\b/i);
  assert.doesNotMatch(String(translated || ''), /\bgrizzli\b/i);
});

test('buildSdPromptBundle binds risky floral colors to animal fur instead of the scenery', () => {
  const bundle = buildSdPromptBundle("genere moi un grizzli jaune");

  assert.match(String(bundle.prompt || ''), /one grizzly bear with golden-yellow fur/i);
  assert.match(String(bundle.prompt || ''), /not yellow flowers|meadow plants|background elements/i);
  assert.match(String(bundle.negativeHints.join(', ') || ''), /yellow flowers|flower field|meadow flowers/i);
});

test('buildSdPromptBundle compiles French image prompts into English SD-ready prompts', () => {
  const bundle = buildSdPromptBundle('genere une image de vache bleue dans une riviere sombre');

  assert.match(String(bundle.prompt || ''), /one cow with blue fur/i);
  assert.match(String(bundle.prompt || ''), /in a river dark|in the river dark|river/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bvache\b/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bbleue?\b/i);
});

test('buildSdPromptBundle strengthens solo character riding prompts and translates common french nouns', () => {
  const bundle = buildSdPromptBundle('tu peux me générer une image du héros batman en vélo');

  assert.match(String(bundle.prompt || ''), /^batman\./i);
  assert.match(String(bundle.prompt || ''), /bicycle|bike/i);
  assert.match(String(bundle.prompt || ''), /on a bicycle/i);
  assert.match(String(bundle.prompt || ''), /single character focus|solo composition|exactly one/i);
  assert.match(String(bundle.negativeHints.join(', ') || ''), /crowd|group shot|duplicate/i);
});

test('compileCharacterCountConstraints enforces exactly two distinct characters for paired prompts', () => {
  const constraints = compileCharacterCountConstraints('génère une image de batman et robin');
  const bundle = buildSdPromptBundle('génère une image de batman et robin');

  assert.equal(constraints?.count, 2);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /exactly two distinct characters/i);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /one batman and one robin only/i);
  assert.match(String(bundle.prompt || ''), /exactly two distinct characters: batman and robin/i);
  assert.match(String(bundle.prompt || ''), /separate bodies/i);
  assert.match(String(bundle.negativeHints.join(', ') || ''), /multiple batman|multiple robin|fused bodies|merged faces/i);
});

test('compileSingleSubjectConstraints enforces one distinct object for singular prompts', () => {
  const constraints = compileSingleSubjectConstraints('génère une image de vélo bleu');
  const bundle = buildSdPromptBundle('génère une image de vélo bleu');

  assert.equal(constraints?.count, 1);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /exactly one blue bicycle/i);
  assert.match(String(constraints?.promptHints?.join(' ') || ''), /one blue bicycle only|one blue bicycle/i);
  assert.match(String(bundle.prompt || ''), /exactly one blue bicycle/i);
  assert.match(String(bundle.negativeHints.join(', ') || ''), /multiple blue bicycle|duplicate blue bicycle|extra blue bicycle/i);
});

test('buildMaskImageGenerateFromText enriches MASK fields for image prompts', () => {
  const mask = buildMaskImageGenerateFromText('genere une image de one piece avec un chapeau de magicien');
  const compiled = compileMaskToSD(mask);

  assert.equal(mask.intent, 'image.generate');
  assert.ok(mask.inputs.subject.some((value) => /one piece/i.test(String(value))));
  assert.ok(mask.inputs.style.some((value) => /anime illustration/i.test(String(value))));
  assert.ok(mask.inputs.composition.some((value) => /clear centered composition/i.test(String(value))));
  assert.match(String(compiled.prompt || ''), /literal interpretation/i);
  assert.match(String(compiled.prompt || ''), /with a magician hat/i);
  assert.match(String(compiled.negative_prompt || ''), /flowers/i);
});

test('compileMaskToSD keeps singular object constraints for solo prompts', () => {
  const mask = buildMaskImageGenerateFromText('génère une image de vélo bleu');
  const compiled = compileMaskToSD(mask);

  assert.match(String(compiled.prompt || ''), /exactly one blue bicycle/i);
  assert.match(String(compiled.prompt || ''), /solo composition/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /one subject only|one instance only|single main subject/i);
  assert.match(String(compiled.negative_prompt || ''), /multiple blue bicycle|duplicate blue bicycle|extra blue bicycle/i);
});

test('translateImagePromptToEnglish binds ultraviolet compounds before token splitting', () => {
  const translated = translateImagePromptToEnglish('genere une image de rayon ultra violet');

  assert.match(String(translated || ''), /ultraviolet ray/i);
  assert.doesNotMatch(String(translated || ''), /\bultra violet\b/i);
  assert.doesNotMatch(String(translated || ''), /\bpurple ray\b/i);
});

test('translateImagePromptToEnglish strips natural French request prefixes for riding prompts', () => {
  const translated = translateImagePromptToEnglish('tu peux me générer une image du héros batman en vélo');

  assert.match(String(translated || ''), /^batman on a bicycle$/i);
  assert.doesNotMatch(String(translated || ''), /\bimage of\b/i);
  assert.doesNotMatch(String(translated || ''), /\bhero\b/i);
});

test('buildSdPromptBundle does not misclassify ultraviolet as a free color adjective', () => {
  const bundle = buildSdPromptBundle('genere une image de rayon ultra violet');

  assert.match(String(bundle.prompt || ''), /ultraviolet ray/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /\bpurple ray\b/i);
  assert.equal(bundle.ambiguity, null);
});

test('buildSdPromptBundle binds scene relations as stable atoms', () => {
  const bundle = buildSdPromptBundle("genere une image d'un lapin rose sortant d'un chapeau de magicien dans une foret sombre");

  assert.match(String(bundle.prompt || ''), /\bone rabbit with pink fur\b/i);
  assert.match(String(bundle.prompt || ''), /\bexactly one rabbit\b/i);
  assert.match(String(bundle.prompt || ''), /coming out of a magician hat/i);
  assert.match(String(bundle.prompt || ''), /in a forest dark|in the forest dark|forest/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /a pink rabbit coming out of a magician hat.*coming out of a magician hat/i);
});

test('buildSdPromptBundle binds wearing and holding relations without flattening the subject', () => {
  const bundle = buildSdPromptBundle("genere une image d'un chevalier portant une cape tenant un sabre sur une montagne");

  assert.match(String(bundle.prompt || ''), /\bknight\b/i);
  assert.match(String(bundle.prompt || ''), /wearing a cape/i);
  assert.match(String(bundle.prompt || ''), /holding a sword/i);
  assert.match(String(bundle.prompt || ''), /on a mountain/i);
  assert.match(String(bundle.prompt || ''), /exactly one knight/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /exactly one a knight/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /knight wearing a cape.*wearing a cape/i);
  assert.doesNotMatch(String(bundle.prompt || ''), /holding a sword.*holding a sword/i);
});

test('compileMaskToSD preserves with and under relations as separate atoms', () => {
  const mask = buildMaskImageGenerateFromText("genere une image d'un ours avec un chapeau sous une lune");
  const compiled = compileMaskToSD(mask);

  assert.match(String(compiled.prompt || ''), /\bbear\b/i);
  assert.match(String(compiled.prompt || ''), /with a hat/i);
  assert.match(String(compiled.prompt || ''), /under a moon/i);
});

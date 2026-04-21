const test = require('node:test');
const assert = require('node:assert/strict');

const analyzeSemanticIntent = require('../src/mask/semantic/analyze-semantic-intent.cjs');
const textToWazaa = require('../src/mask/text-to-wazaa.cjs');
const wazaaToMask = require('../src/mask/wazaa-to-mask.cjs');
const {
  detectColorMatchesFromText,
  stripTrailingColorPhrase,
} = require('../src/mask/semantic/color-library.cjs');
const {
  collectUniqueStylesFromWordItems,
  stripTrailingStylePhrase,
} = require('../src/mask/semantic/style-library.cjs');
const {
  collectUniqueScenesFromWordItems,
} = require('../src/mask/semantic/scene-library.cjs');

test('color library detects single-word and multi-word color phrases', () => {
  const matches = detectColorMatchesFromText('genere un dragon bleu marine avec une aura orange');

  assert.deepEqual(
    matches.map((entry) => entry.label),
    ['bleu marine', 'orange']
  );
});

test('stripTrailingColorPhrase removes nuanced color suffixes from subject phrases', () => {
  assert.equal(stripTrailingColorPhrase('dragon bleu marine'), 'dragon');
  assert.equal(stripTrailingColorPhrase('lapin dore'), 'lapin');
});

test('stripTrailingStylePhrase removes style suffixes from subject phrases', () => {
  assert.equal(stripTrailingStylePhrase('dragon en pixel art'), 'dragon');
  assert.equal(stripTrailingStylePhrase('lapin style anime'), 'lapin');
});

test('semantic color detection propagates structured colors to wazaa and mask', () => {
  const text = 'genere une image de dragon bleu marine dans une grotte';
  const analysis = analyzeSemanticIntent(text, {});
  const wazaa = textToWazaa.sync(text, {});
  const mask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.equal(analysis?.summary?.colorSignal, true);
  assert.ok(Array.isArray(analysis?.summary?.detectedColors));
  assert.ok(analysis.summary.detectedColors.includes('bleu marine'));
  assert.ok(Array.isArray(wazaa?.meta?.semantic?.colors));
  assert.ok(wazaa.meta.semantic.colors.some((entry) => entry.label === 'bleu marine'));
  assert.ok(mask?.inputs?.palette?.includes('bleu marine'));
  assert.ok(mask?.inputs?.subject?.includes('dragon'));
  assert.ok(!mask?.inputs?.subject?.some((entry) => /bleu marine/i.test(String(entry))));
});

test('semantic style and scene libraries propagate to wazaa and mask', () => {
  const text = 'genere une image de dragon bleu marine en pixel art dans une grotte';
  const analysis = analyzeSemanticIntent(text, {});
  const wordItems = Array.isArray(analysis?.levels?.words?.items) ? analysis.levels.words.items : [];
  const wazaa = textToWazaa.sync(text, {});
  const mask = wazaaToMask(wazaa, { semanticAnalysis: analysis });

  assert.ok(collectUniqueStylesFromWordItems(wordItems).some((entry) => entry.label === 'pixel art'));
  assert.ok(collectUniqueScenesFromWordItems(wordItems).some((entry) => entry.label === 'grotte'));
  assert.ok(Array.isArray(analysis?.summary?.detectedStyles));
  assert.ok(analysis.summary.detectedStyles.includes('pixel art'));
  assert.ok(Array.isArray(analysis?.summary?.detectedScenes));
  assert.ok(analysis.summary.detectedScenes.includes('grotte'));
  assert.ok(Array.isArray(wazaa?.meta?.semantic?.styles));
  assert.ok(wazaa.meta.semantic.styles.some((entry) => entry.label === 'pixel art'));
  assert.ok(Array.isArray(wazaa?.meta?.semantic?.scenes));
  assert.ok(wazaa.meta.semantic.scenes.some((entry) => entry.label === 'grotte'));
  assert.ok(mask?.inputs?.style?.includes('pixel art'));
  assert.ok(mask?.inputs?.environment?.some((entry) => /grotte/i.test(String(entry))));
});

test('scene library detects path-like outdoor scenes such as sentiers and chemins', () => {
  const text = 'genere une image de zelda marchant sur un sentier dans une foret';
  const analysis = analyzeSemanticIntent(text, {});
  const wordItems = Array.isArray(analysis?.levels?.words?.items) ? analysis.levels.words.items : [];

  const detectedScenes = collectUniqueScenesFromWordItems(wordItems).map((entry) => entry.label);

  assert.ok(detectedScenes.includes('sentier'));
  assert.ok(detectedScenes.includes('foret'));
});

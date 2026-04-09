const analyzeSemanticIntent = require('./analyze-semantic-intent.cjs');
const {
  collectUniqueColorsFromWordItems,
} = require('./color-library.cjs');
const {
  collectUniqueStylesFromWordItems,
} = require('./style-library.cjs');
const {
  collectUniqueScenesFromWordItems,
} = require('./scene-library.cjs');
const {
  collectUniqueElementsFromWordItems,
} = require('./element-library.cjs');
const {
  collectUniqueMetiersFromWordItems,
} = require('./metier-library.cjs');
const {
  collectUniqueAccessoriesFromWordItems,
} = require('./accessory-library.cjs');
const {
  resolveSubjectProfile,
} = require('./subject-profile-library.cjs');

function semanticToWazaa(text, opts = {}) {
  const analysis = opts.analysis || analyzeSemanticIntent(text, opts);
  if (!analysis) return null;

  const topIntent = analysis.topIntents?.[0] || { type: 'chat.reply', score: 0, label: 'Repondre en texte' };
  const subject = String(analysis.subject || '').trim();
  const messageRgba = analysis.levels?.message?.rgba || { r: 0, g: 0, b: 0, a: 0 };
  const wordItems = Array.isArray(analysis.levels?.words?.items) ? analysis.levels.words.items : [];
  const semanticColors = collectUniqueColorsFromWordItems(wordItems).slice(0, 6);
  const semanticStyles = collectUniqueStylesFromWordItems(wordItems).slice(0, 6);
  const semanticScenes = collectUniqueScenesFromWordItems(wordItems).slice(0, 6);
  const semanticElements = collectUniqueElementsFromWordItems(wordItems).slice(0, 6);
  const semanticMetiers = collectUniqueMetiersFromWordItems(wordItems).slice(0, 6);
  const semanticAccessories = collectUniqueAccessoriesFromWordItems(wordItems).slice(0, 6);
  const subjectProfile = resolveSubjectProfile({ subject, sourceText: analysis.sourceText });
  const colorWords = semanticColors.map((entry) => entry.label).slice(0, 3);
  const styleWords = semanticStyles.map((entry) => entry.label).slice(0, 3);
  const sceneWords = semanticScenes.map((entry) => entry.label).slice(0, 3);
  const elementWords = semanticElements.map((entry) => entry.label).slice(0, 3);
  const metierWords = semanticMetiers.map((entry) => entry.label).slice(0, 3);
  const accessoryWords = semanticAccessories.map((entry) => entry.label).slice(0, 3);
  const semanticWordTags = wordItems
    .map((item) => ({
      word: String(item.word || '').trim(),
      tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
    }))
    .filter((item) => item.word && item.tags.length > 0);
  const activeModuleIds = Array.isArray(analysis.knowledge?.activeModules)
    ? analysis.knowledge.activeModules.map((entry) => String(entry?.id || '').trim()).filter(Boolean)
    : [];

  const entities = [];
  if (subject) entities.push({ value: subject, role: 'subject', weight: 0.92 });
  if (colorWords.length) entities.push({ value: colorWords.join(', '), role: 'attribute', weight: 0.66 });
  if (styleWords.length) entities.push({ value: styleWords.join(', '), role: 'style', weight: 0.62 });
  if (sceneWords.length) entities.push({ value: sceneWords.join(', '), role: 'environment', weight: 0.58 });
  if (elementWords.length) entities.push({ value: elementWords.join(', '), role: 'attribute', weight: 0.57 });
  if (metierWords.length) entities.push({ value: metierWords.join(', '), role: 'attribute', weight: 0.56 });
  if (accessoryWords.length) entities.push({ value: accessoryWords.join(', '), role: 'accessory', weight: 0.59 });

  return {
    wazaa: '1.1',
    meta: {
      source: opts.source || 'semantic',
      timestamp: Math.floor(Date.now() / 1000),
      sourceText: analysis.sourceText,
      semantic: {
        subject,
        topIntentType: String(topIntent.type || '').trim(),
        confidence: Number((analysis.summary?.confidence || 0).toFixed(3)),
        colorWords,
        colors: semanticColors,
        styleWords,
        styles: semanticStyles,
        sceneWords,
        scenes: semanticScenes,
        elementWords,
        elements: semanticElements,
        metierWords,
        metiers: semanticMetiers,
        accessoryWords,
        accessories: semanticAccessories,
        subjectProfile,
        activeModuleIds,
        wordTags: semanticWordTags,
      },
    },
    signal: {
      power: Number(messageRgba.r.toFixed(3)),
      resonance: Number(messageRgba.g.toFixed(3)),
      density: Number(messageRgba.b.toFixed(3)),
      confidence: Number((analysis.summary?.confidence || 0).toFixed(3)),
    },
    hierarchy: {
      letters: analysis.levels?.letters?.rgba || null,
      words: analysis.levels?.words?.rgba || null,
      sentences: analysis.levels?.sentences?.rgba || null,
      paragraphs: analysis.levels?.paragraphs?.rgba || null,
      message: analysis.levels?.message?.rgba || null,
    },
    entities,
    relations: subject && colorWords.length
      ? [{ from: subject, to: colorWords.join(', '), type: 'attribute', resonance: 0.74 }]
      : [],
    intents: analysis.topIntents.slice(0, 4),
    ambiguities: analysis.ambiguities,
    intent: {
      type: topIntent.type,
      confidence: Number((analysis.summary?.confidence || 0).toFixed(3)),
    },
  };
}

module.exports = semanticToWazaa;

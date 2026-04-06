const textToResonanceGraph = require('../text-to-resonance-graph.cjs');
const {
  clamp01,
  normalizeSemanticText,
  splitParagraphs,
  splitSentences,
  classifyWordSemanticTags,
} = require('./semantic-utils.cjs');

function toRgba(r, g, b, a) {
  return {
    r: Number(clamp01(r).toFixed(3)),
    g: Number(clamp01(g).toFixed(3)),
    b: Number(clamp01(b).toFixed(3)),
    a: Number(clamp01(a).toFixed(3)),
  };
}

function computeLetterRgba(entry, total) {
  const indexRatio = total > 1 ? entry.index / (total - 1) : 0;
  const semanticWeight = entry.type === 'letter'
    ? 0.78
    : entry.type === 'digit'
      ? 0.58
      : entry.type === 'punct'
        ? 0.44
        : 0.18;
  const stability = entry.type === 'space' ? 0.15 : 0.82;
  return toRgba(entry.power || 0, semanticWeight, indexRatio, stability);
}

function computeWordRgba(word, tags, totalWords) {
  const lengthWeight = Math.min(1, Number(word.length || 0) / 12);
  const semanticWeight = Math.min(1, tags.length / 4);
  const contextWeight = totalWords > 0 ? 1 / totalWords : 0;
  const stability = tags.includes('stopword') ? 0.28 : 0.84;
  return toRgba(lengthWeight, semanticWeight, contextWeight, stability);
}

function computeSentenceRgba(sentence, wordItems) {
  const text = String(sentence || '');
  const normalized = normalizeSemanticText(text);
  const questionLike = /\?$/.test(text) || /\b(comment|pourquoi|quand|qui|quoi|ou|où|what|how|why|when|who)\b/.test(normalized);
  const actionLike = /\b(genere|cree|dessine|cherche|trouve|affiche|montre|ecris|code|fais|generate|create|draw|search|find|show|write)\b/.test(normalized);
  const averageWordSemantic = wordItems.length
    ? wordItems.reduce((sum, item) => sum + (item.rgba?.g || 0), 0) / wordItems.length
    : 0;
  return toRgba(
    Math.min(1, text.length / 140),
    averageWordSemantic,
    actionLike ? 0.85 : questionLike ? 0.68 : 0.36,
    actionLike || questionLike ? 0.88 : 0.52
  );
}

function computeParagraphRgba(paragraphText, sentenceItems) {
  const continuity = sentenceItems.length <= 1
    ? 0.72
    : sentenceItems.reduce((sum, item) => sum + (item.rgba?.a || 0), 0) / sentenceItems.length;
  const semanticWeight = sentenceItems.length
    ? sentenceItems.reduce((sum, item) => sum + (item.rgba?.g || 0), 0) / sentenceItems.length
    : 0;
  return toRgba(
    Math.min(1, String(paragraphText || '').length / 280),
    semanticWeight,
    continuity,
    continuity
  );
}

function buildSemanticLevels(text) {
  const rawText = String(text || '').trim();
  if (!rawText) return null;

  const resonance = textToResonanceGraph(rawText);
  const normalizedText = normalizeSemanticText(rawText);
  const paragraphs = splitParagraphs(rawText);
  const sentences = splitSentences(rawText);

  const letterItems = Array.isArray(resonance?.chars)
    ? resonance.chars.map((entry, index, items) => ({
      ...entry,
      rgba: computeLetterRgba(entry, items.length),
      level: 'letter',
    }))
    : [];

  const wordItems = Array.isArray(resonance?.words)
    ? resonance.words.map((entry, index, items) => {
      const tags = classifyWordSemanticTags(entry.word);
      return {
        ...entry,
        normalized: normalizeSemanticText(entry.word),
        tags,
        rgba: computeWordRgba(entry, tags, items.length),
        level: 'word',
      };
    })
    : [];

  const sentenceItems = sentences.map((sentence, index) => {
    const sentenceWords = wordItems.filter((item) => item.start >= 0 && item.end < rawText.length)
      .filter((item) => normalizeSemanticText(sentence).includes(item.normalized));
    return {
      index,
      sentence,
      normalized: normalizeSemanticText(sentence),
      words: sentenceWords.map((item) => item.word),
      rgba: computeSentenceRgba(sentence, sentenceWords),
      level: 'sentence',
    };
  });

  const paragraphItems = paragraphs.map((paragraph, index) => {
    const paragraphSentences = sentenceItems.filter((item) => paragraph.includes(item.sentence));
    return {
      index,
      paragraph,
      normalized: normalizeSemanticText(paragraph),
      sentenceCount: paragraphSentences.length,
      rgba: computeParagraphRgba(paragraph, paragraphSentences),
      level: 'paragraph',
    };
  });

  const average = (items, channel) => items.length
    ? items.reduce((sum, item) => sum + (item.rgba?.[channel] || 0), 0) / items.length
    : 0;

  return {
    version: 'semantic-levels-1',
    sourceText: rawText,
    normalizedText,
    levels: {
      letters: {
        count: letterItems.length,
        rgba: toRgba(average(letterItems, 'r'), average(letterItems, 'g'), average(letterItems, 'b'), average(letterItems, 'a')),
        items: letterItems,
      },
      words: {
        count: wordItems.length,
        rgba: toRgba(average(wordItems, 'r'), average(wordItems, 'g'), average(wordItems, 'b'), average(wordItems, 'a')),
        items: wordItems,
      },
      sentences: {
        count: sentenceItems.length,
        rgba: toRgba(average(sentenceItems, 'r'), average(sentenceItems, 'g'), average(sentenceItems, 'b'), average(sentenceItems, 'a')),
        items: sentenceItems,
      },
      paragraphs: {
        count: paragraphItems.length,
        rgba: toRgba(average(paragraphItems, 'r'), average(paragraphItems, 'g'), average(paragraphItems, 'b'), average(paragraphItems, 'a')),
        items: paragraphItems,
      },
      message: {
        rgba: toRgba(
          Math.min(1, rawText.length / 400),
          average(sentenceItems, 'g') || average(wordItems, 'g'),
          average(paragraphItems, 'b') || average(sentenceItems, 'b'),
          average(paragraphItems, 'a') || average(sentenceItems, 'a') || average(wordItems, 'a')
        ),
        metrics: {
          length: rawText.length,
          wordCount: wordItems.length,
          sentenceCount: sentenceItems.length,
          paragraphCount: paragraphItems.length,
          questionCount: (rawText.match(/\?/g) || []).length,
          exclamationCount: (rawText.match(/!/g) || []).length,
        },
      },
    },
  };
}

module.exports = buildSemanticLevels;

const analyzeSemanticIntent = require('./analyze-semantic-intent.cjs');

function semanticToWazaa(text, opts = {}) {
  const analysis = opts.analysis || analyzeSemanticIntent(text, opts);
  if (!analysis) return null;

  const topIntent = analysis.topIntents?.[0] || { type: 'chat.reply', score: 0, label: 'Repondre en texte' };
  const subject = String(analysis.subject || '').trim();
  const messageRgba = analysis.levels?.message?.rgba || { r: 0, g: 0, b: 0, a: 0 };
  const wordItems = Array.isArray(analysis.levels?.words?.items) ? analysis.levels.words.items : [];
  const colorWords = wordItems
    .filter((item) => Array.isArray(item.tags) && item.tags.includes('color'))
    .map((item) => item.word)
    .slice(0, 3);

  const entities = [];
  if (subject) entities.push({ value: subject, role: 'subject', weight: 0.92 });
  if (colorWords.length) entities.push({ value: colorWords.join(', '), role: 'attribute', weight: 0.66 });

  return {
    wazaa: '1.1',
    meta: {
      source: opts.source || 'semantic',
      timestamp: Math.floor(Date.now() / 1000),
      sourceText: analysis.sourceText,
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

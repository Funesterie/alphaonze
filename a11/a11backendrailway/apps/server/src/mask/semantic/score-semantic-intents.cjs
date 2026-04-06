const {
  INTENT_DEFINITIONS,
  clamp01,
  countRegexMatches,
  extractSubjectCandidate,
} = require('./semantic-utils.cjs');
const {
  applySemanticKnowledgeModules,
} = require('../../knowledge/a11-knowledge-operator.cjs');

function scoreSemanticIntents(levels, overrides = {}) {
  if (!levels || typeof levels !== 'object') return null;

  const sourceText = String(levels.sourceText || '').trim();
  const normalizedText = String(levels.normalizedText || '').trim();
  const wordItems = Array.isArray(levels.levels?.words?.items) ? levels.levels.words.items : [];
  const sentenceItems = Array.isArray(levels.levels?.sentences?.items) ? levels.levels.sentences.items : [];

  const detectImageIntent = typeof overrides.detectImageIntent === 'function' ? overrides.detectImageIntent : null;
  const detectWebImageIntent = typeof overrides.detectWebImageIntent === 'function' ? overrides.detectWebImageIntent : null;

  const rawScores = Object.fromEntries(Object.keys(INTENT_DEFINITIONS).map((intentType) => [intentType, 0]));
  const evidence = Object.fromEntries(Object.keys(INTENT_DEFINITIONS).map((intentType) => [intentType, []]));
  const levelBreakdown = {
    words: Object.fromEntries(Object.keys(INTENT_DEFINITIONS).map((intentType) => [intentType, 0])),
    sentences: Object.fromEntries(Object.keys(INTENT_DEFINITIONS).map((intentType) => [intentType, 0])),
    message: Object.fromEntries(Object.keys(INTENT_DEFINITIONS).map((intentType) => [intentType, 0])),
  };

  for (const word of wordItems) {
    const tags = Array.isArray(word.tags) ? word.tags : [];
    for (const [intentType] of Object.entries(INTENT_DEFINITIONS)) {
      const keywordTag = `${intentType}:keyword`;
      const verbTag = `${intentType}:verb`;
      if (tags.includes(keywordTag)) {
        rawScores[intentType] += 0.85;
        levelBreakdown.words[intentType] += 0.85;
        evidence[intentType].push(`mot-cle:${word.word}`);
      }
      if (tags.includes(verbTag)) {
        rawScores[intentType] += 1.05;
        levelBreakdown.words[intentType] += 1.05;
        evidence[intentType].push(`verbe:${word.word}`);
      }
    }
    if (tags.includes('question')) {
      rawScores['web.search'] += 0.25;
      rawScores['chat.reply'] += 0.1;
      levelBreakdown.words['web.search'] += 0.25;
      levelBreakdown.words['chat.reply'] += 0.1;
    }
    if (tags.includes('action')) {
      rawScores['image.generate'] += 0.15;
      rawScores['web.image.search'] += 0.15;
      rawScores['code.python.generate'] += 0.15;
      rawScores['web.search'] += 0.1;
      levelBreakdown.words['image.generate'] += 0.15;
      levelBreakdown.words['web.image.search'] += 0.15;
      levelBreakdown.words['code.python.generate'] += 0.15;
      levelBreakdown.words['web.search'] += 0.1;
    }
  }

  for (const [intentType, definition] of Object.entries(INTENT_DEFINITIONS)) {
    for (const pattern of definition.phrases) {
      const matches = countRegexMatches(sourceText, pattern);
      if (matches > 0) {
        const gain = matches * 1.45;
        rawScores[intentType] += gain;
        levelBreakdown.message[intentType] += gain;
        evidence[intentType].push(`pattern:${pattern.source}`);
      }
    }
  }

  const questionLike = /\?/.test(sourceText);
  const explicitQuestion = /\b(comment|pourquoi|quand|qui|quoi|ou|où|what|how|why|when|who)\b/.test(normalizedText);
  const actionLike = /\b(genere|cree|dessine|cherche|trouve|montre|affiche|ecris|code|fais|prepare|generate|create|draw|search|find|show|write)\b/.test(normalizedText);
  const creationLike = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare|generate|create|draw|make|render)\b/.test(normalizedText);
  const showLike = /\b(montre|montrer|affiche|afficher|fais voir|show me|show|cherche|chercher|trouve|trouver|find|search)\b/.test(normalizedText);
  const subject = extractSubjectCandidate(wordItems.map((item) => item.word));
  const colorWordCount = wordItems.filter((item) => Array.isArray(item.tags) && item.tags.includes('color')).length;
  const codeKeywordSignal = /\b(python|script|fonction|code|programme|api|json|regex|tri|fichier|dossier|png|csv|node)\b/.test(normalizedText);
  const strongImplicitImageRequest = Boolean(
    creationLike
    && colorWordCount > 0
    && subject
    && !codeKeywordSignal
  );
  const visualStyleSignal = /\b(cartoon|anime|pixel art|watercolor|cinematic|illustration|portrait|render|3d|manga)\b/.test(normalizedText);
  const shortShowRequest = /^(montre|affiche|fais voir|show me)\b/.test(normalizedText)
    && !/\b(web|internet|google|bing|source)\b/.test(normalizedText)
    && wordItems.length > 0
    && wordItems.length <= 6;
  const confidentShowSubjectRequest = showLike
    && !creationLike
    && Boolean(subject)
    && wordItems.length > 0
    && wordItems.length <= 10;

  for (const sentence of sentenceItems) {
    const sentenceText = String(sentence.normalized || '').trim();
    if (!sentenceText) continue;

    for (const [intentType, definition] of Object.entries(INTENT_DEFINITIONS)) {
      let sentenceScore = 0;
      if (definition.verbs.some((token) => sentenceText.includes(token))) sentenceScore += 0.55;
      if (definition.keywords.some((token) => sentenceText.includes(token))) sentenceScore += 0.45;
      if (sentenceScore > 0) {
        rawScores[intentType] += sentenceScore;
        levelBreakdown.sentences[intentType] += sentenceScore;
      }
    }
  }

  if (detectImageIntent && detectImageIntent(sourceText)) {
    rawScores['image.generate'] += 1.8;
    levelBreakdown.message['image.generate'] += 1.8;
    evidence['image.generate'].push('heuristique:image.generate');
  }
  if (detectWebImageIntent && detectWebImageIntent(sourceText)) {
    rawScores['web.image.search'] += 2.1;
    levelBreakdown.message['web.image.search'] += 2.1;
    evidence['web.image.search'].push('heuristique:web.image.search');
  }

  if (questionLike || explicitQuestion) {
    rawScores['web.search'] += 0.32;
    rawScores['chat.reply'] += 0.18;
    levelBreakdown.message['web.search'] += 0.32;
    levelBreakdown.message['chat.reply'] += 0.18;
  }

  if (actionLike) {
    rawScores['image.generate'] += 0.22;
    rawScores['web.image.search'] += 0.22;
    rawScores['code.python.generate'] += 0.22;
    rawScores['web.search'] += 0.14;
    levelBreakdown.message['image.generate'] += 0.22;
    levelBreakdown.message['web.image.search'] += 0.22;
    levelBreakdown.message['code.python.generate'] += 0.22;
    levelBreakdown.message['web.search'] += 0.14;
  }

  if (shortShowRequest) {
    rawScores['web.image.search'] += 1.45;
    rawScores['image.generate'] += 0.55;
    levelBreakdown.message['web.image.search'] += 1.45;
    levelBreakdown.message['image.generate'] += 0.55;
    evidence['web.image.search'].push('heuristique:show_subject_search');
    evidence['image.generate'].push('heuristique:show_subject_generate');
  }

  if (confidentShowSubjectRequest) {
    rawScores['web.image.search'] += 1.2;
    rawScores['image.generate'] += 0.2;
    levelBreakdown.message['web.image.search'] += 1.2;
    levelBreakdown.message['image.generate'] += 0.2;
    evidence['web.image.search'].push(`sujet:${subject}`);
  }

  if (strongImplicitImageRequest) {
    rawScores['image.generate'] += 1.1;
    levelBreakdown.message['image.generate'] += 1.1;
    evidence['image.generate'].push(`heuristique:colored_subject:${subject}`);
  }

  if (visualStyleSignal) {
    rawScores['image.generate'] += 1.25;
    levelBreakdown.message['image.generate'] += 1.25;
    evidence['image.generate'].push('heuristique:visual_style_signal');
  }

  rawScores['chat.reply'] += 0.25;
  levelBreakdown.message['chat.reply'] += 0.25;

  const knowledge = applySemanticKnowledgeModules({
    text: sourceText,
    levels,
    rawScores,
    evidence,
    levelBreakdown,
  });

  const positiveTotal = Object.values(rawScores).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const ranked = Object.entries(rawScores)
    .map(([type, score]) => ({
      type,
      label: INTENT_DEFINITIONS[type].label,
      kind: INTENT_DEFINITIONS[type].kind,
      rawScore: Number(score.toFixed(3)),
      score: Number((Math.max(0, score) / positiveTotal).toFixed(4)),
      evidence: [...new Set(evidence[type])].slice(0, 6),
      levelBreakdown: {
        words: Number(levelBreakdown.words[type].toFixed(3)),
        sentences: Number(levelBreakdown.sentences[type].toFixed(3)),
        message: Number(levelBreakdown.message[type].toFixed(3)),
      },
    }))
    .sort((left, right) => right.rawScore - left.rawScore);

  const top = ranked[0] || { type: 'chat.reply', rawScore: 0, score: 1, kind: 'default' };
  const second = ranked[1] || { type: 'chat.reply', rawScore: 0, score: 0, kind: 'default' };
  const sentenceWinners = sentenceItems
    .map((sentence) => {
      const sentenceText = String(sentence.normalized || '').trim();
      let bestType = 'chat.reply';
      let bestScore = 0.05;
      for (const [intentType, definition] of Object.entries(INTENT_DEFINITIONS)) {
        let sentenceScore = 0;
        if (definition.verbs.some((token) => sentenceText.includes(token))) sentenceScore += 1;
        if (definition.keywords.some((token) => sentenceText.includes(token))) sentenceScore += 0.75;
        if (sentenceScore > bestScore) {
          bestType = intentType;
          bestScore = sentenceScore;
        }
      }
      return bestType;
    });

  const dominantSentenceIntent = sentenceWinners.length
    ? sentenceWinners.sort((left, right) =>
      sentenceWinners.filter((entry) => entry === right).length - sentenceWinners.filter((entry) => entry === left).length
    )[0]
    : top.type;
  const sentenceConsistency = sentenceWinners.length
    ? sentenceWinners.filter((entry) => entry === dominantSentenceIntent).length / sentenceWinners.length
    : 0.72;

  const marginRatio = top.rawScore > 0 ? (top.rawScore - second.rawScore) / top.rawScore : 0;
  const confidence = clamp01(
    (top.score * 0.38)
    + (marginRatio * 0.36)
    + (sentenceConsistency * 0.18)
    + ((levels.levels?.message?.rgba?.a || 0) * 0.08)
  );

  const shouldAutoShowExistingImage = Boolean(
    subject
    && top.type === 'web.image.search'
    && confidence >= 0.6
    && marginRatio >= 0.12
  );

  const shouldClarifySuggestion = Boolean(
    top.kind === 'action'
    && second.kind !== 'default'
    && top.rawScore >= 1.2
    && !shouldAutoShowExistingImage
    && !strongImplicitImageRequest
    && (
      confidence < 0.62
      || marginRatio < 0.24
      || second.rawScore >= top.rawScore * 0.72
    )
  );

  const ambiguities = [];
  if (shouldClarifySuggestion) {
    ambiguities.push({
      between: [top.type, second.type],
      message: `Ambiguité entre ${top.label} et ${second.label}`,
      margin: Number(marginRatio.toFixed(3)),
    });
  }

  return {
    version: 'semantic-intent-score-1',
    sourceText,
    subject,
    topIntents: ranked,
    ambiguities,
    knowledge,
    summary: {
      selectedIntentType: top.type,
      confidence: Number(confidence.toFixed(4)),
      marginRatio: Number(marginRatio.toFixed(4)),
      sentenceConsistency: Number(sentenceConsistency.toFixed(4)),
      shouldClarifySuggestion,
      actionSignal: actionLike,
      questionSignal: questionLike || explicitQuestion,
      showSignal: showLike,
      colorSignal: colorWordCount > 0,
      visualStyleSignal,
    },
  };
}

module.exports = scoreSemanticIntents;

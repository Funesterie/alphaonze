const {
  INTENT_DEFINITIONS,
  clamp01,
  countRegexMatches,
  extractSubjectCandidate,
} = require('./semantic-utils.cjs');
const {
  applySemanticKnowledgeModules,
} = require('../../knowledge/a11-knowledge-operator.cjs');
const {
  collectUniqueColorsFromWordItems,
} = require('./color-library.cjs');
const {
  collectUniqueStylesFromWordItems,
} = require('./style-library.cjs');
const {
  collectUniqueScenesFromWordItems,
} = require('./scene-library.cjs');

function scoreSemanticIntents(levels, overrides = {}) {
  if (!levels || typeof levels !== 'object') return null;

  const sourceText = String(levels.sourceText || '').trim();
  const normalizedText = String(levels.normalizedText || '').trim();
  const wordItems = Array.isArray(levels.levels?.words?.items) ? levels.levels.words.items : [];
  const sentenceItems = Array.isArray(levels.levels?.sentences?.items) ? levels.levels.sentences.items : [];

  const detectImageIntent = typeof overrides.detectImageIntent === 'function' ? overrides.detectImageIntent : null;
  const detectVideoIntent = typeof overrides.detectVideoIntent === 'function' ? overrides.detectVideoIntent : null;
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

  // Court-circuit : expressions idiomatiques/introspectives → toujours chat.reply
  // Ex: "cherche dans ton os", "trouve en toi", "c'est quoi ton rêve", "qui es-tu"
  const introspectivePattern = /\b(dans\s+ton\s+(os|coeur|ame|âme|tete|tête|esprit|mémoire|memoire)|en\s+toi|ton\s+(reve|rêve|but|identite|identité|nindo|histoire)|qui\s+(es-tu|es\s+tu)|c'est\s+quoi\s+ton|qu'est-ce\s+que\s+tu|parle\s+moi\s+de\s+toi)\b/i;
  if (introspectivePattern.test(normalizedText)) {
    rawScores['chat.reply'] += 10;
    evidence['chat.reply'].push('introspective-bypass');
  }

  const questionLike = /\?/.test(sourceText);
  const explicitQuestion = /\b(comment|pourquoi|quand|qui|quoi|ou|où|what|how|why|when|who)\b/.test(normalizedText);
  const actionLike = /\b(genere|cree|dessine|cherche|trouve|montre|affiche|ecris|code|fais|prepare|generate|create|draw|search|find|show|write)\b/.test(normalizedText);
  const creationLike = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare|generate|create|draw|make|render)\b/.test(normalizedText);
  const videoKeywordLike = /\b(video|animation|gif|mp4|clip|sequence|frames)\b/.test(normalizedText);
  const explicitImageKeywordLike = /\b(image|illustration|dessin|photo|visuel|portrait|art)\b/.test(normalizedText);
  const showLike = /\b(montre|montrer|affiche|afficher|fais voir|show me|show|cherche|chercher|trouve|trouver|find|search)\b/.test(normalizedText);
  const troubleshootingLike = /\b(explique|expliquer|probleme|probl[eè]me|bug|erreur|souci|conforme|incorrect|fonctionne|marche)\b/.test(normalizedText);
  const discussesImageSystem = /\b(image|illustration|dessin|photo|visuel|portrait|art|generateur|g[eé]n[eé]rateur|moteur)\b/.test(normalizedText);
  const metaImageDiscussion = Boolean(
    discussesImageSystem
    && !creationLike
    && (explicitQuestion || troubleshootingLike)
  );
  const emailActionLike = /\b(envoie|envoyer|envoi|mail|email|gmail|courriel|message)\b/.test(normalizedText);
  const emailAddressLike = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(sourceText);
  const attachmentLike = /\b(avec|join|joins|joint|jointe|piece jointe|pi[eè]ce jointe|attachment|attached|inclu|inclure)\b/.test(normalizedText);
  const subject = extractSubjectCandidate(
    wordItems.map((item) => item.word),
    { sourceText }
  );
  const detectedColors = collectUniqueColorsFromWordItems(wordItems);
  const detectedStyles = collectUniqueStylesFromWordItems(wordItems);
  const detectedScenes = collectUniqueScenesFromWordItems(wordItems);
  const colorWordCount = detectedColors.length;
  const codeKeywordSignal = /\b(python|script|fonction|code|programme|api|json|regex|tri|fichier|dossier|png|csv|node)\b/.test(normalizedText);
  const mailRequestWithReferencedImage = Boolean(
    emailActionLike
    && (emailAddressLike || /\b(mail|email|gmail|courriel)\b/.test(normalizedText))
    && /\bimage\b/.test(normalizedText)
    && !creationLike
  );
  const strongImplicitImageRequest = Boolean(
    creationLike
    && colorWordCount > 0
    && subject
    && !codeKeywordSignal
  );
  const visualStyleSignal = detectedStyles.length > 0
    || /\b(cartoon|anime|pixel art|watercolor|cinematic|illustration|portrait|render|3d|manga)\b/.test(normalizedText);
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
  if (detectVideoIntent && detectVideoIntent(sourceText)) {
    rawScores['video.generate'] += 2.1;
    levelBreakdown.message['video.generate'] += 2.1;
    evidence['video.generate'].push('heuristique:video.generate');
  }
  if (detectWebImageIntent && detectWebImageIntent(sourceText)) {
    rawScores['web.image.search'] += 2.1;
    levelBreakdown.message['web.image.search'] += 2.1;
    evidence['web.image.search'].push('heuristique:web.image.search');
  }

  if (questionLike || explicitQuestion) {
    // Favoriser chat.reply pour les questions, sauf si recherche web explicite
    const hasWebSearchIntent = /\b(cherche|trouve|recherche|google|bing|web|internet|source|article)\b/.test(normalizedText);
    if (hasWebSearchIntent) {
      rawScores['web.search'] += 0.85;
      rawScores['chat.reply'] += 0.25;
      levelBreakdown.message['web.search'] += 0.85;
      levelBreakdown.message['chat.reply'] += 0.25;
    } else {
      rawScores['chat.reply'] += 0.75;
      rawScores['web.search'] += 0.32;
      levelBreakdown.message['chat.reply'] += 0.75;
      levelBreakdown.message['web.search'] += 0.32;
    }
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

  if (videoKeywordLike) {
    rawScores['video.generate'] += 1.25;
    levelBreakdown.message['video.generate'] += 1.25;
    evidence['video.generate'].push('heuristique:video_keyword_signal');
    if (!explicitImageKeywordLike) {
      rawScores['image.generate'] -= 1.6;
      rawScores['web.image.search'] -= 0.9;
      levelBreakdown.message['image.generate'] -= 1.6;
      levelBreakdown.message['web.image.search'] -= 0.9;
      evidence['image.generate'].push('suppression:explicit_video_keyword_signal');
      evidence['web.image.search'].push('suppression:explicit_video_keyword_signal');
    }
  } else {
    rawScores['video.generate'] -= 1.5;
    levelBreakdown.message['video.generate'] -= 1.5;
    evidence['video.generate'].push('suppression:no_video_keyword_signal');
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
    // Réduire le bonus si pas de verbe de création explicite
    const styleBonus = creationLike ? 1.25 : 0.45;
    rawScores['image.generate'] += styleBonus;
    levelBreakdown.message['image.generate'] += styleBonus;
    evidence['image.generate'].push(creationLike ? 'heuristique:visual_style_signal' : 'heuristique:visual_style_signal_weak');
  }

  if (mailRequestWithReferencedImage) {
    rawScores['chat.reply'] += 2.4;
    rawScores['image.generate'] -= 2.6;
    rawScores['web.image.search'] -= 1.8;
    levelBreakdown.message['chat.reply'] += 2.4;
    levelBreakdown.message['image.generate'] -= 2.6;
    levelBreakdown.message['web.image.search'] -= 1.8;
    evidence['chat.reply'].push('heuristique:mail_request_with_referenced_image');
    evidence['image.generate'].push('suppression:mail_request_with_referenced_image');
    evidence['web.image.search'].push('suppression:mail_request_with_referenced_image');
  } else if (emailActionLike && (emailAddressLike || attachmentLike)) {
    rawScores['chat.reply'] += 1.35;
    levelBreakdown.message['chat.reply'] += 1.35;
    evidence['chat.reply'].push('heuristique:mail_action');
  }

  if (metaImageDiscussion) {
    rawScores['chat.reply'] += 2.2;
    rawScores['web.search'] += explicitQuestion ? 0.55 : 0.18;
    rawScores['image.generate'] -= 2.8;
    rawScores['web.image.search'] -= 1.6;
    levelBreakdown.message['chat.reply'] += 2.2;
    levelBreakdown.message['web.search'] += explicitQuestion ? 0.55 : 0.18;
    levelBreakdown.message['image.generate'] -= 2.8;
    levelBreakdown.message['web.image.search'] -= 1.6;
    evidence['chat.reply'].push('heuristique:meta_image_discussion');
    evidence['web.search'].push('heuristique:meta_image_discussion');
    evidence['image.generate'].push('suppression:meta_image_discussion');
    evidence['web.image.search'].push('suppression:meta_image_discussion');
  }

  // Signaux forts pour chat.reply (conversations, feedback, greetings, meta-discussion)
  const greetingLike = /\b(salut|bonjour|bonsoir|hello|hi|hey|coucou|merci|thanks|ok|d'accord|bien|super|cool|genial|génial)\b/.test(normalizedText);
  const feedbackLike = /\b(j'aime|j'adore|c'est bien|c'est beau|bravo|excellent|parfait|top|nickel)\b/.test(normalizedText);
  const conversationLike = /\b(tu penses|tu crois|selon toi|d'apres toi|d'après toi|ton avis|que penses-tu|what do you think|in your opinion)\b/.test(normalizedText);
  const metaDiscussionLike = /\b(comment tu|pourquoi tu|explique-moi|dis-moi|raconte|parle-moi|how do you|why do you|tell me|explain)\b/.test(normalizedText);
  const shortMessageWithoutAction = wordItems.length > 0 && wordItems.length <= 5 && !creationLike && !showLike;

  if (greetingLike) {
    rawScores['chat.reply'] += 2.5;
    levelBreakdown.message['chat.reply'] += 2.5;
    evidence['chat.reply'].push('heuristique:greeting');
  }

  if (feedbackLike) {
    rawScores['chat.reply'] += 2.8;
    levelBreakdown.message['chat.reply'] += 2.8;
    evidence['chat.reply'].push('heuristique:feedback');
  }

  if (conversationLike || metaDiscussionLike) {
    rawScores['chat.reply'] += 2.4;
    levelBreakdown.message['chat.reply'] += 2.4;
    evidence['chat.reply'].push('heuristique:conversation');
  }

  if (shortMessageWithoutAction) {
    rawScores['chat.reply'] += 1.2;
    levelBreakdown.message['chat.reply'] += 1.2;
    evidence['chat.reply'].push('heuristique:short_message_no_action');
  }

  // Bonus de base pour chat.reply augmenté de 0.25 à 1.5
  // Cela garantit que chat.reply est compétitif même sans signaux forts
  rawScores['chat.reply'] += 1.5;
  levelBreakdown.message['chat.reply'] += 1.5;

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
    && top.rawScore >= 2.0        // relevé de 1.2 → 2.0
    && !shouldAutoShowExistingImage
    && !strongImplicitImageRequest
    && !troubleshootingLike       // jamais clarifier si c'est du troubleshooting
    && (
      confidence < 0.55           // abaissé de 0.62 → 0.55 (moins sensible)
      || marginRatio < 0.30       // relevé de 0.24 → 0.30
      || second.rawScore >= top.rawScore * 0.78  // relevé de 0.72 → 0.78
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
      detectedColors: detectedColors.map((entry) => entry.label),
      styleSignal: detectedStyles.length > 0,
      detectedStyles: detectedStyles.map((entry) => entry.label),
      sceneSignal: detectedScenes.length > 0,
      detectedScenes: detectedScenes.map((entry) => entry.label),
      visualStyleSignal,
      mailActionSignal: mailRequestWithReferencedImage || emailActionLike,
      metaImageDiscussion,
    },
  };
}

module.exports = scoreSemanticIntents;

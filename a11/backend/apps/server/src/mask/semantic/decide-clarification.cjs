function buildOptionsForIntents(first, second) {
  return [
    {
      id: '1',
      intentType: first.type,
      label: first.label,
      promptLine: `1. ${first.label}`,
    },
    {
      id: '2',
      intentType: second.type,
      label: second.label,
      promptLine: `2. ${second.label}`,
    },
  ];
}

function hasExplicitImageGenerationCue(scoring = {}) {
  const text = String(scoring?.sourceText || scoring?.normalizedText || '').trim();
  if (!text) return false;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const creationCue = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare|fais moi|fais|make|generate|create|draw)\b/.test(normalized);
  const imageCue = /\b(image|illustration|dessin|photo|visuel|portrait|avatar|artwork)\b/.test(normalized);
  const searchCue = /\b(cherche|chercher|recherche|trouve|trouver|web|internet|google|image existante|deja existante|source)\b/.test(normalized);
  return creationCue && imageCue && !searchCue;
}

function buildQuestion(first, second) {
  const pair = [first.type, second.type].sort().join('::');
  switch (pair) {
    case 'image.generate::web.image.search':
      return "Tu veux que je cree l'image, ou tu veux une image deja existante ?";
    case 'code.python.generate::image.generate':
      return "Tu veux une image, ou tu veux que je produise du code/script ?";
    case 'chat.reply::web.search':
      return "Tu veux une reponse directe, ou tu veux que je fasse une recherche web ?";
    case 'image.generate::video.generate':
      return "Tu veux une image fixe, ou une video/animation ?";
    case 'code.python.generate::web.search':
      return "Tu veux du code Python, ou des informations sur le sujet ?";
    case 'video.generate::web.search':
      return "Tu veux que je genere une video, ou que je cherche des infos sur le sujet ?";
    case 'chat.reply::image.generate':
      return "Tu veux juste discuter, ou tu veux que je genere une image ?";
    case 'chat.reply::code.python.generate':
      return "Tu veux une explication, ou du code Python fonctionnel ?";
    default:
      return `Je vois deux interpretations possibles: ${first.label} ou ${second.label}. Tu veux laquelle ?`;
  }
}

function buildRecommendationLine(first, second, scoring) {
  const confidence = Number(scoring?.summary?.confidence || 0);
  const marginRatio = Number(scoring?.summary?.marginRatio || 0);
  if (!first || confidence < 0.44) return '';

  const pair = [first.type, second?.type || ''].sort().join('::');
  switch (pair) {
    case 'image.generate::web.image.search':
      return first.type === 'image.generate'
        ? "Je penche plutot pour une generation d'image. Si c'est bien ca, tu peux simplement repondre \"vas-y\"."
        : "Je penche plutot pour une image existante sur le web. Si c'est bien ca, tu peux simplement repondre \"vas-y\".";
    case 'code.python.generate::image.generate':
      return first.type === 'code.python.generate'
        ? "Je penche plutot pour du code. Si c'est bien ca, tu peux simplement repondre \"vas-y\"."
        : "Je penche plutot pour une image. Si c'est bien ca, tu peux simplement repondre \"vas-y\".";
    default:
      if (marginRatio >= 0.1) {
        return `Je penche plutot pour: ${first.label}. Si c'est bien ca, tu peux simplement repondre "vas-y".`;
      }
      return '';
  }
}

function decideClarification(scoring) {
  if (!scoring || typeof scoring !== 'object') return null;

  const topIntents = Array.isArray(scoring.topIntents) ? scoring.topIntents : [];
  const first = topIntents[0] || null;
  const second = topIntents[1] || null;
  if (!first) {
    return {
      shouldClarify: false,
      selectedIntentType: 'chat.reply',
      confidence: 0,
      question: '',
      options: [],
    };
  }

  const imageSearchPair = [first?.type, second?.type].sort().join('::') === 'image.generate::web.image.search';
  const shouldClarifyImageSearchPair = Boolean(
    imageSearchPair
    && scoring.summary?.showSignal
    && scoring.summary?.colorSignal
    && first
    && second
    && first.rawScore >= 1
    && second.rawScore >= 1
  );

  // Détecter les cas ambigus nécessitant clarification — seuils relevés pour libérer A11
  const hasMultipleStrongIntents = Boolean(
    first
    && second
    && first.rawScore >= 3.0      // relevé de 2.0 → 3.0
    && second.rawScore >= 2.2     // relevé de 1.5 → 2.2
    && second.rawScore >= first.rawScore * 0.75  // relevé de 0.65 → 0.75
  );

  // hasConflictingSignals supprimé : trop de faux positifs
  // (ex: "t'a recherche internet fonctionne pas ?" → actionSignal + questionSignal → clarification inutile)

  // Paire web.search vs web.image.search : toujours résoudre en web.search sans clarifier
  const isWebSearchPair = [first?.type, second?.type].sort().join('::') === 'web.image.search::web.search';
  const firstEvidence = Array.isArray(first?.evidence) ? first.evidence.join(' ') : '';
  const clearImplicitImageRequest = Boolean(
    first?.type === 'image.generate'
    && scoring.summary?.actionSignal
    && scoring.subject
    && (
      scoring.summary?.colorSignal
      || /\b(?:mot-cle:image|pattern:)/i.test(firstEvidence)
    )
  );

  const shouldClarify = Boolean(
    (scoring.summary?.shouldClarifySuggestion || shouldClarifyImageSearchPair || hasMultipleStrongIntents)
    && !isWebSearchPair  // jamais clarifier web.search vs web.image.search
    && !clearImplicitImageRequest
    && !hasExplicitImageGenerationCue(scoring)
    && first
    && second
    && first.type !== 'chat.reply'
    && second.type !== first.type
    && first.rawScore >= 1.2  // relevé de 0.8 → 1.2
  );

  const options = shouldClarify ? buildOptionsForIntents(first, second) : [];
  const question = shouldClarify ? buildQuestion(first, second) : '';
  const recommendationLine = shouldClarify ? buildRecommendationLine(first, second, scoring) : '';

  return {
    shouldClarify,
    selectedIntentType: first.type,
    confidence: Number(scoring.summary?.confidence || 0),
    question,
    options,
    recommendedIntentType: shouldClarify ? first.type : '',
    recommendedOptionId: shouldClarify ? String(options[0]?.id || '') : '',
    recommendationLine,
    candidates: shouldClarify ? [first, second] : [first],
    reason: shouldClarify
      ? `ambiguite entre ${first.type} et ${second.type}`
      : `intention retenue: ${first.type}`,
  };
}

module.exports = decideClarification;

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

function buildQuestion(first, second) {
  const pair = [first.type, second.type].sort().join('::');
  switch (pair) {
    case 'image.generate::web.image.search':
      return "Tu veux que je genere une image, ou que je cherche une image existante sur le web ?";
    case 'code.python.generate::image.generate':
      return "Tu veux une image, ou tu veux que je produise du code/script ?";
    case 'memory.recall::web.search':
      return "Tu veux que je me base sur notre memoire de conversation, ou que je cherche l'info sur le web ?";
    case 'chat.reply::web.search':
      return "Tu veux une reponse directe, ou tu veux que je fasse une recherche web ?";
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
    case 'memory.recall::web.search':
      return first.type === 'memory.recall'
        ? "Je penche plutot pour un rappel de memoire. Si c'est bien ca, tu peux simplement repondre \"vas-y\"."
        : "Je penche plutot pour une recherche web. Si c'est bien ca, tu peux simplement repondre \"vas-y\".";
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

  const shouldClarify = Boolean(
    scoring.summary?.shouldClarifySuggestion
    && first
    && second
    && first.type !== 'chat.reply'
    && second.type !== first.type
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

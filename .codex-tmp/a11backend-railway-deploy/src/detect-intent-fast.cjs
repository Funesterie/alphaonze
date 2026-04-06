// apps/server/src/detect-intent-fast.cjs
// Détecteur rapide d’intention avec score de confiance et mode

function detectIntentFast(userText) {
  const text = userText.toLowerCase();
  let score = 0;
  const candidates = [];

  if (/^(génère|dessine|crée|fabrique)/.test(text)) {
    score += 0.35;
    candidates.push('image.generate');
  }
  if (/affiche/.test(text)) {
    score += 0.25;
    candidates.push('image.generate', 'text.answer', 'ui.display');
  }
  if (/trie.*(png|jpg|webp|image)/.test(text)) {
    score += 0.35;
    candidates.push('action.run');
  }
  // ...autres règles à enrichir...

  // Ambiguïté : plusieurs intents ou verbe flou
  if (candidates.length > 1) score -= 0.3;
  if (/carambar|dragon|chat|robot/.test(text)) score += 0.25;

  // Mode selon score
  if (score >= 0.75) {
    return { mode: 'direct', intent: candidates[0], confidence: score };
  }
  if (score >= 0.45) {
    return { mode: 'llm_resolve', candidates, confidence: score };
  }
  return { mode: 'clarify', reason: 'ambiguous_subject_or_action' };
}

module.exports = detectIntentFast;

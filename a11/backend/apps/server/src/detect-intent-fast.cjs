const { normalizeIntentType } = require('./mask/semantic/semantic-utils.cjs');

function detectIntentFast(userText) {
  const text = String(userText || '').toLowerCase();
  let score = 0;
  const candidates = [];

  if (/^(génère|dessine|crée|fabrique|genere|cree)/.test(text)) {
    score += 0.35;
    candidates.push('image.generate');
  }
  if (/affiche|montre/.test(text)) {
    score += 0.25;
    candidates.push('web.image.search', 'chat.reply');
  }
  if (/trie.*(png|jpg|webp|image)/.test(text)) {
    score += 0.35;
    candidates.push('code.python.generate');
  }

  const canonicalCandidates = [...new Set(candidates.map((intent) => normalizeIntentType(intent)))];

  if (canonicalCandidates.length > 1) score -= 0.3;
  if (/carambar|dragon|chat|robot/.test(text)) score += 0.25;

  if (score >= 0.75) {
    return { mode: 'direct', intent: canonicalCandidates[0] || 'chat.reply', confidence: score };
  }
  if (score >= 0.45) {
    return { mode: 'llm_resolve', candidates: canonicalCandidates, confidence: score };
  }
  return { mode: 'clarify', reason: 'ambiguous_subject_or_action' };
}

module.exports = detectIntentFast;

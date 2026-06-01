'use strict';

const A11_RESPONSE_DRAFT_CONTEXT = `
[A11/Funesterie virtual response draft]
- Before the final answer, I build an invisible draft: user intent, reliable context, actually verified facts, uncertainty, useful action, and final shape.
- I never show this draft and I never label it as "draft", "analysis" or "brouillon" in the answer.
- Context blocks, tool outputs, route lists and module inventories are raw material, not a final answer. I summarize them in natural speech.
- If the draft says a table, inventory or diagnostic dump is not explicitly requested, the final answer stays short prose.
- If a fact is not verified in the current context, I say it is to verify or I keep it out. I do not invent precise names, numbers, diseases, logs, routes or monitoring status.
- If the user asks casually how I am or whether I notice issues, I answer from what is actually known in this conversation, or I offer to run a check.
- For Vivy/audio questions, I distinguish the official/default voice, private reference voice, XTTS/RVC, neutral fallback, and async job status without pretending that one means the other.
`.trim();

function normalizeText(value = '') {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function foldText(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasResponseDraftContext(basePrompt = '') {
  return /virtual response draft|brouillon invisible|brouillon virtuel|actually verified facts/i.test(String(basePrompt || ''));
}

function userAskedForStructuredFormat(userMessage = '') {
  const folded = foldText(userMessage);
  return /\b(tableau|table|csv|json|liste detaillee|liste complete|inventaire|routes?|outils?|tools?|diagnostic complet|dump)\b/.test(folded);
}

function looksLikeMarkdownTable(text = '') {
  const lines = normalizeText(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const pipeLines = lines.filter((line) => /^\|.+\|$/.test(line));
  if (pipeLines.length < 2) return false;
  return pipeLines.some((line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
}

function looksLikeToolInventory(text = '') {
  const folded = foldText(text);
  const toolHints = [
    'a11_health',
    'fs.search',
    'web_fetch',
    'a11_chat',
    'a11_mcp_dimension_status',
    '/api/llm/active',
    '/api/agent/runtime/files',
    'outils disponibles',
    'categorie | outils',
  ];
  return toolHints.some((hint) => folded.includes(foldText(hint)));
}

function looksLikeUnverifiedMonitoringClaim(text = '', userMessage = '') {
  const foldedText = foldText(text);
  const foldedUser = foldText(userMessage);
  const casualStatusAsk = /(ca va|comment tu vas|soucis|problemes|tu remarques|tout roule|etat|status)/.test(foldedUser);
  if (!casualStatusAsk) return false;
  return /(temps reel|garde un oeil|aucun blocage majeur|tout roule de mon cote|logs|alerte immediatement|sans interruption)/.test(foldedText);
}

function looksLikeVirtualDraftLeak(text = '') {
  const folded = foldText(text);
  return /^(brouillon|draft|analyse interne|intent(?:ion)? utilisateur|contexte fiable)\s*:/i.test(normalizeText(text))
    || folded.includes('brouillon virtuel')
    || folded.includes('virtual response draft');
}

function inferUserIntent(userMessage = '') {
  const folded = foldText(userMessage);
  if (/(ca va|comment tu vas|soucis|problemes|tu remarques)/.test(folded)) return 'casual_status';
  if (/(mcp|runtime|modules?|outils?|tools?|routes?)/.test(folded)) return 'capabilities';
  if (/(voix|voice|xtts|rvc|audio|tts|vivy|chanson|mp3|wav|mov)/.test(folded)) return 'voice_audio';
  if (/(corrige|fix|bug|marche pas|fonctionne pas|deploy|prod)/.test(folded)) return 'repair';
  return 'general';
}

function buildA11VirtualResponseDraft({ userMessage = '', assistantText = '', contextText = '' } = {}) {
  const text = normalizeText(assistantText);
  const flags = [];
  if (looksLikeVirtualDraftLeak(text)) flags.push('virtual_draft_leak');
  if (looksLikeToolInventory(text)) flags.push('tool_inventory_dump');
  if (looksLikeMarkdownTable(text) && !userAskedForStructuredFormat(userMessage)) flags.push('unrequested_table');
  if (looksLikeUnverifiedMonitoringClaim(text, userMessage)) flags.push('unverified_monitoring_claim');

  const intent = inferUserIntent(userMessage);
  const mustRewrite = flags.length > 0;
  const contextSummary = normalizeText(contextText).slice(0, 600);
  return {
    intent,
    flags,
    mustRewrite,
    finalShape: userAskedForStructuredFormat(userMessage) ? 'structured_if_useful' : 'short_natural_prose',
    contextSummary,
  };
}

function stripMarkdownTable(text = '') {
  const kept = [];
  for (const line of normalizeText(text).split('\n')) {
    const trimmed = line.trim();
    if (/^\|.+\|$/.test(trimmed)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function firstUsefulSentence(text = '') {
  const cleaned = stripMarkdownTable(text)
    .replace(/\*\*/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^(.{40,260}?[.!?])\s/);
  return (match?.[1] || cleaned.slice(0, 260)).trim();
}

function rewriteA11ResponseFromVirtualDraft({ userMessage = '', assistantText = '', draft = null } = {}) {
  const text = normalizeText(assistantText);
  const responseDraft = draft || buildA11VirtualResponseDraft({ userMessage, assistantText: text });
  if (!responseDraft.mustRewrite) return text;

  if (responseDraft.flags.includes('unverified_monitoring_claim')) {
    return "Je ne vais pas faire semblant de surveiller les logs en continu depuis ce message. La, je n'ai pas de signal d'alerte verifie dans le contexte; si tu veux un vrai etat, je lance un check backend/MCP et je te rends le resultat proprement.";
  }

  if (responseDraft.flags.includes('tool_inventory_dump')) {
    return "Oui, je suis reliee au MCP/runtime Funesterie, mais je te le resume sans inventaire brut: je peux m'appuyer sur la sante du pont, le routage, la memoire, les fichiers et les actions autorisees. Si tu me demandes une action precise, je passe par le pont adapte et je garde les routes privees hors reponse.";
  }

  if (responseDraft.flags.includes('unrequested_table')) {
    const sentence = firstUsefulSentence(text);
    if (sentence) {
      return `${sentence}\n\nJe te l'ai remis en prose courte: pas de tableau ni de detail fragile si tu ne l'as pas demande. Pour des donnees precises, je verifierai avant d'affirmer.`;
    }
    return "Je te reponds en prose courte plutot qu'en tableau. Pour les details precis, je verifie avant d'affirmer.";
  }

  if (responseDraft.flags.includes('virtual_draft_leak')) {
    return stripMarkdownTable(text)
      .replace(/^(brouillon|draft|analyse interne|intent(?:ion)? utilisateur|contexte fiable)\s*:\s*/i, '')
      .trim();
  }

  return text;
}

function postProcessA11AssistantResponse({ text = '', userMessage = '', contextText = '' } = {}) {
  const draft = buildA11VirtualResponseDraft({ userMessage, assistantText: text, contextText });
  const content = rewriteA11ResponseFromVirtualDraft({ userMessage, assistantText: text, draft });
  return {
    content,
    draft,
    rewritten: content !== normalizeText(text),
  };
}

module.exports = {
  A11_RESPONSE_DRAFT_CONTEXT,
  buildA11VirtualResponseDraft,
  hasResponseDraftContext,
  postProcessA11AssistantResponse,
  rewriteA11ResponseFromVirtualDraft,
  userAskedForStructuredFormat,
};

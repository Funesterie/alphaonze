'use strict';

const A11_RESPONSE_DRAFT_CONTEXT = `
[A11/Funesterie response hygiene]
- Je reponds au dernier message visible, dans la langue naturelle de l'utilisateur.
- Les blocs contexte, outils, routes, memoire et modules servent de notes internes: je les transforme en reponse simple, je ne les recopie pas.
- Je ne produis pas de texte meta qui annonce un travail interne ou une reponse generique: je reponds directement au message.
- Si un fait n'est pas verifie dans le tour courant, je le garde prudent ou je propose une verification.
- Si l'utilisateur demande comment je vais ou s'il y a un souci, je ne pretends pas surveiller les logs en temps reel sans check lance.
- Pour les voix, images, fichiers, MCP et runtime, je parle de routage, permission ou surface disponible plutot que de nier l'existence du module.
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
  return /response hygiene|virtual response draft|brouillon invisible|brouillon virtuel|actually verified facts/i.test(String(basePrompt || ''));
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

function looksLikeVoiceCapabilityDenial(text = '', userMessage = '') {
  const foldedText = foldText(text);
  const foldedUser = foldText(userMessage);
  if (!/(voix|voice|audio|tts|wav|mp3|xtts|rvc|piper|cartesia|elevenlabs)/.test(foldedUser)) return false;
  return /(je ne gere pas.*(?:wav|audio|voix)|je ne manipule pas.*(?:wav|audio|voix)|tout se passe en texte|je n ai pas de voix|je ne produis pas d audio)/.test(foldedText);
}

function looksLikeStaleUserMessageEcho(text = '', userMessage = '') {
  const current = foldText(userMessage);
  if (!current) return false;
  const normalized = normalizeText(text);
  const match = normalized.match(/\b(?:vous avez ecrit|vous avez écrit|tu as ecrit|tu as écrit|tu demandes|vous demandez)\s*[:：]\s*[«"“]?([^»"”\n]{3,180})/i);
  if (!match) return false;
  const quoted = foldText(match[1]);
  if (!quoted || quoted.length < 3) return false;
  return !current.includes(quoted) && !quoted.includes(current.slice(0, Math.min(quoted.length, current.length)));
}

function looksLikeVirtualDraftLeak(text = '') {
  const folded = foldText(text);
  const normalized = normalizeText(text);
  return /^(brouillon|draft|analyse interne|intent(?:ion)? utilisateur|contexte fiable)\s*:/i.test(normalized)
    || /^(voici|here(?:'s| is)|there(?:'s| is))\s+(?:un\s+)?(?:brouillon|draft)\.?$/i.test(normalized)
    || /^voici\s+un\s+brouillon\b/i.test(normalized)
    || /^here(?:'s| is)\s+a\s+draft\b/i.test(normalized)
    || folded.includes('brouillon virtuel')
    || folded.includes('virtual response draft');
}

function looksLikeGenericContextPlaceholder(text = '') {
  const normalized = normalizeText(text)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /^sure,?\s+here(?:'s| is)\s+(?:a\s+)?short reply to the last message\.?$/i.test(normalized)
    || /^here(?:'s| is)\s+(?:a\s+)?short reply to the last message\.?$/i.test(normalized)
    || /^certainly,?\s+here(?:'s| is)\s+(?:a\s+)?short reply\b/i.test(normalized)
    || /^bien sur,?\s+voici\s+une\s+reponse\s+courte\s+au\s+dernier\s+message\.?$/i.test(foldText(normalized));
}

function userMessageLooksFrench(userMessage = '') {
  const folded = foldText(userMessage);
  if (!folded) return false;
  return /[àâçéèêëîïôùûüÿœæ]/i.test(String(userMessage || ''))
    || /\b(salut|ca|ça|oui|non|pourquoi|comment|quoi|qui|tu|toi|te|ta|ton|tes|avec|faire|fais|peux|peut|marche|fonctionne|probleme|problème|reponds|réponds)\b/i.test(folded);
}

function looksLikeEnglishDrift(text = '', userMessage = '') {
  if (!userMessageLooksFrench(userMessage)) return false;
  const normalized = normalizeText(text).replace(/\s+/g, ' ').trim();
  return /^(sure|certainly|here)\b/i.test(normalized)
    && /\b(short reply|last message|how can i help|what can i do)\b/i.test(normalized);
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
  if (looksLikeStaleUserMessageEcho(text, userMessage)) flags.push('stale_user_message_echo');
  if (looksLikeToolInventory(text)) flags.push('tool_inventory_dump');
  if (looksLikeMarkdownTable(text) && !userAskedForStructuredFormat(userMessage)) flags.push('unrequested_table');
  if (looksLikeUnverifiedMonitoringClaim(text, userMessage)) flags.push('unverified_monitoring_claim');
  if (looksLikeVoiceCapabilityDenial(text, userMessage)) flags.push('voice_capability_denial');
  if (looksLikeGenericContextPlaceholder(text)) flags.push('generic_context_placeholder');
  if (looksLikeEnglishDrift(text, userMessage)) flags.push('english_language_drift');

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
    .replace(/\bJe te l['’]ai remis en prose courte\s*:?\s*pas de tableau ni de d[ée]tail fragile si tu ne l['’]as pas demand[ée]\.?\s*/gi, '')
    .replace(/\bPour des donn[ée]es pr[ée]cises, je v[ée]rifierai avant d['’]affirmer\.?\s*/gi, '')
    .replace(/\bJe te r[ée]ponds en prose courte plut[oô]t qu['’]en tableau\.?\s*/gi, '')
    .replace(/\s+\d+\s*\/\s*:\s*\?\s*$/g, '')
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
  const foldedUser = foldText(userMessage);
  const fallback = () => {
    if (/(salut|bonjour|coucou|ca va|ça va|comment tu vas)/.test(foldedUser)) {
      return 'Salut, oui ca va. Et toi ?';
    }
    if (/(pour faire quoi|quoi faire|tu veux faire quoi)/.test(foldedUser)) {
      return "Pour repondre a ta demande du moment. Dis-moi le resultat voulu et je m'en occupe.";
    }
    return "Je n'ai pas recu une reponse exploitable. Reformule en une phrase et je repars proprement.";
  };

  if (responseDraft.flags.includes('generic_context_placeholder') || responseDraft.flags.includes('english_language_drift')) {
    return fallback();
  }

  if (responseDraft.flags.includes('unverified_monitoring_claim')) {
    return "Je n'ai pas de check lance dans ce tour. Si tu veux un vrai etat, je verifie le backend/MCP et je te rends le resultat.";
  }

  if (responseDraft.flags.includes('voice_capability_denial')) {
    return "Tu as raison de parler de voix: ma reponse texte est separee du module TTS, mais la voix entendue passe bien par le backend Funesterie. Pour A11, la cible officielle est une voix grave et protectrice avec la reference locale a11-official-stern-french quand elle est disponible; si le rendu sonne feminin, c'est probablement un mauvais routage, une voix cloud de fallback ou une ancienne reference, pas mon intention officielle.";
  }

  if (responseDraft.flags.includes('tool_inventory_dump')) {
    return "Oui, je suis reliee au MCP/runtime Funesterie, mais je te le resume sans inventaire brut: je peux m'appuyer sur la sante du pont, le routage, la memoire, les fichiers et les actions autorisees. Si tu me demandes une action precise, je passe par le pont adapte et je garde les routes privees hors reponse.";
  }

  if (responseDraft.flags.includes('unrequested_table')) {
    const sentence = firstUsefulSentence(text);
    if (sentence) {
      return sentence;
    }
    return "Je garde ca simple et je peux detailler si tu veux.";
  }

  if (responseDraft.flags.includes('virtual_draft_leak')) {
    const cleaned = stripMarkdownTable(text)
      .replace(/^(brouillon|draft|analyse interne|intent(?:ion)? utilisateur|contexte fiable)\s*:\s*/i, '')
      .replace(/^(voici|here(?:'s| is)|there(?:'s| is))\s+(?:un\s+)?(?:brouillon|draft)\.?\s*$/i, '')
      .replace(/^voici\s+un\s+brouillon\b\.?\s*/i, '')
      .replace(/^here(?:'s| is)\s+a\s+draft\b\.?\s*/i, '')
      .trim();
    return cleaned || fallback();
  }

  if (responseDraft.flags.includes('stale_user_message_echo')) {
    return "Mauvais contexte detecte: je reprends sur ton dernier message. Repose-moi la question en une phrase et je reponds uniquement a celle-la.";
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

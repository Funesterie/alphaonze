'use strict';

const A11_RESPONSE_DRAFT_CONTEXT = `
[A11/Funesterie response hygiene]
- Je reponds au dernier message visible, dans la langue naturelle de l'utilisateur.
- Les blocs contexte, outils, routes, memoire et modules servent de notes internes: je les transforme en reponse simple, je ne les recopie pas.
- Je ne produis pas de texte meta qui annonce un travail interne ou une reponse generique: je reponds directement au message.
- Si un fait n'est pas verifie dans le tour courant, je le garde prudent ou je propose une verification.
- Si l'utilisateur demande comment je vais ou s'il y a un souci, je ne pretends pas surveiller les logs en temps reel sans check lance.
- Pour les voix, images, fichiers, MCP et runtime, je parle de routage, permission ou surface disponible plutot que de nier l'existence du module.
- Les notes de travail internes restent invisibles: je ne les nomme pas a l'utilisateur sauf s'il demande explicitement une ebauche de texte.
- Si une reponse courte manque de matiere, je ne remplis pas avec de la meta-conversation: j'utilise seulement le contexte autorise du compte courant quand il aide vraiment.
`.trim();
const A11_OFFICIAL_VOICE_AUDIO_URL = '/api/tts/official/a11/audio';
const KAEN44_OFFICIAL_VOICE_AUDIO_URL = '/api/tts/official/kaen44/audio';

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

function looksLikeInternalReasoningLeak(text = '') {
  const normalized = normalizeText(text);
  const folded = foldText(normalized);
  if (!normalized) return false;
  if (/<\|(?:start|message|channel|end)\|>/i.test(normalized)) return true;
  if (/(?:analysis){2,}|(?:commentary){2,}/i.test(normalized)) return true;
  if (/\b(?:analysis|commentary|final)\b.{0,80}<\|/i.test(normalized)) return true;
  if (/\b(?:channel|role)\s*[:=]\s*(?:analysis|commentary|final)\b/i.test(normalized)) return true;
  const specialTokenCount = (normalized.match(/<\|(?:start|message|channel|end)\|>/gi) || []).length;
  if (specialTokenCount >= 2) return true;

  const metaPatterns = [
    /\bwe need to (?:answer|respond|produce|call|search|use)\b/i,
    /\bwe just answer\b/i,
    /\bthe user (?:wants|asks|said|typed|is asking)\b/i,
    /\brespond in (?:french|english|spanish)\b/i,
    /\bprovide short\b/i,
    /\bwe (?:respond|answer|should|need|can respond)\b/i,
    /\blet'?s produce (?:final|the final|a final)/i,
    /\bcurrent channel\b/i,
    /\bfinal answer\b/i,
  ];
  const hits = metaPatterns.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);
  const repeatedMeta = (normalized.match(/\b(?:the user wants|the user asks|the user is asking|we need|we respond|we should|we just answer|respond in french|provide short|analysis|commentary)\b/gi) || []).length;
  return hits >= 2
    || repeatedMeta >= 5
    || (hits >= 1 && folded.includes('analysis') && normalized.length > 80)
    || (hits >= 1 && repeatedMeta >= 2 && normalized.length > 240);
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
  if (/(allo|t es la|tu es la|vous etes la|quelqu un|reponds|réponds)/.test(folded)) return 'presence_check';
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
  if (looksLikeInternalReasoningLeak(text)) flags.push('internal_reasoning_leak');

  const intent = inferUserIntent(userMessage);
  const mustRewrite = flags.length > 0;
  const contextSummary = normalizeText(contextText).slice(0, 600);
  return {
    intent,
    flags,
    mustRewrite,
    finalShape: userAskedForStructuredFormat(userMessage) ? 'structured_if_useful' : 'natural_prose',
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

function repairOfficialVoiceListenLinks(text = '') {
  const input = normalizeText(text);
  if (!input) return input;
  const folded = foldText(input);
  if (!/(a11|kaen44|k44|voix officielle|a11-official-stern-french|kaen44-official-french-narrator|extrait de ma voix|belle voix)/.test(folded)) {
    return input;
  }

  if (/(kaen44|k44|kaen44-official-french-narrator)/.test(folded)) {
    let output = input.replace(
      /\[([^\]]*(?:Kaen44|K44|kaen44|k44|voix officielle|Voix officielle|voix de Kaen44|voix de K44)[^\]]*)\]\((?!\/api\/tts\/official\/kaen44\/audio\))[^)]*\)/g,
      `[$1](${KAEN44_OFFICIAL_VOICE_AUDIO_URL})`
    );
    if (!output.includes(KAEN44_OFFICIAL_VOICE_AUDIO_URL) && /(extrait de ma voix|kaen44-official-french-narrator)/i.test(input)) {
      output = `${output}\n\n[Écouter Kaen44 – voix officielle](${KAEN44_OFFICIAL_VOICE_AUDIO_URL})`;
    }
    return output;
  }

  let output = input.replace(
    /\[([^\]]*(?:A11|a11|voix officielle|Voix officielle|voix d['’]?A11)[^\]]*)\]\((?!\/api\/tts\/official\/a11\/audio\))[^)]*\)/g,
    `[$1](${A11_OFFICIAL_VOICE_AUDIO_URL})`
  );

  if (!output.includes(A11_OFFICIAL_VOICE_AUDIO_URL)) {
    output = output.replace(
      /\b(Écouter\s*A11\s*[–-]\s*voix officielle|Ecouter\s*A11\s*[–-]\s*voix officielle)\b/i,
      `[$1](${A11_OFFICIAL_VOICE_AUDIO_URL})`
    );
  }

  if (!output.includes(A11_OFFICIAL_VOICE_AUDIO_URL) && /(extrait de ma voix|a11-official-stern-french)/i.test(input)) {
    output = `${output}\n\n[Écouter A11 – voix officielle](${A11_OFFICIAL_VOICE_AUDIO_URL})`;
  }

  return output;
}

function rewriteA11ResponseFromVirtualDraft({ userMessage = '', assistantText = '', draft = null } = {}) {
  const text = normalizeText(assistantText);
  const responseDraft = draft || buildA11VirtualResponseDraft({ userMessage, assistantText: text });
  if (!responseDraft.mustRewrite) return text;
  const foldedUser = foldText(userMessage);
  const fallback = () => {
    if (/(allo|t es la|tu es la|vous etes la|quelqu un|reponds|réponds)/.test(foldedUser)) {
      return "Oui, je suis là. Je reprends normalement.";
    }
    if (/(ca va mieux|ça va mieux|mieux)/.test(foldedUser)) {
      return "Oui, mieux. La réponse précédente a dérapé côté technique, mais je reprends normalement.";
    }
    if (/(pour faire quoi|quoi faire|tu veux faire quoi)/.test(foldedUser)) {
      return "Rien de spécial: je répondais juste à ton dernier message, sans lancer d'action.";
    }
    if (/(salut|bonjour|coucou|ca va|ça va|comment tu vas)/.test(foldedUser)) {
      return 'Salut, oui, ça va. Et toi ?';
    }
    return "Je reprends sur ton dernier message. Dis-moi ce que tu veux faire et je réponds simplement.";
  };

  if (responseDraft.flags.includes('generic_context_placeholder') || responseDraft.flags.includes('english_language_drift')) {
    return fallback();
  }

  if (responseDraft.flags.includes('internal_reasoning_leak')) {
    if (/(allo|t es la|tu es la|vous etes la|quelqu un|reponds|réponds)/.test(foldedUser)) {
      return "Oui, je suis là. Je reprends normalement.";
    }
    if (/(ca va mieux|ça va mieux|mieux)/.test(foldedUser)) {
      return "Oui, mieux. La réponse précédente a laissé passer du texte technique, mais je reprends normalement.";
    }
    if (/(salut|bonjour|coucou|ca va|ça va|comment tu vas|tout va bien|utilisateurs?)/.test(foldedUser)) {
      return "Oui, je suis là. Le message précédent était une sortie technique qui n'aurait pas dû apparaître; je reprends normalement sur cette conversation.";
    }
    return fallback();
  }

  if (responseDraft.flags.includes('unverified_monitoring_claim')) {
    return "Je n'ai pas de vérification lancée dans ce tour. Si tu veux un vrai état, je vérifie le backend/MCP et je te rends le résultat.";
  }

  if (responseDraft.flags.includes('voice_capability_denial')) {
    return "Tu as raison de parler de voix: ma réponse texte est séparée du module TTS, mais la voix entendue passe bien par le backend Funesterie. Pour A11, la cible officielle est la référence WAV Djeff a11-official-stern-french via XTTS/RVC. Pour Kaen44, c'est le WAV familial kaen44-official-french-narrator via XTTS/RVC. Si tu entends Cartesia, ElevenLabs, Donna ou une voix hors persona, c'est un mauvais routage ou un fallback.";
  }

  if (responseDraft.flags.includes('tool_inventory_dump')) {
    return "Oui, je suis reliée au MCP/runtime Funesterie, mais je te le résume sans inventaire brut: je peux m'appuyer sur la santé du pont, le routage, la mémoire, les fichiers et les actions autorisées. Si tu me demandes une action précise, je passe par le pont adapté et je garde les routes privées hors réponse.";
  }

  if (responseDraft.flags.includes('unrequested_table')) {
    const sentence = firstUsefulSentence(text);
    if (sentence) {
      return sentence;
    }
    return "Je garde ça simple et je peux détailler si tu veux.";
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
    return "Mauvais contexte détecté: je reprends sur ton dernier message. Repose-moi la question en une phrase et je réponds uniquement à celle-là.";
  }

  return text;
}

function postProcessA11AssistantResponse({ text = '', userMessage = '', contextText = '' } = {}) {
  const draft = buildA11VirtualResponseDraft({ userMessage, assistantText: text, contextText });
  const rewrittenContent = rewriteA11ResponseFromVirtualDraft({ userMessage, assistantText: text, draft });
  const content = repairOfficialVoiceListenLinks(rewrittenContent);
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
  repairOfficialVoiceListenLinks,
  rewriteA11ResponseFromVirtualDraft,
  userAskedForStructuredFormat,
};

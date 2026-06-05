'use strict';

const DEFAULT_MAX_HISTORY_MESSAGES = Math.max(4, Number(process.env.A11_CHAT_CONTEXT_MAX_HISTORY_MESSAGES || 14) || 14);
const DEFAULT_MAX_CONTEXT_CHARS = Math.max(6000, Number(process.env.A11_CHAT_CONTEXT_MAX_CHARS || 22000) || 22000);
const DEFAULT_MAX_MESSAGE_CHARS = Math.max(1200, Number(process.env.A11_CHAT_CONTEXT_MAX_MESSAGE_CHARS || 7000) || 7000);

function normalizeContextText(value = '') {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function foldContextText(value = '') {
  return normalizeContextText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripHistoricalMediaMarkers(content = '') {
  return normalizeContextText(content)
    .replace(/\[image-data:data:image\/[^;]+;base64,[^\]]+\]/gi, '')
    .replace(/\[(?:image|video|file|audio):[^\]]+\]/gi, '')
    .replace(/\[(?:image|fichier|audio)-joint(?:e)?[^\]]*\]/gi, '')
    .replace(/\b(?:id|url|analyse|action-probable)=[^\s]+/gi, '')
    .replace(/Image rattachee a la conversation;?\s*/gi, '')
    .replace(/Fichier rattache a la conversation;?\s*/gi, '')
    .replace(/analyse-la avec la vision[^.?!]*(?:[.?!]|$)/gi, '')
    .replace(/analyse-le et decide quoi en faire avant de repondre\.?/gi, '')
    .replace(/^\s*(?:FILE|AUDIO|VIDEO|IMAGE)\s+[-_:].*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeJsonOrToolPayload(content = '') {
  const text = normalizeContextText(content);
  if (!text) return false;
  if (/^```(?:json|txt)?\s*[\[{]/i.test(text) && text.length > 800) return true;
  if (/^[\[{][\s\S]{800,}[\]}]$/.test(text)) {
    try {
      JSON.parse(text);
      return true;
    } catch (_) {
      return /"(?:messages|systemPrompt|tools|routes|payload|headers|token|secret|content)"\s*:/.test(text);
    }
  }
  return false;
}

function looksLikeInternalAssistantNoise(content = '') {
  const text = normalizeContextText(content);
  const folded = foldContextText(text);
  if (!text) return true;
  if (/<\|(?:start|message|channel|end)\|>/i.test(text)) return true;
  if (/(?:analysis){2,}|(?:commentary){2,}/i.test(text)) return true;
  if (/\b(?:channel|role)\s*[:=]\s*(?:analysis|commentary|final)\b/i.test(text)) return true;
  if (/^sure,?\s+here(?:'s| is)\s+(?:a\s+)?short reply to the last message\.?$/i.test(text)) return true;
  if (/^here(?:'s| is)\s+(?:a\s+)?short reply to the last message\.?$/i.test(text)) return true;
  if (/^voici\s+un\s+brouillon\.?$/i.test(folded)) return true;

  const metaHits = [
    /\bwe need to (?:answer|respond|produce|call|search|use)\b/i,
    /\bwe just answer\b/i,
    /\bwe (?:respond|answer|should|need|can respond)\b/i,
    /\bthe user (?:wants|asks|said|typed|is asking)\b/i,
    /\brespond in (?:french|english|spanish)\b/i,
    /\bprovide short\b/i,
    /\blet'?s produce (?:final|the final|a final)/i,
    /\bcurrent channel\b/i,
    /\bfinal answer\b/i,
  ].reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const repeatedMeta = (text.match(/\b(?:the user wants|the user asks|the user is asking|we need|we respond|we should|we just answer|respond in french|provide short|analysis|commentary)\b/gi) || []).length;
  if (metaHits >= 2 || repeatedMeta >= 4) return true;

  if (/Erreur lors de l'appel au chat A11\s*:/i.test(text) && text.length > 180) return true;
  if (/response HTML inattendue|serveur IA est surcharge|provider.*quota|fallback.*provider/i.test(text) && text.length > 240) return true;
  if (looksLikeJsonOrToolPayload(text)) return true;
  return false;
}

function cleanHistoricalUserContent(content = '') {
  const stripped = stripHistoricalMediaMarkers(content);
  if (looksLikeJsonOrToolPayload(stripped)) {
    return '[ancien payload technique retire]';
  }
  return stripped;
}

function cleanHistoricalAssistantContent(content = '') {
  const text = normalizeContextText(content);
  if (looksLikeInternalAssistantNoise(text)) return '';
  return stripHistoricalMediaMarkers(text)
    .replace(/^Je reprends proprement:\s*/i, '')
    .replace(/^La reponse precedente a laisse passer[\s\S]*?Repose-moi[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimContextMessage(content = '', maxChars = DEFAULT_MAX_MESSAGE_CHARS) {
  const text = normalizeContextText(content);
  if (text.length <= maxChars) return text;
  const headChars = Math.max(800, Math.floor(maxChars * 0.62));
  const tailChars = Math.max(600, maxChars - headChars - 80);
  return [
    text.slice(0, headChars).trimEnd(),
    '\n\n[contexte ancien compresse]\n\n',
    text.slice(-tailChars).trimStart(),
  ].join('').trim();
}

function resolveChatContextNoise({
  messages = [],
  latestUserMessage = '',
  allowSystem = false,
  maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES,
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  maxMessageChars = DEFAULT_MAX_MESSAGE_CHARS,
} = {}) {
  const raw = Array.isArray(messages) ? messages : [];
  const latest = normalizeContextText(latestUserMessage);
  const normalized = [];
  let dropped = 0;

  const latestUserIndex = (() => {
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      if (String(raw[index]?.role || '').trim().toLowerCase() === 'user') return index;
    }
    return -1;
  })();

  for (let index = 0; index < raw.length; index += 1) {
    const message = raw[index];
    const role = String(message?.role || '').trim().toLowerCase();
    if (role !== 'user' && role !== 'assistant' && !(allowSystem && role === 'system')) {
      dropped += 1;
      continue;
    }

    const original = normalizeContextText(message?.content);
    if (!original) {
      dropped += 1;
      continue;
    }

    const isLatestUser = role === 'user' && index === latestUserIndex;
    let content = original;
    if (role === 'assistant') {
      content = cleanHistoricalAssistantContent(original);
    } else if (role === 'user' && !isLatestUser) {
      content = cleanHistoricalUserContent(original);
    } else if (role === 'system') {
      content = trimContextMessage(original, Math.min(maxMessageChars, 4000));
    }

    content = trimContextMessage(content, maxMessageChars);
    if (!content) {
      dropped += 1;
      continue;
    }
    normalized.push({ role, content });
  }

  if (latest) {
    const last = normalized[normalized.length - 1];
    if (!last || last.role !== 'user' || normalizeContextText(last.content) !== latest) {
      normalized.push({ role: 'user', content: latest });
    }
  }

  const recent = normalized.slice(-Math.max(1, maxHistoryMessages));
  let usedChars = 0;
  const selected = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const contentLength = message.content.length;
    const remaining = maxContextChars - usedChars;
    if (remaining <= 0) {
      dropped += index + 1;
      break;
    }
    if (contentLength > remaining) {
      selected.unshift({
        ...message,
        content: trimContextMessage(message.content, Math.max(1200, remaining)),
      });
      dropped += index;
      break;
    }
    selected.unshift(message);
    usedChars += contentLength;
  }

  return {
    messages: selected,
    stats: {
      inputMessages: raw.length,
      outputMessages: selected.length,
      droppedMessages: Math.max(0, dropped + Math.max(0, normalized.length - recent.length)),
      maxHistoryMessages,
      maxContextChars,
    },
  };
}

module.exports = {
  cleanHistoricalAssistantContent,
  cleanHistoricalUserContent,
  foldContextText,
  looksLikeInternalAssistantNoise,
  normalizeContextText,
  resolveChatContextNoise,
  stripHistoricalMediaMarkers,
  trimContextMessage,
};

// semantic-memory-filter.cjs
// Keeps semantic memory for text/code only. Media payloads stay as artifacts/metadata.

const MEDIA_DATA_URL_RE = /^data:(?:audio|video|image|application)\/[a-z0-9.+-]+;base64,/i;
const LONG_BASE64_RE = /(?:[A-Za-z0-9+/]{512,}={0,2})/;
const MEDIA_LOCATOR_RE = /\b(?:https?:\/\/|file:\/\/|blob:|[a-z]:\\|\/)[^\s"'<>]+\.(?:wav|mp3|m4a|aac|ogg|opus|flac|mp4|mov|avi|webm|mkv|png|jpe?g|gif|webp|bmp|zip|bin)(?:[?#][^\s"'<>]*)?/i;
const MEDIA_KEY_RE = /\b(?:audioUrl|audio_url|videoUrl|video_url|imageUrl|image_url|mediaUrl|media_url|base64|mimeType|mime_type|transcriptRef|artifactRef|artifact_id)\b/i;

function normalizeSemanticMemoryText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function isLikelyJsonPayload(value) {
  const text = normalizeSemanticMemoryText(value);
  if (!text) return false;
  const first = text[0];
  const last = text[text.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) {
    return false;
  }

  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isLikelyMediaPayload(value) {
  const text = normalizeSemanticMemoryText(value);
  if (!text) return false;
  if (MEDIA_DATA_URL_RE.test(text)) return true;
  if (LONG_BASE64_RE.test(text)) return true;
  if (MEDIA_LOCATOR_RE.test(text)) return true;

  // If a JSON-like or tool payload leaks as plain text, keep it out of vectors/KG.
  if (MEDIA_KEY_RE.test(text) && /["'{\[]/.test(text)) {
    return true;
  }

  return false;
}

function isSemanticMemoryText(value, options = {}) {
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : 6000;
  const text = normalizeSemanticMemoryText(value);
  if (!text) return false;
  if (text.length > maxChars) return false;
  if (isLikelyJsonPayload(text)) return false;
  if (isLikelyMediaPayload(text)) return false;
  return true;
}

function shouldStoreSemanticExchange(userMessage, assistantMessage, options = {}) {
  const maxCombinedChars = Number.isFinite(options.maxCombinedChars) ? options.maxCombinedChars : 9000;
  const userText = normalizeSemanticMemoryText(userMessage);
  const assistantText = normalizeSemanticMemoryText(assistantMessage);
  if (!isSemanticMemoryText(userText, options)) return false;
  if (!isSemanticMemoryText(assistantText, options)) return false;
  return userText.length + assistantText.length <= maxCombinedChars;
}

module.exports = {
  normalizeSemanticMemoryText,
  isLikelyJsonPayload,
  isLikelyMediaPayload,
  isSemanticMemoryText,
  shouldStoreSemanticExchange,
};

// apps/server/src/tts/build-tts-readable-text.cjs
// Pipeline : normalisation + lexique pour TTS

const cleanTextForTTS = require('./clean-text-for-tts.cjs');
const normalizeTtsText = require('./normalize-tts-text.cjs');
const lexicon = require('./tts-lexicon.cjs');

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTtsReadableText(text) {
  let out = cleanTextForTTS(text);
  out = normalizeTtsText(out);
  for (const [key, val] of Object.entries(lexicon)) {
    const regex = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi');
    out = out.replace(regex, val);
  }
  out = out.replace(/\b(?:U R L|url|lien)\s+ce lien\b/gi, 'ce lien');
  out = out.replace(/\bune?\s+ce lien\b/gi, 'un lien');
  out = out.replace(/\s{2,}/g, ' ');
  return out;
}

module.exports = buildTtsReadableText;

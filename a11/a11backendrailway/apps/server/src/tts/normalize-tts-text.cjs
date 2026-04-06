// apps/server/src/tts/normalize-tts-text.cjs
// Normalisation Unicode, correction minimale de mots FR en ASCII, nettoyage de ponctuation

const ASCII_FRENCH_WORD_REPAIRS = new Map([
  ['executi', 'exécutée'],
  ['executee', 'exécutée'],
  ['executed', 'exécuté'],
  ['execution', 'exécution'],
  ['execute', 'exécute'],
  ['generee', 'générée'],
  ['stockee', 'stockée'],
  ['telechargee', 'téléchargée'],
  ['preparee', 'préparée'],
  ['prete', 'prête'],
]);

function normalizeTtsText(text) {
  if (!text) return '';
  let out = text.normalize('NFC');
  out = out.replace(/[“”]/g, '"');
  out = out.replace(/[‘’]/g, "'");
  for (const [rawWord, repairedWord] of ASCII_FRENCH_WORD_REPAIRS.entries()) {
    out = out.replace(new RegExp(`\\b${rawWord}\\b`, 'gi'), repairedWord);
  }
  out = out.replace(/\s+/g, ' ');
  out = out.replace(/\s+([,.;!?])/g, '$1');
  return out.trim();
}

module.exports = normalizeTtsText;

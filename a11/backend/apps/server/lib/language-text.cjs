'use strict';

const LANGUAGE_NAMES = {
  fr: 'français',
  en: 'English',
  es: 'español',
  it: 'italiano',
  de: 'Deutsch',
  ja: '日本語',
  zh: '中文',
};

function normalizeTextNfc(value = '', maxLength = 0) {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .normalize('NFC')
    .trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function normalizeOneLineNfc(value = '', fallback = '', maxLength = 160) {
  return normalizeTextNfc(value, maxLength).replace(/\s+/g, ' ') || fallback;
}

function foldTextForLookup(value = '') {
  return normalizeTextNfc(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-_/]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('fr-FR');
}

function scoreLanguage(text, folded, code, words, extraScore = 0) {
  let score = extraScore;
  for (const word of words) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(folded)) score += 1;
  }
  if (code === 'fr' && /[àâçéèêëîïôùûüÿœæ]/i.test(text)) score += 2;
  if (code === 'es' && /[áéíóúüñ¿¡]/i.test(text)) score += 2;
  if (code === 'it' && /[àèéìòù]/i.test(text)) score += 1;
  if (code === 'de' && /[äöüß]/i.test(text)) score += 2;
  return score;
}

function detectTextLanguage(value = '', fallback = 'fr') {
  const text = normalizeTextNfc(value, 6000);
  if (!text) return fallback;
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';

  const folded = foldTextForLookup(text);
  const scores = {
    fr: scoreLanguage(text, folded, 'fr', [
      'je', 'tu', 'nous', 'vous', 'une', 'des', 'avec', 'pour', 'dans', 'idee', 'voix',
      'chanson', 'scene', 'memoire', 'fichier', 'reference', 'reponds', 'francais',
    ]),
    en: scoreLanguage(text, folded, 'en', [
      'the', 'and', 'with', 'for', 'voice', 'song', 'scene', 'memory', 'file',
      'reference', 'please', 'write', 'make', 'create', 'english',
    ]),
    es: scoreLanguage(text, folded, 'es', [
      'que', 'para', 'con', 'una', 'voz', 'cancion', 'escena', 'memoria',
      'archivo', 'referencia', 'espanol',
    ]),
    it: scoreLanguage(text, folded, 'it', [
      'che', 'per', 'con', 'una', 'voce', 'canzone', 'scena', 'memoria',
      'file', 'riferimento', 'italiano',
    ]),
    de: scoreLanguage(text, folded, 'de', [
      'und', 'mit', 'fur', 'für', 'eine', 'stimme', 'lied', 'szene', 'speicher',
      'datei', 'referenz', 'deutsch',
    ]),
  };

  const winner = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .find(([, score]) => score > 0);
  return winner ? winner[0] : fallback;
}

function buildLanguageInstruction(language = 'fr') {
  const code = LANGUAGE_NAMES[language] ? language : 'fr';
  const map = {
    fr: "Réponds en français naturel. Préserve les accents, les apostrophes typographiques utiles, les noms propres et la ponctuation française.",
    en: 'Answer in natural English. Preserve names, punctuation, file titles and the user wording.',
    es: 'Responde en español natural. Conserva acentos, nombres propios, títulos de archivos y puntuación.',
    it: 'Rispondi in italiano naturale. Conserva accenti, nomi propri, titoli dei file e punteggiatura.',
    de: 'Antworte in natürlichem Deutsch. Erhalte Umlaute, Eigennamen, Dateititel und Zeichensetzung.',
    ja: '自然な日本語で答えてください。固有名詞、ファイル名、句読点を保ってください。',
    zh: '请用自然中文回答。保留专有名词、文件名和标点。',
  };
  return map[code];
}

function hasMojibake(value = '') {
  return /Ã|Â|â€|â€™|â€œ|â€�|â†|â”|�/.test(String(value || ''));
}

module.exports = {
  LANGUAGE_NAMES,
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  detectTextLanguage,
  buildLanguageInstruction,
  hasMojibake,
};

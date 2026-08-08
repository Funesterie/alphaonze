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

const SUPPORTED_LANGUAGE_CODES = Object.freeze(Object.keys(LANGUAGE_NAMES));

const LANGUAGE_ALIASES = Object.freeze({
  fra: 'fr',
  fre: 'fr',
  french: 'fr',
  francais: 'fr',
  français: 'fr',
  fr_fr: 'fr',
  eng: 'en',
  english: 'en',
  anglais: 'en',
  en_us: 'en',
  en_gb: 'en',
  esp: 'es',
  spa: 'es',
  spanish: 'es',
  espagnol: 'es',
  español: 'es',
  es_es: 'es',
  ita: 'it',
  italian: 'it',
  italien: 'it',
  italiano: 'it',
  it_it: 'it',
  deu: 'de',
  ger: 'de',
  german: 'de',
  allemand: 'de',
  deutsch: 'de',
  de_de: 'de',
  japanese: 'ja',
  japonais: 'ja',
  nihongo: 'ja',
  ja_jp: 'ja',
  chinese: 'zh',
  chinois: 'zh',
  mandarin: 'zh',
  zh_cn: 'zh',
  zh_tw: 'zh',
});

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

function normalizeLanguageCode(value = '', fallback = 'fr') {
  const fallbackText = String(fallback || '').trim().toLowerCase();
  const normalizedFallback = fallbackText
    ? (SUPPORTED_LANGUAGE_CODES.includes(fallbackText) ? fallbackText : 'fr')
    : '';
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'auto') return normalizedFallback;

  const compact = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  if (SUPPORTED_LANGUAGE_CODES.includes(compact)) return compact;
  if (LANGUAGE_ALIASES[compact]) return LANGUAGE_ALIASES[compact];

  const first = compact.split(/[_,;]/)[0];
  if (SUPPORTED_LANGUAGE_CODES.includes(first)) return first;
  if (LANGUAGE_ALIASES[first]) return LANGUAGE_ALIASES[first];

  return normalizedFallback;
}

function parseAcceptLanguageHeader(value = '') {
  const first = String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((left, right) => {
      const readQ = (part) => {
        const match = /;\s*q=([0-9.]+)/i.exec(part);
        const q = match ? Number(match[1]) : 1;
        return Number.isFinite(q) ? q : 1;
      };
      return readQ(right) - readQ(left);
    })[0] || '';
  return first.split(';')[0] || '';
}

function resolveUserLanguage(source = {}, fallback = 'fr') {
  const normalizedFallback = normalizeLanguageCode(fallback, 'fr');
  const req = source && source.headers ? source : null;
  const candidates = [
    source?.language,
    source?.locale,
    source?.accountLanguage,
    source?.account_language,
    source?.preferredLanguage,
    source?.preferred_language,
    source?.profile?.language,
    source?.profile?.locale,
    source?.user?.language,
    source?.user?.locale,
    source?.user?.accountLanguage,
    source?.user?.account_language,
    source?.user?.preferredLanguage,
    source?.user?.preferred_language,
    source?.body?.language,
    source?.body?.locale,
    source?.query?.language,
    source?.query?.lang,
    req?.headers?.['x-funesterie-language'],
    req?.headers?.['x-a11-language'],
    req?.headers?.['x-user-language'],
    parseAcceptLanguageHeader(req?.headers?.['accept-language']),
  ];

  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw || raw.toLowerCase() === 'auto') continue;
    const code = normalizeLanguageCode(raw, '');
    if (code) return code;
  }

  return normalizedFallback;
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

// Un seul ideogramme ne fait pas une langue. La version precedente retournait 'zh'
// des le premier caractere Han rencontre, sans seuil ni score: il suffisait qu'un
// modele local derape sur un mot, ou qu'un titre de fichier contienne un ideogramme,
// pour que 6000 caracteres de francais soient classes chinois -- et le contrat de
// langue ordonnait alors de repondre en chinois. On exige desormais une part reelle.
const PART_CJK_MINIMALE = 0.1;
const CARACTERES_CJK_MINIMUM = 4;

function partDeScript(text, motif) {
  const total = text.replace(/\s+/g, '').length;
  if (!total) return { part: 0, compte: 0 };
  const compte = (text.match(motif) || []).length;
  return { part: compte / total, compte };
}

function detectTextLanguage(value = '', fallback = 'fr') {
  const text = normalizeTextNfc(value, 6000);
  if (!text) return fallback;

  const kana = partDeScript(text, /[\u3040-\u30ff]/g);
  if (kana.compte >= CARACTERES_CJK_MINIMUM && kana.part >= PART_CJK_MINIMALE) return 'ja';
  const han = partDeScript(text, /[\u4e00-\u9fff]/g);
  if (han.compte >= CARACTERES_CJK_MINIMUM && han.part >= PART_CJK_MINIMALE) return 'zh';

  const folded = foldTextForLookup(text);
  const scores = {
    fr: scoreLanguage(text, folded, 'fr', [
      'je', 'tu', 'nous', 'vous', 'une', 'des', 'avec', 'pour', 'dans', 'idee', 'voix',
      'chanson', 'scene', 'memoire', 'fichier', 'reference', 'reponds', 'francais',
      'salut', 'bonjour', 'ca', 'quoi', 'faire', 'fais', 'peux', 'marche', 'probleme',
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
  const code = normalizeLanguageCode(language, 'fr');
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

function buildLanguageContract(language = 'fr') {
  const code = normalizeLanguageCode(language, 'fr');
  const name = LANGUAGE_NAMES[code] || LANGUAGE_NAMES.fr;
  const map = {
    fr: "Langue canonique du compte: français. Tout texte visible doit rester en français: réponses LLM, ASCII/Zen, messages techniques, erreurs lisibles, contrats, privacy/conditions et détails de voix. Ne traduis pas les noms propres, commandes, routes, clés de configuration, extraits de code ou titres de fichiers.",
    en: 'Canonical account language: English. Keep all visible text in English: LLM replies, ASCII/Zen labels, readable technical messages, contracts, privacy/terms and voice details. Do not translate names, commands, routes, config keys, code snippets or file titles.',
    es: 'Idioma canónico de la cuenta: español. Mantén todo texto visible en español: respuestas LLM, etiquetas ASCII/Zen, mensajes técnicos legibles, contratos, privacidad/condiciones y detalles de voz. No traduzcas nombres, comandos, rutas, claves de configuración, fragmentos de código ni títulos de archivos.',
    it: 'Lingua canonica dell’account: italiano. Mantieni tutto il testo visibile in italiano: risposte LLM, etichette ASCII/Zen, messaggi tecnici leggibili, contratti, privacy/termini e dettagli vocali. Non tradurre nomi, comandi, route, chiavi di configurazione, frammenti di codice o titoli dei file.',
    de: 'Kanonische Kontosprache: Deutsch. Halte alle sichtbaren Texte auf Deutsch: LLM-Antworten, ASCII/Zen-Labels, lesbare technische Meldungen, Verträge, Datenschutz/AGB und Stimmdetails. Übersetze keine Namen, Befehle, Routen, Konfigurationsschlüssel, Codeausschnitte oder Dateititel.',
    ja: 'アカウントの標準言語: 日本語。LLM応答、ASCII/Zenラベル、技術メッセージ、契約、プライバシー/規約、音声詳細など、表示される文章は日本語にしてください。固有名詞、コマンド、ルート、設定キー、コード、ファイル名は翻訳しないでください。',
    zh: '账户标准语言：中文。所有可见文本都应使用中文：LLM 回复、ASCII/Zen 标签、可读技术消息、合同、隐私/条款和语音细节。不要翻译专有名词、命令、路由、配置键、代码片段或文件标题。',
  };
  return map[code] || `Canonical account language: ${name}. Keep all visible text in that language.`;
}

function hasMojibake(value = '') {
  return /Ã|Â|â€|â€™|â€œ|â€�|â†|â”|�/.test(String(value || ''));
}

module.exports = {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGE_CODES,
  normalizeTextNfc,
  normalizeOneLineNfc,
  foldTextForLookup,
  normalizeLanguageCode,
  resolveUserLanguage,
  detectTextLanguage,
  buildLanguageInstruction,
  buildLanguageContract,
  hasMojibake,
};

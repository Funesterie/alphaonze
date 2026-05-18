export type FunesterieLanguageCode = "fr" | "en" | "es" | "it" | "de" | "ja" | "zh";

export function toUnicodeText(value: unknown, maxLength = 0): string {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .normalize("NFC")
    .trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

export function toUnicodeLine(value: unknown, fallback = "", maxLength = 160): string {
  return toUnicodeText(value, maxLength).replace(/\s+/g, " ") || fallback;
}

export function foldForLookup(value: unknown): string {
  return toUnicodeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

export function detectTextLanguage(value: unknown, fallback: FunesterieLanguageCode = "fr"): FunesterieLanguageCode {
  const text = toUnicodeText(value, 6000);
  if (!text) return fallback;
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";

  const folded = foldForLookup(text);
  const scores: Record<FunesterieLanguageCode, number> = {
    fr: scoreWords(folded, ["je", "tu", "nous", "vous", "une", "avec", "pour", "idee", "voix", "chanson", "scene", "memoire"]) + (/[àâçéèêëîïôùûüÿœæ]/i.test(text) ? 2 : 0),
    en: scoreWords(folded, ["the", "and", "with", "for", "voice", "song", "scene", "memory", "file", "please"]),
    es: scoreWords(folded, ["que", "para", "con", "una", "voz", "cancion", "escena", "memoria"]) + (/[áéíóúüñ¿¡]/i.test(text) ? 2 : 0),
    it: scoreWords(folded, ["che", "per", "con", "una", "voce", "canzone", "scena", "memoria"]) + (/[àèéìòù]/i.test(text) ? 1 : 0),
    de: scoreWords(folded, ["und", "mit", "fur", "eine", "stimme", "lied", "szene", "speicher"]) + (/[äöüß]/i.test(text) ? 2 : 0),
    ja: 0,
    zh: 0,
  };

  const winner = (Object.entries(scores) as Array<[FunesterieLanguageCode, number]>)
    .sort((a, b) => b[1] - a[1])
    .find(([, score]) => score > 0);
  return winner?.[0] || fallback;
}

function scoreWords(text: string, words: string[]): number {
  return words.reduce((score, word) => (
    new RegExp(`\\b${word}\\b`, "i").test(text) ? score + 1 : score
  ), 0);
}

export function containsMojibake(value: unknown): boolean {
  return /Ã|Â|â€|â€™|â€œ|â€�|â†|â”|�/.test(String(value ?? ""));
}

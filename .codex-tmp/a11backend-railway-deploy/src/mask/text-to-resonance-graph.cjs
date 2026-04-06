// text-to-resonance-graph.cjs
// Analyse hiérarchique d'un texte en graph de résonance simple

/**
 * Retourne le type de caractère (lettre, chiffre, ponctuation, espace, autre)
 */
function charType(c) {
  if (/[a-zA-Zàâçéèêëîïôûùüÿñæœ]/i.test(c)) return 'letter';
  if (/[0-9]/.test(c)) return 'digit';
  if (/\s/.test(c)) return 'space';
  if (/[.,;:!?()"'«»\-]/.test(c)) return 'punct';
  return 'other';
}

/**
 * Analyse un texte et retourne un graphe de résonance hiérarchique (chars, words, sentences, message)
 * @param {string} text
 * @returns {object}
 */
function textToResonanceGraph(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  // 1. Caractères
  const chars = Array.from(text).map((char, i) => {
    const ascii = char.charCodeAt(0);
    return {
      char,
      ascii,
      binary: ascii.toString(2).padStart(8, '0'),
      index: i,
      type: charType(char),
      power: ascii / 255 // simple normalisation
    };
  });
  // 2. Mots
  const wordRegex = /[\wàâçéèêëîïôûùüÿñæœ'-]+/gi;
  const words = [];
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    const w = match[0];
    const start = match.index;
    const end = start + w.length - 1;
    const asciiSum = Array.from(w).reduce((sum, c) => sum + c.charCodeAt(0), 0);
    words.push({
      word: w,
      length: w.length,
      ascii_sum: asciiSum,
      power: asciiSum / (w.length * 255),
      start,
      end
    });
  }
  // 3. Phrases (découpage naïf)
  const sentenceRegex = /[^.!?]+[.!?]?/g;
  const sentences = [];
  let sMatch;
  while ((sMatch = sentenceRegex.exec(text)) !== null) {
    const s = sMatch[0].trim();
    if (!s) continue;
    const sWords = [];
    let wMatch;
    wordRegex.lastIndex = 0;
    while ((wMatch = wordRegex.exec(s)) !== null) {
      sWords.push(wMatch[0]);
    }
    sentences.push({
      sentence: s,
      length: s.length,
      word_count: sWords.length,
      words: sWords
    });
  }
  // 4. Message global
  const asciiPower = chars.reduce((sum, c) => sum + c.power, 0) / chars.length;
  const binaryDensity = chars.filter(c => c.binary.includes('1')).length / (chars.length * 8);
  return {
    chars,
    words,
    sentences,
    message: {
      ascii_power: Number(asciiPower.toFixed(3)),
      binary_density: Number(binaryDensity.toFixed(3)),
      length: text.length,
      word_count: words.length,
      sentence_count: sentences.length
    }
  };
}

module.exports = textToResonanceGraph;

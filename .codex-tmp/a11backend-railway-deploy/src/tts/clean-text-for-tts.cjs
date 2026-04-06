// clean-text-for-tts.cjs
// Nettoie un texte pour TTS : remplace les liens et suites de caractères inutiles

/**
 * Nettoie un texte pour éviter que le TTS lise les liens et suites de hash/ID
 * @param {string} text
 * @returns {string}
 */
function cleanTextForTTS(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, alt) => {
    const label = String(alt || '').trim();
    return label || 'image';
  });
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label) => String(label || '').trim() || 'ce lien');
  out = out.replace(/```[\s\S]*?```/g, 'bloc de code');
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'cette adresse email');
  out = out.replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, 'ce lien');
  out = out.replace(/\b[A-Za-z]:\\[^\s]+/g, 'ce chemin de fichier');
  out = out.replace(/(^|[\s(])\/(?!\/)[^\s)]+/g, '$1ce chemin de fichier');
  out = out.replace(/\b[a-f0-9]{12,}\b/gi, 'cet identifiant');
  out = out.replace(/\b(?=\w*[a-zA-Z])(?=\w*\d)[a-zA-Z0-9_-]{8,}\b/g, 'cet identifiant');
  out = out.replace(/_+/g, ' ');
  out = out.replace(/\[(lien|email|identifiant|chemin)\]/gi, (_match, label) => `ce ${String(label || '').trim()}`);
  out = out.replace(/\s{2,}/g, ' ');
  return out.trim();
}

module.exports = cleanTextForTTS;

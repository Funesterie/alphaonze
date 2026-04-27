// clean-text-for-tts.cjs
// Nettoie un texte pour TTS : supprime le Markdown et les caractères non-prononçables

/**
 * Nettoie un texte avant envoi au TTS.
 * Supprime les marqueurs Markdown (astérisques, dièses, tirets de liste, etc.)
 * pour éviter que Piper prononce "astérisque astérisque" ou "dièse dièse".
 * @param {string} text
 * @returns {string}
 */
function cleanTextForTTS(text) {
  if (typeof text !== 'string') return '';
  let out = text;

  // Images Markdown → label ou "image"
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, alt) => {
    const label = String(alt || '').trim();
    return label || 'image';
  });

  // Liens Markdown → texte du lien
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_match, label) => String(label || '').trim() || 'ce lien');

  // Blocs de code → "bloc de code"
  out = out.replace(/```[\s\S]*?```/g, 'bloc de code');
  out = out.replace(/`([^`]+)`/g, '$1');

  // Gras/italique Markdown — supprimer les astérisques, garder le texte
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');  // ***texte***
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');       // **texte**
  out = out.replace(/\*([^*\n]+)\*/g, '$1');          // *texte*

  // Astérisques de liste en début de ligne
  out = out.replace(/^\s*\*\s+/gm, '');

  // Tout astérisque restant
  out = out.replace(/\*/g, '');

  // Tirets de liste Markdown en début de ligne
  out = out.replace(/^\s*[-–—]\s+/gm, '');

  // Titres Markdown (#, ##, ###)
  out = out.replace(/^#{1,6}\s+/gm, '');

  // Emails
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'cette adresse email');

  // URLs
  out = out.replace(/https?:\/\/[^\s)>]+/gi, 'ce lien');

  // Chemins Windows
  out = out.replace(/\b[A-Za-z]:\\[^\s]+/g, 'ce chemin de fichier');
  out = out.replace(/(^|[\s(])\/(?!\/)[^\s)]+/g, '$1ce chemin de fichier');

  // Hashes/IDs longs
  out = out.replace(/\b[a-f0-9]{12,}\b/gi, 'cet identifiant');
  out = out.replace(/\b(?=\w*[a-zA-Z])(?=\w*\d)[a-zA-Z0-9_-]{8,}\b/g, 'cet identifiant');

  // Underscores → espace
  out = out.replace(/_+/g, ' ');

  // Crochets résiduels
  out = out.replace(/\[(lien|email|identifiant|chemin)\]/gi, (_match, label) => `ce ${String(label || '').trim()}`);

  // Espaces multiples
  out = out.replace(/\s{2,}/g, ' ');

  return out.trim();
}

module.exports = cleanTextForTTS;

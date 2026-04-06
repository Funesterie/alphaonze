// try-build-mask-from-text.cjs
// V1: ne gère qu'un seul pattern utile (tri images)

/**
 * Essaie de parser un message utilisateur pour générer un MASK V1 (filesystem.sort_images)
 * @param {string} message
 * @returns {object|null} MASK ou null si non reconnu
 */
function tryBuildMaskFromText(message) {
  if (typeof message !== 'string') return null;
  const raw = message.trim().toLowerCase();

  // V1: détecte "trie les png de ce dossier par date"
  const triRegex = /trie(?:r|z)?\s+les?\s+([a-z0-9]+)s?\s+(?:de\s+ce\s+dossier|du\s+dossier|dans\s+ce\s+dossier|dans\s+le\s+dossier)?\s*(par\s+(date|nom|taille))?/i;
  const match = triRegex.exec(raw);
  if (!match) return null;

  const ext = match[1] || 'png';
  let sortBy = 'name';
  if (match[3]) {
    if (match[3].includes('date')) sortBy = 'date';
    else if (match[3].includes('taille')) sortBy = 'size';
    else if (match[3].includes('nom')) sortBy = 'name';
  }

  return {
    version: 'mask-1',
    intent: 'code.python.generate',
    task: {
      domain: 'filesystem',
      action: 'sort_images'
    },
    compiler: {
      target: 'python',
      version: '1.0'
    },
    inputs: {
      path: '.',
      extensions: [ext.replace('.', '')]
    },
    options: {
      sort_by: sortBy,
      recursive: false
    },
    constraints: {
      safe_mode: true,
      no_delete: true
    },
    raw: message
  };
}

module.exports = tryBuildMaskFromText;

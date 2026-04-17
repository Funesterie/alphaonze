function normalizeMessageForIntent(message) {
  return String(message || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizeWebImageSubject(candidate) {
  let value = String(candidate || '')
    .replace(/[?.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return null;

  value = value
    .replace(/^(?:moi|me)\s+/i, '')
    .replace(/^(?:une?|des)\s+(?:image|photo|illustration|dessin|portrait)\s+(?:de|du|des|d['’])\s*/i, '')
    .replace(/^(?:image|photo|illustration|dessin|portrait)\s+(?:de|du|des|d['’])\s*/i, '')
    .trim();

  if (!value) return null;
  if (/^(?:sur|depuis)\s+(?:le\s+)?(?:web|internet)$/i.test(value)) return null;
  if (/^(?:chercher|cherche|trouver|trouve|montrer|montre|afficher|affiche)\s+une?\s+image(?:\s+sur\s+(?:le\s+)?(?:web|internet))?$/i.test(value)) {
    return null;
  }

  return value;
}

// Détection d'intention pour génération d'image (FR/EN)
function detectImageIntent(message) {
  if (!message || typeof message !== 'string') return false;

  const normalized = normalizeMessageForIntent(message);
  if (!normalized) return false;

  const hasCreationVerb = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|produire|prepare|preparer|generate|create|draw|make|produce|render)\b/i.test(normalized);
  const discussesImageOutput = /\b(image|illustration|dessin|photo|visuel|portrait|art|generateur|moteur)\b/i.test(normalized);
  const troubleshootingLike = /\b(explique|expliquer|pourquoi|probleme|probleme|probl[eè]me|bug|erreur|souci|conforme|incorrect|fonctionne|marche)\b/i.test(normalized);
  if (discussesImageOutput && troubleshootingLike && !hasCreationVerb) {
    return false;
  }

  const patterns = [
    /\b(genere|generer|generation|generee|generee|genere-moi|cree|creer|dessine|dessiner|fais|faire|fabrique|produis|produire|prepare|preparer)\b.*\b(image|illustration|dessin|photo|visuel|visu|art)\b/i,
    /\b(generate|create|draw|make|produce)\b.*\b(image|illustration|drawing|picture|photo|visual|art)\b/i,
    /\b(genere|cree|dessine|fabrique|produis|prepare)\s+(moi\s+)?(une\s+)?image\b/i,
    /\b(genere|cree|dessine|fabrique|produis|prepare)\s+(moi\s+)?(un\s+|une\s+)?(portrait|visuel|dessin|illustration|photo)\b/i,
  ];

  if (patterns.some((re) => re.test(normalized))) {
    return true;
  }

  const hasVisualWord = /\b(image|illustration|dessin|photo|visuel|portrait|art)\b/.test(normalized);
  return hasVisualWord && hasCreationVerb;
}

// Détection "montre-moi une image de X" (image réelle web)
function detectWebImageIntent(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = normalizeMessageForIntent(message);
  const hasSearchVerb = /\b(montre|montrer|affiche|afficher|cherche|chercher|trouve|trouver|show|find|search)\b/.test(normalized);
  const hasCreationVerb = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare|generate|create|draw|make|produce|render)\b/.test(normalized);
  if (!hasSearchVerb || hasCreationVerb) return false;
  return Boolean(extractWebImageSubject(message));
}

function extractWebImageSubject(message) {
  if (!message || typeof message !== 'string') return null;

  const patterns = [
    /montre(?:-|\s)?moi\s+(?:une?|des)?\s*(?:image|photo|illustration|dessin|portrait)\s+de\s+([^\?\.\!]+)/i,
    /(?:^|.*?\b)(?:tu peux\s+|peux[-\s]?tu\s+)?(?:me\s+)?(?:montrer|montre|afficher|affiche|fais voir|chercher|cherche|trouver|trouve)\s+([^\?\.\!]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    const candidate = sanitizeWebImageSubject(match?.[1]);
    if (candidate) return candidate;
  }

  return null;
}

function detectVideoIntent(message) {
  if (!message || typeof message !== 'string') return false;

  const normalized = normalizeMessageForIntent(message);
  if (!normalized) return false;

  const hasCreationVerb = /\b(genere|generer|cree|creer|fais|faire|fabrique|produis|prepare|generate|create|make|render)\b/i.test(normalized);
  const hasVideoWord = /\b(video|animation|anime|animee|animees|gif|mp4|clip|sequence|frames)\b/i.test(normalized);
  const troubleshootingLike = /\b(explique|expliquer|pourquoi|probleme|bug|erreur|souci|fonctionne|marche)\b/i.test(normalized);

  if (hasVideoWord && troubleshootingLike && !hasCreationVerb) {
    return false;
  }

  const patterns = [
    /\b(genere|generer|cree|creer|fais|faire|fabrique|produis|prepare)\b.*\b(video|animation|gif|mp4|clip)\b/i,
    /\b(generate|create|make|render)\b.*\b(video|animation|gif|mp4|clip)\b/i,
    /\b(video|animation|gif|mp4|clip)\b.*\b(de|du|des|d)\b/i,
  ];

  if (patterns.some((re) => re.test(normalized))) {
    return true;
  }

  return hasCreationVerb && hasVideoWord;
}

module.exports = { detectImageIntent, detectVideoIntent, detectWebImageIntent, extractWebImageSubject };

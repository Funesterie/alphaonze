const { normalizeIntentType } = require('./semantic/semantic-utils.cjs');

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function toUniqueStrings(values = []) {
  return [...new Set(
    values
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

function splitCsvValues(value) {
  return toUniqueStrings(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

const SIMPLE_COLOR_WORDS = [
  'rouge',
  'bleu',
  'vert',
  'jaune',
  'violet',
  'orange',
  'rose',
  'blanc',
  'noir',
  'marron',
  'gris',
  'doré',
  'dorée',
  'argent',
  'argenté',
  'argentée',
];

function extractSimplePalette(sourceText = '') {
  const text = String(sourceText || '').trim().toLowerCase();
  if (!text) return [];
  return toUniqueStrings(
    SIMPLE_COLOR_WORDS.filter((entry) => new RegExp(`\\b${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  );
}

function extractSearchQueryFromText(sourceText) {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  const patterns = [
    /\bimage\s+de\s+(.+)$/i,
    /^(?:montre(?:-|\s)?moi|affiche|cherche|trouve|show me|find)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (!match) continue;
    return String(match[1] || '')
      .replace(/^(?:une?|des)\s+/i, '')
      .replace(/[?.!]\s*$/, '')
      .trim();
  }

  return raw;
}

function getWazaaIntent(wazaa) {
  return normalizeIntentType(
    wazaa?.intent?.type || wazaa?.intents?.[0]?.type || 'chat.reply',
    'chat.reply'
  );
}

function getEntityValue(wazaa, role) {
  const entry = toList(wazaa?.entities).find((item) => String(item?.role || '').trim() === role);
  return String(entry?.value || '').trim();
}

function getSourceText(wazaa) {
  return String(
    wazaa?.meta?.sourceText
    || wazaa?.meta?.translatedText
    || ''
  ).trim();
}

function shouldPreferSemanticPrompt(wazaa) {
  return Boolean(
    wazaa?.meta?.llmEnriched === true
    || String(wazaa?.meta?.promptText || '').trim()
    || String(wazaa?.meta?.translatedText || '').trim()
  );
}

function sanitizeImageSubjectCandidate(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/^(?:un|une|des|du|de la|de l['’]?|d['’]|le|la|les)\s+/i, '');
  if (!normalized) return '';
  if (/\b(?:image\s+of|generate|g[eé]n[eè]re|show me|montre(?:-|\s)?moi|dessine|draw|create|cr[eée]e|je veux|i want)\b/i.test(normalized)) {
    return '';
  }
  if (
    /^(?:d['’]?(?:un|une)?|de|du|des|de\s+la|de\s+l['’]|la|le|les|un|une)$/i.test(normalized)
    || /^(?:d['’](?:un|une)|de\s+la|de\s+l['’])\s*$/i.test(normalized)
  ) {
    return '';
  }
  if (/^(?:one|a|an|the|un|une|des|du|de|la|le|les)$/i.test(normalized)) {
    return '';
  }
  return normalized;
}

function extractFallbackSubjectFromSourceText(sourceText = '') {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  return sanitizeImageSubjectCandidate(
    raw
      .replace(/^(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+/i, '')
      .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche)\s+(?:moi\s+)?/i, '')
      .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait)\s+(?:de|du|de la|de l['’]?|d['’])?\s*/i, '')
      .replace(/\b(?:avec|dans|sur|au milieu de|au bord de|sous|portant|tenant|sortant|sorti|sortie)\b.*$/i, '')
      .trim()
  );
}

function stripPaletteSuffixFromSubject(value = '', palette = []) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return raw;
  const paletteSet = new Set((Array.isArray(palette) ? palette : []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean));
  if (!paletteSet.size) return raw;

  while (tokens.length > 1 && paletteSet.has(String(tokens[tokens.length - 1] || '').trim().toLowerCase())) {
    tokens.pop();
  }
  return tokens.join(' ').trim() || raw;
}

function buildImageGenerateMask(wazaa, sourceText) {
  const promptText = String(wazaa?.meta?.promptText || wazaa?.meta?.translatedText || '').trim();
  const subject = sanitizeImageSubjectCandidate(getEntityValue(wazaa, 'subject'))
    || extractFallbackSubjectFromSourceText(promptText || sourceText)
    || promptText
    || sourceText;
  const environment = getEntityValue(wazaa, 'environment');
  const styleEntity = getEntityValue(wazaa, 'style');
  const attribute = getEntityValue(wazaa, 'attribute');
  const llmColors = Array.isArray(wazaa?.meta?.llmColors) ? wazaa.meta.llmColors : [];
  const palette = toUniqueStrings([
    ...llmColors,
    ...extractSimplePalette(sourceText),
    ...splitCsvValues(attribute),
  ]);
  const normalizedSubject = sanitizeImageSubjectCandidate(stripPaletteSuffixFromSubject(subject, palette));
  const style = toUniqueStrings([
    styleEntity,
    'haute qualité',
  ]);

  return {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-fr', version: '1.0' },
    inputs: {
      subject: normalizedSubject ? [normalizedSubject] : [],
      environment: environment ? [environment] : [],
      style,
      composition: [],
      lighting: [],
      palette,
    },
    options: {
      width: 768,
      height: 768,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    meta: {
      ...(wazaa?.meta && typeof wazaa.meta === 'object' ? wazaa.meta : {}),
      promptCompiler: 'a11-fr-minimal',
      canonicalMaskProducer: 'text-to-wazaa -> wazaa-to-mask',
      promptSeedText: promptText || sourceText,
      promptText: promptText || sourceText,
    },
    raw: sourceText,
  };
}

function buildWebImageSearchMask(wazaa, sourceText) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const query = extractSearchQueryFromText(sourceText)
    || getEntityValue(wazaa, 'subject')
    || translatedText
    || sourceText;
  return {
    version: 'mask-1',
    intent: 'web.image.search',
    task: { domain: 'web', action: 'image.search' },
    compiler: { target: 'duckduckgo-image-search', version: '1.0' },
    inputs: {
      query,
    },
    options: {},
    constraints: {
      safe_mode: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function buildWebSearchMask(wazaa, sourceText) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const query = translatedText || getEntityValue(wazaa, 'subject') || sourceText;
  return {
    version: 'mask-1',
    intent: 'web.search',
    task: { domain: 'web', action: 'search' },
    compiler: { target: 'web-search', version: '1.0' },
    inputs: {
      query,
    },
    options: {},
    constraints: {
      safe_mode: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function buildFilesystemSortImagesMask(sourceText) {
  const raw = String(sourceText || '').trim();
  const normalized = raw.toLowerCase();
  const triRegex = /trie(?:r|z)?\s+les?\s+([a-z0-9]+)s?\s+(?:de\s+ce\s+dossier|du\s+dossier|dans\s+ce\s+dossier|dans\s+le\s+dossier)?\s*(par\s+(date|nom|taille))?/i;
  const match = triRegex.exec(normalized);
  if (!match) return null;

  const ext = String(match[1] || 'png').replace(/^\./, '');
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
      action: 'sort_images',
    },
    compiler: {
      target: 'python',
      version: '1.0',
    },
    inputs: {
      path: '.',
      extensions: [ext],
    },
    options: {
      sort_by: sortBy,
      recursive: false,
    },
    constraints: {
      safe_mode: true,
      no_delete: true,
    },
    ambiguities: [],
    raw: raw,
  };
}

function buildGenericCodeMask(sourceText, wazaa) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const prompt = translatedText || sourceText;
  return {
    version: 'mask-1',
    intent: 'code.python.generate',
    task: {
      domain: 'python',
      action: 'generate',
    },
    compiler: {
      target: 'python',
      version: '1.0',
    },
    inputs: {
      prompt,
    },
    options: {
      style: 'script',
    },
    constraints: {
      safe_mode: true,
      no_delete: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function buildCodePythonMask(wazaa, sourceText) {
  return buildFilesystemSortImagesMask(sourceText) || buildGenericCodeMask(sourceText, wazaa);
}

function buildChatReplyMask(wazaa, sourceText) {
  return {
    version: 'mask-1',
    intent: 'chat.reply',
    task: { domain: 'chat', action: 'reply' },
    compiler: { target: 'chat-response', version: '1.0' },
    inputs: {
      message: sourceText,
    },
    options: {},
    constraints: {},
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function wazaaToMask(wazaa, opts = {}) {
  if (!isObject(wazaa)) return null;

  const intent = normalizeIntentType(opts.intentType || getWazaaIntent(wazaa), 'chat.reply');
  const sourceText = String(opts.sourceText || getSourceText(wazaa)).trim();

  if (intent === 'image.generate') return buildImageGenerateMask(wazaa, sourceText);
  if (intent === 'web.image.search') return buildWebImageSearchMask(wazaa, sourceText);
  if (intent === 'web.search') return buildWebSearchMask(wazaa, sourceText);
  if (intent === 'code.python.generate') return buildCodePythonMask(wazaa, sourceText);
  if (intent === 'chat.reply') return buildChatReplyMask(wazaa, sourceText);

  return null;
}

module.exports = wazaaToMask;
module.exports.buildChatReplyMask = buildChatReplyMask;
module.exports.buildCodePythonMask = buildCodePythonMask;
module.exports.buildFilesystemSortImagesMask = buildFilesystemSortImagesMask;
module.exports.buildGenericCodeMask = buildGenericCodeMask;
module.exports.buildImageGenerateMask = buildImageGenerateMask;
module.exports.buildWebImageSearchMask = buildWebImageSearchMask;
module.exports.buildWebSearchMask = buildWebSearchMask;

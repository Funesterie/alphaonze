const { normalizeIntentType } = require('./semantic/semantic-utils.cjs');
const { analyzeImagePrompt } = require('./build-sd-prompt-bundle.cjs');

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

function buildImageGenerateMask(wazaa, sourceText) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const imageAnalysis = analyzeImagePrompt(sourceText || translatedText || '');
  const subject = imageAnalysis?.semanticBinding?.primarySubject
    || getEntityValue(wazaa, 'subject')
    || imageAnalysis?.subjectPromptEnglish
    || imageAnalysis?.subjectText
    || translatedText
    || sourceText;
  const environment = getEntityValue(wazaa, 'environment');
  const styleEntity = getEntityValue(wazaa, 'style');
  const attribute = getEntityValue(wazaa, 'attribute');
  const llmColors = Array.isArray(wazaa?.meta?.llmColors) ? wazaa.meta.llmColors : [];
  const palette = toUniqueStrings([
    ...llmColors,
    ...(Array.isArray(imageAnalysis?.palette) ? imageAnalysis.palette : []),
    ...splitCsvValues(attribute),
  ]);
  const style = toUniqueStrings([
    styleEntity,
    ...(Array.isArray(imageAnalysis?.styleHints) ? imageAnalysis.styleHints : []),
    'high quality',
    'detailed',
  ]);

  return {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'sd-payload', version: '1.0' },
    inputs: {
      subject: subject ? [subject] : [],
      environment: environment ? [environment] : [],
      style,
      composition: toUniqueStrings(Array.isArray(imageAnalysis?.compositionHints) ? imageAnalysis.compositionHints : []),
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

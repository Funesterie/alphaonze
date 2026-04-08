function normalizeColorText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitColorTokens(value = '') {
  return normalizeColorText(value).split(/\s+/).filter(Boolean);
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_COLOR_LIBRARY = [
  { label: 'rouge', family: 'warm', hex: '#d32f2f', aliases: ['rouge', 'rouges', 'red', 'reds'] },
  { label: 'bleu', family: 'cool', hex: '#1e88e5', aliases: ['bleu', 'bleue', 'bleus', 'bleues', 'blue'] },
  { label: 'bleu marine', family: 'cool', hex: '#203a78', aliases: ['bleu marine', 'navy blue'] },
  { label: 'bleu ciel', family: 'cool', hex: '#6ec6ff', aliases: ['bleu ciel', 'sky blue'] },
  { label: 'vert', family: 'cool', hex: '#2e7d32', aliases: ['vert', 'verte', 'verts', 'vertes', 'green'] },
  { label: 'vert emeraude', family: 'cool', hex: '#009b77', aliases: ['vert emeraude', 'vert émeraude', 'emerald green'] },
  { label: 'jaune', family: 'warm', hex: '#f9a825', aliases: ['jaune', 'jaunes', 'yellow'] },
  { label: 'violet', family: 'cool', hex: '#8e24aa', aliases: ['violet', 'violette', 'violets', 'violettes', 'purple'] },
  { label: 'lavande', family: 'cool', hex: '#b497d6', aliases: ['lavande', 'lavender'] },
  { label: 'orange', family: 'warm', hex: '#ef6c00', aliases: ['orange', 'oranges'] },
  { label: 'rose', family: 'warm', hex: '#ec407a', aliases: ['rose', 'roses', 'pink'] },
  { label: 'fuchsia', family: 'warm', hex: '#c2185b', aliases: ['fuchsia', 'magenta'] },
  { label: 'blanc', family: 'neutral', hex: '#f5f5f5', aliases: ['blanc', 'blanche', 'blancs', 'blanches', 'white'] },
  { label: 'ivoire', family: 'neutral', hex: '#fff8e1', aliases: ['ivoire', 'ivory'] },
  { label: 'noir', family: 'neutral', hex: '#212121', aliases: ['noir', 'noire', 'noirs', 'noires', 'black'] },
  { label: 'marron', family: 'earth', hex: '#6d4c41', aliases: ['marron', 'marrons', 'brown', 'brun', 'brune', 'bruns', 'brunes'] },
  { label: 'gris', family: 'neutral', hex: '#757575', aliases: ['gris', 'grise', 'grises', 'gray', 'grey'] },
  { label: 'beige', family: 'earth', hex: '#d7c4a3', aliases: ['beige'] },
  { label: 'turquoise', family: 'cool', hex: '#26a69a', aliases: ['turquoise'] },
  { label: 'cyan', family: 'cool', hex: '#00acc1', aliases: ['cyan'] },
  { label: 'indigo', family: 'cool', hex: '#3949ab', aliases: ['indigo'] },
  { label: 'pourpre', family: 'warm', hex: '#7b1f5c', aliases: ['pourpre'] },
  { label: 'bordeaux', family: 'warm', hex: '#7b1e3d', aliases: ['bordeaux'] },
  { label: 'olive', family: 'earth', hex: '#808000', aliases: ['olive'] },
  { label: 'dore', family: 'metallic', hex: '#c9a227', aliases: ['dore', 'doree', 'dores', 'dorees', 'doré', 'dorée', 'dorés', 'dorées', 'gold', 'golden'] },
  { label: 'argente', family: 'metallic', hex: '#b0bec5', aliases: ['argent', 'argente', 'argentee', 'argentes', 'argentees', 'argenté', 'argentée', 'argentés', 'argentées', 'silver'] },
  { label: 'bronze', family: 'metallic', hex: '#8d6e63', aliases: ['bronze'] },
  { label: 'cuivre', family: 'metallic', hex: '#b87333', aliases: ['cuivre', 'copper'] },
  { label: 'multicolore', family: 'multicolor', hex: '#ff6f61', aliases: ['multicolore', 'multicolores', 'arc en ciel', 'arc-en-ciel', 'rainbow', 'rainbow colored'] },
];

const COLOR_LIBRARY = RAW_COLOR_LIBRARY.map((entry) => {
  const label = String(entry.label || '').trim();
  return {
    key: normalizeColorText(label).replace(/\s+/g, '_'),
    label,
    family: String(entry.family || '').trim(),
    hex: String(entry.hex || '').trim(),
    aliases: toUniqueStrings([label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]),
  };
});

const COLOR_ALIAS_PATTERNS = COLOR_LIBRARY
  .flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeColorText(alias),
    tokens: splitColorTokens(alias),
  })))
  .filter((pattern) => pattern.tokens.length > 0)
  .sort((left, right) => right.tokens.length - left.tokens.length || right.alias.length - left.alias.length);

const COLOR_ALIAS_INDEX = new Map(COLOR_ALIAS_PATTERNS.map((pattern) => [pattern.alias, pattern.entry]));

function colorDescriptorFromEntry(entry = null, extras = {}) {
  if (!entry) return null;
  return {
    key: entry.key,
    canonical: entry.label,
    label: entry.label,
    family: entry.family,
    hex: entry.hex,
    raw: String(extras.raw || '').trim(),
    alias: String(extras.alias || entry.label).trim(),
  };
}

function findColorDefinition(value = '') {
  const normalized = normalizeColorText(value);
  if (!normalized) return null;
  return colorDescriptorFromEntry(COLOR_ALIAS_INDEX.get(normalized), { raw: value, alias: normalized });
}

function findColorPatternAt(tokens = [], startIndex = 0) {
  if (!Array.isArray(tokens) || startIndex < 0 || startIndex >= tokens.length) return null;

  for (const pattern of COLOR_ALIAS_PATTERNS) {
    if (pattern.tokens.length === 0 || (startIndex + pattern.tokens.length) > tokens.length) continue;
    let match = true;
    for (let offset = 0; offset < pattern.tokens.length; offset += 1) {
      if (tokens[startIndex + offset] !== pattern.tokens[offset]) {
        match = false;
        break;
      }
    }
    if (match) return pattern;
  }

  return null;
}

function detectColorMatchesFromWordItems(wordItems = []) {
  const items = Array.isArray(wordItems) ? wordItems : [];
  const normalizedTokens = items.map((item) => normalizeColorText(item?.normalized || item?.word || ''));
  const matches = [];

  let index = 0;
  while (index < normalizedTokens.length) {
    const pattern = findColorPatternAt(normalizedTokens, index);
    if (!pattern) {
      index += 1;
      continue;
    }

    const endIndex = index + pattern.tokens.length - 1;
    matches.push({
      ...colorDescriptorFromEntry(pattern.entry, {
        raw: items.slice(index, endIndex + 1).map((entry) => String(entry?.word || '').trim()).filter(Boolean).join(' '),
        alias: pattern.alias,
      }),
      startIndex: index,
      endIndex,
      wordCount: pattern.tokens.length,
    });
    index = endIndex + 1;
  }

  return matches;
}

function tokenizeTextToWordItems(text = '') {
  const matches = String(text || '').match(/[a-z0-9àâçéèêëîïôûùüÿñæœ-]+/gi) || [];
  return matches.map((word) => ({
    word,
    normalized: normalizeColorText(word),
  }));
}

function detectColorMatchesFromText(text = '') {
  return detectColorMatchesFromWordItems(tokenizeTextToWordItems(text));
}

function collectUniqueColorsFromWordItems(wordItems = []) {
  const seen = new Set();
  const colors = [];

  for (const match of detectColorMatchesFromWordItems(wordItems)) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    colors.push({
      key: match.key,
      canonical: match.canonical,
      label: match.label,
      family: match.family,
      hex: match.hex,
    });
  }

  return colors;
}

function stripTrailingColorPhrase(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return raw;

  let changed = true;
  while (tokens.length > 1 && changed) {
    changed = false;
    const normalizedTokens = tokens.map((entry) => normalizeColorText(entry));
    const startIndex = Math.max(0, normalizedTokens.length - 4);
    let bestMatch = null;

    for (let index = startIndex; index < normalizedTokens.length; index += 1) {
      const pattern = findColorPatternAt(normalizedTokens, index);
      if (!pattern) continue;
      if ((index + pattern.tokens.length) !== normalizedTokens.length) continue;
      if (!bestMatch || pattern.tokens.length > bestMatch.tokens.length) {
        bestMatch = pattern;
      }
    }

    if (bestMatch && tokens.length > bestMatch.tokens.length) {
      tokens = tokens.slice(0, tokens.length - bestMatch.tokens.length);
      changed = true;
    }
  }

  return tokens.join(' ').trim() || raw;
}

module.exports = {
  COLOR_LIBRARY,
  normalizeColorText,
  splitColorTokens,
  findColorDefinition,
  detectColorMatchesFromText,
  detectColorMatchesFromWordItems,
  collectUniqueColorsFromWordItems,
  stripTrailingColorPhrase,
};

function normalizeElementText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitElementTokens(value = '') {
  return normalizeElementText(value).split(/\s+/).filter(Boolean);
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_ELEMENT_LIBRARY = [
  { label: 'glace', family: 'ice', aliases: ['glace', 'glacee', 'glacees', 'glacé', 'glacée', 'glacés', 'glacées', 'givré', 'givree', 'givre', 'ice', 'icy', 'frozen'] },
  { label: 'feu', family: 'fire', aliases: ['feu', 'flamme', 'flammes', 'incendiaire', 'fire', 'flame', 'flames'] },
  { label: 'spectre', family: 'ghost', aliases: ['spectre', 'fantome', 'fantôme', 'esprit', 'ghost', 'spirit', 'haunted'] },
  { label: 'electrique', family: 'electric', aliases: ['electrique', 'électrique', 'electric', 'lightning', 'foudre'] },
  { label: 'eau', family: 'water', aliases: ['eau', 'aquatique', 'water', 'marine', 'océanique', 'oceanique'] },
];

const ELEMENT_LIBRARY = RAW_ELEMENT_LIBRARY.map((entry) => {
  const label = String(entry.label || '').trim();
  return {
    key: normalizeElementText(label).replace(/\s+/g, '_'),
    label,
    family: String(entry.family || '').trim(),
    aliases: toUniqueStrings([label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]),
  };
});

const ELEMENT_ALIAS_PATTERNS = ELEMENT_LIBRARY
  .flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeElementText(alias),
    tokens: splitElementTokens(alias),
  })))
  .filter((pattern) => pattern.tokens.length > 0)
  .sort((left, right) => right.tokens.length - left.tokens.length || right.alias.length - left.alias.length);

const ELEMENT_ALIAS_INDEX = new Map(ELEMENT_ALIAS_PATTERNS.map((pattern) => [pattern.alias, pattern.entry]));

function elementDescriptorFromEntry(entry = null, extras = {}) {
  if (!entry) return null;
  return {
    key: entry.key,
    canonical: entry.label,
    label: entry.label,
    family: entry.family,
    raw: String(extras.raw || '').trim(),
    alias: String(extras.alias || entry.label).trim(),
  };
}

function findElementDefinition(value = '') {
  const normalized = normalizeElementText(value);
  if (!normalized) return null;
  return elementDescriptorFromEntry(ELEMENT_ALIAS_INDEX.get(normalized), { raw: value, alias: normalized });
}

function findElementPatternAt(tokens = [], startIndex = 0) {
  if (!Array.isArray(tokens) || startIndex < 0 || startIndex >= tokens.length) return null;

  for (const pattern of ELEMENT_ALIAS_PATTERNS) {
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

function detectElementMatchesFromWordItems(wordItems = []) {
  const items = Array.isArray(wordItems) ? wordItems : [];
  const normalizedTokens = items.map((item) => normalizeElementText(item?.normalized || item?.word || ''));
  const matches = [];

  let index = 0;
  while (index < normalizedTokens.length) {
    const pattern = findElementPatternAt(normalizedTokens, index);
    if (!pattern) {
      index += 1;
      continue;
    }

    const endIndex = index + pattern.tokens.length - 1;
    matches.push({
      ...elementDescriptorFromEntry(pattern.entry, {
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

function collectUniqueElementsFromWordItems(wordItems = []) {
  const seen = new Set();
  const elements = [];

  for (const match of detectElementMatchesFromWordItems(wordItems)) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    elements.push({
      key: match.key,
      canonical: match.canonical,
      label: match.label,
      family: match.family,
    });
  }

  return elements;
}

module.exports = {
  ELEMENT_LIBRARY,
  normalizeElementText,
  splitElementTokens,
  findElementDefinition,
  detectElementMatchesFromWordItems,
  collectUniqueElementsFromWordItems,
};

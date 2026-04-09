function normalizeAccessoryText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitAccessoryTokens(value = '') {
  return normalizeAccessoryText(value).split(/\s+/).filter(Boolean);
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_ACCESSORY_LIBRARY = [
  { label: 'carotte', family: 'food_prop', aliases: ['carotte', 'carrot'] },
  { label: 'cigarette', family: 'smoking_prop', aliases: ['cigarette', 'clope', 'smoke', 'cigarillo'] },
  { label: 'épée', family: 'weapon', aliases: ['epee', 'épée', 'épées', 'sword', 'swords'] },
  { label: 'bouclier', family: 'weapon', aliases: ['bouclier', 'shield'] },
  { label: 'lance', family: 'weapon', aliases: ['lance', 'spear'] },
  { label: 'arc', family: 'weapon', aliases: ['arc', 'bow'] },
  { label: 'bâton', family: 'tool', aliases: ['baton', 'bâton', 'staff'] },
  { label: 'chapeau', family: 'wearable', aliases: ['chapeau', 'hat'] },
  { label: 'casque', family: 'wearable', aliases: ['casque', 'helmet'] },
  { label: 'couronne', family: 'wearable', aliases: ['couronne', 'crown'] },
  { label: 'cape', family: 'wearable', aliases: ['cape', 'cloak'] },
  { label: 'pull', family: 'wearable', aliases: ['pull', 'pullover', 'sweater', 'sweat', 'hoodie'] },
];

const ACCESSORY_LIBRARY = RAW_ACCESSORY_LIBRARY.map((entry) => {
  const label = String(entry.label || '').trim();
  return {
    key: normalizeAccessoryText(label).replace(/\s+/g, '_'),
    label,
    family: String(entry.family || '').trim(),
    aliases: toUniqueStrings([label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]),
  };
});

const ACCESSORY_ALIAS_PATTERNS = ACCESSORY_LIBRARY
  .flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeAccessoryText(alias),
    tokens: splitAccessoryTokens(alias),
  })))
  .filter((pattern) => pattern.tokens.length > 0)
  .sort((left, right) => right.tokens.length - left.tokens.length || right.alias.length - left.alias.length);

const ACCESSORY_ALIAS_INDEX = new Map(ACCESSORY_ALIAS_PATTERNS.map((pattern) => [pattern.alias, pattern.entry]));

function accessoryDescriptorFromEntry(entry = null, extras = {}) {
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

function findAccessoryDefinition(value = '') {
  const normalized = normalizeAccessoryText(value);
  if (!normalized) return null;
  return accessoryDescriptorFromEntry(ACCESSORY_ALIAS_INDEX.get(normalized), { raw: value, alias: normalized });
}

function findAccessoryPatternAt(tokens = [], startIndex = 0) {
  if (!Array.isArray(tokens) || startIndex < 0 || startIndex >= tokens.length) return null;

  for (const pattern of ACCESSORY_ALIAS_PATTERNS) {
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

function detectAccessoryMatchesFromWordItems(wordItems = []) {
  const items = Array.isArray(wordItems) ? wordItems : [];
  const normalizedTokens = items.map((item) => normalizeAccessoryText(item?.normalized || item?.word || ''));
  const matches = [];

  let index = 0;
  while (index < normalizedTokens.length) {
    const pattern = findAccessoryPatternAt(normalizedTokens, index);
    if (!pattern) {
      index += 1;
      continue;
    }

    const endIndex = index + pattern.tokens.length - 1;
    matches.push({
      ...accessoryDescriptorFromEntry(pattern.entry, {
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

function collectUniqueAccessoriesFromWordItems(wordItems = []) {
  const seen = new Set();
  const accessories = [];

  for (const match of detectAccessoryMatchesFromWordItems(wordItems)) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    accessories.push({
      key: match.key,
      canonical: match.canonical,
      label: match.label,
      family: match.family,
    });
  }

  return accessories;
}

module.exports = {
  ACCESSORY_LIBRARY,
  normalizeAccessoryText,
  splitAccessoryTokens,
  findAccessoryDefinition,
  detectAccessoryMatchesFromWordItems,
  collectUniqueAccessoriesFromWordItems,
};

function normalizeMetierText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitMetierTokens(value = '') {
  return normalizeMetierText(value).split(/\s+/).filter(Boolean);
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_METIER_LIBRARY = [
  { label: 'guerrier', family: 'human_role', profileType: 'single_human_figure', aliases: ['guerrier', 'guerriere', 'guerrière', 'warrior'] },
  { label: 'viking', family: 'human_role', profileType: 'single_human_figure', aliases: ['viking', 'vikinge', 'guerrier nordique', 'guerriere nordique', 'guerrière nordique', 'nordic warrior'] },
  { label: 'chevalier', family: 'human_role', profileType: 'single_human_figure', aliases: ['chevalier', 'chevaliere', 'chevalière', 'knight'] },
  { label: 'archer', family: 'human_role', profileType: 'single_human_figure', aliases: ['archer', 'archère', 'archere', 'bowman'] },
  { label: 'mage', family: 'human_role', profileType: 'single_human_figure', aliases: ['mage', 'magicien', 'magicienne', 'wizard', 'sorcier', 'sorciere', 'sorcière'] },
  { label: 'ninja', family: 'human_role', profileType: 'single_human_figure', aliases: ['ninja'] },
  { label: 'pirate', family: 'human_role', profileType: 'single_human_figure', aliases: ['pirate'] },
  { label: 'samourai', family: 'human_role', profileType: 'single_human_figure', aliases: ['samourai', 'samurai'] },
  { label: 'roi', family: 'human_role', profileType: 'single_human_figure', aliases: ['roi', 'king'] },
  { label: 'reine', family: 'human_role', profileType: 'single_human_figure', aliases: ['reine', 'queen'] },
  { label: 'prince', family: 'human_role', profileType: 'single_human_figure', aliases: ['prince'] },
  { label: 'princesse', family: 'human_role', profileType: 'single_human_figure', aliases: ['princesse', 'princess'] },
];

const METIER_LIBRARY = RAW_METIER_LIBRARY.map((entry) => {
  const label = String(entry.label || '').trim();
  return {
    key: normalizeMetierText(label).replace(/\s+/g, '_'),
    label,
    family: String(entry.family || '').trim(),
    profileType: String(entry.profileType || '').trim(),
    aliases: toUniqueStrings([label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]),
  };
});

const METIER_ALIAS_PATTERNS = METIER_LIBRARY
  .flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeMetierText(alias),
    tokens: splitMetierTokens(alias),
  })))
  .filter((pattern) => pattern.tokens.length > 0)
  .sort((left, right) => right.tokens.length - left.tokens.length || right.alias.length - left.alias.length);

const METIER_ALIAS_INDEX = new Map(METIER_ALIAS_PATTERNS.map((pattern) => [pattern.alias, pattern.entry]));

function metierDescriptorFromEntry(entry = null, extras = {}) {
  if (!entry) return null;
  return {
    key: entry.key,
    canonical: entry.label,
    label: entry.label,
    family: entry.family,
    profileType: entry.profileType,
    raw: String(extras.raw || '').trim(),
    alias: String(extras.alias || entry.label).trim(),
  };
}

function findMetierDefinition(value = '') {
  const normalized = normalizeMetierText(value);
  if (!normalized) return null;
  return metierDescriptorFromEntry(METIER_ALIAS_INDEX.get(normalized), { raw: value, alias: normalized });
}

function findMetierPatternAt(tokens = [], startIndex = 0) {
  if (!Array.isArray(tokens) || startIndex < 0 || startIndex >= tokens.length) return null;

  for (const pattern of METIER_ALIAS_PATTERNS) {
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

function detectMetierMatchesFromWordItems(wordItems = []) {
  const items = Array.isArray(wordItems) ? wordItems : [];
  const normalizedTokens = items.map((item) => normalizeMetierText(item?.normalized || item?.word || ''));
  const matches = [];

  let index = 0;
  while (index < normalizedTokens.length) {
    const pattern = findMetierPatternAt(normalizedTokens, index);
    if (!pattern) {
      index += 1;
      continue;
    }

    const endIndex = index + pattern.tokens.length - 1;
    matches.push({
      ...metierDescriptorFromEntry(pattern.entry, {
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

function collectUniqueMetiersFromWordItems(wordItems = []) {
  const seen = new Set();
  const metiers = [];

  for (const match of detectMetierMatchesFromWordItems(wordItems)) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    metiers.push({
      key: match.key,
      canonical: match.canonical,
      label: match.label,
      family: match.family,
      profileType: match.profileType,
    });
  }

  return metiers;
}

module.exports = {
  METIER_LIBRARY,
  normalizeMetierText,
  splitMetierTokens,
  findMetierDefinition,
  detectMetierMatchesFromWordItems,
  collectUniqueMetiersFromWordItems,
};

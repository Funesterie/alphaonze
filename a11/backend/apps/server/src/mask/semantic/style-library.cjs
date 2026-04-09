function normalizeStyleText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitStyleTokens(value = '') {
  return normalizeStyleText(value).split(/\s+/).filter(Boolean);
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_STYLE_LIBRARY = [
  { label: 'anime', family: 'illustration', aliases: ['anime', 'manga', 'style anime', 'style manga'] },
  { label: 'cartoon', family: 'illustration', aliases: ['cartoon', 'dessin animé', 'dessin anime', 'style cartoon'] },
  { label: 'pixel art', family: 'digital', aliases: ['pixel art', 'pixel-art'] },
  { label: 'illustration', family: 'illustration', aliases: ['illustration', 'illustré', 'illustre'] },
  { label: 'photorealiste', family: 'realism', aliases: ['photorealiste', 'photo réaliste', 'photo realiste', 'photorealistic', 'photo', 'style photo'] },
  { label: 'realiste', family: 'realism', aliases: ['realiste', 'réaliste', 'realistic'] },
  { label: 'cinematique', family: 'cinematic', aliases: ['cinematique', 'cinématique', 'cinematic'] },
  { label: '3d', family: 'digital', aliases: ['3d', 'rendu 3d', 'render 3d'] },
  { label: 'aquarelle', family: 'painting', aliases: ['aquarelle', 'watercolor', 'water colour'] },
  { label: 'peinture', family: 'painting', aliases: ['peinture', 'painting'] },
  { label: 'croquis', family: 'drawing', aliases: ['croquis', 'sketch', 'line art', 'line-art'] },
  { label: 'minimaliste', family: 'design', aliases: ['minimaliste', 'minimalist'] },
  { label: 'low poly', family: 'digital', aliases: ['low poly', 'low-poly'] },
  { label: 'ghibli', family: 'illustration', aliases: ['ghibli', 'style ghibli'] },
];

const STYLE_LIBRARY = RAW_STYLE_LIBRARY.map((entry) => {
  const label = String(entry.label || '').trim();
  return {
    key: normalizeStyleText(label).replace(/\s+/g, '_'),
    label,
    family: String(entry.family || '').trim(),
    aliases: toUniqueStrings([label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]),
  };
});

const STYLE_ALIAS_PATTERNS = STYLE_LIBRARY
  .flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeStyleText(alias),
    tokens: splitStyleTokens(alias),
  })))
  .filter((pattern) => pattern.tokens.length > 0)
  .sort((left, right) => right.tokens.length - left.tokens.length || right.alias.length - left.alias.length);

const STYLE_ALIAS_INDEX = new Map(STYLE_ALIAS_PATTERNS.map((pattern) => [pattern.alias, pattern.entry]));

function styleDescriptorFromEntry(entry = null, extras = {}) {
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

function findStyleDefinition(value = '') {
  const normalized = normalizeStyleText(value);
  if (!normalized) return null;
  return styleDescriptorFromEntry(STYLE_ALIAS_INDEX.get(normalized), { raw: value, alias: normalized });
}

function findStylePatternAt(tokens = [], startIndex = 0) {
  if (!Array.isArray(tokens) || startIndex < 0 || startIndex >= tokens.length) return null;

  for (const pattern of STYLE_ALIAS_PATTERNS) {
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

function detectStyleMatchesFromWordItems(wordItems = []) {
  const items = Array.isArray(wordItems) ? wordItems : [];
  const normalizedTokens = items.map((item) => normalizeStyleText(item?.normalized || item?.word || ''));
  const matches = [];

  let index = 0;
  while (index < normalizedTokens.length) {
    const pattern = findStylePatternAt(normalizedTokens, index);
    if (!pattern) {
      index += 1;
      continue;
    }

    const endIndex = index + pattern.tokens.length - 1;
    matches.push({
      ...styleDescriptorFromEntry(pattern.entry, {
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

function collectUniqueStylesFromWordItems(wordItems = []) {
  const seen = new Set();
  const styles = [];

  for (const match of detectStyleMatchesFromWordItems(wordItems)) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    styles.push({
      key: match.key,
      canonical: match.canonical,
      label: match.label,
      family: match.family,
    });
  }

  return styles;
}

function stripTrailingStylePhrase(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return raw;

  let changed = true;
  while (tokens.length > 1 && changed) {
    changed = false;
    const normalizedTokens = tokens.map((entry) => normalizeStyleText(entry));
    const startIndex = Math.max(0, normalizedTokens.length - 5);
    let bestMatch = null;

    for (let index = startIndex; index < normalizedTokens.length; index += 1) {
      const pattern = findStylePatternAt(normalizedTokens, index);
      if (!pattern) continue;
      if ((index + pattern.tokens.length) !== normalizedTokens.length) continue;
      if (!bestMatch || pattern.tokens.length > bestMatch.tokens.length) {
        bestMatch = { ...pattern, startIndex: index };
      }
    }

    if (bestMatch && tokens.length > bestMatch.tokens.length) {
      let removeStart = bestMatch.startIndex;
      const previous = normalizedTokens[removeStart - 1] || '';
      const previousTwo = normalizedTokens.slice(Math.max(0, removeStart - 2), removeStart).join(' ');

      if (previousTwo === 'en style') removeStart -= 2;
      else if (previous === 'style' || previous === 'en') removeStart -= 1;

      if (removeStart >= 1) {
        tokens = tokens.slice(0, removeStart);
        changed = true;
      }
    }
  }

  return tokens.join(' ').trim() || raw;
}

module.exports = {
  STYLE_LIBRARY,
  normalizeStyleText,
  splitStyleTokens,
  findStyleDefinition,
  detectStyleMatchesFromWordItems,
  collectUniqueStylesFromWordItems,
  stripTrailingStylePhrase,
};

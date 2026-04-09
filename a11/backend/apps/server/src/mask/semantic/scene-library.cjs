function normalizeSceneText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitSceneTokens(value = '') {
  return normalizeSceneText(value).split(/\s+/).filter(Boolean);
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_SCENE_LIBRARY = [
  { label: 'grotte', family: 'natural', aliases: ['grotte', 'cave'] },
  { label: 'volcan', family: 'natural', aliases: ['volcan', 'volcano'] },
  { label: 'plage', family: 'natural', aliases: ['plage', 'beach'] },
  { label: 'foret', family: 'natural', aliases: ['foret', 'forêt', 'forest'] },
  { label: 'montagne', family: 'natural', aliases: ['montagne', 'montagnes', 'mountain', 'mountains'] },
  { label: 'ciel ouvert', family: 'open', aliases: ['ciel', 'sky', 'ciel ouvert'] },
  { label: 'espace', family: 'cosmic', aliases: ['espace', 'space', 'galaxie', 'galaxy'] },
  { label: 'ville', family: 'urban', aliases: ['ville', 'city', 'urbain', 'urbaine'] },
  { label: 'laboratoire', family: 'indoor', aliases: ['laboratoire', 'lab', 'laboratory'] },
  { label: 'chateau', family: 'architecture', aliases: ['chateau', 'château', 'castle'] },
  { label: 'temple', family: 'architecture', aliases: ['temple'] },
  { label: 'bord de mer', family: 'water', aliases: ['mer', 'ocean', 'océan', 'bord de mer', 'seaside'] },
  { label: 'rivière', family: 'water', aliases: ['riviere', 'rivière', 'river'] },
  { label: 'neige', family: 'climate', aliases: ['neige', 'snow', 'enneigé', 'enneige'] },
  { label: 'hiver', family: 'climate', aliases: ['hiver', 'winter', 'hivernal', 'hivernale'] },
  { label: 'nuit', family: 'time', aliases: ['nuit', 'night', 'nocturne'] },
];

const SCENE_LIBRARY = RAW_SCENE_LIBRARY.map((entry) => {
  const label = String(entry.label || '').trim();
  return {
    key: normalizeSceneText(label).replace(/\s+/g, '_'),
    label,
    family: String(entry.family || '').trim(),
    aliases: toUniqueStrings([label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]),
  };
});

const SCENE_ALIAS_PATTERNS = SCENE_LIBRARY
  .flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeSceneText(alias),
    tokens: splitSceneTokens(alias),
  })))
  .filter((pattern) => pattern.tokens.length > 0)
  .sort((left, right) => right.tokens.length - left.tokens.length || right.alias.length - left.alias.length);

const SCENE_ALIAS_INDEX = new Map(SCENE_ALIAS_PATTERNS.map((pattern) => [pattern.alias, pattern.entry]));

function sceneDescriptorFromEntry(entry = null, extras = {}) {
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

function findSceneDefinition(value = '') {
  const normalized = normalizeSceneText(value);
  if (!normalized) return null;
  return sceneDescriptorFromEntry(SCENE_ALIAS_INDEX.get(normalized), { raw: value, alias: normalized });
}

function findScenePatternAt(tokens = [], startIndex = 0) {
  if (!Array.isArray(tokens) || startIndex < 0 || startIndex >= tokens.length) return null;

  for (const pattern of SCENE_ALIAS_PATTERNS) {
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

function detectSceneMatchesFromWordItems(wordItems = []) {
  const items = Array.isArray(wordItems) ? wordItems : [];
  const normalizedTokens = items.map((item) => normalizeSceneText(item?.normalized || item?.word || ''));
  const matches = [];

  let index = 0;
  while (index < normalizedTokens.length) {
    const pattern = findScenePatternAt(normalizedTokens, index);
    if (!pattern) {
      index += 1;
      continue;
    }

    const endIndex = index + pattern.tokens.length - 1;
    matches.push({
      ...sceneDescriptorFromEntry(pattern.entry, {
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

function collectUniqueScenesFromWordItems(wordItems = []) {
  const seen = new Set();
  const scenes = [];

  for (const match of detectSceneMatchesFromWordItems(wordItems)) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    scenes.push({
      key: match.key,
      canonical: match.canonical,
      label: match.label,
      family: match.family,
    });
  }

  return scenes;
}

module.exports = {
  SCENE_LIBRARY,
  normalizeSceneText,
  splitSceneTokens,
  findSceneDefinition,
  detectSceneMatchesFromWordItems,
  collectUniqueScenesFromWordItems,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SEEDS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'runtime',
  'knowledge-graph',
  'semantic-resonance-seeds.json'
);

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[_/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function loadSemanticResonanceSeeds(options = {}) {
  const seedsPath = path.resolve(
    String(options.seedsPath || process.env.A11_SEMANTIC_RESONANCE_SEEDS || DEFAULT_SEEDS_PATH)
  );
  const raw = fs.readFileSync(seedsPath, 'utf8');
  const parsed = JSON.parse(raw);
  const entries = uniqueBy(asArray(parsed.entries), (entry) => normalizeText(entry?.id || entry?.label));
  return {
    ...parsed,
    seedsPath,
    entries,
  };
}

function entrySearchText(entry = {}) {
  const facetText = asArray(entry.facets)
    .map((facet) => [facet.id, facet.label, facet.layer, facet.tone].filter(Boolean).join(' '))
    .join(' ');
  const interactionText = asArray(entry.interactions)
    .map((interaction) => [interaction.target, interaction.relation, interaction.summary].filter(Boolean).join(' '))
    .join(' ');
  return normalizeText([
    entry.id,
    entry.label,
    entry.type,
    entry.literal,
    ...asArray(entry.aliases),
    ...asArray(entry.tones),
    facetText,
    interactionText,
  ].filter(Boolean).join(' '));
}

function findResonanceEntry(query, seeds = loadSemanticResonanceSeeds()) {
  const needle = normalizeText(query);
  if (!needle) return null;

  const exact = seeds.entries.find((entry) => {
    const names = [entry.id, entry.label, ...asArray(entry.aliases)].map(normalizeText);
    return names.some((name) => name && (needle === name || needle.includes(name) || name.includes(needle)));
  });
  if (exact) return exact;

  const tokens = new Set(needle.split(' ').filter((token) => token.length >= 3));
  let best = null;
  for (const entry of seeds.entries) {
    const search = entrySearchText(entry);
    const hits = Array.from(tokens).filter((token) => search.includes(token)).length;
    if (!best || hits > best.hits) best = { entry, hits };
  }
  return best?.hits > 0 ? best.entry : null;
}

function interactionCountFor(entry = {}, seeds = { entries: [] }, contextText = '') {
  const context = normalizeText(contextText);
  const entriesById = new Map(asArray(seeds.entries).map((item) => [normalizeText(item.id), item]));
  let count = 0;
  for (const interaction of asArray(entry.interactions)) {
    const targetKey = normalizeText(interaction.target);
    if (!targetKey) continue;
    const target = entriesById.get(targetKey);
    if (target && context) {
      const targetAliases = [target.id, target.label, ...asArray(target.aliases)].map(normalizeText);
      if (targetAliases.some((alias) => alias && context.includes(alias))) count += 1;
    } else {
      count += 0.5;
    }
  }
  return count;
}

function scoreResonanceEntry(entry = {}, contextText = '', seeds = { entries: [] }) {
  const facets = asArray(entry.facets);
  const layers = new Set(facets.map((facet) => normalizeText(facet.layer)).filter(Boolean));
  const tones = new Set([
    ...asArray(entry.tones).map(normalizeText),
    ...facets.map((facet) => normalizeText(facet.tone)),
  ].filter(Boolean));
  const context = normalizeText(contextText);
  const search = entrySearchText(entry);
  const contextTokens = context.split(' ').filter((token) => token.length >= 3);
  const contextHits = uniqueBy(contextTokens.filter((token) => search.includes(token)), (token) => token).length;
  const interactions = interactionCountFor(entry, seeds, contextText);
  const trust = Number.isFinite(Number(entry.trust)) ? Number(entry.trust) : 0.7;

  const score = Math.round((
    facets.length * 1.5
    + layers.size * 2
    + tones.size
    + interactions * 2.5
    + contextHits * 1.2
    + trust * 5
  ) * 100) / 100;

  return {
    facetCount: facets.length,
    layerCount: layers.size,
    toneCount: tones.size,
    interactionCount: interactions,
    contextHits,
    trust,
    score,
  };
}

function explainResonance(query, contextText = '', options = {}) {
  const seeds = options.seeds || loadSemanticResonanceSeeds(options);
  const matched = findResonanceEntry(query, seeds);
  if (!matched) {
    return {
      ok: false,
      query: String(query || ''),
      reason: 'no resonance entry matched',
    };
  }

  const score = scoreResonanceEntry(matched, contextText, seeds);
  const sortedFacets = asArray(matched.facets)
    .slice()
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));

  return {
    ok: true,
    query: String(query || ''),
    matched: {
      id: matched.id,
      label: matched.label,
      type: matched.type,
      literal: matched.literal,
      temporalStatus: matched.temporalStatus,
    },
    score,
    activeFacets: sortedFacets.slice(0, options.maxFacets || 8),
    tones: asArray(matched.tones),
    interactions: asArray(matched.interactions),
    guidance: matched.agentGuidance || '',
  };
}

function buildSemanticResonanceGraphTriplets(seeds = loadSemanticResonanceSeeds()) {
  const nodes = [];
  const relationships = [];

  for (const entry of asArray(seeds.entries)) {
    const anchorId = `anchor:${entry.id}`;
    nodes.push({
      id: anchorId,
      labels: ['A11CulturalAnchor'],
      properties: {
        id: entry.id,
        label: entry.label,
        type: entry.type,
        language: entry.language,
        trust: entry.trust,
        temporalStatus: entry.temporalStatus,
      },
    });

    for (const facet of asArray(entry.facets)) {
      const facetId = `facet:${entry.id}.${facet.id}`;
      nodes.push({
        id: facetId,
        labels: ['A11SemanticFacet'],
        properties: {
          id: `${entry.id}.${facet.id}`,
          label: facet.label,
          layer: facet.layer,
          tone: facet.tone,
        },
      });
      relationships.push({
        from: anchorId,
        to: facetId,
        type: facet.layer === 'idiom' || facet.layer === 'slang' ? 'HAS_WORDPLAY' : 'EVOKES',
        properties: { weight: facet.weight || 0.7 },
      });
      if (facet.tone) {
        relationships.push({
          from: facetId,
          to: `tone:${normalizeText(facet.tone)}`,
          type: 'CARRIES_TONE',
          properties: { weight: facet.weight || 0.7 },
        });
        nodes.push({
          id: `tone:${normalizeText(facet.tone)}`,
          labels: ['A11SemanticTone'],
          properties: { id: normalizeText(facet.tone), label: facet.tone },
        });
      }
    }

    for (const interaction of asArray(entry.interactions)) {
      relationships.push({
        from: anchorId,
        to: `anchor:${interaction.target}`,
        type: interaction.relation || 'PAIRS_WITH',
        properties: {
          summary: interaction.summary || '',
          weight: interaction.weight || 0.7,
        },
      });
    }
  }

  return {
    schema: 'funesterie.semantic-resonance.graph.v1',
    nodes: uniqueBy(nodes, (node) => node.id),
    relationships,
  };
}

module.exports = {
  DEFAULT_SEEDS_PATH,
  buildSemanticResonanceGraphTriplets,
  explainResonance,
  findResonanceEntry,
  loadSemanticResonanceSeeds,
  normalizeText,
  scoreResonanceEntry,
};

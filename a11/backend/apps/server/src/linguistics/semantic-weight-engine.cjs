'use strict';

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-_/]/g, ' ')
    .toLowerCase();
}

function uniqueStrings(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const text = normalizeText(value);
    const key = normalizeLookup(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function clampWeight(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.2, Math.min(1.8, Math.round(numeric * 100) / 100));
}

function getSceneEntity(sceneGraph = null, role = '') {
  return Array.isArray(sceneGraph?.entities)
    ? sceneGraph.entities.find((entry) => normalizeLookup(entry?.role || '') === normalizeLookup(role))
    : null;
}

function getSceneRelation(sceneGraph = null) {
  return Array.isArray(sceneGraph?.relations) ? sceneGraph.relations[0] || null : null;
}

const FUNESTERIE_CONTEXTS = {
  vivy: {
    id: 'vivy',
    styleBias: ['musical presence', 'voice emotion', 'violet neon'],
    avoid: ['generic robot', 'random technical symbols'],
  },
  a11: {
    id: 'a11',
    styleBias: ['media analysis', 'blue system light', 'structured signal'],
    avoid: ['human idol pose', 'random fantasy ornament'],
  },
  kaen44: {
    id: 'kaen44',
    aliases: ['k44', 'kaen'],
    styleBias: ['daily copilot', 'field assistance', 'warm readable interface'],
    avoid: ['abstract server room', 'hostile cyberpunk'],
  },
  k44: {
    id: 'kaen44',
    styleBias: ['daily copilot', 'field assistance', 'warm readable interface'],
    avoid: ['abstract server room', 'hostile cyberpunk'],
  },
  nossen: {
    id: 'nossen',
    styleBias: ['living nexus world', 'lore presence', 'purple cosmic atmosphere'],
    avoid: ['generic city', 'random sci-fi UI'],
  },
  qflush: {
    id: 'qflush',
    styleBias: ['flow accelerator', 'runtime current', 'green signal energy'],
    avoid: ['human character portrait'],
    technicalModule: true,
  },
  corpus: {
    id: 'corpus',
    styleBias: ['knowledge graph', 'archive library', 'source cards'],
    avoid: ['human character portrait'],
    technicalModule: true,
  },
  rome: {
    id: 'rome',
    styleBias: ['runtime map', 'route artifact', 'navigation structure'],
    avoid: ['human character portrait'],
    technicalModule: true,
  },
};

function resolveFunesterieContext(context = {}) {
  const rawValues = [
    context.activeAgent,
    context.agent,
    context.narrativeContext,
    context.universe,
    context.module,
    context.identity,
  ].map((entry) => normalizeLookup(entry)).filter(Boolean);

  const profiles = [];
  for (const value of rawValues) {
    for (const profile of Object.values(FUNESTERIE_CONTEXTS)) {
      const aliases = [profile.id, ...(Array.isArray(profile.aliases) ? profile.aliases : [])]
        .map((entry) => normalizeLookup(entry));
      if (aliases.some((alias) => alias && value.includes(alias))) {
        profiles.push(profile);
      }
    }
  }

  const uniqueProfiles = [];
  const seen = new Set();
  for (const profile of profiles) {
    const key = profile.id;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueProfiles.push(profile);
  }

  return {
    profiles: uniqueProfiles,
    styleBias: uniqueStrings(uniqueProfiles.flatMap((profile) => profile.styleBias || [])),
    avoid: uniqueStrings(uniqueProfiles.flatMap((profile) => profile.avoid || [])),
    technicalModule: uniqueProfiles.some((profile) => profile.technicalModule === true),
  };
}

function buildSemanticWeightsFromScene(sceneGraph = null, context = {}) {
  const subject = getSceneEntity(sceneGraph, 'subject')?.text || '';
  const origin = getSceneEntity(sceneGraph, 'origin')?.text || '';
  const relation = getSceneRelation(sceneGraph);
  const language = normalizeText(sceneGraph?.language || 'unknown') || 'unknown';
  const funesterieContext = resolveFunesterieContext(context);
  const actionText = language === 'fr'
    ? 'sortant de'
    : language === 'ja'
      ? 'emerging from'
      : language === 'zh'
        ? 'emerging from'
        : 'emerging from';

  const items = [];
  if (subject) {
    items.push({
      role: 'subject',
      text: subject,
      weight: clampWeight(1.4, 1.4),
      reason: 'main grammatical subject and visual focus',
    });
  }
  if (subject && origin && relation?.type === 'emerges_from') {
    items.push({
      role: 'action_relation',
      text: language === 'fr' ? `${actionText} ${origin}` : `${actionText} ${origin}`,
      weight: clampWeight(1.25, 1.25),
      reason: 'central dynamic spatial relation',
    });
  }
  if (origin) {
    items.push({
      role: 'origin_object',
      text: origin,
      weight: clampWeight(1.2, 1.2),
      reason: 'required spatial source object',
    });
  }
  items.push({
    role: 'style_readability',
    text: language === 'fr' ? 'scene simple et lisible' : 'simple readable scene',
    weight: clampWeight(0.8, 0.8),
    reason: 'secondary composition guard',
  });

  for (const style of funesterieContext.styleBias) {
    items.push({
      role: 'context_style_bias',
      text: style,
      weight: clampWeight(funesterieContext.technicalModule ? 0.95 : 0.85, 0.85),
      reason: 'Funesterie identity context',
    });
  }

  return {
    schema: 'a11.semantic-weights.v1',
    ok: Boolean(sceneGraph && items.length),
    language,
    context: {
      profiles: funesterieContext.profiles.map((profile) => profile.id),
      styleBias: funesterieContext.styleBias,
      avoid: funesterieContext.avoid,
      technicalModule: funesterieContext.technicalModule,
    },
    items,
  };
}

function formatWeightedPromptFragment(item = {}) {
  const text = normalizeText(item.text);
  if (!text) return '';
  const weight = clampWeight(item.weight, 1);
  return `(${text}:${weight.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')})`;
}

function buildWeightedImagePromptFragments(weightState = null) {
  if (!weightState?.ok || !Array.isArray(weightState.items)) return [];
  return uniqueStrings(weightState.items.map(formatWeightedPromptFragment));
}

function buildWeightedNegativePromptFragments(weightState = null) {
  if (!weightState?.ok) return [];
  return uniqueStrings(weightState.context?.avoid || []);
}

module.exports = {
  buildSemanticWeightsFromScene,
  buildWeightedImagePromptFragments,
  buildWeightedNegativePromptFragments,
  resolveFunesterieContext,
};

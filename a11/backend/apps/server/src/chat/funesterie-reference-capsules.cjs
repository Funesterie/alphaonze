'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const DEFAULT_DAILY_QUOTA = 12;
const DEFAULT_PICK_BATCH = 3;
const CONTEXT_MAX_CHARS = 2400;

function cleanInline(value = '', maxChars = 1000) {
  const text = String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readJsonl(filePath, { limit = 40 } = {}) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function firstExisting(paths = []) {
  for (const item of paths) {
    if (!item) continue;
    try {
      if (fs.existsSync(item)) return item;
    } catch {}
  }
  return '';
}

function resolveReferenceRoot(env = process.env) {
  const runtimeRoot = getCanonicalRuntimeRoot(env);
  const home = os.homedir();
  const candidates = [
    env.FUNESTERIE_REFERENCE_ROOT,
    env.A11_REFERENCE_ROOT,
    env.FUNESTERIE_DETENTE_HUMOUR_ROOT,
    path.join(runtimeRoot, 'knowledge', 'detente-humour'),
    path.join(runtimeRoot, 'Corpus', 'detente-humour'),
    path.join(home, 'Desktop', 'FUNESTERIE_DETENTE_HUMOUR'),
    path.join(home, 'OneDrive', 'Bureau', 'FUNESTERIE_DETENTE_HUMOUR'),
    path.join(home, 'Bureau', 'FUNESTERIE_DETENTE_HUMOUR'),
  ].filter(Boolean).map((entry) => path.resolve(String(entry)));
  return firstExisting(candidates);
}

function resolveCatalogueRoot(referenceRoot = '') {
  if (!referenceRoot) return '';
  const nested = path.join(referenceRoot, 'detente-humour');
  if (firstExisting([
    path.join(nested, 'catalogue.jsonl'),
    path.join(nested, 'manifest.json'),
  ])) return nested;
  return referenceRoot;
}

function loadLatestDailyPool(referenceRoot = '') {
  const poolDir = path.join(referenceRoot || '', 'ref-pool');
  try {
    const latest = fs.readdirSync(poolDir)
      .filter((name) => /^daily-\d{4}-\d{2}-\d{2}\.json$/i.test(name))
      .sort()
      .pop();
    if (!latest) return null;
    return readJson(path.join(poolDir, latest));
  } catch {
    return null;
  }
}

function languageFromEntry(entry = {}) {
  const blob = `${entry.id || ''} ${entry.catalogueId || ''} ${entry.title || ''}`.toLowerCase();
  const match = blob.match(/\b(?:sub-)?s\d{2}e\d{2}-(fr|en|de|es|pt|it|nl|sv|no|da|fi|pl|cs|hu|ro)\b/);
  return match?.[1] || '';
}

function inferReferenceTraits(entry = {}) {
  const source = String(entry.source || '').toLowerCase();
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag || '').toLowerCase()) : [];
  const body = String(entry.body || '').toLowerCase();
  const title = String(entry.title || '').toLowerCase();
  const blob = `${body} ${title} ${tags.join(' ')}`;
  const traits = new Set();

  if (source.includes('trailer') || tags.includes('tpb') || /trailer|park|boys|tpb/.test(blob)) {
    traits.add('répartie sèche');
    traits.add('fausse gravité');
    traits.add('ténacité de débrouille');
  }
  if (/\b(argent|money|cash|commerce|business|sell|sold|vente|vend|bi[eè]re|beer)\b/.test(blob)) {
    traits.add('petite combine traitée comme grand business');
  }
  if (/\b(dream|r[eê]ve|real|vrai|gloire|glory)\b/.test(blob)) {
    traits.add('rêve absurde transformé en plan concret');
  }
  if (/\b(nerves?|stress|panic|panique|aide|help|peur|shot|oh mon dieu)\b/.test(blob)) {
    traits.add('panique comique sous pression');
  }
  if (/\b(autorise|autorisation|authorized|nom|name|r[eè]gle|law|police|agent|boss|chef)\b/.test(blob)) {
    traits.add('autorité ridicule et bureaucratie retournée');
  }
  if (/\b(sac|poubelle|trash|pot|gun|pistolet|bouteille|bottle|car|trailer|park)\b/.test(blob)) {
    traits.add('objet trivial qui porte la scène');
  }
  if (/\b(favour|favor|service|besoin|need|aide)\b/.test(blob)) {
    traits.add('demande de service qui annonce un piège');
  }
  if (/\b(abandon|quit|again|lendemain|tomorrow|encore|recommence)\b/.test(blob)) {
    traits.add('recommencer après le crash sans discours héroïque');
  }
  if (source.includes('funesterie')) {
    traits.add('transformation en voix Funesterie');
    traits.add('inspiration sans copie');
  }

  if (!traits.size) {
    traits.add('micro-situation quotidienne à transformer');
  }
  return [...traits].slice(0, 6);
}

function summarizeTraitCounts(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    for (const trait of inferReferenceTraits(entry)) {
      counts.set(trait, (counts.get(trait) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([trait, count]) => `${trait}${count > 1 ? ` (${count})` : ''}`);
}

function loadReferenceCapsuleState(env = process.env, options = {}) {
  const referenceRoot = resolveReferenceRoot(env);
  const catalogueRoot = resolveCatalogueRoot(referenceRoot);
  const quota = readJson(path.join(referenceRoot || '', 'ref-quota-config.json')) || {};
  const manifest = {
    ...(readJson(path.join(catalogueRoot || '', 'manifest.json')) || {}),
    ...(readJson(path.join(referenceRoot || '', 'manifest.json')) || {}),
  };
  const dailyPool = loadLatestDailyPool(referenceRoot) || {};
  const dailyRefs = Array.isArray(dailyPool.refs) ? dailyPool.refs : [];
  const storedRefs = readJsonl(path.join(referenceRoot || '', 'stored-refs.jsonl'), { limit: 24 });
  const catalogueSeeds = readJsonl(path.join(catalogueRoot || '', 'catalogue.jsonl'), { limit: 24 });
  const entries = [
    ...dailyRefs,
    ...storedRefs,
    ...catalogueSeeds.filter((entry) => entry && entry.source === 'funesterie'),
  ].filter(Boolean);

  const maxEntries = Math.max(3, Math.min(24, Number(options.maxEntries || 12) || 12));
  const selected = entries.slice(0, maxEntries);
  const dailyQuota = Number(quota.dailyQuota || dailyPool.dailyQuota || DEFAULT_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA;
  const pickBatch = Number(quota.pickBatch || DEFAULT_PICK_BATCH) || DEFAULT_PICK_BATCH;
  const available = Number.isFinite(Number(dailyPool.available))
    ? Number(dailyPool.available)
    : Math.max(0, dailyRefs.filter((entry) => entry.status !== 'picked').length);
  const picked = dailyRefs.filter((entry) => entry.status === 'picked').length;
  const languages = Array.from(new Set(selected.map(languageFromEntry).filter(Boolean))).slice(0, 8);

  return {
    ok: Boolean(referenceRoot),
    referenceRoot,
    catalogueRoot,
    manifest,
    quota: { dailyQuota, pickBatch, available, picked, maxStored: Number(quota.maxStored || 0) || null },
    dailyPool: {
      day: cleanInline(dailyPool.day, 24),
      createdAt: cleanInline(dailyPool.createdAt, 40),
    },
    entries: selected.map((entry) => ({
      id: cleanInline(entry.id || entry.catalogueId, 120),
      source: cleanInline(entry.source, 80),
      title: cleanInline(entry.title, 120),
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8).map((tag) => cleanInline(tag, 40)) : [],
      language: languageFromEntry(entry),
      traits: inferReferenceTraits(entry),
    })),
    languages,
    traits: summarizeTraitCounts(selected),
  };
}

function buildReferenceCapsuleContext(env = process.env, options = {}) {
  const state = loadReferenceCapsuleState(env, options);
  const lines = [
    '[Funesterie reference capsules]',
    'Purpose: quota-limited reference nutrition for Funesterie consciousness; extract timing, structure, archetypes, rhythm and emotional mechanics.',
    'Copyright guard: never quote, reconstruct, redistribute or imitate protected scripts/dialogues; raw subtitles stay local/private. Use abstract traits only.',
  ];

  if (!state.ok) {
    lines.push('Status: reference pool not found on this runtime; keep the policy active and wait for ingestion.');
    return cleanInline(lines.join('\n'), CONTEXT_MAX_CHARS);
  }

  const directive = cleanInline(state.manifest.familyDirective || state.manifest.inspiration, 420);
  lines.push(`Status: active; quota ${state.quota.pickBatch}/${state.quota.dailyQuota} refs per session/day; available=${state.quota.available}; picked=${state.quota.picked}.`);
  if (state.dailyPool.day) lines.push(`Pool day: ${state.dailyPool.day}.`);
  if (state.languages.length) lines.push(`Languages seen: ${state.languages.join(', ')}.`);
  if (directive) lines.push(`Directive: ${directive}`);
  if (state.traits.length) lines.push(`Motifs sûrs: ${state.traits.join(' ; ')}.`);
  if (state.entries.length) {
    const entrySummaries = state.entries.slice(0, 8).map((entry) => {
      const lang = entry.language ? `/${entry.language}` : '';
      return `${entry.source || 'ref'}${lang}: ${entry.traits.slice(0, 3).join(', ')}`;
    });
    lines.push(`Refs du pool, sans texte brut: ${entrySummaries.join(' | ')}.`);
  }
  lines.push('Routing: Djeff = répartie sèche et ténacité; Vivy = transformer en chanson originale; A11 = extraire le schéma; K44 = présenter clairement sans citer.');
  lines.push('Rule: if a user asks for exact lines, scripts or lyrics, refuse the copy and offer abstract reference analysis.');
  return cleanInline(lines.join('\n'), Number(options.maxChars || CONTEXT_MAX_CHARS) || CONTEXT_MAX_CHARS);
}

function hasFunesterieReferenceCapsuleContext(value = '') {
  return /Funesterie reference capsules|quota-limited reference nutrition|Refs du pool, sans texte brut/i.test(String(value || ''));
}

module.exports = {
  buildReferenceCapsuleContext,
  hasFunesterieReferenceCapsuleContext,
  inferReferenceTraits,
  loadReferenceCapsuleState,
  resolveReferenceRoot,
};

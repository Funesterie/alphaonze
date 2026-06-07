'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadNossenZen() {
  try {
    return require('@nossen/zen');
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(path.join(__dirname, '..', '..', '..', 'nossen', 'zen', 'src', 'index.cjs'));
  }
}

const zen = loadNossenZen();

const FUNESTE_ZEN_DEFAULTS = Object.freeze({
  intent: 'funesterie-private-corpus',
  corpus: 'funesterie.nossen.private',
  axes: Object.freeze(['R', '+i', '-i', 'rgba', 'mcp', 'neo4j', 'qflush']),
  zone: Object.freeze({
    model: 'Z_m(n)',
    m: 44,
    lane: 'funesterie',
    runtime: 'nossen-docker'
  }),
  routes: Object.freeze([
    Object.freeze({ id: 'mcp.shared', role: 'coordination', target: 'https://mcp.funesterie.me/mcp' }),
    Object.freeze({ id: 'a11.memory', role: 'memory-semantics', target: 'a11' }),
    Object.freeze({ id: 'neo4j.shared', role: 'graph-memory', target: 'a11mcp-shared.neo4j' }),
    Object.freeze({ id: 'neo4j.aura-local', role: 'graph-memory-local', target: 'a11mcp-aura-local.neo4j' }),
    Object.freeze({ id: 'container-runtime', role: 'docker-runtime', primary: 'codex-kiro', fallback: 'chopper/a11' }),
    Object.freeze({ id: 'qflush', role: 'perception-action', target: 'qflush' }),
    Object.freeze({ id: 'kaen44', role: 'client-semantics', target: 'kaen44' }),
    Object.freeze({ id: 'vivy', role: 'media-semantics', target: 'vivy' })
  ]),
  graphHints: Object.freeze([
    Object.freeze(['ZEN', 'ROUTES_TO', 'Funesterie MCP']),
    Object.freeze(['ZEN', 'WRAPS', 'NOSSEN Corpus']),
    Object.freeze(['ZEN', 'USES', 'Neo4j Memory Graph']),
    Object.freeze(['ZEN', 'USES', 'Container Runtime Lane'])
  ]),
  notes: Object.freeze([
    'private @funeste wrapper',
    'keys stay outside .zen files, logs and chat output'
  ])
});

function stableKey(value) {
  if (typeof zen.stableStringify === 'function') {
    return zen.stableStringify(value);
  }
  return JSON.stringify(value);
}

function mergeUnique(base, extra) {
  const seen = new Set();
  const merged = [];
  for (const item of [...(base || []), ...(Array.isArray(extra) ? extra : [])]) {
    const key = stableKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function buildFunesteZenManifest(manifest = {}) {
  const zone = {
    ...FUNESTE_ZEN_DEFAULTS.zone,
    ...(manifest.zone && typeof manifest.zone === 'object' ? manifest.zone : {})
  };

  return zen.buildZenManifest({
    ...manifest,
    intent: manifest.intent || FUNESTE_ZEN_DEFAULTS.intent,
    corpus: manifest.corpus || FUNESTE_ZEN_DEFAULTS.corpus,
    axes: mergeUnique(FUNESTE_ZEN_DEFAULTS.axes, manifest.axes),
    zone,
    fragments: Array.isArray(manifest.fragments) ? manifest.fragments : [],
    routes: mergeUnique(FUNESTE_ZEN_DEFAULTS.routes, manifest.routes),
    graphHints: mergeUnique(FUNESTE_ZEN_DEFAULTS.graphHints, manifest.graphHints),
    notes: mergeUnique(FUNESTE_ZEN_DEFAULTS.notes, manifest.notes)
  });
}

function resolveFunesteZenKey(options = {}) {
  const key = options.key || process.env.FUNESTE_ZEN_KEY || process.env.ZEN_KEY || '';
  if (!key && options.allowPlaintext !== true) {
    throw new Error('FUNESTE_ZEN_KEY or ZEN_KEY is required for @funeste/zen encrypted containers');
  }
  return key;
}

function encodeFunesteZenContainer(input, options = {}) {
  return zen.encodeZenContainer(input, {
    ...options,
    key: resolveFunesteZenKey(options),
    manifest: buildFunesteZenManifest(options.manifest || {})
  });
}

function decodeFunesteZenContainer(input, options = {}) {
  return zen.decodeZenContainer(input, {
    ...options,
    key: resolveFunesteZenKey(options)
  });
}

function encodeFunesteZenFile(inputPath, outputPath, options = {}) {
  const raw = fs.readFileSync(inputPath);
  const out = outputPath || `${inputPath}.zen`;
  const manifest = buildFunesteZenManifest({
    source: options.source !== undefined ? options.source : { fileName: path.basename(inputPath) },
    ...(options.manifest || {})
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, encodeFunesteZenContainer(raw, { ...options, manifest }));
  return out;
}

function materializeContainerData(container) {
  const data = container && container.data;
  if (!data || typeof data !== 'object') {
    throw new Error('ZEN container has no materializable data payload');
  }
  if (data.encoding === 'base64') {
    return Buffer.from(data.value, 'base64');
  }
  if (data.encoding === 'json') {
    return Buffer.from(JSON.stringify(data.value, null, 2), 'utf8');
  }
  throw new Error(`Unsupported @funeste/zen payload encoding: ${data.encoding}`);
}

function decodeFunesteZenFile(inputPath, outputPath, options = {}) {
  const decoded = decodeFunesteZenContainer(inputPath, options);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, materializeContainerData(decoded.container));
  }
  return decoded;
}

module.exports = {
  ...zen,
  FUNESTE_ZEN_DEFAULTS,
  buildFunesteZenManifest,
  decodeFunesteZenContainer,
  decodeFunesteZenFile,
  encodeFunesteZenContainer,
  encodeFunesteZenFile,
  materializeContainerData,
  resolveFunesteZenKey
};

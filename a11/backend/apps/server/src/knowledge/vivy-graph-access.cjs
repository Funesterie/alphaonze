'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PACK_ID = 'vivy-funesterie-graph-v1';
const DEFAULT_CHUNK_CHARS = 1800;
const DEFAULT_MAX_FILE_BYTES = 900 * 1024;
const DEFAULT_MAX_CHUNKS_PER_FILE = 180;

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.ps1',
  '.ts',
  '.tsx',
  '.yml',
  '.yaml',
]);

const SECRETISH_RE = /(^|[\\/])(?:\.env(?:\..*)?|secrets?|credentials?|private|tokens?|passwords?|\.kiro[\\/]settings[\\/]mcp\.json)(?:[\\/]|$)|\.(?:pem|pfx|key)$/i;
const SKIP_DIR_RE = /(^|[\\/])(?:node_modules|\.git|dist|build|coverage|runtime|out|tmp|temp|uploads|voice-library|tts|double-harmonic|qa-captures)(?:[\\/]|$)/i;
const SECRET_TEXT_RE = /(bearer\s+[a-z0-9._~+/=-]{16,}|hf_[a-z0-9]{16,}|sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9_]{20,}|(?:api[_-]?key|token|password|secret|mot de passe)\s*[:=]\s*['"]?[^'"\s]{8,})/gi;

const DEFAULT_SOURCE_FILES = [
  ['a11/docs/VIVY_TWITCH_OBS.md', 'live-twitch-obs', 'Regles Twitch, OBS, votes, longueur, humour, intent router et workflow Vivy Live.'],
  ['a11/docs/WORKFLOW_IMPROVEMENTS.md', 'workflow', 'Ameliorations workflow et decisions recentes.'],
  ['a11/docs/A11_MCP_AI_AUTOPILOT.md', 'mcp', 'Regles d usage MCP et autopilote A11.'],
  ['a11/docs/A11_MCP_AI_IDENTITIES.md', 'mcp', 'Identites IA MCP: ChatGPT, Grok, Claude, Vivy, A11, K44, droits de dialogue et garde-fous anti-admin.'],
  ['a11/docs/A11_NEO4J_MEMORY_ROUTER.md', 'neo4j', 'Routage Aura/local pour la memoire Neo4j.'],
  ['a11/docs/A11_SEMANTIC_RESONANCE_ENGINE.md', 'semantic', 'Resonance semantique, double sens et contexte culturel.'],
  ['a11/docs/VIVY_VIDEO_DEBROUILLE_TOOLKIT.md', 'video', 'Boite a outils montage video: storyboard, boucles, recadrage, FFmpeg, Comfy et garde-fous anti 3x3 automatique.'],
  ['a11/docs/KNOWLEDGE_GRAPH.md', 'neo4j', 'Documentation generale knowledge graph.'],
  ['a11/backend/apps/server/package.json', 'config', 'Scripts backend disponibles pour MCP, Neo4j, workers et Vivy.'],
  ['a11/backend/apps/server/src/routes/vivy-studio.cjs', 'vivy-studio', 'Route principale Vivy Studio: chat, chanson, providers, payloads Suno/Mureka.'],
  ['a11/backend/apps/server/src/routes/vivy-stream.cjs', 'vivy-stream', 'Routes Twitch live, overlay, votes, state et generation automatique.'],
  ['a11/backend/apps/server/src/vivy/twitch-nossen-runner.cjs', 'vivy-live', 'Runner de generation NOSSEN depuis Twitch.'],
  ['a11/backend/apps/server/src/music/vivy-songcraft.cjs', 'songcraft', 'Heuristiques de chanson, humour, allusions et structures lyriques.'],
  ['a11/backend/apps/server/src/vivy/prosody-prime-complex.cjs', 'prosody', 'Prosodie et graphe prime/complex Vivy.'],
  ['a11/backend/apps/server/scripts/vivy-twitch-chat-worker.cjs', 'twitch-worker', 'Worker Twitch: live gate, chat, annonces, reset et ingestion.'],
  ['a11/backend/apps/server/src/desktop/mcp-bridge.cjs', 'mcp', 'Pont MCP desktop/public/local.'],
  ['a11/backend/apps/server/src/mcp-client.cjs', 'mcp', 'Client MCP backend et liste d outils autorises.'],
  ['a11/backend/apps/server/tools/mcp/a11-mcp-server.cjs', 'mcp', 'Serveur MCP local A11 et outils exposes aux agents.'],
  ['a11/backend/apps/server/lib/mcp-intent-router.cjs', 'mcp', 'Routage des intentions MCP.'],
  ['a11/backend/apps/server/lib/neo4j-memory-router.cjs', 'neo4j', 'Routeur memoire Neo4j Aura/local.'],
  ['a11/backend/apps/server/lib/neo4j-adapter.cjs', 'neo4j', 'Adaptateur historique Neo4j.'],
  ['a11/backend/apps/server/test/vivy-studio-route.node.test.cjs', 'tests', 'Contrats Vivy Studio et regressions de prompt.'],
  ['a11/backend/apps/server/test/vivy-stream-route.node.test.cjs', 'tests', 'Contrats Vivy Stream/Twitch.'],
  ['a11/backend/apps/server/test/mcp-server.node.test.cjs', 'tests', 'Contrats MCP local A11.'],
];

function hashText(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function cleanOneLine(value = '', fallback = '', max = 180) {
  const text = String(value || fallback || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!max || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function resolveVivyGraphRoots(options = {}) {
  const serverRoot = path.resolve(options.serverRoot || path.join(__dirname, '..', '..'));
  const a11Root = path.resolve(options.a11Root || process.env.A11_WORKSPACE_ROOT || path.join(serverRoot, '..', '..', '..'));
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(a11Root, '..'));
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A11_RUNTIME_ROOT || path.join(a11Root, 'runtime'));
  return { serverRoot, a11Root, workspaceRoot, runtimeRoot };
}

function normalizeRelPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSecretishPath(filePath = '') {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return SECRETISH_RE.test(normalized) || SKIP_DIR_RE.test(normalized);
}

function resolveSourceFile(relPath, roots) {
  const normalized = normalizeRelPath(relPath);
  if (!normalized || isSecretishPath(normalized)) return null;
  const candidates = [path.resolve(roots.workspaceRoot, normalized)];
  const serverPrefix = 'a11/backend/apps/server/';
  const docsPrefix = 'a11/docs/';
  if (normalized.startsWith(serverPrefix)) {
    candidates.push(path.resolve(roots.serverRoot, normalized.slice(serverPrefix.length)));
  }
  if (normalized.startsWith(docsPrefix)) {
    candidates.push(path.resolve(roots.a11Root, 'docs', normalized.slice(docsPrefix.length)));
  }
  for (const abs of candidates) {
    const allowedRoot = abs.startsWith(roots.serverRoot) ? roots.serverRoot : roots.workspaceRoot;
    if (!isPathInside(abs, allowedRoot) || isSecretishPath(abs)) continue;
    if (fs.existsSync(abs)) return abs;
  }
  return candidates[0];
}

function parseExtraSourceFiles(value = '') {
  return String(value || '')
    .split(/[;\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => [entry, 'extra', 'Fichier ajoute explicitement a l index Vivy.']);
}

function buildVivyGraphSourceManifest(options = {}) {
  const roots = resolveVivyGraphRoots(options);
  const sourceRows = [
    ...DEFAULT_SOURCE_FILES,
    ...parseExtraSourceFiles(options.extraFiles || process.env.VIVY_GRAPH_EXTRA_FILES),
  ];
  const seen = new Set();
  const files = [];

  for (const [relPath, kind, why] of sourceRows) {
    const absPath = resolveSourceFile(relPath, roots);
    const rel = normalizeRelPath(relPath);
    if (!absPath || seen.has(rel.toLowerCase())) continue;
    seen.add(rel.toLowerCase());
    const exists = fs.existsSync(absPath);
    let stat = null;
    try {
      stat = exists ? fs.statSync(absPath) : null;
    } catch (_) {
      stat = null;
    }
    const ext = path.extname(absPath).toLowerCase();
    const readable = Boolean(exists && stat?.isFile() && TEXT_EXTENSIONS.has(ext) && !isSecretishPath(absPath));
    files.push({
      id: `vivy-file:${hashText(rel, 20)}`,
      path: rel,
      kind,
      why,
      exists,
      readable,
      sizeBytes: stat?.size || 0,
      updatedAt: stat?.mtime ? stat.mtime.toISOString() : '',
    });
  }

  return {
    schema: 'funesterie.vivy.graph-manifest.v1',
    packId: options.packId || DEFAULT_PACK_ID,
    generatedAt: new Date().toISOString(),
    roots: {
      workspace: 'funesterie:.',
      runtime: 'a11-runtime:.',
    },
    policy: {
      secrets: 'excluded',
      binaries: 'excluded',
      envFiles: 'excluded',
      runtimeAudio: 'excluded',
      writeSurface: 'Neo4j via backend/MCP only',
    },
    files,
    summary: {
      total: files.length,
      readable: files.filter((file) => file.readable).length,
      missing: files.filter((file) => !file.exists).length,
      skipped: files.filter((file) => file.exists && !file.readable).length,
    },
  };
}

function redactSensitiveText(value = '') {
  return String(value || '').replace(SECRET_TEXT_RE, '[redacted-secret]');
}

function readTextFileLimited(absPath, maxBytes) {
  const stat = fs.statSync(absPath);
  const size = stat.size || 0;
  const bytesToRead = Math.min(size, maxBytes);
  const fd = fs.openSync(absPath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, 0);
    const suffix = size > maxBytes ? '\n\n[truncated: file exceeds Vivy graph safety budget]\n' : '';
    return redactSensitiveText(buffer.toString('utf8') + suffix);
  } finally {
    fs.closeSync(fd);
  }
}

function titleFromText(text = '', relPath = '') {
  const firstHeading = String(text || '').split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line));
  if (firstHeading) return cleanOneLine(firstHeading.replace(/^#{1,3}\s+/, ''), path.basename(relPath), 140);
  return cleanOneLine(path.basename(relPath), relPath, 140);
}

function buildKeywordText(text = '', relPath = '', kind = '') {
  const base = [
    kind,
    ...normalizeRelPath(relPath).split(/[\/_.-]+/),
    ...(String(text || '').match(/\b(?:vivy|nossen|twitch|obs|suno|mureka|neo4j|mcp|lyrics|paroles|humour|sarcasme|allusion|phon[ée]tique|double\s+sens|router|worker|stream|studio|graph|graphe)\b/gi) || []),
  ];
  return Array.from(new Set(base.map((item) => String(item || '').toLowerCase()).filter(Boolean))).slice(0, 40).join(' ');
}

function chunkText(text = '', chunkChars = DEFAULT_CHUNK_CHARS, maxChunks = DEFAULT_MAX_CHUNKS_PER_FILE) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const chunks = [];
  let cursor = 0;
  while (cursor < normalized.length && chunks.length < maxChunks) {
    let end = Math.min(normalized.length, cursor + chunkChars);
    if (end < normalized.length) {
      const lastBreak = normalized.lastIndexOf('\n', end);
      if (lastBreak > cursor + Math.floor(chunkChars * 0.55)) end = lastBreak;
    }
    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = Math.max(end, cursor + 1);
  }
  if (cursor < normalized.length && chunks.length) {
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n[truncated: chunk limit reached]`;
  }
  return chunks;
}

function buildVivyGraphCorpus(options = {}) {
  const roots = resolveVivyGraphRoots(options);
  const manifest = buildVivyGraphSourceManifest(options);
  const maxFileBytes = clampInt(options.maxFileBytes || process.env.VIVY_GRAPH_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, 16 * 1024, 4 * 1024 * 1024);
  const chunkChars = clampInt(options.chunkChars || process.env.VIVY_GRAPH_CHUNK_CHARS, DEFAULT_CHUNK_CHARS, 800, 6000);
  const maxChunksPerFile = clampInt(options.maxChunksPerFile || process.env.VIVY_GRAPH_MAX_CHUNKS_PER_FILE, DEFAULT_MAX_CHUNKS_PER_FILE, 8, 600);
  const files = [];
  const chunks = [];

  for (const entry of manifest.files) {
    if (!entry.readable) continue;
    const absPath = resolveSourceFile(entry.path, roots);
    if (!absPath) continue;
    const text = readTextFileLimited(absPath, maxFileBytes);
    const sha256 = crypto.createHash('sha256').update(text).digest('hex');
    const title = titleFromText(text, entry.path);
    const keywordsText = buildKeywordText(text, entry.path, entry.kind);
    const fileChunks = chunkText(text, chunkChars, maxChunksPerFile);
    const file = {
      ...entry,
      title,
      sha256,
      active: true,
      chunkCount: fileChunks.length,
      indexedBytes: Buffer.byteLength(text, 'utf8'),
      keywordsText,
    };
    files.push(file);
    fileChunks.forEach((chunk, index) => {
      chunks.push({
        id: `vivy-chunk:${hashText(`${entry.path}:${index}:${sha256}`, 32)}`,
        fileId: file.id,
        path: entry.path,
        title,
        kind: entry.kind,
        why: entry.why,
        chunkIndex: index,
        text: chunk,
        sha256: crypto.createHash('sha256').update(chunk).digest('hex'),
        keywordsText,
        active: true,
      });
    });
  }

  return {
    schema: 'funesterie.vivy.graph-corpus.v1',
    id: manifest.packId,
    label: 'Vivy Funesterie Graph Access',
    generatedAt: manifest.generatedAt,
    manifest,
    files,
    chunks,
    summary: {
      files: files.length,
      chunks: chunks.length,
      indexedBytes: files.reduce((sum, file) => sum + (file.indexedBytes || 0), 0),
      missing: manifest.summary.missing,
      skipped: manifest.summary.skipped,
    },
  };
}

function toManifestMarkdown(manifest) {
  const lines = [
    '# Vivy Graph Manifest',
    '',
    `Generated: ${manifest.generatedAt}`,
    `Pack: ${manifest.packId}`,
    '',
    '## Policy',
    '',
    '- Secrets, env files, keys and tokens are excluded.',
    '- Runtime audio/video outputs are excluded.',
    '- Writes go through the backend/MCP Neo4j route, not public chat.',
    '',
    '## Files',
    '',
  ];
  for (const file of manifest.files) {
    lines.push(`- ${file.readable ? '[x]' : '[ ]'} ${file.path} (${file.kind}) - ${file.why}`);
  }
  lines.push('');
  return lines.join('\n');
}

function chunkArray(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function endpointListFromTarget(config, target = 'aura') {
  if (target === 'both') return [config.aura, config.local];
  if (target === 'local') return [config.local];
  return [config.aura];
}

async function syncVivyGraphCorpus(options = {}) {
  const {
    resolveRouterConfig,
    sanitizePropertyMap,
    withSession,
  } = require('../../lib/neo4j-memory-router.cjs');

  const corpus = options.corpus || buildVivyGraphCorpus(options);
  const target = String(options.target || process.env.VIVY_GRAPH_NEO4J_TARGET || 'aura').toLowerCase();
  const missing = Number(corpus.manifest?.summary?.missing || 0);
  const allowPartial = options.allowPartial === true || String(process.env.VIVY_GRAPH_ALLOW_PARTIAL_SYNC || '').trim() === '1';
  if (missing > 0 && !allowPartial) {
    return {
      ok: false,
      refused: true,
      reason: 'vivy_graph_manifest_incomplete',
      message: 'Vivy graph sync refused because some allowlisted source files are missing in this runtime. Run from the full workspace or set VIVY_GRAPH_ALLOW_PARTIAL_SYNC=1 intentionally.',
      target,
      corpus: corpus.summary,
      manifest: corpus.manifest.summary,
      missingFiles: corpus.manifest.files
        .filter((file) => !file.exists)
        .map((file) => file.path),
    };
  }
  const config = resolveRouterConfig(process.env);
  const endpoints = endpointListFromTarget(config, target);
  const results = [];

  for (const endpoint of endpoints) {
    const startedAt = Date.now();
    try {
      const summary = await withSession(endpoint, 'write', async (session) => {
        await applyVivyGraphConstraints(session);
        await upsertVivyGraphPack(session, corpus, endpoint, sanitizePropertyMap);
        for (const file of corpus.files) {
          const fileChunks = corpus.chunks.filter((chunk) => chunk.fileId === file.id);
          await upsertVivyGraphFile(session, corpus, file, fileChunks, sanitizePropertyMap);
        }
        await markStaleVivyGraphFiles(session, corpus);
        return countVivyGraphPack(session, corpus.id);
      });
      results.push({
        ok: true,
        name: endpoint.name,
        uri: endpoint.uri,
        database: endpoint.database,
        ...summary,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        ok: false,
        name: endpoint?.name || 'unknown',
        uri: endpoint?.uri || '',
        database: endpoint?.database || '',
        error: error.code || error.name || 'Neo4jError',
        message: String(error.message || error).slice(0, 300),
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  return {
    ok: results.some((result) => result.ok),
    target,
    corpus: corpus.summary,
    endpoints: results,
  };
}

async function applyVivyGraphConstraints(session) {
  const constraints = [
    'CREATE CONSTRAINT vivy_graph_pack_id IF NOT EXISTS FOR (n:VivyGraphPack) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_graph_file_id IF NOT EXISTS FOR (n:VivyGraphFile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT vivy_graph_chunk_id IF NOT EXISTS FOR (n:VivyGraphChunk) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);
}

async function upsertVivyGraphPack(session, corpus, endpoint, sanitizePropertyMap) {
  await session.run(`
    MERGE (pack:VivyGraphPack {id: $id})
    SET pack.label = $label,
        pack.schema = $schema,
        pack.generatedAt = datetime($generatedAt),
        pack.updatedAt = datetime($generatedAt),
        pack.endpointName = $endpointName,
        pack.endpointUri = $endpointUri,
        pack.endpointDatabase = $endpointDatabase,
        pack.summary = $summary,
        pack.policy = $policy
  `, {
    id: corpus.id,
    label: corpus.label,
    schema: corpus.schema,
    generatedAt: corpus.generatedAt,
    endpointName: endpoint.name,
    endpointUri: endpoint.uri,
    endpointDatabase: endpoint.database,
    summary: JSON.stringify(corpus.summary),
    policy: JSON.stringify(sanitizePropertyMap(corpus.manifest.policy || {})),
  });
}

async function upsertVivyGraphFile(session, corpus, file, fileChunks, sanitizePropertyMap) {
  await session.run(`
    MATCH (pack:VivyGraphPack {id: $packId})
    MERGE (file:VivyGraphFile {id: $fileId})
    SET file += $props,
        file.updatedAt = datetime($updatedAt),
        file.indexedAt = datetime($indexedAt)
    MERGE (pack)-[:VIVY_GRAPH_INCLUDES]->(file)
  `, {
    packId: corpus.id,
    fileId: file.id,
    props: sanitizePropertyMap({
      path: file.path,
      title: file.title,
      kind: file.kind,
      why: file.why,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      indexedBytes: file.indexedBytes,
      chunkCount: file.chunkCount,
      keywordsText: file.keywordsText,
      active: true,
    }),
    updatedAt: file.updatedAt || corpus.generatedAt,
    indexedAt: corpus.generatedAt,
  });

  const activeChunkIds = fileChunks.map((chunk) => chunk.id);
  await session.run(`
    MATCH (file:VivyGraphFile {id: $fileId})-[r:HAS_VIVY_GRAPH_CHUNK]->(chunk:VivyGraphChunk)
    WHERE NOT chunk.id IN $activeChunkIds
    DETACH DELETE chunk
  `, { fileId: file.id, activeChunkIds });

  for (const batch of chunkArray(fileChunks, 50)) {
    await session.run(`
      UNWIND $rows AS row
      MATCH (file:VivyGraphFile {id: row.fileId})
      MERGE (chunk:VivyGraphChunk {id: row.id})
      SET chunk += row.props,
          chunk.indexedAt = datetime($indexedAt)
      MERGE (file)-[:HAS_VIVY_GRAPH_CHUNK]->(chunk)
    `, {
      rows: batch.map((chunk) => ({
        id: chunk.id,
        fileId: chunk.fileId,
        props: sanitizePropertyMap({
          fileId: chunk.fileId,
          path: chunk.path,
          title: chunk.title,
          kind: chunk.kind,
          why: chunk.why,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          sha256: chunk.sha256,
          keywordsText: chunk.keywordsText,
          active: true,
        }),
      })),
      indexedAt: corpus.generatedAt,
    });
  }
}

async function markStaleVivyGraphFiles(session, corpus) {
  await session.run(`
    MATCH (pack:VivyGraphPack {id: $packId})-[r:VIVY_GRAPH_INCLUDES]->(file:VivyGraphFile)
    WHERE NOT file.id IN $activeFileIds
    SET file.active = false,
        file.removedAt = datetime($now)
    DELETE r
  `, {
    packId: corpus.id,
    activeFileIds: corpus.files.map((file) => file.id),
    now: corpus.generatedAt,
  });
}

async function countVivyGraphPack(session, packId) {
  const result = await session.run(`
    MATCH (pack:VivyGraphPack {id: $packId})
    OPTIONAL MATCH (pack)-[:VIVY_GRAPH_INCLUDES]->(file:VivyGraphFile)
    OPTIONAL MATCH (file)-[:HAS_VIVY_GRAPH_CHUNK]->(chunk:VivyGraphChunk)
    RETURN count(DISTINCT file) AS files,
           count(DISTINCT chunk) AS chunks
  `, { packId });
  const record = result.records[0];
  return {
    files: Number(record?.get('files')?.toNumber?.() ?? record?.get('files') ?? 0),
    chunks: Number(record?.get('chunks')?.toNumber?.() ?? record?.get('chunks') ?? 0),
  };
}

async function searchVivyGraph(options = {}) {
  const neo4j = require('neo4j-driver');
  const {
    resolveRouterConfig,
    withSession,
  } = require('../../lib/neo4j-memory-router.cjs');
  const query = String(options.query || '').trim();
  if (!query) throw new Error('query is required');
  const terms = Array.from(new Set(
    query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
  )).slice(0, 8);
  if (terms.length === 0) terms.push(query.toLowerCase());
  const source = String(options.source || 'aura').toLowerCase();
  const limit = clampInt(options.limit, 8, 1, 30);
  const config = resolveRouterConfig(process.env);
  const endpoint = source === 'local' ? config.local : config.aura;
  return withSession(endpoint, 'read', async (session) => {
    const result = await session.run(`
      MATCH (chunk:VivyGraphChunk)
      WHERE chunk.active = true
        AND (
          any(term IN $terms WHERE toLower(chunk.text) CONTAINS term)
          OR any(term IN $terms WHERE toLower(chunk.title) CONTAINS term)
          OR any(term IN $terms WHERE toLower(chunk.path) CONTAINS term)
          OR any(term IN $terms WHERE toLower(chunk.keywordsText) CONTAINS term)
        )
      RETURN chunk.path AS path,
             chunk.title AS title,
             chunk.kind AS kind,
             chunk.chunkIndex AS chunkIndex,
             substring(chunk.text, 0, 900) AS preview
      ORDER BY chunk.path ASC, chunk.chunkIndex ASC
      LIMIT $limit
    `, { query, terms, limit: neo4j.int(limit) });
    return {
      ok: true,
      source,
      query,
      terms,
      results: result.records.map((record) => ({
        path: record.get('path'),
        title: record.get('title'),
        kind: record.get('kind'),
        chunkIndex: Number(record.get('chunkIndex')?.toNumber?.() ?? record.get('chunkIndex') ?? 0),
        preview: cleanOneLine(record.get('preview'), '', 900),
      })),
    };
  });
}

module.exports = {
  DEFAULT_PACK_ID,
  buildVivyGraphCorpus,
  buildVivyGraphSourceManifest,
  resolveVivyGraphRoots,
  searchVivyGraph,
  syncVivyGraphCorpus,
  toManifestMarkdown,
};

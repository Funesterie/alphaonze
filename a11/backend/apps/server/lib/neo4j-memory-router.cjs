'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const neo4j = require('neo4j-driver');

const DEFAULT_AURA_DATABASE = 'aa4680d2';
const DEFAULT_LOCAL_DATABASE = 'a11-knowledge-graph';
const DEFAULT_LOCAL_URI = 'neo4j://127.0.0.1:7687';

function hashText(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function isLocalNeo4jUri(uri) {
  return /^(neo4j|bolt)(\+s|\+ssc)?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?/i.test(String(uri || ''));
}

function pick(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function resolveRouterConfig(env = process.env) {
  const aura = {
    name: 'aura',
    uri: pick(env.KIRO_V2, env.NEO4J_AURA_URI, env.A11_AURA_NEO4J_URI),
    username: pick(env.KIRO_V2_USER, env.NEO4J_AURA_USER, env.A11_AURA_NEO4J_USER),
    password: pick(env.KIRO_V2_PASSWORD, env.NEO4J_AURA_PASSWORD, env.A11_AURA_NEO4J_PASSWORD),
    database: pick(env.KIRO_V2_DATABASE, env.NEO4J_AURA_DATABASE, env.A11_AURA_NEO4J_DATABASE, DEFAULT_AURA_DATABASE),
  };

  const envLocalUri = isLocalNeo4jUri(env.NEO4J_URI) ? env.NEO4J_URI : '';
  const local = {
    name: 'local',
    uri: pick(env.A11_LOCAL_NEO4J_URI, env.NEO4J_LOCAL_URI, envLocalUri, DEFAULT_LOCAL_URI),
    username: pick(env.A11_LOCAL_NEO4J_USER, env.NEO4J_LOCAL_USER, env.NEO4J_USERNAME, 'neo4j'),
    password: pick(env.A11_LOCAL_NEO4J_PASSWORD, env.NEO4J_LOCAL_PASSWORD, env.NEO4J_PASSWORD),
    database: pick(env.A11_LOCAL_NEO4J_DATABASE, env.NEO4J_LOCAL_DATABASE, env.NEO4J_DATABASE, DEFAULT_LOCAL_DATABASE),
  };

  return { aura, local };
}

function assertEndpoint(endpoint) {
  if (!endpoint?.uri) throw new Error(`Missing ${endpoint?.name || 'neo4j'} uri`);
  if (!endpoint?.username) throw new Error(`Missing ${endpoint?.name || 'neo4j'} username`);
  if (!endpoint?.password) throw new Error(`Missing ${endpoint?.name || 'neo4j'} password`);
  if (!endpoint?.database) throw new Error(`Missing ${endpoint?.name || 'neo4j'} database`);
}

function createDriver(endpoint) {
  assertEndpoint(endpoint);
  return neo4j.driver(endpoint.uri, neo4j.auth.basic(endpoint.username, endpoint.password), {
    connectionAcquisitionTimeout: 15000,
    maxConnectionPoolSize: 10,
  });
}

async function withSession(endpoint, mode, run) {
  const driver = createDriver(endpoint);
  const session = driver.session({
    database: endpoint.database,
    defaultAccessMode: mode === 'write' ? neo4j.session.WRITE : neo4j.session.READ,
  });
  try {
    await driver.verifyConnectivity();
    return await run(session);
  } finally {
    await session.close().catch(() => {});
    await driver.close().catch(() => {});
  }
}

function toPlainValue(value) {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlainValue);
  if (value && typeof value === 'object') {
    if (typeof value.toString === 'function' && /^(Date|Time|DateTime|Local)/.test(value.constructor?.name || '')) {
      return value.toString();
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = toPlainValue(child);
    return out;
  }
  return value;
}

function isPrimitiveProperty(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function sanitizePropertyValue(value) {
  const plain = toPlainValue(value);
  if (plain === undefined || plain === null) return undefined;
  if (isPrimitiveProperty(plain)) return plain;
  if (Array.isArray(plain) && plain.every(isPrimitiveProperty)) return plain.filter((item) => item !== null);
  return JSON.stringify(plain);
}

function sanitizePropertyMap(properties = {}) {
  const out = {};
  for (const [key, value] of Object.entries(properties || {})) {
    const safeKey = String(key || '').trim();
    if (!safeKey) continue;
    const safeValue = sanitizePropertyValue(value);
    if (safeValue !== undefined) out[safeKey] = safeValue;
  }
  return out;
}

function safeLabel(label) {
  const normalized = String(label || '')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const candidate = normalized || 'A11Unknown';
  return /^[A-Za-z_]/.test(candidate) ? candidate : `L_${candidate}`;
}

function safeRelationshipType(type) {
  const normalized = safeLabel(type).toUpperCase();
  return normalized || 'RELATED_TO';
}

function mergeKeyForNode(node) {
  const props = node.properties || {};
  const id = props.id ?? props.identity ?? props.uuid ?? props.key ?? null;
  if (id !== null && id !== undefined && String(id).trim()) {
    const labelKey = (node.labels || []).map(safeLabel).sort().join('_') || 'Node';
    return `aura:${labelKey}:${String(id)}`;
  }
  return `aura:element:${node.elementId}`;
}

function mergeKeyForRelationship(relationship, startKey, endKey) {
  const props = relationship.properties || {};
  const id = props.id ?? props.identity ?? props.uuid ?? props.key ?? relationship.elementId;
  return `aura:${safeRelationshipType(relationship.type)}:${startKey}:${endKey}:${String(id)}`;
}

function buildMirrorNodeCypher(labels = [], options = {}) {
  const primaryLabel = safeLabel(labels[0] || 'A11AuraMirrorNode');

  if (options.hasSourceId) {
    return `
      MERGE (n:${primaryLabel} {id: $sourceId})
      SET n:A11AuraMirror,
          n += $properties,
          n.a11MirrorKey = $mirrorKey,
          n.a11MirrorSource = 'aura',
          n.a11MirrorLabels = $labels,
          n.a11MirrorPrimaryLabel = $primaryLabel,
          n.a11MirrorSyncedAt = datetime($syncedAt)
      RETURN n
    `;
  }

  return `
    MERGE (n:A11AuraMirror {a11MirrorKey: $mirrorKey})
    SET n += $properties,
        n.a11MirrorSource = 'aura',
        n.a11MirrorLabels = $labels,
        n.a11MirrorPrimaryLabel = $primaryLabel,
        n.a11MirrorSyncedAt = datetime($syncedAt)
    RETURN n
  `;
}

function buildMirrorRelationshipCypher(type) {
  return `
    MATCH (a:A11AuraMirror {a11MirrorKey: $startKey})
    MATCH (b:A11AuraMirror {a11MirrorKey: $endKey})
    MERGE (a)-[r:${safeRelationshipType(type)} {a11MirrorKey: $mirrorKey}]->(b)
    SET r += $properties,
        r.a11MirrorSource = 'aura',
        r.a11MirrorType = $type,
        r.a11MirrorSyncedAt = datetime($syncedAt)
    RETURN r
  `;
}

function formatRecord(record, source) {
  const node = record.get('n');
  const props = sanitizePropertyMap(node.properties || {});
  const labels = node.labels || [];
  return {
    source,
    key: mergeKeyForNode({
      elementId: record.get('elementId') || node.elementId,
      labels,
      properties: props,
    }),
    elementId: record.get('elementId') || node.elementId,
    labels,
    properties: props,
  };
}

function dedupeMemoryResults(results = []) {
  const byKey = new Map();
  for (const result of results) {
    const key = result.key || `${(result.labels || []).join(':')}:${result.elementId || hashText(JSON.stringify(result))}`;
    if (!byKey.has(key)) {
      byKey.set(key, result);
      continue;
    }
    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      sources: [...new Set([...(existing.sources || [existing.source]).filter(Boolean), result.source].filter(Boolean))],
    });
  }
  return Array.from(byKey.values());
}

async function searchEndpoint(endpoint, query, limit) {
  const cypher = `
    MATCH (n)
    WITH n, [
      coalesce(n.id, ''),
      coalesce(n.name, ''),
      coalesce(n.label, ''),
      coalesce(n.title, ''),
      coalesce(n.content, ''),
      coalesce(n.summary, ''),
      coalesce(n.description, '')
    ] AS fields
    WHERE any(field IN fields WHERE toLower(toString(field)) CONTAINS toLower($query))
    RETURN elementId(n) AS elementId, n
    LIMIT $limit
  `;

  return withSession(endpoint, 'read', async (session) => {
    const result = await session.run(cypher, {
      query: String(query || '').trim(),
      limit: neo4j.int(Math.max(1, Math.min(100, Number(limit) || 12))),
    });
    return result.records.map((record) => formatRecord(record, endpoint.name));
  });
}

async function getEndpointStats(endpoint) {
  return withSession(endpoint, 'read', async (session) => {
    const result = await session.run('MATCH (n) OPTIONAL MATCH ()-[r]->() RETURN count(DISTINCT n) AS nodes, count(DISTINCT r) AS relationships');
    const record = result.records[0];
    return {
      name: endpoint.name,
      uri: endpoint.uri,
      database: endpoint.database,
      ok: true,
      nodes: toPlainValue(record.get('nodes')),
      relationships: toPlainValue(record.get('relationships')),
    };
  }).catch((error) => ({
    name: endpoint.name,
    uri: endpoint.uri,
    database: endpoint.database,
    ok: false,
    error: error.code || error.name || 'Neo4jError',
    message: String(error.message || error).slice(0, 240),
  }));
}

async function exportEndpointGraph(endpoint) {
  return withSession(endpoint, 'read', async (session) => {
    const nodeResult = await session.run('MATCH (n) RETURN elementId(n) AS elementId, labels(n) AS labels, properties(n) AS properties ORDER BY elementId(n)');
    const relResult = await session.run(`
      MATCH (a)-[r]->(b)
      RETURN elementId(r) AS elementId,
             type(r) AS type,
             elementId(a) AS startElementId,
             elementId(b) AS endElementId,
             properties(r) AS properties
      ORDER BY elementId(r)
    `);

    return {
      endpoint: {
        name: endpoint.name,
        uri: endpoint.uri,
        database: endpoint.database,
      },
      exportedAt: new Date().toISOString(),
      nodes: nodeResult.records.map((record) => ({
        elementId: record.get('elementId'),
        labels: record.get('labels') || [],
        properties: sanitizePropertyMap(record.get('properties') || {}),
      })),
      relationships: relResult.records.map((record) => ({
        elementId: record.get('elementId'),
        type: record.get('type'),
        startElementId: record.get('startElementId'),
        endElementId: record.get('endElementId'),
        properties: sanitizePropertyMap(record.get('properties') || {}),
      })),
    };
  });
}

class Neo4jMemoryRouter {
  constructor(config = resolveRouterConfig()) {
    this.config = config;
  }

  async status() {
    const [aura, local] = await Promise.all([
      getEndpointStats(this.config.aura),
      getEndpointStats(this.config.local),
    ]);
    return { aura, local };
  }

  async searchMemory(query, options = {}) {
    const limit = options.limit || 12;
    const sources = [];
    const errors = [];
    let auraResults = [];

    try {
      auraResults = await searchEndpoint(this.config.aura, query, limit);
      sources.push('aura');
    } catch (error) {
      errors.push({ source: 'aura', message: String(error.message || error).slice(0, 240) });
    }

    const shouldQueryLocal = options.includeLocal === true || auraResults.length === 0 || errors.length > 0;
    let localResults = [];

    if (shouldQueryLocal) {
      try {
        localResults = await searchEndpoint(this.config.local, query, limit);
        sources.push('local');
      } catch (error) {
        errors.push({ source: 'local', message: String(error.message || error).slice(0, 240) });
      }
    }

    const results = dedupeMemoryResults([...auraResults, ...localResults]).slice(0, limit);
    return {
      ok: results.length > 0 || errors.length < 2,
      query,
      sources,
      errors,
      results,
    };
  }

  async runRead(cypher, params = {}, options = {}) {
    const readEndpoint = options.source === 'local' ? this.config.local : this.config.aura;
    return withSession(readEndpoint, 'read', async (session) => {
      const result = await session.run(cypher, params);
      return result.records.map((record) => record.toObject());
    });
  }

  async runWrite(cypher, params = {}, options = {}) {
    const aura = await withSession(this.config.aura, 'write', async (session) => session.run(cypher, params));
    const mirror = options.skipLocal === true
      ? { ok: true, skipped: true }
      : await withSession(this.config.local, 'write', async (session) => session.run(cypher, params))
          .then(() => ({ ok: true }))
          .catch((error) => ({
            ok: false,
            error: error.code || error.name || 'Neo4jError',
            message: String(error.message || error).slice(0, 240),
          }));

    return {
      ok: true,
      aura: { ok: true, records: aura.records.length },
      local: mirror,
    };
  }

  async writeMemoryNote(content, metadata = {}) {
    const text = String(content || '').trim();
    if (!text) throw new Error('Cannot write an empty memory note');
    const now = new Date().toISOString();
    const id = metadata.id || `memory-note:${hashText(text)}`;
    const safeMetadata = sanitizePropertyMap({
      ...metadata,
      source: metadata.source || 'a11-memory-router',
    });

    const cypher = `
      MERGE (n:MemoryNote {id: $id})
      ON CREATE SET n.createdAt = datetime($now)
      SET n.content = $content,
          n.updatedAt = datetime($now),
          n += $metadata
      RETURN n
    `;

    return this.runWrite(cypher, {
      id,
      content: text,
      now,
      metadata: safeMetadata,
    });
  }

  async syncAuraToLocal() {
    const graph = await exportEndpointGraph(this.config.aura);
    const now = new Date().toISOString();
    const nodeKeyByElementId = new Map();

    await withSession(this.config.local, 'write', async (session) => {
      for (const node of graph.nodes) {
        const mirrorKey = mergeKeyForNode(node);
        const sourceId = node.properties?.id !== undefined && node.properties?.id !== null
          ? String(node.properties.id)
          : '';
        nodeKeyByElementId.set(node.elementId, mirrorKey);
        await session.run(buildMirrorNodeCypher(node.labels, { hasSourceId: !!sourceId }), {
          mirrorKey,
          sourceId,
          primaryLabel: safeLabel(node.labels?.[0] || 'A11AuraMirrorNode'),
          labels: node.labels || [],
          syncedAt: now,
          properties: sanitizePropertyMap({
            ...node.properties,
            a11MirrorElementId: node.elementId,
          }),
        });
      }

      for (const relationship of graph.relationships) {
        const startKey = nodeKeyByElementId.get(relationship.startElementId);
        const endKey = nodeKeyByElementId.get(relationship.endElementId);
        if (!startKey || !endKey) continue;

        await session.run(buildMirrorRelationshipCypher(relationship.type), {
          startKey,
          endKey,
          mirrorKey: mergeKeyForRelationship(relationship, startKey, endKey),
          type: relationship.type,
          syncedAt: now,
          properties: sanitizePropertyMap({
            ...relationship.properties,
            a11MirrorElementId: relationship.elementId,
          }),
        });
      }
    });

    return {
      ok: true,
      syncedAt: now,
      nodes: graph.nodes.length,
      relationships: graph.relationships.length,
    };
  }

  async backupToSeagate(options = {}) {
    const outputRoot = options.outputRoot || resolveBackupRoot();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetDir = path.join(outputRoot, 'a11-neo4j-memory', timestamp);
    await fs.mkdir(targetDir, { recursive: true });

    const [aura, local] = await Promise.all([
      exportEndpointGraph(this.config.aura),
      exportEndpointGraph(this.config.local).catch((error) => ({
        endpoint: {
          name: this.config.local.name,
          uri: this.config.local.uri,
          database: this.config.local.database,
        },
        exportedAt: new Date().toISOString(),
        error: String(error.message || error).slice(0, 240),
        nodes: [],
        relationships: [],
      })),
    ]);

    const files = {
      aura: path.join(targetDir, 'aura-graph.json'),
      local: path.join(targetDir, 'local-graph.json'),
    };

    await fs.writeFile(files.aura, JSON.stringify(aura, null, 2), 'utf8');
    await fs.writeFile(files.local, JSON.stringify(local, null, 2), 'utf8');

    const manifest = {
      ok: true,
      createdAt: new Date().toISOString(),
      targetDir,
      sources: {
        aura: {
          uri: this.config.aura.uri,
          database: this.config.aura.database,
          nodes: aura.nodes.length,
          relationships: aura.relationships.length,
        },
        local: {
          uri: this.config.local.uri,
          database: this.config.local.database,
          nodes: local.nodes.length,
          relationships: local.relationships.length,
          error: local.error || null,
        },
      },
      files: {
        aura: await fileDigest(files.aura),
        local: await fileDigest(files.local),
      },
    };

    const manifestPath = path.join(targetDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    manifest.manifestFile = await fileDigest(manifestPath);

    return manifest;
  }
}

function resolveBackupRoot() {
  const configured = pick(process.env.A11_SEAGATE_ROOT, process.env.A11_BACKUP_ROOT);
  if (configured) return configured;
  if (process.platform === 'win32' && fsSync.existsSync('E:\\')) {
    return 'E:\\A11_BACKUPS';
  }
  return path.resolve(process.cwd(), 'backups');
}

async function fileDigest(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    path: filePath,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

module.exports = {
  Neo4jMemoryRouter,
  buildMirrorNodeCypher,
  buildMirrorRelationshipCypher,
  dedupeMemoryResults,
  exportEndpointGraph,
  getEndpointStats,
  hashText,
  isLocalNeo4jUri,
  mergeKeyForNode,
  resolveBackupRoot,
  resolveRouterConfig,
  safeLabel,
  safeRelationshipType,
  sanitizePropertyMap,
};

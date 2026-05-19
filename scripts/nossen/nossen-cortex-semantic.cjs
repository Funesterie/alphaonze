#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SIBLING_MAIN_ROOT = path.resolve(path.dirname(REPO_ROOT), 'funesterie');
const DEFAULT_BLOOP_REPORT = path.join(REPO_ROOT, 'runtime', 'nossen', 'bloop', 'bloop-report.json');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runtime', 'nossen', 'semantic');
const DEFAULT_CORTEX_INBOX = path.join(REPO_ROOT, 'runtime', 'nossen', 'cortex-inbox');
const SOURCE = 'nossen-cortex-semantic';
const SCHEMA = 'nossen-cortex-semantic/v1';
const DEFAULT_AURA_URI = 'neo4j+s://aa4680d2.databases.neo4j.io';
const DEFAULT_AURA_USER = 'aa4680d2';
const DEFAULT_AURA_DATABASE = 'aa4680d2';
const DEFAULT_LOCAL_URI = 'neo4j://127.0.0.1:7687';
const DEFAULT_LOCAL_USER = 'neo4j';
const DEFAULT_LOCAL_DATABASE = 'neo4j';

const DEFAULT_ENV_FILES = [
  path.join(REPO_ROOT, '.env.local'),
  path.join(REPO_ROOT, '.env'),
  path.join(REPO_ROOT, 'a11', '.env.local'),
  path.join(REPO_ROOT, 'a11', '.env'),
  path.join(REPO_ROOT, 'a11', 'backend', '.env.local'),
  path.join(REPO_ROOT, 'a11', 'backend', '.env'),
  path.join(REPO_ROOT, 'a11', 'backend', 'apps', 'server', '.env.local'),
  path.join(REPO_ROOT, 'a11', 'backend', 'apps', 'server', '.env'),
];

function parseArgs(argv) {
  const options = {
    report: DEFAULT_BLOOP_REPORT,
    outDir: DEFAULT_OUT_DIR,
    cortexInbox: DEFAULT_CORTEX_INBOX,
    target: 'aura',
    sync: false,
    dryRun: true,
    emitCortex: false,
    writeReportNode: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--report') {
      options.report = requireValue(argv, i += 1, arg);
    } else if (arg === '--out-dir') {
      options.outDir = requireValue(argv, i += 1, arg);
    } else if (arg === '--cortex-inbox') {
      options.cortexInbox = requireValue(argv, i += 1, arg);
    } else if (arg === '--target') {
      options.target = requireValue(argv, i += 1, arg);
    } else if (arg === '--sync') {
      options.sync = true;
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.sync = false;
    } else if (arg === '--emit-cortex') {
      options.emitCortex = true;
    } else if (arg === '--write-report-node') {
      options.writeReportNode = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log(`NOSSEN Cortex Semantic SHA map

Usage:
  node scripts/nossen/nossen-cortex-semantic.cjs [options]

Options:
  --report <path>         BLOOP report JSON to read.
  --out-dir <path>        Directory for generated reports.
  --dry-run               Generate reports only. Default.
  --sync                  Append semantic SHA map to Neo4j.
  --target <aura|local>   Neo4j target for --sync. Default: aura.
  --emit-cortex           Also write a Cortex packet JSON to the inbox.
  --cortex-inbox <path>   Cortex packet inbox directory.
  --write-report-node     Store the generated packet payload on the map node.
  --help                  Show this help.
`);
}

function loadKnownEnv() {
  for (const workspaceRoot of resolveWorkspaceRoots()) {
    for (const envPath of [
      path.join(workspaceRoot, '.env.local'),
      path.join(workspaceRoot, '.env'),
      path.join(workspaceRoot, 'a11', '.env.local'),
      path.join(workspaceRoot, 'a11', '.env'),
      path.join(workspaceRoot, 'a11', 'backend', '.env.local'),
      path.join(workspaceRoot, 'a11', 'backend', '.env'),
      path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', '.env.local'),
      path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', '.env'),
    ]) {
      loadEnvIfExists(envPath);
    }
  }
  for (const envPath of DEFAULT_ENV_FILES) loadEnvIfExists(envPath);
}

function loadEnvIfExists(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    const value = unquote(line.slice(index + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stableHash(value, size = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, size);
}

function slug(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'unknown';
}

function normalizeStatus(status) {
  return String(status || 'unknown').toLowerCase();
}

function normalizeGroup(group) {
  return String(group || 'unknown').toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pickLabel(entry) {
  return (
    entry.name ||
    entry.title ||
    entry.path ||
    entry.url ||
    entry.id ||
    entry.nodeId ||
    'node'
  );
}

function buildSemanticMap(report) {
  const now = new Date().toISOString();
  const entries = Array.isArray(report.entries) ? report.entries : [];
  const hashEntries = entries.filter((entry) => entry && entry.expectedHash);
  const shaByHash = new Map();
  const clusters = new Map();
  const clusterSha = new Map();
  const observations = [];

  for (const entry of hashEntries) {
    const hash = String(entry.expectedHash).trim();
    if (!hash) continue;

    const group = normalizeGroup(entry.semanticGroup);
    const semanticKey = entry.semanticKey || `sha:${group}:${stableHash(hash, 8)}`;
    const status = normalizeStatus(entry.status);
    const labels = Array.isArray(entry.labels) ? entry.labels : [];
    const shaId = `nossen:sha:${stableHash(hash, 32)}`;
    const clusterId = `nossen:semantic:${slug(group)}:${stableHash(semanticKey, 16)}`;
    const label = String(pickLabel(entry)).slice(0, 240);

    if (!shaByHash.has(hash)) {
      shaByHash.set(hash, {
        id: shaId,
        kind: 'nossen-sha',
        schema: SCHEMA,
        label: `SHA ${hash.slice(0, 12)}`,
        hash,
        hashPrefix: hash.slice(0, 16),
        hashProperty: entry.hashProperty || 'unknown',
        semanticGroups: new Set(),
        statuses: new Set(),
        labels: new Set(),
        sourceNodeIds: new Set(),
        observationCount: 0,
        duplicate: false,
        updatedAt: now,
      });
    }

    const shaNode = shaByHash.get(hash);
    shaNode.semanticGroups.add(group);
    shaNode.statuses.add(status);
    for (const nodeLabel of labels) shaNode.labels.add(nodeLabel);
    if (entry.id || entry.nodeId) shaNode.sourceNodeIds.add(entry.id || entry.nodeId);
    shaNode.observationCount += 1;
    shaNode.duplicate = shaNode.observationCount > 1;

    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, {
        id: clusterId,
        kind: 'nossen-semantic-cluster',
        schema: SCHEMA,
        label: semanticKey.replace(/^sha:/, '').slice(0, 160),
        group,
        semanticKey,
        sourceReportId: report.id || 'unknown',
        shaIds: new Set(),
        statuses: new Set(),
        labels: new Set(),
        entryCount: 0,
        confidence: 0,
        updatedAt: now,
      });
    }

    const cluster = clusters.get(clusterId);
    cluster.shaIds.add(shaId);
    cluster.statuses.add(status);
    cluster.labels.add(label);
    cluster.entryCount += 1;

    const linkKey = `${clusterId}\n${shaId}`;
    if (!clusterSha.has(linkKey)) {
      clusterSha.set(linkKey, {
        clusterId,
        shaId,
        group,
        semanticKey,
        label: `groups ${hash.slice(0, 12)}`,
        statuses: new Set(),
        observationCount: 0,
        strength: 0,
      });
    }
    const link = clusterSha.get(linkKey);
    link.statuses.add(status);
    link.observationCount += 1;

    if (entry.elementId) {
      observations.push({
        shaId,
        elementId: entry.elementId,
        nodeId: entry.id || entry.nodeId || label,
        labels,
        group,
        semanticKey,
        status,
        label,
        hashProperty: entry.hashProperty || 'unknown',
      });
    }
  }

  const statusSummary = {};
  const groupSummary = {};
  for (const entry of hashEntries) {
    const status = normalizeStatus(entry.status);
    const group = normalizeGroup(entry.semanticGroup);
    statusSummary[status] = (statusSummary[status] || 0) + 1;
    groupSummary[group] = (groupSummary[group] || 0) + 1;
  }

  const shaNodes = [...shaByHash.values()].map((shaNode) => ({
    ...shaNode,
    semanticGroups: unique([...shaNode.semanticGroups]).sort(),
    statuses: unique([...shaNode.statuses]).sort(),
    labels: unique([...shaNode.labels]).sort(),
    sourceNodeIds: unique([...shaNode.sourceNodeIds]).sort(),
    summary: `${shaNode.observationCount} observation(s), groups: ${unique([...shaNode.semanticGroups]).join(', ') || 'unknown'}`,
  }));

  const clusterNodes = [...clusters.values()].map((cluster) => {
    const okCount = cluster.statuses.has('ok') ? 1 : 0;
    const confidence = cluster.entryCount <= 0 ? 0 : Math.round(((okCount + Math.min(cluster.entryCount, 5)) / (cluster.entryCount + 5)) * 100) / 100;
    return {
      ...cluster,
      shaIds: unique([...cluster.shaIds]).sort(),
      statuses: unique([...cluster.statuses]).sort(),
      labels: unique([...cluster.labels]).slice(0, 20),
      shaCount: cluster.shaIds.size,
      confidence,
      summary: `${cluster.group}: ${cluster.entryCount} observation(s), ${cluster.shaIds.size} SHA(s)`,
    };
  }).sort((a, b) => b.entryCount - a.entryCount || a.group.localeCompare(b.group));

  const clusterLinks = [...clusterSha.values()].map((link) => ({
    ...link,
    statuses: unique([...link.statuses]).sort(),
    status: link.statuses.has('mismatch') ? 'needs-review' : link.statuses.has('missing') ? 'missing' : 'active',
    strength: Math.max(1, link.observationCount),
  }));

  const scope = {
    id: 'nossen-semantic-map',
    kind: 'nossen-semantic-map',
    schema: SCHEMA,
    label: 'NOSSEN semantic SHA map',
    source: SOURCE,
    sourceReportId: report.id || 'unknown',
    generatedAt: now,
    target: report.target || 'unknown',
    database: report.database || 'unknown',
    shaCount: shaNodes.length,
    clusterCount: clusterNodes.length,
    observationCount: observations.length,
    statusSummary: JSON.stringify(statusSummary),
    groupSummary: JSON.stringify(groupSummary),
    updatedAt: now,
  };

  const cortexPacket = {
    version: 1,
    kind: 'cortex-packet',
    type: 'cortex:nossen-semantic-map',
    id: `cortex-nossen-semantic-${stableHash(`${scope.sourceReportId}:${now}`, 16)}`,
    payload: {
      schema: SCHEMA,
      generatedAt: now,
      sourceReportId: scope.sourceReportId,
      summary: {
        shaCount: scope.shaCount,
        clusterCount: scope.clusterCount,
        observationCount: scope.observationCount,
        statusSummary,
        groupSummary,
      },
      scope,
      clusters: clusterNodes,
      shas: shaNodes,
      clusterLinks,
      observations,
      safety: {
        mode: 'append-only',
        noBruteforce: true,
        source: 'BLOOP report only',
      },
    },
  };
  cortexPacket.payloadLen = Buffer.byteLength(JSON.stringify(cortexPacket.payload), 'utf8');
  cortexPacket.totalLen = Buffer.byteLength(JSON.stringify(cortexPacket), 'utf8');

  return {
    scope,
    clusters: clusterNodes,
    shaNodes,
    clusterLinks,
    observations,
    cortexPacket,
  };
}

function writeReports(model, options) {
  ensureDir(options.outDir);
  const jsonPath = path.join(options.outDir, 'nossen-semantic-map.json');
  const mdPath = path.join(options.outDir, 'nossen-semantic-map.md');
  const cypherPath = path.join(options.outDir, 'nossen-semantic-map.cypher');
  const cortexPath = path.join(options.outDir, 'cortex-packet.json');

  fs.writeFileSync(jsonPath, JSON.stringify({
    schema: SCHEMA,
    generatedAt: model.scope.generatedAt,
    scope: model.scope,
    clusters: model.clusters,
    shaNodes: model.shaNodes,
    clusterLinks: model.clusterLinks,
    observations: model.observations,
  }, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(model));
  fs.writeFileSync(cypherPath, renderCypherPreview());
  fs.writeFileSync(cortexPath, JSON.stringify(model.cortexPacket, null, 2));

  let inboxPath = null;
  if (options.emitCortex) {
    ensureDir(options.cortexInbox);
    inboxPath = path.join(options.cortexInbox, `${model.cortexPacket.id}.json`);
    fs.writeFileSync(inboxPath, JSON.stringify(model.cortexPacket, null, 2));
  }

  return { jsonPath, mdPath, cypherPath, cortexPath, inboxPath };
}

function renderMarkdown(model) {
  const lines = [];
  lines.push('# NOSSEN Cortex Semantic SHA Map');
  lines.push('');
  lines.push(`Generated: ${model.scope.generatedAt}`);
  lines.push(`Source report: ${model.scope.sourceReportId}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- SHA nodes: ${model.scope.shaCount}`);
  lines.push(`- Semantic clusters: ${model.scope.clusterCount}`);
  lines.push(`- Observations linked to Neo4j nodes: ${model.scope.observationCount}`);
  lines.push(`- Status summary: \`${model.scope.statusSummary}\``);
  lines.push(`- Group summary: \`${model.scope.groupSummary}\``);
  lines.push('');
  lines.push('## Clusters');
  lines.push('');
  lines.push('| Group | Cluster | SHA | Entries | Status |');
  lines.push('| --- | --- | ---: | ---: | --- |');
  for (const cluster of model.clusters.slice(0, 80)) {
    lines.push(`| ${cluster.group} | ${escapeTable(cluster.label)} | ${cluster.shaCount} | ${cluster.entryCount} | ${escapeTable(cluster.statuses.join(', '))} |`);
  }
  if (model.clusters.length > 80) {
    lines.push(`| ... | ${model.clusters.length - 80} more clusters | | | |`);
  }
  lines.push('');
  lines.push('## Safety');
  lines.push('');
  lines.push('- This pass only reads a BLOOP report generated from known Neo4j hashes.');
  lines.push('- It does not generate hashes, scan the internet, or read secret files.');
  lines.push('- Neo4j sync is append-only: semantic map, clusters, SHA nodes, and links.');
  lines.push('');
  lines.push('## Next');
  lines.push('');
  lines.push('- Use the clusters as a semantic router for agents.');
  lines.push('- Keep mismatches visible for review instead of deleting anything.');
  lines.push('- Add richer embeddings later if a local model is available.');
  lines.push('');
  return `${lines.join(os.EOL)}${os.EOL}`;
}

function escapeTable(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderCypherPreview() {
  return [
    '// Preview only. The script performs this sync through neo4j-driver when --sync is used.',
    'CREATE CONSTRAINT nossen_semantic_map_id IF NOT EXISTS FOR (n:NossenSemanticMap) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT nossen_semantic_cluster_id IF NOT EXISTS FOR (n:NossenSemanticCluster) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT nossen_sha_id IF NOT EXISTS FOR (n:NossenSha) REQUIRE n.id IS UNIQUE;',
    'MERGE (:FunesterieEcosystemNode:NossenSemanticMap {id: "nossen-semantic-map"});',
    '// MERGE semantic clusters, SHA nodes, and FUNESTERIE_ECOSYSTEM_LINK relationships.',
    '',
  ].join(os.EOL);
}

function requireNeo4jDriver() {
  const candidates = ['neo4j-driver'];
  for (const workspaceRoot of resolveWorkspaceRoots()) {
    candidates.push(path.join(workspaceRoot, 'node_modules', 'neo4j-driver'));
    candidates.push(path.join(workspaceRoot, 'a11', 'backend', 'apps', 'server', 'node_modules', 'neo4j-driver'));
    candidates.push(path.join(workspaceRoot, 'a11', 'backend', 'node_modules', 'neo4j-driver'));
  }
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error('neo4j-driver not found. Run npm install in a11/backend/apps/server first.');
}

function resolveWorkspaceRoots() {
  return Array.from(new Set([
    REPO_ROOT,
    process.env.FUNESTERIE_WORKSPACE_ROOT,
    SIBLING_MAIN_ROOT,
  ].filter(Boolean).map((root) => path.resolve(root)))).filter((root) => fs.existsSync(root));
}

function pick(env, keys) {
  for (const key of keys) {
    if (env[key] !== undefined && env[key] !== '') return env[key];
  }
  return undefined;
}

function resolveRouterConfigFromEnv(env, target) {
  if (target === 'local') {
    return {
      target,
      uri: pick(env, ['NOSSEN_LOCAL_NEO4J_URI', 'LOCAL_NEO4J_URI', 'NEO4J_LOCAL_URI']) || DEFAULT_LOCAL_URI,
      user: pick(env, ['NOSSEN_LOCAL_NEO4J_USER', 'LOCAL_NEO4J_USER', 'NEO4J_LOCAL_USER']) || DEFAULT_LOCAL_USER,
      password: pick(env, ['NOSSEN_LOCAL_NEO4J_PASSWORD', 'LOCAL_NEO4J_PASSWORD', 'NEO4J_LOCAL_PASSWORD', 'NEO4J_PASSWORD']) || 'neo4j',
      database: pick(env, ['NOSSEN_LOCAL_NEO4J_DATABASE', 'LOCAL_NEO4J_DATABASE', 'NEO4J_LOCAL_DATABASE']) || DEFAULT_LOCAL_DATABASE,
    };
  }

  return {
    target: 'aura',
    uri: pick(env, ['KIRO_V2_URI', 'AURA_NEO4J_URI', 'NEO4J_AURA_URI', 'NEO4J_URI']) || DEFAULT_AURA_URI,
    user: pick(env, ['KIRO_V2_USER', 'AURA_NEO4J_USER', 'NEO4J_AURA_USER', 'NEO4J_USERNAME']) || DEFAULT_AURA_USER,
    password: pick(env, ['KIRO_V2_PASSWORD', 'AURA_NEO4J_PASSWORD', 'NEO4J_AURA_PASSWORD', 'NEO4J_PASSWORD']),
    database: pick(env, ['KIRO_V2_DATABASE', 'AURA_NEO4J_DATABASE', 'NEO4J_AURA_DATABASE', 'NEO4J_DATABASE']) || DEFAULT_AURA_DATABASE,
  };
}

function redactUri(uri) {
  return String(uri || '').replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
}

function toNeo4jProps(record) {
  const props = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      props[key] = value.map((item) => String(item)).slice(0, 200);
    } else if (typeof value === 'object') {
      props[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      props[key] = value;
    }
  }
  return props;
}

async function syncNeo4j(model, options) {
  loadKnownEnv();
  const neo4j = requireNeo4jDriver();
  const config = resolveRouterConfigFromEnv(process.env, options.target);
  if (!config.password) {
    throw new Error(`Missing Neo4j password for target ${config.target}`);
  }

  const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
  const session = driver.session({ database: config.database, defaultAccessMode: neo4j.session.WRITE });
  const now = new Date().toISOString();

  const scope = toNeo4jProps({
    ...model.scope,
    packetPayloadJson: options.writeReportNode ? JSON.stringify(model.cortexPacket.payload) : undefined,
  });
  const clusters = model.clusters.map((cluster) => toNeo4jProps(cluster));
  const shaNodes = model.shaNodes.map((shaNode) => toNeo4jProps(shaNode));
  const clusterLinks = model.clusterLinks.map((link) => toNeo4jProps(link));
  const observations = model.observations.map((obs) => toNeo4jProps(obs));

  try {
    await session.run('CREATE CONSTRAINT nossen_semantic_map_id IF NOT EXISTS FOR (n:NossenSemanticMap) REQUIRE n.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT nossen_semantic_cluster_id IF NOT EXISTS FOR (n:NossenSemanticCluster) REQUIRE n.id IS UNIQUE');
    await session.run('CREATE CONSTRAINT nossen_sha_id IF NOT EXISTS FOR (n:NossenSha) REQUIRE n.id IS UNIQUE');

    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MERGE (scope:FunesterieEcosystemNode:NossenSemanticMap {id: $scope.id})
        SET scope += $scope, scope.updatedAt = $now
        `,
        { scope, now },
      );

      await tx.run(
        `
        UNWIND $clusters AS cluster
        MERGE (c:FunesterieEcosystemNode:NossenSemanticCluster {id: cluster.id})
        SET c += cluster, c.updatedAt = $now
        `,
        { clusters, now },
      );

      await tx.run(
        `
        UNWIND $shaNodes AS sha
        MERGE (s:FunesterieEcosystemNode:NossenSha {id: sha.id})
        SET s += sha, s.updatedAt = $now
        `,
        { shaNodes, now },
      );

      await tx.run(
        `
        UNWIND $clusters AS cluster
        MATCH (scope:NossenSemanticMap {id: $scopeId})
        MATCH (c:NossenSemanticCluster {id: cluster.id})
        MERGE (scope)-[link:FUNESTERIE_ECOSYSTEM_LINK {
          kind: 'defines-semantic-cluster',
          source: $source,
          targetId: cluster.id
        }]->(c)
        SET link.label = cluster.label,
            link.status = 'active',
            link.updatedAt = $now
        `,
        { clusters, scopeId: scope.id, source: SOURCE, now },
      );

      await tx.run(
        `
        UNWIND $clusterLinks AS item
        MATCH (c:NossenSemanticCluster {id: item.clusterId})
        MATCH (s:NossenSha {id: item.shaId})
        MERGE (c)-[link:FUNESTERIE_ECOSYSTEM_LINK {
          kind: 'groups-sha',
          source: $source,
          targetId: item.shaId
        }]->(s)
        SET link.label = item.label,
            link.status = item.status,
            link.semanticGroup = item.group,
            link.semanticKey = item.semanticKey,
            link.strength = item.strength,
            link.updatedAt = $now
        `,
        { clusterLinks, source: SOURCE, now },
      );

      await tx.run(
        `
        UNWIND $observations AS obs
        MATCH (s:NossenSha {id: obs.shaId})
        MATCH (n) WHERE elementId(n) = obs.elementId
        MERGE (s)-[link:FUNESTERIE_ECOSYSTEM_LINK {
          kind: 'observed-on-node',
          source: $source,
          targetId: obs.nodeId
        }]->(n)
        SET link.label = obs.label,
            link.status = obs.status,
            link.semanticGroup = obs.group,
            link.semanticKey = obs.semanticKey,
            link.hashProperty = obs.hashProperty,
            link.updatedAt = $now
        `,
        { observations, source: SOURCE, now },
      );
    });

    return {
      target: config.target,
      uri: redactUri(config.uri),
      database: config.database,
      clusters: clusters.length,
      shaNodes: shaNodes.length,
      observations: observations.length,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const reportPath = path.resolve(options.report);
  if (!fs.existsSync(reportPath)) {
    throw new Error(`BLOOP report not found: ${reportPath}`);
  }

  const report = readJson(reportPath);
  const model = buildSemanticMap(report);
  const outputs = writeReports(model, options);

  let sync = null;
  if (options.sync && !options.dryRun) {
    sync = await syncNeo4j(model, options);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: options.sync && !options.dryRun ? 'sync' : 'dry-run',
    report: reportPath,
    summary: {
      shaCount: model.scope.shaCount,
      clusterCount: model.scope.clusterCount,
      observationCount: model.scope.observationCount,
      statusSummary: JSON.parse(model.scope.statusSummary),
      groupSummary: JSON.parse(model.scope.groupSummary),
    },
    outputs,
    sync,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[nossen-cortex-semantic] ${error.message}`);
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const neo4j = require('neo4j-driver');

const DEFAULTS = {
  workspaceRoot: 'D:\\projets\\funesterie',
  codexHome: 'C:\\Users\\Djeff\\.codex',
  agentBus: 'C:\\Users\\Djeff\\OneDrive\\a11_memory\\agent-bus',
  heartbeatRoot: 'C:\\Users\\Djeff\\OneDrive\\a11_heartbeat',
  uri: 'bolt://127.0.0.1:17687',
  database: 'neo4j',
};

const now = process.env.CODEX_SYNC_UPDATED_AT || new Date().toISOString();

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function statFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath);
    return {
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  } catch (_) {
    return {
      exists: false,
      sizeBytes: 0,
      modifiedAt: null,
      sha256: null,
    };
  }
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'unnamed';
}

function relType(value) {
  const rel = String(value || 'RELATED_TO')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return rel || 'RELATED_TO';
}

function redactPath(filePath) {
  return String(filePath || '').replace(/\\+/g, '\\');
}

function parseCodexMcpServers(toml) {
  const servers = [];
  const blockRegex = /^\[mcp_servers\.([^\]]+)\]\s*$(.*?)(?=^\[|\z)/gms;
  for (const match of toml.matchAll(blockRegex)) {
    const name = match[1].replace(/^"|"$/g, '');
    const body = match[2] || '';
    const url = body.match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1] || null;
    const command = body.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1] || null;
    const argsRaw = body.match(/^\s*args\s*=\s*(\[[^\n]+\])/m)?.[1] || null;
    const envKeys = [];
    const envRaw = body.match(/^\s*env\s*=\s*\{([^}]+)\}/m)?.[1] || '';
    for (const envMatch of envRaw.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
      envKeys.push(envMatch[1]);
    }
    servers.push({
      id: `codex:${name}`,
      name,
      source: 'codex-global-config',
      transport: url ? 'http' : 'stdio',
      url,
      command,
      argsSummary: argsRaw ? argsRaw.replace(/"[^"]+"/g, (s) => {
        const value = s.slice(1, -1);
        return value.includes('secret') || value.includes('token') ? '"<redacted>"' : s;
      }) : null,
      envKeys,
    });
  }
  return servers;
}

function collectData() {
  const workspaceRoot = process.env.CODEX_SYNC_WORKSPACE_ROOT || DEFAULTS.workspaceRoot;
  const codexHome = process.env.CODEX_HOME || DEFAULTS.codexHome;
  const agentBus = process.env.A11_AGENT_BUS || DEFAULTS.agentBus;
  const heartbeatRoot = process.env.A11_HEARTBEAT_ROOT || DEFAULTS.heartbeatRoot;

  const files = {
    workspaceManifest: path.join(workspaceRoot, '.vscode', 'codex-sync.json'),
    agentBusManifest: path.join(agentBus, 'codex-vs-sync.json'),
    routeMap: path.join(workspaceRoot, 'a11', 'runtime', 'knowledge-graph', 'a11-route-map.json'),
    kiroMcp: path.join(workspaceRoot, '.kiro', 'settings', 'mcp.json'),
    codexConfig: path.join(codexHome, 'config.toml'),
    presence: path.join(agentBus, 'presence.json'),
    jobs: path.join(agentBus, 'jobs.json'),
    neo4jSyncStatus: path.join(agentBus, 'codex-neo4j-sync-status.json'),
    neo4jSyncBroadcast: path.join(agentBus, 'msg-codex-to-network-neo4j-sync-20260512.json'),
    heartbeatProtocol: path.join(heartbeatRoot, 'HEARTBEAT_PROTOCOL.md'),
  };

  const workspaceManifest = readJson(files.workspaceManifest, {});
  const agentBusManifest = readJson(files.agentBusManifest, {});
  const routeMap = readJson(files.routeMap, {});
  const kiroMcp = readJson(files.kiroMcp, {});
  const presence = readJson(files.presence, { agents: [] });
  const jobs = readJson(files.jobs, {});
  const codexToml = readText(files.codexConfig);

  const dataSources = Object.entries(files).map(([kind, filePath]) => ({
    id: `source:${kind}`,
    kind,
    path: redactPath(filePath),
    ...statFile(filePath),
  }));

  const codexMcp = parseCodexMcpServers(codexToml);
  const kiroMcpServers = Object.entries(kiroMcp?.mcpServers || {}).map(([name, config]) => ({
    id: `kiro:${name}`,
    name,
    source: 'kiro-mcp-config',
    transport: config.url ? 'http' : 'stdio',
    url: config.url || null,
    command: config.command || null,
    argsSummary: Array.isArray(config.args) ? JSON.stringify(config.args) : null,
    envKeys: Object.keys(config.env || {}),
    autoApprove: Array.isArray(config.autoApprove) ? config.autoApprove : [],
  }));

  const syncMcpServers = Object.entries(workspaceManifest?.mcpServers || {}).map(([name, config]) => ({
    id: `sync:${name}`,
    name,
    source: 'codex-sync-manifest',
    transport: config.transport || (config.url ? 'http' : 'stdio'),
    url: config.url || null,
    command: config.command || null,
    argsSummary: Array.isArray(config.args) ? JSON.stringify(config.args) : null,
    envKeys: Object.keys(config.env || {}),
    role: config.role || null,
  }));

  const sharedMemoryPaths = Object.entries(workspaceManifest?.sharedMemory || agentBusManifest?.sharedMemory || {}).map(([name, value]) => ({
    id: `shared:${normalizeId(name)}`,
    name,
    path: redactPath(value),
    source: 'shared-memory',
  }));

  const watchedPaths = [
    ...(workspaceManifest?.vsSync?.watchedFolders || []),
    ...(workspaceManifest?.vsSync?.vsFolders || []),
  ].map((value, index) => ({
    id: `watch:${stableId(String(index), value)}`,
    name: path.basename(value),
    path: redactPath(value),
    source: 'vs-sync',
  }));

  return {
    run: {
      id: 'codex-vs-sync-current',
      runId: process.env.CODEX_SYNC_RUN_ID || `codex-vs-sync-${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
      updatedAt: now,
      mode: workspaceManifest.mode || 'mcp-shared-readonly-plus-local-a11',
      workspaceRoot,
      note: 'Sanitized synchronization of Codex/A11 shareable metadata. No secrets or raw Codex logs are imported.',
    },
    dataSources,
    mcpServers: [...codexMcp, ...kiroMcpServers, ...syncMcpServers],
    agents: Array.isArray(presence.agents) ? presence.agents : [],
    routeMap,
    paths: [...sharedMemoryPaths, ...watchedPaths],
    jobs,
  };
}

async function runQuery(session, cypher, params = {}) {
  return session.run(cypher, params);
}

async function sync(session, data) {
  const constraints = [
    'CREATE CONSTRAINT codex_sync_run_id IF NOT EXISTS FOR (n:CodexSyncRun) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT codex_data_source_id IF NOT EXISTS FOR (n:CodexDataSource) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_agent_id IF NOT EXISTS FOR (n:A11Agent) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_mcp_server_id IF NOT EXISTS FOR (n:A11McpServer) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_route_node_id IF NOT EXISTS FOR (n:A11RouteNode) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_sync_path_id IF NOT EXISTS FOR (n:A11SyncPath) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_job_id IF NOT EXISTS FOR (n:A11Job) REQUIRE n.id IS UNIQUE',
  ];

  for (const constraint of constraints) {
    await runQuery(session, constraint);
  }

  await runQuery(session, `
    MERGE (r:CodexSyncRun {id: $id})
    SET r.runId = $runId,
        r.updatedAt = datetime($updatedAt),
        r.mode = $mode,
        r.workspaceRoot = $workspaceRoot,
        r.note = $note
  `, data.run);

  await runQuery(session, `
    MATCH (r:CodexSyncRun {id: $runId})
    UNWIND $sources AS source
    MERGE (s:CodexDataSource {id: source.id})
    SET s.kind = source.kind,
        s.path = source.path,
        s.exists = source.exists,
        s.sizeBytes = source.sizeBytes,
        s.modifiedAt = CASE WHEN source.modifiedAt IS NULL THEN NULL ELSE datetime(source.modifiedAt) END,
        s.sha256 = source.sha256,
        s.updatedAt = datetime($updatedAt)
    MERGE (r)-[:SYNCED_SOURCE]->(s)
  `, {
    runId: data.run.id,
    sources: data.dataSources,
    updatedAt: data.run.updatedAt,
  });

  await runQuery(session, `
    MATCH (r:CodexSyncRun {id: $runId})
    UNWIND $servers AS server
    MERGE (m:A11McpServer {id: server.id})
    SET m.name = server.name,
        m.source = server.source,
        m.transport = server.transport,
        m.url = server.url,
        m.command = server.command,
        m.argsSummary = server.argsSummary,
        m.envKeys = server.envKeys,
        m.autoApprove = coalesce(server.autoApprove, []),
        m.role = server.role,
        m.updatedAt = datetime($updatedAt)
    MERGE (r)-[:EXPOSES_MCP]->(m)
  `, {
    runId: data.run.id,
    servers: data.mcpServers,
    updatedAt: data.run.updatedAt,
  });

  await runQuery(session, `
    MATCH (r:CodexSyncRun {id: $runId})
    UNWIND $agents AS agent
    MERGE (a:A11Agent {id: agent.id})
    SET a.name = agent.name,
        a.role = agent.role,
        a.host = agent.host,
        a.status = agent.status,
        a.profilePreset = agent.profilePreset,
        a.identity = agent.identity,
        a.tone = agent.tone,
        a.priority = agent.priority,
        a.memoryScope = coalesce(agent.memoryScope, []),
        a.riskLevel = agent.riskLevel,
        a.capabilities = coalesce(agent.capabilities, []),
        a.note = agent.note,
        a.firstSeen = CASE WHEN agent.firstSeen IS NULL THEN NULL ELSE datetime(agent.firstSeen) END,
        a.lastSeen = CASE WHEN agent.lastSeen IS NULL THEN NULL ELSE datetime(agent.lastSeen) END,
        a.seenCount = coalesce(agent.seenCount, 0),
        a.updatedAt = datetime($updatedAt)
    MERGE (r)-[:SEES_AGENT]->(a)
  `, {
    runId: data.run.id,
    agents: data.agents,
    updatedAt: data.run.updatedAt,
  });

  await runQuery(session, `
    MATCH (r:CodexSyncRun {id: $runId})
    UNWIND $paths AS item
    MERGE (p:A11SyncPath {id: item.id})
    SET p.name = item.name,
        p.path = item.path,
        p.source = item.source,
        p.updatedAt = datetime($updatedAt)
    MERGE (r)-[:WATCHES_PATH]->(p)
  `, {
    runId: data.run.id,
    paths: data.paths,
    updatedAt: data.run.updatedAt,
  });

  const routeNodes = Array.isArray(data.routeMap.nodes) ? data.routeMap.nodes.map(([id, label, kind]) => ({
    id,
    label,
    kind,
  })) : [];
  const routeEdges = Array.isArray(data.routeMap.edges) ? data.routeMap.edges.map(([source, predicate, target]) => ({
    source,
    predicate,
    target,
    type: relType(predicate),
  })) : [];

  await runQuery(session, `
    MATCH (r:CodexSyncRun {id: $runId})
    UNWIND $nodes AS node
    MERGE (n:A11RouteNode {id: node.id})
    SET n.label = node.label,
        n.kind = node.kind,
        n.updatedAt = datetime($updatedAt)
    MERGE (r)-[:HAS_ROUTE_NODE]->(n)
  `, {
    runId: data.run.id,
    nodes: routeNodes,
    updatedAt: data.run.updatedAt,
  });

  for (const edge of routeEdges) {
    await runQuery(session, `
      MATCH (a:A11RouteNode {id: $source})
      MATCH (b:A11RouteNode {id: $target})
      MERGE (a)-[r:${edge.type}]->(b)
      SET r.label = $predicate,
          r.updatedAt = datetime($updatedAt)
    `, {
      source: edge.source,
      target: edge.target,
      predicate: edge.predicate,
      updatedAt: data.run.updatedAt,
    });
  }

  const jobs = Array.isArray(data.jobs?.jobs) ? data.jobs.jobs : [];
  await runQuery(session, `
    MATCH (r:CodexSyncRun {id: $runId})
    UNWIND $jobs AS job
    MERGE (j:A11Job {id: coalesce(job.id, job.name, job.title)})
    SET j.name = coalesce(job.name, job.title, job.id),
        j.status = job.status,
        j.priority = job.priority,
        j.updatedAt = datetime($updatedAt)
    MERGE (r)-[:HAS_JOB]->(j)
  `, {
    runId: data.run.id,
    jobs,
    updatedAt: data.run.updatedAt,
  });
}

async function main() {
  const uri = process.env.NEO4J_URI || DEFAULTS.uri;
  const database = process.env.NEO4J_DATABASE || DEFAULTS.database;
  const username = process.env.NEO4J_USERNAME || '';
  const password = process.env.NEO4J_PASSWORD || '';
  const auth = username || password ? neo4j.auth.basic(username || 'neo4j', password) : neo4j.auth.none();
  const data = collectData();

  const driver = neo4j.driver(uri, auth, { disableLosslessIntegers: true });
  try {
    await driver.verifyConnectivity();
    const session = driver.session({ database });
    try {
      await sync(session, data);
      const summary = await session.run(`
        MATCH (r:CodexSyncRun {id: $runId})
        OPTIONAL MATCH (r)-[:SYNCED_SOURCE]->(s:CodexDataSource)
        OPTIONAL MATCH (r)-[:SEES_AGENT]->(a:A11Agent)
        OPTIONAL MATCH (r)-[:EXPOSES_MCP]->(m:A11McpServer)
        OPTIONAL MATCH (r)-[:HAS_ROUTE_NODE]->(rn:A11RouteNode)
        OPTIONAL MATCH (r)-[:WATCHES_PATH]->(p:A11SyncPath)
        RETURN count(DISTINCT s) AS sources,
               count(DISTINCT a) AS agents,
               count(DISTINCT m) AS mcpServers,
               count(DISTINCT rn) AS routeNodes,
               count(DISTINCT p) AS paths
      `, { runId: data.run.id });
      const record = summary.records[0];
      console.log(JSON.stringify({
        ok: true,
        uri,
        database,
        runId: data.run.runId,
        sources: record.get('sources'),
        agents: record.get('agents'),
        mcpServers: record.get('mcpServers'),
        routeNodes: record.get('routeNodes'),
        paths: record.get('paths'),
      }, null, 2));
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const neo4j = require('neo4j-driver');

const {
  resolveRouterConfig,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');

loadEnvIfExists(path.join(SERVER_ROOT, '.env.local'), true);
loadEnvIfExists(path.join(SERVER_ROOT, '.env'), false);
loadEnvIfExists(path.join(WORKSPACE_ROOT, 'a11mcp', '.env'), false);

const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');
const GENERATED_AT = process.env.A11_RUNTIME_HOOKS_UPDATED_AT || new Date().toISOString();

const args = parseArgs(process.argv.slice(2));

const MODULES = [
  {
    id: 'cortex',
    name: 'Cortex',
    kind: 'runtime-hook',
    role: 'packet-router',
    summary: 'Decodes packets, routes actions, and gives A11 a compact event bus.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'cortex'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'cortex', 'router.ts'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'cortex', 'applyPacket.ts'),
    ],
    watchedFiles: [
      path.join(WORKSPACE_ROOT, '.qflush', 'cortex.routes.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'cortex.routes.json'),
    ],
    capabilities: ['packet-decode', 'runtime-routing', 'safe-apply', 'a11-suggest'],
  },
  {
    id: 'spyder',
    name: 'Spyder',
    kind: 'runtime-hook',
    role: 'scanner-and-memory-protocol',
    summary: 'Scans routes, secrets and memory hints, then reports them back to the runtime graph.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'spyder'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'commands', 'spyder.ts'),
    ],
    watchedFiles: [
      path.join(WORKSPACE_ROOT, '.qflush', 'spyder.config.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'spyder.config.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'logs', 'spyder.log'),
    ],
    capabilities: ['scan', 'memory-protocol', 'route-hints'],
  },
  {
    id: 'telemetry',
    name: 'Telemetry',
    kind: 'runtime-hook',
    role: 'runtime-events',
    summary: 'Keeps runtime events and engine history queryable for A11 and the agents.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'rome', 'storage.ts'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'rome', 'events.ts'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'rome', 'copilot-bridge.ts'),
    ],
    watchedFiles: [
      path.join(WORKSPACE_ROOT, '.qflush', 'storage.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'storage.json'),
    ],
    capabilities: ['runtime-events', 'engine-history', 'agent-reporting'],
  },
  {
    id: 'rome',
    name: 'Rome',
    kind: 'runtime-hook',
    role: 'execution-and-links',
    summary: 'Runs actions, resolves project paths, and keeps route links available to the graph.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'rome'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'rome', 'executor.ts'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'rome', 'linker.ts'),
    ],
    watchedFiles: [
      path.join(WORKSPACE_ROOT, '.qflush', 'rome-index.json'),
      path.join(WORKSPACE_ROOT, '.qflush', 'rome-links.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'rome-index.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'rome-links.json'),
    ],
    capabilities: ['command-runner', 'route-links', 'workspace-paths'],
  },
  {
    id: 'corpus',
    name: 'Corpus',
    kind: 'data-hook',
    role: 'semantic-source',
    summary: 'Feeds A11 memory, local files and importable archives into the graph layer.',
    sourcePaths: [
      path.join(WORKSPACE_ROOT, 'runtime', 'Corpus'),
      path.join(A11_ROOT, 'runtime', 'knowledge-graph'),
      path.join(SERVER_ROOT, 'scripts', 'seed-a11-neo4j-corpus.cjs'),
    ],
    watchedFiles: [
      path.join(GRAPH_DIR, 'a11-route-map.json'),
      path.join(GRAPH_DIR, 'a11_graph.json'),
    ],
    capabilities: ['corpus-index', 'graph-feed', 'memory-feed'],
  },
  {
    id: 'agent-domain-pack',
    name: 'Agent Domain Pack',
    kind: 'data-hook',
    role: 'agent-domain-index',
    summary: 'Indexes A11, Kaen44 and Vivy domains, tools, SFX, culture lanes and source policies.',
    sourcePaths: [
      path.join(SERVER_ROOT, 'src', 'knowledge', 'agent-domain-pack.cjs'),
      path.join(SERVER_ROOT, 'scripts', 'seed-agent-domain-pack.cjs'),
    ],
    watchedFiles: [
      path.join(GRAPH_DIR, 'a11-agent-domain-pack.json'),
      path.join(GRAPH_DIR, 'a11-agent-domain-pack.md'),
      path.join(GRAPH_DIR, 'a11-agent-domain-pack.cypher'),
    ],
    capabilities: ['agent-domain-index', 'culture-lanes', 'sfx-index', 'neo4j-domain-sync'],
  },
  {
    id: 'ecosystem-scope',
    name: 'Ecosystem Scope',
    kind: 'data-hook',
    role: 'cross-repo-org-index',
    summary: 'Indexes Funesterie repos, packages, contracts, shared runtimes, orchestration layers and semantic tooling for MCP/GitHub navigation.',
    sourcePaths: [
      path.join(SERVER_ROOT, 'src', 'knowledge', 'ecosystem-scope.cjs'),
      path.join(SERVER_ROOT, 'scripts', 'sync-ecosystem-scope-neo4j.cjs'),
    ],
    watchedFiles: [
      path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.json'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.md'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.cypher'),
    ],
    capabilities: ['github-org-index', 'cross-repo-map', 'package-index', 'contract-index', 'mcp-scope-map'],
  },
  {
    id: 'ecosystem-corpus',
    name: 'Ecosystem Corpus',
    kind: 'data-hook',
    role: 'source-card-corpus-bridge',
    summary: 'Turns ecosystem-scope into source cards, repo briefs, domain links and public/private boundaries for Corpus and Neo4j.',
    sourcePaths: [
      path.join(SERVER_ROOT, 'src', 'knowledge', 'ecosystem-corpus.cjs'),
      path.join(SERVER_ROOT, 'src', 'knowledge', 'ecosystem-briefing.cjs'),
      path.join(SERVER_ROOT, 'scripts', 'sync-ecosystem-corpus-neo4j.cjs'),
      path.join(SERVER_ROOT, 'scripts', 'generate-ecosystem-briefing.cjs'),
    ],
    watchedFiles: [
      path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.json'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.md'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.cypher'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-briefing.json'),
      path.join(GRAPH_DIR, 'funesterie-executive-view.md'),
      path.join(GRAPH_DIR, 'funesterie-architecture-view.md'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-briefing.html'),
      path.join(GRAPH_DIR, 'funesterie-ecosystem-briefing.pdf'),
      path.join(GRAPH_DIR, 'assets', 'a11-mcp-identity.png'),
      path.join(GRAPH_DIR, 'assets', 'funesterie-ecosystem-identity.png'),
    ],
    capabilities: ['source-cards', 'repo-briefs', 'domain-links', 'public-private-boundaries', 'corpus-feed', 'executive-briefing', 'architecture-briefing'],
  },
  {
    id: 'piccolo',
    name: 'Piccolo',
    kind: 'repair-hook',
    role: 'safe-repairs',
    summary: 'Runs small repair passes and safe checks before changes reach wider A11 flows.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'piccolo'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'commands', 'piccolo.ts'),
    ],
    watchedFiles: [
      path.join(WORKSPACE_ROOT, '.qflush', 'piccolo-snapshot.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'piccolo-snapshot.json'),
    ],
    capabilities: ['safe-repair', 'snapshot', 'checks'],
  },
  {
    id: 'doctor',
    name: 'Doctor',
    aliases: ['docteur'],
    kind: 'diagnostic-hook',
    role: 'diagnostics',
    summary: 'Checks the QFlush/A11 runtime and reports what needs attention.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'commands', 'doctor.ts'),
    ],
    watchedFiles: [
      path.join(WORKSPACE_ROOT, '.qflush', 'doctor-report.json'),
      path.join(A11_ROOT, 'backend', 'libs', '.qflush', 'doctor-report.json'),
    ],
    capabilities: ['diagnostics', 'health-checks', 'repair-advice'],
  },
  {
    id: 'qflush',
    name: 'QFlush',
    kind: 'orchestrator',
    role: 'runtime-orchestration',
    summary: 'Groups Cortex, Spyder, Rome, Piccolo and Doctor under one command surface.',
    sourcePaths: [
      path.join(A11_ROOT, 'backend', 'libs', 'package.json'),
      path.join(A11_ROOT, 'backend', 'libs', 'src', 'index.ts'),
    ],
    watchedFiles: [
      path.join(A11_ROOT, 'backend', 'libs', 'package.json'),
    ],
    capabilities: ['cli', 'runtime-orchestration', 'module-registry'],
  },
];

const LINKS = [
  ['a11', 'USES_HOOK', 'cortex'],
  ['a11', 'USES_HOOK', 'spyder'],
  ['a11', 'USES_HOOK', 'telemetry'],
  ['a11', 'USES_HOOK', 'rome'],
  ['a11', 'USES_HOOK', 'corpus'],
  ['a11', 'USES_HOOK', 'agent-domain-pack'],
  ['a11', 'USES_HOOK', 'ecosystem-scope'],
  ['a11', 'USES_HOOK', 'ecosystem-corpus'],
  ['a11', 'USES_HOOK', 'piccolo'],
  ['a11', 'USES_HOOK', 'doctor'],
  ['qflush', 'EXPOSES', 'cortex'],
  ['qflush', 'EXPOSES', 'spyder'],
  ['qflush', 'EXPOSES', 'rome'],
  ['qflush', 'EXPOSES', 'piccolo'],
  ['qflush', 'EXPOSES', 'doctor'],
  ['cortex', 'ROUTES_TO', 'spyder'],
  ['cortex', 'ROUTES_TO', 'rome'],
  ['spyder', 'REPORTS_TO', 'telemetry'],
  ['rome', 'PERSISTS_TO', 'telemetry'],
  ['corpus', 'FEEDS', 'rome'],
  ['corpus', 'FEEDS', 'telemetry'],
  ['agent-domain-pack', 'FEEDS', 'corpus'],
  ['agent-domain-pack', 'ROUTES_WITH', 'rome'],
  ['agent-domain-pack', 'RUNS_CHECKS_WITH', 'doctor'],
  ['agent-domain-pack', 'RUNS_REPAIRS_WITH', 'piccolo'],
  ['ecosystem-scope', 'FEEDS', 'corpus'],
  ['ecosystem-scope', 'FEEDS', 'ecosystem-corpus'],
  ['ecosystem-scope', 'ROUTES_WITH', 'rome'],
  ['ecosystem-scope', 'RUNS_CHECKS_WITH', 'doctor'],
  ['ecosystem-scope', 'WRITES_TO', 'neo4j'],
  ['ecosystem-corpus', 'FEEDS', 'corpus'],
  ['ecosystem-corpus', 'ROUTES_WITH', 'rome'],
  ['ecosystem-corpus', 'RUNS_CHECKS_WITH', 'doctor'],
  ['ecosystem-corpus', 'WRITES_TO', 'neo4j'],
  ['piccolo', 'RUNS_CHECKS_WITH', 'doctor'],
  ['doctor', 'REPORTS_TO', 'a11'],
  ['telemetry', 'WRITES_TO', 'neo4j'],
  ['corpus', 'WRITES_TO', 'neo4j'],
  ['rome', 'WRITES_TO', 'neo4j'],
  ['cortex', 'WRITES_TO', 'neo4j'],
  ['spyder', 'WRITES_TO', 'neo4j'],
  ['piccolo', 'WRITES_TO', 'neo4j'],
  ['doctor', 'WRITES_TO', 'neo4j'],
  ['agent-domain-pack', 'WRITES_TO', 'neo4j'],
  ['mcp', 'EXPOSES', 'runtime-hooks'],
  ['mcp', 'EXPOSES', 'agent-domain-pack'],
  ['mcp', 'EXPOSES', 'ecosystem-scope'],
  ['mcp', 'EXPOSES', 'ecosystem-corpus'],
  ['runtime-hooks', 'WRITES_TO', 'neo4j'],
];

async function main() {
  const manifest = buildManifest();
  fs.mkdirSync(GRAPH_DIR, { recursive: true });

  const jsonPath = path.join(GRAPH_DIR, 'a11-runtime-hooks.json');
  const markdownPath = path.join(GRAPH_DIR, 'a11-runtime-hooks.md');
  const cypherPath = path.join(GRAPH_DIR, 'a11-runtime-hooks.cypher');
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, toMarkdown(manifest), 'utf8');
  fs.writeFileSync(cypherPath, toCypher(manifest), 'utf8');

  if (args.dryRun) {
    return output({
      ok: true,
      dryRun: true,
      manifest: summarizeManifest(manifest),
      files: { jsonPath, markdownPath, cypherPath },
    });
  }

  const endpoints = resolveTargetEndpoints(args.target);
  const results = [];
  for (const endpoint of endpoints) {
    results.push(await syncEndpoint(endpoint, manifest));
  }

  output({
    ok: results.every((result) => result.ok),
    dryRun: false,
    target: args.target,
    manifest: summarizeManifest(manifest),
    endpoints: results,
    files: { jsonPath, markdownPath, cypherPath },
  });
}

function buildManifest() {
  const modules = MODULES.map((moduleInfo) => ({
    ...moduleInfo,
    aliases: moduleInfo.aliases || [],
    sourcePaths: moduleInfo.sourcePaths.map(fileStatus),
    watchedFiles: moduleInfo.watchedFiles.map(fileStatus),
  }));

  return {
    ok: true,
    id: 'a11-runtime-hooks',
    name: 'A11 runtime hooks',
    generatedAt: GENERATED_AT,
    mode: 'semantic-runtime-hook',
    workspaceRoot: WORKSPACE_ROOT,
    a11Root: A11_ROOT,
    serverRoot: SERVER_ROOT,
    runtimeRoot: RUNTIME_ROOT,
    graphDir: GRAPH_DIR,
    modules,
    links: LINKS.map(([from, type, to]) => ({ from, type, to })),
    summary: {
      modules: modules.length,
      links: LINKS.length,
      sourcePathsPresent: modules.reduce((sum, item) => sum + item.sourcePaths.filter((entry) => entry.exists).length, 0),
      watchedFilesPresent: modules.reduce((sum, item) => sum + item.watchedFiles.filter((entry) => entry.exists).length, 0),
    },
  };
}

function summarizeManifest(manifest) {
  return {
    id: manifest.id,
    generatedAt: manifest.generatedAt,
    modules: manifest.summary.modules,
    links: manifest.summary.links,
    sourcePathsPresent: manifest.summary.sourcePathsPresent,
    watchedFilesPresent: manifest.summary.watchedFilesPresent,
  };
}

function resolveTargetEndpoints(target) {
  const config = resolveRouterConfig(process.env);
  if (target === 'aura') return [config.aura];
  if (target === 'both') return [config.local, config.aura];
  return [config.local];
}

async function syncEndpoint(endpoint, manifest) {
  const startedAt = Date.now();
  try {
    const driver = neo4j.driver(endpoint.uri, neo4j.auth.basic(endpoint.username, endpoint.password), {
      connectionAcquisitionTimeout: 15000,
      maxConnectionPoolSize: 5,
      disableLosslessIntegers: true,
    });
    try {
      await driver.verifyConnectivity();
      const session = driver.session({
        database: endpoint.database,
        defaultAccessMode: neo4j.session.WRITE,
      });
      try {
        await syncManifest(session, manifest, endpoint);
        const summary = await session.run(`
          MATCH (m:A11HookManifest {id: $manifestId})
          OPTIONAL MATCH (m)-[:DESCRIBES_HOOK]->(h:A11RuntimeHook)
          OPTIONAL MATCH (h)-[:HAS_CAPABILITY]->(c:A11Capability)
          OPTIONAL MATCH (h)-[:HAS_RUNTIME_FILE]->(f:A11RuntimeFile)
          OPTIONAL MATCH (:A11RouteNode)-[r:A11_RUNTIME_LINK]->(:A11RouteNode)
          RETURN count(DISTINCT h) AS hooks,
                 count(DISTINCT c) AS capabilities,
                 count(DISTINCT f) AS files,
                 count(DISTINCT r) AS links
        `, { manifestId: manifest.id });
        const record = summary.records[0];
        return {
          ok: true,
          name: endpoint.name,
          uri: endpoint.uri,
          database: endpoint.database,
          hooks: toPlain(record.get('hooks')),
          capabilities: toPlain(record.get('capabilities')),
          files: toPlain(record.get('files')),
          links: toPlain(record.get('links')),
          elapsedMs: Date.now() - startedAt,
        };
      } finally {
        await session.close().catch(() => {});
      }
    } finally {
      await driver.close().catch(() => {});
    }
  } catch (error) {
    return {
      ok: false,
      name: endpoint?.name || 'unknown',
      uri: endpoint?.uri || '',
      database: endpoint?.database || '',
      error: error.code || error.name || 'Neo4jError',
      message: String(error.message || error).slice(0, 300),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function syncManifest(session, manifest, endpoint) {
  const constraints = [
    'CREATE CONSTRAINT a11_hook_manifest_id IF NOT EXISTS FOR (n:A11HookManifest) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_runtime_hook_id IF NOT EXISTS FOR (n:A11RuntimeHook) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_route_node_id IF NOT EXISTS FOR (n:A11RouteNode) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_capability_id IF NOT EXISTS FOR (n:A11Capability) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_runtime_file_id IF NOT EXISTS FOR (n:A11RuntimeFile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_database_id IF NOT EXISTS FOR (n:Database) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);

  const modules = manifest.modules.map((item) => ({
    id: item.id,
    graphId: `runtime-hook:${item.id}`,
    name: item.name,
    aliases: item.aliases || [],
    kind: item.kind,
    role: item.role,
    summary: item.summary,
    capabilities: item.capabilities || [],
    sourcePaths: item.sourcePaths || [],
    watchedFiles: item.watchedFiles || [],
    sourcePathsPresent: (item.sourcePaths || []).filter((entry) => entry.exists).length,
    watchedFilesPresent: (item.watchedFiles || []).filter((entry) => entry.exists).length,
  }));

  const routeNodes = [
    { id: 'a11', label: 'A11', kind: 'agent' },
    { id: 'mcp', label: 'A11 MCP', kind: 'mcp' },
    { id: 'neo4j', label: 'Neo4j', kind: 'graph' },
    { id: 'runtime-hooks', label: 'A11 runtime hooks', kind: 'semantic-hook' },
    ...modules.map((moduleInfo) => ({
      id: moduleInfo.id,
      label: moduleInfo.name,
      kind: moduleInfo.kind,
    })),
  ];

  await session.run(`
    MERGE (manifest:A11HookManifest {id: $manifestId})
    SET manifest.name = $name,
        manifest.mode = $mode,
        manifest.workspaceRoot = $workspaceRoot,
        manifest.a11Root = $a11Root,
        manifest.serverRoot = $serverRoot,
        manifest.runtimeRoot = $runtimeRoot,
        manifest.graphDir = $graphDir,
        manifest.generatedAt = datetime($generatedAt),
        manifest.endpointName = $endpointName,
        manifest.endpointUri = $endpointUri,
        manifest.endpointDatabase = $endpointDatabase,
        manifest.updatedAt = datetime($generatedAt)

    MERGE (db:Database {id: $databaseId})
    SET db.name = $endpointDatabase,
        db.uri = $endpointUri,
        db.kind = 'neo4j',
        db.updatedAt = datetime($generatedAt)
    MERGE (manifest)-[:WRITES_TO]->(db)
  `, {
    manifestId: manifest.id,
    name: manifest.name,
    mode: manifest.mode,
    workspaceRoot: manifest.workspaceRoot,
    a11Root: manifest.a11Root,
    serverRoot: manifest.serverRoot,
    runtimeRoot: manifest.runtimeRoot,
    graphDir: manifest.graphDir,
    generatedAt: manifest.generatedAt,
    endpointName: endpoint.name,
    endpointUri: endpoint.uri,
    endpointDatabase: endpoint.database,
    databaseId: `neo4j:${endpoint.name}:${endpoint.database}`,
  });

  await session.run(`
    MATCH (manifest:A11HookManifest {id: $manifestId})
    UNWIND $modules AS item
    MERGE (hook:A11RuntimeHook {id: item.id})
    SET hook.graphId = item.graphId,
        hook.name = item.name,
        hook.aliases = item.aliases,
        hook.kind = item.kind,
        hook.role = item.role,
        hook.summary = item.summary,
        hook.sourcePathsPresent = item.sourcePathsPresent,
        hook.watchedFilesPresent = item.watchedFilesPresent,
        hook.updatedAt = datetime($generatedAt)
    MERGE (route:A11RouteNode {id: item.id})
    SET route.label = item.name,
        route.name = item.name,
        route.kind = item.kind,
        route.updatedAt = datetime($generatedAt)
    MERGE (hook)-[:HAS_ROUTE_NODE]->(route)
    MERGE (manifest)-[:DESCRIBES_HOOK]->(hook)
  `, {
    manifestId: manifest.id,
    modules,
    generatedAt: manifest.generatedAt,
  });

  await session.run(`
    UNWIND $routeNodes AS item
    MERGE (node:A11RouteNode {id: item.id})
    SET node.label = item.label,
        node.kind = item.kind,
        node.updatedAt = datetime($generatedAt)
  `, {
    routeNodes,
    generatedAt: manifest.generatedAt,
  });

  for (const moduleInfo of modules) {
    const capabilities = moduleInfo.capabilities.map((name) => ({
      id: `runtime-hook-capability:${moduleInfo.id}:${normalizeId(name)}`,
      name,
    }));
    await session.run(`
      MATCH (hook:A11RuntimeHook {id: $hookId})
      UNWIND $capabilities AS capability
      MERGE (c:A11Capability {id: capability.id})
      SET c.name = capability.name,
          c.scope = 'runtime-hook',
          c.updatedAt = datetime($generatedAt)
      MERGE (hook)-[:HAS_CAPABILITY]->(c)
    `, {
      hookId: moduleInfo.id,
      capabilities,
      generatedAt: manifest.generatedAt,
    });

    const files = [
      ...moduleInfo.sourcePaths.map((entry) => ({ ...entry, role: 'source' })),
      ...moduleInfo.watchedFiles.map((entry) => ({ ...entry, role: 'watched' })),
    ].map((entry) => ({
      ...entry,
      id: `runtime-file:${hashText(entry.path)}`,
      properties: sanitizePropertyMap(entry),
    }));

    await session.run(`
      MATCH (hook:A11RuntimeHook {id: $hookId})
      UNWIND $files AS file
      MERGE (f:A11RuntimeFile {id: file.id})
      SET f += file.properties,
          f.updatedAt = datetime($generatedAt)
      MERGE (hook)-[rel:HAS_RUNTIME_FILE {role: file.role}]->(f)
      SET rel.exists = file.exists,
          rel.updatedAt = datetime($generatedAt)
    `, {
      hookId: moduleInfo.id,
      files,
      generatedAt: manifest.generatedAt,
    });
  }

  for (const link of manifest.links) {
    await session.run(`
      MATCH (a:A11RouteNode {id: $from})
      MATCH (b:A11RouteNode {id: $to})
      MERGE (a)-[r:${safeRel(link.type)}]->(b)
      SET r.label = $type,
          r.source = 'a11-runtime-hooks',
          r.updatedAt = datetime($generatedAt)
      MERGE (a)-[generic:A11_RUNTIME_LINK {kind: $type}]->(b)
      SET generic.updatedAt = datetime($generatedAt)
    `, {
      from: link.from,
      to: link.to,
      type: link.type,
      generatedAt: manifest.generatedAt,
    });
  }
}

function fileStatus(targetPath) {
  const normalized = path.resolve(targetPath);
  try {
    const stat = fs.statSync(normalized);
    return {
      path: normalized,
      exists: true,
      kind: stat.isDirectory() ? 'directory' : 'file',
      sizeBytes: stat.isDirectory() ? null : stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: stat.isFile() && stat.size <= 5_000_000 ? hashFile(normalized) : null,
    };
  } catch {
    return {
      path: normalized,
      exists: false,
      kind: 'missing',
      sizeBytes: null,
      modifiedAt: null,
      sha256: null,
    };
  }
}

function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function hashText(value, length = 24) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function safeRel(value) {
  const rel = String(value || 'RELATED_TO')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Z_]/.test(rel) ? rel : 'RELATED_TO';
}

function toPlain(value) {
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  return value;
}

function toCypher(manifest) {
  const lines = [
    '// A11 runtime hooks export',
    `// Generated at ${manifest.generatedAt}`,
    'CREATE CONSTRAINT a11_runtime_hook_id IF NOT EXISTS FOR (n:A11RuntimeHook) REQUIRE n.id IS UNIQUE;',
    'CREATE CONSTRAINT a11_route_node_id IF NOT EXISTS FOR (n:A11RouteNode) REQUIRE n.id IS UNIQUE;',
    '',
  ];
  const routeNodes = [
    ['a11', 'A11', 'agent'],
    ['mcp', 'A11 MCP', 'mcp'],
    ['neo4j', 'Neo4j', 'graph'],
    ['runtime-hooks', 'A11 runtime hooks', 'semantic-hook'],
  ];
  for (const [id, label, kind] of routeNodes) {
    lines.push(
      `MERGE (n:A11RouteNode {id: ${cypherString(id)}})`,
      `SET n.label = ${cypherString(label)},`,
      `    n.kind = ${cypherString(kind)},`,
      `    n.updatedAt = datetime(${cypherString(manifest.generatedAt)});`,
      ''
    );
  }
  for (const moduleInfo of manifest.modules) {
    lines.push(
      `MERGE (n:A11RuntimeHook {id: ${cypherString(moduleInfo.id)}})`,
      `SET n.name = ${cypherString(moduleInfo.name)},`,
      `    n.kind = ${cypherString(moduleInfo.kind)},`,
      `    n.role = ${cypherString(moduleInfo.role)},`,
      `    n.summary = ${cypherString(moduleInfo.summary)},`,
      `    n.updatedAt = datetime(${cypherString(manifest.generatedAt)})`,
      `MERGE (r:A11RouteNode {id: ${cypherString(moduleInfo.id)}})`,
      `SET r.name = ${cypherString(moduleInfo.name)},`,
      `    r.label = ${cypherString(moduleInfo.name)},`,
      `    r.kind = ${cypherString(moduleInfo.kind)},`,
      `    r.updatedAt = datetime(${cypherString(manifest.generatedAt)})`,
      'MERGE (n)-[:HAS_ROUTE_NODE]->(r);',
      ''
    );
  }
  for (const link of manifest.links) {
    lines.push(
      `MATCH (a:A11RouteNode {id: ${cypherString(link.from)}}), (b:A11RouteNode {id: ${cypherString(link.to)}})`,
      `MERGE (a)-[r:${safeRel(link.type)}]->(b)`,
      `SET r.label = ${cypherString(link.type)},`,
      `    r.source = 'a11-runtime-hooks',`,
      `    r.updatedAt = datetime(${cypherString(manifest.generatedAt)});`,
      ''
    );
  }
  return `${lines.join('\n')}\n`;
}

function cypherString(value) {
  return JSON.stringify(String(value || ''));
}

function toMarkdown(manifest) {
  const lines = [
    '# A11 Runtime Hooks',
    '',
    `Generated: ${manifest.generatedAt}`,
    `Mode: ${manifest.mode}`,
    '',
    '## Modules',
    '',
  ];
  for (const moduleInfo of manifest.modules) {
    lines.push(
      `- ${moduleInfo.name}: ${moduleInfo.summary}`,
      `  - source paths present: ${moduleInfo.sourcePaths.filter((entry) => entry.exists).length}/${moduleInfo.sourcePaths.length}`,
      `  - watched files present: ${moduleInfo.watchedFiles.filter((entry) => entry.exists).length}/${moduleInfo.watchedFiles.length}`
    );
  }
  lines.push('', '## Links', '');
  for (const link of manifest.links) lines.push(`- ${link.from} --${link.type}--> ${link.to}`);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    json: true,
    target: process.env.A11_RUNTIME_HOOK_TARGET || 'local',
  };
  for (const arg of argv) {
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--pretty') parsed.json = false;
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
  }
  if (!['local', 'aura', 'both'].includes(parsed.target)) parsed.target = 'local';
  return parsed;
}

function output(value) {
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`[A11 runtime hooks] ok=${value.ok} dryRun=${value.dryRun}`);
  if (value.endpoints) {
    for (const endpoint of value.endpoints) {
      console.log(`[A11 runtime hooks] ${endpoint.name}/${endpoint.database}: ok=${endpoint.ok}`);
    }
  }
}

function loadEnvIfExists(filePath, override = false) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && (override || !Object.prototype.hasOwnProperty.call(process.env, key))) process.env[key] = value;
    }
  } catch {
    // env files are optional.
  }
}

module.exports = {
  buildManifest,
  summarizeManifest,
  toCypher,
  toMarkdown,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

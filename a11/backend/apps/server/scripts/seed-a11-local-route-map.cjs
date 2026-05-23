#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createKnowledgeGraph } = require('../lib/knowledge-graph.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
loadEnv(path.join(SERVER_ROOT, '.env.local'));

const runtimeRoot = path.resolve(
  process.env.A11_RUNTIME_ROOT || path.join(SERVER_ROOT, '..', '..', '..', 'runtime')
);
const graphDir = path.join(runtimeRoot, 'knowledge-graph');
const generatedAt = new Date().toISOString();
const publicBaseUrl = normalizePublicBaseUrl(process.env.A11_PUBLIC_BASE_URL || 'https://a11.funesterie.me');
const publicHealthUrl = normalizePublicBaseUrl(
  process.env.A11_PUBLIC_HEALTH_URL || new URL('/health', publicBaseUrl).toString()
);
const mcpBaseUrl = normalizePublicBaseUrl(process.env.A11_MCP_URL || 'https://mcp.funesterie.me/mcp');

const routeMap = {
  id: 'a11-local-route-map',
  label: 'A11 Local Route Map',
  generatedAt,
  mode: 'json-fallback-first',
  publicTarget: {
    url: publicBaseUrl,
    health: publicHealthUrl,
  },
  roots: {
    workspace: 'D:\\projets\\funesterie',
    a11: 'D:\\projets\\funesterie\\a11',
    runtime: runtimeRoot,
    corpus: 'D:\\projets\\funesterie\\runtime\\Corpus',
    a11Memory: 'D:\\projets\\funesterie\\a11\\a11_memory',
    vectorMemory: path.join(runtimeRoot, 'vector-memory'),
    visionMemory: path.join(runtimeRoot, 'vision-memory'),
    knowledgeGraph: graphDir,
    handoffArchive: 'D:\\projets\\funesterie\\a11_handoff_20260428',
  },
  services: {
    frontend: { port: 5173, route: '/' },
    backend: { port: 3000, health: '/health' },
    responder: { port: 3002 },
    tts: { port: 5002, route: '/api/tts' },
    llmRouter: { port: 4545, route: '/api/llm/stats' },
    qflush: { port: 43421, route: '/api/qflush' },
    ollama: { port: 11434, baseUrl: 'http://127.0.0.1:11434' },
    mcpDimensionnel: {
      protocol: 'json-rpc-2.0-stdio',
      canonicalPath: 'D:\\projets\\funesterie\\a11\\backend\\apps\\server\\tools\\mcp\\a11-mcp-server.cjs',
      legacyBridgePath: 'D:\\a11-mcp-server\\server.cjs',
      configuredBaseUrl: mcpBaseUrl,
      kiroConfig: 'D:\\projets\\funesterie\\.kiro\\settings\\mcp.json',
      dragonManifest: 'D:\\projets\\funesterie\\a11\\dragon\\DRAGON_MANIFEST.json',
      recoveryTools: ['a11_mcp_dimension_status', 'a11_route_map', 'a11_identity_route'],
    },
    neo4j: {
      uri: 'bolt://localhost:7687',
      http: 'http://127.0.0.1:7474/',
      database: process.env.NEO4J_DATABASE || 'a11-knowledge-graph',
      authState: process.env.NEO4J_AUTH_STATE || 'available',
    },
    runtimeHooks: {
      manifest: path.join(graphDir, 'a11-runtime-hooks.json'),
      summary: path.join(graphDir, 'a11-runtime-hooks.md'),
      script: 'npm run sync:runtime-hooks-neo4j',
      statusTool: 'a11_runtime_hooks_status',
    },
  },
  endpoints: [
    { id: 'health', method: 'GET', path: '/health', role: 'liveness' },
    { id: 'runtime-files', method: 'GET/POST/DELETE', path: '/api/agent/runtime/files', role: 'runtime-file-control' },
    { id: 'vision-memory', method: 'GET/POST', path: '/api/agent/vision-memory', role: 'image-memory' },
    { id: 'vector-memory', method: 'GET/POST/DELETE', path: '/api/vector-memory', role: 'rag-memory' },
    { id: 'knowledge-graph', method: 'GET/POST', path: '/api/knowledge-graph', role: 'semantic-graph' },
    { id: 'image-generate', method: 'POST', path: '/api/image-generate', role: 'image-generation' },
    { id: 'image-atelier', method: 'POST', path: '/api/image-atelier', role: 'image-workshop' },
    { id: 'sd-jobs', method: 'POST/GET', path: '/api/jobs/sd', role: 'local-sd-jobs' },
    { id: 'tts', method: 'POST', path: '/api/tts', role: 'voice' },
    { id: 'qflush', method: 'GET/POST', path: '/api/qflush', role: 'flow-orchestration' },
    { id: 'a11host-status', method: 'GET', path: '/api/a11host/status', role: 'host-bridge' },
    { id: 'a11-capabilities', method: 'GET', path: '/api/a11/capabilities', role: 'capability-map' },
    { id: 'mcp-dimension-status', method: 'MCP tool', path: 'a11_mcp_dimension_status', role: 'mcp-self-description' },
    { id: 'mcp-route-map', method: 'MCP tool', path: 'a11_route_map', role: 'identity-route-map' },
    { id: 'mcp-runtime-hooks-status', method: 'MCP tool', path: 'a11_runtime_hooks_status', role: 'runtime-hook-status' },
    { id: 'mcp-identity-route', method: 'MCP tool', path: 'a11_identity_route', role: 'identity-recovery' },
  ],
  bmpInventory: {
    totalObserved: 73,
    drives: { C: 20, D: 53, E: 0, G: 0 },
    usefulImages: [
      'C:\\Users\\Djeff\\OneDrive - Funesterie\\Bureau\\Berserk.bmp',
      'C:\\Users\\Djeff\\OneDrive - Funesterie\\Bureau\\Dprojetsfunesteriea11launchers.bmp',
      'C:\\Users\\Djeff\\OneDrive\\sources\\background_cli.bmp',
      'D:\\projets\\funesterie\\a11\\runtime\\files\\uploads\\upload_1777493086765_e2911da4_Berserk.bmp',
    ],
    ignoredClasses: ['Windows system BMPs', 'bmp-js test fixtures', 'Corpus mirror duplicates'],
  },
  nodes: [
    ['a11', 'A11', 'agent'],
    ['codex', 'Codex', 'operator-agent'],
    ['djeff', 'Djeff / Jeffrey Cellauro', 'creator'],
    ['funesterie', 'Funesterie', 'workspace'],
    ['public_url', publicBaseUrl, 'public-entrypoint'],
    ['frontend', 'A11 web frontend', 'service'],
    ['backend', 'A11 Express backend', 'service'],
    ['runtime', 'A11 runtime root', 'storage'],
    ['a11_seagate_external', 'A11_SEAGATE external disk', 'external-storage'],
    ['playstation_hdd_archive', 'PlayStation HDD raw archive', 'archive'],
    ['corpus', 'Runtime Corpus', 'corpus'],
    ['a11_memory', 'A11 memory folder', 'memory'],
    ['vector_memory', 'Vector memory', 'memory'],
    ['vision_memory', 'Vision memory', 'memory'],
    ['knowledge_graph_json', 'JSON knowledge graph fallback', 'graph'],
    ['neo4j_a11', 'Neo4j Desktop A11 instance', 'graph'],
    ['ollama', 'Ollama local LLM and embeddings', 'llm'],
    ['tts', 'TTS service', 'voice'],
    ['qflush', 'Qflush flows', 'orchestrator'],
    ['responder', 'A11 responder', 'service'],
    ['image_pipeline', 'Image generation pipeline', 'image'],
    ['sd_tools', 'Stable Diffusion tools', 'image'],
    ['runtime_files', 'Runtime files route', 'api'],
    ['a11host', 'A11Host bridge', 'api'],
    ['mcp_dimensionnel', 'MCP dimensionnel maison', 'mcp'],
    ['runtime_hooks', 'A11 runtime hooks', 'semantic-hook'],
    ['cortex', 'Cortex', 'runtime-hook'],
    ['spyder', 'Spyder', 'runtime-hook'],
    ['telemetry', 'Telemetry', 'runtime-hook'],
    ['rome', 'Rome', 'runtime-hook'],
    ['piccolo', 'Piccolo', 'repair-hook'],
    ['doctor', 'Doctor', 'diagnostic-hook'],
    ['kiro_mcp_settings', 'Kiro MCP settings', 'config'],
    ['dragon_mcp_manifest', 'Dragon MCP manifest', 'config'],
    ['mcp_identity_route', 'MCP identity route tools', 'recovery-route'],
    ['bmp_inventory', 'BMP inventory', 'visual-corpus'],
    ['berserk_bmp', 'Berserk BMP references', 'image-reference'],
    ['boostro', 'Boostro', 'pending-integration'],
  ],
  edges: [
    ['djeff', 'created', 'a11'],
    ['a11', 'belongs_to', 'funesterie'],
    ['codex', 'operates_on', 'a11'],
    ['public_url', 'serves', 'frontend'],
    ['frontend', 'calls', 'backend'],
    ['backend', 'uses', 'runtime'],
    ['runtime', 'links_to', 'a11_seagate_external'],
    ['a11_seagate_external', 'stores', 'playstation_hdd_archive'],
    ['playstation_hdd_archive', 'is_accessible_from', 'runtime'],
    ['backend', 'indexes', 'corpus'],
    ['backend', 'reads', 'a11_memory'],
    ['backend', 'writes', 'vector_memory'],
    ['backend', 'writes', 'vision_memory'],
    ['backend', 'writes', 'knowledge_graph_json'],
    ['backend', 'will_sync_to', 'neo4j_a11'],
    ['backend', 'calls', 'ollama'],
    ['backend', 'calls', 'tts'],
    ['backend', 'calls', 'qflush'],
    ['backend', 'calls', 'responder'],
    ['backend', 'routes_image_work_to', 'image_pipeline'],
    ['image_pipeline', 'uses', 'sd_tools'],
    ['runtime_files', 'exposes', 'runtime'],
    ['a11host', 'bridges', 'backend'],
    ['mcp_dimensionnel', 'wraps', 'backend'],
    ['mcp_dimensionnel', 'reads', 'knowledge_graph_json'],
    ['mcp_dimensionnel', 'exposes', 'mcp_identity_route'],
    ['mcp_dimensionnel', 'exposes', 'runtime_hooks'],
    ['runtime_hooks', 'writes_to', 'neo4j_a11'],
    ['runtime_hooks', 'describes', 'cortex'],
    ['runtime_hooks', 'describes', 'spyder'],
    ['runtime_hooks', 'describes', 'telemetry'],
    ['runtime_hooks', 'describes', 'rome'],
    ['runtime_hooks', 'describes', 'corpus'],
    ['runtime_hooks', 'describes', 'piccolo'],
    ['runtime_hooks', 'describes', 'doctor'],
    ['qflush', 'exposes', 'cortex'],
    ['qflush', 'exposes', 'spyder'],
    ['qflush', 'exposes', 'rome'],
    ['qflush', 'exposes', 'piccolo'],
    ['qflush', 'exposes', 'doctor'],
    ['cortex', 'routes_to', 'spyder'],
    ['cortex', 'routes_to', 'rome'],
    ['spyder', 'reports_to', 'telemetry'],
    ['rome', 'persists_to', 'telemetry'],
    ['piccolo', 'runs_checks_with', 'doctor'],
    ['doctor', 'reports_to', 'a11'],
    ['kiro_mcp_settings', 'launches', 'mcp_dimensionnel'],
    ['dragon_mcp_manifest', 'references', 'mcp_dimensionnel'],
    ['mcp_identity_route', 'recovers', 'a11'],
    ['mcp_identity_route', 'reads', 'corpus'],
    ['bmp_inventory', 'feeds', 'vision_memory'],
    ['berserk_bmp', 'is_part_of', 'bmp_inventory'],
    ['corpus', 'feeds', 'knowledge_graph_json'],
    ['corpus', 'feeds', 'vector_memory'],
    ['boostro', 'should_connect_to', 'backend'],
    ['boostro', 'should_read', 'knowledge_graph_json'],
  ],
};

async function main() {
  fs.mkdirSync(graphDir, { recursive: true });

  const graph = createKnowledgeGraph('a11', {
    forceJson: true,
    storageDir: graphDir,
  });

  const triplets = routeMap.edges.map(([subjectId, predicate, objectId]) => ({
    subject: labelFor(subjectId),
    predicate,
    object: labelFor(objectId),
  }));

  triplets.push(
    { subject: 'A11', predicate: 'identity_core', object: 'Je suis le lien, pas seulement une base de connaissance' },
    { subject: 'A11', predicate: 'nindo', object: 'Ne pas reculer. Ne pas mentir sauf pour creer. Precis, direct, utile.' },
    { subject: 'A11', predicate: 'nindo2', object: 'Trouver la structure invisible qui relie' },
    { subject: 'Neo4j Desktop A11 instance', predicate: 'auth_state', object: process.env.NEO4J_AUTH_STATE || 'available' },
    { subject: 'Public A11 URL', predicate: 'health_endpoint', object: '/health' },
    { subject: 'Docker compose healthcheck', predicate: 'needs_alignment_with', object: '/health' }
  );

  const result = await graph.addTriplets(triplets, {
    source: 'seed-a11-local-route-map',
    generatedAt,
    mode: 'json-fallback',
  });

  const mapPath = path.join(graphDir, 'a11-route-map.json');
  const cypherPath = path.join(graphDir, 'a11-route-map.cypher');
  const summaryPath = path.join(graphDir, 'a11-route-map.md');

  fs.writeFileSync(mapPath, JSON.stringify(routeMap, null, 2), 'utf8');
  fs.writeFileSync(cypherPath, toCypher(routeMap), 'utf8');
  fs.writeFileSync(summaryPath, toMarkdown(routeMap, result), 'utf8');

  const stats = await graph.getStats();
  console.log('[A11 route map] seeded JSON fallback graph');
  console.log(`[A11 route map] graph storage: ${graphDir}`);
  console.log(`[A11 route map] triplets added: ${triplets.length}`);
  console.log(`[A11 route map] graph nodes: ${stats.nodeCount}`);
  console.log(`[A11 route map] graph edges: ${stats.edgeCount}`);
  console.log(`[A11 route map] map: ${mapPath}`);
  console.log(`[A11 route map] cypher: ${cypherPath}`);
  console.log(`[A11 route map] summary: ${summaryPath}`);
}

function labelFor(id) {
  const node = routeMap.nodes.find(([nodeId]) => nodeId === id);
  return node ? node[1] : id;
}

function cypherString(value) {
  return JSON.stringify(String(value || ''));
}

function normalizePublicBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.pathname === '/' && !raw.endsWith('/')) {
      return `${parsed.origin}/`;
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function toCypher(map) {
  const lines = [
    '// A11 local route map export',
    `// Generated at ${map.generatedAt}`,
    'CREATE CONSTRAINT a11_route_entity_id IF NOT EXISTS FOR (n:A11RouteEntity) REQUIRE n.id IS UNIQUE;',
    '',
  ];

  for (const [id, label, kind] of map.nodes) {
    lines.push([
      `MERGE (n:A11RouteEntity {id: ${cypherString(id)}})`,
      `SET n.label = ${cypherString(label)},`,
      `    n.kind = ${cypherString(kind)},`,
      `    n.updatedAt = datetime(${cypherString(map.generatedAt)})`,
      ';',
    ].join('\n'));
  }

  for (const [source, predicate, target] of map.edges) {
    const rel = predicate.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    lines.push([
      `MATCH (a:A11RouteEntity {id: ${cypherString(source)}}), (b:A11RouteEntity {id: ${cypherString(target)}})`,
      `MERGE (a)-[r:${rel}]->(b)`,
      `SET r.label = ${cypherString(predicate)},`,
      `    r.updatedAt = datetime(${cypherString(map.generatedAt)})`,
      ';',
    ].join('\n'));
  }

  return `${lines.join('\n')}\n`;
}

function toMarkdown(map, result) {
  const lines = [
    '# A11 Route Map',
    '',
    `Generated: ${map.generatedAt}`,
    '',
    '## Public',
    '',
    `- URL: ${map.publicTarget.url}`,
    `- Health: ${map.publicTarget.health}`,
    '',
    '## Local Graph',
    '',
    `- Mode: ${map.mode}`,
    `- Triplets added: ${result.added}`,
    `- New nodes reported by graph: ${result.nodes}`,
    `- New edges reported by graph: ${result.edges}`,
    '',
    '## Main Links',
    '',
  ];

  for (const [source, predicate, target] of map.edges) {
    lines.push(`- ${labelFor(source)} --${predicate}--> ${labelFor(target)}`);
  }

  lines.push('', '## BMP Inventory', '');
  lines.push(`- Total observed: ${map.bmpInventory.totalObserved}`);
  for (const image of map.bmpInventory.usefulImages) {
    lines.push(`- Useful image: ${image}`);
  }

  return `${lines.join('\n')}\n`;
}

function loadEnv(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim();
      if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    }
  } catch (_) {}
}

main().catch((error) => {
  console.error('[A11 route map] seed failed:', error.message);
  process.exit(1);
});

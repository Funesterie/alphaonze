#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const {
  buildMemoryGraph,
  safeLabel,
  safeRel,
  sanitizeProperties,
  toMarkdown,
} = require('../src/knowledge/a11-memory-graph-v1.cjs');
const {
  resolveRouterConfig,
  sanitizePropertyMap,
  withSession,
} = require('../lib/neo4j-memory-router.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');
const GRAPH_DIR = path.resolve(process.env.A11_MEMORY_GRAPH_V1_OUT_DIR || path.join(A11_ROOT, 'runtime', 'knowledge-graph'));
const OUT_JSON = path.join(GRAPH_DIR, 'a11-memory-graph-v1.json');
const OUT_MD = path.join(GRAPH_DIR, 'a11-memory-graph-v1.md');
const OUT_CYPHER = path.join(GRAPH_DIR, 'a11-memory-graph-v1.cypher');

function loadEnvFiles() {
  const candidates = [
    path.join(SERVER_ROOT, '.env.local'),
    path.join(SERVER_ROOT, '.env'),
    path.join(A11_ROOT, '.env.local'),
    path.join(A11_ROOT, '.env'),
    path.join(WORKSPACE_ROOT, 'a11mcp', '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, override: false });
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const targetArg = argv.find((arg) => arg.startsWith('--target='));
  return {
    dryRun: args.has('--dry-run'),
    writeFiles: !args.has('--no-write-files'),
    pretty: args.has('--pretty'),
    target: targetArg ? targetArg.split('=')[1] : 'local',
  };
}

function nodeLabels(node) {
  const labels = new Set(['A11MemoryGraphNode']);
  for (const label of node.labels || []) {
    const safe = safeLabel(label);
    if (safe === 'A11MemoryGraphNode') continue;
    labels.add(`A11MG${safe}`);
  }
  return Array.from(labels);
}

function cypherIdentifier(value) {
  return `\`${String(value || '').replace(/`/g, '``')}\``;
}

function cypherValue(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(cypherValue).join(', ')}]`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(String(value));
}

function cypherMap(properties = {}) {
  const entries = Object.entries(sanitizeProperties(properties || {}))
    .filter(([key, value]) => key && value !== undefined)
    .map(([key, value]) => `${cypherIdentifier(key)}: ${cypherValue(value)}`);
  return `{${entries.join(', ')}}`;
}

function relationshipId(rel, index) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      index,
      from: rel.from,
      to: rel.to,
      type: rel.type,
      properties: sanitizeProperties(rel.properties || {}),
    }))
    .digest('hex')
    .slice(0, 24);
  return `rel:${hash}`;
}

function toCypher(graph) {
  const lines = [
    'CREATE CONSTRAINT a11_memory_graph_node_id IF NOT EXISTS',
    'FOR (n:A11MemoryGraphNode) REQUIRE n.id IS UNIQUE;',
    '',
  ];
  for (const node of graph.nodes) {
    const labels = nodeLabels(node).map((label) => `:${label}`).join('');
    lines.push(`MERGE (n:A11MemoryGraphNode {id: ${JSON.stringify(node.id)}}) SET n += ${cypherMap(node.properties || {})} SET n${labels};`);
  }
  lines.push('');
  for (const [index, rel] of graph.relationships.entries()) {
    const type = safeRel(rel.type);
    const props = { id: relationshipId(rel, index), ...(rel.properties || {}) };
    lines.push(
      `MATCH (a:A11MemoryGraphNode {id: ${JSON.stringify(rel.from)}}), (b:A11MemoryGraphNode {id: ${JSON.stringify(rel.to)}}) `
      + `MERGE (a)-[r:${type} {id: ${JSON.stringify(props.id)}}]->(b) SET r += ${cypherMap(props)};`
    );
  }
  return `${lines.join('\n')}\n`;
}

function writeArtifacts(graph, options) {
  fs.mkdirSync(GRAPH_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(graph, null, options.pretty ? 2 : 0), 'utf8');
  fs.writeFileSync(OUT_MD, toMarkdown(graph), 'utf8');
  fs.writeFileSync(OUT_CYPHER, toCypher(graph), 'utf8');
  return { json: OUT_JSON, markdown: OUT_MD, cypher: OUT_CYPHER };
}

async function applyGraphToNeo4j(graph, endpoint) {
  return withSession(endpoint, 'write', async (session) => {
    await session.run(
      'CREATE CONSTRAINT a11_memory_graph_node_id IF NOT EXISTS FOR (n:A11MemoryGraphNode) REQUIRE n.id IS UNIQUE'
    );
    for (const node of graph.nodes) {
      const labels = nodeLabels(node).map((label) => `:${label}`).join('');
      await session.run(
        `MERGE (n:A11MemoryGraphNode {id: $id}) SET n += $props SET n${labels}`,
        { id: node.id, props: sanitizePropertyMap(sanitizeProperties(node.properties || {})) }
      );
    }
    for (const [index, rel] of graph.relationships.entries()) {
      const type = safeRel(rel.type);
      const props = { id: relationshipId(rel, index), ...(rel.properties || {}) };
      await session.run(
        `MATCH (a:A11MemoryGraphNode {id: $from}), (b:A11MemoryGraphNode {id: $to}) MERGE (a)-[r:${type} {id: $relId}]->(b) SET r += $props`,
        {
          from: rel.from,
          to: rel.to,
          relId: props.id,
          props: sanitizePropertyMap(sanitizeProperties(props)),
        }
      );
    }
    return { nodes: graph.nodes.length, relationships: graph.relationships.length };
  });
}

async function main() {
  loadEnvFiles();
  const options = parseArgs();
  const graph = buildMemoryGraph();
  const artifacts = options.writeFiles ? writeArtifacts(graph, options) : {};
  const result = {
    ok: true,
    dryRun: options.dryRun,
    target: options.target,
    schema: graph.schema,
    summary: graph.summary,
    sourcePolicy: graph.sourcePolicy,
    artifacts,
    neo4j: [],
  };

  if (!options.dryRun) {
    const config = resolveRouterConfig(process.env);
    const targets = options.target === 'both'
      ? [config.local, config.aura]
      : [config[options.target] || config.local];
    for (const endpoint of targets) {
      const applied = await applyGraphToNeo4j(graph, endpoint);
      result.neo4j.push({
        name: endpoint.name,
        uri: endpoint.uri,
        database: endpoint.database,
        ...applied,
      });
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: 'sync_a11_memory_graph_v1_failed',
    message: String(error?.message || error),
  }, null, 2));
  process.exitCode = 1;
});

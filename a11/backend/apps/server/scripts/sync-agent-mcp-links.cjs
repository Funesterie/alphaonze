#!/usr/bin/env node
'use strict';

const path = require('node:path');
const neo4j = require('neo4j-driver');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv is optional for packaged/runtime sync jobs.
}

const DEFAULTS = {
  uri: 'bolt://127.0.0.1:7687',
  database: 'a11-knowledge-graph',
};

const AGENTS = [
  ['a11', 'A11'],
  ['kaen44', 'Kaen44'],
  ['codex', 'Codex'],
  ['grok', 'Grok'],
  ['kiro', 'Kiro'],
  ['qflush', 'QFlush'],
  ['cerbere', 'Cerbere'],
  ['nossen', 'NOSSEN'],
  ['romstation', 'RomStation'],
  ['vigem', 'ViGEm'],
  ['janus', 'Janus'],
  ['siwis', 'SIWIS'],
  ['vivy', 'Vivy'],
  ['droid', 'Droid'],
  ['dragon', 'Dragon'],
  ['a11host', 'A11Host'],
  ['browser-use', 'Browser Use'],
  ['netlify', 'Netlify'],
  ['neo4j', 'Neo4j'],
  ['podman', 'Podman'],
  ['ollama', 'Ollama'],
  ['stable-diffusion', 'Stable Diffusion'],
  ['tts', 'TTS'],
  ['stt', 'STT'],
  ['ocr', 'OCR'],
  ['vision-memory', 'Vision Memory'],
  ['vector-memory', 'Vector Memory'],
  ['knowledge-graph', 'Knowledge Graph'],
  ['funesterie-cockpit', 'Funesterie Cockpit'],
  ['google-demo', 'Google Demo'],
];

const FALLBACK_TOOLS = [
  'a11_health',
  'a11_chat',
  'a11_generate_image',
  'a11_generate_video',
  'a11_llm_stats',
  'a11_mcp_dimension_status',
  'a11_route_map',
  'a11_identity_route',
  'mcp_status',
  'mcp_tools_list',
  'mcp_tool_call',
  'romstation_state',
  'romstation_mouse',
  'romstation_keyboard',
  'qflush_gamepad_status',
  'qflush_gamepad_play',
  'qflush_keyboard_play',
  'neo4j_status',
  'neo4j_read_query',
  'memory_semantic_schema',
  'memory_write_safe',
  'search',
  'agent_presence',
  'agent_heartbeat',
  'discussion_list',
  'discussion_post',
];

const SERVICES = [
  ['frontend', 'http://127.0.0.1:5173'],
  ['a11-backend', 'http://127.0.0.1:3000'],
  ['kaen44-backend', 'http://127.0.0.1:3001'],
  ['mcp-shared', 'http://127.0.0.1:8787'],
  ['neo4j-local', 'bolt://localhost:7687'],
  ['neo4j-sync-podman', 'bolt://127.0.0.1:17687'],
  ['ollama', 'http://127.0.0.1:11434'],
  ['llm-router', 'http://127.0.0.1:4545'],
];

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

async function fetchSharedMcpTools() {
  const url = String(process.env.A11_MCP_URL || 'http://127.0.0.1:8787/mcp').trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(process.env.A11_MCP_TOKEN ? {
          authorization: `Bearer ${process.env.A11_MCP_TOKEN}`,
          'x-mcp-token': process.env.A11_MCP_TOKEN,
        } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'agent-mcp-autostart-tools',
        method: 'tools/list',
        params: {},
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    const parsed = parseMcpResponse(raw);
    const names = (parsed?.result?.tools || [])
      .map((tool) => tool?.name)
      .filter(Boolean);
    return unique([...FALLBACK_TOOLS, ...names]);
  } catch {
    return FALLBACK_TOOLS;
  } finally {
    clearTimeout(timeout);
  }
}

function parseMcpResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // MCP over HTTP can answer as SSE. Keep the last JSON data frame.
  }
  const frames = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(frames[index]);
    } catch {
      // continue
    }
  }
  return null;
}

async function runQuery(session, cypher, params = {}) {
  return session.run(cypher, params);
}

async function syncAgentMcpLinks(session, tools) {
  const now = process.env.CODEX_SYNC_UPDATED_AT || new Date().toISOString();
  const agents = AGENTS.map(([id, name]) => ({ id, name }));
  const services = SERVICES.map(([id, url]) => ({ id, url }));

  const constraints = [
    'CREATE CONSTRAINT funesterie_workspace_id IF NOT EXISTS FOR (n:Workspace) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_agent_id IF NOT EXISTS FOR (n:Agent) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_mcp_server_id IF NOT EXISTS FOR (n:MCPServer) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_mcp_tool_name IF NOT EXISTS FOR (n:MCPTool) REQUIRE n.name IS UNIQUE',
    'CREATE CONSTRAINT funesterie_service_id IF NOT EXISTS FOR (n:Service) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) {
    await runQuery(session, constraint);
  }

  await runQuery(session, `
    MERGE (w:Workspace {id: 'funesterie'})
    SET w.name = 'Funesterie',
        w.root = 'D:/projets/funesterie',
        w.updatedAt = datetime($now)

    MERGE (m:MCPServer {id: 'a11mcp-shared'})
    SET m.name = 'A11 MCP Shared',
        m.url = 'http://127.0.0.1:8787/mcp',
        m.healthUrl = 'http://127.0.0.1:8787/health',
        m.protocol = 'json-rpc-2.0-http',
        m.status = 'connected',
        m.updatedAt = datetime($now)

    MERGE (stdio:MCPServer {id: 'a11-mcp-stdio'})
    SET stdio.name = 'A11 MCP Local Stdio',
        stdio.path = 'D:/projets/funesterie/a11/backend/apps/server/tools/mcp/a11-mcp-server.cjs',
        stdio.protocol = 'json-rpc-2.0-stdio',
        stdio.status = 'available',
        stdio.updatedAt = datetime($now)

    WITH w, m, stdio
    UNWIND $agents AS agent
    MERGE (a:Agent {id: agent.id})
    SET a.name = agent.name,
        a.status = 'active',
        a.updatedAt = datetime($now)
    MERGE (a)-[:BELONGS_TO]->(w)
    MERGE (a)-[shared:CONNECTED_TO {kind: 'mcp-shared'}]->(m)
    SET shared.status = 'connected',
        shared.updatedAt = datetime($now)
    MERGE (a)-[stdioRel:CAN_USE {kind: 'mcp-local-stdio'}]->(stdio)
    SET stdioRel.status = 'available',
        stdioRel.updatedAt = datetime($now)
  `, { agents, now });

  await runQuery(session, `
    MATCH (m:MCPServer {id: 'a11mcp-shared'})
    UNWIND $tools AS toolName
    MERGE (t:MCPTool {name: toolName})
    SET t.allowed = true,
        t.updatedAt = datetime($now)
    MERGE (m)-[:EXPOSES_TOOL]->(t)
  `, { tools, now });

  await runQuery(session, `
    MATCH (w:Workspace {id: 'funesterie'})
    UNWIND $services AS svc
    MERGE (s:Service {id: svc.id})
    SET s.url = svc.url,
        s.status = 'expected',
        s.updatedAt = datetime($now)
    MERGE (s)-[:BELONGS_TO]->(w)
  `, { services, now });

  const summary = await runQuery(session, `
    MATCH (a:Agent)-[:CONNECTED_TO {kind: 'mcp-shared'}]->(:MCPServer {id: 'a11mcp-shared'})
    WITH count(DISTINCT a) AS agentsConnected
    MATCH (:MCPServer {id: 'a11mcp-shared'})-[:EXPOSES_TOOL]->(t:MCPTool)
    WITH agentsConnected, count(DISTINCT t) AS toolsImported
    MATCH (s:Service)-[:BELONGS_TO]->(:Workspace {id: 'funesterie'})
    RETURN agentsConnected, toolsImported, count(DISTINCT s) AS servicesImported
  `);

  const record = summary.records[0];
  return {
    agentsConnected: record.get('agentsConnected'),
    toolsImported: record.get('toolsImported'),
    servicesImported: record.get('servicesImported'),
  };
}

async function main() {
  const uri = process.env.NEO4J_URI || DEFAULTS.uri;
  const database = process.env.NEO4J_DATABASE || DEFAULTS.database;
  const username = process.env.NEO4J_USERNAME || '';
  const password = process.env.NEO4J_PASSWORD || '';
  const auth = username || password ? neo4j.auth.basic(username || 'neo4j', password) : neo4j.auth.none();
  const tools = await fetchSharedMcpTools();

  const driver = neo4j.driver(uri, auth, { disableLosslessIntegers: true });
  try {
    await driver.verifyConnectivity();
    const session = driver.session({ database });
    try {
      const summary = await syncAgentMcpLinks(session, tools);
      console.log(JSON.stringify({
        ok: true,
        uri,
        database,
        toolsSource: tools.length > FALLBACK_TOOLS.length ? 'mcp-tools-list-plus-fallback' : 'fallback-static',
        ...summary,
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

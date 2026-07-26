/**
 * Neo4j MCP Bridge for Funesterie
 * 
 * Expose le graphe de connaissances aux agents via MCP.
 * Les personas, les couleurs Pulsar, les relations - tout est dans le graphe.
 * 
 * "Et la lumiere fut" - mais on voit que les tenebres parce que la lumiere
 * est dans le graphe, pas dans l'espace. Le noir c'est le NoirPetrole 0.05.
 * Le reste, on le devine par les relations.
 */

'use strict';

const http = require('node:http');

const NEO4J_URL = process.env.NEO4J_URL || 'http://localhost:7474/db/neo4j/tx/commit';
const NEO4J_AUTH = 'Basic ' + Buffer.from(
  (process.env.NEO4J_USER || 'neo4j') + ':' + (process.env.NEO4J_PASSWORD || 'nossen1234')
).toString('base64');

async function cypher(statement, parameters = {}) {
  const res = await fetch(NEO4J_URL, {
    method: 'POST',
    headers: { Authorization: NEO4J_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ statements: [{ statement, parameters: parameters || {} }] }),
  });
  const data = await res.json();
  if (data.errors && data.errors.length > 0) {
    throw new Error(data.errors[0].message);
  }
  return data.results[0]?.data?.map(row => row.row) || [];
}

// MCP tools exposed to agents
const TOOLS = [
  {
    name: 'neo4j_query',
    description: 'Execute a Cypher query on the Funesterie knowledge graph. Personas, Pulsar colors, relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cypher query (MATCH/MERGE/CREATE)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'persona_get',
    description: 'Get a persona by name with their Pulsar color, gamma, and relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Persona name (Djeff, Vivy, A11, K44, Kiro, Zoro, NOSSEN)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'persona_list',
    description: 'List all personas with their colors and roles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pulsar_colors',
    description: 'List all Pulsar colors with gamma values and complementary pairs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'persona_relations',
    description: 'Get all relationships for a persona (who they connect to, what they carry).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'graph_salt',
    description: 'Generate a relational salt from the knowledge graph for PKCS#1 RSA signing. Uses defragmentation relationnelle.',
    inputSchema: {
      type: 'object',
      properties: {
        persona: { type: 'string', description: 'Persona to generate salt for' },
      },
      required: ['persona'],
    },
  },
  {
    name: 'nossen_nexus',
    description: 'Get the NOSSEN nexus - all connections from the central node.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case 'neo4j_query':
      const rows = await cypher(args.query);
      return { rows, count: rows.length };

    case 'persona_get':
      const persona = await cypher(
        `MATCH (p:Persona {name: $name}) OPTIONAL MATCH (p)-[r]->(t) RETURN p, r, t`,
        { name: args.name }
      );
      return persona;

    case 'persona_list':
      const personas = await cypher(
        `MATCH (p:Persona) OPTIONAL MATCH (p)-[:CARRIES]->(c:PulsarColor) 
         RETURN p.name, p.role, p.style, p.beat, c.name as color, c.gamma`
      );
      return personas;

    case 'pulsar_colors':
      const colors = await cypher(
        `MATCH (c:PulsarColor) OPTIONAL MATCH (c)-[:COMPLEMENTARY]->(c2:PulsarColor)
         RETURN c.name, c.hex, c.gamma, c2.name as complement`
      );
      return colors;

    case 'persona_relations':
      const rels = await cypher(
        `MATCH (p:Persona {name: $name})-[r]->(t) 
         RETURN type(r) as relation, labels(t)[0] as type, t.name as target`,
        { name: args.name }
      );
      return rels;

    case 'graph_salt':
      // Get all triplets for the persona from the graph
      const triplets = await cypher(
        `MATCH (p:Persona {name: $persona})-[r]->(t) 
         RETURN p.name as s, type(r) as rel, t.name as o
         UNION ALL
         MATCH (t)-[r]->(p:Persona {name: $persona})
         RETURN t.name as s, type(r) as rel, p.name as o`,
        { persona: args.persona }
      );
      // Defragmentation relationnelle
      const crypto = require('./pulsar-crypto.cjs');
      const salt = crypto.generateRelationalSalt(
        triplets.map(t => ({ subject: t[0], relation: t[1], object: t[2] }))
      );
      return { salt, triplets: triplets.length };

    case 'nossen_nexus':
      const nexus = await cypher(
        `MATCH (n:Persona {name: 'NOSSEN'})-[r:CONNECTS]->(all:Persona)
         RETURN all.name, all.role, all.style`
      );
      return nexus;

    default:
      return { error: 'Unknown tool: ' + name };
  }
}

// Simple MCP-over-HTTP server
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && req.url === '/tools') {
    res.end(JSON.stringify({ tools: TOOLS }));
    return;
  }

  if (req.method === 'POST' && req.url === '/call') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { name, arguments: args } = JSON.parse(body);
        const result = await handleTool(name, args || {});
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.NEO4J_MCP_PORT || 3567;
server.listen(PORT, () => {
  console.log(`[NOSSEN MCP] Neo4j MCP bridge on port ${PORT}`);
  console.log(`[NOSSEN MCP] Tools: ${TOOLS.length}`);
  console.log(`[NOSSEN MCP] GET  /tools - list tools`);
  console.log(`[NOSSEN MCP] POST /call   - call a tool`);
  console.log(`[NOSSEN MCP] Neo4j: ${NEO4J_URL}`);
  console.log(`[NOSSEN MCP] "Et la lumiere fut. On voit que les tenebres."`);
});

module.exports = { server, TOOLS, handleTool, cypher };

'use strict';

const http = require('node:http');

const PORT = Number(process.env.MCP_PORT || 8090);
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8089';

const TOOLS = Object.freeze([
  {
    name: 'search_entities',
    description: 'Read-only lexical entity search within the current tenant and case.'
  },
  {
    name: 'semantic_search',
    description: 'Read-only semantic search within the current tenant and case.'
  },
  {
    name: 'entity_links',
    description: 'Read-only entity link lookup.'
  },
  {
    name: 'timeline',
    description: 'Read-only case timeline.'
  },
  {
    name: 'sources',
    description: 'Read-only source lookup for one entity.'
  },
  {
    name: 'report_summary',
    description: 'Read-only sourced report summary.'
  }
]);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function backend(pathname, options = {}) {
  const response = await fetch(`${BACKEND_URL}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      'x-demo-user': options.userId || 'mcp-agent',
      'x-demo-role': options.role || 'analyste',
      'x-demo-tenant': options.tenantId || 'tenant-demo',
      'x-demo-case': options.caseId || 'case-demo-001',
      'x-agent': 'true'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return response.json();
}

async function callTool(name, args = {}) {
  if (!TOOLS.some((tool) => tool.name === name)) {
    throw Object.assign(new Error(`Tool not allowed: ${name}`), { code: 'mcp_tool_not_allowed' });
  }

  switch (name) {
    case 'search_entities':
      return backend(`/api/search?mode=lexical&q=${encodeURIComponent(args.query || '')}`, args);
    case 'semantic_search':
      return backend(`/api/search?mode=semantic&q=${encodeURIComponent(args.query || '')}`, args);
    case 'entity_links':
      return backend(`/api/entities/${encodeURIComponent(args.entityId || '')}/links`, args);
    case 'timeline':
      return backend('/api/timeline', args);
    case 'sources':
      return backend(`/api/sources?entity_id=${encodeURIComponent(args.entityId || '')}`, args);
    case 'report_summary':
      return backend('/api/report', args);
    default:
      throw Object.assign(new Error(`Tool not allowed: ${name}`), { code: 'mcp_tool_not_allowed' });
  }
}

async function handle(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        ok: true,
        app: 'investigation-graph-mcp-server',
        read_only_by_default: true
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/mcp') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    const payload = await readBody(req);
    if (payload.method === 'tools/list') {
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id,
        result: { tools: TOOLS }
      });
      return;
    }

    if (payload.method === 'tools/call') {
      const result = await callTool(payload.params?.name, payload.params?.arguments || {});
      sendJson(res, 200, {
        jsonrpc: '2.0',
        id: payload.id,
        result
      });
      return;
    }

    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: payload.id,
      error: { code: 'method_not_allowed', message: 'Only tools/list and tools/call are enabled.' }
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.code || 'bad_request',
      message: error.message
    });
  }
}

const server = http.createServer(handle);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`investigation MCP facade listening on ${PORT}`);
  });
}

module.exports = { handle, server };


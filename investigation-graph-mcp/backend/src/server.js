'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const {
  createEmptyState,
  deleteCaseData,
  exportReport,
  getEntityLinks,
  getSourcesForEntity,
  getTimeline,
  importDocument,
  lexicalSearch,
  runAllowedQuery,
  seedDemoCase,
  semanticSearch
} = require('./domain');
const { buildContext } = require('./policy');

const PORT = Number(process.env.BACKEND_PORT || 8080);
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
const state = createEmptyState();
const rateBuckets = new Map();

function loadDemoText() {
  const samplePath = path.resolve(__dirname, '..', '..', 'sample-data', 'fake-pv-001.txt');
  const fallbackPath = path.resolve(__dirname, '..', '..', '..', 'sample-data', 'fake-pv-001.txt');
  for (const candidate of [samplePath, fallbackPath]) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return [
    'Proces-verbal fictif fake-pv-001.',
    'Camille Durand declare avoir vu un scooter blanc pres du 12 rue des Mimosas, Port-Lumiere.',
    'Telephone mentionne: 06 11 22 33 44.',
    'Plaque mentionnee: AB-123-CD.',
    'Date: 2026-01-12 21:40.',
    'Evenement: rendez-vous manque pres du garage nord.'
  ].join('\n');
}

seedDemoCase(state, loadDemoText());

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-demo-user,x-demo-role,x-demo-tenant,x-demo-case,x-demo-allowed-cases,x-agent,x-request-id'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function checkRateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (rateBuckets.get(ip) || []).filter((stamp) => stamp > windowStart);
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return bucket.length <= RATE_LIMIT_PER_MINUTE;
}

function routeParams(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) {
    return null;
  }
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (!checkRateLimit(req)) {
    sendJson(res, 429, { error: 'rate_limited', message: 'Too many requests.' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const context = buildContext(req.headers);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        app: 'investigation-graph-mcp-backend',
        demo: true
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/allowed-tools') {
      sendJson(res, 200, {
        queries: ['search_lexical', 'search_semantic', 'timeline_for_case', 'entity_links', 'source_lookup', 'report_summary'],
        note: 'No free Cypher accepted.'
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/import/fake-pv') {
      const body = await readBody(req);
      const result = importDocument(state, context, {
        tenantId: context.tenantId,
        caseId: context.caseId,
        sourceId: body.sourceId || `fake-pv-${Date.now()}`,
        sourceType: body.sourceType || 'proces_verbal_fictif',
        text: body.text || loadDemoText(),
        classification: body.classification || 'restricted'
      });
      sendJson(res, 201, {
        source_id: result.document.id,
        extracted: result.extracted,
        node_count: result.nodes.length,
        relation_count: result.relations.length
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/search') {
      const query = url.searchParams.get('q') || '';
      const mode = url.searchParams.get('mode') || 'lexical';
      const results = mode === 'semantic' ? semanticSearch(state, context, query) : lexicalSearch(state, context, query);
      sendJson(res, 200, { mode, query, results });
      return;
    }

    const linksParams = routeParams(url.pathname, '/api/entities/:entityId/links');
    if (req.method === 'GET' && linksParams) {
      sendJson(res, 200, {
        entity_id: linksParams.entityId,
        links: getEntityLinks(state, context, linksParams.entityId)
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/timeline') {
      sendJson(res, 200, { timeline: getTimeline(state, context) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/sources') {
      const entityId = url.searchParams.get('entity_id') || '';
      sendJson(res, 200, { entity_id: entityId, sources: getSourcesForEntity(state, context, entityId) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/report') {
      sendJson(res, 200, exportReport(state, context));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/audit') {
      sendJson(res, 200, { audit: state.audit.filter((entry) => entry.tenant_id === context.tenantId) });
      return;
    }

    const deleteParams = routeParams(url.pathname, '/api/cases/:caseId');
    if (req.method === 'DELETE' && deleteParams) {
      sendJson(res, 200, { deletion: deleteCaseData(state, context, context.tenantId, deleteParams.caseId) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/query') {
      const body = await readBody(req);
      sendJson(res, 200, { result: runAllowedQuery(state, context, body) });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    sendJson(res, error.code === 'permission_denied' ? 403 : 400, {
      error: error.code || 'bad_request',
      message: error.message
    });
  }
}

const server = http.createServer(handle);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`investigation-graph-mcp backend listening on ${PORT}`);
  });
}

module.exports = { handle, server, state };


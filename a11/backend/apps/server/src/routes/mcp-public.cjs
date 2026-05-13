'use strict';

const express = require('express');

const SERVER_VERSION = '1.0.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';

const DEFAULT_PUBLIC_BASES = Object.freeze([
  'https://a11.funesterie.pro',
  'https://k44.funesterie.me',
  'https://kaen44.funesterie.me',
  'https://funesterie.me',
  'https://www.funesterie.me',
]);

const SAFE_TOOLS = Object.freeze([
  {
    name: 'a11_health',
    description: 'Verifie que le backend A11/Kaen44 est en ligne.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'a11_llm_stats',
    description: 'Retourne les statistiques publiques Cerbere/LLM sans secret.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'a11_chat',
    description: 'Envoie un message au chat A11/Kaen44 via les garde-fous HTTP existants.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        conversationId: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['message'],
    },
  },
  {
    name: 'a11_mcp_public_status',
    description: 'Retourne le manifeste public MCP expose par ce domaine.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]);

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function splitConfiguredBases(value) {
  return String(value || '')
    .split(',')
    .map(normalizeBaseUrl)
    .filter(Boolean);
}

function resolveInternalBaseUrl() {
  const explicit = normalizeBaseUrl(process.env.A11_MCP_INTERNAL_BASE_URL || process.env.A11_INTERNAL_API_BASE_URL);
  if (explicit) return explicit;
  const port = String(process.env.PORT || 3000).trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

function resolveRequestBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || '';
  return host ? `${proto}://${host}` : '';
}

function resolvePublicBases(req) {
  const configured = splitConfiguredBases(process.env.A11_MCP_PUBLIC_BASES);
  const current = normalizeBaseUrl(resolveRequestBaseUrl(req));
  return [...new Set([current, ...configured, ...DEFAULT_PUBLIC_BASES].filter(Boolean))];
}

function publicHeaders(req) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };

  const auth = String(req.headers.authorization || '').trim();
  const nez = String(req.headers['x-nez-token'] || '').trim();
  const cookie = String(req.headers.cookie || '').trim();
  if (auth) headers.authorization = auth;
  if (nez) headers['x-nez-token'] = nez;
  if (cookie) headers.cookie = cookie;
  return headers;
}

async function requestInternalJson(req, pathname, options = {}) {
  const base = resolveInternalBaseUrl();
  const url = `${base}${pathname}`;
  const method = options.method || 'GET';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(options.timeoutMs || 30_000));

  try {
    const response = await fetch(url, {
      method,
      headers: publicHeaders(req),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: ctrl.signal,
    });
    const data = await response.json().catch(async () => ({
      ok: false,
      raw: await response.text().catch(() => ''),
    }));
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function buildPublicMcpManifest(req) {
  const publicBases = resolvePublicBases(req);
  const endpointBases = publicBases.map((base) => ({
    baseUrl: base,
    mcp: `${base}/mcp`,
    wellKnown: `${base}/.well-known/mcp`,
    status: `${base}/api/mcp/status`,
  }));

  return {
    ok: true,
    kind: 'a11_public_mcp',
    protocol: 'json-rpc-2.0-http',
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: 'a11-public',
      version: SERVER_VERSION,
    },
    endpoints: endpointBases,
    tools: SAFE_TOOLS.map((tool) => tool.name),
    auth: {
      mode: 'normal_a11_http_guards',
      secretsExposed: false,
      note: 'Les outils publics ne publient aucun token. Les appels chat passent par les garde-fous HTTP existants.',
    },
    canonicalDomains: {
      a11: 'https://a11.funesterie.pro/mcp',
      kaen44: 'https://k44.funesterie.me/mcp',
      kaen44Legacy: 'https://kaen44.funesterie.me/mcp',
    },
    aliasNotes: {
      'a11.funesteri.pro': 'typo non routee; utiliser a11.funesterie.pro',
      'k44.me': 'domaine externe non route Funesterie; utiliser k44.funesterie.me',
    },
  };
}

function mcpResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function formatToolResult(payload, status = 200) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: status >= 400 || payload?.ok === false,
  };
}

async function callTool(req, name, args = {}) {
  switch (name) {
    case 'a11_health': {
      const response = await requestInternalJson(req, '/health');
      return formatToolResult(response.data, response.status);
    }

    case 'a11_llm_stats': {
      const response = await requestInternalJson(req, '/api/llm/stats');
      return formatToolResult(response.data, response.status);
    }

    case 'a11_chat': {
      const message = String(args.message || '').trim();
      if (!message) {
        return formatToolResult({ ok: false, error: 'missing_message' }, 400);
      }
      const response = await requestInternalJson(req, '/api/chat', {
        method: 'POST',
        timeoutMs: 120_000,
        body: {
          message,
          max_tokens: 4096,
          n_predict: 4096,
          ...(args.conversationId ? { conversationId: args.conversationId } : {}),
          ...(args.model ? { model: args.model } : {}),
        },
      });
      return formatToolResult(response.data, response.status);
    }

    case 'a11_mcp_public_status': {
      return formatToolResult(buildPublicMcpManifest(req));
    }

    default:
      return formatToolResult({ ok: false, error: `unknown_public_mcp_tool:${name}` }, 404);
  }
}

async function handleJsonRpc(req, message) {
  const id = message?.id;
  const method = String(message?.method || '').trim();

  if (!method) return mcpError(id, -32600, 'Invalid Request');

  if (method === 'initialize') {
    return mcpResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'a11-public', version: SERVER_VERSION },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'ping') {
    return mcpResult(id, {});
  }

  if (method === 'tools/list') {
    return mcpResult(id, { tools: SAFE_TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = String(message?.params?.name || '').trim();
    if (!toolName) return mcpError(id, -32602, 'Missing tool name');
    const result = await callTool(req, toolName, message?.params?.arguments || {});
    return mcpResult(id, result);
  }

  return mcpError(id, -32601, `Method not found: ${method}`);
}

function createPublicMcpRouter() {
  const router = express.Router();
  const jsonParser = express.json({ limit: '1mb' });

  router.get('/mcp', (req, res) => res.json(buildPublicMcpManifest(req)));
  router.get('/api/mcp/status', (req, res) => res.json(buildPublicMcpManifest(req)));
  router.get('/.well-known/mcp', (req, res) => res.json(buildPublicMcpManifest(req)));
  router.get('/.well-known/mcp.json', (req, res) => res.json(buildPublicMcpManifest(req)));

  router.post('/mcp', jsonParser, async (req, res) => {
    try {
      const body = req.body;
      if (Array.isArray(body)) {
        const replies = [];
        for (const entry of body) {
          const reply = await handleJsonRpc(req, entry);
          if (reply) replies.push(reply);
        }
        return replies.length ? res.json(replies) : res.status(204).end();
      }

      const reply = await handleJsonRpc(req, body);
      return reply ? res.json(reply) : res.status(204).end();
    } catch (error) {
      return res.status(500).json(mcpError(req.body?.id, -32603, error?.message || 'Internal error'));
    }
  });

  return router;
}

module.exports = createPublicMcpRouter;
module.exports.buildPublicMcpManifest = buildPublicMcpManifest;
module.exports.SAFE_TOOLS = SAFE_TOOLS;

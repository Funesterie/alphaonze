/**
 * MCP Bridge Tunnel — Zen Gate technique
 * Connects A11 MCP server to external MCP servers (ComfyUI Cloud, Civitai)
 * so that Vivy and other Funesterie agents can call their tools directly.
 *
 * Architecture:
 *   [Agent] -> [Funesterie MCP] -> [Bridge Tunnel] -> [ComfyUI Cloud MCP / Civitai MCP]
 *
 * The bridge registers proxy tools prefixed with the upstream name:
 *   comfy__search_templates, comfy__partner_generate, civitai__search_models, etc.
 */
'use strict';

const BRIDGE_VERSION = '1.1.0';

// OAuth relay for token management
let oauthRelay;
try {
  oauthRelay = require('./mcp-bridge-oauth-relay.cjs');
} catch (e) {
  oauthRelay = null;
  console.warn('[mcp-bridge] OAuth relay not available:', e.message);
}

// --- Upstream MCP targets ---
const UPSTREAM_TARGETS = {
  comfy: {
    url: process.env.MCP_BRIDGE_COMFY_URL || 'https://cloud.comfy.org/mcp',
    token: process.env.MCP_BRIDGE_COMFY_TOKEN || process.env.MCP_BRIDGE_COMFY_API_KEY || process.env.COMFY_API_KEY || process.env.A11_COMFY_CLOUD_API_KEY || null,
    tokenHeader: 'x-api-key', // ComfyUI Cloud uses X-API-Key for API keys
    description: 'ComfyUI Cloud - image/video/audio generation',
    enabled: true,
    _prefix: 'comfy',
  },
  civitai: {
    url: process.env.MCP_BRIDGE_CIVITAI_URL || 'https://mcp.civitai.com/mcp',
    token: process.env.MCP_BRIDGE_CIVITAI_TOKEN || process.env.A11_CIVITAI_API_KEY || null,
    description: 'Civitai - model/LoRA search, community',
    enabled: true,
    _prefix: 'civitai',
  },
};

// --- Abort signal helper ---
const DEFAULT_TIMEOUT_MS = 120000;

function createAbortSignal(ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  ac.signal.addEventListener('abort', () => clearTimeout(timer));
  return ac.signal;
}

/**
 * Call a remote MCP server via JSON-RPC over HTTP (streamable transport).
 * Supports both single JSON response and SSE stream.
 */
async function remoteMcpCall(upstream, method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (upstream.token) {
    // Use the right header format per service
    if (upstream.tokenHeader === 'x-api-key') {
      headers['x-api-key'] = upstream.token;
    } else {
      headers.authorization = 'Bearer ' + upstream.token;
    }
  } else if (oauthRelay) {
    // Try OAuth relay for dynamic tokens
    const authHeaders = oauthRelay.getAuthHeaders(upstream._prefix || '');
    Object.assign(headers, authHeaders);
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'bridge-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    method,
    params,
  });

  const response = await fetch(upstream.url, {
    method: 'POST',
    headers,
    body,
    signal: createAbortSignal(timeoutMs),
  });

  const contentType = response.headers.get('content-type') || '';

  // Direct JSON response
  if (contentType.includes('application/json')) {
    const json = await response.json();
    if (json.error) throw new Error('MCP error: ' + JSON.stringify(json.error));
    return json.result;
  }

  // SSE stream - collect last data event
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    const lines = text.split('\n');
    let lastData = null;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        lastData = line.slice(6).trim();
      }
    }
    if (lastData) {
      const parsed = JSON.parse(lastData);
      if (parsed.error) throw new Error('MCP SSE error: ' + JSON.stringify(parsed.error));
      return parsed.result || parsed;
    }
    throw new Error('No data in SSE response');
  }

  // Fallback: try JSON parse
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.error) throw new Error('MCP error: ' + JSON.stringify(parsed.error));
    return parsed.result || parsed;
  } catch (e) {
    throw new Error('Unexpected response (' + response.status + '): ' + raw.slice(0, 500));
  }
}

// --- Tool discovery with cache ---
const toolCache = new Map();
const CACHE_TTL_MS = 300000; // 5 min

async function discoverTools(prefix, upstream) {
  const cached = toolCache.get(prefix);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.tools;
  }

  try {
    const result = await remoteMcpCall(upstream, 'tools/list', {});
    const tools = result && result.tools ? result.tools : [];
    toolCache.set(prefix, { tools, fetchedAt: Date.now() });
    return tools;
  } catch (err) {
    console.error('[mcp-bridge] Failed to discover tools for ' + prefix + ':', err.message);
    return cached ? cached.tools : [];
  }
}

// --- Bridge tool call ---
async function bridgeCallTool(prefix, toolName, args = {}) {
  const upstream = UPSTREAM_TARGETS[prefix];
  if (!upstream || !upstream.enabled) {
    throw new Error('Bridge upstream "' + prefix + '" not found or disabled');
  }
  return remoteMcpCall(upstream, 'tools/call', { name: toolName, arguments: args });
}

// --- Health check ---
async function bridgeHealth() {
  const results = {};
  for (const [prefix, upstream] of Object.entries(UPSTREAM_TARGETS)) {
    if (!upstream.enabled) {
      results[prefix] = { ok: false, reason: 'disabled' };
      continue;
    }
    try {
      // Try an initialize or simple call to check connectivity
      const authHeaders = {};
      if (upstream.token) {
        if (upstream.tokenHeader === 'x-api-key') {
          authHeaders['x-api-key'] = upstream.token;
        } else {
          authHeaders.authorization = 'Bearer ' + upstream.token;
        }
      }
      const r = await fetch(upstream.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...authHeaders,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'health-' + Date.now(),
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'funesterie-bridge', version: BRIDGE_VERSION },
          },
        }),
        signal: createAbortSignal(15000),
      });
      results[prefix] = { ok: r.ok, status: r.status, url: upstream.url };
    } catch (err) {
      results[prefix] = { ok: false, error: err.message, url: upstream.url };
    }
  }
  return { version: BRIDGE_VERSION, upstreams: results };
}

// --- List all bridged tools (for registration in MCP server) ---
async function listBridgedTools() {
  const allTools = [];
  for (const [prefix, upstream] of Object.entries(UPSTREAM_TARGETS)) {
    if (!upstream.enabled) continue;
    const tools = await discoverTools(prefix, upstream);
    for (const tool of tools) {
      allTools.push({
        name: prefix + '__' + tool.name,
        description: '[' + prefix.toUpperCase() + '] ' + (tool.description || tool.name),
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        _upstream: prefix,
        _originalName: tool.name,
      });
    }
  }
  return allTools;
}

// --- Route a bridged tool call ---
async function routeBridgedTool(fullName, args = {}) {
  const sep = fullName.indexOf('__');
  if (sep < 0) throw new Error('Invalid bridged tool name: ' + fullName);
  const prefix = fullName.slice(0, sep);
  const toolName = fullName.slice(sep + 2);
  return bridgeCallTool(prefix, toolName, args);
}

// --- Express middleware ---
function mountBridgeRoutes(app) {
  // Mount OAuth relay routes if available
  if (oauthRelay) {
    oauthRelay.mountOAuthRelayRoutes(app);
  }

  app.get('/api/mcp-bridge/health', async (req, res) => {
    try {
      const health = await bridgeHealth();
      res.json(health);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/mcp-bridge/tools', async (req, res) => {
    try {
      const tools = await listBridgedTools();
      res.json({
        count: tools.length,
        tools: tools.map(t => ({ name: t.name, description: t.description })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/mcp-bridge/call', async (req, res) => {
    try {
      const { tool, args } = req.body || {};
      if (!tool) return res.status(400).json({ error: 'Missing tool name' });
      const result = await routeBridgedTool(tool, args || {});
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log('[mcp-bridge] Zen Gate bridge mounted: /api/mcp-bridge/{health,tools,call}');
}

module.exports = {
  BRIDGE_VERSION,
  UPSTREAM_TARGETS,
  bridgeCallTool,
  bridgeHealth,
  discoverTools,
  listBridgedTools,
  mountBridgeRoutes,
  remoteMcpCall,
  routeBridgedTool,
};

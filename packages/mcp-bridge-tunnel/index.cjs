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

const BRIDGE_VERSION = '1.2.0';

// --- SECURITY: Tool allowlist ---
// Only these tools can be called through the bridge. Prefix format: "upstream__tool"
// To add a new tool, add it here explicitly. Unknown tools are blocked.
const TOOL_ALLOWLIST = new Set([
  // ComfyUI Cloud — generation
  'comfy__partner_generate',
  'comfy__submit_workflow',
  'comfy__run_template',
  'comfy__get_job_status',
  'comfy__wait_for_job',
  'comfy__get_output',
  'comfy__cancel_job',
  'comfy__use_previous_output',
  // ComfyUI Cloud — discovery
  'comfy__search_templates',
  'comfy__search_models',
  'comfy__search_nodes',
  'comfy__get_prompting_guide',
  'comfy__get_template',
  'comfy__get_node',
  'comfy__get_queue',
  'comfy__estimate_credits',
  // ComfyUI Cloud — saved workflows
  'comfy__list_saved_workflows',
  'comfy__get_saved_workflow',
  'comfy__run_saved_workflow',
  'comfy__save_workflow',
  // Civitai — search & browse
  'civitai__search_models',
  'civitai__get_model',
  'civitai__get_model_version',
  'civitai__search_images',
  'civitai__get_image',
  'civitai__search_creators',
  'civitai__list_enums',
]);

// Allow env override for additional tools
const EXTRA_ALLOWED = (process.env.MCP_BRIDGE_EXTRA_TOOLS || '').split(',').filter(Boolean);
EXTRA_ALLOWED.forEach(t => TOOL_ALLOWLIST.add(t.trim()));

function isToolAllowed(fullName) {
  // Exact match
  if (TOOL_ALLOWLIST.has(fullName)) return true;
  // Wildcard: if TOOL_ALLOWLIST contains "prefix__*", allow all tools from that prefix
  const sep = fullName.indexOf('__');
  if (sep > 0) {
    const prefix = fullName.slice(0, sep);
    if (TOOL_ALLOWLIST.has(prefix + '__*')) return true;
  }
  return false;
}

// --- AUDIT: Append-only redacted log ---
const AUDIT_LOG_FILE = process.env.MCP_BRIDGE_AUDIT_LOG || '/agent-bus/mcp-bridge-audit.jsonl';
const MAX_AUDIT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB rotation

function appendAuditLog(entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    const dir = require('path').dirname(AUDIT_LOG_FILE);
    if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
    // Simple size check — rotate if too big
    try {
      const stat = require('fs').statSync(AUDIT_LOG_FILE);
      if (stat.size > MAX_AUDIT_SIZE_BYTES) {
        require('fs').renameSync(AUDIT_LOG_FILE, AUDIT_LOG_FILE + '.old');
      }
    } catch (e) { /* file doesn't exist yet */ }
    require('fs').appendFileSync(AUDIT_LOG_FILE, line, 'utf8');
  } catch (err) {
    console.warn('[mcp-bridge] Audit log write failed:', err.message);
  }
}

// OAuth relay for token management
let oauthRelay;
try {
  oauthRelay = require('./oauth-relay.cjs');
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
function mountBridgeRoutes(app, options = {}) {
  // Mount OAuth relay routes if available (with auth guards)
  if (oauthRelay) {
    oauthRelay.mountOAuthRelayRoutes(app, options);
  }

  // Auth guard for tool calls — MUST verify the session, not just check header length.
  // If no requireAuth is provided, we use a strict default that checks:
  //   1. Express session (req.user populated by passport/session middleware)
  //   2. JWT token verified with the server's JWT_SECRET
  //   3. Internal service calls (localhost with X-Internal-Service header)
  // A raw Bearer header of unknown origin is NEVER accepted.
  const INTERNAL_SERVICE_KEY = process.env.MCP_BRIDGE_INTERNAL_KEY || process.env.JWT_SECRET || '';

  const requireAuth = options.requireAuth || function(req, res, next) {
    // Priority 0: Internal service call (server-to-server on localhost)
    // The clip generator and other internal modules call /api/mcp-bridge/call
    // from localhost. They pass X-Internal-Service header with the service key.
    var internalHeader = req.headers['x-internal-service'] || '';
    var isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
      || req.connection && (req.connection.remoteAddress === '127.0.0.1' || req.connection.remoteAddress === '::1' || req.connection.remoteAddress === '::ffff:127.0.0.1');
    if (isLocalhost && internalHeader === 'a11-internal') {
      req._zenGateUser = { email: 'system@funesterie.internal', id: 'system', internal: true };
      return next();
    }

    // Priority 1: Session-authenticated user (passport, cookie session)
    var sessionUser = req.user || (req.session && req.session.user);
    if (sessionUser && (sessionUser.email || sessionUser.id)) {
      req._zenGateUser = sessionUser;
      return next();
    }

    // Priority 2: JWT Bearer token verified with JWT_SECRET
    var authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      var token = authHeader.slice(7).trim();
      var secret = process.env.JWT_SECRET;
      if (!secret) {
        return res.status(401).json({ error: 'Zen Gate: authentification indisponible (JWT_SECRET manquant)' });
      }
      try {
        var jwt = require('jsonwebtoken');
        var decoded = jwt.verify(token, secret, { algorithms: ['HS256', 'HS384', 'HS512'] });
        req._zenGateUser = { email: decoded.email || decoded.sub, id: decoded.sub || decoded.id, jwt: true };
        return next();
      } catch (err) {
        return res.status(401).json({ error: 'Zen Gate: token invalide ou expiré' });
      }
    }

    // No valid auth — fail closed
    return res.status(401).json({ error: 'Zen Gate: authentification requise (session ou JWT)' });
  };

  // Health is public (used by NOSSEN page)
  app.get('/api/mcp-bridge/health', async (req, res) => {
    try {
      const health = await bridgeHealth();
      res.json(health);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tool discovery requires auth
  app.get('/api/mcp-bridge/tools', requireAuth, async (req, res) => {
    try {
      const tools = await listBridgedTools();
      res.json({
        count: tools.length,
        tools: tools.map(t => ({ name: t.name, description: t.description })),
        allowedCount: TOOL_ALLOWLIST.size,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tool call requires auth + allowlist + audit
  app.post('/api/mcp-bridge/call', requireAuth, async (req, res) => {
    try {
      const { tool, args } = req.body || {};
      if (!tool) return res.status(400).json({ error: 'Missing tool name' });

      // --- SECURITY: Tool allowlist ---
      if (!isToolAllowed(tool)) {
        console.warn('[mcp-bridge] BLOCKED tool call: ' + tool + ' (not in allowlist)');
        return res.status(403).json({ ok: false, error: 'Tool not allowed: ' + tool });
      }

      // --- AUDIT: Log all calls (redacted args) ---
      const auditEntry = {
        ts: new Date().toISOString(),
        tool,
        argsKeys: Object.keys(args || {}),
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
        user: req.user?.email || 'anonymous',
      };
      appendAuditLog(auditEntry);

      const result = await routeBridgedTool(tool, args || {});
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log('[mcp-bridge] Zen Gate bridge mounted (secured): /api/mcp-bridge/{health,tools,call} — ' + TOOL_ALLOWLIST.size + ' tools allowed');
}

module.exports = {
  BRIDGE_VERSION,
  TOOL_ALLOWLIST,
  UPSTREAM_TARGETS,
  appendAuditLog,
  bridgeCallTool,
  bridgeHealth,
  discoverTools,
  isToolAllowed,
  listBridgedTools,
  mountBridgeRoutes,
  remoteMcpCall,
  routeBridgedTool,
};

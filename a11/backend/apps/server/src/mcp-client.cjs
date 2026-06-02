'use strict';

const DEFAULT_MCP_URL = 'http://127.0.0.1:8787/mcp';

const DEFAULT_ALLOWED_TOOLS = new Set([
  'a11_status',
  'kaen44_status',
  'qflush_status',
  'qflush_vivy_audio_status',
  'agent_presence',
  'agent_heartbeat',
  'discussion_list',
  'discussion_open',
  'discussion_post',
  'discussion_read',
  'discussion_set_status',
  'memory_governance_schema',
  'memory_semantic_schema',
  'memory_write_safe',
  'web_draft_write',
  'web_draft_index',
  'shared_context_index',
  'cloud_roots_index',
  'search',
  'search_cloud_roots',
  'read_cloud_doc',
  'read_shared_doc',
  'retro_snes_index',
  'retro_snes_training_brief',
  'retro_snes_session_plan',
  'romstation_state',
  'romstation_mouse',
  'romstation_keyboard',
  'ki_state',
  'ki_play',
  'qflush_gamepad_status',
  'qflush_gamepad_play',
  'qflush_gamepad_pilot',
  'qflush_keyboard_play',
  'qflush_keyboard_pilot',
  'qflush_mouse_click',
  'neo4j_status',
  'neo4j_read_query',
  'agent_jobs',
  'job_queue_schema',
  'job_enqueue',
  'a11_runtime_hooks_status',
  'read_backend_logs',
  'read_qflush_logs',
  'generated_bucket_status',
  'generated_bucket_public_url',
  'generated_bucket_list',
  'generated_bucket_head',
  'generated_bucket_read_text',
  'generated_bucket_put_text',
  'generated_bucket_put_base64',
  'search_project',
  'explain_env',
]);

function envBool(name, fallback = false, env = process.env) {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function envInt(name, fallback, min, max, env = process.env) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function splitCsv(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getMcpConfig(env = process.env) {
  const url = String(
    env.A11_MCP_URL
    || env.FUNESTERIE_MCP_URL
    || env.MCP_URL
    || DEFAULT_MCP_URL
  ).trim().replace(/\/$/, '');

  const token = String(env.A11_MCP_TOKEN || env.MCP_AUTH_TOKEN || '').trim();
  const allowAllTools = envBool('A11_MCP_ALLOW_ALL_TOOLS', false, env);
  const configuredAllowlist = splitCsv(env.A11_MCP_TOOL_ALLOWLIST);
  const allowedTools = configuredAllowlist.length
    ? new Set(configuredAllowlist)
    : new Set(DEFAULT_ALLOWED_TOOLS);

  return {
    url,
    token,
    tokenPresent: Boolean(token),
    timeoutMs: envInt('A11_MCP_TIMEOUT_MS', 15000, 1000, 120000, env),
    allowAllTools,
    allowedTools,
  };
}

function getHealthUrl(mcpUrl) {
  try {
    const url = new URL(mcpUrl);
    url.pathname = url.pathname.replace(/\/mcp\/?$/, '/health') || '/health';
    url.search = '';
    return url.toString();
  } catch {
    return DEFAULT_MCP_URL.replace(/\/mcp$/, '/health');
  }
}

function createAbortSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseSseJson(text) {
  const events = [];
  let current = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (current.length) {
        events.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    if (line.startsWith('data:')) {
      current.push(line.slice(5).trimStart());
    }
  }

  if (current.length) events.push(current.join('\n'));

  for (let index = events.length - 1; index >= 0; index--) {
    const parsed = parseJsonMaybe(events[index]);
    if (parsed) return parsed;
  }

  return null;
}

function parseMcpResponse(text, contentType = '') {
  const raw = String(text || '');
  if (contentType.includes('application/json')) {
    const parsed = parseJsonMaybe(raw);
    if (parsed) return parsed;
  }

  const direct = parseJsonMaybe(raw);
  if (direct) return direct;

  const sse = parseSseJson(raw);
  if (sse) return sse;

  throw new Error(`Unable to parse MCP response: ${raw.slice(0, 300)}`);
}

function publicMcpConfig(config = getMcpConfig()) {
  return {
    url: config.url,
    healthUrl: getHealthUrl(config.url),
    tokenPresent: config.tokenPresent,
    timeoutMs: config.timeoutMs,
    allowAllTools: config.allowAllTools,
    allowedTools: config.allowAllTools ? ['*'] : [...config.allowedTools].sort(),
  };
}

function assertToolAllowed(toolName, config = getMcpConfig()) {
  const name = String(toolName || '').trim();
  if (!name) {
    const error = new Error('Missing MCP tool name.');
    error.status = 400;
    error.error = 'missing_tool_name';
    throw error;
  }
  if (config.allowAllTools || config.allowedTools.has(name)) return name;
  const error = new Error(`MCP tool "${name}" is not allowed by A11_MCP_TOOL_ALLOWLIST.`);
  error.status = 403;
  error.error = 'mcp_tool_not_allowed';
  throw error;
}

async function mcpJsonRpc(method, params = {}, options = {}) {
  const config = options.config || getMcpConfig();
  const id = options.id || `a11-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };

  if (config.token) {
    headers.authorization = `Bearer ${config.token}`;
    headers['x-mcp-token'] = config.token;
  }

  const response = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
    signal: createAbortSignal(config.timeoutMs),
  });

  const raw = await response.text();
  const parsed = parseMcpResponse(raw, response.headers.get('content-type') || '');

  if (!response.ok || parsed?.error) {
    const message = parsed?.error?.message || `MCP HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.ok ? 502 : response.status;
    error.error = parsed?.error?.code || 'mcp_rpc_failed';
    error.upstream = {
      url: config.url,
      status: response.status,
      body: raw.slice(0, 2000),
    };
    throw error;
  }

  return {
    ok: true,
    id,
    response: parsed,
    result: parsed?.result,
  };
}

async function listMcpTools(options = {}) {
  return mcpJsonRpc('tools/list', {}, options);
}

async function callMcpTool(name, args = {}, options = {}) {
  const config = options.config || getMcpConfig();
  const toolName = assertToolAllowed(name, config);
  return mcpJsonRpc('tools/call', {
    name: toolName,
    arguments: args && typeof args === 'object' ? args : {},
  }, { ...options, config });
}

async function checkMcpHealth(options = {}) {
  const config = options.config || getMcpConfig();
  const healthUrl = getHealthUrl(config.url);
  const headers = { accept: 'application/json' };
  if (config.token) {
    headers.authorization = `Bearer ${config.token}`;
    headers['x-mcp-token'] = config.token;
  }

  const response = await fetch(healthUrl, {
    method: 'GET',
    headers,
    signal: createAbortSignal(config.timeoutMs),
  });
  const raw = await response.text();
  const body = parseJsonMaybe(raw) || { raw: raw.slice(0, 1000) };

  return {
    ok: response.ok,
    status: response.status,
    url: healthUrl,
    body,
  };
}

module.exports = {
  DEFAULT_ALLOWED_TOOLS,
  assertToolAllowed,
  callMcpTool,
  checkMcpHealth,
  getMcpConfig,
  listMcpTools,
  mcpJsonRpc,
  parseMcpResponse,
  parseSseJson,
  publicMcpConfig,
};

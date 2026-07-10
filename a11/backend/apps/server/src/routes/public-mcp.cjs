'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  mcpJsonRpc,
  publicMcpConfig,
} = require('../mcp-client.cjs');
const { verifyOAuthAccessToken } = require('../mcp-oauth/oauth-server.cjs');
const {
  verifyEntraAccessToken,
  isEntraMcpConfigured,
  getEntraMcpConfig,
} = require('../mcp-oauth/entra-auth.cjs');
const {
  buildSemanticMediaRoulette,
} = require('../../lib/semantic-media-roulette.cjs');
const {
  buildAndStoreSocialPromptContext,
  buildSocialAutopromptRedactedStatus,
} = require('../social/social-autoprompt.cjs');

const DEFAULT_PUBLIC_MCP_UPSTREAM_URL = 'https://mcp.funesterie.me/mcp';
const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_RUNTIME_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', 'runtime');
const RUNTIME_HOOKS_PATH = path.resolve(
  process.env.A11_RUNTIME_HOOKS_PATH
  || path.join(process.env.A11_RUNTIME_ROOT || DEFAULT_RUNTIME_ROOT, 'knowledge-graph', 'a11-runtime-hooks.json')
);
const RUNTIME_MODULE_INDEX_PATH = path.resolve(
  process.env.A11_RUNTIME_MODULE_INDEX_PATH
  || path.join(path.dirname(RUNTIME_HOOKS_PATH), 'a11-runtime-module-index.json')
);

const LOCAL_TOOLS = [
  {
    name: 'a11_health',
    description: 'Verifie que le backend A11/K44 est en ligne.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_llm_stats',
    description: 'Retourne les statistiques publiques Cerbere/LLM sans secret.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_chat',
    description: 'Envoie un message au chat A11/K44 via les garde-fous HTTP existants.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        conversationId: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['message'],
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_mcp_public_status',
    description: 'Retourne le manifeste public MCP expose par ce domaine.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_mcp_relay_status',
    description: 'Verifie la liaison entre ce domaine A11 et le MCP Funesterie amont.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_runtime_hooks_status',
    description: 'Retourne le statut du hook Neo4j semantique A11 sans exposer de secret.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_media_roulette',
    description: 'Selectionne des medias A11 par pertinence creative depuis le contexte utilisateur et les medias disponibles.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        creativeBrief: { type: 'string' },
        mood: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
        userContext: { type: 'object' },
        seed: { type: 'string' },
        limit: { type: 'number' },
        randomize: { type: 'boolean' },
        includeUserMemory: { type: 'boolean' },
      },
      required: [],
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_social_prompt_context',
    description: 'Retourne un résumé créatif redacted issu des comptes sociaux connectés pour enrichir une chanson, un clip, un post, une description ou des hashtags.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        kind: { type: 'string', enum: ['chanson', 'clip', 'post', 'description', 'hashtag'] },
        limit: { type: 'number' },
      },
      required: ['topic'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: 'a11_social_autoprompt_status',
    description: 'Retourne le diagnostic redacted Social Autoprompt: YouTube, Meta/Facebook/Instagram, ingest et contexte créatif disponible, sans secret ni donnée brute.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
];

const PUBLIC_SAFE_RELAY_ALLOWLIST = new Set([
  'a11_status',
  'kaen44_status',
  'qflush_status',
  'agent_presence',
  'agent_jobs',
  'discussion_list',
  'discussion_read',
  'memory_governance_schema',
  'memory_semantic_schema',
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
  'ki_state',
  'qflush_gamepad_status',
  'neo4j_status',
  'neo4j_read_query',
  'search_project',
  'explain_env',
]);

const DEFAULT_RELAY_ALLOWLIST = new Set(PUBLIC_SAFE_RELAY_ALLOWLIST);

function splitCsv(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envBool(name, fallback = false, env = process.env) {
  const raw = String(env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function resolveSocialContextUserId(env = process.env) {
  return String(
    env.A11_SOCIAL_CONTEXT_USER_ID
    || env.SOCIAL_CONTEXT_USER_ID
    || env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID
    || ''
  ).trim();
}

function envInt(name, fallback, min, max, env = process.env) {
  const value = Number(env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getStaticMcpTokens(env = process.env) {
  return [
    env.A11_PUBLIC_MCP_TOKEN,
    env.A11_MCP_TOKEN,
    env.MCP_AUTH_TOKEN,
  ]
    .map((token) => String(token || '').trim())
    .filter(Boolean);
}

function extractBearerToken(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(authorization)) {
    return authorization.replace(/^bearer\s+/i, '').trim();
  }
  return String(req.headers['x-mcp-token'] || '').trim();
}

function timingSafeTokenMatch(token, expected) {
  const left = Buffer.from(String(token || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && require('node:crypto').timingSafeEqual(left, right);
}

function authenticatePublicMcpRequest(req, env = process.env) {
  const token = extractBearerToken(req);
  const requireAuth = envBool('A11_PUBLIC_MCP_AUTH_REQUIRED', false, env);
  if (!token) {
    return requireAuth
      ? { ok: false, status: 401, error: 'missing_mcp_token' }
      : { ok: true, mode: 'anonymous' };
  }

  if (getStaticMcpTokens(env).some((expected) => timingSafeTokenMatch(token, expected))) {
    return { ok: true, mode: 'static' };
  }

  const oauthPayload = verifyOAuthAccessToken(token, env);
  if (oauthPayload) {
    return { ok: true, mode: 'oauth', payload: oauthPayload };
  }

  return { ok: false, status: 401, error: 'invalid_mcp_token' };
}

/**
 * Async superset of {@link authenticatePublicMcpRequest} that also accepts a valid
 * Microsoft Entra access token (server-to-server callers). Entra is only tried when
 * the sync chain (anonymous / static token / OAuth) did not already succeed, a bearer
 * token is present, and the Entra pack is configured — so it never changes existing
 * behaviour until MCP_ISSUER/MCP_AUDIENCE are set.
 */
async function authenticatePublicMcpRequestAsync(req, env = process.env) {
  const sync = authenticatePublicMcpRequest(req, env);
  if (sync.ok) return sync;

  // Local-dev escape hatch, explicit and non-production only.
  if (getEntraMcpConfig(env).devBypass) return { ok: true, mode: 'dev-bypass' };

  const token = extractBearerToken(req);
  if (token && isEntraMcpConfigured(env)) {
    try {
      const payload = await verifyEntraAccessToken(token, env);
      if (payload) return { ok: true, mode: 'entra', payload };
    } catch {
      // fall through to the sync failure below (fail closed)
    }
  }
  return sync;
}

async function requirePublicMcpAuth(req, res, next) {
  let auth;
  try {
    auth = await authenticatePublicMcpRequestAsync(req);
  } catch {
    auth = { ok: false, status: 401, error: 'auth_error' };
  }
  if (!auth.ok) {
    return res.status(auth.status || 401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: {
        code: -32001,
        message: auth.error || 'unauthorized',
      },
    });
  }
  req.publicMcpAuth = auth;
  return next();
}

function normalizeBaseUrl(value, fallback = '') {
  return String(value || fallback || '').trim().replace(/\/+$/, '');
}

function getPublicBaseUrl(req) {
  const configured = normalizeBaseUrl(
    process.env.A11_PUBLIC_MCP_BASE_URL
    || process.env.PUBLIC_API_URL
    || process.env.A11_SERVER_URL
    || process.env.APP_URL
    || process.env.FRONT_URL
    || ''
  );
  if (configured) return configured;

  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : 'https://a11.funesterie.me';
}

function getInternalBaseUrl() {
  return normalizeBaseUrl(
    process.env.A11_INTERNAL_API_BASE_URL
    || `http://127.0.0.1:${String(process.env.PORT || 3000).trim() || '3000'}`
  );
}

function getLocalWorkspaceRoot() {
  return path.resolve(
    String(
      process.env.A11_WORKSPACE_ROOT
      || process.env.WORKSPACE_ROOT
      || path.resolve(SERVER_ROOT, '..', '..', '..')
    ).trim()
  );
}

function getLocalRuntimeRoot() {
  return path.resolve(
    String(
      process.env.A11_RUNTIME_ROOT
      || path.join(getLocalWorkspaceRoot(), 'runtime')
    ).trim()
  );
}

function getRelayConfig(env = process.env) {
  const relayUrl = normalizeBaseUrl(
    env.A11_PUBLIC_MCP_UPSTREAM_URL
    || env.A11_MCP_UPSTREAM_URL
    || env.A11_MCP_RELAY_URL
    || env.FUNESTERIE_MCP_URL
    || DEFAULT_PUBLIC_MCP_UPSTREAM_URL
  );
  const token = String(env.A11_PUBLIC_MCP_TOKEN || env.A11_MCP_TOKEN || env.MCP_AUTH_TOKEN || '').trim();
  const configuredAllowlist = splitCsv(env.A11_PUBLIC_MCP_RELAY_ALLOWLIST);
  const requestedAllowAll = envBool('A11_PUBLIC_MCP_RELAY_ALLOW_ALL', false, env);
  const safeConfiguredAllowlist = configuredAllowlist.filter((toolName) => PUBLIC_SAFE_RELAY_ALLOWLIST.has(toolName));
  return {
    url: relayUrl,
    token,
    tokenPresent: Boolean(token),
    timeoutMs: envInt('A11_PUBLIC_MCP_TIMEOUT_MS', 15000, 1000, 120000, env),
    allowAllRequested: requestedAllowAll,
    allowAllTools: false,
    allowedTools: configuredAllowlist.length ? new Set(safeConfiguredAllowlist) : new Set(DEFAULT_RELAY_ALLOWLIST),
  };
}

function isSelfRelay(relayUrl, publicBaseUrl) {
  try {
    const relay = new URL(relayUrl);
    const base = new URL(publicBaseUrl);
    return relay.host === base.host && relay.pathname.replace(/\/+$/, '') === '/mcp';
  } catch {
    return false;
  }
}

function buildMcpHealthUrl(mcpUrl) {
  try {
    const url = new URL(mcpUrl);
    const pathname = (url.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathname === '/kiro/mcp') {
      url.pathname = '/health';
    } else if (pathname.endsWith('/mcp')) {
      const basePath = pathname.slice(0, -'/mcp'.length).replace(/\/+$/, '');
      url.pathname = basePath ? `${basePath}/health` : '/health';
    } else {
      url.pathname = '/health';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return DEFAULT_PUBLIC_MCP_UPSTREAM_URL.replace(/\/mcp\/?$/, '/health');
  }
}

function filterRelayTools(tools, relayConfig) {
  if (!Array.isArray(tools)) return [];
  const filtered = relayConfig.allowAllTools
    ? tools
    : tools.filter((tool) => relayConfig.allowedTools.has(tool?.name));
  return filtered.map(annotatePublicMcpTool);
}

function inferPublicMcpAnnotations(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  const readOnlyPrefixes = [
    'a11_health',
    'a11_llm_stats',
    'a11_mcp_public_status',
    'a11_mcp_relay_status',
    'a11_runtime_hooks_status',
    'a11_media_roulette',
    'a11_social_prompt_context',
    'a11_social_autoprompt_status',
    'a11_status',
    'kaen44_status',
    'qflush_status',
    'agent_presence',
    'agent_jobs',
    'discussion_list',
    'discussion_read',
    'memory_governance_schema',
    'memory_semantic_schema',
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
    'ki_state',
    'qflush_gamepad_status',
    'neo4j_status',
    'neo4j_read_query',
    'search_project',
    'explain_env',
  ];
  const destructivePatterns = [
    /delete/,
    /remove/,
    /purge/,
    /reset/,
    /revoke/,
    /overwrite/,
  ];
  const mutatingPatterns = [
    /write/,
    /post/,
    /set_status/,
    /heartbeat/,
    /play/,
    /pilot/,
    /mouse/,
    /keyboard/,
    /click/,
    /generate/,
    /chat/,
  ];
  const readOnly = readOnlyPrefixes.includes(normalized)
    || readOnlyPrefixes.some((prefix) => normalized.startsWith(`${prefix}_`));
  const destructive = destructivePatterns.some((pattern) => pattern.test(normalized));
  return {
    readOnlyHint: readOnly && !mutatingPatterns.some((pattern) => pattern.test(normalized)),
    openWorldHint: false,
    destructiveHint: destructive,
  };
}

function annotatePublicMcpTool(tool = {}) {
  const inferred = inferPublicMcpAnnotations(tool?.name);
  return {
    ...tool,
    annotations: {
      readOnlyHint: Boolean(tool?.annotations?.readOnlyHint ?? inferred.readOnlyHint),
      openWorldHint: Boolean(tool?.annotations?.openWorldHint ?? inferred.openWorldHint),
      destructiveHint: Boolean(tool?.annotations?.destructiveHint ?? inferred.destructiveHint),
    },
  };
}

function buildManifest(req) {
  const baseUrl = getPublicBaseUrl(req);
  const relayConfig = getRelayConfig();
  return {
    ok: true,
    kind: 'a11_public_mcp',
    protocol: 'json-rpc-2.0-http',
    protocolVersion: '2024-11-05',
    serverInfo: { name: 'a11-public', version: '1.1.0' },
    endpoints: [
      {
        baseUrl,
        mcp: `${baseUrl}/mcp`,
        wellKnown: `${baseUrl}/.well-known/mcp`,
        status: `${baseUrl}/api/mcp/status`,
      },
    ],
    tools: LOCAL_TOOLS.map((tool) => tool.name),
    chatgptApps: {
      ready: true,
      submissionReady: false,
      currentShape: 'backend-web-plus-mcp-relay',
      futureWidgetResource: 'ui://a11/dashboard',
      note: 'Future ChatGPT App = MCP server + widget UI; current A11/K44 remains the local backend/web app plus MCP relay.',
    },
    relay: {
      enabled: !isSelfRelay(relayConfig.url, baseUrl),
      upstream: publicMcpConfig(relayConfig),
      defaultAllowlist: relayConfig.allowAllTools ? ['*'] : [...relayConfig.allowedTools].sort(),
      excludedByDefault: ['neo4j_write_query', 'read_backend_logs', 'read_qflush_logs'],
    },
    auth: {
      mode: 'normal_a11_http_guards_plus_mcp_relay_allowlist',
      oauth: {
        enabled: Boolean(process.env.OAUTH_JWT_SECRET || process.env.OAUTH_CLIENT_SECRET),
        issuer: process.env.OAUTH_ISSUER || 'https://mcp.funesterie.me',
        tokenEndpoint: `${baseUrl}/oauth/token`,
        authorizationEndpoint: `${baseUrl}/oauth/authorize`,
      },
      staticTokenConfigured: getStaticMcpTokens().length > 0,
      requiredForJsonRpc: envBool('A11_PUBLIC_MCP_AUTH_REQUIRED', false),
      secretsExposed: false,
    },
    serviceDomains: {
      a11: `${baseUrl}/mcp`,
      funesterieMcp: relayConfig.url,
    },
  };
}

async function fetchRelayTools(req) {
  const relayConfig = getRelayConfig();
  const baseUrl = getPublicBaseUrl(req);
  if (isSelfRelay(relayConfig.url, baseUrl)) {
    return { ok: false, skipped: true, reason: 'relay_points_to_self', tools: [] };
  }
  try {
    const result = await mcpJsonRpc('tools/list', {}, { config: relayConfig });
    const tools = filterRelayTools(result?.result?.tools || [], relayConfig);
    return { ok: true, tools, upstream: publicMcpConfig(relayConfig) };
  } catch (error_) {
    return {
      ok: false,
      tools: [],
      upstream: publicMcpConfig(relayConfig),
      error: String(error_?.message || error_),
    };
  }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  };
}

async function fetchInternalJson(pathname, options = {}) {
  const url = `${getInternalBaseUrl()}${pathname}`;
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout?.(Number(options.timeoutMs || 30000)),
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function pickForwardedAuthHeaders(req) {
  const headers = {};
  const authorization = String(req.headers.authorization || '').trim();
  const nezToken = String(req.headers['x-nez-token'] || '').trim();
  if (authorization) headers.authorization = authorization;
  if (nezToken) headers['x-nez-token'] = nezToken;
  return headers;
}

async function callLocalTool(req, toolName, args = {}) {
  if (toolName === 'a11_health') {
    return {
      content: [{ type: 'text', text: JSON.stringify(await fetchInternalJson('/health'), null, 2) }],
    };
  }

  if (toolName === 'a11_llm_stats') {
    return {
      content: [{ type: 'text', text: JSON.stringify(await fetchInternalJson('/api/llm/stats'), null, 2) }],
    };
  }

  if (toolName === 'a11_chat') {
    const message = String(args.message || '').trim();
    if (!message) throw new Error('a11_chat: missing message');
    const data = await fetchInternalJson('/api/chat', {
      method: 'POST',
      headers: pickForwardedAuthHeaders(req),
      timeoutMs: 120000,
      body: {
        message,
        conversationId: args.conversationId,
        model: args.model,
      },
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  if (toolName === 'a11_mcp_public_status') {
    return {
      content: [{ type: 'text', text: JSON.stringify(buildManifest(req), null, 2) }],
    };
  }

  if (toolName === 'a11_mcp_relay_status') {
    const relayConfig = getRelayConfig();
    const healthUrl = buildMcpHealthUrl(relayConfig.url);
    let health = null;
    try {
      const response = await fetch(healthUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout?.(relayConfig.timeoutMs),
      });
      const raw = await response.text();
      health = { ok: response.ok, status: response.status, body: raw ? JSON.parse(raw) : {} };
    } catch (error_) {
      health = { ok: false, error: String(error_?.message || error_) };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: health.ok === true,
          upstream: publicMcpConfig(relayConfig),
          health,
        }, null, 2),
      }],
      isError: health.ok !== true,
    };
  }

  if (toolName === 'a11_runtime_hooks_status') {
    const manifest = readJsonSafe(RUNTIME_HOOKS_PATH);
    const moduleIndex = readJsonSafe(RUNTIME_MODULE_INDEX_PATH);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: Boolean(manifest),
          runtimeHooksPath: RUNTIME_HOOKS_PATH,
          runtimeModuleIndexPath: RUNTIME_MODULE_INDEX_PATH,
          summary: manifest ? {
            generatedAt: manifest.generatedAt || null,
            modules: Array.isArray(manifest.modules) ? manifest.modules.length : 0,
            links: Array.isArray(manifest.links) ? manifest.links.length : 0,
            installedModules: Array.isArray(moduleIndex?.modules)
              ? moduleIndex.modules.filter((entry) => entry?.installed).length
              : 0,
            minimumModulesOk: moduleIndex?.minimumOk === true,
            minimumModules: Array.isArray(moduleIndex?.minimumRequired)
              ? moduleIndex.minimumRequired.slice()
              : ['rome', 'corpus'],
          } : null,
        }, null, 2),
      }],
      isError: !manifest,
    };
  }

  if (toolName === 'a11_media_roulette') {
    const auth = req.publicMcpAuth || {};
    const safeArgs = args && typeof args === 'object' ? args : {};
    const userId = String(safeArgs.userId || auth.payload?.sub || auth.mode || 'mcp').trim();
    const result = buildSemanticMediaRoulette({
      ...safeArgs,
      userId,
      user: {
        id: userId,
        authMode: auth.mode || null,
        scope: auth.payload?.scope || null,
        clientId: auth.payload?.client_id || null,
      },
      workspaceRoot: getLocalWorkspaceRoot(),
      runtimeRoot: getLocalRuntimeRoot(),
      includeLocalPaths: false,
      includeProfileSnippets: safeArgs.includeProfileSnippets === true,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  if (toolName === 'a11_social_prompt_context') {
    const auth = req.publicMcpAuth || {};
    const allowAnonymous = envBool('A11_SOCIAL_MCP_ALLOW_ANONYMOUS', false);
    if ((auth.mode || 'anonymous') === 'anonymous' && !allowAnonymous) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            authRequired: true,
            error: 'social_context_requires_mcp_auth',
          }, null, 2),
        }],
        isError: true,
      };
    }
    const db = req.publicMcpContext?.db;
    if (!db || typeof db.query !== 'function') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: false, error: 'social_context_db_missing' }, null, 2),
        }],
        isError: true,
      };
    }
    const safeArgs = args && typeof args === 'object' ? args : {};
    const context = await buildAndStoreSocialPromptContext(db, {
      userId: resolveSocialContextUserId(process.env),
      topic: String(safeArgs.topic || '').trim().slice(0, 240),
      kind: String(safeArgs.kind || 'chanson').trim().slice(0, 40),
      limit: Math.max(1, Math.min(12, Number(safeArgs.limit || 6) || 6)),
    });
    const redacted = {
      topic: context.topic || String(safeArgs.topic || '').trim().slice(0, 240),
      dominantTone: context.dominantTone || '',
      strongPhrases: Array.isArray(context.strongPhrases) ? context.strongPhrases.slice(0, 8) : [],
      creativeAngles: Array.isArray(context.creativeAngles) ? context.creativeAngles.slice(0, 8) : [],
      clipIdeas: Array.isArray(context.clipIdeas) ? context.clipIdeas.slice(0, 8) : [],
      songPromptSeeds: Array.isArray(context.songPromptSeeds) ? context.songPromptSeeds.slice(0, 8) : [],
      hashtags: Array.isArray(context.hashtags) ? context.hashtags.slice(0, 12) : [],
      avoid: Array.isArray(context.avoid) ? context.avoid.slice(0, 8) : [],
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(redacted, null, 2) }],
    };
  }

  if (toolName === 'a11_social_autoprompt_status') {
    const db = req.publicMcpContext?.db;
    const status = await buildSocialAutopromptRedactedStatus(db, {
      userId: resolveSocialContextUserId(process.env),
      env: process.env,
      req,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      isError: status.ok === false,
    };
  }

  return null;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function relayToolCall(req, toolName, args = {}) {
  const relayConfig = getRelayConfig();
  const baseUrl = getPublicBaseUrl(req);
  if (isSelfRelay(relayConfig.url, baseUrl)) {
    throw new Error('MCP relay points to this /mcp endpoint; refusing recursive call.');
  }
  if (!relayConfig.allowAllTools && !relayConfig.allowedTools.has(toolName)) {
    const error = new Error(`MCP relay tool "${toolName}" is not allowed by A11_PUBLIC_MCP_RELAY_ALLOWLIST.`);
    error.code = -32602;
    throw error;
  }
  const result = await mcpJsonRpc('tools/call', {
    name: toolName,
    arguments: args && typeof args === 'object' ? args : {},
  }, { config: relayConfig });
  return result.result;
}

async function handleJsonRpc(req, res) {
  const msg = req.body && typeof req.body === 'object' ? req.body : {};
  const id = msg.id ?? null;
  const method = String(msg.method || '').trim();

  try {
    if (method === 'initialize') {
      return res.json(jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'a11-public', version: '1.1.0' },
      }));
    }

    if (method === 'ping') {
      return res.json(jsonRpcResult(id, {}));
    }

    if (method === 'tools/list') {
      const relay = await fetchRelayTools(req);
      return res.json(jsonRpcResult(id, {
        tools: [...LOCAL_TOOLS, ...relay.tools],
        relay: {
          ok: relay.ok,
          skipped: relay.skipped || false,
          reason: relay.reason || undefined,
          upstream: relay.upstream,
          error: relay.error || undefined,
          count: relay.tools.length,
        },
      }));
    }

    if (method === 'tools/call') {
      const toolName = String(msg.params?.name || '').trim();
      const args = msg.params?.arguments || {};
      if (!toolName) {
        return res.json(jsonRpcError(id, -32602, 'Missing tool name'));
      }

      const localResult = await callLocalTool(req, toolName, args);
      if (localResult) {
        return res.json(jsonRpcResult(id, localResult));
      }

      const relayResult = await relayToolCall(req, toolName, args);
      return res.json(jsonRpcResult(id, relayResult));
    }

    if (method === 'notifications/initialized') {
      return res.status(202).end();
    }

    return res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
  } catch (error_) {
    return res.json(jsonRpcError(
      id,
      Number(error_?.code || -32603),
      String(error_?.message || error_),
      error_?.data
    ));
  }
}

function createPublicMcpRouter(options = {}) {
  const router = express.Router();

  router.use((req, _res, next) => {
    req.publicMcpContext = options;
    next();
  });

  router.get('/.well-known/mcp', (req, res) => {
    res.json(buildManifest(req));
  });

  router.get('/api/mcp/status', (req, res) => {
    res.json(buildManifest(req));
  });

  router.get('/mcp', (req, res) => {
    res.json(buildManifest(req));
  });

  router.post('/mcp', express.json({ limit: '2mb' }), requirePublicMcpAuth, handleJsonRpc);

  return router;
}

module.exports = createPublicMcpRouter;
module.exports.authenticatePublicMcpRequest = authenticatePublicMcpRequest;
module.exports.authenticatePublicMcpRequestAsync = authenticatePublicMcpRequestAsync;

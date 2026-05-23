'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  callMcpTool,
  getMcpConfig,
} = require('../mcp-client.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_COCKPIT_HTML_PATHS = [
  path.join(SERVER_ROOT, 'public', 'cockpit', 'mcp.html'),
  path.resolve(SERVER_ROOT, '..', '..', '..', '..', 'scripts', 'cockpit', 'mcp.html'),
];
const DEFAULT_PRIVATE_MCP_URL = 'https://mcp.funesterie.me/mcp';
const PUBLIC_MCP_ENDPOINTS = {
  chatgpt: 'https://mcp.funesterie.me/chatgpt/mcp',
  claude: 'https://mcp.funesterie.me/claude/mcp',
  gemini: 'https://mcp.funesterie.me/gemini/mcp',
  grok: 'https://mcp.funesterie.me/grok/mcp',
};
const ALLOWED_PROXY_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
]);
const DEFAULT_COCKPIT_ADMIN_EMAILS = [
  'cellaurojeffrey@gmail.com',
  'funesterie38@gmail.com',
];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function splitList(value) {
  return String(value || '')
    .split(/[,\s;]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

function getCockpitAdminEmails(env = process.env) {
  return new Set([
    ...DEFAULT_COCKPIT_ADMIN_EMAILS,
    ...splitList(env.FUNESTERIE_COCKPIT_ADMINS),
    ...splitList(env.CP_FUNESTERIE_ADMINS),
    ...splitList(env.A11_MCP_COCKPIT_ADMINS),
  ]);
}

function isAllowedCockpitAdmin(user = {}, env = process.env) {
  const email = normalizeEmail(user.email);
  if (email && getCockpitAdminEmails(env).has(email)) return true;

  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return !isProduction && user.localBypass === true;
}

function publicUser(user = {}) {
  return {
    id: user.id || '',
    username: user.username || '',
    email: normalizeEmail(user.email),
    provider: user.provider || '',
  };
}

function jsonError(res, status, error, message) {
  return res.status(status).json({
    ok: false,
    error,
    message,
  });
}

function redactText(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(npm_[A-Za-z0-9_=-]{16,})\b/g, 'npm_[REDACTED]')
    .replace(/\b(ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_=-]{16,}\b/g, '$1_[REDACTED]')
    .replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]{12,}\b/g, '$1_$2_[REDACTED]')
    .replace(/\b(whsec)_[A-Za-z0-9]{12,}\b/g, '$1_[REDACTED]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '$1 [REDACTED]');
}

function redactDeep(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|password|private[_-]?key|authorization|bearer/i.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = redactDeep(nested);
    }
  }
  return output;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSse(text) {
  const events = [];
  let eventName = 'message';
  let dataLines = [];

  function flush() {
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    events.push({
      event: eventName,
      data: redactText(data),
      parsed: redactDeep(tryParseJson(data)),
    });
    eventName = 'message';
    dataLines = [];
  }

  for (const line of String(text || '').split(/\r?\n/)) {
    if (line === '') {
      flush();
    } else if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message';
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
  return events;
}

function normalizeMcpRequest(payload) {
  const request = payload?.request && typeof payload.request === 'object'
    ? payload.request
    : payload;
  const method = String(request?.method || '').trim();
  if (!ALLOWED_PROXY_METHODS.has(method)) {
    const error = new Error('method_not_allowed');
    error.statusCode = 400;
    throw error;
  }
  return {
    jsonrpc: '2.0',
    id: request?.id ?? `cockpit-${Date.now()}`,
    method,
    params: request?.params && typeof request.params === 'object' ? request.params : {},
  };
}

function normalizeMcpUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '') || DEFAULT_PRIVATE_MCP_URL;
}

function getCockpitMcpConfig(env = process.env) {
  const base = getMcpConfig(env);
  const configuredUrl = env.A11_MCP_COCKPIT_URL
    || env.A11_MCP_URL
    || env.FUNESTERIE_MCP_URL
    || env.MCP_URL
    || DEFAULT_PRIVATE_MCP_URL;
  return {
    ...base,
    url: normalizeMcpUrl(configuredUrl),
  };
}

function resolveProxyEndpoint(endpointName, env = process.env) {
  const key = String(endpointName || 'chatgpt').trim().toLowerCase();
  if (key === 'private') {
    const config = getCockpitMcpConfig(env);
    return {
      key,
      url: config.url,
      token: config.token,
      timeoutMs: config.timeoutMs,
      tokenPresent: config.tokenPresent,
    };
  }
  const safeKey = PUBLIC_MCP_ENDPOINTS[key] ? key : 'chatgpt';
  const config = getCockpitMcpConfig(env);
  return {
    key: safeKey,
    url: PUBLIC_MCP_ENDPOINTS[safeKey],
    token: '',
    timeoutMs: config.timeoutMs,
    tokenPresent: false,
  };
}

function createAbortSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function safeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function resolveCockpitHtmlPath(configuredPath) {
  const candidates = configuredPath
    ? [configuredPath, ...DEFAULT_COCKPIT_HTML_PATHS]
    : DEFAULT_COCKPIT_HTML_PATHS;
  return candidates.find((candidate) => {
    try {
      return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function renderHostedCockpitHtml(html, { cockpitConfig, user }) {
  const bootstrap = [
    '<script>',
    `window.__FUNESTERIE_MCP_COCKPIT__=${safeInlineJson(cockpitConfig)};`,
    `window.__FUNESTERIE_COCKPIT_USER__=${safeInlineJson(user)};`,
    '</script>',
  ].join('');

  if (html.includes('</head>')) {
    return html.replace('</head>', `${bootstrap}\n</head>`);
  }
  return `${bootstrap}\n${html}`;
}

function parseToolText(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function unwrapMcpToolPayload(payload) {
  const result = payload?.result ?? payload;
  if (!result) return null;
  const parsedText = parseToolText(result?.content?.[0]?.text);
  return parsedText || result;
}

async function safeToolCall(callTool, name, args, config) {
  try {
    const payload = await callTool(name, args || {}, { config });
    return unwrapMcpToolPayload(payload);
  } catch {
    return null;
  }
}

function cleanAgentName(agent) {
  const raw = String(agent?.name || agent?.id || '').trim();
  if (!raw) return null;
  if (/neo4j|mcp|qflush|diagnostic|port|token|secret/i.test(raw)) return 'Agent';
  return raw.slice(0, 34);
}

function isJapaneseVariant(state) {
  const raw = [
    state?.game,
    state?.windowTitle,
    state?.launcher?.title,
    state?.kiro?.summary,
  ].filter(Boolean).join(' ');
  return /japanese|japan|jpn|\(j\)|\[j\]|\bjp\b/i.test(raw);
}

function summarizePitchingThreads(value) {
  const threads = Array.isArray(value?.discussions) ? value.discussions : [];
  const items = threads.slice(0, 6).map((thread) => {
    const pitching = thread?.pitching || thread?.pitch || {};
    const requiredAnswered = Number(pitching.requiredAnswered || 0);
    const requiredTotal = Number(pitching.requiredTotal || 0);
    const expectedAnswered = Number(pitching.expectedAnswered || 0);
    const expectedTotal = Number(pitching.expectedTotal || 0);
    return {
      title: String(thread?.title || 'Rendez-vous agents').slice(0, 80),
      ready: !!pitching.ready,
      requiredAnswered,
      requiredTotal,
      expectedAnswered,
      expectedTotal,
      deadlineSoftPassed: !!pitching.deadlineSoftPassed,
    };
  });
  return {
    total: threads.length,
    ready: items.filter((item) => item.ready).length,
    items,
  };
}

function buildCockpitSummary({
  a11,
  kaen44,
  vivyAudio,
  presence,
  jobs,
  romstation,
  controller,
  pitchingThreads,
}) {
  const agents = Array.isArray(presence?.presence?.agents) ? presence.presence.agents : [];
  const jobList = Array.isArray(jobs?.jobs?.jobs) ? jobs.jobs.jobs : [];
  const gameState = romstation?.state || null;
  const controllerStatus = controller?.status || null;
  const vivyStatus = vivyAudio?.status || vivyAudio || null;
  const vivyPresence = agents.find((agent) => /vivy/i.test([
    agent?.id,
    agent?.name,
    agent?.role,
  ].filter(Boolean).join(' ')));
  const vivyToolOk = !!vivyStatus && vivyStatus.ok !== false && !vivyStatus.error && !vivyStatus._mcp_error;
  const vivyPresenceOk = !!vivyPresence && vivyPresence.active !== false;
  const activeAgents = Number(presence?.presence?.activeCount || agents.filter((agent) => agent?.active).length || 0);
  const totalAgents = Number(presence?.presence?.totalCount || agents.length || 0);

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    a11: {
      ok: !!a11?.status?.ok,
    },
    kaen44: {
      ok: !!kaen44?.status?.ok,
    },
    vivy: {
      ok: vivyToolOk || vivyPresenceOk,
      audio: vivyToolOk,
      present: vivyPresenceOk,
      source: vivyToolOk ? 'qflush_vivy_audio_status' : (vivyPresenceOk ? 'agent_presence' : 'unknown'),
    },
    agents: {
      active: activeAgents,
      total: totalAgents,
      names: agents
        .filter((agent) => agent?.active)
        .map(cleanAgentName)
        .filter(Boolean)
        .map((name, index) => name === 'Agent' ? `Agent ${index + 1}` : name)
        .slice(0, 8),
    },
    jobs: {
      total: jobList.length,
      ready: jobList.filter((job) => job?.status === 'ready').length,
      running: jobList.filter((job) => job?.status === 'running').length,
    },
    game: {
      source: 'RomStation',
      ready: !!gameState?.available && !isJapaneseVariant(gameState),
      phase: String(gameState?.phase || 'waiting').slice(0, 40),
      japaneseIgnored: !isJapaneseVariant(gameState),
    },
    controller: {
      ready: !!controllerStatus?.ok,
      recentCount: Array.isArray(controllerStatus?.recent) ? controllerStatus.recent.length : 0,
      target: 'RomStation',
    },
    pitching: summarizePitchingThreads(pitchingThreads),
  };
}

function createMcpCockpitRouter({
  verifyJWT,
  callTool = callMcpTool,
  env = process.env,
  cockpitHtmlPath,
} = {}) {
  if (typeof verifyJWT !== 'function') {
    throw new Error('createMcpCockpitRouter requires verifyJWT');
  }

  const router = express.Router();

  function requireCockpitAdmin(req, res, next) {
    return verifyJWT(req, res, () => {
      if (isAllowedCockpitAdmin(req.user || {}, env)) return next();
      return jsonError(
        res,
        403,
        'admin_required',
        'Cockpit MCP reserve aux comptes admin Funesterie.'
      );
    });
  }

  router.get(['/', '/index.html', '/mcp.html'], (req, res) => {
    const pagePath = resolveCockpitHtmlPath(cockpitHtmlPath);
    if (!pagePath) {
      return jsonError(
        res,
        500,
        'cockpit_html_missing',
        'Interface MCP introuvable dans le bundle A11.'
      );
    }

    const config = getCockpitMcpConfig(env);
    const hostname = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const html = fs.readFileSync(pagePath, 'utf8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderHostedCockpitHtml(html, {
      cockpitConfig: {
        mode: 'a11-hosted',
        hostname: hostname || 'a11.funesterie.me',
        proxyUrl: '/api/cockpit/mcp/proxy',
        statusUrl: '/api/cockpit/mcp/status',
        meUrl: '/api/cockpit/mcp/me',
        authHeaderName: 'X-NEZ-TOKEN',
        authLocalStorageKey: 'a11_jwt_token',
        serverSideBearer: config.tokenPresent,
        publicEndpoints: Object.keys(PUBLIC_MCP_ENDPOINTS),
      },
      user: {},
    }));
  });

  router.get('/me', requireCockpitAdmin, (req, res) => {
    return res.json({
      ok: true,
      admin: true,
      user: publicUser(req.user || {}),
    });
  });

  router.get('/status', requireCockpitAdmin, async (_req, res) => {
    const config = getCockpitMcpConfig(env);
    const [
      a11,
      kaen44,
      vivyAudio,
      presence,
      jobs,
      romstation,
      controller,
      pitchingThreads,
    ] = await Promise.all([
      safeToolCall(callTool, 'a11_status', {}, config),
      safeToolCall(callTool, 'kaen44_status', {}, config),
      safeToolCall(callTool, 'qflush_vivy_audio_status', {}, config),
      safeToolCall(callTool, 'agent_presence', { includeIdle: true }, config),
      safeToolCall(callTool, 'agent_jobs', {}, config),
      safeToolCall(callTool, 'romstation_state', {}, config),
      safeToolCall(callTool, 'qflush_gamepad_status', {}, config),
      safeToolCall(callTool, 'discussion_list', { status: 'pitching', limit: 10 }, config),
    ]);

    return res.json(buildCockpitSummary({
      a11,
      kaen44,
      vivyAudio,
      presence,
      jobs,
      romstation,
      controller,
      pitchingThreads,
    }));
  });

  router.options('/proxy', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  });

  router.post('/proxy', requireCockpitAdmin, express.json({ limit: '512kb' }), async (req, res) => {
    let rpc;
    try {
      rpc = normalizeMcpRequest(req.body || {});
    } catch (error_) {
      return jsonError(
        res,
        error_.statusCode || 400,
        error_.message || 'invalid_request',
        'Méthode MCP non autorisée pour le cockpit.'
      );
    }

    const endpoint = resolveProxyEndpoint(req.body?.endpoint, env);
    const upstreamHeaders = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };

    if (endpoint.key === 'private') {
      const browserBearer = String(req.body?.privateBearer || '').trim();
      const token = endpoint.token || browserBearer;
      if (!token) {
        return jsonError(
          res,
          400,
          'private_bearer_required',
          'Aucun jeton MCP serveur configuré pour le cockpit privé.'
        );
      }
      upstreamHeaders.authorization = `Bearer ${token}`;
      upstreamHeaders['x-mcp-token'] = token;
    }

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(rpc),
        signal: createAbortSignal(endpoint.timeoutMs),
      });
      const bodyText = await response.text();
      const contentType = response.headers.get('content-type') || '';
      const isSse = /text\/event-stream/i.test(contentType) || /^event:|^data:/m.test(bodyText);
      const parsed = isSse ? { events: parseSse(bodyText) } : tryParseJson(bodyText);

      return res.status(response.ok ? 200 : response.status).json({
        ok: response.ok,
        endpoint: endpoint.key,
        status: response.status,
        contentType,
        payload: redactDeep(parsed),
        raw: redactText(bodyText).slice(0, 120000),
      });
    } catch {
      return jsonError(res, 502, 'mcp_upstream_unavailable', 'Upstream MCP indisponible.');
    }
  });

  return router;
}

module.exports = createMcpCockpitRouter;
module.exports.DEFAULT_COCKPIT_ADMIN_EMAILS = DEFAULT_COCKPIT_ADMIN_EMAILS;
module.exports.buildCockpitSummary = buildCockpitSummary;
module.exports.getCockpitMcpConfig = getCockpitMcpConfig;
module.exports.getCockpitAdminEmails = getCockpitAdminEmails;
module.exports.isAllowedCockpitAdmin = isAllowedCockpitAdmin;
module.exports.normalizeMcpRequest = normalizeMcpRequest;
module.exports.redactDeep = redactDeep;

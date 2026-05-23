'use strict';

const { verifyAdminFromEvent } = require('./auth-utils');

const ENDPOINTS = {
  chatgpt: 'https://mcp.funesterie.me/chatgpt/mcp',
  claude: 'https://mcp.funesterie.me/claude/mcp',
  gemini: 'https://mcp.funesterie.me/gemini/mcp',
  grok: 'https://mcp.funesterie.me/grok/mcp',
  private: 'https://mcp.funesterie.me/mcp',
};

const ALLOWED_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
]);

const headers = {
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'Vary': 'Cookie, Authorization',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

function decodeBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(String(event.body || ''), 'base64').toString('utf8')
    : String(event.body || '');
  if (raw.length > 256 * 1024) {
    const error = new Error('request_too_large');
    error.statusCode = 413;
    throw error;
  }
  return JSON.parse(raw || '{}');
}

function redactText(value) {
  return String(value || '')
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(npm_[A-Za-z0-9_=-]{16,})\b/g, 'npm_[REDACTED]')
    .replace(/\b(ghp|github_pat|glpat|xox[baprs])_[A-Za-z0-9_=-]{16,}\b/g, '$1_[REDACTED]')
    .replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]{12,}\b/g, '$1_$2_[REDACTED]')
    .replace(/\b(whsec)_[A-Za-z0-9]{12,}\b/g, '$1_[REDACTED]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, '$1 [REDACTED]');
}

function redactDeep(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|password|private[_-]?key|authorization/i.test(key)) {
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
  } catch (_error) {
    return null;
  }
}

function parseSse(text) {
  const events = [];
  let eventName = 'message';
  let dataLines = [];

  function flush() {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    events.push({
      event: eventName,
      data,
      parsed: tryParseJson(data),
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

function normalizeRequest(payload) {
  const request = payload?.request && typeof payload.request === 'object'
    ? payload.request
    : payload;
  const method = String(request?.method || '').trim();
  if (!ALLOWED_METHODS.has(method)) {
    const error = new Error('method_not_allowed');
    error.statusCode = 400;
    throw error;
  }
  return {
    jsonrpc: '2.0',
    id: request?.id || `cockpit-${Date.now()}`,
    method,
    params: request?.params && typeof request.params === 'object' ? request.params : {},
  };
}

function endpointUrl(name) {
  const key = String(name || 'chatgpt').trim().toLowerCase();
  return {
    key: ENDPOINTS[key] ? key : 'chatgpt',
    url: ENDPOINTS[key] || ENDPOINTS.chatgpt,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const auth = await verifyAdminFromEvent(event);
  if (!auth.ok) {
    return json(auth.statusCode || 401, { ok: false, error: auth.reason || 'auth_required' });
  }

  let payload;
  try {
    payload = decodeBody(event);
  } catch (error) {
    return json(error.statusCode || 400, { ok: false, error: error.message || 'invalid_json' });
  }

  let rpc;
  try {
    rpc = normalizeRequest(payload);
  } catch (error) {
    return json(error.statusCode || 400, { ok: false, error: error.message || 'invalid_request' });
  }

  const endpoint = endpointUrl(payload?.endpoint);
  const upstreamHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  const privateBearer = String(payload?.privateBearer || '').trim();
  if (endpoint.key === 'private') {
    if (!privateBearer) {
      return json(400, { ok: false, error: 'private_bearer_required' });
    }
    upstreamHeaders.Authorization = `Bearer ${privateBearer}`;
  }

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(rpc),
    });
    const bodyText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const isSse = /text\/event-stream/i.test(contentType) || /^event:|^data:/m.test(bodyText);
    const parsed = isSse ? { events: parseSse(bodyText) } : tryParseJson(bodyText);

    return json(response.ok ? 200 : response.status, {
      ok: response.ok,
      endpoint: endpoint.key,
      status: response.status,
      contentType,
      payload: redactDeep(parsed),
      raw: redactText(bodyText).slice(0, 120000),
    });
  } catch (_error) {
    return json(502, { ok: false, error: 'mcp_upstream_unavailable', endpoint: endpoint.key });
  }
};

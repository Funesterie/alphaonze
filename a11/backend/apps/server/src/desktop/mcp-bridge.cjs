'use strict';
/**
 * Funesterie Desktop â€” MCP Bridge
 *
 * GÃ¨re la connexion MCP depuis l'app Electron vers le MCP local et public.
 * Auto-refresh du token, reconnexion automatique, fallback gracieux.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const DEFAULT_MCP_URL = 'https://mcp.funesterie.me/mcp';
const DEFAULT_LOCAL_MCP_URLS = [
  'http://127.0.0.1:8788/mcp',
  'http://127.0.0.1:8787/mcp',
];
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1h
const RECONNECT_DELAY_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

class McpBridge {
  constructor(options = {}) {
    this.mcpUrls = this._normalizeMcpUrls(options);
    this.mcpUrl = this.mcpUrls[0] || DEFAULT_MCP_URL;
    this.activeMcpUrl = this.mcpUrl;
    this.endpointHealth = new Map();
    this.token = options.token || '';
    this.tokenFilePath = options.tokenFilePath || this._resolveTokenFilePath();
    this.connected = false;
    this.lastHealthCheck = null;
    this.reconnectTimer = null;
    this.healthTimer = null;
    this.tokenRefreshTimer = null;
    this.eventHandlers = new Map();
  }

  _normalizeMcpUrls(options = {}) {
    const envUrls = process.env.A11_MCP_URLS
      ? String(process.env.A11_MCP_URLS).split(/[;,]/).map((value) => value.trim()).filter(Boolean)
      : [];
    const explicit = Array.isArray(options.mcpUrls) ? options.mcpUrls : [];
    const defaultLocalUrls = options.includeDefaultLocalUrls === false ? [] : DEFAULT_LOCAL_MCP_URLS;
    const defaultProdUrls = options.includeDefaultProdUrl === false ? [] : [DEFAULT_MCP_URL];
    const legacy = options.mcpUrl || process.env.A11_MCP_URL || DEFAULT_MCP_URL;
    const urls = [...explicit, ...envUrls, ...defaultLocalUrls, legacy, ...defaultProdUrls]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => value.endsWith('/mcp') ? value : value.replace(/\/$/, '') + '/mcp');
    return [...new Set(urls)];
  }

  /**
   * Resolve token file path â€” checks OneDrive agent-bus first, then local
   */
  _resolveTokenFilePath() {
    const candidates = [
      // OneDrive shared (PC1 + PC2)
      path.join(process.env.USERPROFILE || '', 'OneDrive', 'a11_memory', 'agent-bus', 'mcp-token-current.txt'),
      // Local agent-bus
      'D:\\agent-bus\\mcp-token-current.txt',
      // AppData fallback
      path.join(process.env.APPDATA || '', 'Funesterie', 'mcp-token.txt'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return candidates[0]; // Default to OneDrive path
  }

  /**
   * Load token from file (auto-refresh after rotation)
   */
  loadToken() {
    try {
      if (this.tokenFilePath && fs.existsSync(this.tokenFilePath)) {
        const content = fs.readFileSync(this.tokenFilePath, 'utf8').trim();
        // Support both raw token and KEY=VALUE format
        const match = content.match(/^(?:MCP_AUTH_TOKEN\s*=\s*)?(.+)$/m);
        if (match) {
          this.token = match[1].trim();
          return true;
        }
      }
    } catch (err) {
      console.error('[McpBridge] Failed to load token:', err.message);
    }
    return false;
  }

  /**
   * Start the bridge â€” connect, health check, token refresh
   */
  start() {
    this.loadToken();
    this._startHealthCheck();
    this._startTokenRefresh();
    return this.healthCheck();
  }

  /**
   * Stop the bridge â€” cleanup timers
   */
  stop() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.tokenRefreshTimer) clearInterval(this.tokenRefreshTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.connected = false;
  }

  /**
   * Health check â€” verify MCP is reachable
   */
  async healthCheck() {
    try {
      const checks = await Promise.all(this.mcpUrls.map((url) => this._checkEndpoint(url)));
      const healthy = checks.filter((check) => check.ok);
      const preferred = healthy.find((check) => check.kind === 'local') || healthy[0] || checks[0];
      this.connected = healthy.length > 0;
      this.activeMcpUrl = preferred?.url || this.mcpUrl;
      this.mcpUrl = this.activeMcpUrl;
      this.lastHealthCheck = {
        ok: this.connected,
        at: new Date().toISOString(),
        activeUrl: this.activeMcpUrl,
        endpoints: checks,
      };
      this._emit('health', this.lastHealthCheck);
      return this.lastHealthCheck;
    } catch (err) {
      this.connected = false;
      this.lastHealthCheck = { ok: false, at: new Date().toISOString(), error: err.message };
      this._emit('health', this.lastHealthCheck);
      this._scheduleReconnect();
      return this.lastHealthCheck;
    }
  }

  async _checkEndpoint(url) {
    const kind = this._endpointKind(url);
    const checkedAt = new Date().toISOString();
    try {
      const healthUrl = this._healthUrlFor(url);
      const result = await this._httpGet(healthUrl, 5000);
      const data = JSON.parse(result);
      const ok = data.ok === true;
      const health = { url, kind, ok, at: checkedAt, data };
      this.endpointHealth.set(url, health);
      return health;
    } catch (err) {
      const health = { url, kind, ok: false, at: checkedAt, error: err.message };
      this.endpointHealth.set(url, health);
      return health;
    }
  }

  _healthUrlFor(url) {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/mcp\/?$/, '/health');
    if (!/\/health\/?$/.test(parsed.pathname)) parsed.pathname = '/health';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  _endpointKind(url) {
    try {
      const parsed = new URL(url);
      return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) ? 'local' : 'prod';
    } catch {
      return 'unknown';
    }
  }

  _healthyUrls() {
    const healthy = this.mcpUrls.filter((url) => this.endpointHealth.get(url)?.ok);
    const ordered = healthy.length ? healthy : this.mcpUrls;
    return ordered.sort((a, b) => {
      const ak = this._endpointKind(a) === 'local' ? 0 : 1;
      const bk = this._endpointKind(b) === 'local' ? 0 : 1;
      if (ak !== bk) return ak - bk;
      if (a === this.activeMcpUrl) return -1;
      if (b === this.activeMcpUrl) return 1;
      return 0;
    });
  }

  /**
   * Call an MCP tool
   */
  async callTool(toolName, args = {}) {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    const errors = [];
    for (const url of this._healthyUrls()) {
      try {
        const result = await this._httpPost(url, body, 30_000);
        const parsed = this._parseSSEResponse(result);
        if (parsed && !parsed.error && !parsed.result?.isError) {
          this.activeMcpUrl = url;
          this.mcpUrl = url;
          return parsed;
        }
        errors.push({ url, error: parsed?.error || parsed?.result?.content || 'tool error' });
      } catch (err) {
        errors.push({ url, error: err.message });
      }
    }
    return { error: { message: `MCP tool ${toolName} unavailable`, endpoints: errors } };
  }

  /**
   * List available tools
   */
  async listTools() {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {},
    });

    const merged = new Map();
    const endpoints = [];
    const errors = [];

    for (const url of this._healthyUrls()) {
      try {
        const result = await this._httpPost(url, body, 15_000);
        const parsed = this._parseSSEResponse(result);
        const tools = parsed?.result?.tools || parsed?.tools || [];
        if (Array.isArray(tools)) {
          for (const tool of tools) {
            if (!tool?.name || merged.has(tool.name)) continue;
            merged.set(tool.name, { ...tool, _funesterieEndpoint: this._endpointKind(url) });
          }
          endpoints.push({ url, kind: this._endpointKind(url), ok: true, count: tools.length });
        }
      } catch (err) {
        errors.push({ url, kind: this._endpointKind(url), error: err.message });
      }
    }

    if (merged.size) {
      const preferred = [...endpoints]
        .sort((a, b) => {
          const ak = a.kind === 'local' ? 0 : 1;
          const bk = b.kind === 'local' ? 0 : 1;
          if (ak !== bk) return ak - bk;
          return (b.count || 0) - (a.count || 0);
        })[0];
      if (preferred?.url) {
        this.activeMcpUrl = preferred.url;
        this.mcpUrl = preferred.url;
      }
      return {
        jsonrpc: '2.0',
        id: Date.now(),
        result: {
          tools: [...merged.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
          endpoints,
          errors,
        },
      };
    }

    return { error: { message: 'MCP tools unavailable', endpoints: errors } };
  }

  /**
   * Parse SSE response from MCP
   */
  _parseSSEResponse(raw) {
    const lines = String(raw || '').split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch { /* continue */ }
      }
    }
    // Try direct JSON parse
    try { return JSON.parse(raw); } catch { return null; }
  }

  /**
   * HTTP POST with auth
   */
  _httpPost(url, body, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }

  /**
   * HTTP GET
   */
  _httpGet(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const headers = {};
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

      const req = lib.get({ hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80), path: parsed.pathname, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _startHealthCheck() {
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_CHECK_INTERVAL_MS);
  }

  _startTokenRefresh() {
    this.tokenRefreshTimer = setInterval(() => {
      const oldToken = this.token;
      this.loadToken();
      if (this.token !== oldToken && this.token) {
        console.log('[McpBridge] Token refreshed from file');
        this._emit('token-refreshed', { at: new Date().toISOString() });
        this.healthCheck(); // Re-verify with new token
      }
    }, TOKEN_REFRESH_INTERVAL_MS);
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.healthCheck();
    }, RECONNECT_DELAY_MS);
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      try { handler(data); } catch { /* ignore */ }
    }
  }
}

module.exports = { McpBridge };

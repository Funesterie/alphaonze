'use strict';
/**
 * Funesterie Desktop - LLM Fallback Router
 *
 * Routing hybride automatique : Ollama local -> A11 local -> A11 prod -> OpenRouter -> cache offline.
 * Détecte le hardware et adapte la stratégie sans intervention utilisateur.
 */

const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const { URL } = require('node:url');

const OLLAMA_TIMEOUT_MS = 5000;
const A11_LOCAL_TIMEOUT_MS = 8000;
const A11_PROD_TIMEOUT_MS = 30000;
const OPENROUTER_TIMEOUT_MS = 30000;

class LlmFallbackRouter {
  constructor(options = {}) {
    this.ollamaUrl = options.ollamaUrl || 'http://127.0.0.1:11434';
    this.a11LocalUrl = options.a11LocalUrl || 'http://127.0.0.1:3000';
    this.a11ProdUrl = options.a11ProdUrl || 'https://a11.funesterie.me';
    this.openRouterKey = options.openRouterKey || process.env.OPENROUTER_API_KEY || '';
    this.preferredModel = options.model || 'gemma4:e4b';
    this.cloudModel = options.cloudModel || 'anthropic/claude-3-haiku';

    this.status = {
      ollama: { available: false, lastCheck: null, latencyMs: null },
      a11Local: { available: false, lastCheck: null },
      a11Prod: { available: false, lastCheck: null },
      openRouter: { available: false, lastCheck: null },
    };

    this.hardwareProfile = this._detectHardware();
    this.healthTimer = null;
  }

  /**
   * Detect hardware capabilities
   */
  _detectHardware() {
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const cpuCount = os.cpus().length;
    const ramGB = Math.round(totalRam / (1024 * 1024 * 1024));
    const freeRamGB = Math.round(freeRam / (1024 * 1024 * 1024));

    return {
      ramGB,
      freeRamGB,
      cpuCount,
      canRunOllama: ramGB >= 8 && freeRamGB >= 4,
      preferCloud: ramGB < 12 || freeRamGB < 3,
      recommendedModel: ramGB >= 16 ? 'gemma4:e4b' : ramGB >= 8 ? 'llama3.2:latest' : 'phi3:mini',
    };
  }

  /**
   * Start health monitoring
   */
  start() {
    this._checkAll();
    this.healthTimer = setInterval(() => this._checkAll(), 30_000);
  }

  stop() {
    if (this.healthTimer) clearInterval(this.healthTimer);
  }

  /**
   * Send a chat message through the fallback chain
   */
  async chat(message, options = {}) {
    const messages = options.messages || [{ role: 'user', content: message }];

    // 1. Ollama local (si hardware OK et responsive)
    if (this.status.ollama.available && !this.hardwareProfile.preferCloud) {
      try {
        const result = await this._callOllama(messages);
        if (result) return { provider: 'ollama', model: this.preferredModel, text: result };
      } catch { /* fallthrough */ }
    }

    // 2. A11 local (port 3000)
    if (this.status.a11Local.available) {
      try {
        const result = await this._callA11Local(message);
        if (result) return { provider: 'a11-local', text: result };
      } catch { /* fallthrough */ }
    }

    // 3. A11 prod (a11.funesterie.me)
    if (this.status.a11Prod.available) {
      try {
        const result = await this._callA11Prod(message);
        if (result) return { provider: 'a11-prod', text: result };
      } catch { /* fallthrough */ }
    }

    // 4. OpenRouter (cloud fallback)
    if (this.openRouterKey) {
      try {
        const result = await this._callOpenRouter(messages);
        if (result) return { provider: 'openrouter', model: this.cloudModel, text: result };
      } catch { /* fallthrough */ }
    }

    // 5. Offline mode
    return { provider: 'offline', text: "Je suis temporairement hors ligne. Réessaie dans quelques instants." };
  }

  /**
   * Check all providers
   */
  async _checkAll() {
    await Promise.allSettled([
      this._checkOllama(),
      this._checkA11Local(),
      this._checkA11Prod(),
    ]);
  }

  async _checkOllama() {
    try {
      const start = Date.now();
      await this._httpGet(`${this.ollamaUrl}/api/tags`, OLLAMA_TIMEOUT_MS);
      const latency = Date.now() - start;
      this.status.ollama = { available: true, lastCheck: new Date().toISOString(), latencyMs: latency };
    } catch {
      this.status.ollama = { available: false, lastCheck: new Date().toISOString(), latencyMs: null };
    }
  }

  async _checkA11Local() {
    try {
      await this._httpGet(`${this.a11LocalUrl}/health`, 3000);
      this.status.a11Local = { available: true, lastCheck: new Date().toISOString() };
    } catch {
      this.status.a11Local = { available: false, lastCheck: new Date().toISOString() };
    }
  }

  async _checkA11Prod() {
    try {
      await this._httpGet(`${this.a11ProdUrl}/health`, 5000);
      this.status.a11Prod = { available: true, lastCheck: new Date().toISOString() };
    } catch {
      this.status.a11Prod = { available: false, lastCheck: new Date().toISOString() };
    }
  }

  async _callOllama(messages) {
    const body = JSON.stringify({
      model: this.hardwareProfile.recommendedModel,
      messages,
      stream: false,
    });
    const result = await this._httpPost(`${this.ollamaUrl}/v1/chat/completions`, body, OLLAMA_TIMEOUT_MS);
    const data = JSON.parse(result);
    return data?.choices?.[0]?.message?.content || null;
  }

  async _callA11Local(message) {
    const body = JSON.stringify({ message });
    const result = await this._httpPost(`${this.a11LocalUrl}/api/chat`, body, A11_LOCAL_TIMEOUT_MS);
    const data = JSON.parse(result);
    return data?.assistant || null;
  }

  async _callA11Prod(message) {
    const body = JSON.stringify({ message });
    const result = await this._httpPost(`${this.a11ProdUrl}/api/chat`, body, A11_PROD_TIMEOUT_MS);
    const data = JSON.parse(result);
    return data?.assistant || null;
  }

  async _callOpenRouter(messages) {
    const body = JSON.stringify({
      model: this.cloudModel,
      messages,
    });
    const result = await this._httpPost('https://openrouter.ai/api/v1/chat/completions', body, OPENROUTER_TIMEOUT_MS, {
      'Authorization': `Bearer ${this.openRouterKey}`,
    });
    const data = JSON.parse(result);
    return data?.choices?.[0]?.message?.content || null;
  }

  _httpGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _httpPost(url, body, timeoutMs, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extraHeaders },
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
   * Get current routing status for UI display
   */
  getStatus() {
    return {
      hardware: this.hardwareProfile,
      providers: this.status,
      activeProvider: this._getActiveProvider(),
    };
  }

  _getActiveProvider() {
    if (this.status.ollama.available && !this.hardwareProfile.preferCloud) return 'ollama';
    if (this.status.a11Local.available) return 'a11-local';
    if (this.status.a11Prod.available) return 'a11-prod';
    if (this.openRouterKey) return 'openrouter';
    return 'offline';
  }
}

module.exports = { LlmFallbackRouter };

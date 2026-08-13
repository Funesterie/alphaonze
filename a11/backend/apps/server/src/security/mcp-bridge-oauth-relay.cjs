/**
 * MCP Bridge OAuth Relay — Zen Gate V2
 * 
 * Handles ComfyUI Cloud authentication for the bridge:
 * 1. API Key mode (preferred): X-API-Key header (key from platform.comfy.org)
 * 2. OAuth Token Relay: accepts a token from an authenticated client (Kiro)
 *    and stores it for reuse by Vivy/agents
 * 3. Device Code Flow (future): for fully autonomous auth
 *
 * Token storage: encrypted file on disk (AES-256-GCM, key from env)
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = process.env.MCP_BRIDGE_TOKEN_FILE || '/agent-bus/mcp-bridge-tokens.enc';
const ENCRYPTION_KEY = process.env.MCP_BRIDGE_ENC_KEY || 'funesterie-zen-gate-2026-bridge-key!'; // 32 chars

// --- Encryption helpers ---
function deriveKey(passphrase) {
  return crypto.createHash('sha256').update(passphrase).digest();
}

function encrypt(text) {
  const key = deriveKey(ENCRYPTION_KEY);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

function decrypt(data) {
  const parts = data.split(':');
  if (parts.length < 3) throw new Error('Invalid encrypted data');
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts.slice(2).join(':');
  const key = deriveKey(ENCRYPTION_KEY);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- Token store ---
function loadTokens() {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return {};
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(decrypt(raw));
  } catch (err) {
    console.warn('[oauth-relay] Failed to load tokens:', err.message);
    return {};
  }
}

function saveTokens(tokens) {
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, encrypt(JSON.stringify(tokens)), 'utf8');
  } catch (err) {
    console.error('[oauth-relay] Failed to save tokens:', err.message);
  }
}

function getToken(service) {
  const tokens = loadTokens();
  const entry = tokens[service];
  if (!entry) return null;
  // Check expiry
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    console.warn('[oauth-relay] Token for ' + service + ' expired');
    return null;
  }
  return entry.accessToken;
}

function setToken(service, accessToken, expiresIn = 86400) {
  const tokens = loadTokens();
  tokens[service] = {
    accessToken,
    setAt: Date.now(),
    expiresAt: Date.now() + (expiresIn * 1000),
  };
  saveTokens(tokens);
  return true;
}

function removeToken(service) {
  const tokens = loadTokens();
  delete tokens[service];
  saveTokens(tokens);
}

// --- Get the best available auth header for a service ---
function getAuthHeaders(service) {
  // Priority 1: API key from env
  if (service === 'comfy') {
    const apiKey = process.env.MCP_BRIDGE_COMFY_API_KEY || process.env.COMFY_API_KEY;
    if (apiKey) {
      return { 'x-api-key': apiKey };
    }
  }
  if (service === 'civitai') {
    const apiKey = process.env.MCP_BRIDGE_CIVITAI_TOKEN || process.env.A11_CIVITAI_API_KEY;
    if (apiKey) {
      return { authorization: 'Bearer ' + apiKey };
    }
  }

  // Priority 2: Stored OAuth token
  const token = getToken(service);
  if (token) {
    return { authorization: 'Bearer ' + token };
  }

  return {};
}

// --- Express routes for token management ---
function mountOAuthRelayRoutes(app) {
  // Store a token (called by Kiro or any authenticated client)
  app.post('/api/mcp-bridge/oauth/store', (req, res) => {
    try {
      const { service, accessToken, expiresIn } = req.body || {};
      if (!service || !accessToken) {
        return res.status(400).json({ error: 'Missing service or accessToken' });
      }
      if (!['comfy', 'civitai', 'huggingface'].includes(service)) {
        return res.status(400).json({ error: 'Unknown service: ' + service });
      }
      setToken(service, accessToken, expiresIn || 86400);
      console.log('[oauth-relay] Token stored for ' + service + ' (expires in ' + (expiresIn || 86400) + 's)');
      res.json({ ok: true, service, storedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Check token status
  app.get('/api/mcp-bridge/oauth/status', (req, res) => {
    const tokens = loadTokens();
    const status = {};
    for (const [service, entry] of Object.entries(tokens)) {
      status[service] = {
        hasToken: !!entry.accessToken,
        expired: entry.expiresAt ? Date.now() > entry.expiresAt : false,
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
        setAt: entry.setAt ? new Date(entry.setAt).toISOString() : null,
      };
    }
    // Also check env-based keys
    status._envKeys = {
      comfyApiKey: !!(process.env.MCP_BRIDGE_COMFY_API_KEY || process.env.COMFY_API_KEY),
      civitaiToken: !!(process.env.MCP_BRIDGE_CIVITAI_TOKEN || process.env.A11_CIVITAI_API_KEY),
    };
    res.json(status);
  });

  // Revoke a token
  app.delete('/api/mcp-bridge/oauth/revoke', (req, res) => {
    const { service } = req.body || {};
    if (!service) return res.status(400).json({ error: 'Missing service' });
    removeToken(service);
    res.json({ ok: true, revoked: service });
  });

  console.log('[oauth-relay] OAuth relay routes mounted: /api/mcp-bridge/oauth/{store,status,revoke}');
}

module.exports = {
  decrypt,
  encrypt,
  getAuthHeaders,
  getToken,
  loadTokens,
  mountOAuthRelayRoutes,
  removeToken,
  saveTokens,
  setToken,
};

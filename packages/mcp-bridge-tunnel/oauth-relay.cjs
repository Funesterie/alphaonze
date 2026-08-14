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
const ENCRYPTION_KEY = process.env.MCP_BRIDGE_ENC_KEY || '';

// --- SECURITY: fail-closed if encryption key is missing ---
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 16) {
  console.error('[oauth-relay] FATAL: MCP_BRIDGE_ENC_KEY is missing or too short (min 16 chars). Token storage is disabled.');
}

function isEncryptionAvailable() {
  return ENCRYPTION_KEY && ENCRYPTION_KEY.length >= 16;
}

// --- Encryption helpers ---
function deriveKey(passphrase) {
  return crypto.createHash('sha256').update(passphrase).digest();
}

function encrypt(text) {
  if (!isEncryptionAvailable()) throw new Error('Encryption unavailable: MCP_BRIDGE_ENC_KEY not set');
  const key = deriveKey(ENCRYPTION_KEY);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

function decrypt(data) {
  if (!isEncryptionAvailable()) throw new Error('Decryption unavailable: MCP_BRIDGE_ENC_KEY not set');
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
    if (!isEncryptionAvailable()) throw new Error('Encryption unavailable');
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const encrypted = encrypt(JSON.stringify(tokens));
    // Atomic write: tmp file → fsync → rename (prevents corruption on crash)
    const tmpFile = TOKEN_FILE + '.tmp.' + process.pid;
    const fd = fs.openSync(tmpFile, 'w', 0o600);
    fs.writeSync(fd, encrypted, 0, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpFile, TOKEN_FILE);
  } catch (err) {
    console.error('[oauth-relay] Échec sauvegarde tokens :', err.message);
    // Clean up tmp file on error
    try { fs.unlinkSync(TOKEN_FILE + '.tmp.' + process.pid); } catch (e) { /* ignore */ }
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
// SECURITY: All mutation routes require authentication.
// The caller MUST mount these behind their auth middleware, or provide requireAuth here.
function mountOAuthRelayRoutes(app, options = {}) {
  const requireAuth = options.requireAuth || function(req, res, next) {
    const sessionUser = req.user || (req.session && req.session.user);
    if (sessionUser && (sessionUser.email || sessionUser.id)) return next();
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const secret = process.env.JWT_SECRET;
      if (!secret) return res.status(401).json({ error: 'JWT_SECRET manquant' });
      try {
        const jwt = require('jsonwebtoken');
        jwt.verify(authHeader.slice(7).trim(), secret, { algorithms: ['HS256', 'HS384', 'HS512'] });
        return next();
      } catch (e) { return res.status(401).json({ error: 'Token invalide' }); }
    }
    return res.status(401).json({ error: 'Authentification requise' });
  };

  const requireAdmin = options.requireAdmin || function(req, res, next) {
    const email = (req.user && req.user.email) || (req.session && req.session.user && req.session.user.email) || '';
    const ADMIN_EMAILS = (process.env.ZEN_GATE_ADMIN_EMAILS || 'cellaurojeffrey@gmail.com').split(',').map(function(e) { return e.trim().toLowerCase(); });
    if (ADMIN_EMAILS.includes(email.toLowerCase())) return next();
    return res.status(403).json({ error: 'Accès admin Zen Gate requis' });
  };

  // Store a token (ADMIN ONLY)
  app.post('/api/mcp-bridge/oauth/store', requireAuth, requireAdmin, (req, res) => {
    try {
      if (!isEncryptionAvailable()) {
        return res.status(503).json({ error: 'Token storage unavailable: encryption key not configured' });
      }
      const { service, accessToken, expiresIn } = req.body || {};
      if (!service || !accessToken) {
        return res.status(400).json({ error: 'Missing service or accessToken' });
      }
      if (!['comfy', 'civitai', 'huggingface'].includes(service)) {
        return res.status(400).json({ error: 'Unknown service: ' + service });
      }
      setToken(service, accessToken, expiresIn || 86400);
      console.log('[oauth-relay] Token stored for ' + service + ' by ' + (req.user?.email || 'unknown') + ' (expires in ' + (expiresIn || 86400) + 's)');
      res.json({ ok: true, service, storedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Check token status (authenticated users)
  app.get('/api/mcp-bridge/oauth/status', requireAuth, (req, res) => {
    const tokens = isEncryptionAvailable() ? loadTokens() : {};
    const status = {};
    for (const [service, entry] of Object.entries(tokens)) {
      status[service] = {
        hasToken: !!entry.accessToken,
        expired: entry.expiresAt ? Date.now() > entry.expiresAt : false,
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
        setAt: entry.setAt ? new Date(entry.setAt).toISOString() : null,
      };
    }
    status._envKeys = {
      comfyApiKey: !!(process.env.MCP_BRIDGE_COMFY_API_KEY || process.env.COMFY_API_KEY),
      civitaiToken: !!(process.env.MCP_BRIDGE_CIVITAI_TOKEN || process.env.A11_CIVITAI_API_KEY),
    };
    status._encryptionAvailable = isEncryptionAvailable();
    res.json(status);
  });

  // Revoke a token (ADMIN ONLY)
  app.delete('/api/mcp-bridge/oauth/revoke', requireAuth, requireAdmin, (req, res) => {
    const { service } = req.body || {};
    if (!service) return res.status(400).json({ error: 'Missing service' });
    removeToken(service);
    console.log('[oauth-relay] Token revoked for ' + service + ' by ' + (req.user?.email || 'unknown'));
    res.json({ ok: true, revoked: service });
  });

  console.log('[oauth-relay] OAuth relay routes mounted with auth guards: /api/mcp-bridge/oauth/{store,status,revoke}');
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

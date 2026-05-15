'use strict';
/**
 * Funesterie MCP OAuth Server
 *
 * OAuth 2.0 Authorization Code Flow pour ChatGPT Enterprise.
 * Permet Ã  ChatGPT de s'authentifier proprement et d'obtenir un bearer token
 * pour accÃ©der au MCP complet (57+ outils).
 *
 * Routes :
 *   GET  /oauth/authorize  â†’ page de consentement / auto-approve
 *   POST /oauth/token      â†’ Ã©change code â†’ access_token
 *   GET  /oauth/.well-known/openid-configuration â†’ discovery (optionnel)
 *
 * Config dans .env :
 *   OAUTH_CLIENT_ID=funesterie-chatgpt
 *   OAUTH_CLIENT_SECRET=<random-secret>
 *   OAUTH_REDIRECT_ALLOWED=https://chatgpt.com/aip/{connector}/oauth/callback,https://chat.openai.com/aip/{connector}/oauth/callback
 *   MCP_AUTH_TOKEN=<le bearer MCP actif>
 */

const crypto = require('node:crypto');
const { URL } = require('node:url');
const jwt = require('jsonwebtoken');

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEFAULT_CLIENT_ID = 'funesterie-chatgpt';
const DEFAULT_CLIENT_SECRET = crypto.randomBytes(32).toString('hex');
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL_SECONDS = 86400; // 24h
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const DEFAULT_SCOPE = 'mcp:read mcp:write';

// In-memory code store (codes are single-use, short-lived)
const pendingCodes = new Map();
const refreshTokens = new Map();

function getConfig(env = process.env) {
  const clientSecret = env.OAUTH_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
  const mcpToken = env.MCP_AUTH_TOKEN || env.A11_PUBLIC_MCP_TOKEN || env.A11_MCP_TOKEN || '';
  return {
    clientId: env.OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID,
    clientSecret,
    jwtSecret: env.OAUTH_JWT_SECRET || env.JWT_SECRET || clientSecret || mcpToken || '',
    mcpToken,
    autoApprove: env.OAUTH_AUTO_APPROVE !== 'false', // Auto-approve by default (Djeff's own server)
    allowedRedirects: (env.OAUTH_REDIRECT_ALLOWED || 'https://chatgpt.com/aip/*/oauth/callback,https://chat.openai.com/aip/*/oauth/callback')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    issuer: env.OAUTH_ISSUER || 'https://mcp.funesterie.me',
    audience: env.OAUTH_AUDIENCE || env.OAUTH_ISSUER || 'https://mcp.funesterie.me',
    subject: env.OAUTH_SUBJECT || 'chatgpt-enterprise',
    tokenTtlSeconds: Number(env.OAUTH_TOKEN_TTL_SECONDS || TOKEN_TTL_SECONDS),
  };
}

// â”€â”€â”€ Code Generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateCode() {
  return crypto.randomBytes(32).toString('base64url');
}

function storeCode(code, metadata = {}) {
  pendingCodes.set(code, {
    ...metadata,
    createdAt: Date.now(),
    used: false,
  });

  // Cleanup expired codes
  const now = Date.now();
  for (const [key, value] of pendingCodes) {
    if (now - value.createdAt > CODE_TTL_MS || value.used) {
      pendingCodes.delete(key);
    }
  }
}

function consumeCode(code) {
  const entry = pendingCodes.get(code);
  if (!entry) return null;
  if (entry.used) return null;
  if (Date.now() - entry.createdAt > CODE_TTL_MS) {
    pendingCodes.delete(code);
    return null;
  }
  entry.used = true;
  pendingCodes.delete(code);
  return entry;
}

function generateRefreshToken() {
  return `rt_${crypto.randomBytes(32).toString('base64url')}`;
}

function storeRefreshToken(token, metadata = {}) {
  refreshTokens.set(token, {
    ...metadata,
    createdAt: Date.now(),
  });

  const now = Date.now();
  for (const [key, value] of refreshTokens) {
    if (now - value.createdAt > REFRESH_TOKEN_TTL_MS) {
      refreshTokens.delete(key);
    }
  }
}

function getRefreshToken(token) {
  const entry = refreshTokens.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > REFRESH_TOKEN_TTL_MS) {
    refreshTokens.delete(token);
    return null;
  }
  return entry;
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.*]/g, '\\$&');
}

function isRedirectAllowed(redirectUri, allowedRedirects) {
  return allowedRedirects.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`);
      return regex.test(redirectUri);
    }
    return redirectUri === pattern || redirectUri.startsWith(pattern);
  });
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseBasicAuth(header = '') {
  const value = String(header || '').trim();
  if (!value.toLowerCase().startsWith('basic ')) return {};
  try {
    const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8');
    const index = decoded.indexOf(':');
    if (index < 0) return {};
    return {
      clientId: decoded.slice(0, index),
      clientSecret: decoded.slice(index + 1),
    };
  } catch {
    return {};
  }
}

function base64UrlSha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('base64url');
}

function validatePkce(codeEntry, codeVerifier) {
  const challenge = String(codeEntry?.codeChallenge || '').trim();
  if (!challenge) return true;
  const verifier = String(codeVerifier || '').trim();
  if (!verifier) return false;
  const method = String(codeEntry?.codeChallengeMethod || 'plain').trim().toUpperCase();
  if (method === 'S256') return base64UrlSha256(verifier) === challenge;
  if (method === 'PLAIN') return verifier === challenge;
  return false;
}

function issueAccessToken(metadata = {}, env = process.env) {
  const config = getConfig(env);
  if (!config.jwtSecret) {
    throw new Error('OAUTH_JWT_SECRET is required to issue OAuth access tokens.');
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = Number.isFinite(config.tokenTtlSeconds) && config.tokenTtlSeconds > 0
    ? Math.round(config.tokenTtlSeconds)
    : TOKEN_TTL_SECONDS;

  return jwt.sign({
    iss: config.issuer,
    sub: config.subject,
    aud: config.audience,
    iat: now,
    exp: now + ttl,
    scope: metadata.scope || DEFAULT_SCOPE,
    client_id: metadata.clientId || config.clientId,
    token_use: 'access',
  }, config.jwtSecret, { algorithm: 'HS256', noTimestamp: true });
}

function verifyOAuthAccessToken(token, env = process.env) {
  const config = getConfig(env);
  if (!config.jwtSecret) return null;
  try {
    const payload = jwt.verify(String(token || ''), config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
    });
    if (payload?.token_use !== 'access') return null;
    return payload;
  } catch {
    return null;
  }
}

function buildTokenResponse(metadata = {}, env = process.env) {
  const config = getConfig(env);
  const refreshToken = generateRefreshToken();
  storeRefreshToken(refreshToken, {
    clientId: metadata.clientId || config.clientId,
    scope: metadata.scope || DEFAULT_SCOPE,
  });

  return {
    access_token: issueAccessToken(metadata, env),
    token_type: 'Bearer',
    expires_in: config.tokenTtlSeconds || TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: metadata.scope || DEFAULT_SCOPE,
  };
}

// â”€â”€â”€ Route Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * GET /oauth/authorize
 *
 * ChatGPT sends:
 *   ?response_type=code
 *   &client_id=funesterie-chatgpt
 *   &redirect_uri=https://chatgpt.com/aip/.../oauth/callback
 *   &state=<random>
 *   &scope=mcp
 *
 * We auto-approve (it's Djeff's own server) and redirect back with a code.
 */
function handleAuthorize(req, res) {
  const config = getConfig();
  const query = req.query || parseQuery(req.url);

  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  const state = query.state || '';
  const responseType = query.response_type;
  const scope = query.scope || DEFAULT_SCOPE;
  const codeChallenge = query.code_challenge || '';
  const codeChallengeMethod = query.code_challenge_method || '';

  // Validate
  if (responseType !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type', message: 'Only code flow supported' });
  }

  if (clientId !== config.clientId) {
    return res.status(400).json({ error: 'invalid_client', message: 'Unknown client_id' });
  }

  if (!redirectUri) {
    return res.status(400).json({ error: 'invalid_request', message: 'redirect_uri required' });
  }

  // Validate redirect URI against allowlist
  if (!isRedirectAllowed(redirectUri, config.allowedRedirects)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', message: 'redirect_uri not in allowlist' });
  }

  // Auto-approve: generate code and redirect immediately
  if (config.autoApprove) {
    const code = generateCode();
    storeCode(code, { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod });

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    return res.redirect(302, redirectUrl.toString());
  }

  // Manual approve: show consent page (simple HTML)
  const code = generateCode();
  storeCode(code, { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, pending: true });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Funesterie MCP â€” Autorisation</title>
<style>body{font-family:system-ui;max-width:500px;margin:80px auto;padding:20px;background:#1a1a2e;color:#eee}
h1{color:#e94560}button{background:#e94560;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;cursor:pointer}
button:hover{background:#ff6b6b}.info{background:#16213e;padding:16px;border-radius:8px;margin:20px 0}</style>
</head>
<body>
<h1>ðŸ” Funesterie MCP</h1>
<div class="info">
<p><strong>ChatGPT Enterprise</strong> demande accÃ¨s au MCP Funesterie.</p>
<p>Scope : <code>${scope}</code></p>
<p>Client : <code>${clientId}</code></p>
</div>
<form method="GET" action="/oauth/approve">
<input type="hidden" name="code" value="${code}">
<input type="hidden" name="redirect_uri" value="${redirectUri}">
<input type="hidden" name="state" value="${state}">
<button type="submit">âœ… Autoriser</button>
</form>
</body></html>`);
}

/**
 * GET /oauth/approve (manual flow only)
 */
function handleApprove(req, res) {
  const query = req.query || parseQuery(req.url);
  const code = query.code;
  const redirectUri = query.redirect_uri;
  const state = query.state || '';

  if (!code || !pendingCodes.has(code)) {
    return res.status(400).json({ error: 'invalid_code' });
  }

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return res.redirect(302, redirectUrl.toString());
}

/**
 * POST /oauth/token
 *
 * ChatGPT sends:
 *   grant_type=authorization_code
 *   code=<the code from authorize>
 *   client_id=funesterie-chatgpt
 *   client_secret=<secret>
 *   redirect_uri=<same as authorize>
 *
 * We return a signed OAuth JWT as the access_token.
 */
function handleToken(req, res) {
  const config = getConfig();
  const body = req.body || {};
  const basicAuth = parseBasicAuth(req.headers?.authorization);

  const grantType = body.grant_type;
  const code = body.code;
  const clientId = body.client_id || basicAuth.clientId;
  const clientSecret = body.client_secret || basicAuth.clientSecret;
  const redirectUri = body.redirect_uri;
  const codeVerifier = body.code_verifier;

  // Validate grant type
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // Refresh token flow â€” just return the same token
  if (grantType === 'refresh_token') {
    const refreshToken = body.refresh_token;
    const tokenEntry = getRefreshToken(refreshToken);
    if (!tokenEntry || tokenEntry.clientId !== config.clientId) {
      return res.status(400).json({ error: 'invalid_grant', message: 'Invalid refresh token' });
    }
    return res.json(buildTokenResponse({ clientId: tokenEntry.clientId, scope: tokenEntry.scope }, process.env));
  }

  // Validate client credentials
  if (clientId !== config.clientId) {
    return res.status(401).json({ error: 'invalid_client', message: 'Unknown client_id' });
  }

  if (!timingSafeEqualString(clientSecret, config.clientSecret)) {
    return res.status(401).json({ error: 'invalid_client', message: 'Bad client_secret' });
  }

  // Consume the code
  const codeEntry = consumeCode(code);
  if (!codeEntry) {
    return res.status(400).json({ error: 'invalid_grant', message: 'Code expired or already used' });
  }

  // Validate redirect_uri matches
  if (redirectUri && redirectUri !== codeEntry.redirectUri) {
    return res.status(400).json({ error: 'invalid_grant', message: 'redirect_uri mismatch' });
  }

  if (!validatePkce(codeEntry, codeVerifier)) {
    return res.status(400).json({ error: 'invalid_grant', message: 'PKCE verification failed' });
  }

  res.json(buildTokenResponse({
    clientId: codeEntry.clientId,
    scope: codeEntry.scope || DEFAULT_SCOPE,
  }, process.env));
}

/**
 * GET /.well-known/openid-configuration (discovery)
 */
function handleDiscovery(req, res) {
  const config = getConfig();
  res.json({
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['mcp:read', 'mcp:write', 'mcp'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256', 'plain'],
  });
}

// â”€â”€â”€ Express Router Factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function createOAuthRouter(express) {
  const router = express.Router();

  router.get('/authorize', handleAuthorize);
  router.get('/approve', handleApprove);
  router.post('/token', express.json(), express.urlencoded({ extended: true }), handleToken);
  router.get('/.well-known/openid-configuration', handleDiscovery);

  return router;
}

// â”€â”€â”€ Utility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result = {};
  for (const [key, value] of params) result[key] = value;
  return result;
}

module.exports = {
  createOAuthRouter,
  handleAuthorize,
  handleToken,
  handleDiscovery,
  handleApprove,
  getConfig,
  issueAccessToken,
  verifyOAuthAccessToken,
  validatePkce,
  // For testing
  generateCode,
  storeCode,
  consumeCode,
};

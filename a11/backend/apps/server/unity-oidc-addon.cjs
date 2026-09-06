'use strict';
/**
 * Unity OIDC Addon — Expose OpenID Connect discovery + JWKS + token endpoint
 * for Unity Player Authentication to validate Bloop JWTs.
 * 
 * Endpoints:
 *   GET /.well-known/openid-configuration
 *   GET /api/unity/jwks
 *   POST /api/unity/token (exchange internal auth for a Unity-compatible RS256 JWT)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ISSUER = 'https://a11.funesterie.me';
const RUNTIME = '/app/runtime';

module.exports = function mountUnityOidc(app) {
  // Load keys
  let privateKey, jwks;
  try {
    privateKey = fs.readFileSync(path.join(RUNTIME, 'unity-oidc-private.pem'), 'utf8');
    jwks = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'unity-jwks.json'), 'utf8'));
  } catch (e) {
    console.warn('[unity-oidc] Keys not found, skipping:', e.message);
    return;
  }

  // OpenID Connect Discovery
  app.get('/.well-known/openid-configuration', (req, res) => {
    res.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/api/unity/authorize`,
      token_endpoint: `${ISSUER}/api/unity/token`,
      userinfo_endpoint: `${ISSUER}/api/unity/userinfo`,
      jwks_uri: `${ISSUER}/api/unity/jwks`,
      response_types_supported: ['code', 'id_token', 'token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      claims_supported: ['sub', 'name', 'email', 'iss', 'aud', 'exp', 'iat']
    });
  });

  // JWKS endpoint
  app.get('/api/unity/jwks', (req, res) => {
    res.json(jwks);
  });

  // Token endpoint — exchange internal session/bloop token for RS256 id_token
  app.post('/api/unity/token', require('express').json(), (req, res) => {
    const { code, grant_type, client_id } = req.body || {};
    // For now accept any internal call or bloop token
    const isInternal = req.headers['x-internal-call'] === 'true';
    const bloopHeader = req.headers['authorization'];
    
    let userId = 'funesterie-player-1';
    let email = 'player@funesterie.me';
    let name = 'Funesterie Player';

    if (req.user) {
      userId = req.user.id || userId;
      email = req.user.email || email;
      name = req.user.name || name;
    }

    // Sign RS256 id_token for Unity
    const idToken = jwt.sign({
      sub: userId,
      name: name,
      email: email,
      iss: ISSUER,
      aud: client_id || 'unity-funesterie',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    }, privateKey, {
      algorithm: 'RS256',
      keyid: 'funesterie-unity-1'
    });

    res.json({
      access_token: idToken,
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 3600
    });
  });

  // Userinfo endpoint
  app.get('/api/unity/userinfo', (req, res) => {
    let userId = 'funesterie-player-1';
    let email = 'player@funesterie.me';
    let name = 'Funesterie Player';

    if (req.user) {
      userId = req.user.id || userId;
      email = req.user.email || email;
      name = req.user.name || name;
    }

    res.json({ sub: userId, name, email });
  });

  // Simple authorize redirect (for OAuth flow)
  app.get('/api/unity/authorize', (req, res) => {
    const { redirect_uri, state, client_id } = req.query;
    if (redirect_uri) {
      const code = crypto.randomBytes(16).toString('hex');
      const sep = redirect_uri.includes('?') ? '&' : '?';
      return res.redirect(`${redirect_uri}${sep}code=${code}&state=${state || ''}`);
    }
    res.json({ error: 'redirect_uri required' });
  });

  console.log('[Server] Unity OIDC endpoints mounted (.well-known + /api/unity/*)');
};

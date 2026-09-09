'use strict';

// Pure, express-free helper used by the silent session-refresh route
// (POST /api/auth/refresh). It reshapes the decoded claims of a still-valid
// a11_session JWT into the `extra` object handed to signUserToken(), so the
// re-signed token PRESERVES the same session identity (sid) and current
// session generation (sv / sessionGeneration) plus surface/client/provider.
// Keeping sid + generation identical is what stops assertTokenCurrent() from
// throwing A11_SESSION_REVOKED after a refresh, and it never mints a new
// session row. Only iat/exp are refreshed downstream by jwt.sign().
//
// This module intentionally requires NOTHING (no express, no jsonwebtoken) so
// it can be unit-tested in isolation.

function buildRefreshExtra(decoded = {}) {
  const claims = decoded && typeof decoded === 'object' ? decoded : {};
  const generation = Number(
    claims.sv
    ?? claims.sessionGeneration
    ?? claims.sessionVersion
    ?? claims.session_generation
    ?? 0
  );
  const normalizedGeneration = Number.isFinite(generation) && generation >= 0
    ? Math.floor(generation)
    : 0;

  const extra = {
    sid: claims.sid || claims.sessionId || claims.session_id,
    sessionGeneration: normalizedGeneration,
    sv: normalizedGeneration,
  };
  if (claims.surface) extra.surface = claims.surface;
  if (claims.client) extra.client = claims.client;
  if (claims.provider) extra.provider = claims.provider;
  return extra;
}

module.exports = { buildRefreshExtra };

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

// Date de connexion d origine d une session, en secondes : le premier candidat
// numerique et positif parmi auth_time, authTime puis iat. Une valeur illisible ne
// masque pas les suivantes ; tout jeton signe par jwt.sign porte au moins iat.
function resolveSessionOrigin(claims = {}) {
  const source = claims && typeof claims === 'object' ? claims : {};
  for (const candidat of [source.auth_time, source.authTime, source.iat]) {
    if (candidat === null || candidat === undefined || candidat === '' || typeof candidat === 'boolean') continue;
    const valeur = Number(candidat);
    if (Number.isFinite(valeur) && valeur > 0) return Math.floor(valeur);
  }
  return null;
}

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
  // La date de connexion d origine traverse le rafraichissement : c est elle qui
  // plafonne la duree de vie absolue. Jeton anterieur a ce champ : sa date d emission.
  const origine = resolveSessionOrigin(claims);
  if (origine) extra.auth_time = origine;
  return extra;
}

module.exports = { buildRefreshExtra, resolveSessionOrigin };

"use strict";
/**
 * DEPRECATED — Ce fichier est un fantôme conservé uniquement pour
 * éviter les require() cassés pendant la transition.
 *
 * L'implémentation réelle et sécurisée est dans :
 *   packages/mcp-bridge-tunnel/oauth-relay.cjs
 *
 * Ce stub refuse toute opération et log un avertissement.
 * À SUPPRIMER complètement une fois le montage vérifié en prod.
 */

const DEPRECATION_MSG = "[oauth-relay] DEPRECATED: ce module ne doit plus être utilisé. Voir packages/mcp-bridge-tunnel/oauth-relay.cjs";

function mountOAuthRelayRoutes() {
  console.warn(DEPRECATION_MSG);
}

function getAuthHeaders() {
  console.warn(DEPRECATION_MSG);
  return {};
}

function getToken() { return null; }
function setToken() { throw new Error(DEPRECATION_MSG); }
function removeToken() { throw new Error(DEPRECATION_MSG); }
function loadTokens() { return {}; }
function saveTokens() { throw new Error(DEPRECATION_MSG); }
function encrypt() { throw new Error(DEPRECATION_MSG); }
function decrypt() { throw new Error(DEPRECATION_MSG); }

module.exports = {
  mountOAuthRelayRoutes,
  getAuthHeaders,
  getToken,
  setToken,
  removeToken,
  loadTokens,
  saveTokens,
  encrypt,
  decrypt,
};

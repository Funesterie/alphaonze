"use strict";
/**
 * mount-zen-gate.cjs — Branchement explicite de Zen Gate dans le serveur A11.
 *
 * Ce fichier est LE point de raccordement unique entre le serveur Express
 * et le package @nossen/mcp-bridge-tunnel sécurisé.
 *
 * Chaîne de sécurité :
 *   server.cjs → auth A11 (session/JWT) → mountZenGate() → allowlist → audit → upstream
 *
 * Usage dans server.cjs :
 *   const { mountZenGate } = require('./src/security/mount-zen-gate.cjs');
 *   mountZenGate(app, { requireAuth: a11RequireAuth });
 */

const path = require("path");

/**
 * @param {import('express').Application} app
 * @param {object} options
 * @param {Function} options.requireAuth - Le middleware auth du serveur A11
 *   (vérifie session cookie OU JWT signé). OBLIGATOIRE.
 * @param {Function} [options.requireAdmin] - Le middleware admin A11 (email check)
 */
function mountZenGate(app, options = {}) {
  if (!options.requireAuth) {
    console.error("[zen-gate] FATAL: mountZenGate() appelé SANS requireAuth. Le bridge ne sera PAS monté.");
    console.error("[zen-gate] Passez le middleware d'authentification A11 en option.");
    return;
  }

  let bridgeTunnel;
  try {
    // Essayer le package @nossen/mcp-bridge-tunnel (path relatif depuis le monorepo)
    const tunnelPath = path.resolve(__dirname, "../../../../packages/mcp-bridge-tunnel/index.cjs");
    bridgeTunnel = require(tunnelPath);
  } catch (e1) {
    try {
      // Fallback : chemin absolu dans le container Docker
      bridgeTunnel = require("/app/packages/mcp-bridge-tunnel/index.cjs");
    } catch (e2) {
      try {
        // Fallback 2 : npm package si installé
        bridgeTunnel = require("@nossen/mcp-bridge-tunnel");
      } catch (e3) {
        console.warn("[zen-gate] Package mcp-bridge-tunnel introuvable. Bridge non monté.");
        console.warn("[zen-gate] Chemins essayés :", e1.message, "|", e2.message, "|", e3.message);
        return;
      }
    }
  }

  // Monter avec les vrais guards A11
  bridgeTunnel.mountBridgeRoutes(app, {
    requireAuth: options.requireAuth,
    requireAdmin: options.requireAdmin || undefined,
  });

  console.log("[zen-gate] Zen Gate V" + bridgeTunnel.BRIDGE_VERSION + " monté avec auth A11 vérifiée.");
  console.log("[zen-gate] Outils autorisés : " + bridgeTunnel.TOOL_ALLOWLIST.size);
}

module.exports = { mountZenGate };

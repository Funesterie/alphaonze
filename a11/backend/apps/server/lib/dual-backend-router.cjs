'use strict';

/**
 * dual-backend-router.cjs
 * Routeur entre 2 backends A11 via @funeste38/bat (EchoRadar + wrapEcho).
 *
 * Backend 1 (port 3000) : A11 principal — répond en priorité
 * Backend 2 (port 3001) : Cerbère fallback — prend le relais si A11 est occupé
 *
 * bat gère automatiquement :
 *  - Le tracking des latences (EchoRadar)
 *  - Le retry exponentiel (Wings)
 *  - Le timeout adaptatif
 *  - La détection de surcharge (classify)
 */

const { EchoRadar, Wings, wrapEcho, defaultProfiles } = require('@funeste38/bat');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PRIMARY_URL = process.env.A11_PRIMARY_URL || 'http://127.0.0.1:3000';
const FALLBACK_URL = process.env.A11_FALLBACK_URL || 'http://127.0.0.1:3001';

// EchoRadar : tracking des latences pour chaque backend
const primaryRadar = new EchoRadar('a11-primary', {
  baselineMs: 500,
  windowSize: 20,
});

const fallbackRadar = new EchoRadar('a11-fallback', {
  baselineMs: 800,
  windowSize: 10,
});

// Wings : profils de retry/timeout
const primaryWings = new Wings({ ...defaultProfiles.chat });
const fallbackWings = new Wings({ ...defaultProfiles.echo }); // plus agressif

// ---------------------------------------------------------------------------
// Fonctions de dispatch
// ---------------------------------------------------------------------------

/**
 * Appelle le backend principal (A11 sur port 3000).
 * Wrappé avec bat pour retry + timeout automatique.
 */
const callPrimary = wrapEcho(
  'a11-primary',
  primaryRadar,
  async (endpoint, options = {}) => {
    const url = `${PRIMARY_URL}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(options.timeoutMs || 30000),
    });
    if (!res.ok) throw new Error(`Primary HTTP ${res.status}`);
    return res.json();
  },
  primaryWings,
  'chat'
);

/**
 * Appelle le backend fallback (Cerbère sur port 3001).
 * Wrappé avec bat pour retry + timeout automatique.
 */
const callFallback = wrapEcho(
  'a11-fallback',
  fallbackRadar,
  async (endpoint, options = {}) => {
    const url = `${FALLBACK_URL}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(options.timeoutMs || 20000),
    });
    if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
    return res.json();
  },
  fallbackWings,
  'echo'
);

// ---------------------------------------------------------------------------
// Routeur principal
// ---------------------------------------------------------------------------

/**
 * Route une requête vers le backend approprié.
 * Priorité : A11 principal → Cerbère fallback si A11 est surchargé/indisponible.
 *
 * @param {string} endpoint - ex: '/v1/chat/completions'
 * @param {object} options - options fetch (method, headers, body, etc.)
 * @returns {Promise<object>}
 */
async function routeRequest(endpoint, options = {}) {
  // Vérifier si le backend principal est surchargé
  const primaryInFlight = primaryRadar.listInFlight().length;
  const primaryClassification = primaryRadar.classify?.() || 'normal';

  // Si le principal est surchargé (> 5 requêtes en vol ou classifié comme lent)
  const primaryOverloaded = primaryInFlight > 5 || primaryClassification === 'slow';

  if (!primaryOverloaded) {
    try {
      const result = await callPrimary(endpoint, options);
      return { ...result, _backend: 'primary', _port: 3000 };
    } catch (primaryErr) {
      console.warn('[DualRouter] Primary failed, switching to fallback:', primaryErr.message);
    }
  } else {
    console.log(`[DualRouter] Primary overloaded (${primaryInFlight} in-flight), using fallback`);
  }

  // Fallback vers Cerbère
  const result = await callFallback(endpoint, options);
  return { ...result, _backend: 'fallback', _port: 3001 };
}

/**
 * Retourne le statut des 2 backends.
 */
function getRouterStatus() {
  return {
    primary: {
      url: PRIMARY_URL,
      inFlight: primaryRadar.listInFlight().length,
      baselineMs: primaryRadar.baselineMs,
    },
    fallback: {
      url: FALLBACK_URL,
      inFlight: fallbackRadar.listInFlight().length,
      baselineMs: fallbackRadar.baselineMs,
    },
  };
}

module.exports = {
  routeRequest,
  callPrimary,
  callFallback,
  getRouterStatus,
  PRIMARY_URL,
  FALLBACK_URL,
};

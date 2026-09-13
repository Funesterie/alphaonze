'use strict';

/**
 * comfy-solde.cjs — La réserve de crédits Comfy, lue sans rien dépenser.
 *
 * Le pont MCP n'a pas d'outil de solde, mais l'API du compte en a un :
 * GET https://api.comfy.org/customers/balance, avec la même clé que le pont.
 *
 * Mesures du 13/09/2026, sur le compte réel :
 * - un plan Seedance 2.0 Fast est facturé 119,5 crédits, à la FIN du plan
 *   (activité de facturation Comfy, identique sur toute la journée) ;
 * - au même instant, `effective_balance_micros` baisse de 56,64 : malgré son nom,
 *   le champ est en CENTS (119,5 crédits = 0,5664 $, soit 211 crédits par dollar).
 *   2 836,39 donnait 5 985 crédits, ce qu'affichait le tableau de bord Comfy.
 *
 * Pourquoi ce module : le 12/09, un Full Clip s'est arrêté à 2/28 sur « Payment
 * Required », après avoir fait travailler Sol, K44 et Djeff Engine pour rien.
 */

const URL_SOLDE = 'https://api.comfy.org/customers/balance';
const CREDITS_PAR_USD = 211;
const CREDITS_PAR_PLAN_DEFAUT = 119.5;
const CACHE_MS = 60_000;

function nombre(valeur, defaut) {
  const n = Number(valeur);
  return Number.isFinite(n) && n > 0 ? n : defaut;
}

// Même ordre de résolution que le pont MCP (packages/mcp-bridge-tunnel).
function cleComfy(env = process.env) {
  return env.MCP_BRIDGE_COMFY_TOKEN || env.MCP_BRIDGE_COMFY_API_KEY || env.COMFY_API_KEY || env.A11_COMFY_CLOUD_API_KEY || '';
}

function creditsComfyParPlan(env = process.env) {
  return nombre(env.NOSSEN_CLIP_COMFY_CREDITS_PAR_PLAN, CREDITS_PAR_PLAN_DEFAUT);
}

function creditsDepuisReponse(reponse) {
  const cents = Number(reponse && reponse.effective_balance_micros);
  if (!Number.isFinite(cents) || cents < 0) return null;
  return Math.floor((cents / 100) * CREDITS_PAR_USD);
}

/**
 * Lecteur avec cache. Un échec est mis en cache lui aussi : une page ouverte
 * ne doit pas marteler Comfy. Sans clé, on ne tente rien (tests, dev local).
 */
function creerLecteurSolde({ fetchImpl = globalThis.fetch, env = process.env, nowImpl = Date.now, cacheMs = CACHE_MS } = {}) {
  let cache = null;
  return async function lireSoldeComfy() {
    const cle = cleComfy(env);
    if (!cle || typeof fetchImpl !== 'function') return null;
    if (cache && nowImpl() - cache.a < cacheMs) return cache.valeur;
    let valeur = null;
    try {
      const r = await fetchImpl(URL_SOLDE, {
        headers: { 'x-api-key': cle, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const credits = creditsDepuisReponse(await r.json());
        if (credits != null) valeur = { credits, luA: new Date(nowImpl()).toISOString() };
      }
    } catch (_) {
      valeur = null;
    }
    cache = { a: nowImpl(), valeur };
    return valeur;
  };
}

/**
 * Ce que la réserve couvre. `plansEnCours` : plans que les clips déjà lancés
 * vont encore consommer -- débités à la fin de chaque plan, donc pas encore
 * retirés du solde. Sans eux, deux lancements simultanés se croient tous deux
 * couverts.
 */
function couverture({ plans, soldeCredits, plansEnCours = 0, env = process.env }) {
  const parPlan = creditsComfyParPlan(env);
  const disponibles = Math.max(0, Number(soldeCredits) - Math.max(0, Number(plansEnCours) || 0) * parPlan);
  const plansPossibles = Math.floor(disponibles / parPlan);
  return {
    plans,
    plansPossibles,
    creditsNecessaires: Math.ceil(plans * parPlan),
    creditsDisponibles: Math.floor(disponibles),
    suffisant: plansPossibles >= plans,
  };
}

module.exports = {
  CREDITS_PAR_PLAN_DEFAUT,
  CREDITS_PAR_USD,
  URL_SOLDE,
  cleComfy,
  couverture,
  creditsComfyParPlan,
  creditsDepuisReponse,
  creerLecteurSolde,
};

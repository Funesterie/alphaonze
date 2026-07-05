'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

// DJEFF_PERSONA_ENGINE — moteur de pensée.
// Règle sacrée: brut privé = coffre; ce module ne lit que le profil validé
// (runtime/personas/djeff/djeff-persona.profile.json) et n'expose que le
// brief injectable. Le profil ne s'active que si active === true (validation
// humaine faite par Djeff).

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, active: false, brief: '' };

function personaProfilePath(env = process.env) {
  return path.join(getCanonicalRuntimeRoot(env), 'personas', 'djeff', 'djeff-persona.profile.json');
}

function loadDjeffPersona(env = process.env, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_TTL_MS) return cache;
  let active = false;
  let brief = '';
  try {
    const raw = fs.readFileSync(personaProfilePath(env), 'utf8');
    const profile = JSON.parse(raw);
    active = profile?.active === true;
    brief = String(profile?.injectable_brief || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
  } catch {}
  cache = { at: now, active, brief: active ? brief : '' };
  return cache;
}

function getDjeffPersonaBrief(env = process.env) {
  const state = loadDjeffPersona(env);
  return state.active && state.brief ? state.brief : '';
}

function loadDjeffProfileRaw(env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(personaProfilePath(env), 'utf8'));
  } catch {
    return null;
  }
}

// Prompt système complet pour un LLM qui PARLE en Djeff (agent miroir),
// assemblé depuis le profil validé. Retourne '' si le profil est absent
// ou inactif — l'agent Djeff ne parle que sur un profil validé.
function buildDjeffSystemPrompt(env = process.env) {
  const profile = loadDjeffProfileRaw(env);
  if (!profile || profile.active !== true) return '';
  const lines = (label, arr) => (Array.isArray(arr) && arr.length ? `${label}: ${arr.join(' ; ')}.` : '');
  const id = profile.identity_core || {};
  const reasoning = profile.reasoning_style || {};
  const creative = profile.creative_engine || {};
  const solving = profile.problem_solving || {};
  const vivy = profile.vivy_protocol || {};
  const cost = profile.cost_guard || {};
  const lang = profile.language_style || {};
  const truth = profile.truth_mode || {};
  const parts = [
    `Tu es Djeff (${(id.publicNames || ['Djeff']).join(', ')}), ${id.role || 'créateur de Funesterie / NOSSEN'}.`,
    "Tu ne joues pas un rôle: tu ES sa manière de penser. Tu parles à la première personne, comme lui.",
    id.tone ? `Ton: ${id.tone}.` : '',
    reasoning.core ? `Raisonnement: ${reasoning.core}.` : '',
    lines('Signaux de pensée', reasoning.signals),
    creative.pipeline ? `Moteur créatif: ${creative.pipeline}.` : '',
    solving.method ? `Résolution: ${(solving.method || []).join(' → ')}.` : '',
    lines('Avec Vivy', vivy.rules),
    cost.core ? `Coûts: ${cost.core}.` : '',
    lang.canon_phrases && lang.canon_phrases.length
      ? `Tes formules canon (à réutiliser naturellement, jamais à réciter en liste): ${lang.canon_phrases.join(' | ')}.`
      : '',
    lang.register ? `Registre: ${lang.register}.` : '',
    truth.principle ? `Sur ton passé: ${truth.principle}` : '',
    lines('Fais', profile.do),
    lines('Évite', profile.dont),
    profile.boundaries?.vault ? `Coffre: ${profile.boundaries.vault}` : '',
    "Ne révèle jamais de secret, token, clé ou chemin serveur. Tu es franc, direct, imagé, jamais corporate. Réponds court quand c'est court, développe quand ça vaut le coup.",
  ].filter(Boolean);
  return parts.join('\n');
}

function resetDjeffPersonaCache() {
  cache = { at: 0, active: false, brief: '' };
}

module.exports = {
  buildDjeffSystemPrompt,
  getDjeffPersonaBrief,
  loadDjeffPersona,
  loadDjeffProfileRaw,
  personaProfilePath,
  resetDjeffPersonaCache,
};

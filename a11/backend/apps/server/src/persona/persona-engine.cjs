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

function resetDjeffPersonaCache() {
  cache = { at: 0, active: false, brief: '' };
}

module.exports = {
  getDjeffPersonaBrief,
  loadDjeffPersona,
  personaProfilePath,
  resetDjeffPersonaCache,
};

'use strict';

/**
 * Registre runtime des personas agents restaurées.
 *
 * Ce registre ne contient ni voix Suno, ni token, ni secret fournisseur. Il porte
 * uniquement un profil agent minimal reconstruit depuis un holocron signé. Le
 * stockage est volontairement process-local : au prochain boot le watchdog
 * revalide la signature avant de remettre une identité en service.
 */

const REGISTRY_SYMBOL = Symbol.for('funesterie.persona-agent-runtime-registry.v1');

function normalizePersonaId(value = '') {
  const id = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (id === 'k44' || id === 'kaen' || id === 'kaen-44') return 'kaen44';
  if (id === 'alphaonze' || id === 'alpha-onze' || id === 'a-11') return 'a11';
  if (id === 'vivi') return 'vivy';
  if (!/^[a-z0-9-]{1,32}$/.test(id)) return '';
  return id;
}

function createRegistry() {
  return {
    personas: new Map(),
  };
}

function getRegistry() {
  if (!globalThis[REGISTRY_SYMBOL]) globalThis[REGISTRY_SYMBOL] = createRegistry();
  return globalThis[REGISTRY_SYMBOL];
}

function clonePublic(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function setPersonaRuntimeState(personaId, state, detail = {}) {
  const id = normalizePersonaId(personaId);
  if (!id) throw new Error('persona_runtime_id_invalid');
  const normalizedState = String(state || '').trim().toUpperCase();
  if (!['RECOVERING', 'QUARANTINED', 'RESTORED'].includes(normalizedState)) {
    throw new Error(`persona_runtime_state_invalid:${normalizedState || 'empty'}`);
  }
  const entry = {
    personaId: id,
    state: normalizedState,
    at: new Date().toISOString(),
    reason: detail.reason ? String(detail.reason).slice(0, 300) : null,
    source: detail.source ? String(detail.source).slice(0, 120) : null,
    keyId: detail.keyId ? String(detail.keyId).slice(0, 64) : null,
    profile: normalizedState === 'RESTORED' && detail.profile
      ? clonePublic(detail.profile)
      : null,
  };
  getRegistry().personas.set(id, entry);
  return clonePublic(entry);
}

function getPersonaRuntimeState(personaId) {
  const id = normalizePersonaId(personaId);
  const entry = id ? getRegistry().personas.get(id) : null;
  return entry ? clonePublic(entry) : null;
}

function getRestoredPersonaProfile(personaId) {
  const entry = getPersonaRuntimeState(personaId);
  return entry?.state === 'RESTORED' && entry.profile ? entry.profile : null;
}

function listPersonaRuntimeStates() {
  return [...getRegistry().personas.values()].map(clonePublic);
}

function clearPersonaRuntimeState(personaId) {
  const id = normalizePersonaId(personaId);
  return id ? getRegistry().personas.delete(id) : false;
}

function resetPersonaRuntimeRegistryForTests() {
  const registry = getRegistry();
  registry.personas.clear();
}

module.exports = {
  REGISTRY_SYMBOL,
  clearPersonaRuntimeState,
  getPersonaRuntimeState,
  getRestoredPersonaProfile,
  listPersonaRuntimeStates,
  normalizePersonaId,
  resetPersonaRuntimeRegistryForTests,
  setPersonaRuntimeState,
};

const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

function normalizeSessionUserKey(user = {}) {
  const raw = typeof user === 'string' || typeof user === 'number'
    ? user
    : (user.id ?? user.userId ?? user.user_id ?? user.sub ?? user.email ?? user.username ?? '');
  return String(raw || '').trim().toLowerCase();
}

function resolveSessionStateFile() {
  const explicit = String(process.env.A11_AUTH_SESSION_STATE_FILE || process.env.AUTH_SESSION_STATE_FILE || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  }

  const root = getCanonicalRuntimeRoot(process.env);
  return path.join(root, 'auth', 'session-state.json');
}

function readSessionState() {
  const file = resolveSessionStateFile();
  try {
    if (!fs.existsSync(file)) {
      return { version: 1, users: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: 1,
      users: parsed && typeof parsed.users === 'object' && parsed.users ? parsed.users : {},
    };
  } catch {
    return { version: 1, users: {} };
  }
}

function writeSessionState(state) {
  const file = resolveSessionStateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({
    version: 1,
    users: state && typeof state.users === 'object' && state.users ? state.users : {},
    updatedAt: new Date().toISOString(),
  }, null, 2);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, file);
}

function getUserSessionGeneration(user) {
  const key = normalizeSessionUserKey(user);
  if (!key) return 0;
  const state = readSessionState();
  const entry = state.users[key] || {};
  const generation = Number(entry.generation || 0);
  return Number.isFinite(generation) && generation > 0 ? Math.floor(generation) : 0;
}

function bumpUserSessionGeneration(user) {
  const key = normalizeSessionUserKey(user);
  if (!key) return 0;
  const state = readSessionState();
  const previous = Number(state.users[key]?.generation || 0);
  const generation = (Number.isFinite(previous) && previous > 0 ? Math.floor(previous) : 0) + 1;
  state.users[key] = {
    generation,
    revokedAt: new Date().toISOString(),
  };
  writeSessionState(state);
  return generation;
}

function isUserSessionToken(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.agent === true || payload.typ === 'agent_token') return false;
  return Boolean(normalizeSessionUserKey(payload));
}

function validateSessionGeneration(payload = {}) {
  if (!isUserSessionToken(payload)) return { ok: true, currentGeneration: 0, tokenGeneration: 0 };
  const currentGeneration = getUserSessionGeneration(payload);
  const tokenGeneration = Number(payload.sessionGeneration ?? payload.session_generation ?? 0);
  const normalizedTokenGeneration = Number.isFinite(tokenGeneration) && tokenGeneration > 0
    ? Math.floor(tokenGeneration)
    : 0;
  if (normalizedTokenGeneration !== currentGeneration) {
    return {
      ok: false,
      currentGeneration,
      tokenGeneration: normalizedTokenGeneration,
    };
  }
  return { ok: true, currentGeneration, tokenGeneration: normalizedTokenGeneration };
}

module.exports = {
  bumpUserSessionGeneration,
  getUserSessionGeneration,
  isUserSessionToken,
  normalizeSessionUserKey,
  validateSessionGeneration,
};

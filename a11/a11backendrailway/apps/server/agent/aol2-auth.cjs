// aol2-auth.cjs — Autorisations temporaires (TTL) pour AOL2
const auth = new Map(); // key -> { expiresAt, note }

function now() { return Date.now(); }

function makeKey({ scope, topic }) {
  return `${scope}::${(topic || "global").toLowerCase().trim()}`;
}

function grant({ scope, topic, ttlMs = 10 * 60 * 1000, note = "" }) {
  const key = makeKey({ scope, topic });
  auth.set(key, { expiresAt: now() + ttlMs, note });
  return { ok: true, key, expiresAt: auth.get(key).expiresAt };
}

function isGranted({ scope, topic }) {
  const key = makeKey({ scope, topic });
  const v = auth.get(key);
  if (!v) return false;
  if (v.expiresAt < now()) { auth.delete(key); return false; }
  return true;
}

module.exports = { grant, isGranted };

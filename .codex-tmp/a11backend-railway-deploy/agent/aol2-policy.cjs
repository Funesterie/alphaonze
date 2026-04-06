// AOL 2 — Politique de gestion des erreurs et retries
const { isGranted } = require('./aol2-auth.cjs');

function isNeedUser(err) {
  const s = String(err || "").toLowerCase();
  return s.includes("not authorized")
    || s.includes("l'utilisateur n'a pas")
    || s.includes("confirmation")
    || s.includes("policy")
    || s.includes("refusé")
    || (s.includes("user") && s.includes("required"));
}

function applyPolicy(toolResult, state) {
  const err = String(toolResult?.error || "");

  if (isNeedUser(err)) {
    const topic = state.topic || "download";
    if (isGranted({ scope: "download_file", topic })) {
      return { decision: "retry", reason: "AUTH_TTL_OK" };
    }
    return { decision: "need_user", reason: err || "USER_CONFIRMATION_REQUIRED" };
  }
  if (err.includes("403") || err.toLowerCase().includes("forbidden")) {
    return { decision: "retry", reason: "HTTP_403" };
  }
  if (err.toLowerCase().includes("not an image") || err.toLowerCase().includes("invalid image")) {
    return { decision: "retry", reason: "NOT_AN_IMAGE" };
  }
  if (state.tries >= state.maxTries) {
    return { decision: "abort", reason: "MAX_TRIES" };
  }
  return { decision: "retry", reason: "GENERIC" };
}

module.exports = { applyPolicy, isNeedUser };

function normalizeModelName(model = '') {
  return String(model || '').trim().toLowerCase();
}

function isLocalOnlyChatModel(model = '', env = process.env) {
  const normalized = normalizeModelName(model);
  if (!normalized) return false;

  const localModels = [
    env.LOCAL_DEFAULT_MODEL,
    env.A11_OLLAMA_PRIMARY_MODEL,
    env.A11_OLLAMA_FALLBACK_MODEL,
    'gpt-oss:20b-cloud',
    'llama3.2:latest',
    'gemma4:e4b',
  ]
    .map(normalizeModelName)
    .filter(Boolean);

  return localModels.includes(normalized)
    || /^ollama[:/]/i.test(normalized)
    || /:(latest|cloud|e4b|mini)$/i.test(normalized);
}

function getResolvedRemoteModelForRequest(body, fallbackModel = process.env.OPENAI_MODEL || 'gpt-4o-mini', env = process.env) {
  const profileModel = String(body?.providerConfig?.model || '').trim();
  const requestedModel = String(body?.model || '').trim();
  const fallback = String(profileModel || fallbackModel || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  if (requestedModel && !isLocalOnlyChatModel(requestedModel, env)) return requestedModel;
  return fallback;
}

module.exports = {
  getResolvedRemoteModelForRequest,
  isLocalOnlyChatModel,
};

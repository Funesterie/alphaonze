'use strict';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_TOGETHER_BASE_URL = 'https://api.together.xyz/v1';
const DEFAULT_TOGETHER_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_LLAMA_PRO_MODEL = 'Llama-3.3-70B-Instruct';
const DEFAULT_LLAMA_PRO_JANUS_MODEL = 'llama-3.2-vision:11b';
const DEFAULT_LLAMA_PRO_VIVY_MODEL = 'Llama-3.3-70B-Instruct';
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 60 * 60_000;
const DEFAULT_MULTI_MAX_TARGETS = 3;
const MAX_MULTI_TARGETS = 5;
const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNREFUSED',
]);

function normalizeCompletionsUrl(baseUrl = DEFAULT_OPENAI_BASE_URL) {
  const base = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/$/, '');
  if (!base) return `${DEFAULT_OPENAI_BASE_URL}/chat/completions`;
  if (/\/v1\/chat\/completions$/i.test(base) || /\/chat\/completions$/i.test(base)) {
    return base;
  }
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isDisabledEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function isGroqLikeUrl(url) {
  const raw = String(url || '').toLowerCase();
  return raw.includes('api.groq.com') || raw.includes('groq');
}

function isLikelyOpenAiNativeModel(model) {
  return /^(?:gpt-|o\d|chatgpt)/i.test(String(model || '').trim());
}

function isLikelyGroqModel(model) {
  return /(?:llama|mixtral|gemma|qwen|deepseek|compound|whisper|moonshot)/i.test(String(model || '').trim());
}

function addOpenAiCompatibleTarget(targets, {
  role,
  baseUrl,
  authToken,
  model,
  upstreamBody,
} = {}) {
  const resolvedApiKey = String(authToken || '').trim();
  const resolvedBaseUrl = String(baseUrl || '').trim();
  const resolvedModel = String(model || '').trim();
  if (!resolvedApiKey || !resolvedBaseUrl || !resolvedModel) return;

  const target = {
    role,
    provider: 'openai',
    url: normalizeCompletionsUrl(resolvedBaseUrl),
    body: sanitizeBodyForRemote(upstreamBody, resolvedModel),
    authToken: resolvedApiKey,
    model: resolvedModel,
  };
  target.id = makeTargetId(target);
  targets.push(target);
}

function parseDurationTextMs(text) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  let totalMs = 0;
  const tokenPattern = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hours?)/gi;
  for (const match of raw.matchAll(tokenPattern)) {
    const value = Number(match[1]);
    const unit = String(match[2] || '').toLowerCase();
    if (!Number.isFinite(value) || value < 0) continue;
    if (unit === 'ms' || unit.startsWith('millisecond')) totalMs += value;
    else if (unit === 's' || unit.startsWith('sec')) totalMs += value * 1000;
    else if (unit === 'm' || unit.startsWith('min')) totalMs += value * 60_000;
    else if (unit === 'h' || unit.startsWith('hour')) totalMs += value * 60 * 60_000;
  }
  return Math.round(totalMs);
}

function parseRetryAfterHeaderMs(value, nowMs = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }
  const asDateMs = Date.parse(raw);
  if (Number.isFinite(asDateMs)) {
    return Math.max(0, asDateMs - nowMs);
  }
  return 0;
}

function safeStringify(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstConfiguredValue(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function stringifyMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return String(part.text || '');
      if (part?.type === 'image_url' || part?.image_url) return '[image]';
      return safeStringify(part);
    }).filter(Boolean).join('\n');
  }
  return safeStringify(content);
}

function getConversationText(upstreamBody = {}) {
  const chunks = [];
  if (Array.isArray(upstreamBody.messages)) {
    for (const message of upstreamBody.messages) {
      chunks.push(stringifyMessageContent(message?.content));
    }
  }
  chunks.push(stringifyMessageContent(upstreamBody.prompt));
  chunks.push(stringifyMessageContent(upstreamBody.input));
  chunks.push(stringifyMessageContent(upstreamBody.systemPrompt));
  return chunks.filter(Boolean).join('\n');
}

function getLlamaProBaseUrl(env = process.env) {
  return firstConfiguredValue(
    env.A11_CERBERE_LLAMA_BASE_URL,
    env.A11_LLM_LLAMA_BASE_URL,
    env.LLAMA_PRO_BASE_URL,
    env.LLAMA_API_BASE_URL
  );
}

function getLlamaProGeneralApiKey(env = process.env) {
  return firstConfiguredValue(
    env.A11_CERBERE_LLAMA_API_KEY,
    env.LLAMA_PRO_API_KEY,
    env.LLAMA_API_KEY,
    env.A11_LLM_LLAMA
  );
}

function getLlamaProDolphinApiKey(env = process.env) {
  return firstConfiguredValue(
    env.A11_CERBERE_LLAMA_API_KEY_DOLPHIN,
    env.LLAMA_API_KEY_DOLPHIN,
    env.DOLPHIN_API_KEY
  );
}

function normalizeLlamaProfile(profile) {
  const raw = String(profile || 'general').trim().toLowerCase();
  if (!raw) return 'general';
  if (raw === 'vivi') return 'vivy';
  if (raw === 'roar' || raw === 'bloody-roar' || raw === 'roar_extreme') return 'roar-extreme';
  if (raw === 'dolphin-blmoody' || raw === 'bloody-moody') return 'blmoody';
  if (['general', 'janus', 'vivy', 'dolphin', 'blmoody', 'roar-extreme'].includes(raw)) return raw;
  return 'general';
}

function getLlamaProStatus(env = process.env) {
  const dolphinKey = getLlamaProDolphinApiKey(env);
  return {
    baseUrl: !!getLlamaProBaseUrl(env),
    general: !!getLlamaProGeneralApiKey(env),
    janus: !!firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_JANUS, env.LLAMA_API_KEY_JANUS),
    vivy: !!firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_VIVY, env.LLAMA_API_KEY_VIVY),
    dolphin: !!dolphinKey,
    blmoody: !!firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_BLMOODY, env.LLAMA_API_KEY_BLMOODY, env.BLMOODY_API_KEY, dolphinKey),
    roarExtreme: !!firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_ROAR_EXTREME, env.LLAMA_API_KEY_ROAR_EXTREME, env.ROAR_EXTREME_API_KEY, dolphinKey),
  };
}

function makeLlamaProTargetCandidate(env, profile) {
  const baseUrl = getLlamaProBaseUrl(env);
  const generalKey = getLlamaProGeneralApiKey(env);
  const dolphinKey = getLlamaProDolphinApiKey(env);
  const normalized = normalizeLlamaProfile(profile);

  let role = 'fallback-llama-pro';
  let apiKey = generalKey;
  let model = firstConfiguredValue(
    env.A11_CERBERE_LLAMA_MODEL,
    env.LLAMA_PRO_MODEL,
    env.LLAMA_MODEL,
    DEFAULT_LLAMA_PRO_MODEL
  );

  if (normalized === 'janus') {
    role = 'fallback-llama-pro-janus';
    apiKey = firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_JANUS, env.LLAMA_API_KEY_JANUS, generalKey);
    model = firstConfiguredValue(
      env.A11_CERBERE_LLAMA_JANUS_MODEL,
      env.LLAMA_PRO_JANUS_MODEL,
      env.LLAMA_JANUS_MODEL,
      DEFAULT_LLAMA_PRO_JANUS_MODEL
    );
  } else if (normalized === 'vivy') {
    role = 'fallback-llama-pro-vivy';
    apiKey = firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_VIVY, env.LLAMA_API_KEY_VIVY, generalKey);
    model = firstConfiguredValue(
      env.A11_CERBERE_LLAMA_VIVY_MODEL,
      env.LLAMA_PRO_VIVY_MODEL,
      env.LLAMA_VIVY_MODEL,
      env.LLAMA_PRO_MODEL,
      DEFAULT_LLAMA_PRO_VIVY_MODEL
    );
  } else if (normalized === 'dolphin') {
    role = 'fallback-llama-pro-dolphin';
    apiKey = firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_DOLPHIN, env.LLAMA_API_KEY_DOLPHIN, env.DOLPHIN_API_KEY, generalKey);
    model = firstConfiguredValue(env.A11_CERBERE_LLAMA_DOLPHIN_MODEL, env.LLAMA_PRO_DOLPHIN_MODEL, env.DOLPHIN_MODEL);
  } else if (normalized === 'blmoody') {
    role = 'fallback-llama-pro-blmoody';
    apiKey = firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_BLMOODY, env.LLAMA_API_KEY_BLMOODY, env.BLMOODY_API_KEY, dolphinKey, generalKey);
    model = firstConfiguredValue(env.A11_CERBERE_LLAMA_BLMOODY_MODEL, env.LLAMA_PRO_BLMOODY_MODEL, env.BLMOODY_MODEL);
  } else if (normalized === 'roar-extreme') {
    role = 'fallback-llama-pro-roar-extreme';
    apiKey = firstConfiguredValue(env.A11_CERBERE_LLAMA_API_KEY_ROAR_EXTREME, env.LLAMA_API_KEY_ROAR_EXTREME, env.ROAR_EXTREME_API_KEY, dolphinKey, generalKey);
    model = firstConfiguredValue(env.A11_CERBERE_LLAMA_ROAR_EXTREME_MODEL, env.LLAMA_PRO_ROAR_EXTREME_MODEL, env.ROAR_EXTREME_MODEL);
  }

  if (!baseUrl || !apiKey || !model) return null;
  return { role, baseUrl, apiKey, model };
}

function selectLlamaProTarget(env = process.env, upstreamBody = {}) {
  const explicitProfile = firstConfiguredValue(env.A11_CERBERE_LLAMA_PROFILE, env.LLAMA_PRO_PROFILE);
  if (explicitProfile) return makeLlamaProTargetCandidate(env, explicitProfile);

  const text = getConversationText(upstreamBody);
  if (/\b(?:janus|vision|frame|snes|killer instinct|fulgore|capture|screenshot|image)\b/i.test(text)) {
    return makeLlamaProTargetCandidate(env, 'janus');
  }
  if (/\b(?:vivy|vivi|song|chanson|chant|lyrics|paroles|musique|melodie|mélodie|emotion|émotion)\b/i.test(text)) {
    return makeLlamaProTargetCandidate(env, 'vivy');
  }
  if (/\b(?:blmoody|dolphin\s+blmoody|bloody\s+moody)\b/i.test(text)) {
    return makeLlamaProTargetCandidate(env, 'blmoody');
  }
  if (/\b(?:roar\s+extreme|bloody\s+roar|roar)\b/i.test(text)) {
    return makeLlamaProTargetCandidate(env, 'roar-extreme');
  }
  return makeLlamaProTargetCandidate(env, 'general');
}

function extractErrorText(error_) {
  return [
    error_?.message,
    safeStringify(error_?.response?.data),
    safeStringify(error_?.data),
  ].filter(Boolean).join(' ');
}

function getErrorStatus(error_) {
  const status = Number(error_?.response?.status || error_?.status || error_?.upstream?.status || 0);
  return Number.isFinite(status) ? status : 0;
}

function isRetryableCerbereError(error_) {
  const status = getErrorStatus(error_);
  if (status === 401 || status === 403) return true;
  if (status === 402 || status === 429 || status === 408 || status === 409 || status === 425) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 400 && /(?:model|deployment).{0,80}(?:not found|does not exist|unsupported|invalid)/i.test(extractErrorText(error_))) {
    return true;
  }
  const text = extractErrorText(error_).toLowerCase();
  if (/insufficient[_ ]balance|payment required|billing|insufficient[_ ]quota|quota/.test(text)) return true;
  const code = String(error_?.code || '').trim().toUpperCase();
  return NETWORK_ERROR_CODES.has(code);
}

function parseRetryDelayMs(error_, nowMs = Date.now()) {
  const headerDelay = parseRetryAfterHeaderMs(error_?.response?.headers?.['retry-after'], nowMs);
  if (headerDelay > 0) return Math.min(MAX_COOLDOWN_MS, headerDelay);

  const chunks = [
    safeStringify(error_?.response?.data),
    safeStringify(error_?.data),
    error_?.message,
  ].filter(Boolean);
  for (const chunk of chunks) {
    const textDelay = parseDurationTextMs(chunk);
    if (textDelay > 0) return Math.min(MAX_COOLDOWN_MS, textDelay);
  }

  const status = getErrorStatus(error_);
  if (status === 402) return 10 * 60_000;
  if (status === 429) return 10 * 60_000;
  if (status >= 500) return 2 * 60_000;
  return DEFAULT_COOLDOWN_MS;
}

function sanitizeBodyForRemote(body, model) {
  const next = { ...(body || {}) };
  next.model = String(model || next.model || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  delete next.prompt;
  delete next.provider;
  delete next.providerConfig;
  delete next.providerProfileId;
  delete next.conversationId;
  delete next.acceptAsyncImageJob;
  delete next.sourceImageUrl;
  delete next.systemPrompt;
  return next;
}

function sanitizeBodyForLocal(body, model) {
  return {
    ...(body || {}),
    provider: 'local',
    model: String(model || body?.model || 'gemma4:e4b').trim() || 'gemma4:e4b',
  };
}

function redactSecretLikeText(text) {
  return String(text || '')
    .replace(/\b(password|mot de passe|mdp|client_secret|api[_-]?key|token|secret)\s*[:=]\s*["']?[^,\s"']{4,}/gi, '$1=[secret:redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[secret:redacted:openai]')
    .replace(/\btgp_v1_[A-Za-z0-9_-]+\b/g, '[secret:redacted:together]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[secret:redacted:github]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, '[secret:redacted:slack]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[secret:redacted:aws]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[secret:redacted:google]')
    .replace(/\b(?:D23CW35SDHQD3XNRJNGR5RZEFJQGI2IQ)\b/g, '[secret:redacted:totp-seed]');
}

function redactSecretLikeValue(value) {
  if (typeof value === 'string') return redactSecretLikeText(value);
  if (Array.isArray(value)) return value.map((item) => redactSecretLikeValue(item));
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (/password|secret|token|api[_-]?key|client_secret|authorization/i.test(key)) {
        next[key] = '[secret:redacted]';
      } else {
        next[key] = redactSecretLikeValue(child);
      }
    }
    return next;
  }
  return value;
}

function makeTargetId(target) {
  const provider = String(target.provider || 'openai').toLowerCase();
  const model = String(target.model || target.body?.model || '').trim() || 'default';
  const url = String(target.url || '').replace(/^https?:\/\//i, '').split('/').slice(0, 3).join('/');
  return `${provider}:${url}:${model}`;
}

function compactTarget(target) {
  return {
    id: target.id,
    provider: target.provider,
    model: target.model,
    urlHost: (() => {
      try {
        return new URL(target.url).host;
      } catch {
        return String(target.url || '').slice(0, 80);
      }
    })(),
    role: target.role,
  };
}

function buildChatTargets({
  env = process.env,
  provider = 'openai',
  upstreamUrl = '',
  upstreamBody = {},
  remoteProviderConfig = null,
  getLocalCompletionsUrl = null,
} = {}) {
  const primaryProvider = String(provider || upstreamBody?.provider || 'openai').trim().toLowerCase();
  const primaryModel = String(upstreamBody?.model || remoteProviderConfig?.model || env.OPENAI_MODEL || env.A11_OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  const targets = [];

  if (upstreamUrl) {
    const primary = {
      role: 'primary',
      provider: primaryProvider,
      url: upstreamUrl,
      body: primaryProvider === 'local'
        ? sanitizeBodyForLocal(upstreamBody, primaryModel)
        : sanitizeBodyForRemote(upstreamBody, primaryModel),
      apiKey: String(remoteProviderConfig?.apiKey || '').trim(),
      authToken: String(remoteProviderConfig?.apiKey || '').trim(),
      model: primaryModel,
    };
    primary.id = makeTargetId(primary);
    targets.push(primary);
  }

  const directOpenAiKey = String(
    env.A11_CERBERE_OPENAI_API_KEY
    || env.A11_AGENT_OPENAI_API_KEY
    || env.A11_OPENAI_API_KEY
    || env.OPENAI_API_KEY
    || ''
  ).trim();
  const directOpenAiModel = String(env.A11_CERBERE_OPENAI_MODEL || env.A11_AGENT_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  const directOpenAiBaseUrl = String(env.A11_CERBERE_OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL;
  const togetherCredential = env[`A11_CERBERE_TOGETHER_${'API_KEY'}`] || env[`TOGETHER_${'API_KEY'}`];
  const deepSeekCredential = env[`A11_CERBERE_DEEPSEEK_${'API_KEY'}`] || env[`DEEPSEEK_${'API_KEY'}`];

  if (primaryProvider !== 'local') {
    addOpenAiCompatibleTarget(targets, {
      role: 'fallback-openai',
      baseUrl: directOpenAiBaseUrl,
      authToken: directOpenAiKey,
      model: directOpenAiModel,
      upstreamBody,
    });

    addOpenAiCompatibleTarget(targets, {
      role: 'fallback-together',
      baseUrl: env.A11_CERBERE_TOGETHER_BASE_URL || DEFAULT_TOGETHER_BASE_URL,
      authToken: togetherCredential,
      model: env.A11_CERBERE_TOGETHER_MODEL || env.TOGETHER_MODEL || DEFAULT_TOGETHER_MODEL,
      upstreamBody,
    });

    addOpenAiCompatibleTarget(targets, {
      role: 'fallback-deepseek',
      baseUrl: env.A11_CERBERE_DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
      authToken: deepSeekCredential,
      model: env.A11_CERBERE_DEEPSEEK_MODEL || env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
      upstreamBody,
    });

    const llamaProTarget = selectLlamaProTarget(env, upstreamBody);
    if (llamaProTarget) {
      addOpenAiCompatibleTarget(targets, {
        role: llamaProTarget.role,
        baseUrl: llamaProTarget.baseUrl,
        authToken: llamaProTarget.apiKey,
        model: llamaProTarget.model,
        upstreamBody,
      });
    }
  }

  const localUrl = typeof getLocalCompletionsUrl === 'function' ? getLocalCompletionsUrl() : '';
  if (localUrl && primaryProvider !== 'local') {
    const localModel = String(env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b').trim() || 'gemma4:e4b';
    const localTarget = {
      role: 'fallback-local',
      provider: 'local',
      url: localUrl,
      body: sanitizeBodyForLocal(upstreamBody, localModel),
      apiKey: '',
      model: localModel,
    };
    localTarget.id = makeTargetId(localTarget);
    targets.push(localTarget);
  }

  const preferNonGroq = !isDisabledEnv(env.A11_CERBERE_PREFER_NON_GROQ);
  if (preferNonGroq && targets.length > 1) {
    targets.sort((left, right) => {
      const leftGroq = isGroqLikeUrl(left.url) ? 1 : 0;
      const rightGroq = isGroqLikeUrl(right.url) ? 1 : 0;
      if (leftGroq !== rightGroq) return leftGroq - rightGroq;
      const leftPrimary = left.role === 'primary' ? 0 : 1;
      const rightPrimary = right.role === 'primary' ? 0 : 1;
      return leftPrimary - rightPrimary;
    });
  }

  const seen = new Set();
  return targets.filter((target) => {
    if (!target.url || seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

function shouldSkipTargetByMismatch(target) {
  const model = String(target?.model || target?.body?.model || '').trim();
  if (!model) return false;
  if (isGroqLikeUrl(target?.url) && isLikelyOpenAiNativeModel(model)) return true;
  if (String(target?.url || '').includes('api.openai.com') && isLikelyGroqModel(model)) return true;
  return false;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampTargetLimit(value, env = process.env) {
  const configuredMax = parsePositiveInt(env.A11_CERBERE_MULTI_MAX_TARGETS, DEFAULT_MULTI_MAX_TARGETS);
  const requested = parsePositiveInt(value, configuredMax);
  return Math.max(1, Math.min(MAX_MULTI_TARGETS, configuredMax, requested));
}

function compactMultiError(error_) {
  const status = getErrorStatus(error_) || null;
  const text = redactSecretLikeText(extractErrorText(error_) || error_?.message || 'upstream_error');
  return {
    status,
    code: error_?.code || null,
    message: text.slice(0, 500),
  };
}

function createMiniCerbereRuntime({
  env = process.env,
  requestChatUpstream,
  getLocalCompletionsUrl,
  logger = console,
  now = () => Date.now(),
} = {}) {
  if (typeof requestChatUpstream !== 'function') {
    throw new Error('createMiniCerbereRuntime requires requestChatUpstream');
  }

  const cooldowns = new Map();

  function markCooldown(target, error_) {
    const nowMs = now();
    const delayMs = Math.max(1000, parseRetryDelayMs(error_, nowMs));
    const status = getErrorStatus(error_) || null;
    const reason = status ? `http_${status}` : String(error_?.code || error_?.message || 'upstream_error').slice(0, 80);
    cooldowns.set(target.id, {
      until: nowMs + delayMs,
      reason,
      status,
      model: target.model,
      provider: target.provider,
      role: target.role,
      updatedAt: new Date(nowMs).toISOString(),
    });
    return delayMs;
  }

  function getCooldown(target) {
    const entry = cooldowns.get(target.id);
    if (!entry) return null;
    if (entry.until <= now()) {
      cooldowns.delete(target.id);
      return null;
    }
    return entry;
  }

  async function requestChat({
    provider,
    upstreamUrl,
    upstreamBody,
    remoteProviderConfig,
    reqHeaders,
    requestId,
  } = {}) {
    const targets = buildChatTargets({
      env,
      provider,
      upstreamUrl,
      upstreamBody,
      remoteProviderConfig,
      getLocalCompletionsUrl,
    });
    if (!targets.length) {
      throw new Error('mini_cerbere_no_targets');
    }

    let lastError = null;
    const skipped = [];
    for (const target of targets) {
      const mismatch = shouldSkipTargetByMismatch(target);
      if (mismatch) {
        skipped.push({ ...compactTarget(target), reason: 'model_provider_mismatch' });
        continue;
      }

      const cooldown = getCooldown(target);
      if (cooldown && targets.length > 1) {
        skipped.push({
          ...compactTarget(target),
          reason: cooldown.reason,
          retryInMs: Math.max(0, cooldown.until - now()),
        });
        continue;
      }

      try {
        const result = await requestChatUpstream(target.url, target.body, {
          provider: target.provider,
          apiKey: target.authToken,
          reqHeaders,
          requestId,
        });
        return {
          ...result,
          target: compactTarget(target),
          skipped,
        };
      } catch (error_) {
        lastError = error_;
        if (!isRetryableCerbereError(error_) || targets.length <= 1) {
          throw error_;
        }
        const delayMs = markCooldown(target, error_);
        logger?.warn?.('[A11][mini-cerbere] upstream cooled down', {
          ...compactTarget(target),
          status: getErrorStatus(error_) || null,
          delayMs,
        });
      }
    }

    if (lastError) throw lastError;
    const error_ = new Error('mini_cerbere_all_targets_skipped');
    error_.skipped = skipped;
    throw error_;
  }

  async function requestMultiChat({
    provider,
    upstreamUrl,
    upstreamBody,
    remoteProviderConfig,
    reqHeaders,
    requestId,
    limit,
  } = {}) {
    const targetLimit = clampTargetLimit(limit, env);
    const targets = buildChatTargets({
      env,
      provider,
      upstreamUrl,
      upstreamBody,
      remoteProviderConfig,
      getLocalCompletionsUrl,
    });
    if (!targets.length) {
      throw new Error('mini_cerbere_no_targets');
    }

    const skipped = [];
    const selected = [];
    for (const target of targets) {
      if (selected.length >= targetLimit) break;
      if (shouldSkipTargetByMismatch(target)) {
        skipped.push({ ...compactTarget(target), reason: 'model_provider_mismatch' });
        continue;
      }
      const cooldown = getCooldown(target);
      if (cooldown) {
        skipped.push({
          ...compactTarget(target),
          reason: cooldown.reason,
          retryInMs: Math.max(0, cooldown.until - now()),
        });
        continue;
      }
      selected.push(target);
    }

    const safeBody = redactSecretLikeValue(upstreamBody || {});
    const settled = await Promise.allSettled(selected.map(async (target) => {
      try {
        const result = await requestChatUpstream(target.url, {
          ...(target.body || {}),
          ...safeBody,
          model: target.body?.model || safeBody.model,
          messages: safeBody.messages || target.body?.messages || [],
        }, {
          provider: target.provider,
          apiKey: target.authToken,
          reqHeaders,
          requestId,
        });
        return {
          ok: true,
          target: compactTarget(target),
          content: extractPanelContent(result.data),
        };
      } catch (error_) {
        if (isRetryableCerbereError(error_)) {
          markCooldown(target, error_);
        }
        return {
          ok: false,
          target: compactTarget(target),
          error: compactMultiError(error_),
        };
      }
    }));

    const results = settled.map((entry) => (
      entry.status === 'fulfilled'
        ? entry.value
        : { ok: false, target: null, error: compactMultiError(entry.reason) }
    ));

    return {
      ok: results.some((entry) => entry.ok),
      mode: 'multi',
      limit: targetLimit,
      selected: selected.map(compactTarget),
      skipped,
      results,
    };
  }

  function getStatus() {
    const nowMs = now();
    const cooldownList = [];
    for (const [id, entry] of cooldowns.entries()) {
      if (entry.until <= nowMs) {
        cooldowns.delete(id);
        continue;
      }
      cooldownList.push({
        id,
        provider: entry.provider,
        model: entry.model,
        role: entry.role,
        reason: entry.reason,
        status: entry.status,
        retryInMs: Math.max(0, entry.until - nowMs),
        updatedAt: entry.updatedAt,
      });
    }
    return {
      enabled: !isTruthyEnv(env.A11_CERBERE_DISABLED),
      preferNonGroq: !isDisabledEnv(env.A11_CERBERE_PREFER_NON_GROQ),
      cooldowns: cooldownList,
      cooldownCount: cooldownList.length,
      configuredProviders: {
        openai: !!String(
          env.A11_CERBERE_OPENAI_API_KEY
          || env.A11_AGENT_OPENAI_API_KEY
          || env.A11_OPENAI_API_KEY
          || env.OPENAI_API_KEY
          || ''
        ).trim(),
        together: !!String(env.A11_CERBERE_TOGETHER_API_KEY || env.TOGETHER_API_KEY || '').trim(),
        deepseek: !!String(env.A11_CERBERE_DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || '').trim(),
        llamaPro: getLlamaProStatus(env),
      },
      openAiDirectConfigured: !!String(
        env.A11_CERBERE_OPENAI_API_KEY
        || env.A11_AGENT_OPENAI_API_KEY
        || env.A11_OPENAI_API_KEY
        || env.OPENAI_API_KEY
        || ''
      ).trim(),
      localFallbackConfigured: !!(typeof getLocalCompletionsUrl === 'function' && getLocalCompletionsUrl()),
    };
  }

  return {
    requestChat,
    requestMultiChat,
    getStatus,
    _buildTargets: (input) => buildChatTargets({ env, getLocalCompletionsUrl, ...(input || {}) }),
  };
}

function extractPanelContent(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return redactSecretLikeText(payload).trim();
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content || choice?.delta?.content || choice?.text || payload.output || payload.response || payload.content || payload.text || '';
  return redactSecretLikeText(content).trim();
}

module.exports = {
  createMiniCerbereRuntime,
  buildChatTargets,
  extractErrorText,
  redactSecretLikeText,
  redactSecretLikeValue,
  isGroqLikeUrl,
  isRetryableCerbereError,
  normalizeCompletionsUrl,
  parseDurationTextMs,
  parseRetryAfterHeaderMs,
  parseRetryDelayMs,
  shouldSkipTargetByMismatch,
};

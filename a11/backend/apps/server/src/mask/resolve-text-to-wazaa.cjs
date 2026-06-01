// resolve-text-to-wazaa.cjs
// Enrichissement WAZAA par LLM, sans sortir le pipeline image.generate du français.
// Appelé par text-to-wazaa.cjs comme fallback quand l'heuristique est trop faible
// ou ambigüe.

const {
  listSupportedIntentTypes,
  normalizeIntentType,
} = require('./semantic/semantic-utils.cjs');
const {
  createUpstreamHttpError,
  fetchJsonWithRetry,
} = require('../../lib/fetch-json-retry.cjs');

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeEnvValue(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'undefined' || normalized.toLowerCase() === 'null') return '';
  return normalized;
}

function isTruthyEnv(value = '') {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeLlmProviderName(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['openai', 'openrouter'].includes(normalized)) return 'openai';
  return normalized;
}

function shouldUseConfiguredOpenAiCompatibleRuntime(env = process.env) {
  const provider = normalizeLlmProviderName(env.A11_LLM_PROVIDER || env.LLM_PROVIDER || '');
  if (provider !== 'openai') return false;
  return Boolean(
    normalizeEnvValue(env.A11_OPENAI_API_KEY)
    || normalizeEnvValue(env.OPENAI_API_KEY)
    || normalizeEnvValue(env.A11_OPENROUTER_API_KEY)
    || normalizeEnvValue(env.OPENROUTER_API_KEY)
  );
}

function resolveImagePipelineMode() {
  const raw = String(process.env.A11_IMAGE_PIPELINE_MODE || '').trim().toLowerCase();
  if (raw === 'orchestrated' || raw === 'orchestrateur' || raw === 'smart') return 'smart';
  if (raw === 'creative' || raw === 'raw') return 'raw';
  return 'auto';
}

function buildChatCompletionsUrl(value = '') {
  const baseUrl = normalizeBaseUrl(value);
  if (!baseUrl) return '';
  if (/\/v1\/chat\/completions$/i.test(baseUrl) || /\/chat\/completions$/i.test(baseUrl)) {
    return baseUrl;
  }
  return baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;
}

function isRouterLikeBaseUrl(value = '') {
  const normalized = normalizeBaseUrl(value).toLowerCase();
  if (!normalized) return false;
  const configuredRouter = normalizeBaseUrl(process.env.LLM_ROUTER_URL || '').toLowerCase();
  if (configuredRouter && normalized === configuredRouter) return true;
  return (
    normalized.includes('127.0.0.1:4545')
    || normalized.includes('localhost:4545')
  );
}

function resolveLocalStructuredLlmBaseUrl(env = process.env) {
  const explicitOllamaBase = normalizeBaseUrl(normalizeEnvValue(env.OLLAMA_BASE));
  if (explicitOllamaBase) return explicitOllamaBase;

  const ollamaHost = normalizeEnvValue(env.OLLAMA_HOST);
  const ollamaPort = normalizeEnvValue(env.OLLAMA_PORT);
  if (ollamaHost || ollamaPort) {
    return `http://${ollamaHost || '127.0.0.1'}:${ollamaPort || '11434'}`;
  }

  return normalizeBaseUrl(
    normalizeEnvValue(env.LLAMA_BASE)
    || normalizeEnvValue(env.LOCAL_LLM_URL)
    || ''
  );
}

function isLocalStructuredLlmBaseUrl(value = '', env = process.env) {
  const normalized = normalizeBaseUrl(value).toLowerCase();
  if (!normalized) return false;
  const localCandidates = [
    resolveLocalStructuredLlmBaseUrl(env),
    'http://127.0.0.1:11434',
    'http://localhost:11434',
  ]
    .map((entry) => normalizeBaseUrl(entry).toLowerCase())
    .filter(Boolean);
  if (localCandidates.includes(normalized)) return true;
  return (
    normalized.includes('127.0.0.1:11434')
    || normalized.includes('localhost:11434')
    || normalized.includes('/ollama')
  );
}

function shouldAttachNezTokenToStructuredLlm(baseUrl = '') {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  if (!normalized) return false;
  if (isRouterLikeBaseUrl(normalized) || isLocalStructuredLlmBaseUrl(normalized)) return true;
  return (
    normalized.includes('.funesterie.me')
    || normalized.includes('funesterie.local')
    || normalized.includes('/nez')
    || normalized.includes('cerbere')
  );
}

const WAZAA_TRANSLATE_SYSTEM_PROMPT = `Je suis un analyseur d'intention structuré pour A11.
Je reçois un message utilisateur en français.
Je dois :
1. déterminer l'intention
2. extraire le sujet, les couleurs, l'environnement et le style
3. reformuler la demande de façon simple et fidèle, en français

Je réponds UNIQUEMENT en JSON strict, sans explication :
{
  "intent": "image.generate",
  "subject": "sujet principal en français",
  "colors": ["couleurs extraites en français"],
  "environment": "environnement ou fond en français, ou chaîne vide",
  "style": "style explicite si mentionné, ou chaîne vide",
  "translatedText": "reformulation simple en français de la demande"
}

Intents valides : ${listSupportedIntentTypes().join(', ')}

Exemples :
Utilisateur : "genere une courgette rose"
{"intent":"image.generate","subject":"courgette rose","colors":["rose"],"environment":"","style":"","translatedText":"générer une courgette rose"}

Utilisateur : "dessine un lapin de pâques de couleurs rose"
{"intent":"image.generate","subject":"lapin de Pâques rose","colors":["rose"],"environment":"","style":"","translatedText":"dessiner un lapin de Pâques rose"}

Utilisateur : "affiche un dragon bleu dans un volcan en style pixel art"
{"intent":"image.generate","subject":"dragon bleu","colors":["bleu"],"environment":"dans un volcan","style":"pixel art","translatedText":"afficher un dragon bleu dans un volcan en style pixel art"}

Utilisateur : "genere un champignon rouge avec des pois blancs"
{"intent":"image.generate","subject":"champignon rouge avec des pois blancs","colors":["rouge","blanc"],"environment":"","style":"","translatedText":"générer un champignon rouge avec des pois blancs"}

Utilisateur : "cree une tortue violette sur une plage"
{"intent":"image.generate","subject":"tortue violette","colors":["violet"],"environment":"sur une plage","style":"","translatedText":"créer une tortue violette sur une plage"}

Utilisateur : "ecris un script python qui trie des fichiers"
{"intent":"code.python.generate","subject":"","colors":[],"environment":"","style":"","translatedText":"écrire un script python qui trie des fichiers"}

Utilisateur : "reponds-moi simplement bonjour"
{"intent":"chat.reply","subject":"","colors":[],"environment":"","style":"","translatedText":"répondre simplement bonjour"}

Utilisateur : "montre-moi une image de goku"
{"intent":"web.image.search","subject":"goku","colors":[],"environment":"","style":"","translatedText":"montrer une image de goku"}`;

function resolveTranslationConfig() {
  const explicitTranslationBaseUrl = normalizeBaseUrl(process.env.A11_TRANSLATION_BASE_URL || '');
  const routerBaseUrl = normalizeBaseUrl(process.env.LLM_ROUTER_URL || '');
  const localStructuredLlmBaseUrl = resolveLocalStructuredLlmBaseUrl(process.env);
  const explicitGenericOpenAiFallback = normalizeEnvValue(process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI);
  const allowGenericOpenAiFallback = explicitGenericOpenAiFallback
    ? isTruthyEnv(explicitGenericOpenAiFallback)
    : shouldUseConfiguredOpenAiCompatibleRuntime(process.env);
  const genericOpenAiBaseUrl = allowGenericOpenAiFallback
    ? normalizeBaseUrl(
      normalizeEnvValue(process.env.A11_OPENAI_BASE_URL)
      || normalizeEnvValue(process.env.OPENAI_BASE_URL)
      || 'https://api.openai.com/v1'
    )
    : '';
  const baseUrl = explicitTranslationBaseUrl || routerBaseUrl || localStructuredLlmBaseUrl || genericOpenAiBaseUrl || '';
  const url = buildChatCompletionsUrl(baseUrl);
  const isOpenRouterBaseUrl = /openrouter\.ai/i.test(baseUrl);
  const isRemoteOpenAiCompatibleBaseUrl = Boolean(
    baseUrl
    && !isRouterLikeBaseUrl(baseUrl)
    && !isLocalStructuredLlmBaseUrl(baseUrl)
  );
  const openRouterApiKey = isOpenRouterBaseUrl
    ? (
      normalizeEnvValue(process.env.A11_OPENROUTER_API_KEY)
      || normalizeEnvValue(process.env.OPENROUTER_API_KEY)
      || ''
    )
    : '';

  const apiKey = (
    normalizeEnvValue(process.env.A11_TRANSLATION_API_KEY)
    || openRouterApiKey
    || (allowGenericOpenAiFallback
      ? (
        normalizeEnvValue(process.env.A11_OPENAI_API_KEY)
        || normalizeEnvValue(process.env.OPENAI_API_KEY)
        || (/groq\.com/i.test(baseUrl) ? normalizeEnvValue(process.env.GROQ_API_KEY) : '')
      )
      : '')
    || ''
  );

  const usesRouterLikeBaseUrl = isRouterLikeBaseUrl(baseUrl);
  const allowAnonymous = usesRouterLikeBaseUrl || isLocalStructuredLlmBaseUrl(baseUrl) || ['1', 'true', 'yes', 'on'].includes(
    String(process.env.A11_TRANSLATION_ALLOW_ANON || '').trim().toLowerCase()
  );

  const model = (
    normalizeEnvValue(process.env.A11_TRANSLATION_MODEL)
    || (isRemoteOpenAiCompatibleBaseUrl
      ? (
        normalizeEnvValue(process.env.A11_OPENAI_MODEL)
        || normalizeEnvValue(process.env.OPENAI_MODEL)
        || normalizeEnvValue(process.env.GROQ_MODEL)
        || ''
      )
      : '')
    || (allowGenericOpenAiFallback
      ? (
        normalizeEnvValue(process.env.A11_OPENAI_MODEL)
        || normalizeEnvValue(process.env.OPENAI_MODEL)
        || normalizeEnvValue(process.env.GROQ_MODEL)
        || ''
      )
      : '')
    || normalizeEnvValue(process.env.A11_OLLAMA_PRIMARY_MODEL)
    || normalizeEnvValue(process.env.LOCAL_DEFAULT_MODEL)
    || normalizeEnvValue(process.env.DEFAULT_MODEL)
    || normalizeEnvValue(process.env.LLAMA_MODEL)
    || 'gemma4:e4b'
  );

  const rawNezToken = normalizeEnvValue(
    process.env.A11_TRANSLATION_NEZ_TOKEN
    || process.env.NEZ_ADMIN_TOKEN
    || process.env.A11_NEZ_ADMIN_TOKEN
    || process.env.NEZ_SERVICE_TOKEN
    || process.env.A11_NEZ_SERVICE_TOKEN
    || process.env.NEZ_ALLOWED_TOKEN
    || process.env.NEZ_ALLOWED_TOKENS
    || process.env.NEZ_TOKENS
    || process.env.NEZ_TOKEN
    || process.env.A11_NEZ_TOKEN
    || ''
  );
  const attachNezToken = Boolean(rawNezToken && shouldAttachNezTokenToStructuredLlm(baseUrl));

  return {
    url,
    baseUrl,
    apiKey,
    model,
    allowAnonymous,
    usesRouterLikeBaseUrl,
    nezToken: rawNezToken,
    attachNezToken,
    isConfigured: Boolean(url && (allowAnonymous || apiKey)),
  };
}

function resolveStructuredLlmRoute(config = {}) {
  if (config?.usesRouterLikeBaseUrl) return 'router';
  const baseUrl = normalizeBaseUrl(config?.baseUrl || '');
  if (!baseUrl) return 'unconfigured';
  if (isLocalStructuredLlmBaseUrl(baseUrl)) return 'direct_local_llm';
  return 'direct_remote_llm';
}

function buildStructuredLlmTraceMeta(config = {}, stage = 'structured_llm') {
  return {
    stage: String(stage || 'structured_llm').trim() || 'structured_llm',
    route: resolveStructuredLlmRoute(config),
    baseUrl: normalizeBaseUrl(config?.baseUrl || '') || null,
    model: String(config?.model || '').trim() || null,
    allowAnonymous: config?.allowAnonymous === true,
    apiKeyConfigured: Boolean(String(config?.apiKey || '').trim()),
    usesRouterLikeBaseUrl: config?.usesRouterLikeBaseUrl === true,
  };
}

function logStructuredLlmDispatch(traceMeta = {}) {
  const parts = [
    `stage=${String(traceMeta?.stage || 'structured_llm').trim() || 'structured_llm'}`,
    `route=${String(traceMeta?.route || 'unknown').trim() || 'unknown'}`,
    `model=${String(traceMeta?.model || 'unknown').trim() || 'unknown'}`,
    `baseUrl=${String(traceMeta?.baseUrl || 'unconfigured').trim() || 'unconfigured'}`,
    `auth=${traceMeta?.apiKeyConfigured === true ? 'true' : 'false'}`,
    `anon=${traceMeta?.allowAnonymous === true ? 'true' : 'false'}`,
  ];
  console.info(`[A11][structured-llm][dispatch] ${parts.join(' ')}`);
}

function isLlmEnrichmentEnabled() {
  const explicit = normalizeEnvValue(process.env.A11_WAZAA_LLM_ENRICH);
  if (explicit) {
    return isTruthyEnv(explicit);
  }
  const config = resolveTranslationConfig();
  return config.isConfigured;
}

function buildStructuredLlmError(code, message, {
  statusCode = 502,
  upstream = null,
} = {}) {
  const error = new Error(String(message || code || 'structured_llm_error'));
  error.code = String(code || 'structured_llm_error');
  error.statusCode = Number.isFinite(Number(statusCode)) ? Number(statusCode) : 502;
  error.status = error.statusCode;
  if (upstream && typeof upstream === 'object') {
    error.upstream = upstream;
  }
  return error;
}

function shouldRetryStructuredLlmWithJsonObject(result = {}, responseFormat = null) {
  if (!responseFormat || responseFormat.type !== 'json_schema') return false;

  const status = Number(result?.status || 0) || 0;
  if (status && status !== 400 && status !== 422) return false;

  const rawText = String(result?.text || '').toLowerCase();
  return rawText.includes('response_format')
    || rawText.includes('json_schema')
    || rawText.includes('json schema')
    || rawText.includes('schema');
}

function downgradeJsonSchemaResponseFormat(responseFormat = null) {
  if (!responseFormat || responseFormat.type !== 'json_schema') return responseFormat;
  return { type: 'json_object' };
}

async function callStructuredLlmJson({
  text = '',
  systemPrompt = '',
  temperature = 0,
  maxTokens = 256,
  timeoutMs = 90000,
  responseFormat = null,
  strict = false,
  stage = 'structured_llm',
} = {}) {
  const config = resolveTranslationConfig();
  const traceMeta = buildStructuredLlmTraceMeta(config, stage);
  logStructuredLlmDispatch(traceMeta);
  if (!config.isConfigured) {
    if (!strict) return null;
    throw buildStructuredLlmError(
      'structured_llm_unconfigured',
      `Structured LLM is not configured for stage ${stage}.`,
      {
        statusCode: 503,
        upstream: {
          url: config.url || null,
          status: null,
          body: 'Structured LLM is not configured for this environment.',
        },
      }
    );
  }

  const body = {
    model: config.model,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0,
    max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 256,
    messages: [
      { role: 'system', content: String(systemPrompt || '').trim() },
      { role: 'user', content: text },
    ],
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };

  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  if (config.usesRouterLikeBaseUrl) {
    headers['X-A11-Structured-Stage'] = traceMeta.stage;
    headers['X-A11-Structured-Route'] = traceMeta.route;
    headers['X-A11-Structured-Origin'] = 'resolve-text-to-wazaa';
  }
  if (config.nezToken && config.attachNezToken !== false) {
    headers['X-NEZ-TOKEN'] = config.nezToken;
  }

  let result = await fetchJsonWithRetry(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, {
    timeoutMs: Math.max(1000, Number(timeoutMs) || 90000),
    retries: Math.max(0, Number(process.env.A11_WAZAA_LLM_RETRIES || 2) || 0),
    logger: console,
  });

  if (!result?.ok && shouldRetryStructuredLlmWithJsonObject(result, responseFormat)) {
    const fallbackBody = {
      ...body,
      response_format: downgradeJsonSchemaResponseFormat(responseFormat),
    };
    console.warn(`[resolve-text-to-wazaa] Retrying ${stage} with response_format=json_object after json_schema rejection`);
    result = await fetchJsonWithRetry(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(fallbackBody),
    }, {
      timeoutMs: Math.max(1000, Number(timeoutMs) || 90000),
      retries: Math.max(0, Number(process.env.A11_WAZAA_LLM_RETRIES || 2) || 0),
      logger: console,
    });
  }

  if (!result?.ok) {
    const status = Number(result?.status || 0) || 0;
    const rawText = String(result?.text || '').trim();
    const normalizedText = rawText.replace(/\s+/g, ' ').trim();
    const isHtmlTimeout = /<!doctype html|<html/i.test(rawText)
      && /error code 524|a timeout occurred/i.test(rawText);
    const summary = isHtmlTimeout
      ? 'upstream timeout (cloudflare 524)'
      : (normalizedText || 'upstream request failed');
    console.error(`[resolve-text-to-wazaa] LLM HTTP ${status || '0'}: ${summary.slice(0, 200)}`);
    if (strict) {
      throw createUpstreamHttpError(result, {
        error: 'structured_llm_upstream_failed',
        message: `Structured LLM request failed during ${stage}.`,
      });
    }
    return null;
  }

  const json = result?.data && typeof result.data === 'object'
    ? result.data
    : null;
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    if (!strict) return null;
    throw buildStructuredLlmError(
      'structured_llm_empty_content',
      `Structured LLM returned an empty content payload during ${stage}.`,
      {
        statusCode: 502,
        upstream: {
          url: config.url || null,
          status: Number(result?.status || 200) || 200,
          body: 'Structured LLM returned no message content.',
          requestId: result?.requestId || null,
        },
      }
    );
  }

  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_firstError) {
    // Try to repair common LLM JSON issues: unquoted property names
    try {
      const repaired = cleaned
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3')
        .replace(/:\s*'([^']*)'/g, ': "$1"');
      return JSON.parse(repaired);
    } catch (error_) {
      if (!strict) throw error_;
      throw buildStructuredLlmError(
        'structured_llm_invalid_json',
        `Structured LLM returned invalid JSON during ${stage}.`,
        {
          statusCode: 502,
          upstream: {
            url: config.url || null,
            status: Number(result?.status || 200) || 200,
            body: cleaned.slice(0, 2000) || null,
            requestId: result?.requestId || null,
          },
        }
      );
    }
  }
}

async function callTranslationLlm(text) {
  return callStructuredLlmJson({
    text,
    systemPrompt: WAZAA_TRANSLATE_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 256,
    timeoutMs: Number(process.env.A11_WAZAA_LLM_TIMEOUT_MS || 90000),
  });
}

function shouldEnrichWithLlm(heuristicWazaa) {
  if (!isLlmEnrichmentEnabled()) return false;

  const intentType = heuristicWazaa?.intent?.type
    || heuristicWazaa?.intents?.[0]?.type
    || '';
  const confidence = heuristicWazaa?.intent?.confidence
    || heuristicWazaa?.signal?.confidence
    || 0;
  const ambiguities = heuristicWazaa?.ambiguities || [];

  // En mode orchestré on enrichit systématiquement les demandes image.
  // En mode créatif on laisse d'abord la compréhension locale travailler,
  // puis on ne fait appel au LLM qu'en cas de doute.
  if (intentType === 'image.generate') {
    if (resolveImagePipelineMode() === 'smart') return true;
    if (confidence >= 0.72 && ambiguities.length === 0) return false;
    return true;
  }

  // For other intents: enrich only if low confidence or ambiguities
  if (confidence < 0.5) return true;
  if (ambiguities.length > 0) return true;

  return false;
}

function mergeEnrichedWazaa(heuristicWazaa, llmResult, sourceText) {
  if (!llmResult || typeof llmResult !== 'object') return heuristicWazaa;

  const entities = [];

  if (llmResult.subject) {
    entities.push({ value: llmResult.subject, role: 'subject', weight: 0.95, source: 'llm' });
  }
  if (Array.isArray(llmResult.colors) && llmResult.colors.length > 0) {
    entities.push({ value: llmResult.colors.join(', '), role: 'attribute', weight: 0.85, source: 'llm' });
  }
  if (llmResult.environment) {
    entities.push({ value: llmResult.environment, role: 'environment', weight: 0.85, source: 'llm' });
  }
  if (llmResult.style) {
    entities.push({ value: llmResult.style, role: 'style', weight: 0.80, source: 'llm' });
  }

  const heuristicConfidence = heuristicWazaa?.intent?.confidence || 0;
  const llmIntent = normalizeIntentType(
    llmResult.intent,
    heuristicWazaa?.intent?.type || 'chat.reply'
  );
  const heuristicIntent = normalizeIntentType(
    heuristicWazaa?.intent?.type,
    llmIntent || 'chat.reply'
  );

  return {
    ...heuristicWazaa,
    entities: entities.length > 0 ? entities : heuristicWazaa.entities,
    intent: {
      type: (heuristicConfidence < 0.5 && llmIntent) ? llmIntent : heuristicIntent,
      confidence: Math.max(heuristicConfidence, 0.85),
    },
    meta: {
      ...(heuristicWazaa.meta || {}),
      sourceText: sourceText || heuristicWazaa?.meta?.sourceText || '',
      llmEnriched: true,
      translatedText: llmResult.translatedText || '',
      promptText: llmResult.translatedText || '',
      llmColors: Array.isArray(llmResult.colors) ? llmResult.colors : [],
      llmIntent: llmIntent || '',
    },
  };
}

async function resolveTextToWazaa(text, heuristicWazaa) {
  if (!shouldEnrichWithLlm(heuristicWazaa)) return heuristicWazaa;

  try {
    const llmResult = await callTranslationLlm(text);
    return mergeEnrichedWazaa(heuristicWazaa, llmResult, text);
  } catch (err) {
    console.error('[resolve-text-to-wazaa] LLM enrichment failed, using heuristic:', err.message);
    return heuristicWazaa;
  }
}

module.exports = {
  resolveTextToWazaa,
  shouldEnrichWithLlm,
  isLlmEnrichmentEnabled,
  resolveTranslationConfig,
  shouldUseConfiguredOpenAiCompatibleRuntime,
  resolveStructuredLlmRoute,
  buildStructuredLlmTraceMeta,
  callStructuredLlmJson,
  mergeEnrichedWazaa,
  WAZAA_TRANSLATE_SYSTEM_PROMPT,
};

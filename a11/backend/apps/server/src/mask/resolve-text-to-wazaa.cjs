// resolve-text-to-wazaa.cjs
// Enrichissement WAZAA par LLM, sans sortir le pipeline image.generate du français.
// Appelé par text-to-wazaa.cjs comme fallback quand l'heuristique est trop faible
// ou ambigüe.

const {
  listSupportedIntentTypes,
  normalizeIntentType,
} = require('./semantic/semantic-utils.cjs');

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
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
    normalized.includes('cerbere.funesterie.me')
    || normalized.includes('127.0.0.1:4545')
    || normalized.includes('localhost:4545')
  );
}

const WAZAA_TRANSLATE_SYSTEM_PROMPT = `Tu es un analyseur d'intention structuré pour A11.
Tu reçois un message utilisateur en français.
Tu dois :
1. déterminer l'intention
2. extraire le sujet, les couleurs, l'environnement et le style
3. reformuler la demande de façon simple et fidèle, en français

Réponds UNIQUEMENT en JSON strict, sans explication :
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
  const openAiBaseUrl = normalizeBaseUrl(
    process.env.A11_OPENAI_BASE_URL
    || process.env.OPENAI_BASE_URL
    || ''
  );
  const baseUrl = explicitTranslationBaseUrl || routerBaseUrl || openAiBaseUrl || 'https://api.openai.com/v1';
  const url = buildChatCompletionsUrl(baseUrl);

  const allowGenericOpenAiKey = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI || '').trim().toLowerCase()
  );
  const apiKey = (
    process.env.A11_TRANSLATION_API_KEY
    || process.env.A11_OPENAI_API_KEY
    || (allowGenericOpenAiKey ? process.env.OPENAI_API_KEY : '')
    || ''
  );

  const usesRouterLikeBaseUrl = isRouterLikeBaseUrl(baseUrl);
  const allowAnonymous = usesRouterLikeBaseUrl || ['1', 'true', 'yes', 'on'].includes(
    String(process.env.A11_TRANSLATION_ALLOW_ANON || '').trim().toLowerCase()
  );

  const model = (
    process.env.A11_TRANSLATION_MODEL
    || (usesRouterLikeBaseUrl ? process.env.A11_OLLAMA_PRIMARY_MODEL : '')
    || process.env.A11_OPENAI_MODEL
    || process.env.OPENAI_MODEL
    || (usesRouterLikeBaseUrl ? 'gemma4:e4b' : 'gpt-4o-mini')
  );

  const nezToken = (
    process.env.A11_TRANSLATION_NEZ_TOKEN
    || process.env.NEZ_ALLOWED_TOKEN
    || process.env.NEZ_TOKENS
    || ''
  );

  return {
    url,
    baseUrl,
    apiKey,
    model,
    allowAnonymous,
    usesRouterLikeBaseUrl,
    nezToken,
    isConfigured: Boolean(url && (allowAnonymous || apiKey)),
  };
}

function isLlmEnrichmentEnabled() {
  const explicit = process.env.A11_WAZAA_LLM_ENRICH;
  if (explicit !== undefined && explicit !== '') {
    return ['1', 'true', 'yes', 'on'].includes(String(explicit).trim().toLowerCase());
  }
  const config = resolveTranslationConfig();
  return config.isConfigured;
}

async function callStructuredLlmJson({
  text = '',
  systemPrompt = '',
  temperature = 0,
  maxTokens = 256,
  timeoutMs = 8000,
} = {}) {
  const config = resolveTranslationConfig();
  if (!config.isConfigured) return null;

  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 8000))
    : null;

  const body = {
    model: config.model,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0,
    max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : 256,
    messages: [
      { role: 'system', content: String(systemPrompt || '').trim() },
      { role: 'user', content: text },
    ],
  };

  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    if (config.nezToken) {
      headers['X-NEZ-TOKEN'] = config.nezToken;
    }

    const resp = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[resolve-text-to-wazaa] LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;

    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    return JSON.parse(cleaned);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function callTranslationLlm(text) {
  return callStructuredLlmJson({
    text,
    systemPrompt: WAZAA_TRANSLATE_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 256,
    timeoutMs: Number(process.env.A11_WAZAA_LLM_TIMEOUT_MS || 8000),
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
  callStructuredLlmJson,
  mergeEnrichedWazaa,
  WAZAA_TRANSLATE_SYSTEM_PROMPT,
};

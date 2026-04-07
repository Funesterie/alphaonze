// resolve-text-to-wazaa.cjs
// LLM-based WAZAA enrichment — translates French entities to English
// Called by text-to-wazaa.cjs as fallback when heuristic confidence is low
// or when image.generate intent needs proper French→English translation

const {
  listSupportedIntentTypes,
  normalizeIntentType,
} = require('./semantic/semantic-utils.cjs');

const WAZAA_TRANSLATE_SYSTEM_PROMPT = `You are a structured intent analyzer and French-to-English translator for a multimodal AI.
Given a user message (usually in French), you must:
1. Determine the intent
2. Extract and TRANSLATE to English: subject, colors, environment, style

Respond ONLY with strict JSON, no explanation:
{
  "intent": "image.generate",
  "subject": "the main subject translated to English",
  "colors": ["extracted color(s) in English"],
  "environment": "environment/background if mentioned, in English, or empty string",
  "style": "explicit style if mentioned (e.g. pixel art, watercolor), or empty string",
  "translatedText": "full natural English translation of the user request"
}

Valid intents: ${listSupportedIntentTypes().join(', ')}

Examples:
User: "genere une courgette rose"
{"intent":"image.generate","subject":"pink zucchini","colors":["pink"],"environment":"","style":"","translatedText":"generate a pink zucchini"}

User: "dessine un lapin de pâques de couleurs rose"
{"intent":"image.generate","subject":"pink Easter rabbit","colors":["pink"],"environment":"","style":"","translatedText":"draw a pink Easter rabbit"}

User: "affiche un dragon bleu dans un volcan en style pixel art"
{"intent":"image.generate","subject":"blue dragon","colors":["blue"],"environment":"in a volcano","style":"pixel art","translatedText":"display a blue dragon in a volcano in pixel art style"}

User: "genere un champignon rouge avec des pois blancs"
{"intent":"image.generate","subject":"red mushroom with white polka dots","colors":["red","white"],"environment":"","style":"","translatedText":"generate a red mushroom with white polka dots"}

User: "cree une tortue violette sur une plage"
{"intent":"image.generate","subject":"purple turtle","colors":["purple"],"environment":"on a beach","style":"","translatedText":"create a purple turtle on a beach"}

User: "ecris un script python qui trie des fichiers"
{"intent":"code.python.generate","subject":"","colors":[],"environment":"","style":"","translatedText":"write a python script that sorts files"}

User: "reponds-moi simplement bonjour"
{"intent":"chat.reply","subject":"","colors":[],"environment":"","style":"","translatedText":"reply to me simply hello"}

User: "montre-moi une image de goku"
{"intent":"web.image.search","subject":"goku","colors":[],"environment":"","style":"","translatedText":"show me an image of goku"}`;

function resolveTranslationConfig() {
  const raw = (
    process.env.A11_TRANSLATION_BASE_URL
    || process.env.A11_OPENAI_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://api.openai.com/v1'
  );
  const baseUrl = raw.replace(/\/+$/, '');
  const url = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const apiKey = (
    process.env.A11_TRANSLATION_API_KEY
    || process.env.A11_OPENAI_API_KEY
    || process.env.OPENAI_API_KEY
    || ''
  );

  const model = (
    process.env.A11_TRANSLATION_MODEL
    || process.env.A11_OPENAI_MODEL
    || process.env.OPENAI_MODEL
    || 'gpt-4o-mini'
  );

  return { url, apiKey, model };
}

function isLlmEnrichmentEnabled() {
  const explicit = process.env.A11_WAZAA_LLM_ENRICH;
  if (explicit !== undefined && explicit !== '') {
    return ['1', 'true', 'yes', 'on'].includes(String(explicit).trim().toLowerCase());
  }
  const explicitScopedKey = (
    process.env.A11_TRANSLATION_API_KEY
    || process.env.A11_OPENAI_API_KEY
    || ''
  );
  return Boolean(String(explicitScopedKey).trim());
}

async function callTranslationLlm(text) {
  const config = resolveTranslationConfig();
  if (!config.apiKey) return null;

  const body = {
    model: config.model,
    temperature: 0,
    max_tokens: 256,
    messages: [
      { role: 'system', content: WAZAA_TRANSLATE_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
  };

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error(`[resolve-text-to-wazaa] LLM HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    return null;
  }

  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) return null;

  // Handle markdown code blocks wrapping the JSON
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
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

  // Always enrich image.generate — the main use case is French→English translation
  if (intentType === 'image.generate') return true;

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
  mergeEnrichedWazaa,
  WAZAA_TRANSLATE_SYSTEM_PROMPT,
};

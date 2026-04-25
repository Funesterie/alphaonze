// intent-detection.cjs
// Détection d'intention analytique via LLM avec indice de confiance.
// Les fonctions booléennes legacy sont conservées comme wrappers compatibles.
//
// Règle fondamentale : le LLM décide, pas des regex.
// Les regex ne servent que de fast-path pour les cas évidents (confiance >= 0.95)
// afin d'éviter un appel LLM inutile.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../src/mask/resolve-text-to-wazaa.cjs');

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalizeMessageForIntent(message) {
  return String(message || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── Fast-path heuristique minimal ───────────────────────────────────────────
// Utilisé uniquement pour court-circuiter l'appel LLM sur les cas évidents.
// Ne retourne jamais false — retourne null si incertain.

function fastPathImageIntent(normalized) {
  const hasCreationVerb = /\b(genere|cree|dessine|fabrique|produis|generate|create|draw|make|render)\b/.test(normalized);
  const hasVisualWord = /\b(image|illustration|dessin|photo|visuel|portrait)\b/.test(normalized);
  const hasTroubleshooting = /\b(explique|pourquoi|probleme|bug|erreur|fonctionne|marche)\b/.test(normalized);
  if (hasTroubleshooting && !hasCreationVerb) return null;
  if (hasCreationVerb && hasVisualWord) return { intent: 'image.generate', confidence: 0.95, reason: 'fast_path_creation_verb_visual_word' };
  return null;
}

function fastPathVideoIntent(normalized) {
  const hasCreationVerb = /\b(genere|cree|fais|fabrique|produis|generate|create|make|render)\b/.test(normalized);
  const hasVideoWord = /\b(video|animation|gif|mp4|clip)\b/.test(normalized);
  if (hasCreationVerb && hasVideoWord) return { intent: 'video.generate', confidence: 0.95, reason: 'fast_path_creation_verb_video_word' };
  return null;
}

function fastPathWebImageIntent(normalized) {
  const hasSearchVerb = /\b(montre|affiche|cherche|trouve|show|find|search)\b/.test(normalized);
  const hasCreationVerb = /\b(genere|cree|dessine|fabrique|produis|generate|create|draw|make|render)\b/.test(normalized);
  if (hasSearchVerb && !hasCreationVerb && /\b(image|photo|illustration)\b/.test(normalized)) {
    return { intent: 'web.image.search', confidence: 0.90, reason: 'fast_path_search_verb_image_word' };
  }
  return null;
}

function fastPathSoundIntent(normalized) {
  const hasCreationVerb = /\b(genere|cree|produis|compose|generate|create|make|produce|synthesize)\b/.test(normalized);
  const hasSoundWord = /\b(son|audio|musique|music|sound|bruit|noise|tts|voix|voice|parole|speech|mp3|wav|ogg)\b/.test(normalized);
  if (hasCreationVerb && hasSoundWord) return { intent: 'sound.generate', confidence: 0.90, reason: 'fast_path_creation_verb_sound_word' };
  return null;
}

// ─── Schéma LLM ──────────────────────────────────────────────────────────────

const INTENT_DETECTION_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'intent_detection',
    strict: true,
    schema: {
      type: 'object',
      required: ['intent', 'confidence', 'reason', 'subject'],
      properties: {
        intent: {
          type: 'string',
          enum: ['image.generate', 'video.generate', 'sound.generate', 'web.image.search', 'web.search', 'code.python.generate', 'chat.reply'],
        },
        confidence: { type: 'number' },
        reason: { type: 'string' },
        subject: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
});

const INTENT_DETECTION_SYSTEM_PROMPT = `You are an intent classifier for A11, a multimodal AI assistant that generates images, videos, and sounds.

You receive a user message (may be in French or English) and must classify it into exactly one intent.

Intents:
- image.generate: user wants a new image created. Can be explicit ("génère une image de...") or implicit (describing a visual scene, character, or object they want to see).
- video.generate: user wants a new video or animation created. Can be explicit ("génère une vidéo de...") or implicit (describing a scene in motion they want animated).
- sound.generate: user wants audio, music, TTS, or a sound file created.
- web.image.search: user wants to SEE an existing image from the web (montre-moi, affiche, cherche, trouve, show me, find me a picture of).
- web.search: user explicitly wants to search the web for information (cherche sur le web, trouve des infos sur, search for).
- code.python.generate: user wants Python code written.
- chat.reply: questions, explanations, troubleshooting, opinions, greetings, or anything that is clearly a conversation and not a creation request.

Classification rules:
- image.generate: use when the user describes a visual scene, character, creature, or object they want to see — even without an explicit creation verb. "Un dragon qui crache du feu" → image.generate. "Un viking sur un dragon dans les nuages" → image.generate.
- video.generate: use when the user describes motion, animation, or a scene that should move — even without an explicit verb. Context from previous messages matters.
- web.image.search: ONLY when the user uses search/show verbs (montre, affiche, cherche, trouve, show me, find) without a creation verb.
- web.search: ONLY for explicit information search requests. A scene description is NOT a web search.
- chat.reply: use for questions ("c'est quoi", "pourquoi", "comment"), greetings, troubleshooting, or when the user is clearly having a conversation rather than requesting creation.
- When in doubt between image.generate and chat.reply for a descriptive message, prefer image.generate if the message describes something visual.

confidence: 0.0-1.0
- 0.95+: unambiguous (explicit creation verb, or clearly a question/greeting)
- 0.75-0.94: strong signal but no explicit verb
- 0.5-0.74: ambiguous, could be multiple intents

subject: main subject in English (empty for chat.reply)
reason: one short English sentence

Return strict JSON only.`;

// ─── Détection LLM principale ─────────────────────────────────────────────────

async function detectIntentWithLlm({
  message = '',
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 8000,
} = {}) {
  const normalized = normalizeMessageForIntent(message);
  if (!normalized) {
    return { intent: 'chat.reply', confidence: 1.0, reason: 'empty_message', subject: '' };
  }

  // Fast-path : éviter l'appel LLM pour les cas évidents
  const fastPath = fastPathVideoIntent(normalized)
    || fastPathSoundIntent(normalized)
    || fastPathImageIntent(normalized)
    || fastPathWebImageIntent(normalized);

  if (fastPath && fastPath.confidence >= 0.95) {
    return { ...fastPath, subject: '' };
  }

  if (typeof callStructuredLlmJson !== 'function') {
    // Fallback si LLM indisponible : utiliser les fast-paths avec confiance réduite
    const fallback = fastPath || { intent: 'chat.reply', confidence: 0.5, reason: 'llm_unavailable_fallback' };
    return { ...fallback, subject: '' };
  }

  try {
    const response = await callStructuredLlmJson({
      text: JSON.stringify({ message }),
      systemPrompt: INTENT_DETECTION_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 120,
      timeoutMs: Math.max(3000, Number(timeoutMs) || 8000),
      responseFormat: INTENT_DETECTION_RESPONSE_FORMAT,
      stage: 'intent_detection',
    });

    if (!response || typeof response !== 'object') {
      return fastPath || { intent: 'chat.reply', confidence: 0.5, reason: 'llm_invalid_response', subject: '' };
    }

    const validIntents = ['image.generate', 'video.generate', 'sound.generate', 'web.image.search', 'web.search', 'code.python.generate', 'chat.reply'];
    const intent = validIntents.includes(response.intent) ? response.intent : 'chat.reply';
    const confidence = Math.max(0, Math.min(1, Number(response.confidence) || 0.5));
    const reason = String(response.reason || '').trim() || 'llm_classified';
    const subject = String(response.subject || '').trim();

    console.log(`[A11][intent-detection] intent=${intent} confidence=${confidence.toFixed(2)} reason=${reason}`);

    return { intent, confidence, reason, subject };
  } catch (error) {
    console.warn(`[A11][intent-detection] LLM error: ${String(error?.message || error)}, using fast-path`);
    return fastPath || { intent: 'chat.reply', confidence: 0.5, reason: 'llm_error_fallback', subject: '' };
  }
}

// ─── Wrappers booléens compatibles (legacy) ───────────────────────────────────
// Ces fonctions sont conservées pour la compatibilité avec le code existant.
// Elles utilisent uniquement le fast-path synchrone — pas d'appel LLM.
// Pour la détection complète avec confiance, utiliser detectIntentWithLlm().

function detectImageIntent(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = normalizeMessageForIntent(message);
  return Boolean(fastPathImageIntent(normalized));
}

function detectVideoIntent(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = normalizeMessageForIntent(message);
  return Boolean(fastPathVideoIntent(normalized));
}

function detectWebImageIntent(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = normalizeMessageForIntent(message);
  return Boolean(fastPathWebImageIntent(normalized));
}

function detectSoundIntent(message) {
  if (!message || typeof message !== 'string') return false;
  const normalized = normalizeMessageForIntent(message);
  return Boolean(fastPathSoundIntent(normalized));
}

// ─── Extraction du sujet web image (legacy) ───────────────────────────────────

function sanitizeWebImageSubject(candidate) {
  let value = String(candidate || '')
    .replace(/[?.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return null;

  value = value
    .replace(/^(?:moi|me)\s+/i, '')
    .replace(/^(?:une?|des)\s+(?:image|photo|illustration|dessin|portrait)\s+(?:de|du|des|d[''])\s*/i, '')
    .replace(/^(?:image|photo|illustration|dessin|portrait)\s+(?:de|du|des|d[''])\s*/i, '')
    .trim();

  if (!value) return null;
  if (/^(?:sur|depuis)\s+(?:le\s+)?(?:web|internet)$/i.test(value)) return null;

  return value;
}

function extractWebImageSubject(message) {
  if (!message || typeof message !== 'string') return null;

  const patterns = [
    /montre(?:-|\s)?moi\s+(?:une?|des)?\s*(?:image|photo|illustration|dessin|portrait)\s+de\s+([^?.!]+)/i,
    /(?:^|.*?\b)(?:tu peux\s+|peux[-\s]?tu\s+)?(?:me\s+)?(?:montrer|montre|afficher|affiche|fais voir|chercher|cherche|trouver|trouve)\s+([^?.!]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    const candidate = sanitizeWebImageSubject(match?.[1]);
    if (candidate) return candidate;
  }

  return null;
}

module.exports = {
  detectImageIntent,
  detectIntentWithLlm,
  detectSoundIntent,
  detectVideoIntent,
  detectWebImageIntent,
  extractWebImageSubject,
  normalizeMessageForIntent,
};

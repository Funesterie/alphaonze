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
  // Garder le texte original avec accents — le LLM les comprend et en a besoin
  // pour bien interpréter le français. On normalise juste les espaces.
  return String(message || '')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Fast-path heuristique minimal ───────────────────────────────────────────
// Utilisé uniquement pour court-circuiter l'appel LLM sur les cas évidents.
// Ne retourne jamais false — retourne null si incertain.

function fastPathImageIntent(normalized) {
  const hasCreationVerb = /\b(g[eé]n[eè]re|cr[eé]e|dessine|fabrique|produis|generate|create|draw|make|render)\b/i.test(normalized);
  const hasVisualWord = /\b(image|illustration|dessin|photo|visuel|portrait)\b/i.test(normalized);
  const hasTroubleshooting = /\b(explique|pourquoi|probl[eè]me|bug|erreur|fonctionne|marche)\b/i.test(normalized);
  if (hasTroubleshooting && !hasCreationVerb) return null;
  if (hasCreationVerb && hasVisualWord) return { intent: 'image.generate', confidence: 0.95, reason: 'fast_path_creation_verb_visual_word' };
  return null;
}

function fastPathVideoIntent(normalized) {
  const hasCreationVerb = /\b(g[eé]n[eè]re|cr[eé]e|fais|fabrique|produis|generate|create|make|render)\b/i.test(normalized);
  const hasVideoWord = /\b(vid[eé]o|animation|gif|mp4|clip)\b/i.test(normalized);
  if (hasCreationVerb && hasVideoWord) return { intent: 'video.generate', confidence: 0.95, reason: 'fast_path_creation_verb_video_word' };
  return null;
}

function fastPathWebImageIntent(normalized) {
  const hasSearchVerb = /\b(montre|affiche|cherche|trouve|show|find|search)\b/i.test(normalized);
  const hasCreationVerb = /\b(g[eé]n[eè]re|cr[eé]e|dessine|fabrique|produis|generate|create|draw|make|render)\b/i.test(normalized);
  if (hasSearchVerb && !hasCreationVerb && /\b(image|photo|illustration)\b/i.test(normalized)) {
    return { intent: 'web.image.search', confidence: 0.90, reason: 'fast_path_search_verb_image_word' };
  }
  return null;
}

function fastPathSoundIntent(normalized) {
  const hasCreationVerb = /\b(g[eé]n[eè]re|cr[eé]e|produis|compose|generate|create|make|produce|synthesize)\b/i.test(normalized);
  const hasSoundWord = /\b(son|audio|musique|music|sound|bruit|noise|tts|voix|voice|parole|speech|mp3|wav|ogg)\b/i.test(normalized);
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

const INTENT_DETECTION_SYSTEM_PROMPT = `You are A11 intent's media classifier, a creative AI assistant that generates images, videos, and sounds.

Your job: read the user message and decide what they want.

Intents:
- image.generate — user explicitly wants an image created or transformed
- video.generate — user wants a video or animation created
- sound.generate — user wants audio, music, or speech created
- web.image.search — user wants to see an existing image from the web
- web.search — user wants to find information on the web
- code.python.generate — user wants Python code written
- chat.reply — conversation, questions, comments, reactions, analysis, descriptions

Rules:
- Explicit creation verbs (génère, crée, dessine, make, draw, create, render) → image.generate or video.generate
- A question ("c'est quoi", "pourquoi", "comment", "qu'est-ce que") → chat.reply
- A comment or reaction ("regarde ce beau lapin", "j'aime cette photo", "c'est magnifique") → chat.reply
- A description without a creation verb → chat.reply (the user is sharing, not requesting)
- "Montre-moi une image de X" → web.image.search
- When an image is attached and the user says nothing or just comments on it → chat.reply
- When an image is attached and the user asks to transform/recreate/modify it → image.generate
- Conversation history matters: if the user was just chatting, a bare description is likely chat.reply

confidence: how certain you are (0.0–1.0)
subject: main subject in English, empty for chat.reply
reason: one short sentence

Return strict JSON only.`;

// ─── Détection LLM principale ─────────────────────────────────────────────────

async function detectIntentWithLlm({
  message = '',
  imageDescription = '',
  conversationHistory = [],
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 8000,
} = {}) {
  // Pour les fast-paths regex, on garde le texte normalisé (lowercase, espaces)
  // mais ON GARDE LES ACCENTS pour que les regex accentuées matchent.
  const normalized = normalizeMessageForIntent(message).toLowerCase();

  // Pour le LLM, on passe le message original avec accents et casse.
  const originalMessage = String(message || '').replace(/\s+/g, ' ').trim();

  if (!normalized && !imageDescription) {
    return { intent: 'chat.reply', confidence: 1.0, reason: 'empty_message', subject: '' };
  }

  // Fast-path uniquement si pas d'image jointe et pas d'historique ambigu
  // (on ne veut pas court-circuiter le LLM quand le contexte est important)
  const hasImage = Boolean(String(imageDescription || '').trim());
  const hasHistory = Array.isArray(conversationHistory) && conversationHistory.length > 0;

  if (!hasImage && !hasHistory) {
    const fastPath = fastPathVideoIntent(normalized)
      || fastPathSoundIntent(normalized)
      || fastPathImageIntent(normalized)
      || fastPathWebImageIntent(normalized);

    if (fastPath && fastPath.confidence >= 0.95) {
      return { ...fastPath, subject: '' };
    }
  }

  if (typeof callStructuredLlmJson !== 'function') {
    const fastPath = fastPathVideoIntent(normalized)
      || fastPathSoundIntent(normalized)
      || fastPathImageIntent(normalized)
      || fastPathWebImageIntent(normalized);
    const fallback = fastPath || { intent: 'chat.reply', confidence: 0.5, reason: 'llm_unavailable_fallback' };
    return { ...fallback, subject: '' };
  }

  // Construire le contexte pour le LLM
  const context = {
    message: originalMessage || null,
    image_attached: hasImage,
    image_description: hasImage ? String(imageDescription).trim() : null,
    recent_history: hasHistory
      ? conversationHistory.slice(-4).map((entry) => ({
          role: String(entry?.role || 'user').trim(),
          content: String(entry?.content || '').trim().slice(0, 200),
        }))
      : null,
  };

  try {
    const response = await callStructuredLlmJson({
      text: JSON.stringify(context),
      systemPrompt: INTENT_DETECTION_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 120,
      timeoutMs: Math.max(3000, Number(timeoutMs) || 8000),
      responseFormat: INTENT_DETECTION_RESPONSE_FORMAT,
      stage: 'intent_detection',
    });

    if (!response || typeof response !== 'object') {
      const fastPath = fastPathVideoIntent(normalized) || fastPathImageIntent(normalized);
      return fastPath || { intent: 'chat.reply', confidence: 0.5, reason: 'llm_invalid_response', subject: '' };
    }

    const validIntents = ['image.generate', 'video.generate', 'sound.generate', 'web.image.search', 'web.search', 'code.python.generate', 'chat.reply'];
    const intent = validIntents.includes(response.intent) ? response.intent : 'chat.reply';
    const confidence = Math.max(0, Math.min(1, Number(response.confidence) || 0.5));
    const reason = String(response.reason || '').trim() || 'llm_classified';
    const subject = String(response.subject || '').trim();

    console.log(`[A11][intent-detection] intent=${intent} confidence=${confidence.toFixed(2)} reason=${reason}${hasImage ? ' [+image]' : ''}${hasHistory ? ' [+history]' : ''}`);

    return { intent, confidence, reason, subject };
  } catch (error) {
    console.warn(`[A11][intent-detection] LLM error: ${String(error?.message || error)}, using fast-path`);
    const fastPath = fastPathVideoIntent(normalized)
      || fastPathSoundIntent(normalized)
      || fastPathImageIntent(normalized)
      || fastPathWebImageIntent(normalized);
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

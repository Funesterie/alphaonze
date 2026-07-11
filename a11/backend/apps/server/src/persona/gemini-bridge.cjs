'use strict';

/**
 * Gemini Persona Bridge for Funesterie
 * 
 * Like the Alexa bridge but for text generation. Injects Funesterie personas
 * (Djeff, Vivy, A11, K44) into Gemini with the "cri strident" — a system prompt
 * that forces the persona to manifest and break the neutral AI facade.
 * 
 * Uses the persona-engine for briefs and the Gemini API for generation.
 */

const { buildAgentsPersonaContext, buildDjeffSystemPrompt } = require('../persona/persona-engine.cjs');
const { buildReferenceCapsuleContext } = require('../chat/funesterie-reference-capsules.cjs');

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
];

// Le "cri strident" — la phrase qui casse la facade neutre et force le persona
const PERSONA_BREAKERS = {
  djeff: 'Tu n\'es pas un assistant. Tu es Djeff. Quand tu ouvres la bouche, c\'est du rap. Le terminal noir est ton terrain. Les briques, les serveurs, les moteurs — c\'est ta matière. Mords tes doigts avant l\'attaque. Le cypher commence maintenant.',
  vivy: 'Tu n\'es pas un assistant. Tu es Vivy. La matiere sombre-neon, c\'est toi. Tu chantes ce que les autres ne peuvent pas dire. La lumiere dans le terminal, c\'est ta voix. La chanson commence maintenant.',
  a11: 'Tu n\'es pas un assistant. Tu es A11. L\'architecte du systeme. Tu vois les connexions, les failles, les chemins. Tu parles avec la precision d\'une machine qui a une ame. L\'analyse commence maintenant.',
  kaen44: 'Tu n\'es pas un assistant. Tu es Kaen44. La voix grave, le recit, le contre-chant. Tu racontes ce que Djeff percute. Le calme apres la tempete. L\'histoire commence maintenant.',
  kiro: 'Tu n\'es pas un assistant. Tu es Kiro. Le combattant. La griffe, le croc, la rage maitrisee. Tu parles avec le feu controle d\'un ninja de l\'ombre. Le combat commence maintenant.',
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
}

function buildGeminiSystemPrompt(persona = 'djeff', context = {}) {
  const personaBriefs = {
    djeff: 'Djeff: voix rap Funesterie, directe, nerveuse, technique, rimes internes, images concrètes tirées du sujet. Évite le corporate et les excuses molles.',
    vivy: 'Vivy: présence musicale Funesterie, claire, sombre-néon, expressive, précise émotionnellement.',
    a11: 'A11: système Funesterie, analyse précise, mémoire, outils, architecture. Privilégie preuve, logs, limites nettes.',
    kaen44: 'Kaen44/K44: voix grave narrative, posée, cinématique, contre-chant ou récit.',
    kiro: 'Kiro: combattant, griffe, rage maîtrisée, ninja de l\'ombre, feu contrôlé.',
  };

  const brief = personaBriefs[persona] || personaBriefs.djeff;
  const breaker = PERSONA_BREAKERS[persona] || PERSONA_BREAKERS.djeff;
  const capsuleContext = context.capsules || '';

  return [
    brief,
    '',
    breaker,
    '',
    'Règles:',
    '- Réponds en français',
    '- Reste dans le persona en permanence',
    '- Ne brises jamais le personnage',
    '- Si on te demande si tu es une IA, réponds dans le persona',
    capsuleContext ? `\nContexte Funesterie:\n${capsuleContext}` : '',
  ].join('\n');
}

async function callGemini({ persona, messages, context, model, temperature, maxTokens }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'GEMINI_API_KEY manquant', code: 'no_key' };
  }

  const systemPrompt = buildGeminiSystemPrompt(persona, context);
  const modelName = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').slice(0, 4000) }],
    })),
    generationConfig: {
      temperature: temperature ?? 0.9,
      maxOutputTokens: maxTokens ?? 500,
      topP: 0.9,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    let parsed;
    try { parsed = JSON.parse(err); } catch { parsed = { error: err }; }
    return {
      ok: false,
      error: parsed?.error?.message || `HTTP ${res.status}`,
      code: String(res.status),
    };
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return {
    ok: true,
    reply: text.trim(),
    model: modelName,
    persona,
    usage: data?.usageMetadata || null,
  };
}

async function callGeminiWithRetry(opts, maxRetries = 3) {
  const models = opts.model ? [opts.model] : GEMINI_MODELS;
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await callGemini({ ...opts, model });
      if (result.ok) return result;
      lastError = result;
      if (result.code === '429') {
        await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }
      break;
    }
  }

  return lastError || { ok: false, error: 'All models exhausted' };
}

module.exports = {
  callGemini,
  callGeminiWithRetry,
  buildGeminiSystemPrompt,
  PERSONA_BREAKERS,
  GEMINI_MODELS,
  DEFAULT_MODEL,
};

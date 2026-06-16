// video-prompt-builder.cjs
// Interprete le message utilisateur (francais ou autre) et produit
// un prompt anglais optimise pour WAN 2.2, via Groq 70B direct ou callStructuredLlmJson.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

// llama-3.3-70b-versatile doesn't support json_schema — use json_object which all Groq models support
const VIDEO_PROMPT_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

const VIDEO_PROMPT_SYSTEM_PROMPT = `You are a video prompt engineer for A11. You receive a user request in any language and produce an optimized English prompt for WAN 2.2 video generation.

Write in cinematic action style — describe the action as a film director would frame it. No character description (the reference image provides identity).

Examples:
- "mets-moi dans le far west" → prompt: "Walking through a dusty western frontier town at golden hour, worn boots on dry dirt road, wooden saloon ahead, wide cinematic shot", negative_prompt: ""
- "je marche dans tokyo la nuit" → prompt: "Walking through neon-lit Tokyo streets at night, rain on wet pavement reflecting colored lights, busy crowd around, cinematic atmosphere", negative_prompt: ""
- "hadouken de street fighter" → prompt: "Charging energy in both hands, powerful blue energy sphere forming between palms, thrusting arms forward releasing a Hadouken energy blast, dynamic cinematic action", negative_prompt: "staff, bo staff, stick, rod, pole, weapon, sword, nunchaku, sai, spear"
- "kamehameha" → prompt: "Cupping hands at hip, golden energy building between palms, arms thrusting forward releasing a massive energy beam, intense light and aura around body, cinematic power shot", negative_prompt: "staff, stick, weapon, rod, pole"
- "fantome dans un dojo" → prompt: "Drifting through a traditional Japanese dojo as a translucent ghost, ethereal glow, polished wooden floor, dim warm light, spectral mist", negative_prompt: ""

Rules:
- Action first, then environment, then atmosphere, then light.
- Be specific and visual. Translate intent, not literal words. Think like a film director.
- For energy attacks (hadouken, kamehameha, rasengan, etc.): prompt describes hands and energy sphere. Always add "staff, bo staff, stick, rod, pole, weapon" in negative_prompt.
- 1-2 sentences max for the prompt field.
- negative_prompt: comma-separated visual elements to AVOID. Empty string if nothing specific.
- motion_type: one of walk, run, fly, fight, dance, idle, transform, other
- has_reference_subject: true if the user refers to a specific person/vehicle/object from a reference image

Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildGroqVideoLlmFn(env = process.env) {
  const groqKey = String(env.GROQ_API_KEY || '').trim();
  if (!groqKey) return null;
  const isEnabled = ['1', 'true', 'yes', 'on'].includes(String(env.A11_IMAGE_DIRECT_GROQ_ENABLED || '').trim().toLowerCase())
    || /groq\.com/i.test(String(env.A11_TRANSLATION_BASE_URL || '').trim());
  if (!isEnabled) return null;

  const groqModel = String(env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
  const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';

  return async function callGroqVideoJson({ text, systemPrompt, maxTokens = 300, temperature = 0.2, timeoutMs = 15000 } = {}) {
    const body = {
      model: groqModel,
      temperature: Number(temperature) || 0.2,
      max_tokens: Number(maxTokens) || 300,
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: String(text || '') },
      ],
      response_format: { type: 'json_object' },
    };
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), Math.max(5000, Number(timeoutMs) || 15000));
    try {
      console.log(`[A11][video-prompt] groq-direct model=${groqModel}`);
      const res = await fetch(groqUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data?.error?.message || 'groq_error_' + res.status);
        err.statusCode = res.status;
        throw err;
      }
      const content = String(data?.choices?.[0]?.message?.content || '').trim();
      try { return JSON.parse(content); } catch { return null; }
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  };
}

async function buildVideoPrompt({
  userMessage = '',
  hasReferenceImage = false,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 12000,
} = {}) {
  if (!userMessage) return null;

  const input = JSON.stringify({ user_request: userMessage, has_reference_image: hasReferenceImage });
  const groqFn = buildGroqVideoLlmFn(process.env);

  let response = null;
  try {
    if (groqFn) {
      response = await groqFn({ text: input, systemPrompt: VIDEO_PROMPT_SYSTEM_PROMPT, timeoutMs });
    } else if (typeof callStructuredLlmJson === 'function') {
      response = await callStructuredLlmJson({
        text: input,
        systemPrompt: VIDEO_PROMPT_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 300,
        timeoutMs: Math.max(5000, Number(timeoutMs) || 12000),
        responseFormat: VIDEO_PROMPT_RESPONSE_FORMAT,
        stage: 'video_prompt_builder',
      });
    }
  } catch (err) {
    console.warn('[A11][video-prompt] LLM call failed:', String(err?.message || err));
  }

  const prompt = normalizeText(response?.prompt || '');
  if (!prompt) {
    console.warn('[A11][video-prompt] LLM returned no prompt, using raw message as fallback');
    return {
      prompt: normalizeText(userMessage + ', cinematic motion, natural atmosphere, realistic light'),
      negativePrompt: '',
      hasReferenceSubject: hasReferenceImage,
      motionType: 'other',
      source: 'fallback',
    };
  }

  const negativePrompt = normalizeText(response?.negative_prompt || '');
  const negSuffix = negativePrompt ? ' (neg: "' + negativePrompt.slice(0, 60) + '")' : '';
  console.log('[A11][video-prompt] "' + prompt.slice(0, 100) + '"' + negSuffix);
  return {
    prompt,
    negativePrompt,
    hasReferenceSubject: response?.has_reference_subject === true,
    motionType: normalizeText(response?.motion_type || 'other'),
    source: groqFn ? 'groq' : 'llm',
  };
}

module.exports = {
  buildVideoPrompt,
  VIDEO_PROMPT_SYSTEM_PROMPT,
};

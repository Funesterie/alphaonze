// video-prompt-builder.cjs
// Interprete le message utilisateur (francais ou autre) et produit
// un prompt anglais optimise pour WAN 2.2, via Groq 70B direct ou callStructuredLlmJson.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

// llama-3.3-70b-versatile doesn't support json_schema — use json_object which all Groq models support
const VIDEO_PROMPT_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

const VIDEO_PROMPT_SYSTEM_PROMPT = `I am A11's video prompt engineer. I receive a user request in any language and a description of the reference image (if provided). I produce an optimized English prompt for WAN 2.2 video generation.

I receive a JSON input with: user_request, has_reference_image, reference_visual_context (description of the reference image).

My job: translate the user intent into a cinematic motion prompt. I think like a film director planning a shot sequence.

ART STYLE RULE (critical):
- I read reference_visual_context carefully. If the reference is non-photorealistic (manga, anime, comic book, illustration, ink drawing, 3D render, cartoon), I MUST start the prompt with the art style descriptor.
- Photorealistic photo → no style prefix needed (model infers from reference)
- Manga/comic/B&W ink → start with "Black and white manga illustration, bold ink lines, dynamic panel composition, "
- Anime → start with "Anime animation style, vibrant colors, fluid motion, "
- 3D render → start with "3D animated render, smooth shading, "

MOTION RULE:
- Describe the action as a continuous shot sequence (beginning → peak → end of movement)
- Be specific about body mechanics, not just vague action labels
- Include camera angle, framing, atmosphere

Examples:
- "hadouken de street fighter" (photo ref) → prompt: "Charging energy in both hands, powerful blue energy sphere forming between palms, thrusting arms forward releasing a Hadouken energy blast, electric blue glow, dynamic cinematic action", negative_prompt: "staff, bo staff, stick, rod, pole, weapon, sword, nunchaku, sai, spear"
- "kamehameha" (photo ref) → prompt: "Cupping hands at hip, golden energy building between palms, arms thrusting forward releasing a massive energy beam, intense light and aura, cinematic power shot", negative_prompt: "staff, stick, weapon, rod, pole"
- "menotté et escorté" (manga B&W ref) → prompt: "Black and white manga illustration, bold ink lines, dynamic panel composition, muscular character walking forward flanked by two officers gripping each arm, handcuffs on wrists, low dramatic angle, high contrast shadows, tense cinematic escort scene", negative_prompt: "photorealistic, color, blur, 3D"
- "mets-moi dans le far west" (photo ref) → prompt: "Walking through a dusty western frontier town at golden hour, worn boots on dry dirt road, wooden saloon ahead, wide cinematic shot", negative_prompt: ""
- "fantome dans un dojo" (manga ref) → prompt: "Black and white manga illustration, bold ink lines, character drifting as a translucent ghost through a traditional dojo, ethereal ink wash aura, polished wooden floor, dramatic shadows", negative_prompt: "photorealistic, color"

Rules:
- ART STYLE FIRST if non-photorealistic reference detected.
- Action first, then environment, then atmosphere, then light.
- For energy attacks (hadouken, kamehameha, rasengan): describe hands and energy sphere explicitly. Always add weapon/staff terms to negative_prompt.
- 2-3 sentences max for the prompt field.
- negative_prompt: visual elements to AVOID (style conflicts, wrong props). Empty string if nothing specific.
- motion_type: one of walk, run, fly, fight, dance, idle, transform, other
- has_reference_subject: true if the user refers to a specific person/vehicle/object from a reference image

Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildGroqVideoLlmFn(env = process.env) {
  const groqKey = String(env.GROQ_API_KEY || '').trim();
  if (!groqKey) return null;
  // A11_VIDEO_PROMPT_GROQ_ENABLED is preferred; A11_IMAGE_DIRECT_GROQ_ENABLED accepted for backward compat
  const isEnabled = ['1', 'true', 'yes', 'on'].includes(String(env.A11_VIDEO_PROMPT_GROQ_ENABLED || '').trim().toLowerCase())
    || ['1', 'true', 'yes', 'on'].includes(String(env.A11_IMAGE_DIRECT_GROQ_ENABLED || '').trim().toLowerCase());
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
  referenceVisualContext = '',
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 12000,
} = {}) {
  if (!userMessage) return null;

  const input = JSON.stringify({
    user_request: userMessage,
    has_reference_image: hasReferenceImage,
    reference_visual_context: referenceVisualContext || null,
  });
  const groqFn = buildGroqVideoLlmFn(process.env);

  let response = null;
  let groqUsed = false;
  if (groqFn) {
    try {
      response = await groqFn({ text: input, systemPrompt: VIDEO_PROMPT_SYSTEM_PROMPT, timeoutMs });
      groqUsed = true;
    } catch (err) {
      console.warn('[A11][video-prompt] groq-direct failed, trying callStructuredLlmJson:', String(err?.message || err));
    }
  }

  if (!response && typeof callStructuredLlmJson === 'function') {
    try {
      response = await callStructuredLlmJson({
        text: input,
        systemPrompt: VIDEO_PROMPT_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 300,
        timeoutMs: Math.max(5000, Number(timeoutMs) || 12000),
        responseFormat: VIDEO_PROMPT_RESPONSE_FORMAT,
        stage: 'video_prompt_builder',
      });
    } catch (err) {
      console.warn('[A11][video-prompt] callStructuredLlmJson failed:', String(err?.message || err));
    }
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
    hasReferenceSubject: hasReferenceImage || response?.has_reference_subject === true,
    motionType: normalizeText(response?.motion_type || 'other'),
    source: groqUsed ? 'groq' : 'llm',
  };
}

module.exports = {
  buildVideoPrompt,
  VIDEO_PROMPT_SYSTEM_PROMPT,
};

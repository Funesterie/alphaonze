// video-prompt-builder.cjs
// Interprete le message utilisateur (francais ou autre) et produit
// un prompt anglais optimise pour WAN 2.2, via LLM.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

// llama-3.3-70b-versatile doesn't support json_schema — use json_object which all Groq models support
const VIDEO_PROMPT_RESPONSE_FORMAT = Object.freeze({
  type: 'json_object',
});

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

async function buildVideoPrompt({
  userMessage = '',
  hasReferenceImage = false,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 12000,
} = {}) {
  if (!userMessage) return null;

  const input = JSON.stringify({
    user_request: userMessage,
    has_reference_image: hasReferenceImage,
  });

  try {
    const response = await callStructuredLlmJson({
      text: input,
      systemPrompt: VIDEO_PROMPT_SYSTEM_PROMPT,
      temperature: 0.2,
      maxTokens: 200,
      timeoutMs: Math.max(5000, Number(timeoutMs) || 12000),
      responseFormat: VIDEO_PROMPT_RESPONSE_FORMAT,
      stage: 'video_prompt_builder',
    });

    const prompt = normalizeText(response?.prompt || '');
    if (!prompt) return null;

    const negativePrompt = normalizeText(response?.negative_prompt || '');
    const negSuffix = negativePrompt ? ' (neg: "' + negativePrompt.slice(0, 60) + '")' : '';
    console.log(`[A11][video-prompt] "${prompt.slice(0, 100)}"${negSuffix}`);
    return {
      prompt,
      negativePrompt,
      hasReferenceSubject: response?.has_reference_subject === true,
      motionType: normalizeText(response?.motion_type || 'other'),
      source: 'llm',
    };
  } catch (err) {
    console.warn('[A11][video-prompt] LLM failed, using raw message as fallback:', String(err?.message || err));
    const prompt = normalizeText(`${userMessage}, cinematic motion, natural atmosphere, realistic light`);
    return {
      prompt,
      negativePrompt: '',
      hasReferenceSubject: hasReferenceImage,
      motionType: 'other',
      source: 'fallback',
    };
  }
}

module.exports = {
  buildVideoPrompt,
  VIDEO_PROMPT_SYSTEM_PROMPT,
};

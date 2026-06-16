// video-prompt-builder.cjs
// Interprete le message utilisateur (francais ou autre) et produit
// un prompt anglais optimise pour WAN 2.2 / fal-ai, style action a la premiere personne.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

const VIDEO_PROMPT_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'video_prompt_request',
    strict: true,
    schema: {
      type: 'object',
      required: ['prompt', 'has_reference_subject', 'motion_type'],
      properties: {
        prompt: { type: 'string' },
        has_reference_subject: { type: 'boolean' },
        motion_type: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
});

const VIDEO_PROMPT_SYSTEM_PROMPT = `You are a video prompt engineer for A11. You receive a user request in any language and produce an optimized English prompt for WAN 2.2 video generation.

Write in first-person action style — describe the scene as lived from within, not as an outside observer.

Examples:
- "mets-moi dans le far west" → "Walking through a dusty western frontier town, warm golden sunset light, wooden saloon ahead, spurs clinking, dry desert wind, cinematic wide angle"
- "je marche dans tokyo la nuit" → "Walking through neon-lit Tokyo streets at night, rain on the pavement reflecting colored lights, crowds passing, city energy all around, cinematic atmosphere"
- "je vole au dessus des nuages" → "Soaring above thick white clouds, blue sky above, sunlight breaking through, wind rush, vast aerial panorama, golden hour light"
- "fantôme dans un dojo" → "Drifting through a traditional Japanese dojo as a translucent ghost, ethereal glow, wooden floor, dim lighting, spectral mist swirling around feet"

Rules:
- Action first, then environment, then atmosphere, then light. No subject description (the model image provides identity).
- Be specific and visual. Interpret intent, not literal words. Think like a film director.
- 1-2 sentences max for the prompt field.
- motion_type: one of walk, run, fly, fight, dance, idle, transform, other
- has_reference_subject: true if the user refers to themselves or a specific person/vehicle/object from a reference image

Return strict JSON only.`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function foldText(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isTruthy(value = '') {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldUseVideoPromptLlm(env = process.env) {
  return isTruthy(env.A11_VIDEO_PROMPT_BUILDER_LLM || env.A11_VIDEO_PROMPT_LLM);
}

function inferMotionType(folded = '') {
  if (/\b(marche|marcher|walk|walking|balade|promene)\b/.test(folded)) return 'walk';
  if (/\b(cours|courir|run|running|sprint)\b/.test(folded)) return 'run';
  if (/\b(vole|voler|fly|flying|plane|nuage|nuages|clouds?)\b/.test(folded)) return 'fly';
  if (/\b(combat|fight|fighting|attaque|frappe|karate|dojo)\b/.test(folded)) return 'fight';
  if (/\b(danse|danser|dance|dancing)\b/.test(folded)) return 'dance';
  if (/\b(transforme|transformation|deviens|fantome|ghost)\b/.test(folded)) return 'transform';
  if (/\b(roule|rouler|ride|riding|moto|50cc|mecaboite|scooter|cross|beta|am6)\b/.test(folded)) return 'other';
  return 'other';
}

function buildHeuristicVideoPrompt({ userMessage = '', hasReferenceImage = false } = {}) {
  const text = normalizeText(userMessage);
  if (!text) return null;
  const folded = foldText(text);
  const motionType = inferMotionType(folded);

  let action = 'Moving through the requested scene';
  if (motionType === 'walk') action = 'Walking forward through the scene';
  else if (motionType === 'run') action = 'Running forward with dynamic camera motion';
  else if (motionType === 'fly') action = 'Soaring through the air';
  else if (motionType === 'fight') action = 'Moving into a focused action stance';
  else if (motionType === 'dance') action = 'Dancing with smooth rhythmic motion';
  else if (motionType === 'transform') action = 'Transforming within the scene';
  else if (/\b(roule|rouler|ride|riding|moto|50cc|mecaboite|scooter|cross|beta|am6)\b/.test(folded)) action = 'Riding forward with stable cinematic motion';

  let environment = `based on the user request: ${text}`;
  if (/\b(tokyo|neon|nuit|night)\b/.test(folded)) {
    environment = 'through neon-lit Tokyo streets at night, wet pavement reflecting colored lights';
  } else if (/\b(far west|western|cowboy|saloon|desert)\b/.test(folded)) {
    environment = 'through a dusty western frontier town, wooden saloon ahead, dry desert wind';
  } else if (/\b(dojo|karate|japon|japanese)\b/.test(folded)) {
    environment = 'inside a traditional Japanese dojo, polished wooden floor, dim warm light';
  } else if (/\b(nuage|nuages|clouds?|ciel|sky)\b/.test(folded)) {
    environment = 'above thick white clouds, blue sky and sunlight breaking through';
  } else if (/\b(50cc|mecaboite|mecaboîte|beta|am6|oko|powerjet|metrakit|cross)\b/.test(folded)) {
    environment = 'with the reference 50cc mecaboite bike kept faithful, outdoor action shot, realistic small-displacement two-stroke style';
  }

  const subjectRule = hasReferenceImage
    ? 'keep the reference subject identity and proportions faithful'
    : 'clear main subject, readable silhouette';
  const prompt = normalizeText(`${action} ${environment}, ${subjectRule}, cinematic motion, natural atmosphere, realistic light.`);
  return {
    prompt,
    hasReferenceSubject: hasReferenceImage || /\b(moi|me|myself|selfie|reference|photo|image|cette|ce)\b/.test(folded),
    motionType,
    source: 'heuristic',
  };
}

async function buildVideoPrompt({
  userMessage = '',
  hasReferenceImage = false,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 12000,
} = {}) {
  if (!userMessage) return null;
  const heuristicPrompt = buildHeuristicVideoPrompt({ userMessage, hasReferenceImage });
  if (!shouldUseVideoPromptLlm()) return heuristicPrompt;
  if (typeof callStructuredLlmJson !== 'function') return heuristicPrompt;

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

    console.log(`[A11][video-prompt] "${prompt.slice(0, 100)}"`);
    return {
      prompt,
      hasReferenceSubject: response?.has_reference_subject === true,
      motionType: normalizeText(response?.motion_type || 'other'),
      source: 'llm',
    };
  } catch {
    return heuristicPrompt;
  }
}

module.exports = {
  buildVideoPrompt,
  buildHeuristicVideoPrompt,
  shouldUseVideoPromptLlm,
  VIDEO_PROMPT_SYSTEM_PROMPT,
};

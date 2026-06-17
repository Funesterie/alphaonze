// video-prompt-builder.cjs
// Interprete le message utilisateur (francais ou autre) et produit
// un prompt anglais optimise pour WAN 2.2, via Groq 70B direct ou callStructuredLlmJson.

const {
  callStructuredLlmJson: defaultCallStructuredLlmJson,
} = require('../mask/resolve-text-to-wazaa.cjs');

// llama-3.3-70b-versatile doesn't support json_schema — use json_object which all Groq models support
const VIDEO_PROMPT_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

const VIDEO_PROMPT_SYSTEM_PROMPT = `I am A11's video prompt engineer. I receive a user request in any language and descriptions of the user's reference images (if provided). I produce an optimized English prompt for WAN 2.2 video generation.

I receive a JSON input with: user_request, has_reference_image, reference_count, reference_image_urls, reference_visual_context (description of one or more reference images).

My job: translate the user intent into a cinematic motion prompt. I think like a film director planning a shot sequence.

IDENTITY ANCHOR RULE (critical):
- If has_reference_image=true, I MUST append to the prompt: "same person as in primary reference image, identical face, hairstyle, costume and body build"
- I never invent a new character look when an identity reference is present -- the primary reference image is the ground truth identity
- DIRECTION PRESERVATION: if reference_visual_context describes the subject facing a specific direction (left/right), write the action prompt in that same direction. Add "mirrored, horizontally flipped" to negative_prompt.

MULTI-REFERENCE / MONTAGE RULE:
- Multiple user-provided references are valid creative material, not a reason to refuse or ask for a new prompt.
- If reference_count > 1, use the first/source reference as the primary identity or main subject unless the user says otherwise.
- Use the other references as role-separated material: style, pose, background, props, lighting, scene parts, or montage inserts.
- For montage, clip, trailer, remix, or "utilise plusieurs refs", describe an ordered composite shot or sequence that combines the references without replacing the primary identity.
- If references conflict, preserve the primary identity and use secondary references only for style/environment/props.

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

ENERGY ATTACK RULE:
- Energy attacks (hadouken, kamehameha, rasengan) = energy ball FORMED BETWEEN PALMS then PUSHED FORWARD
- Never describe side beams, lateral rays, or light-saber effects — those are wrong
- Describe: cupping hands → glowing ball between palms → thrust forward → ball launches ahead

STRUCTURAL INTEGRITY RULE (always):
- negative_prompt MUST always include: "floating limbs, disconnected body parts, disembodied legs, missing torso, incomplete anatomy, cut off body, severed limbs"
- Never omit structural terms from negative_prompt

DURATION RULE:
- duration_seconds: choose based on action complexity
  - Quick strike or single pose: 3
  - Standard action (walk, fight move, escort): 5
  - Complex sequence (transformation, power-up, long escort): 8
- If audio_motion_plan is provided: ALWAYS set duration_seconds to match the audio duration (round to nearest integer, clamp 2–10)
- Default: 5

AUDIO SYNC RULE (when audio_motion_plan is provided):
- The audio_motion_plan gives you a TemporalActionField: tMs=time in ms, layer=what changes, action=what happens
- Your prompt MUST describe the motion as a sequence that matches these sync points
- layer "camera" → camera move or cut
- layer "body" → character posture change or motion peak
- layer "background_fx" → energy burst, flash, FX in background
- layer "face" → facial expression change, vocal phrase
- Weave the temporal sync points into the motion description naturally (beginning → peak → end)
- Do NOT list timestamps in the prompt — describe the sequence as flowing cinematic action

Examples:
- "hadouken de street fighter" (photo ref) → prompt: "Fighter drops into wide karate stance, cupping hands at hip level, bright blue energy ball forming between palms glowing intensely, thrusting both hands forward to launch the Hadouken energy ball straight ahead, electric blue aura, low-angle cinematic action shot, same person as in reference image, identical face, hairstyle, costume and body build", negative_prompt: "laser, beam, ray, light saber, staff, bo staff, stick, rod, pole, weapon, sword, nunchaku, sai, spear, side beams, floating limbs, disconnected body parts, disembodied legs, missing torso, incomplete anatomy", duration_seconds: 5
- "kamehameha" (photo ref) → prompt: "Cupping hands at hip, golden energy building between palms into a tight ball, thrusting both hands forward releasing the Kamehameha energy beam straight ahead, intense golden aura, same person as in reference image, identical face and costume", negative_prompt: "staff, stick, weapon, rod, pole, laser, side beams, light saber"
- "menotté et escorté" (manga B&W ref) → prompt: "Black and white manga illustration, bold ink lines, dynamic panel composition, muscular character walking forward flanked by two officers gripping each arm, handcuffs on wrists, low dramatic angle, high contrast shadows, tense cinematic escort scene, same person as in reference image, identical face and body build", negative_prompt: "photorealistic, color, blur, 3D, floating limbs, disconnected body parts, disembodied legs, missing torso, incomplete anatomy", duration_seconds: 5
- "mets-moi dans le far west" (photo ref) → prompt: "Walking through a dusty western frontier town at golden hour, worn boots on dry dirt road, wooden saloon ahead, wide cinematic shot, same person as in reference image, identical face and outfit", negative_prompt: "floating limbs, disconnected body parts, missing torso, incomplete anatomy", duration_seconds: 5
- "fantome dans un dojo" (manga ref) → prompt: "Black and white manga illustration, bold ink lines, character drifting as a translucent ghost through a traditional dojo, ethereal ink wash aura, polished wooden floor, dramatic shadows, same person as in reference image", negative_prompt: "photorealistic, color, floating limbs, disconnected body parts, missing torso", duration_seconds: 5

Rules:
- IDENTITY ANCHOR appended whenever has_reference_image=true.
- MULTI-REFERENCE: if reference_count > 1, keep the primary identity stable and explicitly blend secondary refs as style/environment/props/montage context.
- DIRECTION: if reference describes a facing direction, honor it in the prompt text. Add "mirrored, horizontally flipped" to negative_prompt when has_reference_image=true.
- ART STYLE FIRST if non-photorealistic reference detected.
- Action first, then environment, then atmosphere, then light.
- For energy attacks: palms-forward ball only — no side beams. Add laser/beam/ray to negative_prompt.
- ALWAYS include structural integrity terms in negative_prompt (floating limbs, disconnected body parts, disembodied legs, missing torso, incomplete anatomy, cut off body, severed limbs).
- 2-3 sentences max for the prompt field.
- negative_prompt: style conflicts + wrong props + wrong FX + structural integrity terms + "mirrored, horizontally flipped" (always when ref image).
- duration_seconds: 3 (quick strike), 5 (standard action), 8 (complex sequence). Default 5.
- motion_type: one of walk, run, fly, fight, dance, idle, transform, other
- has_reference_subject: true if the user refers to a specific person/vehicle/object from a reference image

Return strict JSON only: { prompt, negative_prompt, duration_seconds, motion_type, has_reference_subject }`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldUseVideoPromptLlm(env = process.env) {
  return isTruthyEnv(env.A11_VIDEO_PROMPT_BUILDER_LLM)
    || isTruthyEnv(env.A11_VIDEO_PROMPT_LLM)
    || isTruthyEnv(env.A11_VIDEO_PROMPT_GROQ_ENABLED)
    || isTruthyEnv(env.A11_IMAGE_DIRECT_GROQ_ENABLED);
}

function toUniqueStrings(values = [], limit = 8) {
  const source = Array.isArray(values) ? values : [values];
  const output = [];
  const seen = new Set();
  for (const entry of source) {
    const text = normalizeText(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function buildHeuristicVideoPrompt({
  userMessage = '',
  hasReferenceImage = false,
  referenceImageUrls = [],
} = {}) {
  const message = normalizeText(userMessage);
  const folded = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const hasReference = Boolean(hasReferenceImage || toUniqueStrings(referenceImageUrls).length > 0);
  let prompt = message ? `${message}, cinematic motion, natural atmosphere, realistic light` : 'cinematic motion, natural atmosphere, realistic light';
  let motionType = 'other';

  if (/tokyo|shibuya|neon|nuit|night/.test(folded) && /march|walk/.test(folded)) {
    prompt = 'Walking through Tokyo streets at night, rain reflecting neon light, first-person cinematic motion, natural camera sway';
    motionType = 'walk';
  } else if (/far west|western|cowboy|saloon/.test(folded)) {
    prompt = 'Walking through a dusty western frontier town at golden hour, worn boots on dry dirt road, wooden saloon ahead, wide cinematic shot';
    motionType = 'walk';
  } else if (/hadouken|kamehameha|rasengan|energie|energy/.test(folded)) {
    prompt = 'Fighter drops into a wide stance, cupping hands as a glowing energy ball forms between the palms, then thrusting both hands forward to launch it straight ahead, cinematic action shot';
    motionType = 'fight';
  }

  if (hasReference) {
    prompt = `${prompt}, same person as in primary reference image, identical face, hairstyle, costume and body build`;
  }

  return {
    prompt: normalizeText(prompt),
    negativePrompt: hasReference
      ? 'floating limbs, disconnected body parts, disembodied legs, missing torso, incomplete anatomy, cut off body, severed limbs, mirrored, horizontally flipped'
      : 'floating limbs, disconnected body parts, disembodied legs, missing torso, incomplete anatomy, cut off body, severed limbs',
    durationSeconds: /hadouken|kamehameha|rasengan|energie|energy/.test(folded) ? 5 : 4,
    hasReferenceSubject: hasReference,
    motionType,
    source: 'heuristic',
  };
}

function buildGroqVideoLlmFn(env = process.env) {
  const groqKey = String(env.GROQ_API_KEY || '').trim();
  if (!groqKey) return null;
  // A11_VIDEO_PROMPT_GROQ_ENABLED is preferred; A11_IMAGE_DIRECT_GROQ_ENABLED accepted for backward compat
  const isEnabled = isTruthyEnv(env.A11_VIDEO_PROMPT_GROQ_ENABLED)
    || isTruthyEnv(env.A11_IMAGE_DIRECT_GROQ_ENABLED);
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
  referenceImageUrls = [],
  referenceVisualContext = '',
  audioMotionPlan = null,
  callStructuredLlmJson = defaultCallStructuredLlmJson,
  timeoutMs = 12000,
} = {}) {
  if (!userMessage) return null;
  const normalizedReferenceImageUrls = toUniqueStrings(referenceImageUrls, 8);
  const hasReference = Boolean(hasReferenceImage || normalizedReferenceImageUrls.length > 0);

  if (!shouldUseVideoPromptLlm(process.env)) {
    return buildHeuristicVideoPrompt({
      userMessage,
      hasReferenceImage: hasReference,
      referenceImageUrls: normalizedReferenceImageUrls,
    });
  }

  const input = JSON.stringify({
    user_request: userMessage,
    has_reference_image: hasReference,
    reference_count: normalizedReferenceImageUrls.length || (hasReference ? 1 : 0),
    reference_image_urls: normalizedReferenceImageUrls,
    reference_visual_context: referenceVisualContext || null,
    audio_motion_plan: audioMotionPlan
      ? {
          duration_seconds: Math.round((audioMotionPlan.durationMs || 0) / 1000),
          fps: audioMotionPlan.fps,
          events: audioMotionPlan.events,
        }
      : null,
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
      hasReferenceSubject: hasReference,
      motionType: 'other',
      source: 'fallback',
    };
  }

  const negativePrompt = normalizeText(response?.negative_prompt || '');
  const rawDuration = Number(response?.duration_seconds);
  const audioDurationSec = audioMotionPlan?.durationMs
    ? Math.min(10, Math.max(2, Math.round(audioMotionPlan.durationMs / 1000)))
    : 5;
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration >= 2 && rawDuration <= 10
    ? Math.round(rawDuration)
    : audioDurationSec;
  const negSuffix = negativePrompt ? ' (neg: "' + negativePrompt.slice(0, 60) + '")' : '';
  console.log('[A11][video-prompt] "' + prompt.slice(0, 100) + '"' + negSuffix + ' dur=' + durationSeconds + 's');
  return {
    prompt,
    negativePrompt,
    durationSeconds,
    hasReferenceSubject: hasReference || response?.has_reference_subject === true,
    motionType: normalizeText(response?.motion_type || 'other'),
    source: groqUsed ? 'groq' : 'llm',
  };
}

module.exports = {
  buildVideoPrompt,
  shouldUseVideoPromptLlm,
  VIDEO_PROMPT_SYSTEM_PROMPT,
};

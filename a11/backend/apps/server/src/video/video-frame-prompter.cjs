// video-frame-prompter.cjs
// Génère les beats de frames vidéo via LLM structuré,
// avant tout appel SD.

const { callStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');
const { detectSubjectType } = require('./video-sequence-heuristic.cjs');

const FRAME_PROMPTER_MOTION_LABELS = Object.freeze({
  walk_cycle: 'walk cycle',
  run_cycle: 'run cycle',
  power_up_loop: 'power up loop',
  transformation_rise: 'progressive transformation',
  mounted_archery: 'mounted archery',
  archery_shot: 'archery shot',
  action_burst: 'action burst',
  dance_cycle: 'dance cycle',
  gesture_loop: 'gesture loop',
  subtle_loop: 'subtle idle loop',
  generic: 'generic motion',
});

const FRAME_PROMPTER_ANATOMY_HINTS = Object.freeze({
  horse: 'Subject is a horse/pony with 4 legs. Never mention human legs or arms. Use: front leg, back leg, hoof, mane, withers, saddle.',
  quadruped: 'Subject is a 4-legged animal. Never mention human legs or arms. Use: front leg, back leg, paw.',
  dragon: 'Subject is a dragon with 4 legs and wings.',
  humanoid: 'Subject is a human with 2 legs and 2 arms.',
  small_animal: 'Subject is a small 4-legged animal.',
});

const FRAME_PROMPTER_FALLBACK_FRAME = Object.freeze({
  label: 'continuity',
  prompt: 'continue the motion with a clear visible step',
});

const VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT = `You are a video sequence planner for a frame-by-frame image generator.
You receive a video request with a subject, a motion profile and a frame count.
You must produce exactly N frame descriptions, one per frame, progressive and coherent.

Strict rules:
- each frame must describe a concrete and visible step of the motion
- descriptions must match the real anatomy of the subject (4 legs for a horse, 2 legs for a human)
- never invent limbs the subject does not have
- if type_sujet_detecte=horse: use legs/hooves/mane/withers, never human arms or legs
- if type_sujet_detecte=humanoid: use legs, arms, hips, shoulders
- always mention the main subject in each frame description with their appearance (outfit, colors, accessories)
- short, visual descriptions oriented toward image rendering
- output in ENGLISH only, no accents, no special characters
- no numbering in descriptions
- infer the visual style, camera angle and background from the subject and universe (e.g. Street Fighter = side view, 2D anime style, urban Japan fight stage; Mario = colorful cartoon, Mushroom Kingdom; etc.)

Reply ONLY in strict JSON:
{
  "subject_type": "humanoid|horse|quadruped|dragon|other",
  "motion_description": "short description of the global motion in english",
  "scene_context": "camera angle, visual style and background setting inferred from the universe (e.g. side view, 2D anime illustration style, Street Fighter urban Japan stage with neon lights)",
  "frames": [
    { "label": "short name", "prompt": "visual description of this frame in english" },
    ...
  ]
}`;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeStringList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLlmFramePrompterEnabled() {
  const raw = String(process.env.A11_VIDEO_LLM_PROMPTER || '').trim().toLowerCase();
  if (!raw) return true;
  return isTruthy(raw);
}

function buildFramePrompterInput({
  subject,
  motionProfile,
  frameCount,
  prompt,
  identityLocks = [],
  visualContext = '',
  referenceImageWidth = 0,
  referenceImageHeight = 0,
}) {
  const normalizedSubject = normalizeText(subject);
  const normalizedPrompt = normalizeText(prompt);
  const normalizedVisualContext = normalizeText(visualContext);
  const normalizedIdentityLocks = normalizeStringList(identityLocks);
  const motionLabel = FRAME_PROMPTER_MOTION_LABELS[motionProfile] || normalizeText(motionProfile);
  const subjectType = detectSubjectType([normalizedSubject, normalizedPrompt].filter(Boolean).join(' '));
  const anatomyHint = FRAME_PROMPTER_ANATOMY_HINTS[subjectType] || '';
  const referenceImageSize = (
    Number(referenceImageWidth || 0) > 0
    && Number(referenceImageHeight || 0) > 0
  )
    ? `${Number(referenceImageWidth)}x${Number(referenceImageHeight)}`
    : '';

  return JSON.stringify({
    original_request: normalizedPrompt,
    main_subject: normalizedSubject,
    detected_subject_type: subjectType,
    anatomy_constraint: anatomyHint,
    motion_profile: motionProfile,
    motion_label: motionLabel,
    frame_count: frameCount,
    identity_locks: normalizedIdentityLocks,
    visual_context: normalizedVisualContext,
    reference_image_size: referenceImageSize,
    instruction: `Generate exactly ${frameCount} frame descriptions in ENGLISH to animate "${normalizedSubject}" doing a "${motionLabel}". Each frame must mention the full subject with their appearance (outfit, colors, style). ${anatomyHint} ${referenceImageSize ? `A reference image size of ${referenceImageSize} is provided; preserve its portrait/landscape framing unless the motion clearly requires otherwise.` : ''} Do NOT use French words in the output.`,
  }, null, 2);
}

function validateFramePrompterResponse(response) {
  if (!response || typeof response !== 'object') return false;
  if (!Array.isArray(response.frames)) return false;
  if (response.frames.length < 1) return false;
  return response.frames.every(
    (frame) => frame && normalizeText(frame.prompt)
  );
}

function padOrTrimFrames(frames, targetCount) {
  const result = frames
    .slice(0, targetCount)
    .map((frame) => ({
      label: normalizeText(frame?.label || ''),
      prompt: normalizeText(frame?.prompt || ''),
    }));
  while (result.length < targetCount) {
    const lastFrame = result[result.length - 1];
    result.push(lastFrame ? { ...lastFrame } : { ...FRAME_PROMPTER_FALLBACK_FRAME });
  }
  return result;
}

function convertLlmFramesToBeats(frames) {
  return frames.map((frame, index) => ({
    label: normalizeText(frame.label || `frame ${index + 1}`),
    variation: normalizeText(frame.prompt),
    structuralState: normalizeText(frame.prompt),
    checkpoint: index === 0 || index === Math.floor(frames.length / 2) || index === frames.length - 1,
    rendererFocus: [],
  }));
}

async function generateFramePromptsWithLlm({
  subject,
  motionProfile,
  frameCount,
  prompt,
  identityLocks = [],
  visualContext = '',
  referenceImageWidth = 0,
  referenceImageHeight = 0,
  callLlm = callStructuredLlmJson,
  timeoutMs,
} = {}) {
  const resolvedFrameCount = Math.max(0, Number(frameCount) || 0);

  if (!isLlmFramePrompterEnabled()) {
    return { ok: false, reason: 'llm_prompter_disabled', beats: null };
  }
  if (!subject || !motionProfile || resolvedFrameCount < 1) {
    return { ok: false, reason: 'missing_required_params', beats: null };
  }
  if (typeof callLlm !== 'function') {
    return { ok: false, reason: 'llm_unavailable', beats: null };
  }

  const resolvedTimeout = Number(
    timeoutMs
    || process.env.A11_VIDEO_LLM_PROMPTER_TIMEOUT_MS
    || 60000
  ) || 60000;

  try {
    const response = await callLlm({
      text: buildFramePrompterInput({
        subject,
        motionProfile,
        frameCount: resolvedFrameCount,
        prompt,
        identityLocks,
        visualContext,
        referenceImageWidth,
        referenceImageHeight,
      }),
      systemPrompt: VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: Math.max(512, resolvedFrameCount * 80),
      timeoutMs: resolvedTimeout,
    });

    if (!validateFramePrompterResponse(response)) {
      return { ok: false, reason: 'invalid_llm_response', raw: response, beats: null };
    }

    const paddedFrames = padOrTrimFrames(response.frames, resolvedFrameCount);
    const beats = convertLlmFramesToBeats(paddedFrames);

    return {
      ok: true,
      subjectType: normalizeText(response.subject_type || 'unknown'),
      motionDescription: normalizeText(response.motion_description || ''),
      sceneContext: normalizeText(response.scene_context || ''),
      beats,
      frameCount: beats.length,
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || error || 'llm_prompter_failed'),
      beats: null,
    };
  }
}

module.exports = {
  generateFramePromptsWithLlm,
  isLlmFramePrompterEnabled,
  VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT,
};

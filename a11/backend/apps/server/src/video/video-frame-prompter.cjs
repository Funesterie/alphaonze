// video-frame-prompter.cjs
// Genere les beats de frames video via LLM structure,
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

const FRAME_PROMPTER_SUBJECT_STOPWORDS = new Set([
  'the', 'a', 'an', 'with', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'from', 'for',
  'his', 'her', 'its', 'their', 'same', 'main', 'subject', 'character', 'figure',
  'person', 'visible', 'full', 'body', 'shot', 'view',
]);

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
- every frame beat must name the concrete subject directly; never use generic wording like "the structure changes"
- if a key prop matters, mention it concretely in the frame beat
- short, visual descriptions oriented toward image rendering
- output in ENGLISH only, no accents, no special characters
- no numbering in descriptions
- infer the visual style, camera angle and background from the subject and universe (e.g. Street Fighter = side view, 2D anime style, urban Japan fight stage; Mario = colorful cartoon, Mushroom Kingdom; etc.)

Reply ONLY in strict JSON:
{
  "subject_type": "humanoid|horse|quadruped|dragon|other",
  "motion_description": "short description of the global motion in english",
  "scene_context": "camera angle, visual style and background setting inferred from the universe",
  "continuity_locks": ["short continuity anchor"],
  "sound_cues": ["short sound cue"],
  "frame_beats": [
    {
      "label": "short name",
      "prompt": "visual description of this frame in english with the concrete subject named directly",
      "sound_cues": ["optional short sound cue"],
      "continuity_locks": ["optional short continuity lock"],
      "scene_context": "optional short frame-specific scene cue"
    }
  ],
  "frames": [
    { "label": "short name", "prompt": "legacy fallback visual description of this frame in english" }
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

function collectNormalizedList(...values) {
  return normalizeStringList(values.flatMap((entry) => (
    Array.isArray(entry) ? entry : [entry]
  )));
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLlmFramePrompterEnabled() {
  const raw = String(process.env.A11_VIDEO_LLM_PROMPTER || '').trim().toLowerCase();
  if (!raw) return true;
  return isTruthy(raw);
}

function extractSubjectKeywords(subject = '') {
  return [...new Set(
    normalizeText(subject)
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 3 && !FRAME_PROMPTER_SUBJECT_STOPWORDS.has(entry))
  )].slice(0, 8);
}

function extractFrameEntries(response = {}) {
  if (Array.isArray(response?.frame_beats) && response.frame_beats.length) {
    return response.frame_beats;
  }
  return Array.isArray(response?.frames) ? response.frames : [];
}

function framePromptMentionsSubject(framePrompt = '', subject = '') {
  const normalizedPrompt = normalizeText(framePrompt).toLowerCase();
  if (!normalizedPrompt) return false;
  if (/\bstructure\b/i.test(normalizedPrompt)) return false;

  const subjectKeywords = extractSubjectKeywords(subject);
  if (subjectKeywords.length > 0) {
    return subjectKeywords.some((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(normalizedPrompt));
  }

  return true;
}

function hasConcreteFrameTarget(framePrompt = '') {
  const normalizedPrompt = normalizeText(framePrompt).toLowerCase();
  if (!normalizedPrompt) return false;
  return /\b(sword|blade|hilt|armor|armour|gauntlet|cape|bow|arrow|shield|gun|pistol|bat|staff|horse|hoof|mane|face|hair|aura|energy|hall|torch|crown|helmet|fists?)\b/i.test(normalizedPrompt);
}

function concretizeFramePrompt(framePrompt = '', subject = '') {
  let normalizedPrompt = normalizeText(framePrompt);
  const normalizedSubject = normalizeText(subject);
  if (!normalizedPrompt || !normalizedSubject) return normalizedPrompt;
  if (framePromptMentionsSubject(normalizedPrompt, normalizedSubject)) return normalizedPrompt;

  if (/\bthe structure\b/i.test(normalizedPrompt) && hasConcreteFrameTarget(normalizedPrompt)) {
    normalizedPrompt = normalizedPrompt.replace(/\bthe structure\b/i, normalizedSubject);
  } else if (/\bstructure\b/i.test(normalizedPrompt) && hasConcreteFrameTarget(normalizedPrompt)) {
    normalizedPrompt = normalizedPrompt.replace(/\bstructure\b/i, normalizedSubject);
  } else if (hasConcreteFrameTarget(normalizedPrompt)) {
    normalizedPrompt = `${normalizedSubject} ${normalizedPrompt}`.trim();
  }

  return normalizeText(normalizedPrompt);
}

function normalizeFrameEntry(frame = {}, { subject = '' } = {}) {
  const soundCues = collectNormalizedList(
    frame?.sound_cues || frame?.soundCues || [],
    frame?.sound_cue,
    frame?.soundCue
  );
  const continuityLocks = collectNormalizedList(
    frame?.continuity_locks || frame?.continuityLocks || [],
    frame?.continuity_lock,
    frame?.continuityLock
  );

  return {
    label: normalizeText(frame?.label || ''),
    prompt: concretizeFramePrompt(frame?.prompt || frame?.beat || frame?.description || '', subject),
    soundCue: soundCues[0] || '',
    soundCues,
    continuityLock: continuityLocks[0] || '',
    continuityLocks,
    sceneContext: normalizeText(frame?.scene_context || frame?.sceneContext || ''),
  };
}

function buildFramePrompterInput({
  subject,
  motionProfile,
  frameCount,
  prompt,
  identityLocks = [],
  visualContext = '',
  visualAnalysis = null,
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
    subject_keywords: extractSubjectKeywords(normalizedSubject),
    detected_subject_type: subjectType,
    anatomy_constraint: anatomyHint,
    motion_profile: motionProfile,
    motion_label: motionLabel,
    frame_count: frameCount,
    identity_locks: normalizedIdentityLocks,
    visual_context: normalizedVisualContext,
    visual_analysis: visualAnalysis && typeof visualAnalysis === 'object' ? visualAnalysis : null,
    reference_image_size: referenceImageSize,
    instruction: `Generate exactly ${frameCount} frame descriptions in ENGLISH to animate "${normalizedSubject}" doing a "${motionLabel}". Each frame must mention the concrete subject name or defining appearance, and it must stay visually grounded. ${anatomyHint} ${referenceImageSize ? `A reference image size of ${referenceImageSize} is provided; preserve its portrait/landscape framing unless the motion clearly requires otherwise.` : ''} Do NOT use French words in the output.`,
  }, null, 2);
}

function validateFramePrompterResponse(response, { subject = '' } = {}) {
  if (!response || typeof response !== 'object') return false;
  const frames = extractFrameEntries(response).map((frame) => normalizeFrameEntry(frame, { subject }));
  if (frames.length < 1) return false;
  return frames.every((frame) => (
    Boolean(frame.prompt)
    && framePromptMentionsSubject(frame.prompt, subject)
    && !/\bstructure\b/i.test(frame.prompt)
  ));
}

function padOrTrimFrames(frames, targetCount, { subject = '' } = {}) {
  const result = frames
    .slice(0, targetCount)
    .map((frame) => normalizeFrameEntry(frame, { subject }));
  while (result.length < targetCount) {
    const lastFrame = result[result.length - 1];
    result.push(lastFrame ? { ...lastFrame } : normalizeFrameEntry(FRAME_PROMPTER_FALLBACK_FRAME, { subject }));
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
    soundCue: normalizeText(frame.soundCue),
    soundCues: normalizeStringList(frame.soundCues),
    continuityLock: normalizeText(frame.continuityLock),
    continuityLocks: normalizeStringList(frame.continuityLocks),
    sceneContext: normalizeText(frame.sceneContext),
  }));
}

async function generateFramePromptsWithLlm({
  subject,
  motionProfile,
  frameCount,
  prompt,
  identityLocks = [],
  visualContext = '',
  visualAnalysis = null,
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
        visualAnalysis,
        referenceImageWidth,
        referenceImageHeight,
      }),
      systemPrompt: VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: Math.max(512, resolvedFrameCount * 80),
      timeoutMs: resolvedTimeout,
    });

    if (!validateFramePrompterResponse(response, { subject })) {
      return { ok: false, reason: 'invalid_llm_response', raw: response, beats: null };
    }

    const paddedFrames = padOrTrimFrames(extractFrameEntries(response), resolvedFrameCount, { subject });
    const beats = convertLlmFramesToBeats(paddedFrames);
    const continuityLocks = collectNormalizedList(
      response.continuity_locks || response.continuityLocks || [],
      beats.flatMap((beat) => beat.continuityLocks || [])
    );
    const soundCues = collectNormalizedList(
      response.sound_cues || response.soundCues || [],
      beats.flatMap((beat) => beat.soundCues || [])
    );

    return {
      ok: true,
      subjectType: normalizeText(response.subject_type || 'unknown'),
      motionDescription: normalizeText(response.motion_description || ''),
      sceneContext: normalizeText(response.scene_context || ''),
      continuityLocks,
      soundCues,
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
  VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT,
  generateFramePromptsWithLlm,
  isLlmFramePrompterEnabled,
};

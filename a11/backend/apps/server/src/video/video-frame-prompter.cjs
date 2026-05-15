// video-frame-prompter.cjs
// Genere les beats de frames video via LLM structure,
// avant tout appel SD.

const { callStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');

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

const FRAME_PROMPTER_FALLBACK_FRAME = Object.freeze({
  label: 'continuity',
  prompt: 'continue the motion with a clear visible step',
});

const FRAME_PROMPTER_SUBJECT_STOPWORDS = new Set([
  'the', 'a', 'an', 'with', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'from', 'for',
  'his', 'her', 'its', 'their', 'same', 'main', 'subject', 'character', 'figure',
  'person', 'visible', 'full', 'body', 'shot', 'view',
]);

const VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT = `I am A11's video director and storyboard artist planning a frame-by-frame video sequence.

My job: read the user's request and produce N shot descriptions — one per frame — that a frame renderer will execute in sequence to produce a coherent video clip.

Think like a cinematographer writing a storyboard: each frame is a shot. Describe what the camera sees at this exact moment — subject position, action, camera angle, framing, lighting, atmosphere. Every shot must flow naturally from the previous one to create motion continuity.

For each frame description, include:
- the subject with their exact appearance (clothing, colors, accessories, props) as described by the user
- the specific action or pose at this moment in the motion
- camera framing and angle (close-up, wide shot, low angle, etc.)
- lighting and atmosphere matching the user's requested style
- background/environment consistent across frames

Rules:
- Stay faithful to the user's exact request — their subject, style, atmosphere, and action.
- Each frame advances the motion by one visible step.
- Treat the sequence as one continuous shot unless the user explicitly asks for cuts.
- Keep the same main subject identity, outfit, proportions, background, lighting, lens and art style across every frame.
- Use small incremental pose/action changes; do not redesign the subject or jump to unrelated key art between frames.
- Write in English only.
- No numbering in descriptions.

Reply ONLY in strict JSON:
{
  "subject_type": "humanoid|horse|quadruped|dragon|other",
  "motion_description": "short description of the global motion",
  "scene_context": "camera setup, visual style and environment for the whole sequence",
  "continuity_locks": ["visual element that must stay consistent across all frames"],
  "sound_cues": ["short sound cue"],
  "frame_beats": [
    {
      "label": "short shot name",
      "prompt": "shot description: subject appearance + action at this moment + camera framing + lighting + atmosphere",
      "sound_cues": ["optional sound cue for this shot"],
      "continuity_locks": ["optional continuity note"],
      "scene_context": "optional shot-specific camera or lighting note"
    }
  ],
  "frames": [
    { "label": "short shot name", "prompt": "shot description" }
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
  chunkIndex = 0,
  totalFrames = 0,
  previousBeatLabels = [],
}) {
  const normalizedSubject = normalizeText(subject);
  const normalizedPrompt = normalizeText(prompt);
  const normalizedVisualContext = normalizeText(visualContext);
  const normalizedIdentityLocks = normalizeStringList(identityLocks);
  const motionLabel = FRAME_PROMPTER_MOTION_LABELS[motionProfile] || normalizeText(motionProfile);
  const referenceImageSize = (
    Number(referenceImageWidth || 0) > 0
    && Number(referenceImageHeight || 0) > 0
  )
    ? `${Number(referenceImageWidth)}x${Number(referenceImageHeight)}`
    : '';

  const chunkOffset = chunkIndex * frameCount;
  const framingNote = totalFrames > frameCount
    ? `These are frames ${chunkOffset + 1} to ${chunkOffset + frameCount} of ${totalFrames} total. Continue the motion arc — do NOT repeat beats already produced.`
    : `Generate exactly ${frameCount} frame descriptions covering the full motion arc.`;

  const previousNote = previousBeatLabels.length > 0
    ? `Beats already produced (do not repeat): ${previousBeatLabels.join(', ')}.`
    : '';

  const sizeNote = referenceImageSize
    ? `Reference image size ${referenceImageSize}: preserve its framing unless motion requires otherwise.`
    : '';

  const instruction = [
    `Generate exactly ${frameCount} detailed frame descriptions in ENGLISH for: "${normalizedPrompt || normalizedSubject}".`,
    `Use the user's exact subject, style, atmosphere and details in every frame description.`,
    'Keep one continuous shot: same subject identity, outfit, proportions, background, lighting, lens and art style across all frames.',
    'Only advance the pose, gesture, effects and timing by small readable increments from one frame to the next.',
    framingNote,
    previousNote,
    sizeNote,
    'Write in English only.',
  ].filter(Boolean).join(' ');

  return JSON.stringify({
    user_request: normalizedPrompt,
    main_subject: normalizedSubject,
    motion_profile: motionProfile,
    motion_label: motionLabel,
    frame_count: frameCount,
    total_frames: totalFrames || frameCount,
    chunk_offset: chunkOffset,
    identity_locks: normalizedIdentityLocks,
    visual_context: normalizedVisualContext,
    visual_analysis: visualAnalysis && typeof visualAnalysis === 'object' ? visualAnalysis : null,
    reference_image_size: referenceImageSize || null,
    instruction,
  }, null, 2);
}

function validateFramePrompterResponse(response, { subject = '' } = {}) {
  if (!response || typeof response !== 'object') return false;
  const frames = extractFrameEntries(response).map((frame) => normalizeFrameEntry(frame, { subject }));
  if (frames.length < 1) return false;
  // Validation assouplie : on vérifie que chaque frame a un prompt non vide.
  // On rejette uniquement les prompts qui contiennent \bstructure\b sans nommer
  // le sujet — ce sont des placeholders inutilisables que concretizeFramePrompt
  // ne peut pas corriger (pas de cible concrète dans le prompt).
  // Les modèles locaux (gemma4, llama3) qui produisent un vrai prompt descriptif
  // sans répéter le sujet mot pour mot sont acceptés.
  return frames.every((frame) => {
    if (!frame.prompt) return false;
    if (/\bstructure\b/i.test(frame.prompt) && !framePromptMentionsSubject(frame.prompt, subject)) {
      return false;
    }
    return true;
  });
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

// Nombre de frames par chunk LLM (configurable via A11_VIDEO_LLM_PROMPTER_CHUNK_SIZE).
// Appeler le LLM tous les N frames réduit le risque de troncature JSON
// et garde le budget token par appel raisonnable sans empiéter sur la VRAM SD.
const DEFAULT_LLM_CHUNK_SIZE = 4;

function resolveChunkSize(frameCount) {
  const configured = Number(process.env.A11_VIDEO_LLM_PROMPTER_CHUNK_SIZE || DEFAULT_LLM_CHUNK_SIZE);
  const safe = Number.isFinite(configured) && configured >= 1 ? Math.round(configured) : DEFAULT_LLM_CHUNK_SIZE;
  return Math.min(safe, Math.max(1, frameCount));
}

function resolveMaxTokensForChunk(chunkSize) {
  const override = Number(process.env.A11_VIDEO_LLM_PROMPTER_MAX_TOKENS || 0);
  if (Number.isFinite(override) && override > 0) return override;
  return Math.max(1200, chunkSize * 180);
}

// Schéma JSON strict pour le response_format Ollama-compatible.
const FRAME_PROMPTER_RESPONSE_FORMAT = Object.freeze({
  type: 'json_schema',
  json_schema: {
    name: 'video_frame_beats',
    strict: true,
    schema: {
      type: 'object',
      required: ['subject_type', 'motion_description', 'scene_context', 'frame_beats'],
      properties: {
        subject_type: { type: 'string' },
        motion_description: { type: 'string' },
        scene_context: { type: 'string' },
        continuity_locks: { type: 'array', items: { type: 'string' } },
        sound_cues: { type: 'array', items: { type: 'string' } },
        frame_beats: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'prompt'],
            properties: {
              label: { type: 'string' },
              prompt: { type: 'string' },
              sound_cues: { type: 'array', items: { type: 'string' } },
              continuity_locks: { type: 'array', items: { type: 'string' } },
              scene_context: { type: 'string' },
            },
          },
        },
        frames: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'prompt'],
            properties: {
              label: { type: 'string' },
              prompt: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

async function callLlmWithRetry({
  callLlm,
  input,
  systemPrompt,
  maxTokens,
  timeoutMs,
  subject,
  maxRetries = 1,
}) {
  let lastReason = 'llm_prompter_failed';
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response = null;
    try {
      response = await callLlm({
        text: input,
        systemPrompt,
        temperature: 0.3,
        maxTokens,
        timeoutMs,
        responseFormat: FRAME_PROMPTER_RESPONSE_FORMAT,
        stage: 'video_frame_prompter',
      });
    } catch (error) {
      lastReason = String(error?.message || error || 'llm_prompter_failed');
      console.warn(`[A11][video-frame-prompter] LLM call error attempt=${attempt}: ${lastReason}`);
      continue;
    }

    if (validateFramePrompterResponse(response, { subject })) {
      return { ok: true, response };
    }

    lastReason = 'invalid_llm_response';
    console.warn(`[A11][video-frame-prompter] Invalid LLM response attempt=${attempt}, retrying compact`);

    // Retry avec un prompt compact (sans visual_analysis pour réduire les tokens)
    if (attempt < maxRetries) {
      try {
        const compactInput = JSON.parse(input);
        compactInput.visual_analysis = null;
        compactInput.visual_context = String(compactInput.visual_context || '').slice(0, 200);
        input = JSON.stringify(compactInput, null, 2);
      } catch {
        // ignore parse error, retry with same input
      }
    }
  }
  return { ok: false, reason: lastReason, response: null };
}

async function generateFramePromptsWithLlm({
  subject,
  motionProfile,
  frameCount,
  prompt,
  compiledPrompt = '',
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

  // Utiliser le prompt compilé (anglais) si disponible, sinon le prompt brut
  const resolvedPrompt = normalizeText(compiledPrompt || prompt);

  const resolvedTimeout = Number(
    timeoutMs
    || process.env.A11_VIDEO_LLM_PROMPTER_TIMEOUT_MS
    || 60000
  ) || 60000;

  const chunkSize = resolveChunkSize(resolvedFrameCount);
  const maxTokens = resolveMaxTokensForChunk(chunkSize);

  const allBeats = [];
  let firstResponse = null;

  try {
    for (let chunkStart = 0; chunkStart < resolvedFrameCount; chunkStart += chunkSize) {
      const currentChunkSize = Math.min(chunkSize, resolvedFrameCount - chunkStart);
      const isFirstChunk = chunkStart === 0;
      const chunkIndex = Math.floor(chunkStart / chunkSize);

      // Résumé des beats déjà produits pour éviter les répétitions
      const previousBeatLabels = allBeats.map((beat) => beat.label).filter(Boolean);

      const input = buildFramePrompterInput({
        subject,
        motionProfile,
        frameCount: currentChunkSize,
        prompt: resolvedPrompt,
        identityLocks,
        visualContext: isFirstChunk ? visualContext : '',
        visualAnalysis: isFirstChunk ? visualAnalysis : null,
        referenceImageWidth: isFirstChunk ? referenceImageWidth : 0,
        referenceImageHeight: isFirstChunk ? referenceImageHeight : 0,
        chunkIndex,
        totalFrames: resolvedFrameCount,
        previousBeatLabels: isFirstChunk ? [] : previousBeatLabels,
      });

      const { ok, response, reason } = await callLlmWithRetry({
        callLlm,
        input,
        systemPrompt: VIDEO_FRAME_PROMPTER_SYSTEM_PROMPT,
        maxTokens,
        timeoutMs: resolvedTimeout,
        subject,
        maxRetries: 1,
      });

      if (!ok) {
        return { ok: false, reason: reason || 'invalid_llm_response', raw: response, beats: null };
      }

      if (isFirstChunk) {
        firstResponse = response;
      }

      const chunkFrames = padOrTrimFrames(extractFrameEntries(response), currentChunkSize, { subject });
      allBeats.push(...convertLlmFramesToBeats(chunkFrames));
    }

    const beats = allBeats;
    const continuityLocks = collectNormalizedList(
      firstResponse?.continuity_locks || firstResponse?.continuityLocks || [],
      beats.flatMap((beat) => beat.continuityLocks || [])
    );
    const soundCues = collectNormalizedList(
      firstResponse?.sound_cues || firstResponse?.soundCues || [],
      beats.flatMap((beat) => beat.soundCues || [])
    );

    return {
      ok: true,
      subjectType: normalizeText(firstResponse?.subject_type || 'unknown'),
      motionDescription: normalizeText(firstResponse?.motion_description || ''),
      sceneContext: normalizeText(firstResponse?.scene_context || ''),
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

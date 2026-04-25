const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  callJanusText,
  callJanusVisionText,
  resolveJanusVisionConfig,
  resolveVisionProvider,
  shutdownJanusVisionWorker,
} = require('../../lib/janus-vision-runtime.cjs');
const {
  generateFramePromptsWithLlm,
  isLlmFramePrompterEnabled,
} = require('./video-frame-prompter.cjs');
const {
  VALID_VIDEO_MOTION_PROFILES,
  extractStableSceneFragments,
  isStoryboardMetaFragment,
  normalizePromptList,
  normalizeSequenceBeat,
  normalizeVideoLookup,
  resolveDefaultIdentityLocks,
  resolveHeuristicSequencePlan,
} = require('./video-sequence-heuristic.cjs');

const VALID_SEQUENCE_PLANNER_MODES = Object.freeze(['auto', 'heuristic', 'janus', 'llm_prompter']);
const SUPPORTED_PLANNER_IMAGE_CONTENT_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const DEFAULT_SEQUENCE_PLANNER_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function resolveSequencePlannerMode(value = '', fallback = 'auto') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['llm', 'ollama', 'llm-prompter', 'llm_prompter'].includes(normalized)) return 'llm_prompter';
  if (VALID_SEQUENCE_PLANNER_MODES.includes(normalized)) return normalized;
  return fallback;
}

function normalizePlannerImageContentType(value = '') {
  const normalized = String(value || '').split(';')[0].trim().toLowerCase();
  return SUPPORTED_PLANNER_IMAGE_CONTENT_TYPES.includes(normalized) ? normalized : '';
}

function detectPlannerImageContentTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return '';

  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return '';
}

function normalizeSequencePlannerRoots(values = []) {
  const roots = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : [values]) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(resolved);
  }

  return roots;
}

function resolveSequencePlannerAllowedPathRoots(env = process.env) {
  const configuredRoots = String(env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_ROOTS || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalizeSequencePlannerRoots([
    ...configuredRoots,
    String(env.A11_RUNTIME_ROOT || '').trim(),
    String(env.A11_WORKSPACE_ROOT || '').trim(),
    process.cwd(),
    os.tmpdir(),
  ]);
}

function isPathInsideRoot(candidatePath = '', rootPath = '') {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSequencePlannerImagePathAllowed(candidatePath = '', allowedPathRoots = []) {
  const resolvedCandidate = path.resolve(String(candidatePath || '').trim());
  const roots = normalizeSequencePlannerRoots(allowedPathRoots);
  if (!roots.length) return false;
  return roots.some((rootPath) => isPathInsideRoot(resolvedCandidate, rootPath));
}

function shouldAttemptLlmFramePrompter(providerRequested = 'auto') {
  return providerRequested === 'auto' || providerRequested === 'llm_prompter' || providerRequested === 'janus';
}

function shouldAttemptJanusSequencePlanner(providerRequested = 'auto') {
  return providerRequested === 'auto' || providerRequested === 'janus';
}

function shouldAttemptJanusVisualScan(providerRequested = 'auto') {
  return providerRequested === 'auto' || providerRequested === 'llm_prompter' || providerRequested === 'janus';
}

function resolveSequencePlanningEnvConfig(env = process.env) {
  return {
    sequencePlanner: resolveSequencePlannerMode(env.A11_VIDEO_SEQUENCE_PLANNER, 'auto'),
    sequencePlannerImageAware: env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE === undefined
      ? true
      : toBoolean(env.A11_VIDEO_SEQUENCE_PLANNER_IMAGE_AWARE),
    sequencePlannerTimeoutMs: clampNumber(env.A11_VIDEO_SEQUENCE_PLANNER_TIMEOUT_MS, 5_000, 300_000, 20_000),
    sequencePlannerMaxImageBytes: clampNumber(
      env.A11_VIDEO_SEQUENCE_PLANNER_MAX_IMAGE_BYTES,
      64 * 1024,
      64 * 1024 * 1024,
      DEFAULT_SEQUENCE_PLANNER_MAX_IMAGE_BYTES
    ),
    sequencePlannerAllowedPathRoots: resolveSequencePlannerAllowedPathRoots(env),
  };
}

function isJanusSequencePlannerAvailable() {
  return resolveVisionProvider({}) === 'janus';
}

function buildHeuristicFallbackPlan(request = {}, providerRequested = 'auto', fallbackReason = null, options = {}) {
  const heuristicPlan = resolveHeuristicSequencePlan(request, {
    providerRequested,
    stablePromptSource: String(options?.stablePromptSource || '').trim(),
  });
  return {
    ...heuristicPlan,
    providerRequested,
    providerUsed: 'heuristic',
    fallbackReason: fallbackReason ? String(fallbackReason).trim() : null,
    imageAwareUsed: false,
    imageAwareError: null,
    visualAnalysis: null,
    visualAnalysisProvider: null,
    continuityLocks: [],
    soundCues: [],
  };
}

function buildAllowedProfileSentence() {
  return VALID_VIDEO_MOTION_PROFILES.join(', ');
}

function formatPlannerReferenceImageSize(request = {}) {
  const width = Number(request?.sourceImageWidth || 0);
  const height = Number(request?.sourceImageHeight || 0);
  if (!width || !height) return '';
  return `${width}x${height}`;
}

function buildJanusSequencePlannerPrompt({
  request = {},
  compiledBasePrompt = '',
  heuristicPlan = {},
} = {}) {
  const referenceImageSize = formatPlannerReferenceImageSize(request);
  return [
    'You are a video sequence planner for a frame-by-frame renderer.',
    'Reply only with a valid JSON object, with no markdown, no comments, and no text before or after.',
    `You must choose one motionProfile from: ${buildAllowedProfileSentence()}.`,
    'Do not change the rendering engine: the final frames will still be rendered by SD 3.5.',
    'Produce an internal semantic sequence plan, not final renderer prompts.',
    'The plan must follow this exact JSON schema:',
    '{"motionProfile":"...", "globalObjective":"...", "frameProgressionRule":"...", "compositionHints":["..."], "identityLocks":["..."], "sceneLocks":["..."], "beats":[{"label":"...", "structuralState":"...", "variation":"...", "checkpoint":false, "rendererFocus":["..."]}]}',
    'Content rules:',
    '- do not mention frame numbers, implementation method, storyboard meta text, or unnecessary camera jargon',
    '- beats must stay concrete, visual, and progressive',
    '- structuralState = the stable structural state to preserve for the frame',
    '- variation = the main visible change in the frame',
    '- rendererFocus = short visual details that help the final renderer',
    '- if unsure, stay very close to the heuristic baseline plan',
    `User prompt: ${String(request?.prompt || '').trim()}`,
    `Compiled base prompt: ${String(compiledBasePrompt || request?.prompt || '').trim()}`,
    referenceImageSize ? `Reference image size: ${referenceImageSize}` : '',
    `Target frame count: ${Math.max(1, Number(request?.frameCount || 1) || 1)}`,
    `Heuristic baseline plan: ${JSON.stringify({
      motionProfile: heuristicPlan.motionProfile,
      globalObjective: heuristicPlan.globalObjective,
      frameProgressionRule: heuristicPlan.frameProgressionRule,
      compositionHints: heuristicPlan.compositionHints,
      identityLocks: heuristicPlan.identityLocks,
      sceneLocks: heuristicPlan.sceneLocks,
      beats: heuristicPlan.beats,
    })}`,
  ].join('\n');
}

function buildJanusImageAwareRefinementPrompt({
  request = {},
  compiledBasePrompt = '',
  currentPlan = {},
} = {}) {
  const referenceImageSize = formatPlannerReferenceImageSize(request);
  return [
    'Observe this image as a visual reference for the scene or character.',
    'Refine the provided JSON plan without changing the execution logic.',
    'Reply only with a valid JSON object, with no markdown and no comments.',
    `You must keep one motionProfile from: ${buildAllowedProfileSentence()}.`,
    'Do not create renderer prompts. Only return a semantic sequence plan.',
    'Keep the beats concrete, visual, clean, and free of meta-phrases.',
    `User prompt: ${String(request?.prompt || '').trim()}`,
    `Compiled base prompt: ${String(compiledBasePrompt || request?.prompt || '').trim()}`,
    referenceImageSize ? `Reference image size: ${referenceImageSize}` : '',
    `Current plan to refine: ${JSON.stringify({
      motionProfile: currentPlan.motionProfile,
      globalObjective: currentPlan.globalObjective,
      frameProgressionRule: currentPlan.frameProgressionRule,
      compositionHints: currentPlan.compositionHints,
      identityLocks: currentPlan.identityLocks,
      sceneLocks: currentPlan.sceneLocks,
      beats: currentPlan.beats,
    })}`,
  ].join('\n');
}

function extractJsonObjectCandidate(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fenced = fencedMatch[1].trim();
    try {
      return JSON.parse(fenced);
    } catch {}
  }

  try {
    return JSON.parse(raw);
  } catch {}

  const startIndex = raw.search(/[{\[]/);
  if (startIndex < 0) return null;
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = startIndex; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') depth -= 1;
    if (depth === 0) {
      const candidate = raw.slice(startIndex, index + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function sanitizePlannerText(value = '') {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (!text) return '';
  if (isStoryboardMetaFragment(text)) return '';
  return text;
}

function sanitizePlannerList(values = [], fallback = []) {
  const normalized = normalizePromptList(
    (Array.isArray(values) ? values : [values])
      .map((entry) => sanitizePlannerText(entry))
      .filter(Boolean)
  );
  return normalized.length ? normalized : normalizePromptList(fallback || []);
}

function normalizePlannerBox(value = null) {
  let coordinates = [];
  if (Array.isArray(value)) {
    coordinates = value.slice(0, 4);
  } else if (value && typeof value === 'object') {
    const source = value.bbox || value.box || value.region || value;
    if (Array.isArray(source)) {
      coordinates = source.slice(0, 4);
    } else if (source && typeof source === 'object') {
      const x = source.x ?? source.left ?? source.x1 ?? source.min_x;
      const y = source.y ?? source.top ?? source.y1 ?? source.min_y;
      const width = source.width ?? source.w;
      const height = source.height ?? source.h;
      const right = source.right ?? source.x2 ?? source.max_x;
      const bottom = source.bottom ?? source.y2 ?? source.max_y;
      if (width !== undefined && height !== undefined) {
        coordinates = [x, y, width, height];
      } else if (right !== undefined && bottom !== undefined) {
        const numericX = Number(x);
        const numericY = Number(y);
        const numericRight = Number(right);
        const numericBottom = Number(bottom);
        coordinates = [
          numericX,
          numericY,
          numericRight - numericX,
          numericBottom - numericY,
        ];
      }
    }
  } else if (typeof value === 'string') {
    coordinates = value.match(/-?\d+(?:\.\d+)?/g)?.slice(0, 4) || [];
  }

  const normalized = coordinates.map((entry) => {
    const numeric = Number(entry);
    if (!Number.isFinite(numeric)) return null;
    return Number(Math.max(0, Math.min(1, numeric)).toFixed(3));
  });
  if (normalized.length !== 4 || normalized.some((entry) => entry === null)) return null;
  return normalized;
}

function normalizePlannerVisualEntity(entry = null, {
  defaultLabel = 'visible detail',
  allowProps = false,
} = {}) {
  if (typeof entry === 'string') {
    const label = sanitizePlannerText(entry);
    return label ? {
      label,
      bbox: null,
      pose: '',
      anatomy: [],
      accessories: [],
      props: [],
      details: [],
    } : null;
  }
  if (!entry || typeof entry !== 'object') return null;

  const label = sanitizePlannerText(
    entry.label
    || entry.name
    || entry.subject
    || entry.object
    || entry.description
    || entry.identity
    || defaultLabel
  ) || defaultLabel;

  return {
    label,
    bbox: normalizePlannerBox(entry),
    pose: sanitizePlannerText(entry.pose || entry.body_pose || entry.stance || ''),
    anatomy: sanitizePlannerList(entry.anatomy || entry.visible_anatomy || []),
    accessories: sanitizePlannerList(entry.accessories || entry.clothing || entry.outfit || entry.wearables || []),
    props: allowProps ? [] : sanitizePlannerList(entry.props || entry.held_props || entry.objects || []),
    details: sanitizePlannerList(entry.details || entry.attributes || entry.visible_attributes || []),
  };
}

function normalizePlannerVisualList(values = [], options = {}, limit = 6) {
  return (Array.isArray(values) ? values : [values])
    .map((entry) => normalizePlannerVisualEntity(entry, options))
    .filter((entry) => entry && entry.label)
    .slice(0, limit);
}

function buildJanusVisualScanPrompt({
  request = {},
  compiledBasePrompt = '',
} = {}) {
  const referenceImageSize = formatPlannerReferenceImageSize(request);
  return [
    'You are a visual continuity analyst for a frame-by-frame video renderer.',
    'Observe this reference image carefully.',
    'Reply only with a valid JSON object, with no markdown and no extra text.',
    'Do not write final Stable Diffusion prose.',
    'Describe only visible facts that help continuity across frames.',
    'Use English only.',
    'Approximate normalized regions must use [x, y, width, height] values between 0 and 1 when possible.',
    'The JSON schema must be:',
    '{"scene":{"decor":["..."],"cameraFraming":["..."],"lighting":["..."]},"subjects":[{"label":"...","pose":"...","anatomy":["..."],"accessories":["..."],"props":["..."],"bbox":[0,0,0,0]}],"props":[{"label":"...","details":["..."],"bbox":[0,0,0,0]}],"continuityAnchors":["..."],"continuityRisks":["..."]}',
    'Rules:',
    '- subjects must stay concrete and visible',
    '- props should mention key accessories or weapons that must stay consistent',
    '- continuityAnchors should capture identity, costume, decor, and prop details worth preserving',
    '- continuityRisks should mention likely drift, crop, or anatomy risks',
    `User prompt: ${String(request?.prompt || '').trim()}`,
    `Compiled base prompt: ${String(compiledBasePrompt || request?.prompt || '').trim()}`,
    referenceImageSize ? `Reference image size: ${referenceImageSize}` : '',
  ].join('\n');
}

function coerceJanusVisualScan({ candidate = null } = {}) {
  const scanObject = (
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? (candidate.visualScan && typeof candidate.visualScan === 'object'
          ? candidate.visualScan
          : candidate)
      : null
  );
  if (!scanObject) {
    throw new Error('janus_invalid_visual_scan_payload');
  }

  const sceneSource = scanObject.scene && typeof scanObject.scene === 'object'
    ? scanObject.scene
    : {};
  const visualAnalysis = {
    scene: {
      decor: sanitizePlannerList(sceneSource.decor || sceneSource.background || sceneSource.scene || []),
      cameraFraming: sanitizePlannerList(sceneSource.cameraFraming || sceneSource.camera || sceneSource.framing || []),
      lighting: sanitizePlannerList(sceneSource.lighting || []),
    },
    subjects: normalizePlannerVisualList(
      scanObject.subjects || scanObject.characters || scanObject.people || [],
      { defaultLabel: 'visible subject', allowProps: false },
      4
    ),
    props: normalizePlannerVisualList(
      scanObject.props || scanObject.objects || [],
      { defaultLabel: 'visible prop', allowProps: true },
      6
    ),
    continuityAnchors: sanitizePlannerList(
      scanObject.continuityAnchors
      || scanObject.continuity_anchors
      || scanObject.continuityLocks
      || []
    ),
    continuityRisks: sanitizePlannerList(
      scanObject.continuityRisks
      || scanObject.continuity_risks
      || scanObject.risks
      || []
    ),
  };

  const hasSignal = (
    visualAnalysis.scene.decor.length > 0
    || visualAnalysis.scene.cameraFraming.length > 0
    || visualAnalysis.scene.lighting.length > 0
    || visualAnalysis.subjects.length > 0
    || visualAnalysis.props.length > 0
    || visualAnalysis.continuityAnchors.length > 0
    || visualAnalysis.continuityRisks.length > 0
  );
  if (!hasSignal) {
    throw new Error('janus_invalid_visual_scan_payload');
  }

  return visualAnalysis;
}

function formatPlannerBox(box = null) {
  return Array.isArray(box) && box.length === 4
    ? `bbox ${box.join(', ')}`
    : '';
}

function summarizeJanusVisualScan(visualAnalysis = {}) {
  const subjects = (Array.isArray(visualAnalysis?.subjects) ? visualAnalysis.subjects : [])
    .map((entry) => normalizePromptList([
      entry.label,
      entry.pose,
      formatPlannerBox(entry.bbox),
      ...entry.accessories,
      ...entry.props,
      ...entry.anatomy,
    ]).join(', '))
    .filter(Boolean);
  const props = (Array.isArray(visualAnalysis?.props) ? visualAnalysis.props : [])
    .map((entry) => normalizePromptList([
      entry.label,
      formatPlannerBox(entry.bbox),
      ...entry.details,
    ]).join(', '))
    .filter(Boolean);
  const scene = normalizePromptList([
    ...(visualAnalysis?.scene?.decor || []),
    ...(visualAnalysis?.scene?.cameraFraming || []),
    ...(visualAnalysis?.scene?.lighting || []),
  ]);

  return normalizePromptList([
    scene.length ? `reference scene: ${scene.join(', ')}` : '',
    subjects.length ? `reference subjects: ${subjects.join('; ')}` : '',
    props.length ? `reference props: ${props.join('; ')}` : '',
    visualAnalysis?.continuityAnchors?.length ? `continuity anchors: ${visualAnalysis.continuityAnchors.join(', ')}` : '',
    visualAnalysis?.continuityRisks?.length ? `continuity risks: ${visualAnalysis.continuityRisks.join(', ')}` : '',
  ]).join('. ');
}

function sanitizePlannerBeat(beat = {}, fallbackLabel = 'continuite') {
  const label = sanitizePlannerText(beat?.label || beat?.name || fallbackLabel) || fallbackLabel;
  const structuralState = sanitizePlannerText(
    beat?.structuralState
    || beat?.structural_state
    || beat?.structure
    || beat?.state
    || ''
  );
  const variation = sanitizePlannerText(
    beat?.variation
    || beat?.visibleVariation
    || beat?.visible_variation
    || beat?.prompt
    || beat?.change
    || structuralState
    || ''
  );
  const rendererFocus = sanitizePlannerList(
    beat?.rendererFocus
    || beat?.renderer_focus
    || beat?.focus
    || beat?.visualFocus
    || []
  );
  return normalizeSequenceBeat({
    label,
    structuralState,
    variation,
    checkpoint: Boolean(beat?.checkpoint),
    rendererFocus,
  }, fallbackLabel);
}

function sanitizePlannerBeatWithExtras(beat = {}, fallbackLabel = 'continuite') {
  const normalizedBeat = sanitizePlannerBeat(beat, fallbackLabel);
  return {
    ...normalizedBeat,
    soundCues: sanitizePlannerList(beat?.soundCues || beat?.sound_cues || []),
    continuityLocks: sanitizePlannerList(beat?.continuityLocks || beat?.continuity_locks || []),
    sceneContext: sanitizePlannerText(beat?.sceneContext || beat?.scene_context || ''),
  };
}

function withMotionProfile(request = {}, motionProfile = 'generic') {
  return {
    ...request,
    timingPlan: {
      ...(request?.timingPlan || {}),
      motionProfile,
    },
  };
}

function coerceJanusSequencePlan({
  request = {},
  providerRequested = 'auto',
  compiledBasePrompt = '',
  candidate = null,
  fallbackPlan = null,
  imageAwareUsed = false,
} = {}) {
  const planObject = (
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? (candidate.sequencePlanning && typeof candidate.sequencePlanning === 'object'
          ? candidate.sequencePlanning
          : candidate)
      : null
  );
  if (!planObject) {
    throw new Error('janus_invalid_plan_payload');
  }

  const candidateMotionProfile = VALID_VIDEO_MOTION_PROFILES.includes(String(planObject.motionProfile || '').trim())
    ? String(planObject.motionProfile || '').trim()
    : String(fallbackPlan?.motionProfile || 'generic').trim() || 'generic';
  const baselinePlan = fallbackPlan
    && fallbackPlan.motionProfile === candidateMotionProfile
    ? fallbackPlan
    : resolveHeuristicSequencePlan(
        withMotionProfile(request, candidateMotionProfile),
        {
          providerRequested,
          stablePromptSource: String(compiledBasePrompt || request?.prompt || '').trim(),
        }
      );

  const beatsSource = Array.isArray(planObject.beats)
    ? planObject.beats
    : (Array.isArray(planObject.storyboard) ? planObject.storyboard : []);
  const beats = beatsSource
    .map((beat, index) => sanitizePlannerBeat(beat, `beat ${index + 1}`))
    .filter((beat) => beat.variation || beat.structuralState);
  if (!beats.length) {
    throw new Error('janus_missing_beats');
  }

  return {
    ...baselinePlan,
    providerRequested,
    providerUsed: 'janus',
    fallbackReason: null,
    globalObjective: sanitizePlannerText(planObject.globalObjective) || baselinePlan.globalObjective,
    frameProgressionRule: sanitizePlannerText(planObject.frameProgressionRule) || baselinePlan.frameProgressionRule,
    compositionHints: sanitizePlannerList(planObject.compositionHints, baselinePlan.compositionHints),
    identityLocks: sanitizePlannerList(planObject.identityLocks, baselinePlan.identityLocks),
    sceneLocks: sanitizePlannerList(planObject.sceneLocks, baselinePlan.sceneLocks),
    beats,
    imageAwareUsed: Boolean(imageAwareUsed),
  };
}

function guessContentTypeFromSource(source = '') {
  const ext = String(path.extname(source || '')).trim().toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.png') return 'image/png';
  return '';
}

async function loadPlannerImageSource({
  sourceImagePath = '',
  sourceImageUrl = '',
  fetchImpl = defaultFetch,
  maxBytes = DEFAULT_SEQUENCE_PLANNER_MAX_IMAGE_BYTES,
  allowedPathRoots = [],
} = {}) {
  const resolvedMaxBytes = clampNumber(
    maxBytes,
    64 * 1024,
    64 * 1024 * 1024,
    DEFAULT_SEQUENCE_PLANNER_MAX_IMAGE_BYTES
  );
  const candidatePath = String(sourceImagePath || '').trim();
  if (candidatePath && fs.existsSync(candidatePath)) {
    const resolvedPath = path.resolve(candidatePath);
    if (!isSequencePlannerImagePathAllowed(resolvedPath, allowedPathRoots)) {
      throw new Error('janus_image_source_path_not_allowed');
    }
    const stat = await fsp.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error('janus_image_source_not_a_file');
    }
    if (stat.size > resolvedMaxBytes) {
      throw new Error(`janus_image_source_too_large:${stat.size}`);
    }
    const buffer = await fsp.readFile(resolvedPath);
    if (buffer.length > resolvedMaxBytes) {
      throw new Error(`janus_image_source_too_large:${buffer.length}`);
    }
    const contentType = normalizePlannerImageContentType(guessContentTypeFromSource(resolvedPath))
      || detectPlannerImageContentTypeFromBuffer(buffer);
    if (!contentType) {
      throw new Error('janus_image_source_unsupported_content_type');
    }
    return {
      buffer,
      contentType,
      sourceLabel: 'path',
    };
  }

  const candidateUrl = String(sourceImageUrl || '').trim();
  if (!candidateUrl) return null;
  let parsedUrl = null;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    throw new Error('janus_image_source_invalid_url');
  }
  if (!['http:', 'https:'].includes(String(parsedUrl.protocol || '').trim().toLowerCase())) {
    throw new Error('janus_image_source_url_not_allowed');
  }
  const response = await fetchImpl(candidateUrl);
  if (!response.ok) {
    throw new Error(`janus_image_source_fetch_failed:${response.status}`);
  }
  const rawContentType = String(response.headers?.get?.('content-type') || '').trim();
  const headerContentType = normalizePlannerImageContentType(rawContentType);
  if (rawContentType && !headerContentType) {
    throw new Error('janus_image_source_unsupported_content_type');
  }
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > resolvedMaxBytes) {
    throw new Error(`janus_image_source_too_large:${contentLength}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > resolvedMaxBytes) {
    throw new Error(`janus_image_source_too_large:${buffer.length}`);
  }
  const contentType = headerContentType
    || detectPlannerImageContentTypeFromBuffer(buffer)
    || normalizePlannerImageContentType(guessContentTypeFromSource(candidateUrl));
  if (!contentType) {
    throw new Error('janus_image_source_unsupported_content_type');
  }
  return {
    buffer,
    contentType,
    sourceLabel: 'url',
  };
}

async function callJanusPlannerTextPrompt({
  prompt = '',
  timeoutMs = 90_000,
} = {}) {
  const janus = resolveJanusVisionConfig({
    timeoutMs,
  });
  return callJanusText({
    prompt,
    maxNewTokens: Math.min(Math.max(janus.maxNewTokens, 640), 960),
    timeoutMs,
    modelRef: janus.modelRef,
    device: janus.device,
    torchDtype: janus.torchDtype,
  });
}

async function callJanusPlannerImageAwarePrompt({
  prompt = '',
  imageBuffer,
  contentType = 'image/png',
  timeoutMs = 90_000,
} = {}) {
  const janus = resolveJanusVisionConfig({
    timeoutMs,
  });
  return callJanusVisionText({
    imageBuffer,
    contentType,
    prompt,
    maxNewTokens: Math.min(Math.max(janus.maxNewTokens, 640), 960),
    timeoutMs,
    modelRef: janus.modelRef,
    device: janus.device,
    torchDtype: janus.torchDtype,
  });
}

async function planVideoSequence({
  request = {},
  compiledBasePrompt = '',
  sourceImagePath = '',
  sourceImageUrl = '',
  fetchImpl = defaultFetch,
} = {}) {
  const sequencePlanningConfig = resolveSequencePlanningEnvConfig(process.env);
  const providerRequested = resolveSequencePlannerMode(
    request?.config?.sequencePlanner || request?.config?.sequencePlannerMode || sequencePlanningConfig.sequencePlanner || 'auto',
    'auto'
  );
  let heuristicFallbackPlan = buildHeuristicFallbackPlan(request, providerRequested, null, {
    stablePromptSource: String(compiledBasePrompt || request?.prompt || '').trim(),
  });

  const timeoutMs = Math.max(
    5_000,
    Number(request?.config?.sequencePlannerTimeoutMs || 0) || sequencePlanningConfig.sequencePlannerTimeoutMs
  );
  const imageAwareRequested = request?.config?.sequencePlannerImageAware === undefined
    ? sequencePlanningConfig.sequencePlannerImageAware
    : request.config.sequencePlannerImageAware !== false;

  let visualAnalysis = null;
  let imageAwareUsed = false;
  let imageAwareError = '';

  try {
    if (
      imageAwareRequested
      && shouldAttemptJanusVisualScan(providerRequested)
      && isJanusSequencePlannerAvailable()
    ) {
      let imageSource = null;
      try {
        imageSource = await loadPlannerImageSource({
          sourceImagePath,
          sourceImageUrl,
          fetchImpl,
          maxBytes: Number(request?.config?.sequencePlannerMaxImageBytes || 0) || sequencePlanningConfig.sequencePlannerMaxImageBytes,
          allowedPathRoots: Array.isArray(request?.config?.sequencePlannerAllowedPathRoots)
            ? request.config.sequencePlannerAllowedPathRoots
            : sequencePlanningConfig.sequencePlannerAllowedPathRoots,
        });
      } catch (error_) {
        imageAwareError = String(error_?.message || error_).trim() || 'janus_image_source_failed';
      }

      if (imageSource?.buffer?.length) {
        try {
          const visualScanPrompt = buildJanusVisualScanPrompt({
            request,
            compiledBasePrompt,
          });
          const visualScanResult = await callJanusPlannerImageAwarePrompt({
            prompt: visualScanPrompt,
            imageBuffer: imageSource.buffer,
            contentType: imageSource.contentType,
            timeoutMs,
          });
          const parsedVisualScan = extractJsonObjectCandidate(visualScanResult?.text || visualScanResult);
          visualAnalysis = coerceJanusVisualScan({ candidate: parsedVisualScan });
          imageAwareUsed = true;
          imageAwareError = '';
        } catch (error_) {
          imageAwareUsed = false;
          imageAwareError = String(error_?.message || error_).trim() || 'janus_image_aware_failed';
        }
      }
    }

    heuristicFallbackPlan = {
      ...heuristicFallbackPlan,
      imageAwareUsed,
      imageAwareError: imageAwareError || null,
      visualAnalysis,
      visualAnalysisProvider: visualAnalysis ? 'janus' : null,
      continuityLocks: normalizePromptList(visualAnalysis?.continuityAnchors || []),
    };

    if (providerRequested === 'heuristic') {
      return heuristicFallbackPlan;
    }

    let llmFailureReason = '';
    if (shouldAttemptLlmFramePrompter(providerRequested)) {
      if (isLlmFramePrompterEnabled()) {
        const subject = String(
          request?.compiledSubject
          || compiledBasePrompt
          || request?.prompt
          || ''
        ).trim();
        const identityLocks = resolveDefaultIdentityLocks(
          heuristicFallbackPlan.motionProfile,
          String(request?.prompt || '').trim()
        );
        const visualContext = [
          String(request?.compiledVisualContext || '').trim(),
          String(request?.canonicalSubject || '').trim(),
          formatPlannerReferenceImageSize(request) ? `reference image size ${formatPlannerReferenceImageSize(request)}` : '',
          ...(Array.isArray(request?.subjectFacts) ? request.subjectFacts.slice(0, 3) : []),
          summarizeJanusVisualScan(visualAnalysis),
        ].filter(Boolean).join('. ');
        const llmResult = await generateFramePromptsWithLlm({
          subject,
          motionProfile: heuristicFallbackPlan.motionProfile,
          frameCount: Math.max(1, Number(request?.frameCount || 0) || heuristicFallbackPlan.beats.length),
          prompt: String(request?.prompt || '').trim(),
          identityLocks,
          visualContext,
          visualAnalysis,
          referenceImageWidth: Number(request?.sourceImageWidth || 0),
          referenceImageHeight: Number(request?.sourceImageHeight || 0),
          timeoutMs,
        });

        if (llmResult.ok && Array.isArray(llmResult.beats) && llmResult.beats.length > 0) {
          console.log(
            `[A11][video-prompter] LLM beats generated subject_type=${llmResult.subjectType}`
            + ` motion=${llmResult.motionDescription}`
            + ` frames=${llmResult.beats.length}`
          );
          return {
            ...heuristicFallbackPlan,
            providerUsed: 'llm_prompter',
            fallbackReason: null,
            beats: llmResult.beats.map((beat, index) => sanitizePlannerBeatWithExtras(beat, `beat ${index + 1}`)),
            sceneContext: llmResult.sceneContext || '',
            continuityLocks: normalizePromptList(llmResult.continuityLocks || heuristicFallbackPlan.continuityLocks || []),
            soundCues: normalizePromptList(llmResult.soundCues || []),
            imageAwareUsed,
            imageAwareError: imageAwareError || null,
            visualAnalysis,
            visualAnalysisProvider: visualAnalysis ? 'janus' : null,
          };
        }

        llmFailureReason = String(llmResult.reason || 'llm_prompter_failed').trim() || 'llm_prompter_failed';
        console.log(`[A11][video-prompter] LLM prompter skipped: ${llmFailureReason}, using heuristic`);
        if (compiledBasePrompt && compiledBasePrompt !== String(request?.prompt || '').trim()) {
          const compiledSceneLocks = extractStableSceneFragments(
            String(compiledBasePrompt || '').trim(),
            heuristicFallbackPlan.motionProfile
          );
          heuristicFallbackPlan = {
            ...heuristicFallbackPlan,
            sceneLocks: normalizePromptList([
              ...heuristicFallbackPlan.sceneLocks,
              ...compiledSceneLocks.slice(0, 2),
            ]).slice(0, 4),
          };
          console.log('[A11][video-prompter] Heuristic enriched with compiledBasePrompt');
        }
      } else {
        llmFailureReason = 'llm_prompter_disabled';
      }

      return {
        ...heuristicFallbackPlan,
        fallbackReason: llmFailureReason || heuristicFallbackPlan.fallbackReason || 'llm_prompter_failed',
      };
    }

    return heuristicFallbackPlan;
  } finally {
    // The sequence planner runs once before SD rendering; release Janus to avoid VRAM contention.
    shutdownJanusVisionWorker();
  }
}

module.exports = {
  VALID_SEQUENCE_PLANNER_MODES,
  buildJanusImageAwareRefinementPrompt,
  buildJanusSequencePlannerPrompt,
  buildJanusVisualScanPrompt,
  coerceJanusSequencePlan,
  coerceJanusVisualScan,
  extractJsonObjectCandidate,
  planVideoSequence,
  resolveSequencePlannerMode,
  resolveSequencePlanningEnvConfig,
};

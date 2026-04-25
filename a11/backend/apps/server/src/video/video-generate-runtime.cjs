const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const { uploadBufferToR2: defaultUploadBufferToR2 } = require('../../lib/file-storage.cjs');
const {
  resolveGeneratedImageUrl,
  compileMaskImageGenerateRuntime,
} = require('../mask/image-chat-runtime.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('../mask/resolve-image-mask-from-text.cjs');
const {
  callJanusVisionText,
  resolveJanusVisionConfig,
} = require('../../lib/janus-vision-runtime.cjs');
const {
  normalizeSequenceBeat: normalizeStoryboardBeatExternal,
  resolveHeuristicSequencePlan: resolveVideoSequencePlanExternal,
  resolveSequenceFrameBeats: buildVideoStoryboardExternal,
} = require('./video-sequence-heuristic.cjs');
const {
  buildFramePrompt: buildFramePromptExternal,
  buildFramePromptPlan: buildFramePromptPlanExternal,
} = require('./video-sequence-translator.cjs');
const {
  planVideoSequence,
  resolveSequencePlanningEnvConfig,
} = require('./video-sequence-planner.cjs');
const {
  lookupImageHintWebContext: defaultLookupImageHintWebContext,
  resolveImageWebDraft: defaultResolveImageWebDraft,
} = require('../knowledge/image-hint-web-context.cjs');
const {
  resolveImageReferencePack: defaultResolveImageReferencePack,
} = require('../knowledge/image-reference-pack.cjs');
const {
  buildImageReferenceComposite: defaultBuildImageReferenceComposite,
} = require('../knowledge/image-reference-composite.cjs');
const {
  resolveImageEntityContext: defaultResolveImageEntityContext,
} = require('../knowledge/image-entity-resolver.cjs');
const {
  directImageRequest: defaultDirectImageRequest,
} = require('../knowledge/image-request-director.cjs');
const {
  classifyImg2ImgSource,
  probeImg2ImgSource,
  resolveImg2ImgCanvasPlan,
  resolveImg2ImgStrength,
} = require('../image/img2img-source-guard.cjs');
const {
  resolveRetryStrength,
  resolveStrengthFromProfile,
} = require('../image/img2img-strength.cjs');
const {
  lookupDefinitionContext: defaultLookupDefinitionContext,
} = require('../knowledge/definition-context.cjs');
const {
  duckduckgoImageSearch: defaultDuckduckgoImageSearch,
} = require('../../lib/image-search.cjs');
const {
  normalizeVideoFormat,
  parseVideoGenerateRequest,
} = require('./video-request.cjs');

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function resolveRequestOrigin(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req?.protocol || (req?.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(
    req?.headers?.['x-forwarded-host']
    || req?.headers?.host
    || ''
  ).split(',')[0].trim();
  if (!forwardedHost) return '';
  return `${proto || 'http'}://${forwardedHost}`;
}

function hasSdProxyConfigured(env = process.env) {
  return [
    env?.A11_SD_PROXY_URL,
    env?.SD_PROXY_URL,
  ].map((value) => String(value || '').trim()).some(Boolean);
}

function isLocalVideoRuntime(env = process.env) {
  return isTruthy(env?.A11_LOCAL_MODE)
    || String(env?.A11_RUNTIME_PROFILE || '').trim().toLowerCase() === 'local';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function resolvePositiveNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return 0;
}

function roundTimingValue(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const factor = 10 ** precision;
  return Math.round(numeric * factor) / factor;
}

function normalizeVideoLookup(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasOwnPositiveNumber(obj = {}, keys = []) {
  return (Array.isArray(keys) ? keys : []).some((key) => (
    Object.prototype.hasOwnProperty.call(obj || {}, key)
    && Number.isFinite(Number(obj[key]))
    && Number(obj[key]) > 0
  ));
}

function roundDimensionToMultiple(value, multiple = 64) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(multiple, Math.round(numeric / multiple) * multiple);
}

function resolveImageRenderMaxSide(env = process.env) {
  const raw = env?.A11_IMAGE_MAX_SIZE || env?.A11_IMAGE_MAX_RENDER_SIDE || 2048;
  return roundDimensionToMultiple(clampNumber(raw, 64, 4096, 2048));
}

function resolveSdDimensionMultiple(env = process.env) {
  const configured = Number(env?.SD_DIMENSION_MULTIPLE || env?.A11_SD_DIMENSION_MULTIPLE || 8);
  if (!Number.isFinite(configured) || configured <= 0) return 8;
  return Math.max(8, Math.min(128, Math.round(configured)));
}

function normalizeLatentDimension(value, {
  min = 64,
  max = 4096,
  multiple = resolveSdDimensionMultiple(process.env),
} = {}) {
  const safeMultiple = Math.max(1, Number(multiple) || 8);
  const safeMin = Math.max(safeMultiple, Math.ceil(Number(min || 64) / safeMultiple) * safeMultiple);
  const safeMax = Math.max(safeMin, Math.floor(Number(max || 4096) / safeMultiple) * safeMultiple);
  let numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric) || numeric <= 0) numeric = safeMin;
  numeric = Math.max(safeMin, Math.min(safeMax, numeric));
  numeric = Math.floor(numeric / safeMultiple) * safeMultiple;
  return Math.max(safeMin, Math.min(safeMax, numeric));
}

function fitRenderDimensionsWithinLimits({
  width,
  height,
  fallbackWidth = resolveImageRenderMaxSide(process.env),
  fallbackHeight = resolveImageRenderMaxSide(process.env),
  minSide = 64,
  maxSide = 2048,
  maxPixels = maxSide * maxSide,
} = {}) {
  let resolvedWidth = Number(width);
  let resolvedHeight = Number(height);

  if (!Number.isFinite(resolvedWidth) || resolvedWidth <= 0) resolvedWidth = fallbackWidth;
  if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) resolvedHeight = fallbackHeight;

  resolvedWidth = Math.max(minSide, resolvedWidth);
  resolvedHeight = Math.max(minSide, resolvedHeight);

  let scale = 1;
  if (resolvedWidth > maxSide || resolvedHeight > maxSide) {
    scale = Math.min(scale, maxSide / resolvedWidth, maxSide / resolvedHeight);
  }

  const requestedPixels = resolvedWidth * resolvedHeight;
  if (requestedPixels > maxPixels) {
    scale = Math.min(scale, Math.sqrt(maxPixels / requestedPixels));
  }

  if (scale < 1) {
    resolvedWidth *= scale;
    resolvedHeight *= scale;
  }

  const dimensionMultiple = resolveSdDimensionMultiple(process.env);
  resolvedWidth = normalizeLatentDimension(resolvedWidth, {
    min: minSide,
    max: maxSide,
    multiple: dimensionMultiple,
  });
  resolvedHeight = normalizeLatentDimension(resolvedHeight, {
    min: minSide,
    max: maxSide,
    multiple: dimensionMultiple,
  });

  if (resolvedWidth > maxSide) {
    resolvedWidth = normalizeLatentDimension(maxSide, {
      min: minSide,
      max: maxSide,
      multiple: dimensionMultiple,
    });
  }
  if (resolvedHeight > maxSide) {
    resolvedHeight = normalizeLatentDimension(maxSide, {
      min: minSide,
      max: maxSide,
      multiple: dimensionMultiple,
    });
  }

  let guard = 0;
  while ((resolvedWidth * resolvedHeight) > maxPixels && guard < 4) {
    const areaScale = Math.sqrt(maxPixels / Math.max(resolvedWidth * resolvedHeight, 1));
    if (!(areaScale > 0 && areaScale < 1)) break;
    const nextWidth = normalizeLatentDimension(resolvedWidth * areaScale, {
      min: minSide,
      max: maxSide,
      multiple: dimensionMultiple,
    });
    const nextHeight = normalizeLatentDimension(resolvedHeight * areaScale, {
      min: minSide,
      max: maxSide,
      multiple: dimensionMultiple,
    });
    if (nextWidth === resolvedWidth && nextHeight === resolvedHeight) break;
    resolvedWidth = nextWidth;
    resolvedHeight = nextHeight;
    guard += 1;
  }

  return {
    width: resolvedWidth,
    height: resolvedHeight,
  };
}

function resolveVideoFrameMaxSize(env = process.env) {
  const fallback = resolveImageRenderMaxSide(env);
  const raw = env?.A11_VIDEO_FRAME_MAX_SIZE || env?.A11_VIDEO_MAX_RENDER_SIDE || fallback;
  return roundDimensionToMultiple(clampNumber(raw, 64, 4096, fallback));
}

function resolveVideoFrameMaxPixels(env = process.env, maxRenderSide = resolveVideoFrameMaxSize(env)) {
  const fallback = maxRenderSide * maxRenderSide;
  const raw = env?.A11_VIDEO_FRAME_MAX_PIXELS || env?.A11_VIDEO_MAX_RENDER_PIXELS || fallback;
  return Math.max(4096, Math.min(4096 * 4096, Math.round(Number(raw) || fallback)));
}

function resolveVideoFrameMinSize(env = process.env, maxRenderSide = resolveVideoFrameMaxSize(env)) {
  const raw = env?.A11_VIDEO_MIN_RENDER_SIDE;
  return roundDimensionToMultiple(clampNumber(raw, 64, maxRenderSide, 64));
}

function normalizeVideoDimension(value, {
  fallback = resolveVideoFrameMaxSize(process.env),
  min = resolveVideoFrameMinSize(process.env),
  max = resolveVideoFrameMaxSize(process.env),
} = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return roundDimensionToMultiple(fallback);
  }

  const rounded = roundDimensionToMultiple(numeric);
  return Math.max(min, Math.min(max, rounded));
}

const FFMPEG_CAPABILITY_CACHE = new Map();
const WINDOWS_FFMPEG_CANDIDATES = [
  path.resolve(process.cwd(), '..', '..', '..', 'launchers', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  'C:\\Program Files\\BlueStacks_nxt\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
];

function resolveFfmpegBinary(explicitValue = '') {
  const explicit = String(explicitValue || '').trim();
  if (explicit) {
    if (fs.existsSync(explicit)) return path.resolve(explicit);
    if (!/[\\/]/.test(explicit)) return explicit;
  }

  if (process.platform === 'win32') {
    for (const candidate of WINDOWS_FFMPEG_CANDIDATES) {
      if (fs.existsSync(candidate)) return candidate;
    }

    try {
      const lookup = spawnSync('where.exe', ['ffmpeg'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (lookup.status === 0) {
        const discovered = String(lookup.stdout || '')
          .split(/\r?\n/)
          .map((entry) => String(entry || '').trim())
          .find((entry) => entry && fs.existsSync(entry));
        if (discovered) return discovered;
      }
    } catch {
      // ignore PATH lookup failures
    }
  }

  return explicit || 'ffmpeg';
}

function ensureFfmpegAvailable(ffmpegBin = 'ffmpeg') {
  const resolvedBin = String(ffmpegBin || 'ffmpeg').trim() || 'ffmpeg';
  try {
    const probe = spawnSync(resolvedBin, ['-version'], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (probe.error) {
      const error = new Error(`ffmpeg_unavailable:${String(probe.error?.message || probe.error)}`);
      error.code = 'ffmpeg_unavailable';
      error.ffmpegBin = resolvedBin;
      throw error;
    }

    if (typeof probe.status === 'number' && probe.status !== 0) {
      const details = String(probe.stderr || probe.stdout || '').trim();
      const error = new Error(`ffmpeg_unavailable:${details || `exit_${probe.status}`}`);
      error.code = 'ffmpeg_unavailable';
      error.ffmpegBin = resolvedBin;
      throw error;
    }
  } catch (error_) {
    if (error_?.code === 'ffmpeg_unavailable') {
      throw error_;
    }
    const error = new Error(`ffmpeg_unavailable:${String(error_?.message || error_)}`);
    error.code = 'ffmpeg_unavailable';
    error.ffmpegBin = resolvedBin;
    throw error;
  }

  return resolvedBin;
}

function probeFfmpegCapabilities(ffmpegBin = 'ffmpeg') {
  const cacheKey = String(ffmpegBin || 'ffmpeg').trim() || 'ffmpeg';
  if (FFMPEG_CAPABILITY_CACHE.has(cacheKey)) {
    return FFMPEG_CAPABILITY_CACHE.get(cacheKey);
  }

  let stdout = '';
  let stderr = '';
  try {
    const probe = spawnSync(cacheKey, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    stdout = String(probe.stdout || '');
    stderr = String(probe.stderr || '');
  } catch {
    stdout = '';
    stderr = '';
  }

  const combined = `${stdout}\n${stderr}`;
  const capabilities = {
    h264Nvenc: /\bh264_nvenc\b/i.test(combined),
    hevcNvenc: /\bhevc_nvenc\b/i.test(combined),
  };
  FFMPEG_CAPABILITY_CACHE.set(cacheKey, capabilities);
  return capabilities;
}

function resolveMp4CodecConfig(env = process.env, ffmpegBin = 'ffmpeg') {
  const requestedCodec = String(env.A11_VIDEO_MP4_CODEC || 'auto').trim().toLowerCase() || 'auto';
  const capabilities = probeFfmpegCapabilities(ffmpegBin);
  const resolvedCodec = requestedCodec === 'auto'
    ? (capabilities.h264Nvenc ? 'h264_nvenc' : 'libx264')
    : requestedCodec;
  const usesNvenc = /_nvenc$/i.test(resolvedCodec);
  const defaultPreset = usesNvenc ? 'p5' : 'medium';
  const defaultQuality = usesNvenc ? 21 : 19;

  return {
    codec: resolvedCodec,
    preset: String(env.A11_VIDEO_MP4_PRESET || defaultPreset).trim() || defaultPreset,
    quality: clampNumber(env.A11_VIDEO_MP4_CQ, 0, 51, defaultQuality),
    capabilities,
  };
}

function resolveVideoEnvConfig(env = process.env) {
  const ffmpegBin = resolveFfmpegBinary(env.A11_VIDEO_FFMPEG_BIN || env.FFMPEG_BIN || '');
  const mp4Config = resolveMp4CodecConfig(env, ffmpegBin);
  const localRuntime = isLocalVideoRuntime(env);
  const sequencePlannerConfig = resolveSequencePlanningEnvConfig(env);
  const maxRenderSide = resolveVideoFrameMaxSize(env);
  const maxRenderPixels = resolveVideoFrameMaxPixels(env, maxRenderSide);
  const minRenderSide = resolveVideoFrameMinSize(env, maxRenderSide);
  const hasExplicitMinRenderSide = Number.isFinite(Number(env.A11_VIDEO_MIN_RENDER_SIDE));
  const defaultRenderSide = localRuntime
    ? maxRenderSide
    : (hasExplicitMinRenderSide
        ? minRenderSide
        : Math.max(minRenderSide, Math.min(maxRenderSide, resolveImageRenderMaxSide(env))));
  return {
    enabled: env.A11_VIDEO_ENABLED === undefined ? true : isTruthy(env.A11_VIDEO_ENABLED),
    localRuntime,
    backend: String(env.A11_VIDEO_BACKEND || 'sd-frame-sequence').trim().toLowerCase() || 'sd-frame-sequence',
    defaultDurationSeconds: clampNumber(env.A11_VIDEO_DEFAULT_DURATION_SEC, 1, 30, 3),
    maxDurationSeconds: clampNumber(env.A11_VIDEO_MAX_DURATION_SEC, 1, 60, 8),
    defaultFps: clampNumber(env.A11_VIDEO_DEFAULT_FPS, 1, 30, 6),
    maxFps: clampNumber(env.A11_VIDEO_MAX_FPS, 1, 60, 12),
    maxRenderFrames: clampNumber(env.A11_VIDEO_MAX_RENDER_FRAMES, 2, 240, 24),
    maxRenderSide,
    maxRenderPixels,
    minRenderSide,
    defaultWidth: normalizeVideoDimension(env.A11_VIDEO_DEFAULT_WIDTH, {
      fallback: defaultRenderSide,
      min: minRenderSide,
      max: maxRenderSide,
    }),
    defaultHeight: normalizeVideoDimension(env.A11_VIDEO_DEFAULT_HEIGHT, {
      fallback: defaultRenderSide,
      min: minRenderSide,
      max: maxRenderSide,
    }),
    defaultFormat: normalizeVideoFormat(env.A11_VIDEO_DEFAULT_FORMAT || 'mp4', 'mp4'),
    sdSteps: clampNumber(env.A11_VIDEO_SD_STEPS, 4, 80, 24),
    sdGuidanceScale: clampNumber(env.A11_VIDEO_SD_GUIDANCE_SCALE, 1, 20, 6.5),
    ffmpegBin,
    mp4Codec: mp4Config.codec,
    mp4Preset: mp4Config.preset,
    mp4Quality: mp4Config.quality,
    ffmpegCapabilities: mp4Config.capabilities,
    frameInitStrength: clampNumber(env.A11_VIDEO_FRAME_INIT_STRENGTH, 0.05, 0.6, 0.28),
    frameReferenceStrength: clampNumber(env.A11_VIDEO_FRAME_REFERENCE_STRENGTH, 0.05, 0.6, 0.24),
    frameReanchorEvery: clampNumber(env.A11_VIDEO_FRAME_REANCHOR_EVERY, 1, 12, 6),
    useJanusFrameAnalysis: isTruthy(env.A11_VIDEO_USE_JANUS_FRAME_ANALYSIS),
    sequencePlanner: sequencePlannerConfig.sequencePlanner,
    sequencePlannerImageAware: sequencePlannerConfig.sequencePlannerImageAware,
    sequencePlannerTimeoutMs: sequencePlannerConfig.sequencePlannerTimeoutMs,
    workRoot: String(env.A11_VIDEO_WORK_ROOT || '').trim(),
  };
}

function ensureVideoWorkRoot(config = {}) {
  if (config.workRoot) return path.resolve(config.workRoot);
  const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim();
  if (runtimeRoot) {
    return path.resolve(runtimeRoot, 'files', 'generated', 'videos');
  }
  const workspaceRoot = String(process.env.A11_WORKSPACE_ROOT || '').trim();
  if (workspaceRoot) {
    return path.resolve(workspaceRoot, 'runtime', 'files', 'generated', 'videos');
  }
  return path.resolve(process.cwd(), '..', '..', '..', 'runtime', 'files', 'generated', 'videos');
}

function buildVideoWorkingPaths(config = {}) {
  const root = ensureVideoWorkRoot(config);
  const jobId = `video_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const jobRoot = path.join(root, jobId);
  const framesDir = path.join(jobRoot, 'frames');
  return {
    root,
    jobId,
    jobRoot,
    framesDir,
  };
}

function resolveFrameReferenceCandidate({
  preferRemoteReference = false,
  localPath = '',
  remoteUrl = '',
} = {}) {
  const normalizedPath = String(localPath || '').trim();
  const normalizedUrl = String(remoteUrl || '').trim();
  if (preferRemoteReference) {
    return normalizedUrl || normalizedPath;
  }
  return normalizedPath || normalizedUrl;
}

function isImplicitVideoWebInitAllowed(env = process.env) {
  return isTruthy(env?.A11_VIDEO_ALLOW_IMPLICIT_WEB_INIT);
}

function isTrustedImplicitVideoInit(reference = {}) {
  const sourceMode = String(reference?.sourceMode || '').trim().toLowerCase();
  return sourceMode === 'web_reference_subject';
}

function resolveReferencePackSubjectInit(webReferencePack = null) {
  const references = Array.isArray(webReferencePack?.references)
    ? webReferencePack.references
    : [];
  const subjectReference = references.find((entry) => String(entry?.role || '').trim() === 'subject') || null;
  const imageUrl = String(subjectReference?.imageUrl || '').trim();
  if (!imageUrl) return null;
  return {
    initImageUrl: imageUrl,
    initImagePath: '',
    sourceMode: 'web_reference_subject',
  };
}

function resolveReferencePackInitImage(compiledState = {}) {
  return resolveReferencePackSubjectInit(compiledState?.mask?.meta?.webReferencePack || null);
}

function resolveCanonicalSubjectBootstrapContext(mask = {}) {
  const subjectProfileType = normalizeVideoLookup(
    mask?.meta?.subjectProfile?.type
    || mask?.meta?.imageScratchpad?.subjectProfileType
    || ''
  );
  const subjectProfileTypeKey = subjectProfileType.replace(/\s+/g, '_');
  const canonicalSubject = String(
    mask?.meta?.canonicalSubject
    || mask?.meta?.imageScratchpad?.canonicalSubject
    || mask?.meta?.imageEntityContext?.canonicalSubject
    || mask?.meta?.subjectProfile?.canonicalSubject
    || ''
  ).trim();

  return {
    canonicalSubject,
    subjectProfileType: subjectProfileTypeKey,
    eligible: Boolean(
      canonicalSubject
      && ['reference_character', 'pokemon_creature'].includes(subjectProfileTypeKey)
    ),
  };
}

function shouldSkipCanonicalSubjectWebInitForMotionProfile(motionProfile = '') {
  return [
    'walk_cycle',
    'run_cycle',
    'dance_cycle',
    'gesture_loop',
    'subtle_loop',
  ].includes(String(motionProfile || '').trim());
}

async function resolveCanonicalSubjectWebInit({
  request = {},
  compiledState = {},
  resolveImageReferencePack,
  duckduckgoImageSearch,
} = {}) {
  const mask = compiledState?.mask && typeof compiledState.mask === 'object'
    ? compiledState.mask
    : null;
  if (!mask) return null;

  const bootstrapContext = resolveCanonicalSubjectBootstrapContext(mask);
  if (!bootstrapContext.eligible) return null;
  const motionProfile = normalizeVideoLookup(request?.timingPlan?.motionProfile || '').replace(/\s+/g, '_');
  if (shouldSkipCanonicalSubjectWebInitForMotionProfile(motionProfile)) return null;
  const shouldBypassCachedReference = Boolean(motionProfile && motionProfile !== 'generic');

  const cachedReference = shouldBypassCachedReference
    ? null
    : resolveReferencePackSubjectInit(mask?.meta?.webReferencePack || null);
  if (cachedReference) {
    return {
      ...cachedReference,
      canonicalSubject: bootstrapContext.canonicalSubject,
      reason: 'canonical_subject_cached_reference',
    };
  }

  if (typeof resolveImageReferencePack !== 'function') return null;

  try {
    const resolvedPack = await resolveImageReferencePack({
      mask,
      selection: compiledState?.specialCompiler?.selection || null,
      duckduckgoImageSearch,
      forceSubjectLookup: true,
      subjectOnly: true,
      motionProfile,
    });
    const resolvedReference = resolveReferencePackSubjectInit(resolvedPack);
    if (!resolvedReference) return null;

    return {
      ...resolvedReference,
      canonicalSubject: bootstrapContext.canonicalSubject,
      reason: 'canonical_subject_lookup',
    };
  } catch {
    return null;
  }
}

function resolveCompiledImplicitWebInit(compiledState = {}) {
  const draft = compiledState?.mask?.meta?.webImageDraft && typeof compiledState.mask.meta.webImageDraft === 'object'
    ? compiledState.mask.meta.webImageDraft
    : null;
  if (draft) {
    const initImageUrl = String(draft?.initImageUrl || '').trim();
    const initImagePath = String(draft?.initImagePath || '').trim();
    if (initImageUrl || initImagePath) {
      return {
        initImageUrl,
        initImagePath,
        sourceMode: String(draft?.mode || 'web_image_draft').trim() || 'web_image_draft',
        reason: String(draft?.reason || '').trim() || null,
      };
    }
  }
  return resolveReferencePackInitImage(compiledState);
}

function stripImplicitInitFromSdBody(sdBody = {}) {
  if (!sdBody || typeof sdBody !== 'object') return {};
  const {
    init_image_url,
    init_image,
    initImage,
    initImageUrl,
    strength,
    ...rest
  } = sdBody;
  return rest;
}

function hasExplicitVideoVisualSource(request = {}) {
  return Boolean(
    String(request?.sourceImageUrl || '').trim()
    || String(request?.sourceImagePath || '').trim()
    || String(request?.sourceVideoUrl || '').trim()
    || String(request?.sourceVideoPath || '').trim()
    || (
      String(request?.sourceType || '').trim()
      && (
        String(request?.sourceUrl || '').trim()
        || String(request?.sourcePath || '').trim()
      )
    )
  );
}

function extractStoryboardPromptFragments(value = '') {
  return String(value || '')
    .replace(/[.]+$/g, '')
    .split(',')
    .map((fragment) => String(fragment || '').trim())
    .filter(Boolean);
}

function normalizeStoryboardBeat(beat = {}, fallbackLabel = 'continuite') {
  return normalizeStoryboardBeatExternal(beat, fallbackLabel);
}

function normalizeFramePromptFragment(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '')
    .trim();
}

function extractBasePromptFragments(basePrompt = '') {
  return String(basePrompt || '')
    .split(/[,.]/)
    .map((fragment) => normalizeFramePromptFragment(fragment))
    .filter(Boolean);
}

function isStoryboardMetaFragment(fragment = '') {
  const lookup = normalizeVideoLookup(fragment);
  if (!lookup) return false;
  return /\b(frame|video|animation|sequence|storyboard|methode|method|continuite|continuity|smooth motion|same main subject|same subject|consistent|cinematic continuity|opening motion|ending motion|mid motion|palier|prochaine frame|preparer la prochaine frame|priorite|faire evoluer|garder visage|camera fixe|pas de rotation|rotation de camera|no camera rotation)\b/.test(lookup);
}

function resolveStoryboardDynamicFragmentRegex(motionProfile = 'generic') {
  switch (String(motionProfile || 'generic').trim() || 'generic') {
    case 'walk_cycle':
      return /\b(march|walk|avance|avanc|step|stride|pas|balancier)\b/;
    case 'run_cycle':
      return /\b(course|cour|run|sprint|dash|foulee|projection vers l avant)\b/;
    case 'power_up_loop':
      return /\b(aura|haki|energie|energy|ki|power up|powerup|poings? fermes?|poings? serres?|tension|charge)\b/;
    case 'transformation_rise':
      return /\b(transform|transformation|super saiyan|super sayan|ssj|aura|eclairs?|hair|cheveux|forme atteinte|forme stabilisee)\b/;
    case 'mounted_archery':
    case 'archery_shot':
      return /\b(arc|bow|fleche|arrow|tir|shot|corde|visee|traction|mise en joue)\b/;
    case 'action_burst':
      return /\b(kamehameha|hadouken|beam|blast|rayon|attaque|attack|combat|fight|impact|energie|energy|kick|punch|slash|frappe)\b/;
    case 'dance_cycle':
    case 'gesture_loop':
    case 'subtle_loop':
      return /\b(danse|dance|gesture|geste|smile|sourire|blink|cligne|nod|hoche|wave|salut)\b/;
    default:
      return /\b(mouvement|motion|action|attaque|attack|transform|transformation|walk|run|march|course|tir|shot|aura|energie|energy|combat|fight)\b/;
  }
}

function extractStableSceneFragments(basePrompt = '', motionProfile = 'generic') {
  const dynamicRegex = resolveStoryboardDynamicFragmentRegex(motionProfile);
  const unique = new Set();
  const fragments = [];

  for (const fragment of extractBasePromptFragments(basePrompt).slice(1)) {
    const normalized = normalizeVideoLookup(fragment);
    if (!normalized) continue;
    if (isStoryboardMetaFragment(fragment)) continue;
    if (dynamicRegex.test(normalized)) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    fragments.push(fragment);
    if (fragments.length >= 4) break;
  }

  return fragments;
}

function buildStoryboardTransitionBeat(fromBeat = {}, toBeat = {}) {
  const from = normalizeStoryboardBeat(fromBeat, 'phase precedente');
  const to = normalizeStoryboardBeat(toBeat, 'phase suivante');
  const fromFragments = extractStoryboardPromptFragments(from.prompt || '');
  const toFragments = extractStoryboardPromptFragments(to.prompt || '');
  const transitionParts = [];

  if (fromFragments.length) transitionParts.push(fromFragments[fromFragments.length - 1]);
  for (const fragment of toFragments.slice(0, 2)) {
    if (!transitionParts.includes(fragment)) transitionParts.push(fragment);
  }

  return {
    label: `${from.label} vers ${to.label}`,
    prompt: transitionParts.join(', ') || `${from.label}, ${to.label}`,
  };
}

function densifyStoryboardBeats(beats = []) {
  const normalized = (Array.isArray(beats) ? beats : [])
    .map((beat) => normalizeStoryboardBeat(beat))
    .filter((beat) => beat.prompt);
  if (normalized.length <= 1) return normalized;

  const dense = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    dense.push(current);
    if (index < normalized.length - 1) {
      dense.push(buildStoryboardTransitionBeat(current, normalized[index + 1]));
    }
  }
  return dense;
}

function sampleStoryboardBeats(beats = [], frameCount = 1) {
  const normalized = (Array.isArray(beats) ? beats : [])
    .map((beat) => normalizeStoryboardBeat(beat))
    .filter((beat) => beat.prompt);
  if (!normalized.length) return [];
  if (frameCount <= 1) return [normalized[0]];
  if (normalized.length === frameCount) return normalized.slice();

  const maxIndex = normalized.length - 1;
  const result = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const position = (frameIndex * maxIndex) / Math.max(frameCount - 1, 1);
    const selectedIndex = Math.max(0, Math.min(maxIndex, Math.floor(position)));
    result.push(normalized[selectedIndex]);
  }
  return result;
}

function resolveStoryboardFrames(baseBeats = [], frameCount = 1) {
  let working = (Array.isArray(baseBeats) ? baseBeats : [])
    .map((beat) => normalizeStoryboardBeat(beat))
    .filter((beat) => beat.prompt);

  if (!working.length) {
    return Array.from({ length: Math.max(1, frameCount) }, () => ({
      label: 'continuite',
      prompt: 'faire avancer la posture d une etape visible',
    }));
  }

  if (working.length < frameCount && working.length > 1) {
    const denser = densifyStoryboardBeats(working);
    if (denser.length > working.length) {
      working = denser;
    }
  }

  const sampled = sampleStoryboardBeats(working, frameCount);
  while (sampled.length < frameCount) {
    sampled.push(sampled[sampled.length - 1]);
  }
  return sampled;
}

function buildGenericStoryboardBeats() {
  return [
    {
      label: 'depart stable',
      prompt: 'posture de depart stable, appuis nets, geste encore contenu',
    },
    {
      label: 'engagement',
      prompt: 'debut du geste, un appui change clairement, le buste commence a suivre',
    },
    {
      label: 'transfert',
      prompt: 'transfert de poids visible, geste plus ouvert, silhouette toujours claire',
    },
    {
      label: 'point fort',
      prompt: 'point fort du geste ou de la posture, action lisible sans changer toute la scene',
    },
    {
      label: 'sortie stable',
      prompt: 'sortie du geste, posture stabilisee apres l action',
    },
  ];
}

function buildWalkCycleStoryboardBeats() {
  return [
    {
      label: 'depart neutre',
      prompt: 'posture neutre de marche, poids reparti sur les deux jambes, depart pret',
    },
    {
      label: 'pas gauche engage',
      prompt: 'jambe gauche avance devant, bras droit vient legerement devant, marche enclenchee',
    },
    {
      label: 'appui gauche',
      prompt: 'poids sur la jambe gauche, pied droit commence a quitter le sol, bassin legerement bas',
    },
    {
      label: 'passage droit',
      prompt: 'jambe droite passe sous le corps, jambe gauche porte l appui, buste stable',
    },
    {
      label: 'pas droit engage',
      prompt: 'jambe droite avance devant, bras gauche vient legerement devant, pas suivant visible',
    },
    {
      label: 'appui droit',
      prompt: 'poids sur la jambe droite, pied gauche quitte le sol, bassin legerement bas',
    },
    {
      label: 'passage gauche',
      prompt: 'jambe gauche passe sous le corps, jambe droite porte l appui, marche continue',
    },
    {
      label: 'relance gauche',
      prompt: 'jambe gauche revient devant pour relancer la marche, balancier naturel des bras',
    },
    {
      label: 'sortie de marche',
      prompt: 'marche encore lisible, posture stable apres la progression',
    },
  ];
}

function buildRunCycleStoryboardBeats() {
  return [
    {
      label: 'depart de course',
      prompt: 'posture de depart dynamique, corps pret a partir, appuis clairs',
    },
    {
      label: 'attaque gauche',
      prompt: 'jambe gauche attaque devant, buste penche legerement, bras opposes actifs',
    },
    {
      label: 'compression gauche',
      prompt: 'poids compresse sur la jambe gauche, bassin bas, energie accumulee',
    },
    {
      label: 'envol',
      prompt: 'les deux pieds quittent legerement le sol, projection nette vers l avant',
    },
    {
      label: 'attaque droite',
      prompt: 'jambe droite attaque devant, bras opposes inverses, course lisible',
    },
    {
      label: 'compression droite',
      prompt: 'poids compresse sur la jambe droite, energie relancee vers l avant',
    },
    {
      label: 'sortie de course',
      prompt: 'course encore lisible, posture stabilisee apres la poussee',
    },
  ];
}

function buildGestureStoryboardBeats() {
  return [
    {
      label: 'depart',
      prompt: 'pose de depart proche de la reference, geste encore contenu',
    },
    {
      label: 'amorce',
      prompt: 'debut du geste, variation visible mais encore courte',
    },
    {
      label: 'progression',
      prompt: 'geste plus ouvert, posture toujours stable et lisible',
    },
    {
      label: 'point haut',
      prompt: 'point haut du geste, mouvement clair sans deformation',
    },
    {
      label: 'retour',
      prompt: 'retour doux apres le geste, posture stabilisee',
    },
  ];
}

function buildPowerUpStoryboardBeats() {
  return [
    {
      label: 'menace neutre',
      prompt: 'posture menacante stable, poings fermes, aura encore faible',
      checkpoint: true,
    },
    {
      label: 'tension montante',
      prompt: 'epaules et torse plus tendus, poings serres, aura plus visible',
    },
    {
      label: 'compression',
      prompt: 'corps legerement ramasse, energie concentree autour du corps, posture plus dense',
    },
    {
      label: 'ouverture',
      prompt: 'torse plus ouvert, silhouette plus forte, aura se deploie davantage',
      checkpoint: true,
    },
    {
      label: 'maintien puissant',
      prompt: 'tenir une posture forte, aura intense, visage et identite coherents',
    },
    {
      label: 'retombee courte',
      prompt: 'laisser retomber legerement la tension sans perdre la menace',
    },
    {
      label: 'stabilisation',
      prompt: 'posture puissante stabilisee apres la montee d energie',
      checkpoint: true,
    },
  ];
}

function resolveTransformationTheme(prompt = '') {
  const lookup = normalizeVideoLookup(prompt);

  if (/\b(divin|god)\b/.test(lookup)) {
    return {
      targetLabel: 'super saiyan divin',
      hairColor: 'rouges divins',
      auraColor: 'rouge divine',
      lightningColor: 'rouges',
    };
  }
  if (/\b(blue|bleu)\b/.test(lookup)) {
    return {
      targetLabel: 'super saiyan bleu',
      hairColor: 'bleus',
      auraColor: 'bleue intense',
      lightningColor: 'bleus',
    };
  }
  if (/\b(ultra instinct|instinct supreme|instinct surp)\b/.test(lookup)) {
    return {
      targetLabel: 'ultra instinct',
      hairColor: 'argentes',
      auraColor: 'argentee',
      lightningColor: 'blancs',
    };
  }
  if (/\b(super saiyan|super sayan|ssj)\b/.test(lookup)) {
    return {
      targetLabel: 'super saiyan',
      hairColor: 'dors',
      auraColor: 'doree',
      lightningColor: 'dores',
    };
  }

  return {
    targetLabel: 'forme transformee',
    hairColor: 'transformes',
    auraColor: 'dense',
    lightningColor: 'energetiques',
  };
}

function buildTransformationStoryboardBeats(prompt = '', frameCount = 10) {
  const theme = resolveTransformationTheme(prompt);
  const baseBeats = [
    {
      label: 'forme initiale',
      prompt: 'posture droite stable, bras proches du corps, cheveux encore normaux, aura presque absente',
      checkpoint: true,
    },
    {
      label: 'premiere tension',
      prompt: 'regard plus dur, machoire serree, epaules plus tendues, quelques meches commencent a se dresser',
    },
    {
      label: 'cheveux se dressent',
      prompt: 'cheveux se dressent davantage, posture toujours droite, premiere lueur d energie autour du corps',
    },
    {
      label: 'premiers eclairs',
      prompt: `cheveux presque totalement dresses, quelques eclairs ${theme.lightningColor} apparaissent, aura ${theme.auraColor} encore fine`,
    },
    {
      label: 'changement de couleur',
      prompt: `couleur des cheveux commence a changer, cheveux ${theme.hairColor} naissants, aura ${theme.auraColor} plus epaisse`,
    },
    {
      label: 'bascule',
      prompt: `cheveux ${theme.hairColor} bien visibles, aura ${theme.auraColor} enveloppe le corps, transformation clairement engagee`,
      checkpoint: true,
    },
    {
      label: 'forme presque atteinte',
      prompt: `forme ${theme.targetLabel} presque atteinte, cheveux ${theme.hairColor} stables, visage toujours reconnaissable`,
    },
    {
      label: 'forme atteinte',
      prompt: `forme ${theme.targetLabel} atteinte, cheveux ${theme.hairColor}, aura ${theme.auraColor} intense, silhouette nette`,
      checkpoint: true,
    },
    {
      label: 'maintien puissant',
      prompt: `tenir la forme ${theme.targetLabel}, aura ${theme.auraColor} large mais propre, posture toujours droite`,
    },
    {
      label: 'stabilisation finale',
      prompt: `forme ${theme.targetLabel} stabilisee, meme visage, meme tenue, energie maitrisee autour du corps`,
      checkpoint: true,
    },
  ];

  if (frameCount >= baseBeats.length) return baseBeats;
  return baseBeats;
}

function buildArcheryStoryboardBeats({ mounted = false, prompt = '', frameCount = 8 } = {}) {
  const lookup = normalizeVideoLookup(prompt);
  const horseMotion = /\b(galop|court|running|galope|avance)\b/.test(lookup)
    ? 'le cheval garde un vrai mouvement de course'
    : 'le cheval reste stable et lisible';
  const mountedTail = mounted
    ? `${horseMotion}, la cavaliere reste bien assise en selle`
    : 'les appuis du corps restent stables pendant le tir';

  const baseBeats = [
    {
      label: 'depart de tir',
      prompt: `posture stable de tir, arc encore bas, cible deja reperee, ${mountedTail}`,
      checkpoint: true,
    },
    {
      label: 'lever l arc',
      prompt: `arc commence a se lever, main de corde se place, regard deja oriente vers la cible, ${mountedTail}`,
    },
    {
      label: 'mise en joue',
      prompt: `arc leve, bras d arc tendu, bassin stable, visee claire, ${mountedTail}`,
      checkpoint: true,
    },
    {
      label: 'traction moyenne',
      prompt: `corde tiree a mi-course, epaules alignees, fleche deja orientee vers la cible, ${mountedTail}`,
    },
    {
      label: 'traction forte',
      prompt: `corde presque a pleine traction, fleche bien alignee, posture de tir nette, ${mountedTail}`,
      checkpoint: true,
    },
    {
      label: 'tir',
      prompt: `instant du tir ou juste avant le lacher, bras bien ouverts, energie du geste tres claire, ${mountedTail}`,
    },
    {
      label: 'suivi du tir',
      prompt: `suivi du tir, bras encore ouverts, corps accompagne le geste sans changer de structure, ${mountedTail}`,
    },
    {
      label: 'sortie stable',
      prompt: `posture stabilisee apres le tir, arc encore lisible, ${mountedTail}`,
      checkpoint: true,
    },
  ];

  if (frameCount >= baseBeats.length) return baseBeats;
  return baseBeats;
}

function buildActionBurstStoryboardBeats(prompt = '') {
  const lookup = normalizeVideoLookup(prompt);
  const isEnergyBurst = /\b(kamehameha|hadouken|energy|energie|beam|blast|rayon|ki blast|boule d energie|charge d energie)\b/.test(lookup);

  if (isEnergyBurst) {
    return [
      {
        label: 'garde de depart',
        prompt: 'posture de depart stable, geste encore retenu, energie faible',
        checkpoint: true,
      },
      {
        label: 'charge',
        prompt: 'bras et epaules organisent la charge, energie commence a monter',
      },
      {
        label: 'concentration',
        prompt: 'energie plus dense, transfert de poids visible, geste se precise',
      },
      {
        label: 'deploiement',
        prompt: 'bras et buste se deploient davantage, energie prete a sortir',
        checkpoint: true,
      },
      {
        label: 'emission',
        prompt: 'projection d energie lisible, posture forte et equilibree',
      },
      {
        label: 'suite d emission',
        prompt: 'le corps accompagne encore l action apres le pic',
      },
      {
        label: 'sortie',
        prompt: 'retombee du geste, energie se dissipe, posture reste lisible',
        checkpoint: true,
      },
    ];
  }

  return [
    {
      label: 'garde de depart',
      prompt: 'posture de depart stable, geste encore retenu',
      checkpoint: true,
    },
    {
      label: 'preparation',
      prompt: 'appuis et torsion du corps preparent clairement l action',
    },
    {
      label: 'montee',
      prompt: 'geste plus grand, energie du corps plus forte, silhouette claire',
    },
    {
      label: 'impact',
      prompt: 'moment fort du geste, action pleinement deployee, posture lisible',
      checkpoint: true,
    },
    {
      label: 'accompagnement',
      prompt: 'le corps accompagne l action apres le point fort',
    },
    {
      label: 'sortie',
      prompt: 'sortie de geste, tension qui redescend sans perdre la coherence',
      checkpoint: true,
    },
  ];
}

function buildVideoStoryboard(request = {}, sequencePlan = {}) {
  return buildVideoStoryboardExternal(sequencePlan?.beats || [], Math.max(1, Number(request?.frameCount || 1) || 1));
}

function resolveVideoSequencePlan(request = {}) {
  return resolveVideoSequencePlanExternal(request, {
    providerRequested: String(request?.config?.sequencePlanner || 'heuristic').trim() || 'heuristic',
  });
}

function splitFramePromptClauses(value = '') {
  return String(value || '')
    .split(/[,.]/)
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean);
}

function removeFrameContinuityClauses(clauses = []) {
  return (Array.isArray(clauses) ? clauses : [])
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean)
    .filter((entry) => !/\b(meme visage|meme tenue|meme silhouette|meme decor|meme cheval|meme selle|meme position)\b/i.test(normalizeVideoLookup(entry)));
}

function buildCheckpointStructuralPrompt(subject = '', checkpointPrompt = '', fallbackStructuralPrompt = '') {
  const clauses = removeFrameContinuityClauses(splitFramePromptClauses(checkpointPrompt));
  if (!clauses.length) {
    return fallbackStructuralPrompt || `${subject || 'personnage principal'}, structure stable lisible`;
  }
  return [subject || 'personnage principal', ...clauses.slice(0, 2)]
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean)
    .join(', ');
}

function buildCheckpointVariationPrompt(checkpointPrompt = '') {
  const clauses = removeFrameContinuityClauses(splitFramePromptClauses(checkpointPrompt));
  if (clauses.length > 2) {
    return clauses.slice(2).join(', ');
  }
  return 'checkpoint visuel propre, nouvelle structure deja lisible';
}

function buildFramePromptPlan(basePrompt = '', {
  framePlan = null,
  sequencePlan = null,
  referenceAnalysis = null,
} = {}) {
  return buildFramePromptPlanExternal(basePrompt, {
    beat: framePlan,
    sequencePlan,
    referenceAnalysis,
  });
}

function buildFramePrompt(basePrompt = '', options = {}) {
  return buildFramePromptExternal(basePrompt, options);
}

function resolveFrameInitPlan({
  frameIndex = 0,
  anchorAvailable = false,
  previousAvailable = false,
  framePlan = null,
  sequencePlan = null,
} = {}) {
  if (!anchorAvailable && !previousAvailable) {
    return {
      useAnchorReference: false,
      initSourceLabel: 'prompt_only',
    };
  }

  const plan = sequencePlan && typeof sequencePlan === 'object'
    ? sequencePlan
    : resolveVideoSequencePlan({});
  const reanchorEvery = Number(plan.reanchorEvery || 0) || 0;

  if (plan.initStrategy === 'checkpoint_anchor') {
    if (anchorAvailable) {
      return {
        useAnchorReference: true,
        initSourceLabel: frameIndex === 0 && !previousAvailable ? 'reference_anchor' : 'segment_anchor',
      };
    }
    if (previousAvailable) {
      return {
        useAnchorReference: false,
        initSourceLabel: 'previous_frame',
      };
    }
    return {
      useAnchorReference: false,
      initSourceLabel: 'prompt_only',
    };
  }

  if (plan.initStrategy === 'checkpoint_chain') {
    if (!previousAvailable) {
      return {
        useAnchorReference: Boolean(anchorAvailable),
        initSourceLabel: anchorAvailable ? 'reference_anchor' : 'prompt_only',
      };
    }
    const currentBeat = framePlan && typeof framePlan === 'object' ? framePlan : null;
    return {
      useAnchorReference: false,
      initSourceLabel: currentBeat?.checkpoint ? 'checkpoint_chain' : 'previous_frame',
    };
  }

  if (plan.initStrategy === 'progressive_chain') {
    if (!previousAvailable) {
      return {
        useAnchorReference: Boolean(anchorAvailable),
        initSourceLabel: anchorAvailable ? 'reference_anchor' : 'prompt_only',
      };
    }
    const shouldReanchor = Boolean(
      anchorAvailable
      && reanchorEvery > 0
      && frameIndex > 0
      && frameIndex % reanchorEvery === 0
    );
    if (shouldReanchor) {
      return {
        useAnchorReference: true,
        initSourceLabel: 'reference_reanchor',
      };
    }
    return {
      useAnchorReference: false,
      initSourceLabel: 'previous_frame',
    };
  }

  const useAnchorReference = Boolean(
    anchorAvailable
    && (
      frameIndex === 0
      || !previousAvailable
      || (reanchorEvery > 0 && frameIndex % reanchorEvery === 0)
    )
  );

  return {
    useAnchorReference,
    initSourceLabel: (
      useAnchorReference
        ? (frameIndex === 0 ? 'reference_anchor' : 'reference_reanchor')
        : (previousAvailable ? 'previous_frame' : 'prompt_only')
    ),
  };
}

function resolveVideoMotionPlan(prompt = '', config = {}) {
  const lookup = normalizeVideoLookup(prompt);
  const hasMountedArchery = (
    /\b(arc|bow|fleche|fleches|arrow|arrows|bander|tir a l arc|tirant une fleche)\b/.test(lookup)
    && /\b(cheval|horse|mounted|a cheval|sur un cheval)\b/.test(lookup)
  );
  if (hasMountedArchery) {
    return {
      key: 'mounted_archery',
      reason: 'mounted_archery_motion_detected',
      minFrames: 8,
      preferredFrameCount: 8,
      preferredFps: 4,
      preferredDurationSeconds: 2,
    };
  }

  if (/\b(transform|transforms|transforming|transformation|transforme|transformant|super saiyan|super sayan|ssj)\b/.test(lookup)) {
    return {
      key: 'transformation_rise',
      reason: 'transformation_motion_detected',
      minFrames: 10,
      preferredFrameCount: 10,
      preferredFps: 5,
      preferredDurationSeconds: 2,
    };
  }

  const profiles = [
    {
      key: 'run_cycle',
      reason: 'running_motion_detected',
      regex: /\b(run|running|sprint|sprinting|dash|dashing|charge|charging|courir|court|course|sprinte|sprinter)\b/,
      minFrames: 10,
      preferredFrameCount: 10,
      preferredFps: 5,
      preferredDurationSeconds: 2,
    },
    {
      key: 'dance_cycle',
      reason: 'dance_motion_detected',
      regex: /\b(dance|dancing|danse|danser|dansant|twirl|spin|spinning|pirouette|tournoie|tournoiement)\b/,
      minFrames: 10,
      preferredFrameCount: 10,
      preferredFps: 5,
      preferredDurationSeconds: 2,
    },
    {
      key: 'walk_cycle',
      reason: 'walking_motion_detected',
      regex: /\b(walk|walking|step|stepping|stride|stroll|moving forward|marche|marcher|marchant|avance|avancant|avancer|pas devant|pas a pas|pas apres pas|un pas devant l autre)\b/,
      minFrames: 8,
      preferredFrameCount: 8,
      preferredFps: 4,
      preferredDurationSeconds: 2,
    },
    {
      key: 'archery_shot',
      reason: 'archery_motion_detected',
      regex: /\b(arc|bow|fleche|fleches|arrow|arrows|bander|tir a l arc|tirant une fleche)\b/,
      minFrames: 8,
      preferredFrameCount: 8,
      preferredFps: 4,
      preferredDurationSeconds: 2,
    },
    {
      key: 'power_up_loop',
      reason: 'power_up_motion_detected',
      regex: /\b(haki|aura|power up|powerup|charge|charging|ki|energie|energy|transformation|menacant|menacante|threatening|poing serre|poings serres|poings fermes|fists clenched)\b/,
      minFrames: 8,
      preferredFrameCount: 8,
      preferredFps: 4,
      preferredDurationSeconds: 2,
    },
    {
      key: 'action_burst',
      reason: 'action_motion_detected',
      regex: /\b(kick|kicking|punch|punching|slash|slashing|swing|attaque|attack|attacking|jump|jumping|flip|frappe|coup de pied|saute|bondit|coup d epee|kamehameha|hadouken|beam|blast|rayon|energie|energy|combat|fight|fighting|battle|duel|affrontement|vs|versus)\b/,
      minFrames: 6,
      preferredFrameCount: 6,
      preferredFps: 4,
      preferredDurationSeconds: 1.5,
    },
    {
      key: 'gesture_loop',
      reason: 'gesture_motion_detected',
      regex: /\b(wave|waving|salut|salue|smile|smiling|sourit|blink|blinking|cligne|nod|nodding|hoche|turns head|turn head|tourne la tete|regarde)\b/,
      minFrames: 5,
      preferredFrameCount: 5,
      preferredFps: 4,
      preferredDurationSeconds: 1.25,
    },
    {
      key: 'subtle_loop',
      reason: 'subtle_motion_detected',
      regex: /\b(idle|breath|breathing|respire|respiration|calme|standing still|immobile)\b/,
      minFrames: 4,
      preferredFrameCount: 4,
      preferredFps: 3,
      preferredDurationSeconds: 1.33,
    },
  ];

  const matched = profiles.find((profile) => profile.regex.test(lookup)) || null;
  if (!matched) {
    return {
      key: 'generic',
      reason: 'generic_motion',
      minFrames: 0,
      preferredFrameCount: 0,
      preferredFps: config.defaultFps,
      preferredDurationSeconds: config.defaultDurationSeconds,
    };
  }

  return matched;
}

function resolveVideoTimingPlan({
  parsed = {},
  body = {},
  config = {},
  prompt = '',
} = {}) {
  const bodyDurationSeconds = resolvePositiveNumber(body?.durationSeconds, body?.duration_seconds, body?.duration);
  const bodyFps = resolvePositiveNumber(body?.fps);
  const bodyFrameCount = resolvePositiveNumber(body?.frameCount, body?.frame_count, body?.frames);
  const parsedDurationSeconds = resolvePositiveNumber(parsed?.durationSeconds, bodyDurationSeconds);
  const parsedFps = resolvePositiveNumber(parsed?.fps, bodyFps);
  const parsedFrameCount = resolvePositiveNumber(parsed?.frameCount, bodyFrameCount);
  const hasTextDuration = resolvePositiveNumber(parsed?.textDurationSeconds) > 0;
  const hasTextFps = resolvePositiveNumber(parsed?.textFps) > 0;
  const hasTextFrameCount = resolvePositiveNumber(parsed?.textFrameCount) > 0;
  const hasBodyDuration = hasOwnPositiveNumber(body, ['durationSeconds', 'duration_seconds', 'duration']);
  const hasBodyFps = hasOwnPositiveNumber(body, ['fps']);
  const hasBodyFrameCount = hasOwnPositiveNumber(body, ['frameCount', 'frame_count', 'frames']);
  const strictTiming = (
    isTruthy(body?.strictTiming)
    || isTruthy(body?.lockTiming)
    || isTruthy(body?.respectTiming)
    || isTruthy(body?.manualTiming)
    || String(body?.timingMode || '').trim().toLowerCase() === 'manual'
  );
  const durationLooksDefault = bodyDurationSeconds > 0 && bodyDurationSeconds === Number(config.defaultDurationSeconds || 0);
  const fpsLooksDefault = bodyFps > 0 && bodyFps === Number(config.defaultFps || 0);
  const explicitDuration = Boolean(
    hasTextDuration
    || (hasBodyDuration && (strictTiming || !durationLooksDefault))
  );
  const explicitFps = Boolean(
    hasTextFps
    || (hasBodyFps && (strictTiming || !fpsLooksDefault))
  );
  const explicitFrameCount = Boolean(
    hasTextFrameCount
    || hasBodyFrameCount
  );
  const motionPlan = resolveVideoMotionPlan(prompt, config);

  let durationSeconds = clampNumber(
    parsedDurationSeconds || config.defaultDurationSeconds,
    1,
    config.maxDurationSeconds,
    config.defaultDurationSeconds
  );
  let fps = clampNumber(
    parsedFps || config.defaultFps,
    1,
    config.maxFps,
    config.defaultFps
  );
  let frameCount = 0;
  let source = 'request_or_defaults';

  if (explicitFrameCount) {
    frameCount = Math.max(2, Math.min(config.maxRenderFrames, Math.round(parsedFrameCount || 2)));
    if (!explicitFps && motionPlan.key !== 'generic') {
      fps = clampNumber(motionPlan.preferredFps, 1, config.maxFps, config.defaultFps);
    }
    if (!explicitDuration) {
      durationSeconds = clampNumber(
        roundTimingValue(frameCount / Math.max(fps, 1)),
        1,
        config.maxDurationSeconds,
        config.defaultDurationSeconds
      );
    } else if (!explicitFps) {
      fps = clampNumber(Math.ceil(frameCount / Math.max(durationSeconds, 0.1)), 1, config.maxFps, fps);
    }
    source = 'explicit_frame_count';
  } else if (motionPlan.key !== 'generic' && !(explicitDuration && explicitFps)) {
    const targetMinFrames = Math.max(2, Math.min(config.maxRenderFrames, motionPlan.minFrames || 0));
    if (explicitDuration && !explicitFps) {
      fps = clampNumber(
        Math.max(
          motionPlan.preferredFps,
          Math.ceil(targetMinFrames / Math.max(durationSeconds, 0.1))
        ),
        1,
        config.maxFps,
        motionPlan.preferredFps
      );
      frameCount = Math.max(2, Math.min(config.maxRenderFrames, Math.round(durationSeconds * fps)));
      source = 'auto_motion_profile_duration_locked';
    } else if (!explicitDuration && explicitFps) {
      frameCount = Math.max(
        targetMinFrames,
        Math.round((motionPlan.preferredDurationSeconds || config.defaultDurationSeconds) * fps)
      );
      frameCount = Math.max(2, Math.min(config.maxRenderFrames, frameCount));
      durationSeconds = clampNumber(
        roundTimingValue(frameCount / Math.max(fps, 1)),
        1,
        config.maxDurationSeconds,
        config.defaultDurationSeconds
      );
      source = 'auto_motion_profile_fps_locked';
    } else {
      fps = clampNumber(motionPlan.preferredFps, 1, config.maxFps, config.defaultFps);
      frameCount = Math.max(
        targetMinFrames,
        Math.round((motionPlan.preferredDurationSeconds || config.defaultDurationSeconds) * fps)
      );
      frameCount = Math.max(
        2,
        Math.min(
          config.maxRenderFrames,
          Math.max(frameCount, motionPlan.preferredFrameCount || 0)
        )
      );
      durationSeconds = clampNumber(
        roundTimingValue(frameCount / Math.max(fps, 1)),
        1,
        config.maxDurationSeconds,
        config.defaultDurationSeconds
      );
      source = 'auto_motion_profile';
    }
  }

  if (!frameCount) {
    frameCount = Math.max(2, Math.min(config.maxRenderFrames, Math.round(durationSeconds * fps)));
  }

  return {
    durationSeconds,
    fps,
    frameCount,
    explicitDuration,
    explicitFps,
    explicitFrameCount,
    strictTiming,
    source,
    motionProfile: motionPlan.key,
    motionReason: motionPlan.reason,
    motionMinFrames: motionPlan.minFrames || 0,
  };
}

function applyVideoRequestConfigOverrides(baseConfig = {}, parsed = {}) {
  const config = {
    ...(baseConfig && typeof baseConfig === 'object' ? baseConfig : {}),
  };

  if (typeof parsed?.sequencePlanner === 'string' && parsed.sequencePlanner.trim()) {
    config.sequencePlanner = String(parsed.sequencePlanner).trim();
  }
  if (typeof parsed?.sequencePlannerImageAware === 'boolean') {
    config.sequencePlannerImageAware = parsed.sequencePlannerImageAware;
  }
  if (Number(parsed?.sequencePlannerTimeoutMs) > 0) {
    config.sequencePlannerTimeoutMs = clampNumber(
      parsed.sequencePlannerTimeoutMs,
      5_000,
      300_000,
      Number(baseConfig?.sequencePlannerTimeoutMs || 20_000) || 20_000
    );
  }

  return config;
}

function normalizeVideoRequest(body = {}, promptOverride = '') {
  const parsed = parseVideoGenerateRequest(promptOverride || body?.message || body?.prompt || '', body);
  const config = applyVideoRequestConfigOverrides(
    resolveVideoEnvConfig(process.env),
    parsed
  );
  const prompt = String(parsed.prompt || promptOverride || body?.prompt || body?.message || '').trim();
  const format = normalizeVideoFormat(parsed.format || body?.format || config.defaultFormat, config.defaultFormat);
  const timingPlan = resolveVideoTimingPlan({
    parsed,
    body,
    config,
    prompt,
  });
  const durationSeconds = timingPlan.durationSeconds;
  const fps = timingPlan.fps;
  const hasExplicitWidth = parsed.width !== undefined || body?.width !== undefined;
  const hasExplicitHeight = parsed.height !== undefined || body?.height !== undefined;
  const requestedWidth = Number(parsed.width || body?.width || config.defaultWidth);
  const requestedHeight = Number(parsed.height || body?.height || config.defaultHeight);
  const fittedDimensions = fitRenderDimensionsWithinLimits({
    width: requestedWidth,
    height: requestedHeight,
    fallbackWidth: config.defaultWidth,
    fallbackHeight: config.defaultHeight,
    minSide: config.minRenderSide,
    maxSide: config.maxRenderSide,
    maxPixels: config.maxRenderPixels,
  });
  const width = fittedDimensions.width;
  const height = fittedDimensions.height;
  if (requestedWidth !== undefined && width !== requestedWidth) {
    console.warn(`[A11][video-runtime] width requested=${requestedWidth} effective=${width} (fit min=${config.minRenderSide} max=${config.maxRenderSide} max_pixels=${config.maxRenderPixels})`);
  }
  if (requestedHeight !== undefined && height !== requestedHeight) {
    console.warn(`[A11][video-runtime] height requested=${requestedHeight} effective=${height} (fit min=${config.minRenderSide} max=${config.maxRenderSide} max_pixels=${config.maxRenderPixels})`);
  }
  const frameCount = timingPlan.frameCount;

  return {
    config,
    prompt,
    durationSeconds,
    fps,
    format,
    width,
    height,
    frameCount,
    sourceType: parsed.sourceType || '',
    sourceUrl: parsed.sourceUrl || '',
    sourcePath: parsed.sourcePath || '',
    sourceImageUrl: parsed.sourceImageUrl || '',
    sourceImagePath: parsed.sourceImagePath || '',
    sourceVideoUrl: parsed.sourceVideoUrl || '',
    sourceVideoPath: parsed.sourceVideoPath || '',
    explicitWidth: hasExplicitWidth,
    explicitHeight: hasExplicitHeight,
    explicitDuration: timingPlan.explicitDuration,
    explicitFps: timingPlan.explicitFps,
    explicitFrameCount: timingPlan.explicitFrameCount,
    timingPlan,
    // Pour traçabilité
    requestedWidth,
    requestedHeight,
    VIDEO_FRAME_MAX_SIZE: config.maxRenderSide,
  };
}

function looksLikeImplicitSquareDefault(request = {}) {
  const width = Number(request?.width || 0);
  const height = Number(request?.height || 0);
  const defaultWidth = Number(request?.config?.defaultWidth || 0);
  const defaultHeight = Number(request?.config?.defaultHeight || 0);
  if (!(request?.explicitWidth && request?.explicitHeight)) return false;
  if (!width || !height || width !== height) return false;
  if (!defaultWidth || !defaultHeight) return false;
  return width === defaultWidth && height === defaultHeight;
}

function resolveCompiledRenderSizing(compiledState = {}, compiledSdBody = {}, request = {}) {
  const renderSizing = compiledState?.mask?.meta?.renderSizing
    && typeof compiledState.mask.meta.renderSizing === 'object'
      ? compiledState.mask.meta.renderSizing
      : null;
  const resolvedWidth = Number(renderSizing?.resolvedWidth || compiledSdBody?.width || 0);
  const resolvedHeight = Number(renderSizing?.resolvedHeight || compiledSdBody?.height || 0);

  if (!(resolvedWidth > 0 && resolvedHeight > 0)) {
    return null;
  }

  if (
    !renderSizing
    && resolvedWidth === Number(request?.width || 0)
    && resolvedHeight === Number(request?.height || 0)
  ) {
    return null;
  }

  return {
    source: String(renderSizing?.source || 'compiled_sd_body').trim() || 'compiled_sd_body',
    reason: String(renderSizing?.reason || 'compiled_render_size').trim() || 'compiled_render_size',
    requestedWidth: Number(renderSizing?.requestedWidth || resolvedWidth),
    requestedHeight: Number(renderSizing?.requestedHeight || resolvedHeight),
    width: resolvedWidth,
    height: resolvedHeight,
  };
}

function ensureVideoFilename(format = 'mp4') {
  const normalized = normalizeVideoFormat(format, 'mp4');
  return `a11-video-${Date.now()}.${normalized}`;
}

function guessContentTypeFromPath(filePath = '') {
  const ext = String(path.extname(filePath || '')).trim().toLowerCase();
  if (ext === '.gif') return 'image/gif';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  return 'image/png';
}

function buildLocalPublicUrl(req, candidatePath) {
  const absolutePath = path.resolve(String(candidatePath || '').trim());
  if (!absolutePath || !fs.existsSync(absolutePath)) return '';

  const backendWorkspaceRoot = path.resolve(
    String(process.env.A11_WORKSPACE_ROOT || path.resolve(process.cwd(), '..', '..')).trim()
  );
  const relativePath = String(path.relative(backendWorkspaceRoot, absolutePath) || '').replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) return '';

  const publicPath = `/files/${relativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/')}`;
  const origin = resolveRequestOrigin(req);
  return origin ? `${origin}${publicPath}` : publicPath;
}

function isLoopbackUrl(value = '') {
  try {
    const parsed = new URL(String(value || '').trim());
    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    return hostname === '127.0.0.1'
      || hostname === 'localhost'
      || hostname === '::1'
      || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isUnsafeAssetUrlForClient(req, value = '') {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  if (isLoopbackUrl(raw)) return true;

  try {
    const requestOrigin = resolveRequestOrigin(req);
    const requestProtocol = requestOrigin ? new URL(requestOrigin).protocol : '';
    const assetProtocol = new URL(raw).protocol;
    return requestProtocol === 'https:' && assetProtocol === 'http:';
  } catch {
    return false;
  }
}

function resolveVideoAudioRequest(body = {}, prompt = '') {
  const text = String(
    body?.audioText
    || body?.audio_text
    || body?.voiceText
    || body?.voice_text
    || body?.narration
    || body?.soundText
    || body?.sound_text
    || ''
  ).trim();
  const implicitAudio = (
    isTruthy(body?.withAudio)
    || isTruthy(body?.with_audio)
    || isTruthy(body?.includeAudio)
    || isTruthy(body?.include_audio)
  );
  return {
    enabled: Boolean(text || implicitAudio),
    text: text || (implicitAudio ? String(prompt || '').trim() : ''),
  };
}

function resolveVideoSdRequestOverrides(body = {}) {
  const modelProfile = String(
    body?.model_profile
    || body?.modelProfile
    || body?.sd_model_profile
    || body?.sdModelProfile
    || ''
  ).trim();
  const sdSteps = resolvePositiveNumber(
    body?.sdSteps,
    body?.sd_steps,
    body?.num_inference_steps,
    body?.numInferenceSteps,
    body?.steps
  );
  const sdGuidanceScale = resolvePositiveNumber(
    body?.sdGuidanceScale,
    body?.sd_guidance_scale,
    body?.guidance_scale,
    body?.guidanceScale
  );
  return {
    modelProfile,
    sdSteps: sdSteps > 0 ? sdSteps : 0,
    sdGuidanceScale: sdGuidanceScale > 0 ? sdGuidanceScale : 0,
  };
}

async function downloadBinary(url, fetchImpl = defaultFetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`video_frame_download_failed:${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function resolveTtsBaseUrl(env = process.env) {
  return String(
    env.TTS_BASE_URL
    || env.TTS_URL
    || env.TTS_PUBLIC_BASE_URL
    || 'http://127.0.0.1:5002'
  ).trim().replace(/\/+$/, '');
}

function inferAudioExtension(audioUrl = '', contentType = '') {
  const ext = path.extname(String(new URL(audioUrl, 'http://localhost').pathname || '')).trim().toLowerCase();
  if (ext && /^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  if (String(contentType || '').toLowerCase().includes('mpeg')) return '.mp3';
  if (String(contentType || '').toLowerCase().includes('ogg')) return '.ogg';
  return '.wav';
}

async function synthesizeVideoAudioTrack({
  req,
  text,
  workingPaths,
  fetchImpl = defaultFetch,
} = {}) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return null;

  const ttsBaseUrl = resolveTtsBaseUrl();
  const response = await fetchImpl(`${ttsBaseUrl}/api/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: normalizedText }),
  });
  const rawBody = await response.text();
  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload) {
    const error = new Error(`video_audio_tts_failed:${response.status}:${rawBody}`);
    error.statusCode = response.status || 502;
    error.payload = {
      ok: false,
      error: 'video_audio_tts_failed',
      message: rawBody || `TTS status ${response.status}`,
    };
    throw error;
  }

  const audioUrl = String(payload.audio_url || payload.audioUrl || payload.url || '').trim();
  if (!audioUrl) {
    const error = new Error('video_audio_url_missing');
    error.statusCode = 502;
    error.payload = {
      ok: false,
      error: 'video_audio_url_missing',
      message: 'Le TTS n a pas retourne d URL audio exploitable.',
    };
    throw error;
  }

  const audioResponse = await fetchImpl(audioUrl);
  if (!audioResponse.ok) {
    const error = new Error(`video_audio_download_failed:${audioResponse.status}`);
    error.statusCode = audioResponse.status || 502;
    error.payload = {
      ok: false,
      error: 'video_audio_download_failed',
      message: `Telechargement audio impossible (${audioResponse.status}).`,
      audioUrl,
    };
    throw error;
  }

  const contentType = String(audioResponse.headers?.get?.('content-type') || 'audio/wav').trim();
  const buffer = Buffer.from(await audioResponse.arrayBuffer());
  const audioPath = path.join(workingPaths.jobRoot, `audio${inferAudioExtension(audioUrl, contentType)}`);
  await fsp.writeFile(audioPath, buffer);
  const localPublicAudioUrl = buildLocalPublicUrl(req, audioPath);
  const publicAudioUrl = isUnsafeAssetUrlForClient(req, audioUrl) && localPublicAudioUrl
    ? localPublicAudioUrl
    : audioUrl;

  return {
    path: audioPath,
    url: publicAudioUrl,
    text: normalizedText,
    contentType,
    sizeBytes: buffer.length,
    gifUrl: String(payload.gif_url || payload.gifUrl || '').trim() || null,
  };
}

async function materializeSourceVideoFile(request, workingPaths, fetchImpl) {
  if (request.sourceVideoPath && fs.existsSync(request.sourceVideoPath)) {
    return path.resolve(request.sourceVideoPath);
  }
  if (request.sourcePath && request.sourceType === 'video' && fs.existsSync(request.sourcePath)) {
    return path.resolve(request.sourcePath);
  }
  const sourceUrl = String(request.sourceVideoUrl || (request.sourceType === 'video' ? request.sourceUrl : '') || '').trim();
  if (!sourceUrl) return '';

  const targetPath = path.join(workingPaths.jobRoot, 'source-video.mp4');
  const buffer = await downloadBinary(sourceUrl, fetchImpl);
  await fsp.writeFile(targetPath, buffer);
  return targetPath;
}

async function extractFirstFrameFromVideo({
  ffmpegBin,
  inputPath,
  outputPath,
}) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-y', '-i', inputPath, '-frames:v', '1', outputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error_) => reject(new Error(`ffmpeg_extract_frame_failed:${String(error_?.message || error_)}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve({ ok: true, stdout, stderr });
      return reject(new Error(`ffmpeg_extract_frame_failed:${code}:${stderr || stdout}`));
    });
  });
}

async function publishLocalOrUploadedAsset({
  req,
  absolutePath,
  uploadBufferToR2,
  uploadFilename,
  contentType,
}) {
  try {
    const buffer = await fsp.readFile(absolutePath);
    const uploaded = await uploadBufferToR2({
      userId: req?.user?.id || req?.body?._user || 'video-tool',
      filename: uploadFilename || path.basename(absolutePath),
      buffer,
      contentType: contentType || guessContentTypeFromPath(absolutePath),
    });
    return String(uploaded?.url || '').trim();
  } catch {
    return buildLocalPublicUrl(req, absolutePath);
  }
}

async function resolveInitialReferenceFrame({
  req,
  request,
  workingPaths,
  fetchImpl,
  uploadBufferToR2,
}) {
  const explicitImageUrl = String(
    request.sourceImageUrl
    || (request.sourceType === 'image' ? request.sourceUrl : '')
    || ''
  ).trim();

  // Gerer les data URLs (base64) - sauvegarder localement
  if (explicitImageUrl.startsWith('data:image/')) {
    try {
      const matches = explicitImageUrl.match(/^data:image\/([a-z]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const framePath = path.join(workingPaths.jobRoot, `source-image.${ext}`);
        await fsp.writeFile(framePath, buffer);
        const publishedUrl = await publishLocalOrUploadedAsset({
          req,
          absolutePath: framePath,
          uploadBufferToR2,
          uploadFilename: `source-image.${ext}`,
          contentType: `image/${matches[1]}`,
        });
        return {
          initImageUrl: publishedUrl || explicitImageUrl,
          initImagePath: framePath,
          sourceMode: 'image_data_url',
        };
      }
    } catch (error_) {
      console.warn('[A11][video] data URL processing failed:', String(error_?.message || error_));
    }
  }

  if (explicitImageUrl && !explicitImageUrl.startsWith('data:')) {
    return {
      initImageUrl: explicitImageUrl,
      initImagePath: '',
      sourceMode: 'image_url',
    };
  }

  const explicitImagePath = String(
    request.sourceImagePath
    || (request.sourceType === 'image' ? request.sourcePath : '')
    || ''
  ).trim();
  if (explicitImagePath && fs.existsSync(explicitImagePath)) {
    const absolutePath = path.resolve(explicitImagePath);
    const publishedUrl = await publishLocalOrUploadedAsset({
      req,
      absolutePath,
      uploadBufferToR2,
      uploadFilename: path.basename(absolutePath),
      contentType: guessContentTypeFromPath(absolutePath),
    });
    return {
      initImageUrl: publishedUrl,
      initImagePath: absolutePath,
      sourceMode: 'image_path',
    };
  }

  const videoInputPath = await materializeSourceVideoFile(request, workingPaths, fetchImpl);
  if (videoInputPath) {
    const extractedFramePath = path.join(workingPaths.jobRoot, 'source-frame-0000.png');
    await extractFirstFrameFromVideo({
      ffmpegBin: request.config.ffmpegBin,
      inputPath: videoInputPath,
      outputPath: extractedFramePath,
    });
    const publishedUrl = await publishLocalOrUploadedAsset({
      req,
      absolutePath: extractedFramePath,
      uploadBufferToR2,
      uploadFilename: 'source-frame.png',
      contentType: 'image/png',
    });
    return {
      initImageUrl: publishedUrl,
      initImagePath: extractedFramePath,
      sourceMode: 'video_first_frame',
    };
  }

  return {
    initImageUrl: '',
    initImagePath: '',
    sourceMode: '',
  };
}

async function resolveVideoReferenceAnalysis({
  request,
  reference = {},
  fetchImpl = defaultFetch,
} = {}) {
  const candidateUrl = String(reference?.initImageUrl || '').trim();
  const candidatePath = String(reference?.initImagePath || '').trim();
  if (!candidateUrl && !candidatePath) return null;

  try {
    const sourceMeta = await probeImg2ImgSource({
      imageUrl: candidateUrl,
      imagePath: candidatePath,
      fetch: fetchImpl,
    });
    if (!sourceMeta?.ok) return null;

    const scene = classifyImg2ImgSource({
      prompt: String(request?.prompt || '').trim(),
      draft: {
        mode: String(reference?.sourceMode || '').trim(),
      },
      sourceMeta,
    });
    const canvasPlan = resolveImg2ImgCanvasPlan({
      sourceWidth: sourceMeta.width,
      sourceHeight: sourceMeta.height,
      scene,
      currentWidth: request?.width,
      currentHeight: request?.height,
      env: process.env,
    });
    const strengthPlan = resolveImg2ImgStrength({
      scene,
      prompt: String(request?.prompt || '').trim(),
      explicitStrength: 'auto',
      taskType: 'video_reference_bootstrap',
      initSourceMode: String(reference?.sourceMode || '').trim(),
      motionProfile: String(request?.timingPlan?.motionProfile || '').trim(),
    });

    return {
      sourceMeta,
      scene,
      canvasPlan,
      strengthPlan,
    };
  } catch (error_) {
    console.warn('[A11][video] reference analysis skipped:', String(error_?.message || error_));
    return null;
  }
}

function frameNeedsPoseRewrite(framePlan = {}, motionProfile = 'generic') {
  const lookup = normalizeVideoLookup([
    framePlan?.structuralState,
    framePlan?.variation,
    ...(Array.isArray(framePlan?.rendererFocus) ? framePlan.rendererFocus : []),
  ].filter(Boolean).join(' '));

  if (!lookup) return false;

  if (
    /\b(bras|jambe|main|mains|poing|poings|epaule|epaules|bassin|torse|buste|pied|pieds|arc|corde|fleche|arrow|cheveux|aura|energie|eclairs?|appui|poids)\b/.test(lookup)
    && /\b(avance|devant|passe|quitte|porte|tire|traction|leve|levee|monte|ouvre|ouvert|ecarte|ecartes|projete|penche|serre|serres|transform|stabilisee|stabilise|atteinte|engagee|engage|charge|impact|projection)\b/.test(lookup)
  ) {
    return true;
  }

  return [
    'walk_cycle',
    'run_cycle',
    'power_up_loop',
    'transformation_rise',
    'mounted_archery',
    'archery_shot',
    'action_burst',
  ].includes(String(motionProfile || 'generic').trim() || 'generic');
}

function resolveVideoFrameStrengthProfile({
  motionProfile = 'generic',
  scene = {},
} = {}) {
  const normalizedMotionProfile = String(motionProfile || 'generic').trim() || 'generic';
  const highMotionProfile = [
    'run_cycle',
    'power_up_loop',
    'transformation_rise',
    'mounted_archery',
    'archery_shot',
    'action_burst',
  ].includes(normalizedMotionProfile);
  const mediumMotionProfile = highMotionProfile || [
    'walk_cycle',
    'dance_cycle',
    'gesture_loop',
    'subtle_loop',
  ].includes(normalizedMotionProfile);
  const referenceAnchorPlan = {
    mode: 'auto',
    profile: 'preserve',
    reason: 'video_anchor_reference',
    strength: resolveStrengthFromProfile('preserve', {
      bias: scene?.sceneKey === 'solo_face' ? 0.18 : 0.28,
    }),
  };
  referenceAnchorPlan.retryStrength = resolveRetryStrength(referenceAnchorPlan.profile, referenceAnchorPlan.strength);

  const referenceReanchorPlan = {
    mode: 'auto',
    profile: 'preserve',
    reason: 'video_anchor_reanchor',
    strength: resolveStrengthFromProfile('preserve', {
      bias: scene?.sceneKey === 'solo_face' ? 0.1 : 0.18,
    }),
  };
  referenceReanchorPlan.retryStrength = resolveRetryStrength(referenceReanchorPlan.profile, referenceReanchorPlan.strength);

  const previousFramePlan = {
    mode: 'auto',
    profile: 'motion_continuity',
    reason: 'video_frame_to_frame_continuity',
    strength: resolveStrengthFromProfile('motion_continuity', {
      bias: highMotionProfile ? 0.58 : (mediumMotionProfile ? 0.42 : 0.28),
    }),
  };
  previousFramePlan.retryStrength = resolveRetryStrength(previousFramePlan.profile, previousFramePlan.strength);

  const previousPoseShiftPlan = {
    mode: 'auto',
    profile: 'balanced',
    reason: 'video_pose_shift_from_previous_frame',
    strength: resolveStrengthFromProfile('balanced', {
      bias: highMotionProfile ? 0.56 : (mediumMotionProfile ? 0.48 : 0.42),
    }),
  };
  previousPoseShiftPlan.retryStrength = resolveRetryStrength(previousPoseShiftPlan.profile, previousPoseShiftPlan.strength);

  const segmentAnchorPlan = {
    mode: 'auto',
    profile: 'motion_continuity',
    reason: 'video_segment_progression',
    strength: resolveStrengthFromProfile('motion_continuity', {
      bias: highMotionProfile ? 0.72 : (mediumMotionProfile ? 0.58 : 0.48),
    }),
  };
  segmentAnchorPlan.retryStrength = resolveRetryStrength(segmentAnchorPlan.profile, segmentAnchorPlan.strength);

  const segmentPoseShiftPlan = {
    mode: 'auto',
    profile: 'balanced',
    reason: 'video_pose_shift_from_anchor',
    strength: resolveStrengthFromProfile('balanced', {
      bias: highMotionProfile ? 0.66 : (mediumMotionProfile ? 0.56 : 0.48),
    }),
  };
  segmentPoseShiftPlan.retryStrength = resolveRetryStrength(segmentPoseShiftPlan.profile, segmentPoseShiftPlan.strength);

  const checkpointPlan = {
    mode: 'auto',
    profile: 'balanced',
    reason: 'video_checkpoint_progression',
    strength: resolveStrengthFromProfile('balanced', {
      bias: highMotionProfile ? 0.76 : (mediumMotionProfile ? 0.64 : 0.54),
    }),
  };
  checkpointPlan.retryStrength = resolveRetryStrength(checkpointPlan.profile, checkpointPlan.strength);

  return {
    referenceAnchorPlan,
    referenceReanchorPlan,
    previousFramePlan,
    previousPoseShiftPlan,
    segmentAnchorPlan,
    segmentPoseShiftPlan,
    checkpointPlan,
  };
}

async function runFfmpegAssembly({
  ffmpegBin,
  fps,
  format,
  framesDir,
  outputPath,
  mp4Codec = 'libx264',
  mp4Preset = 'medium',
  mp4Quality = 19,
  audioPath = '',
}) {
  const args = buildFfmpegAssemblyArgs({
    fps,
    format,
    framesDir,
    outputPath,
    mp4Codec,
    mp4Preset,
    mp4Quality,
    audioPath,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error_) => {
      reject(new Error(`ffmpeg_spawn_failed:${String(error_?.message || error_)}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        return resolve({ ok: true, stdout, stderr, args });
      }
      return reject(new Error(`ffmpeg_failed:${code}:${stderr || stdout}`));
    });
  });
}

function buildFfmpegAssemblyArgs({
  fps,
  format,
  framesDir,
  outputPath,
  mp4Codec = 'libx264',
  mp4Preset = 'medium',
  mp4Quality = 19,
  audioPath = '',
}) {
  const inputPattern = path.join(framesDir, 'frame-%04d.png');
  const normalizedAudioPath = String(audioPath || '').trim();
  const audioArgs = normalizedAudioPath && format === 'mp4'
    ? ['-i', normalizedAudioPath]
    : [];
  const audioEncodeArgs = normalizedAudioPath && format === 'mp4'
    ? ['-c:a', 'aac', '-b:a', '128k', '-af', 'apad', '-shortest']
    : [];
  return format === 'gif'
    ? ['-y', '-framerate', String(fps), '-i', inputPattern, outputPath]
    : (
      /_nvenc$/i.test(String(mp4Codec || ''))
        ? [
            '-y',
            '-framerate', String(fps),
            '-i', inputPattern,
            ...audioArgs,
            '-c:v', String(mp4Codec || 'h264_nvenc'),
            '-preset', String(mp4Preset || 'p5'),
            '-rc', 'vbr',
            '-cq', String(mp4Quality),
            '-b:v', '0',
            '-profile:v', 'high',
            '-pix_fmt', 'yuv420p',
            ...audioEncodeArgs,
            '-movflags', '+faststart',
            outputPath,
          ]
        : [
            '-y',
            '-framerate', String(fps),
            '-i', inputPattern,
            ...audioArgs,
            '-c:v', String(mp4Codec || 'libx264'),
            '-preset', String(mp4Preset || 'medium'),
            '-crf', String(mp4Quality),
            '-pix_fmt', 'yuv420p',
            ...audioEncodeArgs,
            '-movflags', '+faststart',
            outputPath,
          ]
    );
}

function shouldRetryFfmpegWithCpu(error_, codec = '') {
  if (!/_nvenc$/i.test(String(codec || '').trim())) {
    return false;
  }
  const message = String(error_?.message || error_ || '').toLowerCase();
  return message.includes('libcuda.so.1')
    || message.includes('cannot load libcuda')
    || message.includes('cuda')
    || message.includes('nvenc');
}

function buildCpuFallbackFfmpegConfig(config = {}) {
  return {
    mp4Codec: 'libx264',
    mp4Preset: 'medium',
    mp4Quality: clampNumber(config.mp4Quality, 0, 51, 19),
  };
}

async function maybeDescribeFirstFrameWithJanus(framePath, contentType = 'image/png', config = {}) {
  if (!config.useJanusFrameAnalysis) return null;
  try {
    const janus = resolveJanusVisionConfig({});
    const buffer = await fsp.readFile(framePath);
    const result = await callJanusVisionText({
      imageBuffer: buffer,
      contentType,
      prompt: 'Decris tres brievement cette frame video en francais, sans inventer.',
      maxNewTokens: Math.min(janus.maxNewTokens, 120),
      timeoutMs: janus.timeoutMs,
      modelRef: janus.modelRef,
      device: janus.device,
      torchDtype: janus.torchDtype,
    });
    return String(result?.text || result || '').trim() || null;
  } catch (error_) {
    console.warn('[A11][video] Janus frame analysis skipped:', String(error_?.message || error_));
    return null;
  }
}

function buildVideoAssistantMessage({ videoUrl = '', filename = '' } = {}) {
  if (videoUrl) {
    return `La video est prete. [ouvrir la video](${videoUrl})`;
  }
  return `La video ${filename || 'generee'} est prete.`;
}

function toVideoChatProxyPayload(videoResult = {}) {
  const videoUrl = String(videoResult.video_url || videoResult.url || '').trim() || null;
  const filename = String(videoResult.filename || '').trim() || null;
  const content = buildVideoAssistantMessage({ videoUrl, filename });

  return {
    ok: videoResult.ok !== false,
    id: `a11-video-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'a11-video-generate',
    mode: 'generate_video',
    tool: videoResult.tool || 'generate_video',
    backend: videoResult.backend || null,
    artifact_type: 'video',
    video_url: videoUrl,
    videoPath: videoUrl,
    url: videoUrl,
    format: videoResult.format || 'mp4',
    durationSeconds: videoResult.durationSeconds,
    fps: videoResult.fps,
    frameCount: videoResult.frameCount,
    width: videoResult.width,
    height: videoResult.height,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    result: videoResult,
  };
}

function createGenerateVideoHandler(overrides = {}) {
  const generateSd = overrides.generateSd;
  const fetchImpl = overrides.fetch || defaultFetch;
  const uploadBufferToR2 = overrides.uploadBufferToR2 || defaultUploadBufferToR2;
  const buildMask = overrides.buildCanonicalImageMaskFromText || buildCanonicalImageMaskFromText;
  const compileRuntime = overrides.compileMaskImageGenerateRuntime || compileMaskImageGenerateRuntime;
  const lookupImageHintWebContext = overrides.lookupImageHintWebContext || defaultLookupImageHintWebContext;
  const resolveImageWebDraft = overrides.resolveImageWebDraft || defaultResolveImageWebDraft;
  const resolveImageReferencePack = overrides.resolveImageReferencePack || defaultResolveImageReferencePack;
  const buildImageReferenceComposite = overrides.buildImageReferenceComposite || defaultBuildImageReferenceComposite;
  const resolveImageEntityContext = overrides.resolveImageEntityContext || defaultResolveImageEntityContext;
  const directImageRequest = overrides.directImageRequest || defaultDirectImageRequest;
  const lookupDefinitionContext = overrides.lookupDefinitionContext || defaultLookupDefinitionContext;
  const duckduckgoImageSearch = overrides.duckduckgoImageSearch || defaultDuckduckgoImageSearch;
  const runFfmpeg = overrides.runFfmpeg || runFfmpegAssembly;
  const ensureFfmpeg = overrides.ensureFfmpegAvailable || ensureFfmpegAvailable;
  const usesCustomFfmpegRunner = typeof overrides.runFfmpeg === 'function';

  return async function generateVideoInternal({ req, prompt, body = null }) {
    if (typeof generateSd !== 'function') {
      const error = new Error('generate_video requires generateSd');
      error.statusCode = 500;
      error.payload = {
        ok: false,
        error: 'video_engine_unavailable',
        message: 'generateSd handler unavailable for video generation',
      };
      throw error;
    }

    const requestBody = body || req?.body || {};
    const request = normalizeVideoRequest(requestBody, prompt);
    const audioRequest = resolveVideoAudioRequest(requestBody, request.prompt);
    const sdRequestOverrides = resolveVideoSdRequestOverrides(requestBody);
    const hasExplicitSource = hasExplicitVideoVisualSource(request);
    if (!request.config.enabled) {
      const error = new Error('video_generation_disabled');
      error.statusCode = 503;
      error.payload = {
        ok: false,
        error: 'video_generation_disabled',
        message: 'La generation video est desactivee sur cet environnement.',
      };
      throw error;
    }
    if (!request.prompt) {
      const error = new Error('missing_prompt');
      error.statusCode = 400;
      error.payload = { ok: false, error: 'missing_prompt' };
      throw error;
    }
    if (request.config.backend !== 'sd-frame-sequence') {
      const error = new Error(`unsupported_video_backend:${request.config.backend}`);
      error.statusCode = 501;
      error.payload = {
        ok: false,
        error: 'unsupported_video_backend',
        backend: request.config.backend,
      };
      throw error;
    }

    if (!usesCustomFfmpegRunner) {
      try {
        ensureFfmpeg(request.config.ffmpegBin);
      } catch (error_) {
        const error = new Error('video_ffmpeg_unavailable');
        error.statusCode = 503;
        error.payload = {
          ok: false,
          error: 'video_ffmpeg_unavailable',
          message: 'La generation video est indisponible: ffmpeg est absent ou inutilisable sur ce backend.',
          ffmpegBin: String(request.config.ffmpegBin || '').trim() || 'ffmpeg',
          detail: String(error_?.message || error_),
        };
        throw error;
      }
    }

    const workingPaths = buildVideoWorkingPaths(request.config);
    await fsp.mkdir(workingPaths.framesDir, { recursive: true });

    const maskResolution = await buildMask(request.prompt, {
      allowCompatFallback: true,
      maskOptions: {
        width: request.width,
        height: request.height,
      },
    });
    const compiledState = await compileRuntime(maskResolution.rawMask, {
      req,
      imagePromptRefinerEnabled: false,
      imageRequestMode: hasExplicitSource ? 'raw' : undefined,
      lookupImageHintWebContext,
      resolveImageWebDraft,
      resolveImageReferencePack,
      buildImageReferenceComposite,
      resolveImageEntityContext,
      directImageRequest,
      lookupDefinitionContext,
      duckduckgoImageSearch,
    });
    const initialReference = await resolveInitialReferenceFrame({
      req,
      request,
      workingPaths,
      fetchImpl,
      uploadBufferToR2,
    });
    const canonicalSubjectWebInit = !hasExplicitSource
      ? await resolveCanonicalSubjectWebInit({
          request,
          compiledState,
          resolveImageReferencePack,
          duckduckgoImageSearch,
        })
      : null;
    const implicitWebInit = !hasExplicitSource
      ? resolveCompiledImplicitWebInit(compiledState)
      : null;
    const allowImplicitWebInit = !hasExplicitSource && isImplicitVideoWebInitAllowed(process.env);
    const allowTrustedImplicitWebInit = !hasExplicitSource && isTrustedImplicitVideoInit(implicitWebInit);
    const useCanonicalSubjectWebInit = Boolean(
      !hasExplicitSource
      && !initialReference.initImageUrl
      && !initialReference.initImagePath
      && canonicalSubjectWebInit
    );
    if (implicitWebInit && !allowImplicitWebInit && !allowTrustedImplicitWebInit && !useCanonicalSubjectWebInit) {
      console.log(
        `[A11][video] ignore implicit web init source=${String(implicitWebInit.initImagePath || implicitWebInit.initImageUrl || 'unknown').trim() || 'unknown'}`
        + ` source_mode=${String(implicitWebInit.sourceMode || 'unknown').trim() || 'unknown'}`
        + ` reason=${String(implicitWebInit.reason || 'no_explicit_visual_source').trim() || 'no_explicit_visual_source'}`
      );
    }
    const effectiveInitialReference = (
      initialReference.initImageUrl || initialReference.initImagePath
        ? initialReference
        : (
            canonicalSubjectWebInit
            || (allowTrustedImplicitWebInit ? implicitWebInit : null)
            || (allowImplicitWebInit ? implicitWebInit : null)
            || initialReference
          )
    );
    if (useCanonicalSubjectWebInit) {
      console.log(
        `[A11][video] bootstrap canonical subject web init source=${String(effectiveInitialReference.initImagePath || effectiveInitialReference.initImageUrl || 'unknown').trim() || 'unknown'}`
        + ` subject=${String(canonicalSubjectWebInit?.canonicalSubject || 'unknown').trim() || 'unknown'}`
        + ` reason=${String(canonicalSubjectWebInit?.reason || 'canonical_subject_lookup').trim() || 'canonical_subject_lookup'}`
      );
    } else if (allowTrustedImplicitWebInit) {
      console.log(
        `[A11][video] accept trusted implicit web init source=${String(effectiveInitialReference.initImagePath || effectiveInitialReference.initImageUrl || 'unknown').trim() || 'unknown'}`
        + ` source_mode=${String(effectiveInitialReference.sourceMode || 'unknown').trim() || 'unknown'}`
      );
    }
    const referenceAnalysis = await resolveVideoReferenceAnalysis({
      request,
      reference: effectiveInitialReference,
      fetchImpl,
    });
    const compiledSdBody = (
      !hasExplicitSource && !allowImplicitWebInit && !allowTrustedImplicitWebInit
        ? stripImplicitInitFromSdBody(compiledState?.sdBody)
        : (compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {})
    );
    const compiledRenderSizing = resolveCompiledRenderSizing(compiledState, compiledSdBody, request);
    const implicitSquareDefault = looksLikeImplicitSquareDefault(request);
    const shouldPreserveSourceAspect = Boolean(
      referenceAnalysis?.canvasPlan
      && (!(request.explicitWidth && request.explicitHeight) || implicitSquareDefault)
      && !request.config.localRuntime
    );
    const shouldAdoptCompiledRenderSizing = Boolean(
      compiledRenderSizing
      && !shouldPreserveSourceAspect
      && (
        (!request.explicitWidth && !request.explicitHeight)
        || implicitSquareDefault
      )
    );
    const fittedCompiledRenderSizing = shouldAdoptCompiledRenderSizing
      ? fitRenderDimensionsWithinLimits({
        width: compiledRenderSizing.width,
        height: compiledRenderSizing.height,
        fallbackWidth: request.config.defaultWidth,
        fallbackHeight: request.config.defaultHeight,
        minSide: request.config.minRenderSide,
        maxSide: request.config.maxRenderSide,
        maxPixels: request.config.maxRenderPixels,
      })
      : null;
    const frameWidth = shouldPreserveSourceAspect
      ? Number(referenceAnalysis.canvasPlan.width || request.width)
      : Number(fittedCompiledRenderSizing?.width || request.width);
    const frameHeight = shouldPreserveSourceAspect
      ? Number(referenceAnalysis.canvasPlan.height || request.height)
      : Number(fittedCompiledRenderSizing?.height || request.height);
    const baseSdBody = {
      ...compiledSdBody,
      width: frameWidth,
      height: frameHeight,
      // Effacer prompt_2/3 du mask compile — le translator video les reconstruit en anglais
      prompt_2: '',
      prompt_3: '',
    };
    // Enrichir request avec le contexte visuel du personnage pour le LLM prompter
    const compiledUniverse = String(
      compiledState?.mask?.meta?.imageScratchpad?.universe
      || compiledState?.mask?.meta?.imageEntityContext?.universe
      || ''
    ).trim();
    const compiledCanonicalSubject = String(
      compiledState?.mask?.meta?.canonicalSubject
      || compiledState?.mask?.meta?.imageScratchpad?.canonicalSubject
      || ''
    ).trim();
    const compiledFacts = [
      ...(Array.isArray(compiledState?.mask?.meta?.imageScratchpad?.facts) ? compiledState.mask.meta.imageScratchpad.facts : []),
      ...(Array.isArray(compiledState?.mask?.meta?.imageEntityContext?.hintFacts) ? compiledState.mask.meta.imageEntityContext.hintFacts : []),
    ].slice(0, 4);
    request.sourceImageWidth = Number(referenceAnalysis?.sourceMeta?.width || 0) || 0;
    request.sourceImageHeight = Number(referenceAnalysis?.sourceMeta?.height || 0) || 0;
    request.compiledVisualContext = String(compiledState?.sdBody?.prompt || '').trim();
    request.canonicalSubject = compiledCanonicalSubject;
    request.subjectFacts = compiledFacts;

    const compiledBasePrompt = String(baseSdBody.prompt || request.prompt).trim();

    const sequencePlan = await planVideoSequence({
      request,
      compiledBasePrompt,
      sourceImagePath: String(
        effectiveInitialReference.initImagePath
        || request.sourceImagePath
        || (request.sourceType === 'image' ? request.sourcePath : '')
        || ''
      ).trim(),
      sourceImageUrl: String(
        effectiveInitialReference.initImageUrl
        || request.sourceImageUrl
        || (request.sourceType === 'image' ? request.sourceUrl : '')
        || ''
      ).trim(),
      fetchImpl,
    });
    // Injecter universe et canonicalSubject dans sequencePlan pour le style visuel
    if (compiledUniverse) sequencePlan.universe = compiledUniverse;
    if (compiledCanonicalSubject) sequencePlan.canonicalSubject = compiledCanonicalSubject;
    const {
      referenceAnchorPlan: defaultReferenceAnchorPlan,
      referenceReanchorPlan: defaultReferenceReanchorPlan,
      previousFramePlan,
      previousPoseShiftPlan,
      segmentAnchorPlan,
      segmentPoseShiftPlan,
      checkpointPlan,
    } = resolveVideoFrameStrengthProfile({
      motionProfile: sequencePlan?.motionProfile || request?.timingPlan?.motionProfile || 'generic',
      scene: referenceAnalysis?.scene || {},
    });
    const referenceAnchorPlan = referenceAnalysis?.strengthPlan && Number.isFinite(Number(referenceAnalysis.strengthPlan.strength))
      ? referenceAnalysis.strengthPlan
      : defaultReferenceAnchorPlan;
    const referenceReanchorPlan = referenceAnalysis?.strengthPlan && Number.isFinite(Number(referenceAnalysis.strengthPlan.retryStrength))
      ? {
        mode: String(referenceAnalysis.strengthPlan.mode || defaultReferenceReanchorPlan.mode || 'auto').trim() || 'auto',
        profile: String(referenceAnalysis.strengthPlan.profile || defaultReferenceReanchorPlan.profile || 'preserve').trim() || 'preserve',
        reason: `reference_retry:${String(referenceAnalysis.strengthPlan.reason || defaultReferenceReanchorPlan.reason || 'auto').trim() || 'auto'}`,
        strength: Number(referenceAnalysis.strengthPlan.retryStrength),
        retryStrength: Number(referenceAnalysis.strengthPlan.retryStrength),
      }
      : defaultReferenceReanchorPlan;
    const frameStoryboard = buildVideoStoryboard(request, sequencePlan);

    if (request?.timingPlan && typeof request.timingPlan === 'object') {
      const requestedMotionProfile = String(request.timingPlan.motionProfile || 'generic').trim() || 'generic';
      const resolvedMotionProfile = String(sequencePlan.motionProfile || requestedMotionProfile).trim() || requestedMotionProfile;
      console.log(
        `[A11][video-plan] source=${String(request.timingPlan.source || 'unknown').trim() || 'unknown'}`
        + ` profile=${resolvedMotionProfile}`
        + (resolvedMotionProfile !== requestedMotionProfile ? ` requested_profile=${requestedMotionProfile}` : '')
        + ` reason=${String(request.timingPlan.motionReason || 'n/a').trim() || 'n/a'}`
        + ` duration=${request.durationSeconds}s`
        + ` fps=${request.fps}`
        + ` frames=${request.frameCount}`
        + ` planner_requested=${String(sequencePlan.providerRequested || request.config.sequencePlanner || 'auto').trim() || 'auto'}`
        + ` planner_used=${String(sequencePlan.providerUsed || 'heuristic').trim() || 'heuristic'}`
        + ` planner_fallback=${String(sequencePlan.fallbackReason || 'none').trim() || 'none'}`
        + ` init_strategy=${String(sequencePlan.initStrategy || 'unknown').trim() || 'unknown'}`
        + ` reanchor_every=${Number(sequencePlan.reanchorEvery || 0) || 0}`
        + ` explicit_duration=${request.explicitDuration ? 'yes' : 'no'}`
        + ` explicit_fps=${request.explicitFps ? 'yes' : 'no'}`
        + ` explicit_frames=${request.explicitFrameCount ? 'yes' : 'no'}`
      );
    }
    if (Array.isArray(frameStoryboard) && frameStoryboard.length) {
      console.log(
        `[A11][video-storyboard] ${frameStoryboard.map((beat, index) => (
          `${index + 1}:${String(beat?.label || 'continuite').trim() || 'continuite'}`
        )).join(' | ')}`
      );
    }
    if (shouldAdoptCompiledRenderSizing && compiledRenderSizing && fittedCompiledRenderSizing) {
      console.log(
        `[A11][video-size] adopt compiled sizing source=${compiledRenderSizing.source}`
        + ` reason=${compiledRenderSizing.reason}`
        + ` requested=${compiledRenderSizing.requestedWidth}x${compiledRenderSizing.requestedHeight}`
        + ` effective=${fittedCompiledRenderSizing.width}x${fittedCompiledRenderSizing.height}`
      );
    }

    console.log(
      `[A11][video] start prompt="${compiledBasePrompt}" duration=${request.durationSeconds}s fps=${request.fps} format=${request.format} frames=${request.frameCount} size=${frameWidth}x${frameHeight}`
    );
    if (referenceAnalysis?.sourceMeta) {
      console.log(
        `[A11][video-img2img] source=${String(referenceAnalysis.sourceMeta.sourceUsed || effectiveInitialReference.initImagePath || effectiveInitialReference.initImageUrl || 'unknown').trim() || 'unknown'}`
        + ` source_dims=${referenceAnalysis.sourceMeta.width}x${referenceAnalysis.sourceMeta.height}`
        + ` source_ratio=${Number(referenceAnalysis.sourceMeta.ratio || 0).toFixed(4)}`
        + ` target=${frameWidth}x${frameHeight}`
        + ` scene_type=${String(referenceAnalysis.scene?.sceneType || 'unknown').trim() || 'unknown'}`
        + ` strength_mode=${String(referenceAnchorPlan?.mode || 'auto').trim() || 'auto'}`
        + ` strength_profile=${String(referenceAnchorPlan?.profile || 'preserve').trim() || 'preserve'}`
        + ` strength_reason=${String(referenceAnchorPlan?.reason || 'n/a').trim() || 'n/a'}`
        + ` strength=${Number(referenceAnchorPlan?.strength || 0).toFixed(2)}`
        + ` preserve_source_aspect=${shouldPreserveSourceAspect ? 'yes' : 'no'}`
      );
    } else if (!hasExplicitSource) {
      console.log('[A11][video] no explicit visual source, first frame will be generated from prompt only');
    }

    const frames = [];
    let previousFrameUrl = '';
    let previousFramePath = '';
    let firstFrameAnalysis = null;
    let anchorFrameUrl = String(effectiveInitialReference.initImageUrl || '').trim();
    let anchorFramePath = String(effectiveInitialReference.initImagePath || '').trim();
    const preferRemoteFrameReferences = hasSdProxyConfigured(process.env);

    for (let frameIndex = 0; frameIndex < request.frameCount; frameIndex += 1) {
      const framePlan = normalizeStoryboardBeat(frameStoryboard[frameIndex] || {
        label: 'continuite',
        prompt: 'faire avancer la posture d une etape visible',
      });
      const framePromptPlan = buildFramePromptPlan(compiledBasePrompt, {
        framePlan,
        sequencePlan,
        referenceAnalysis,
      });
      const frameInitPlan = resolveFrameInitPlan({
        frameIndex,
        anchorAvailable: Boolean(anchorFramePath || anchorFrameUrl),
        previousAvailable: Boolean(previousFramePath || previousFrameUrl),
        framePlan,
        sequencePlan,
      });
      const frameReference = frameInitPlan.useAnchorReference
        ? resolveFrameReferenceCandidate({
            preferRemoteReference: preferRemoteFrameReferences,
            localPath: anchorFramePath,
            remoteUrl: anchorFrameUrl,
          })
        : resolveFrameReferenceCandidate({
            preferRemoteReference: preferRemoteFrameReferences,
            localPath: previousFramePath,
            remoteUrl: previousFrameUrl,
          });
      const initSourceLabel = frameReference
        ? frameInitPlan.initSourceLabel
        : 'prompt_only';
      const poseRewriteNeeded = frameNeedsPoseRewrite(
        framePlan,
        sequencePlan?.motionProfile || request?.timingPlan?.motionProfile || 'generic',
      );
      const frameStrengthPlan = (
        initSourceLabel === 'reference_anchor'
          ? referenceAnchorPlan
          : (initSourceLabel === 'reference_reanchor'
            ? referenceReanchorPlan
            : ((initSourceLabel === 'segment_anchor' || initSourceLabel === 'checkpoint_chain')
              ? (framePlan.checkpoint ? checkpointPlan : (poseRewriteNeeded ? segmentPoseShiftPlan : segmentAnchorPlan))
              : (poseRewriteNeeded ? previousPoseShiftPlan : previousFramePlan)))
      );
      const frameStrength = Number(frameStrengthPlan?.strength || 0);
      const frameNegativePrompt = [
        String(baseSdBody.negative_prompt || '').trim(),
        framePromptPlan.negative_prompt_video || '',
      ].filter(Boolean).join(', ');
      const frameNegativePrompt2 = String(baseSdBody.negative_prompt_2 || '').trim();
      const frameNegativePrompt3 = String(baseSdBody.negative_prompt_3 || '').trim();
      const frameBody = {
        ...baseSdBody,
        prompt: framePromptPlan.prompt,
        prompt_2: framePromptPlan.prompt_2,
        prompt_3: framePromptPlan.prompt_3,
        prompt_language: 'en',
        prompt_prebuilt: true,
        prompt_2_prebuilt: true,
        prompt_3_prebuilt: true,
        ...(frameNegativePrompt ? { negative_prompt: frameNegativePrompt, negative_prompt_prebuilt: true } : {}),
        ...(frameNegativePrompt2 ? { negative_prompt_2: frameNegativePrompt2, negative_prompt_2_prebuilt: true } : {}),
        ...(frameNegativePrompt3 ? { negative_prompt_3: frameNegativePrompt3, negative_prompt_3_prebuilt: true } : {}),
        num_inference_steps: sdRequestOverrides.sdSteps || request.config.sdSteps,
        guidance_scale: sdRequestOverrides.sdGuidanceScale || request.config.sdGuidanceScale,
        width: frameWidth,
        height: frameHeight,
        seed: Number(baseSdBody.seed || 0) ? Number(baseSdBody.seed) : undefined,
        ...(sdRequestOverrides.modelProfile ? { model_profile: sdRequestOverrides.modelProfile } : {}),
        ...(frameReference
          ? {
              init_image_url: frameReference,
              strength: frameStrengthPlan?.mode === 'manual' ? frameStrength : 'auto',
              strength_profile: frameStrengthPlan?.profile || '',
              strength_reason: frameStrengthPlan?.reason || '',
              strength_value: frameStrength,
              task_type: 'video_frame_sequence',
              motion_profile: String(sequencePlan?.motionProfile || request?.timingPlan?.motionProfile || 'generic').trim() || 'generic',
              source_mode: initSourceLabel,
            }
          : {}),
      };

      console.log(
        `[A11][video] render frame ${frameIndex + 1}/${request.frameCount}`
        + ` init_source=${initSourceLabel}`
        + ` strength_mode=${String(frameStrengthPlan?.mode || 'auto').trim() || 'auto'}`
        + ` strength_profile=${String(frameStrengthPlan?.profile || 'manual').trim() || 'manual'}`
        + ` strength_reason=${String(frameStrengthPlan?.reason || 'n/a').trim() || 'n/a'}`
        + ` strength=${Number(frameStrength).toFixed(2)}`
        + ` beat=${String(framePlan.label || 'continuite').trim() || 'continuite'}`
      );
      console.log(
        `[A11][video-prompt] frame=${frameIndex + 1}`
        + ` prompt="${framePromptPlan.prompt}"`
        + ` prompt_2="${framePromptPlan.prompt_2}"`
        + ` prompt_3="${framePromptPlan.prompt_3}"`
      );
      const sdResult = await generateSd({
        req,
        prompt: framePromptPlan.prompt,
        body: frameBody,
      });
      const frameUrl = String(resolveGeneratedImageUrl(sdResult) || '').trim();
      if (!frameUrl) {
        const error = new Error('video_frame_generation_failed');
        error.statusCode = 502;
        error.payload = {
          ok: false,
          error: 'video_frame_generation_failed',
          frameIndex,
          result: sdResult,
        };
        throw error;
      }

      const frameBuffer = await downloadBinary(frameUrl, fetchImpl);
      const framePath = path.join(workingPaths.framesDir, `frame-${String(frameIndex).padStart(4, '0')}.png`);
      try {
        await fsp.writeFile(framePath, frameBuffer);
        const writtenFrameMeta = await probeImg2ImgSource({ imagePath: framePath });
        const actualFrameWidth = Number(writtenFrameMeta?.width || 0) || frameWidth;
        const actualFrameHeight = Number(writtenFrameMeta?.height || 0) || frameHeight;
        console.log(
          `[A11][video-runtime] Frame ${frameIndex + 1}/${request.frameCount} written: ${framePath}`
          + ` (${frameBuffer.length} bytes, ${actualFrameWidth}x${actualFrameHeight})`
        );
        if (actualFrameWidth !== frameWidth || actualFrameHeight !== frameHeight) {
          console.warn(
            `[A11][video-runtime] frame size mismatch expected=${frameWidth}x${frameHeight}`
            + ` actual=${actualFrameWidth}x${actualFrameHeight}`
          );
        }
      } catch (err) {
        console.error(`[A11][video-runtime] Erreur lors de l'écriture de la frame ${frameIndex + 1}: ${err && err.message}`);
        throw err;
      }
      if (frameIndex === 0) {
        firstFrameAnalysis = await maybeDescribeFirstFrameWithJanus(framePath, 'image/png', request.config);
        if (!(anchorFramePath || anchorFrameUrl)) {
          anchorFramePath = framePath;
          anchorFrameUrl = frameUrl;
        }
      }

      previousFrameUrl = frameUrl;
      previousFramePath = framePath;
      if (framePlan.checkpoint) {
        anchorFramePath = framePath;
        anchorFrameUrl = frameUrl;
        console.log(
          `[A11][video-checkpoint] frame=${frameIndex + 1} beat=${String(framePlan.label || 'continuite').trim() || 'continuite'} source=${framePath}`
        );
      }
      frames.push({
        index: frameIndex,
        prompt: framePromptPlan.prompt,
        prompt_2: framePromptPlan.prompt_2,
        prompt_3: framePromptPlan.prompt_3,
        structuralPrompt: framePromptPlan.structuralPrompt,
        stableIdentityPrompt: framePromptPlan.stableIdentityPrompt,
        frameVariationPrompt: framePromptPlan.frameVariationPrompt,
        soundCues: Array.isArray(framePlan.soundCues) ? framePlan.soundCues.slice() : [],
        continuityLocks: Array.isArray(framePlan.continuityLocks) ? framePlan.continuityLocks.slice() : [],
        sceneContext: String(framePlan.sceneContext || '').trim() || null,
        url: frameUrl,
        path: framePath,
        initSource: initSourceLabel,
        motionProfile: sequencePlan.motionProfile,
      });
    }

    const filename = ensureVideoFilename(request.format);
    const outputPath = path.join(workingPaths.jobRoot, filename);
    let audioTrack = null;
    if (audioRequest.enabled && request.format !== 'mp4') {
      console.warn('[A11][video-audio] audio requested but ignored for non-mp4 output');
    } else if (audioRequest.enabled) {
      try {
        audioTrack = await synthesizeVideoAudioTrack({
          req,
          text: audioRequest.text,
          workingPaths,
          fetchImpl,
        });
        console.log(
          `[A11][video-audio] generated audio track ${audioTrack.path}`
          + ` (${audioTrack.sizeBytes} bytes)`
        );
      } catch (error_) {
        const error = new Error('video_audio_generation_failed');
        error.statusCode = error_?.statusCode || 502;
        error.payload = error_?.payload || {
          ok: false,
          error: 'video_audio_generation_failed',
          message: String(error_?.message || error_),
        };
        throw error;
      }
    }
    const ffmpegOptions = {
      ffmpegBin: request.config.ffmpegBin,
      fps: request.fps,
      format: request.format,
      framesDir: workingPaths.framesDir,
      outputPath,
      mp4Codec: request.config.mp4Codec,
      mp4Preset: request.config.mp4Preset,
      mp4Quality: request.config.mp4Quality,
      audioPath: audioTrack?.path || '',
    };

    let ffmpegResult = null;
    try {
      ffmpegResult = await runFfmpeg(ffmpegOptions);
    } catch (error_) {
      if (request.format !== 'mp4' || !shouldRetryFfmpegWithCpu(error_, request.config.mp4Codec)) {
        throw error_;
      }

      const cpuFallback = buildCpuFallbackFfmpegConfig(request.config);
      console.warn(
        `[A11][video] ffmpeg nvenc unavailable, retrying with ${cpuFallback.mp4Codec}: ${String(error_?.message || error_)}`
      );
      ffmpegResult = await runFfmpeg({
        ...ffmpegOptions,
        ...cpuFallback,
      });
    }

    const resolvedVideoCodec = String(
      ffmpegResult?.codec
      || ffmpegOptions.mp4Codec
      || request.config.mp4Codec
      || ''
    ).trim() || null;

    let uploaded = null;
    try {
      const outputBuffer = await fsp.readFile(outputPath);
      uploaded = await uploadBufferToR2({
        userId: req?.user?.id || req?.body?._user || 'video-tool',
        filename,
        buffer: outputBuffer,
        contentType: request.format === 'gif' ? 'image/gif' : 'video/mp4',
      });
    } catch (error_) {
      console.warn('[A11][video] upload fallback to local file:', String(error_?.message || error_));
    }

    const localUrl = buildLocalPublicUrl(req, outputPath);
    const videoUrl = String(uploaded?.url || localUrl || '').trim();

    return {
      ok: true,
      tool: 'generate_video',
      artifact_type: 'video',
      backend: request.config.backend,
      ffmpegBin: request.config.ffmpegBin,
      videoCodec: resolvedVideoCodec,
      mode: request.config.backend,
      prompt: request.prompt,
      compiledPrompt: compiledBasePrompt,
      negativePrompt: String(baseSdBody.negative_prompt || '').trim() || null,
      format: request.format,
      durationSeconds: request.durationSeconds,
      fps: request.fps,
      frameCount: request.frameCount,
      width: frameWidth,
      height: frameHeight,
      filename,
      url: videoUrl || null,
      video_url: videoUrl || null,
      audio_url: audioTrack?.url || null,
      audioUrl: audioTrack?.url || null,
      audioText: audioTrack?.text || null,
      hasAudio: Boolean(audioTrack),
      outputPath,
      audioPath: audioTrack?.path || null,
      firstFrameAnalysis,
      sourceMode: effectiveInitialReference.sourceMode || (!hasExplicitSource ? 'prompt_only' : null),
      sourceSceneType: referenceAnalysis?.scene?.sceneType || null,
      sequencePlanning: {
        providerRequested: sequencePlan.providerRequested,
        providerUsed: sequencePlan.providerUsed,
        fallbackReason: sequencePlan.fallbackReason || null,
        motionProfile: sequencePlan.motionProfile,
        globalObjective: sequencePlan.globalObjective,
        frameProgressionRule: sequencePlan.frameProgressionRule,
        compositionHints: Array.isArray(sequencePlan.compositionHints) ? sequencePlan.compositionHints.slice() : [],
        identityLocks: Array.isArray(sequencePlan.identityLocks) ? sequencePlan.identityLocks.slice() : [],
        sceneLocks: Array.isArray(sequencePlan.sceneLocks) ? sequencePlan.sceneLocks.slice() : [],
        continuityLocks: Array.isArray(sequencePlan.continuityLocks) ? sequencePlan.continuityLocks.slice() : [],
        soundCues: Array.isArray(sequencePlan.soundCues) ? sequencePlan.soundCues.slice() : [],
        initStrategy: sequencePlan.initStrategy,
        reanchorEvery: sequencePlan.reanchorEvery,
        imageAwareUsed: Boolean(sequencePlan.imageAwareUsed),
        imageAwareError: String(sequencePlan.imageAwareError || '').trim() || null,
        visualAnalysisProvider: String(sequencePlan.visualAnalysisProvider || '').trim() || null,
        visualAnalysis: sequencePlan.visualAnalysis && typeof sequencePlan.visualAnalysis === 'object'
          ? JSON.parse(JSON.stringify(sequencePlan.visualAnalysis))
          : null,
        beats: Array.isArray(sequencePlan.beats)
          ? sequencePlan.beats.map((beat) => ({
              label: beat.label,
              structuralState: beat.structuralState,
              variation: beat.variation,
              checkpoint: Boolean(beat.checkpoint),
              rendererFocus: Array.isArray(beat.rendererFocus) ? beat.rendererFocus.slice() : [],
              soundCues: Array.isArray(beat.soundCues) ? beat.soundCues.slice() : [],
              continuityLocks: Array.isArray(beat.continuityLocks) ? beat.continuityLocks.slice() : [],
              sceneContext: String(beat.sceneContext || '').trim() || null,
            }))
          : [],
      },
      frames: frames.map((frame) => ({
        index: frame.index,
        url: frame.url,
        initSource: frame.initSource,
        prompt: frame.prompt,
        prompt_2: frame.prompt_2,
        prompt_3: frame.prompt_3,
        structuralPrompt: frame.structuralPrompt,
        stableIdentityPrompt: frame.stableIdentityPrompt,
        frameVariationPrompt: frame.frameVariationPrompt,
        soundCues: Array.isArray(frame.soundCues) ? frame.soundCues.slice() : [],
        continuityLocks: Array.isArray(frame.continuityLocks) ? frame.continuityLocks.slice() : [],
        sceneContext: frame.sceneContext,
      })),
    };
  };
}

module.exports = {
  buildVideoAssistantMessage,
  buildFfmpegAssemblyArgs,
  createGenerateVideoHandler,
  ensureFfmpegAvailable,
  fitRenderDimensionsWithinLimits,
  normalizeVideoRequest,
  resolveVideoEnvConfig,
  runFfmpegAssembly,
  toVideoChatProxyPayload,
};

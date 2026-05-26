const defaultFs = require('node:fs');
const defaultPath = require('node:path');
const { buildCanonicalImageMaskFromText } = require('../mask/resolve-image-mask-from-text.cjs');
const { buildSdPromptBundle: defaultBuildSdPromptBundle } = require('../mask/build-sd-prompt-bundle.cjs');
const {
  compileMaskImageGenerate: defaultCompileMaskImageGenerate,
  compileMaskImageGenerateRuntime: defaultCompileMaskImageGenerateRuntime,
} = require('../mask/image-chat-runtime.cjs');
const { callStructuredLlmJson: defaultCallStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');
const {
  resolveImageDimensionConfig,
  resolveImageCanvasPlan,
  resolveSdLocalRenderLimits,
} = require('../mask/normalize-mask-image-generate.cjs');
const {
  resolveSdProxyUrl: defaultResolveSdProxyUrl,
  resolveSdScriptPath: defaultResolveSdScriptPath,
  runSdScript: defaultRunSdScript,
  shouldAllowLocalSdFallback: defaultShouldAllowLocalSdFallback,
} = require('../../lib/sd-runtime.cjs');
const { uploadBufferToR2: defaultUploadBufferToR2 } = require('../../lib/file-storage.cjs');
const {
  tryGeneratePngWithOpenAI,
  looksLikeOpenAiQuotaError,
  resolveOpenAiImageConfig,
  isOpenAiImageEnabled,
} = require('../../lib/openai-image.cjs');
const {
  tryGenerateImageWithHuggingFace,
  resolveHuggingFaceImageConfig,
} = require('../../lib/hf-image.cjs');
const {
  tryGenerateImageWithReplicate,
  resolveReplicateImageConfig,
} = require('../../lib/replicate-image.cjs');
const {
  tryGenerateImageWithPollinations,
  resolvePollinationsImageConfig,
} = require('../../lib/pollinations-image.cjs');
const {
  resolveImg2ImgStrengthPlan,
} = require('../image/img2img-strength.cjs');
const {
  attachMediaAgentRoles,
  buildMediaPipeline,
  getMediaAgentRoleMatrix,
} = require('../media/media-agent-roles.cjs');
const {
  createEmergencyImageAsset,
} = require('../media/emergency-media.cjs');
const {
  enrichImagePromptWithLinguisticScene,
} = require('../linguistics/linguistic-scene-parser.cjs');

// Vision Memory — analyse automatique des images générées (fire-and-forget)
let _visionMemory = null;
function getVisionMemory() {
  if (!_visionMemory) {
    try { _visionMemory = require('../../lib/vision-memory.cjs'); } catch (_) {}
  }
  return _visionMemory;
}

const { shutdownJanusVisionWorker } = require('../../lib/janus-vision-runtime.cjs');
const { runExclusiveLocalGpuTask } = require('../../lib/local-gpu-orchestrator.cjs');

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function firstConfiguredToken(...values) {
  for (const value of values) {
    const token = String(value || '').split(/[\s,]+/).map((item) => item.trim()).find(Boolean);
    if (token) return token;
  }
  return '';
}

function buildAiServiceAuthHeaders() {
  const adminToken = firstConfiguredToken(
    process.env.NEZ_ADMIN_TOKEN,
    process.env.A11_NEZ_ADMIN_TOKEN,
    process.env.NEZ_SERVICE_TOKEN,
    process.env.A11_NEZ_SERVICE_TOKEN
  );
  const serviceToken = adminToken || firstConfiguredToken(
    process.env.NEZ_ALLOWED_TOKEN,
    process.env.NEZ_ALLOWED_TOKENS,
    process.env.NEZ_TOKENS,
    process.env.NEZ_TOKEN,
    process.env.A11_NEZ_TOKEN
  );
  const headers = {};
  if (serviceToken) headers['x-nez-token'] = serviceToken;
  if (adminToken) headers['x-nez-admin-token'] = adminToken;
  return headers;
}

function redactHeadersForLog(headers = {}) {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = String(key || '').toLowerCase();
    if (/authorization|cookie|token|secret|api[-_]?key|session/.test(normalizedKey)) {
      output[key] = '[redacted]';
      continue;
    }
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    output[key] = text.length > 240 ? `${text.slice(0, 240)}...` : text;
  }
  return output;
}

function summarizeGenerateSdBodyForLog(body = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const prompt = String(payload.prompt || payload.message || '').trim();
  return {
    keys: Object.keys(payload).slice(0, 40),
    promptChars: prompt.length,
    width: payload.width || payload.w || null,
    height: payload.height || payload.h || null,
    hasInitImage: Boolean(payload.initImage || payload.init_image || payload.image || payload.imageBase64),
    mode: payload.mode || payload.pipelineMode || payload.pipeline_mode || null,
  };
}

function normalizeLookup(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeSdModelProfile(value = '') {
  const profile = String(value || '').trim().toLowerCase();
  if (!profile) return '';
  if (['sd35', 'sd3.5', 'sd35-medium', 'stable-diffusion-3.5', 'stable-diffusion-3.5-medium'].includes(profile)) {
    return 'sd35';
  }
  if (['sd35large', 'sd35-large', 'sd3.5-large', 'stable-diffusion-3.5-large'].includes(profile)) {
    return 'sd35large';
  }
  if (['sd35turbo', 'sd35-turbo', 'sd3.5-turbo', 'stable-diffusion-3.5-large-turbo'].includes(profile)) {
    return 'sd35turbo';
  }
  if (['multilingual', 'alt'].includes(profile)) {
    return 'multilingual';
  }
  if (['classic', 'sd15', 'v1.5'].includes(profile)) {
    return 'classic';
  }
  return profile;
}

function resolveDefaultSdModelProfile() {
  return normalizeSdModelProfile(process.env.SD_MODEL_PROFILE || '') || 'sd35';
}

function normalizeSourceMode(value = '') {
  return normalizeLookup(value).replace(/\s+/g, '_');
}

function isVideoContinuationSourceMode(value = '') {
  return [
    'previous_frame',
    'checkpoint_chain',
    'segment_anchor',
    'video_first_frame',
  ].includes(normalizeSourceMode(value));
}

function isReferenceAnchorSourceMode(value = '') {
  return [
    'web_reference_subject',
    'reference_anchor',
    'reference_reanchor',
    'image_url',
    'image_path',
    'image_data_url',
    'uploaded_image',
    'upload',
    'init_image',
  ].includes(normalizeSourceMode(value));
}

function looksLikeHumanReferencePrompt(value = '') {
  return /\b(personne|humain|humaine|enfant|garcon|garçon|fille|homme|femme|ado|adolescent|adolescente|portrait|visage|selfie|photo|coiffure|cheveux|tenue|veste|same person|same face|child|boy|girl|man|woman|face|portrait|hair|outfit|this image|reference image|cette image|photo de reference|image de reference)\b/i.test(String(value || ''));
}

async function unloadOllamaModelIfNeeded(modelProfile = '') {
  const ollamaBase = String(process.env.OLLAMA_BASE || 'http://127.0.0.1:11434').trim();
  const primaryModel = String(process.env.A11_OLLAMA_PRIMARY_MODEL || 'gemma4:e4b').trim();
  if (!primaryModel) return;
  try {
    await defaultFetch(`${ollamaBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: primaryModel, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000),
    });
    const profile = normalizeSdModelProfile(modelProfile || process.env.SD_MODEL_PROFILE || '') || 'unknown';
    console.log(`[A11][sd-tools] Ollama model ${primaryModel} unloaded from VRAM before SD generation (profile=${profile})`);
  } catch {
    // ignore - Ollama peut ne pas etre disponible
  }
}

function sleep(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function drainLocalGpuBeforeSd({ modelProfile = '' } = {}) {
  shutdownJanusVisionWorker();
  await unloadOllamaModelIfNeeded(modelProfile);
  const settleMs = Math.max(0, Number(process.env.A11_SD_GPU_SETTLE_MS || 350) || 350);
  await sleep(settleMs);
}

function resolveRequestOrigin(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const rawProto = forwardedProto || req?.protocol || (req?.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(
    req?.headers?.['x-forwarded-host']
    || req?.headers?.host
    || ''
  ).split(',')[0].trim();

  if (!forwardedHost) return '';

  // Si le host est loopback (127.0.0.1 ou localhost), utiliser l'IP LAN configurée
  // pour que les appareils du réseau local (téléphone, tablette) puissent accéder aux images
  const hostWithoutPort = forwardedHost.split(':')[0];
  const port = forwardedHost.includes(':') ? forwardedHost.split(':')[1] : null;
  const isLoopback = hostWithoutPort === '127.0.0.1' || hostWithoutPort === 'localhost' || hostWithoutPort === '::1';
  const isPrivateLan = /^10\./.test(hostWithoutPort)
    || /^192\.168\./.test(hostWithoutPort)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostWithoutPort);
  const proto = rawProto === 'http' && !isLoopback && !isPrivateLan ? 'https' : rawProto;

  if (isLoopback) {
    // Priorité : variable d'env A11_PUBLIC_HOST, sinon IP LAN auto-détectée
    const publicHost = String(process.env.A11_PUBLIC_HOST || process.env.PUBLIC_HOST || '').trim();
    if (publicHost) {
      const resolvedHost = port ? `${publicHost}:${port}` : publicHost;
      return `${proto || 'http'}://${resolvedHost}`;
    }
    // Fallback : garder le loopback (comportement original)
  }

  return `${proto || 'http'}://${forwardedHost}`;
}

function resolvePublicWorkspaceRoot() {
  const configuredRoot = String(
    process.env.A11_WORKSPACE_ROOT
    || process.env.WORKSPACE_ROOT
    || defaultPath.resolve(__dirname, '..', '..', '..', '..', '..')
  ).trim();
  return defaultPath.resolve(
    configuredRoot || defaultPath.resolve(__dirname, '..', '..', '..', '..', '..')
  );
}

function resolveGeneratedImageWorkRoot() {
  const explicitRoot = String(process.env.A11_IMAGE_WORK_ROOT || '').trim();
  if (explicitRoot) return defaultPath.resolve(explicitRoot);

  const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim();
  if (runtimeRoot) {
    return defaultPath.resolve(runtimeRoot, 'files', 'generated', 'images');
  }

  const legacySdOutputDir = String(process.env.SD_OUTPUT_DIR || '').trim();
  if (legacySdOutputDir) return defaultPath.resolve(legacySdOutputDir);

  if (String(process.env.NODE_ENV || '').trim() === 'production') {
    return '/tmp/a11-images';
  }

  return defaultPath.join(resolvePublicWorkspaceRoot(), 'runtime', 'files', 'generated', 'images');
}

function buildGeneratedImageLocalPublicUrl(req, outputPath = '') {
  const filePath = String(outputPath || '').trim();
  if (!filePath) return '';
  const absolutePath = defaultPath.resolve(filePath);
  if (!defaultFs.existsSync(absolutePath)) return '';

  const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim();
  if (runtimeRoot) {
    const runtimeRelativePath = String(defaultPath.relative(runtimeRoot, absolutePath) || '').replace(/\\/g, '/');
    if (runtimeRelativePath && !runtimeRelativePath.startsWith('..')) {
      const publicPath = `/files/runtime/${runtimeRelativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/')}`;
      const origin = resolveRequestOrigin(req);
      return origin ? `${origin}${publicPath}` : publicPath;
    }
  }

  const publicWorkspaceRoot = resolvePublicWorkspaceRoot();
  const workspaceRelativePath = String(defaultPath.relative(publicWorkspaceRoot, absolutePath) || '').replace(/\\/g, '/');
  if (workspaceRelativePath && !workspaceRelativePath.startsWith('..')) {
    const publicPath = `/files/${workspaceRelativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/')}`;
    const origin = resolveRequestOrigin(req);
    return origin ? `${origin}${publicPath}` : publicPath;
  }

  return '';
}

function resolveSdImg2ImgStrengthPlan(requestBody = {}, {
  initImage = '',
  prompt = '',
  modelProfile = '',
  ignorePrecomputedAutoStrength = false,
} = {}) {
  if (!String(initImage || '').trim()) return null;

  const rawStrength = requestBody?.strength !== undefined && requestBody?.strength !== null
    ? requestBody.strength
    : 'auto';
  const precomputedStrength = Number(
    requestBody?.strength_value
    ?? requestBody?.strengthValue
    ?? requestBody?.resolved_strength
    ?? requestBody?.resolvedStrength
  );
  const profile = String(requestBody?.strength_profile || requestBody?.strengthProfile || '').trim();
  const reason = String(requestBody?.strength_reason || requestBody?.strengthReason || '').trim();
  const components = (
    requestBody?.strength_components
    || requestBody?.strengthComponents
    || null
  );
  const componentStrengths = (
    requestBody?.strength_component_strengths
    || requestBody?.strengthComponentStrengths
    || null
  );
  const componentProfiles = (
    requestBody?.strength_component_profiles
    || requestBody?.strengthComponentProfiles
    || null
  );
  const componentReasons = (
    requestBody?.strength_component_reasons
    || requestBody?.strengthComponentReasons
    || null
  );
  const initSourceMode = String(
    requestBody?.source_mode
    || requestBody?.sourceMode
    || requestBody?.init_source_mode
    || requestBody?.initSourceMode
    || (String(initImage || '').trim() ? 'init_image' : '')
  ).trim();

  if (
    !ignorePrecomputedAutoStrength
    && String(rawStrength || '').trim().toLowerCase() === 'auto'
    && Number.isFinite(precomputedStrength)
  ) {
    return {
      mode: 'auto',
      profile: profile || 'balanced',
      reason: reason || 'precomputed_auto_strength',
      strength: precomputedStrength,
      retryStrength: Number.isFinite(Number(requestBody?.retryStrength))
        ? Number(requestBody.retryStrength)
        : precomputedStrength,
      ...(components && typeof components === 'object' ? { components } : {}),
      ...(componentStrengths && typeof componentStrengths === 'object' ? { componentStrengths } : {}),
      ...(componentProfiles && typeof componentProfiles === 'object' ? { componentProfiles } : {}),
      ...(componentReasons && typeof componentReasons === 'object' ? { componentReasons } : {}),
    };
  }

  return resolveImg2ImgStrengthPlan({
    explicitStrength: rawStrength,
    prompt,
    scene: {
      sceneKey: String(requestBody?.sceneKey || requestBody?.scene_key || '').trim(),
      compositeRisk: requestBody?.compositeRisk === true,
    },
    taskType: String(requestBody?.task_type || requestBody?.taskType || 'image_generate').trim(),
    initSourceMode,
    motionProfile: String(
      requestBody?.motion_profile
      || requestBody?.motionProfile
      || requestBody?.video_motion_profile
      || requestBody?.videoMotionProfile
      || ''
    ).trim(),
    profileHint: profile,
    modelProfile,
    bias: requestBody?.strength_bias ?? requestBody?.strengthBias,
  });
}

function buildStrengthPlanPayload(strengthPlan = null, strength = Number.NaN) {
  if (!strengthPlan || typeof strengthPlan !== 'object') {
    return Number.isFinite(Number(strength)) ? { strength: Number(strength) } : {};
  }

  return {
    ...(Number.isFinite(Number(strength)) ? { strength: Number(strength) } : {}),
    ...(strengthPlan?.mode ? { strength_mode: strengthPlan.mode } : {}),
    ...(strengthPlan?.profile ? { strength_profile: strengthPlan.profile } : {}),
    ...(strengthPlan?.reason ? { strength_reason: strengthPlan.reason } : {}),
    ...(Number.isFinite(Number(strength)) ? { strength_value: Number(strength) } : {}),
    ...(strengthPlan?.components && typeof strengthPlan.components === 'object' ? { strength_components: strengthPlan.components } : {}),
    ...(strengthPlan?.componentStrengths && typeof strengthPlan.componentStrengths === 'object' ? { strength_component_strengths: strengthPlan.componentStrengths } : {}),
    ...(strengthPlan?.componentProfiles && typeof strengthPlan.componentProfiles === 'object' ? { strength_component_profiles: strengthPlan.componentProfiles } : {}),
    ...(strengthPlan?.componentReasons && typeof strengthPlan.componentReasons === 'object' ? { strength_component_reasons: strengthPlan.componentReasons } : {}),
  };
}

function resolveSdModelProfilePlan({
  requestBody = {},
  initImage = '',
  rawPrompt = '',
  finalPrompt = '',
  semanticCompiledState = null,
} = {}) {
  const explicitProfile = normalizeSdModelProfile(
    requestBody?.model_profile
    || requestBody?.modelProfile
    || requestBody?.sd_model_profile
    || requestBody?.sdModelProfile
    || ''
  );
  if (explicitProfile) {
    return {
      profile: explicitProfile,
      reason: 'request_explicit',
      explicit: true,
      dynamic: false,
    };
  }

  const defaultProfile = resolveDefaultSdModelProfile();
  if (!String(initImage || '').trim()) {
    return {
      profile: defaultProfile,
      reason: 'env_default',
      explicit: false,
      dynamic: false,
    };
  }

  const sourceMode = String(
    requestBody?.source_mode
    || requestBody?.sourceMode
    || requestBody?.init_source_mode
    || requestBody?.initSourceMode
    || ''
  ).trim();
  const taskType = normalizeSourceMode(requestBody?.task_type || requestBody?.taskType || '');
  const semanticProfileType = normalizeLookup(
    semanticCompiledState?.mask?.meta?.subjectProfile?.type
    || semanticCompiledState?.mask?.meta?.semantic?.subjectProfile?.type
    || ''
  );
  const combinedPrompt = `${String(rawPrompt || '').trim()} ${String(finalPrompt || '').trim()}`.trim();

  if (
    defaultProfile === 'sd35turbo'
    && !isVideoContinuationSourceMode(sourceMode)
    && (
      ['single_human_figure', 'reference_character'].includes(semanticProfileType)
      || isReferenceAnchorSourceMode(sourceMode)
      || looksLikeHumanReferencePrompt(combinedPrompt)
      || !taskType.includes('video_frame_sequence')
    )
  ) {
    return {
      profile: 'sd35large',
      reason: ['single_human_figure', 'reference_character'].includes(semanticProfileType)
        ? 'init_image_sensitive_subject'
        : (isReferenceAnchorSourceMode(sourceMode)
          ? `init_image_source_mode:${normalizeSourceMode(sourceMode)}`
          : 'init_image_quality_guard'),
      explicit: false,
      dynamic: true,
    };
  }

  return {
    profile: defaultProfile,
    reason: 'env_default',
    explicit: false,
    dynamic: false,
  };
}

function buildSdPromptBundleFallback(rawPrompt = '', options = {}) {
  return {
    prompt: normalizePromptFragment(rawPrompt),
    negativeHints: [],
    options,
  };
}

function resolveOpenAiPreferredForImage(requestBody = {}) {
  if (!isOpenAiImageEnabled(process.env)) return false;

  const explicitEngine = String(
    requestBody?.engine
    || requestBody?.image_engine
    || requestBody?.provider
    || ''
  ).trim().toLowerCase();
  if (explicitEngine === 'sd' || explicitEngine === 'stable-diffusion') return false;
  if (explicitEngine === 'openai' || explicitEngine === 'openai-image') return true;

  const order = String(process.env.A11_IMAGE_PROVIDER_ORDER || 'sd,hf,openai')
    .split(',')
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  return order[0] === 'openai' || order[0] === 'openai-image';
}

function resolveHuggingFacePreferredForImage(requestBody = {}) {
  const config = resolveHuggingFaceImageConfig(process.env);
  if (!config.enabled) return false;

  const explicitEngine = String(
    requestBody?.engine
    || requestBody?.image_engine
    || requestBody?.provider
    || ''
  ).trim().toLowerCase();
  if (explicitEngine === 'sd' || explicitEngine === 'stable-diffusion') return false;
  if (explicitEngine === 'hf' || explicitEngine === 'huggingface' || explicitEngine === 'huggingface-image') return true;

  const order = String(process.env.A11_IMAGE_PROVIDER_ORDER || 'sd,hf,openai')
    .split(',')
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  return order[0] === 'hf' || order[0] === 'huggingface' || order[0] === 'huggingface-image';
}

function normalizeImageProviderName(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'stable-diffusion' || normalized === 'stable_diffusion' || normalized === 'local-sd') return 'sd';
  if (normalized === 'hf' || normalized === 'huggingface' || normalized === 'hugging_face' || normalized === 'huggingface-image') return 'hf';
  if (normalized === 'replicate' || normalized === 'replicate-image') return 'replicate';
  if (normalized === 'pollinations' || normalized === 'pollinations-image') return 'pollinations';
  if (normalized === 'synthetic' || normalized === 'synthetic-frame' || normalized === 'emergency' || normalized === 'a11-emergency') return 'synthetic';
  if (normalized === 'openai-image') return 'openai';
  if (normalized === 'sd' || normalized === 'openai') return normalized;
  return '';
}

function hasExplicitImageProvider(requestBody = {}) {
  return Boolean(normalizeImageProviderName(
    requestBody?.engine
    || requestBody?.image_engine
    || requestBody?.provider
    || ''
  ));
}

function isEmergencyImageFallbackEnabled(requestBody = {}, env = process.env) {
  const configured = String(env.A11_ENABLE_EMERGENCY_IMAGE_FALLBACK || env.A11_ENABLE_SYNTHETIC_IMAGE_FALLBACK || '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(configured)) return false;
  if (['1', 'true', 'yes', 'on', 'force'].includes(configured)) return true;
  if (hasExplicitImageProvider(requestBody)) return false;
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function resolveImageProviderOrder(requestBody = {}) {
  const explicit = normalizeImageProviderName(
    requestBody?.engine
    || requestBody?.image_engine
    || requestBody?.provider
    || ''
  );
  if (explicit) return [explicit];

  const configured = String(process.env.A11_IMAGE_PROVIDER_ORDER || 'sd,hf,openai')
    .split(',')
    .map(normalizeImageProviderName)
    .filter(Boolean);
  const order = configured.length ? configured : ['sd', 'hf', 'openai'];
  return [...new Set(order)];
}

function normalizeImageToolPayload(payload = {}, provider = '', options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = {
    ...payload,
    provider: String(payload.provider || provider || payload.mode || '').trim() || undefined,
    tool: payload.tool || 'generate_image',
  };
  if (next.url && !next.image_url) next.image_url = next.url;
  if (next.image_url && !next.url) next.url = next.image_url;
  if (!next.content_type && String(next.filename || next.url || next.image_url || '').match(/\.png(?:[?#].*)?$/i)) {
    next.content_type = 'image/png';
  }
  if (!next.content_type && String(next.filename || next.url || next.image_url || '').match(/\.webp(?:[?#].*)?$/i)) {
    next.content_type = 'image/webp';
  }
  if (!next.content_type && String(next.filename || next.url || next.image_url || '').match(/\.(?:jpe?g)(?:[?#].*)?$/i)) {
    next.content_type = 'image/jpeg';
  }
  if (!next.content_type && next.ok !== false) next.content_type = 'image/png';
  return attachMediaAgentRoles(next, 'image', options);
}

function isSuccessfulImagePayload(payload = {}) {
  return Boolean(payload && payload.ok !== false && (payload.url || payload.image_url || payload.output_path || payload.local_path));
}

function normalizePromptFragment(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSdDimensionMultiple() {
  const configured = Number(process.env.SD_DIMENSION_MULTIPLE || process.env.A11_SD_DIMENSION_MULTIPLE || 8);
  if (!Number.isFinite(configured) || configured <= 0) return 8;
  return Math.max(8, Math.min(128, Math.round(configured)));
}

function alignDimensionToMultiple(value, {
  min = 64,
  max = 2048,
  multiple = resolveSdDimensionMultiple(),
} = {}) {
  const safeMultiple = Math.max(1, Number(multiple) || 8);
  const safeMin = Math.max(safeMultiple, Math.ceil(Number(min || 64) / safeMultiple) * safeMultiple);
  const safeMax = Math.max(safeMin, Math.floor(Number(max || 2048) / safeMultiple) * safeMultiple);
  let n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) n = safeMin;
  n = Math.max(safeMin, Math.min(safeMax, n));
  n = Math.floor(n / safeMultiple) * safeMultiple;
  return Math.max(safeMin, Math.min(safeMax, n));
}

function splitPromptFragments(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => normalizePromptFragment(entry))
    .filter(Boolean);
}

function mergeNegativePrompts(...values) {
  const entries = values
    .flatMap((value) => splitPromptFragments(value))
    .map((entry) => normalizePromptFragment(entry))
    .filter(Boolean);
  return [...new Set(entries)].join(', ').trim();
}

function buildBundleFallbackNegativeHints(promptBundle = null) {
  const details = promptBundle?.details && typeof promptBundle.details === 'object'
    ? promptBundle.details
    : null;
  if (!details) return [];

  const hints = ['readable text', 'watermark', 'logo', 'signature'];
  if (Number(details?.singleSubjectConstraints?.count || 0) === 1) {
    hints.push('multiple subjects', 'duplicate subject', 'crowd');
  } else if (Number(details?.characterCountConstraints?.count || 0) === 2) {
    hints.push('third subject', 'extra character', 'crowd', 'collage', 'montage');
  }
  return [...new Set(hints.map((entry) => normalizePromptFragment(entry)).filter(Boolean))];
}

function normalizeBundledProxyPrompt(value = '') {
  return normalizePromptFragment(value)
    .replace(/\b(request|main subject|colors)\s*:\s*/gi, '$1 ')
    .replace(/\bHighlight a single clearly visible main subject\.?/gi, 'single main subject.')
    .replace(/\bShow the two requested subjects clearly\.?/gi, 'two distinct readable subjects.')
    .replace(
      /\bKeep exactly two characters, with only one instance of each character\.?/gi,
      'exactly two characters, one instance of each.'
    );
}

function analyzePromptDensity(value = '') {
  const text = normalizePromptFragment(value);
  return {
    length: text.length,
    words: text ? text.split(/\s+/).filter(Boolean).length : 0,
    clauses: text
      ? text
        .split(/[.!?;:\n]+/)
        .map((entry) => normalizePromptFragment(entry))
        .filter(Boolean)
        .length
      : 0,
    commas: (text.match(/,/g) || []).length,
  };
}

function shouldUseRuntimeImagePromptCompiler({
  rawPrompt = '',
  negativePrompt = '',
  initImage = '',
} = {}) {
  if (String(initImage || '').trim()) return true;
  const promptDensity = analyzePromptDensity(rawPrompt);
  const negativeDensity = analyzePromptDensity(negativePrompt);
  return (
    promptDensity.length >= 320
    || promptDensity.words >= 55
    || promptDensity.clauses >= 6
    || promptDensity.commas >= 6
    || negativeDensity.length >= 120
    || negativeDensity.words >= 18
  );
}

function looksLikeCompiledSdPrompt(value = '') {
  const normalized = normalizePromptFragment(value).toLowerCase();
  if (!normalized) return false;

  const markers = [
    'literal interpretation',
    'interprétation littérale',
    'demande :',
    'créer une image fidèle à la demande',
    'solo composition',
    'composition solo',
    'simple clean background',
    'fond simple et propre',
    'centered subject',
    'exactly one ',
    'sujet principal :',
    'couleurs :',
    'only one animal in frame',
  ];

  let matches = 0;
  for (const marker of markers) {
    if (normalized.includes(marker)) matches += 1;
  }

  return matches >= 2;
}

function repairCompiledSdPromptArtifacts(value = '') {
  const repairableSubjects = [
    'rabbit',
    'cow',
    'pig',
    'fish',
    'cat',
    'dog',
    'fox',
    'bear',
    'panda',
    'lion',
    'tiger',
    'dragon',
    'unicorn',
    'bicycle',
    'bike',
    'cyclist',
    'knight',
    'hero',
    'princess',
    'character',
    'batman',
    'robin',
  ];
  const subjectPattern = repairableSubjects
    .sort((left, right) => right.length - left.length)
    .map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return normalizePromptFragment(value)
    .replace(new RegExp(`\\b(?:e\\s+)?image\\s+(${subjectPattern})\\b`, 'gi'), '$1')
    .replace(/\bone\s+one\b/gi, 'one')
    .replace(/\bexactly one one\b/gi, 'exactly one');
}

function fallbackIsAdminRequest(req) {
  const configuredAdminToken = String(process.env.NEZ_ADMIN_TOKEN || '').trim();
  const adminHeaders = [
    req?.headers?.['x-nez-admin-token'],
    req?.headers?.['x-admin-token'],
  ].map((value) => String(value || '').trim()).filter(Boolean);

  if (configuredAdminToken && adminHeaders.includes(configuredAdminToken)) {
    return true;
  }

  const rawTokens = [
    process.env.NEZ_ALLOWED_TOKEN,
    process.env.NEZ_TOKENS,
  ].filter(Boolean).join(',');

  const allowedTokens = rawTokens
    .split(/[,\s]+/)
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (allowedTokens.length === 0) {
    return false;
  }

  const bearer = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return allowedTokens.includes(bearer);
}

function isMissingTorchFailure(result = {}) {
  const text = String(result?.message || result?.stderr || '').toLowerCase();
  return text.includes('no module named') && text.includes('torch');
}

function summarizeLocalSdFailure(localResult = null) {
  if (!localResult || typeof localResult !== 'object') return '';
  if (localResult.error === 'python_spawn_failed') {
    return 'le runtime Python SD local est introuvable';
  }
  if (isMissingTorchFailure(localResult)) {
    return 'torch manque sur le backend image';
  }
  if (String(localResult?.diagnostic_message || '').trim()) {
    return String(localResult.diagnostic_message).trim();
  }

  const stderrText = String(localResult.stderr || '').trim();
  const messageText = String(localResult.message || '').trim();
  const signalText = String(localResult.signal || '').trim().toUpperCase();

  if (localResult.error === 'python_failed') {
    if (signalText) {
      return `le process Python SD local a ete interrompu (${signalText})`;
    }
    if (/out of memory|cuda.*memory|not enough memory|oom/i.test(stderrText)) {
      return 'le backend SD local a manque de memoire pendant le chargement ou le rendu';
    }
    if (/python_exit_/i.test(messageText) || stderrText) {
      return 'le backend SD local s est interrompu pendant le chargement ou le rendu';
    }
  }

  if (localResult.error === 'bad_python_output') {
    return 'le backend SD local a renvoye une sortie invalide';
  }

  return messageText;
}

function buildSdUnavailablePayload({ localResult = null, openAiResult = null } = {}) {
  const reasons = [];
  const localFailure = summarizeLocalSdFailure(localResult);
  if (localFailure) reasons.push(localFailure);
  if (openAiResult?.error === 'openai_image_disabled') reasons.push('OpenAI image est desactive');
  if (openAiResult?.error === 'openai_image_unconfigured') reasons.push('OPENAI_API_KEY image n est pas configuree');
  if (looksLikeOpenAiQuotaError(openAiResult)) reasons.push('le quota OpenAI image est depasse');
  if (!reasons.length && openAiResult?.message) reasons.push(String(openAiResult.message));

  return {
    ok: false,
    error: 'image_backend_unavailable',
    message: reasons.length
      ? `Generation image indisponible: ${reasons.join(' ; ')}.`
      : 'Generation image indisponible sur cet environnement.',
    local: localResult || null,
    openai: openAiResult || null,
  };
}

function buildSdBackendUnavailablePayload({
  proxyUrl = '',
  proxyResult = null,
  reason = 'backend image unavailable',
  localFallbackBlocked = false,
} = {}) {
  const expectedProxyRoute = '/api/tools/generate_sd';
  const upstreamMessage = String(
    proxyResult?.body?.message
    || proxyResult?.text
    || reason
    || 'backend image unavailable'
  ).trim();
  const routeHint = proxyUrl
    ? `Proxy attendu: ${proxyUrl}. Route attendue: POST ${expectedProxyRoute}.`
    : `Route attendue: POST ${expectedProxyRoute} via A11_SD_PROXY_URL.`;
  const proxyOnlyHint = localFallbackBlocked
    ? 'Mode proxy-only actif: le fallback local est volontairement desactive en production.'
    : '';

  return {
    ok: false,
    error: 'image_backend_unavailable',
    code: localFallbackBlocked ? 'local_only_fallback_blocked' : 'sd_backend_unavailable',
    message: localFallbackBlocked
      ? `Generation image indisponible: backend SD proxy en echec en production. ${proxyOnlyHint} ${upstreamMessage} ${routeHint}`.trim()
      : `Generation image indisponible: ${upstreamMessage} ${routeHint}`.trim(),
    upstream: proxyUrl ? {
      provider: 'sd-proxy',
      url: proxyUrl,
      status: Number(proxyResult?.status || 0) || null,
    } : null,
    proxyOnlyMode: localFallbackBlocked,
    expectedProxyRoute,
  };
}

function resolveSdProxyPublicFileBaseUrl(req = null) {
  const explicit = String(process.env.A11_SD_PUBLIC_FILE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;

  const publicBase = String(process.env.PUBLIC_API_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (publicBase) return `${publicBase}/local-sd-files`;

  const protocol = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').trim() || 'http';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  return host ? `${protocol}://${host}/local-sd-files` : '';
}

function rewriteSdProxyFileUrl(value = '', req = null) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (!parsed.pathname.startsWith('/files/')) return raw;

  const base = resolveSdProxyPublicFileBaseUrl(req);
  if (!base) return raw;

  const rewrittenPath = parsed.pathname.replace(/^\/files\/?/, '/');
  return `${base}${rewrittenPath}${parsed.search || ''}`;
}

function rewriteSdProxyResultFileUrls(payload = null, req = null) {
  if (!payload || typeof payload !== 'object') return payload;

  const next = { ...payload };
  for (const key of ['url', 'image_url', 'file_url', 'download_url']) {
    if (next[key]) {
      next[key] = rewriteSdProxyFileUrl(next[key], req);
    }
  }
  return next;
}

function resolveDependencies(overrides = {}) {
  return {
    fs: overrides.fs || defaultFs,
    path: overrides.path || defaultPath,
    fetch: overrides.fetch || defaultFetch,
    buildCanonicalImageMaskFromText: overrides.buildCanonicalImageMaskFromText || buildCanonicalImageMaskFromText,
    compileMaskImageGenerate: overrides.compileMaskImageGenerate || defaultCompileMaskImageGenerate,
    compileMaskImageGenerateRuntime: overrides.compileMaskImageGenerateRuntime || defaultCompileMaskImageGenerateRuntime,
    callStructuredLlmJson: Object.prototype.hasOwnProperty.call(overrides, 'callStructuredLlmJson')
      ? overrides.callStructuredLlmJson
      : defaultCallStructuredLlmJson,
    buildSdPromptBundle: overrides.buildSdPromptBundle || defaultBuildSdPromptBundle || buildSdPromptBundleFallback,
    resolveSdProxyUrl: overrides.resolveSdProxyUrl || defaultResolveSdProxyUrl,
    resolveSdScriptPath: overrides.resolveSdScriptPath || defaultResolveSdScriptPath,
    runSdScript: overrides.runSdScript || defaultRunSdScript,
    uploadBufferToR2: overrides.uploadBufferToR2 || defaultUploadBufferToR2,
    isAdminRequest: overrides.isAdminRequest || fallbackIsAdminRequest,
    shouldAllowLocalSdFallback: overrides.shouldAllowLocalSdFallback || defaultShouldAllowLocalSdFallback,
    drainLocalGpuBeforeSd: overrides.drainLocalGpuBeforeSd || drainLocalGpuBeforeSd,
  };
}

function createSdToolsRouter(overrides = {}) {
  const {
    fs,
    path,
    fetch,
    buildCanonicalImageMaskFromText,
    compileMaskImageGenerate,
    compileMaskImageGenerateRuntime,
    callStructuredLlmJson,
    buildSdPromptBundle,
    resolveSdProxyUrl,
    resolveSdScriptPath,
    runSdScript,
    uploadBufferToR2,
    isAdminRequest,
    shouldAllowLocalSdFallback,
    drainLocalGpuBeforeSd,
  } = resolveDependencies(overrides);

  const express = require('express');
  const router = express.Router();

  async function generateSdInternal({ req, prompt, body = null }) {
    const requestBody = body || req?.body || {};
    const imageDimensionConfig = resolveImageDimensionConfig(process.env);
    const rawPrompt = String(prompt || requestBody?.prompt || '').trim();
    if (!rawPrompt) {
      const error = new Error('missing_prompt');
      error.statusCode = 400;
      throw error;
    }
    const initImage = String(
      requestBody?.init_image
      || requestBody?.initImage
      || requestBody?.init_image_url
      || requestBody?.initImageUrl
      || requestBody?.reference_image_url
      || requestBody?.referenceImageUrl
      || ''
    ).trim();

    const promptAlreadyCompiled = (
      requestBody?.prompt_prebuilt === true
      || requestBody?.skip_prompt_enrichment === true
      || requestBody?.task_type === 'video_frame_sequence'
    );
    const inferredPromptAlreadyCompiled = !promptAlreadyCompiled && looksLikeCompiledSdPrompt(rawPrompt);

    const skipSemanticImagePrepass = ['1', 'true', 'yes', 'on'].includes(
      String(process.env.A11_IMAGE_SKIP_LLM_PREPASS || '').trim().toLowerCase()
    );
    let semanticCompiledState = null;
    if (!skipSemanticImagePrepass && !promptAlreadyCompiled && !inferredPromptAlreadyCompiled) {
      try {
        const maskResolution = await buildCanonicalImageMaskFromText(rawPrompt, {
          maskOptions: {
            width: Number(requestBody?.width || imageDimensionConfig.defaultWidth),
            height: Number(requestBody?.height || imageDimensionConfig.defaultHeight),
            steps: Number(requestBody?.num_inference_steps || requestBody?.steps || 35),
            guidance_scale: Number(requestBody?.guidance_scale || 8.0),
            ...(requestBody?.seed !== undefined ? { seed: Number(requestBody.seed) } : {}),
          },
        });
        if (maskResolution?.rawMask) {
          if (initImage) {
            maskResolution.rawMask.meta = {
              ...(maskResolution.rawMask.meta && typeof maskResolution.rawMask.meta === 'object'
                ? maskResolution.rawMask.meta
                : {}),
              init_image_url: initImage,
              reference_image_url: initImage,
            };
          }
          if (
            typeof compileMaskImageGenerateRuntime === 'function'
            && shouldUseRuntimeImagePromptCompiler({
              rawPrompt,
              negativePrompt: String(requestBody?.negative_prompt || '').trim(),
              initImage,
            })
          ) {
            semanticCompiledState = await compileMaskImageGenerateRuntime(maskResolution.rawMask, {
              req,
              callStructuredLlmJson,
            });
          } else {
            semanticCompiledState = compileMaskImageGenerate(maskResolution.rawMask);
          }
        }
      } catch {
        semanticCompiledState = null;
      }
    }

    const repairedRawPrompt = repairCompiledSdPromptArtifacts(rawPrompt);
    const promptBundle = promptAlreadyCompiled || inferredPromptAlreadyCompiled || semanticCompiledState
      ? { prompt: repairedRawPrompt || rawPrompt, negativeHints: [] }
      : buildSdPromptBundle(rawPrompt, {
        preferLiteralColor: requestBody?.prefer_literal_color === true || requestBody?.image_interpretation === 'literal_color',
        forceColorPrompt: requestBody?.force_color_prompt === true,
      });
    let finalPrompt = repairCompiledSdPromptArtifacts(
      promptAlreadyCompiled || inferredPromptAlreadyCompiled
        ? (repairedRawPrompt || rawPrompt)
        : (semanticCompiledState?.sdBody?.prompt || normalizeBundledProxyPrompt(promptBundle.prompt))
    );
    const finalPrompt2 = repairCompiledSdPromptArtifacts(
      String(requestBody?.prompt_2 || requestBody?.prompt2 || '').trim()
    );
    const finalPrompt3 = repairCompiledSdPromptArtifacts(
      String(requestBody?.prompt_3 || requestBody?.prompt3 || '').trim()
    );
    let finalNegativePrompt = mergeNegativePrompts(
      semanticCompiledState?.sdBody?.negative_prompt,
      requestBody?.negative_prompt,
      Array.isArray(promptBundle?.negativeHints) ? promptBundle.negativeHints.join(', ') : '',
      buildBundleFallbackNegativeHints(promptBundle).join(', ')
    );
    if (!promptAlreadyCompiled && !inferredPromptAlreadyCompiled) {
      const linguisticPrompt = enrichImagePromptWithLinguisticScene({
        rawPrompt,
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        context: {
          activeAgent: requestBody?.agent || requestBody?.activeAgent || requestBody?.owner || '',
          narrativeContext: requestBody?.narrativeContext || requestBody?.universe || '',
          module: requestBody?.module || requestBody?.runtimeModule || '',
        },
      });
      finalPrompt = linguisticPrompt.prompt || finalPrompt;
      finalNegativePrompt = linguisticPrompt.negativePrompt || finalNegativePrompt;
    }
    const finalNegativePrompt2 = String(
      requestBody?.negative_prompt_2 || requestBody?.negativePrompt2 || ''
    ).trim();
    const finalNegativePrompt3 = String(
      requestBody?.negative_prompt_3 || requestBody?.negativePrompt3 || ''
    ).trim();
    const modelProfilePlan = resolveSdModelProfilePlan({
      requestBody,
      initImage,
      rawPrompt,
      finalPrompt,
      semanticCompiledState,
    });
    if (modelProfilePlan?.profile) {
      console.log(
        `[A11][sd-model] profile=${String(modelProfilePlan.profile).trim()}`
        + ` reason=${String(modelProfilePlan.reason || 'n/a').trim() || 'n/a'}`
        + (modelProfilePlan.dynamic ? ' dynamic=1' : '')
      );
    }

    const num_inference_steps = Number(requestBody?.num_inference_steps || requestBody?.steps || 35);
    const guidance_scale = Number(requestBody?.guidance_scale || 8.0);
    function clampDimension(val, fallback, { min = 64, max = 2048, multiple = resolveSdDimensionMultiple() } = {}) {
      const n = Number(val);
      return alignDimensionToMultiple(Number.isFinite(n) ? n : fallback, { min, max, multiple });
    }
    function fitDimensions(widthValue, heightValue, fallbackWidth, fallbackHeight) {
      let width = Number(widthValue);
      let height = Number(heightValue);
      const renderLimits = typeof resolveSdLocalRenderLimits === 'function'
        ? resolveSdLocalRenderLimits({
          env: process.env,
          width,
          height,
        })
        : {
          minSide: 64,
          maxSide: Number(process.env.A11_IMAGE_MAX_SIZE || 2048),
          maxPixels: Number(process.env.A11_IMAGE_MAX_PIXELS || (Number(process.env.A11_IMAGE_MAX_SIZE || 2048) ** 2)),
          policy: 'default',
          profile: null,
        };
      const IMAGE_MIN_SIZE = Number(renderLimits.minSide || 64) || 64;
      const IMAGE_MAX_SIZE = Number(renderLimits.maxSide || 2048) || 2048;
      const IMAGE_MAX_PIXELS = Number(renderLimits.maxPixels || (IMAGE_MAX_SIZE * IMAGE_MAX_SIZE)) || (IMAGE_MAX_SIZE * IMAGE_MAX_SIZE);
      const SD_DIMENSION_MULTIPLE = resolveSdDimensionMultiple();
      const beforeAlignWidth = width;
      const beforeAlignHeight = height;
      if (!Number.isFinite(width) || width <= 0) width = fallbackWidth;
      if (!Number.isFinite(height) || height <= 0) height = fallbackHeight;
      width = Math.max(IMAGE_MIN_SIZE, width);
      height = Math.max(IMAGE_MIN_SIZE, height);

      let scale = 1;
      if (width > IMAGE_MAX_SIZE || height > IMAGE_MAX_SIZE) {
        scale = Math.min(scale, IMAGE_MAX_SIZE / width, IMAGE_MAX_SIZE / height);
      }
      if ((width * height) > IMAGE_MAX_PIXELS) {
        scale = Math.min(scale, Math.sqrt(IMAGE_MAX_PIXELS / Math.max(width * height, 1)));
      }
      if (scale < 1) {
        width *= scale;
        height *= scale;
      }

      width = clampDimension(width, fallbackWidth, {
        min: IMAGE_MIN_SIZE,
        max: IMAGE_MAX_SIZE,
        multiple: SD_DIMENSION_MULTIPLE,
      });
      height = clampDimension(height, fallbackHeight, {
        min: IMAGE_MIN_SIZE,
        max: IMAGE_MAX_SIZE,
        multiple: SD_DIMENSION_MULTIPLE,
      });

      let guard = 0;
      while ((width * height) > IMAGE_MAX_PIXELS && guard < 4) {
        const areaScale = Math.sqrt(IMAGE_MAX_PIXELS / Math.max(width * height, 1));
        if (!(areaScale > 0 && areaScale < 1)) break;
        const nextWidth = clampDimension(width * areaScale, fallbackWidth, {
          min: IMAGE_MIN_SIZE,
          max: IMAGE_MAX_SIZE,
          multiple: SD_DIMENSION_MULTIPLE,
        });
        const nextHeight = clampDimension(height * areaScale, fallbackHeight, {
          min: IMAGE_MIN_SIZE,
          max: IMAGE_MAX_SIZE,
          multiple: SD_DIMENSION_MULTIPLE,
        });
        if (nextWidth === width && nextHeight === height) break;
        width = nextWidth;
        height = nextHeight;
        guard += 1;
      }
      if (
        (Number.isFinite(beforeAlignWidth) && beforeAlignWidth > 0 && width !== Math.round(beforeAlignWidth))
        || (Number.isFinite(beforeAlignHeight) && beforeAlignHeight > 0 && height !== Math.round(beforeAlignHeight))
      ) {
        console.warn(
          `[A11][sd-tools] aligned render size to SD latent grid multiple=${SD_DIMENSION_MULTIPLE}`
          + ` requested=${Number.isFinite(beforeAlignWidth) ? Math.round(beforeAlignWidth) : 'auto'}x${Number.isFinite(beforeAlignHeight) ? Math.round(beforeAlignHeight) : 'auto'}`
          + ` effective=${width}x${height}`
        );
      }

      return {
        width,
        height,
        policy: renderLimits.policy,
        profile: renderLimits.profile,
        maxSide: IMAGE_MAX_SIZE,
        maxPixels: IMAGE_MAX_PIXELS,
      };
    }
    const directCanvasPlan = resolveImageCanvasPlan({
      prompt: rawPrompt,
      width: requestBody?.width,
      height: requestBody?.height,
      env: process.env,
    });
    const requestedWidth = Number(
      requestBody?.requested_width !== undefined ? requestBody.requested_width : directCanvasPlan.requestedWidth
    );
    const requestedHeight = Number(
      requestBody?.requested_height !== undefined ? requestBody.requested_height : directCanvasPlan.requestedHeight
    );
    const fittedDimensions = fitDimensions(
      Number(requestBody?.width !== undefined ? requestBody.width : directCanvasPlan.width),
      Number(requestBody?.height !== undefined ? requestBody.height : directCanvasPlan.height),
      Number(directCanvasPlan.width || imageDimensionConfig.defaultWidth || imageDimensionConfig.maxRenderSide || 2048),
      Number(directCanvasPlan.height || imageDimensionConfig.defaultHeight || imageDimensionConfig.maxRenderSide || 2048)
    );
    const width = fittedDimensions.width;
    const height = fittedDimensions.height;
    const sizePolicy = String(fittedDimensions.policy || 'default').trim() || 'default';
    const sizeProfile = String(fittedDimensions.profile || '').trim() || null;
    const sizeSource = String(requestBody?.size_source || directCanvasPlan.source || 'request').trim() || 'request';
    const sizeReason = String(requestBody?.size_reason || directCanvasPlan.reason || 'n/a').trim() || 'n/a';
    if (requestedWidth !== undefined && width !== requestedWidth) {
      console.warn(`[A11][sd-tools] width requested=${requestedWidth} effective=${width} (fit)`);
    }
    if (requestedHeight !== undefined && height !== requestedHeight) {
      console.warn(`[A11][sd-tools] height requested=${requestedHeight} effective=${height} (fit)`);
    }
    console.log(
      `[A11][sd-tools] final request size source=${sizeSource}`
      + ` reason=${sizeReason}`
      + ` requested=${Number.isFinite(requestedWidth) ? requestedWidth : 'auto'}x${Number.isFinite(requestedHeight) ? requestedHeight : 'auto'}`
      + ` effective=${width}x${height}`
      + (sizePolicy !== 'default' ? ` policy=${sizePolicy}` : '')
    );
    if (sizePolicy !== 'default') {
      console.warn(
        `[A11][sd-tools] applying size guard policy=${sizePolicy}`
        + ` profile=${sizeProfile || 'unknown'}`
        + ` max_side=${Number(fittedDimensions.maxSide || 0) || width}`
        + ` max_pixels=${Number(fittedDimensions.maxPixels || 0) || (width * height)}`
      );
    }
    const seed = requestBody?.seed !== undefined ? String(requestBody.seed) : undefined;
    const strengthPlan = resolveSdImg2ImgStrengthPlan(requestBody, {
      initImage,
      prompt: finalPrompt,
      modelProfile: modelProfilePlan?.profile || '',
      ignorePrecomputedAutoStrength: modelProfilePlan?.dynamic === true,
    });
    const strength = Number(strengthPlan?.strength);
    if (strengthPlan) {
      console.log(
        `[A11][sd-strength] mode=${String(strengthPlan.mode || 'auto').trim() || 'auto'}`
        + ` profile=${String(strengthPlan.profile || 'manual').trim() || 'manual'}`
        + ` reason=${String(strengthPlan.reason || 'n/a').trim() || 'n/a'}`
        + ` value=${Number.isFinite(strength) ? strength.toFixed(2) : 'n/a'}`
        + (modelProfilePlan?.profile ? ` model_profile=${String(modelProfilePlan.profile).trim()}` : '')
      );
    }

    const proxyUrl = resolveSdProxyUrl();
    const scriptPath = resolveSdScriptPath();
    const sdFallbackEnv = proxyUrl && !process.env.A11_SD_PROXY_URL && !process.env.SD_PROXY_URL
      ? { ...process.env, A11_SD_PROXY_URL: proxyUrl }
      : process.env;
    const allowLocalFallback = typeof shouldAllowLocalSdFallback === 'function'
      ? shouldAllowLocalSdFallback(sdFallbackEnv)
      : String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
    const hasLocalScript = allowLocalFallback && !!scriptPath && fs.existsSync(scriptPath);

    if (proxyUrl) {
      try {
        const proxyResponse = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildAiServiceAuthHeaders(),
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            prompt_prebuilt: true,
            ...(semanticCompiledState?.sdBody?.prompt_language
              ? { prompt_language: String(semanticCompiledState.sdBody.prompt_language).trim() }
              : {}),
            ...(finalPrompt2 ? { prompt_2: finalPrompt2, prompt_2_prebuilt: true } : {}),
            ...(finalPrompt3 ? { prompt_3: finalPrompt3, prompt_3_prebuilt: true } : {}),
            ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt, negative_prompt_prebuilt: true } : {}),
            ...(finalNegativePrompt2 ? { negative_prompt_2: finalNegativePrompt2, negative_prompt_2_prebuilt: true } : {}),
            ...(finalNegativePrompt3 ? { negative_prompt_3: finalNegativePrompt3, negative_prompt_3_prebuilt: true } : {}),
            num_inference_steps,
            guidance_scale,
            width,
            height,
            size_source: sizeSource,
            size_reason: sizeReason,
            requested_width: Number.isFinite(requestedWidth) ? requestedWidth : null,
            requested_height: Number.isFinite(requestedHeight) ? requestedHeight : null,
            ...(modelProfilePlan?.profile ? { model_profile: modelProfilePlan.profile } : {}),
            ...(initImage ? { init_image_url: initImage } : {}),
            ...buildStrengthPlanPayload(strengthPlan, strength),
            ...(seed !== undefined ? { seed } : {}),
          }),
        });

        const proxyText = await proxyResponse.text();
        let proxyJson = null;
        try {
          proxyJson = proxyText ? JSON.parse(proxyText) : null;
        } catch {
          proxyJson = null;
        }

        if (proxyResponse.ok && proxyJson) {
          return rewriteSdProxyResultFileUrls(proxyJson, req);
        }

        if (!hasLocalScript) {
          const error = new Error(proxyJson?.message || proxyText || `Proxy SD indisponible (${proxyUrl})`);
          error.statusCode = proxyResponse.status || 502;
          error.payload = buildSdBackendUnavailablePayload({
            proxyUrl,
            proxyResult: {
              status: proxyResponse.status,
              text: proxyText,
              body: proxyJson,
            },
            reason: proxyJson?.message || proxyText || `Proxy SD indisponible (${proxyUrl})`,
            localFallbackBlocked: !allowLocalFallback,
          });
          throw error;
        }

        console.warn('[A11][generate_sd] SD proxy failed, fallback to local script:', proxyResponse.status, proxyText);
      } catch (error_) {
        if (!hasLocalScript) {
          const error = new Error(String(error_?.message || error_));
          error.statusCode = error_?.statusCode || 502;
          error.payload = error_?.payload || buildSdBackendUnavailablePayload({
            proxyUrl,
            reason: String(error_?.message || error_),
            localFallbackBlocked: !allowLocalFallback,
          });
          throw error;
        }
        console.warn('[A11][generate_sd] SD proxy unreachable, fallback to local script:', error_?.message);
      }
    }

    const enableSd = String(process.env.ENABLE_SD || '').toLowerCase() === 'true';
    const adminAllowed = typeof isAdminRequest === 'function' ? isAdminRequest(req) : false;
    if (!enableSd && !adminAllowed) {
      const error = new Error('Stable Diffusion désactivé sur cet environnement');
      error.statusCode = 503;
      error.payload = { ok: false, error: 'sd_disabled', message: error.message };
      throw error;
    }

    if (!hasLocalScript) {
      if (!allowLocalFallback) {
        const error = new Error('Generation image indisponible: backend SD local bloque en production.');
        error.statusCode = 503;
        error.payload = buildSdBackendUnavailablePayload({
          reason: 'backend SD local indisponible sur cet environnement',
          localFallbackBlocked: true,
        });
        throw error;
      }

      const tempDir = resolveGeneratedImageWorkRoot();
      fs.mkdirSync(tempDir, { recursive: true });
      const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const outputPath = path.join(tempDir, outputName);
      const openAiFallback = await tryGeneratePngWithOpenAI({
        prompt: finalPrompt,
        outputPath,
        width,
        height,
        userId: req?.user?.id || 'image-tool',
      });

      if (openAiFallback?.ok) {
        const localPublicUrl = buildGeneratedImageLocalPublicUrl(req, openAiFallback.outputPath || outputPath);
        const imageUrl = openAiFallback.sourceUrl || localPublicUrl || null;
        return {
          ok: true,
          url: imageUrl,
          image_url: imageUrl,
          output_path: openAiFallback.outputPath || outputPath,
          local_path: openAiFallback.outputPath || outputPath,
          filename: path.basename(openAiFallback.outputPath || outputPath),
          prompt: finalPrompt,
          num_inference_steps,
          guidance_scale,
          width,
          height,
          ...(initImage ? { init_image_url: initImage } : {}),
          ...buildStrengthPlanPayload(strengthPlan, strength),
          seed: seed !== undefined ? Number(seed) : undefined,
          mode: openAiFallback.mode || 'openai-image',
        };
      }

      const error = new Error(openAiFallback?.message || 'Stable Diffusion indisponible sur cet environnement');
      error.statusCode = 503;
      error.payload = buildSdUnavailablePayload({
        localResult: { ok: false, error: 'sd_unavailable', message: 'Aucun script SD local disponible.' },
        openAiResult: openAiFallback,
      });
      throw error;
    }

    const tempDir = resolveGeneratedImageWorkRoot();
    fs.mkdirSync(tempDir, { recursive: true });
    const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const outputPath = path.join(tempDir, outputName);

    const outputJson = await runExclusiveLocalGpuTask('sd:render', async () => {
      await drainLocalGpuBeforeSd({ modelProfile: modelProfilePlan?.profile || '' });
      return runSdScript({
      prompt: finalPrompt,
      prompt_prebuilt: true,
      ...(semanticCompiledState?.sdBody?.prompt_language
        ? { prompt_language: String(semanticCompiledState.sdBody.prompt_language).trim() }
        : {}),
      ...(finalPrompt2 ? { prompt_2: finalPrompt2, prompt_2_prebuilt: true } : {}),
      ...(finalPrompt3 ? { prompt_3: finalPrompt3, prompt_3_prebuilt: true } : {}),
      ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt, negative_prompt_prebuilt: true } : {}),
      ...(finalNegativePrompt2 ? { negative_prompt_2: finalNegativePrompt2, negative_prompt_2_prebuilt: true } : {}),
      ...(finalNegativePrompt3 ? { negative_prompt_3: finalNegativePrompt3, negative_prompt_3_prebuilt: true } : {}),
      num_inference_steps,
      guidance_scale,
      width,
      height,
      size_source: sizeSource,
      size_reason: sizeReason,
      requested_width: Number.isFinite(requestedWidth) ? requestedWidth : null,
      requested_height: Number.isFinite(requestedHeight) ? requestedHeight : null,
      ...(modelProfilePlan?.profile ? { model_profile: modelProfilePlan.profile } : {}),
      ...(initImage ? { init_image_url: initImage } : {}),
      ...buildStrengthPlanPayload(strengthPlan, strength),
      ...(seed !== undefined ? { seed } : {}),
      output: outputPath,
    }, { scriptPath });
    });
    const actualWidth = Number(outputJson?.output_width || outputJson?.width || 0) || width;
    const actualHeight = Number(outputJson?.output_height || outputJson?.height || 0) || height;
    if (actualWidth !== width || actualHeight !== height) {
      console.warn(
        `[A11][sd-tools] output size mismatch requested=${width}x${height}`
        + ` actual=${actualWidth}x${actualHeight}`
        + ` model=${String(outputJson?.model_id || 'unknown')}`
      );
    }

    if (!outputJson?.ok || !outputJson?.output_path || !fs.existsSync(outputJson.output_path)) {
      if (!allowLocalFallback) {
        const error = new Error('Generation image indisponible: fallback local bloque en production.');
        error.statusCode = 503;
        error.payload = buildSdBackendUnavailablePayload({
          reason: outputJson?.message || 'fallback local bloque en production',
          localFallbackBlocked: true,
        });
        throw error;
      }

      const openAiFallback = await tryGeneratePngWithOpenAI({
        prompt: finalPrompt,
        outputPath,
        width,
        height,
        userId: req?.user?.id || 'image-tool',
      });

      if (openAiFallback?.ok) {
        const localPublicUrl = buildGeneratedImageLocalPublicUrl(req, openAiFallback.outputPath || outputPath);
        const imageUrl = openAiFallback.sourceUrl || localPublicUrl || null;
        return {
          ok: true,
          url: imageUrl,
          image_url: imageUrl,
          output_path: openAiFallback.outputPath || outputPath,
          local_path: openAiFallback.outputPath || outputPath,
          filename: path.basename(openAiFallback.outputPath || outputPath),
          prompt: finalPrompt,
          num_inference_steps,
          guidance_scale,
          width,
          height,
          actual_width: width,
          actual_height: height,
          ...(initImage ? { init_image_url: initImage } : {}),
          ...buildStrengthPlanPayload(strengthPlan, strength),
          seed: seed !== undefined ? Number(seed) : undefined,
          mode: openAiFallback.mode || 'openai-image',
        };
      }

      console.error('[no_image] stdout:', outputJson?.stdout || '');
      console.error('[no_image] stderr:', outputJson?.stderr || '');
      console.error('[no_image] outputJson:', outputJson);
      console.error('[no_image] output_path:', outputJson?.output_path);
      console.error('[no_image] existsSync:', outputJson?.output_path ? fs.existsSync(outputJson.output_path) : 'no path');

      const error = new Error(openAiFallback?.message || outputJson?.message || 'Aucune image générée');
      error.statusCode = 503;
      error.payload = buildSdUnavailablePayload({
        localResult: outputJson,
        openAiResult: openAiFallback,
      });
      throw error;
    }

    try {
      const buffer = fs.readFileSync(outputJson.output_path);
      const filename = `sd_${Date.now()}.png`;
      const userId = req?.user?.id || 'image-tool';
      const uploadResult = await uploadBufferToR2({
        userId,
        filename,
        buffer,
        contentType: 'image/png',
      });
      const proxyOrigin = resolveRequestOrigin(req);
      const proxyUrl = (proxyOrigin && uploadResult?.storageKey)
        ? `${proxyOrigin}/api/public/r2/${String(uploadResult.storageKey)
          .split('/')
          .filter(Boolean)
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`
        : '';
      const resolvedPublicUrl = uploadResult.url || proxyUrl || null;
      try {
        fs.unlinkSync(outputJson.output_path);
      } catch {}

      return {
        ok: true,
        url: resolvedPublicUrl,
        image_url: resolvedPublicUrl,
        filename,
        storage_key: uploadResult.storageKey || null,
        prompt: finalPrompt,
        num_inference_steps,
        guidance_scale,
        width,
        height,
        actual_width: actualWidth,
        actual_height: actualHeight,
        ...(initImage ? { init_image_url: initImage } : {}),
        ...buildStrengthPlanPayload(strengthPlan, strength),
        seed: seed !== undefined ? Number(seed) : undefined,
        mode: 'stable-diffusion-local',
        size_policy: sizePolicy !== 'default' ? sizePolicy : null,
        device: outputJson.device || null,
        model_id: outputJson.model_id || null,
        torch_dtype: outputJson.torch_dtype || null,
        cuda_available: outputJson.cuda_available === true,
        cuda_device_name: outputJson.cuda_device_name || null,
        xformers_enabled: outputJson.xformers_enabled === true,
        init_image_used: outputJson.init_image_used === true,
        init_image_source: outputJson.init_image_source || null,
      };
    } catch (error_) {
      const outputFilePath = String(outputJson.output_path || '').trim();
      if (outputFilePath) {
        // Essayer d'abord via A11_RUNTIME_ROOT (/files/runtime/...)
        const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim();
        if (runtimeRoot) {
          const runtimeRelativePath = String(defaultPath.relative(runtimeRoot, outputFilePath) || '').replace(/\\/g, '/');
          if (runtimeRelativePath && !runtimeRelativePath.startsWith('..')) {
            const localPublicPath = `/files/runtime/${runtimeRelativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/')}`;
            const origin = resolveRequestOrigin(req);
            const resolvedLocalUrl = origin ? `${origin}${localPublicPath}` : localPublicPath;
            return {
              ok: true,
              url: resolvedLocalUrl,
              image_url: resolvedLocalUrl,
              output_path: outputFilePath,
              local_path: outputFilePath,
              filename: defaultPath.basename(outputFilePath),
              prompt: finalPrompt,
              num_inference_steps,
              guidance_scale,
              width,
              height,
              actual_width: actualWidth,
              actual_height: actualHeight,
              ...(initImage ? { init_image_url: initImage } : {}),
              ...buildStrengthPlanPayload(strengthPlan, strength),
              seed: seed !== undefined ? Number(seed) : undefined,
              mode: 'stable-diffusion-local',
              size_policy: sizePolicy !== 'default' ? sizePolicy : null,
              storage: 'local-file',
              device: outputJson.device || null,
              model_id: outputJson.model_id || null,
              torch_dtype: outputJson.torch_dtype || null,
              cuda_available: outputJson.cuda_available === true,
              cuda_device_name: outputJson.cuda_device_name || null,
              xformers_enabled: outputJson.xformers_enabled === true,
              init_image_used: outputJson.init_image_used === true,
              init_image_source: outputJson.init_image_source || null,
              upload_warning: String(error_?.message || error_),
            };
          }
        }

        // Fallback via A11_WORKSPACE_ROOT (/files/...)
        const publicWorkspaceRoot = resolvePublicWorkspaceRoot();
        const localRelativePath = String(defaultPath.relative(publicWorkspaceRoot, outputFilePath) || '').replace(/\\/g, '/');
        if (localRelativePath && !localRelativePath.startsWith('..')) {
          const localPublicPath = `/files/${localRelativePath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/')}`;
          const localPublicUrl = `${resolveRequestOrigin(req)}${localPublicPath}`;
          const resolvedLocalUrl = localPublicUrl.startsWith('http') ? localPublicUrl : localPublicPath;
          return {
            ok: true,
            url: resolvedLocalUrl,
            image_url: resolvedLocalUrl,
            output_path: outputFilePath,
            local_path: outputFilePath,
            filename: defaultPath.basename(outputFilePath || `sd_${Date.now()}.png`),
            prompt: finalPrompt,
            num_inference_steps,
            guidance_scale,
            width,
            height,
            actual_width: actualWidth,
            actual_height: actualHeight,
            ...(initImage ? { init_image_url: initImage } : {}),
            ...buildStrengthPlanPayload(strengthPlan, strength),
            seed: seed !== undefined ? Number(seed) : undefined,
            mode: 'stable-diffusion-local',
            size_policy: sizePolicy !== 'default' ? sizePolicy : null,
            storage: 'local-file',
            device: outputJson.device || null,
            model_id: outputJson.model_id || null,
            torch_dtype: outputJson.torch_dtype || null,
            cuda_available: outputJson.cuda_available === true,
            cuda_device_name: outputJson.cuda_device_name || null,
            xformers_enabled: outputJson.xformers_enabled === true,
            init_image_used: outputJson.init_image_used === true,
            init_image_source: outputJson.init_image_source || null,
            upload_warning: String(error_?.message || error_),
          };
        }
      }

      const error = new Error(String(error_?.message || error_));
      error.statusCode = 500;
      error.payload = { ok: false, error: 'upload_failed', message: error.message };
      throw error;
    }
  }

  async function generateImageInternal({ req, prompt, body = null }) {
    const requestBody = body || req?.body || {};
    const imageDimensionConfig = resolveImageDimensionConfig(process.env);
    const rawPrompt = String(prompt || requestBody?.prompt || '').trim();
    if (!rawPrompt) {
      const error = new Error('missing_prompt');
      error.statusCode = 400;
      throw error;
    }

    const width = Number(requestBody?.width || imageDimensionConfig.defaultWidth);
    const height = Number(requestBody?.height || imageDimensionConfig.defaultHeight);
    const hfConfig = resolveHuggingFaceImageConfig();
    const replicateConfig = resolveReplicateImageConfig();
    const pollinationsConfig = resolvePollinationsImageConfig();
    const openAiConfig = resolveOpenAiImageConfig();
    const providerOrder = resolveImageProviderOrder(requestBody);
    let lastFailure = null;

    const analyzeGeneratedImage = (imagePayload) => {
      const _vm = getVisionMemory();
      if (!_vm || !imagePayload?.ok || !(imagePayload.image_url || imagePayload.url)) return;
      const _imageLocator = imagePayload.image_url || imagePayload.url;
      const _userId = req?.user?.id || requestBody?.userId || 'unknown';
      const _convId = requestBody?.conversationId || requestBody?.conversation_id || '';
      setImmediate(() => {
        _vm.analyzeAndSave({
          imageLocator: _imageLocator,
          imageUrl: _imageLocator,
          prompt: rawPrompt || requestBody?.prompt || '',
          userId: _userId,
          conversationId: _convId,
          source: 'generated',
          runtimeRoot: process.env.A11_RUNTIME_ROOT,
          timeoutMs: 60000,
        }).catch(e => console.warn('[vision-memory] analyze failed:', e?.message));
      });
    };

    const recordFailure = (provider, payloadOrError, fallbackAllowed = true) => {
      const message = String(payloadOrError?.message || payloadOrError?.error || payloadOrError || `${provider}_failed`);
      lastFailure = {
        ok: false,
        provider,
        error: String(payloadOrError?.error || `${provider}_failed`),
        message,
      };
      if (fallbackAllowed) {
        console.warn(`[A11][generate_image] ${provider} failed, fallback to next provider:`, message);
      }
    };

    for (const provider of providerOrder) {
      if (provider === 'synthetic') {
        try {
          const emergencyResult = await createEmergencyImageAsset({
            prompt: rawPrompt,
            body: requestBody,
            req,
          });
          const payload = normalizeImageToolPayload({
            ...emergencyResult,
            mode: emergencyResult.mode || 'synthetic-frame',
            provider: emergencyResult.provider || 'a11-emergency-svg',
          }, 'synthetic-frame', { providerOrder });
          analyzeGeneratedImage(payload);
          return payload;
        } catch (error_) {
          recordFailure('synthetic-frame', error_, providerOrder.length > 1);
        }
        continue;
      }

      if (provider === 'sd') {
        try {
          const sdResult = normalizeImageToolPayload(
            await generateSdInternal({ req, prompt: rawPrompt, body: requestBody }),
            'sd'
          );
          if (isSuccessfulImagePayload(sdResult)) {
            analyzeGeneratedImage(sdResult);
            return sdResult;
          }
          recordFailure('sd', sdResult, providerOrder.length > 1);
        } catch (error_) {
          recordFailure('sd', error_, providerOrder.length > 1);
        }
        continue;
      }

      if (provider === 'hf') {
        if (!hfConfig.enabled || !hfConfig.token) {
          recordFailure('huggingface', {
            error: hfConfig.enabled ? 'hf_image_unconfigured' : 'hf_image_disabled',
            message: hfConfig.enabled
              ? 'HF_TOKEN manquant pour la generation image Hugging Face.'
              : 'La generation image Hugging Face est desactivee sur cet environnement.',
          }, providerOrder.length > 1);
          continue;
        }
        try {
          const tempDir = resolveGeneratedImageWorkRoot();
          fs.mkdirSync(tempDir, { recursive: true });
          const outputName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          const outputPath = path.join(tempDir, outputName);
          const hfResult = await tryGenerateImageWithHuggingFace({
            prompt: rawPrompt,
            outputPath,
            width,
            height,
            steps: requestBody?.num_inference_steps || requestBody?.steps,
            guidanceScale: requestBody?.guidance_scale,
            userId: req?.user?.id || 'image-tool',
          });
          if (hfResult?.ok) {
            const localPublicUrl = buildGeneratedImageLocalPublicUrl(req, hfResult.outputPath || outputPath);
            const imageUrl = hfResult.sourceUrl || localPublicUrl || null;
            const payload = normalizeImageToolPayload({
              ok: true,
              artifact_type: 'image',
              url: imageUrl,
              image_url: imageUrl,
              output_path: hfResult.outputPath || outputPath,
              local_path: hfResult.outputPath || outputPath,
              filename: path.basename(hfResult.outputPath || outputPath),
              prompt: rawPrompt,
              width: hfResult.width || width,
              height: hfResult.height || height,
              num_inference_steps: Number(requestBody?.num_inference_steps || requestBody?.steps || hfConfig.defaultSteps || 4),
              guidance_scale: Number(requestBody?.guidance_scale || 8),
              seed: requestBody?.seed !== undefined ? Number(requestBody.seed) : undefined,
              mode: hfResult.mode || 'huggingface-image',
              content_type: hfResult.contentType || 'image/jpeg',
            }, 'huggingface');
            analyzeGeneratedImage(payload);
            return payload;
          }
          recordFailure('huggingface', hfResult, providerOrder.length > 1);
        } catch (error_) {
          recordFailure('huggingface', error_, providerOrder.length > 1);
        }
        continue;
      }

      if (provider === 'replicate') {
        if (!replicateConfig.enabled || !replicateConfig.token) {
          recordFailure('replicate', {
            error: replicateConfig.enabled ? 'replicate_image_unconfigured' : 'replicate_image_disabled',
            message: replicateConfig.enabled
              ? 'REPLICATE_API_TOKEN manquant pour la generation image Replicate.'
              : 'La generation image Replicate est desactivee sur cet environnement.',
          }, providerOrder.length > 1);
          continue;
        }
        try {
          const tempDir = resolveGeneratedImageWorkRoot();
          fs.mkdirSync(tempDir, { recursive: true });
          const outputName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.webp`;
          const outputPath = path.join(tempDir, outputName);
          const replicateResult = await tryGenerateImageWithReplicate({
            prompt: rawPrompt,
            outputPath,
            width,
            height,
            steps: requestBody?.num_inference_steps || requestBody?.steps,
            userId: req?.user?.id || 'image-tool',
          });
          if (replicateResult?.ok) {
            const localPublicUrl = buildGeneratedImageLocalPublicUrl(req, replicateResult.outputPath || outputPath);
            const imageUrl = replicateResult.sourceUrl || localPublicUrl || null;
            const payload = normalizeImageToolPayload({
              ok: true,
              artifact_type: 'image',
              url: imageUrl,
              image_url: imageUrl,
              output_path: replicateResult.outputPath || outputPath,
              local_path: replicateResult.outputPath || outputPath,
              filename: path.basename(replicateResult.outputPath || outputPath),
              prompt: rawPrompt,
              width: replicateResult.width || width,
              height: replicateResult.height || height,
              num_inference_steps: Number(requestBody?.num_inference_steps || requestBody?.steps || replicateConfig.defaultSteps || 4),
              guidance_scale: Number(requestBody?.guidance_scale || 8),
              seed: requestBody?.seed !== undefined ? Number(requestBody.seed) : undefined,
              mode: replicateResult.mode || 'replicate-image',
              model: replicateResult.model || replicateConfig.model,
              prediction_id: replicateResult.predictionId || undefined,
              content_type: replicateResult.contentType || 'image/webp',
            }, 'replicate');
            analyzeGeneratedImage(payload);
            return payload;
          }
          recordFailure('replicate', replicateResult, providerOrder.length > 1);
        } catch (error_) {
          recordFailure('replicate', error_, providerOrder.length > 1);
        }
        continue;
      }

      if (provider === 'pollinations') {
        if (!pollinationsConfig.enabled) {
          recordFailure('pollinations', {
            error: 'pollinations_image_disabled',
            message: 'La generation image Pollinations est desactivee sur cet environnement.',
          }, providerOrder.length > 1);
          continue;
        }
        try {
          const tempDir = resolveGeneratedImageWorkRoot();
          fs.mkdirSync(tempDir, { recursive: true });
          const outputName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          const outputPath = path.join(tempDir, outputName);
          const pollinationsResult = await tryGenerateImageWithPollinations({
            prompt: rawPrompt,
            outputPath,
            width,
            height,
            seed: requestBody?.seed,
            userId: req?.user?.id || 'image-tool',
          });
          if (pollinationsResult?.ok) {
            const localPublicUrl = buildGeneratedImageLocalPublicUrl(req, pollinationsResult.outputPath || outputPath);
            const imageUrl = pollinationsResult.sourceUrl || localPublicUrl || null;
            const payload = normalizeImageToolPayload({
              ok: true,
              artifact_type: 'image',
              url: imageUrl,
              image_url: imageUrl,
              output_path: pollinationsResult.outputPath || outputPath,
              local_path: pollinationsResult.outputPath || outputPath,
              filename: path.basename(pollinationsResult.outputPath || outputPath),
              prompt: rawPrompt,
              width: pollinationsResult.width || width,
              height: pollinationsResult.height || height,
              seed: requestBody?.seed !== undefined ? Number(requestBody.seed) : undefined,
              mode: pollinationsResult.mode || 'pollinations-image',
              model: pollinationsResult.model || pollinationsConfig.model,
              content_type: pollinationsResult.contentType || 'image/jpeg',
            }, 'pollinations');
            analyzeGeneratedImage(payload);
            return payload;
          }
          recordFailure('pollinations', pollinationsResult, providerOrder.length > 1);
        } catch (error_) {
          recordFailure('pollinations', error_, providerOrder.length > 1);
        }
        continue;
      }

      if (provider === 'openai') {
        if (!openAiConfig.enabled || !openAiConfig.apiKey) {
          recordFailure('openai', {
            error: openAiConfig.enabled ? 'openai_image_unconfigured' : 'openai_image_disabled',
            message: openAiConfig.enabled
              ? 'Cle OpenAI image manquante.'
              : 'La generation image OpenAI est desactivee sur cet environnement.',
          }, providerOrder.length > 1);
          continue;
        }
        try {
          const tempDir = resolveGeneratedImageWorkRoot();
          fs.mkdirSync(tempDir, { recursive: true });
          const outputName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
          const outputPath = path.join(tempDir, outputName);
          const openAiResult = await tryGeneratePngWithOpenAI({
            prompt: rawPrompt,
            outputPath,
            width,
            height,
            userId: req?.user?.id || 'image-tool',
          });
          if (openAiResult?.ok) {
            const localPublicUrl = buildGeneratedImageLocalPublicUrl(req, openAiResult.outputPath || outputPath);
            const imageUrl = openAiResult.sourceUrl || localPublicUrl || null;
            const payload = normalizeImageToolPayload({
              ok: true,
              artifact_type: 'image',
              url: imageUrl,
              image_url: imageUrl,
              output_path: openAiResult.outputPath || outputPath,
              local_path: openAiResult.outputPath || outputPath,
              filename: path.basename(openAiResult.outputPath || outputPath),
              prompt: rawPrompt,
              width,
              height,
              num_inference_steps: Number(requestBody?.num_inference_steps || requestBody?.steps || 40),
              guidance_scale: Number(requestBody?.guidance_scale || 8),
              seed: requestBody?.seed !== undefined ? Number(requestBody.seed) : undefined,
              mode: openAiResult.mode || 'openai-image',
              content_type: 'image/png',
            }, 'openai');
            analyzeGeneratedImage(payload);
            return payload;
          }
          recordFailure('openai', openAiResult, providerOrder.length > 1);
        } catch (error_) {
          recordFailure('openai', error_, providerOrder.length > 1);
        }
      }
    }

    if (isEmergencyImageFallbackEnabled(requestBody)) {
      try {
        const emergencyResult = await createEmergencyImageAsset({
          prompt: rawPrompt,
          body: requestBody,
          req,
        });
        const payload = normalizeImageToolPayload({
          ...emergencyResult,
          mode: emergencyResult.mode || 'synthetic-frame',
          provider: emergencyResult.provider || 'a11-emergency-svg',
          warning: lastFailure?.error || undefined,
          message: lastFailure?.message || emergencyResult.message,
        }, 'synthetic-frame', { providerOrder });
        analyzeGeneratedImage(payload);
        return payload;
      } catch (error_) {
        recordFailure('synthetic-frame', error_, false);
      }
    }

    return normalizeImageToolPayload(lastFailure || {
      ok: false,
      provider: providerOrder[0] || 'sd',
      error: 'image_backend_unavailable',
      message: 'Aucun backend image disponible.',
    }, lastFailure?.provider || providerOrder[0] || 'sd', { providerOrder });


    // Vision Memory — analyse l'image générée en arrière-plan (fire-and-forget)
  }

  router.get('/tools/media_roles', (_req, res) => {
    res.json({
      ok: true,
      service: 'a11-media-orchestration',
      mediaAgentRoles: getMediaAgentRoleMatrix(),
      pipelines: {
        image: buildMediaPipeline('image'),
        audio: buildMediaPipeline('audio'),
        video: buildMediaPipeline('video', { withAudio: true }),
        song: buildMediaPipeline('song', { withAudio: true }),
      },
    });
  });

  router.post('/tools/generate_sd', express.json({ limit: '2mb' }), async (req, res) => {
    console.log('[DEBUG] Entrée dans /api/tools/generate_sd', {
      ip: req.ip,
      headers: redactHeadersForLog(req.headers),
      body: summarizeGenerateSdBodyForLog(req.body),
    });

    try {
      const result = await generateImageInternal({
        req,
        prompt: req.body?.prompt,
        body: req.body,
      });
      return res.json(result);
    } catch (error_) {
      console.error('[A11][generate_sd] failed:', error_?.message);
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || { ok: false, error: 'internal_error', message: String(error_?.message || error_) }
      );
    }
  });

  return {
    router,
    generateSdInternal,
    generateImageInternal,
  };
}

function looksLikeDependencyBag(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      'fs' in value
      || 'path' in value
      || 'fetch' in value
      || 'buildSdPromptBundle' in value
      || 'resolveSdProxyUrl' in value
      || 'resolveSdScriptPath' in value
      || 'runSdScript' in value
      || 'uploadBufferToR2' in value
      || 'isAdminRequest' in value
      || 'shouldAllowLocalSdFallback' in value
      || 'drainLocalGpuBeforeSd' in value
    )
  );
}

const defaultSdTools = createSdToolsRouter();

function sdToolsEntrypoint(...args) {
  if (args.length === 1 && looksLikeDependencyBag(args[0])) {
    return createSdToolsRouter(args[0]);
  }
  return defaultSdTools.router(...args);
}

sdToolsEntrypoint.router = defaultSdTools.router;
sdToolsEntrypoint.generateImageInternal = defaultSdTools.generateImageInternal;
sdToolsEntrypoint.generateSdInternal = defaultSdTools.generateSdInternal;
sdToolsEntrypoint.createSdToolsRouter = createSdToolsRouter;
sdToolsEntrypoint.buildSdBackendUnavailablePayload = buildSdBackendUnavailablePayload;

module.exports = sdToolsEntrypoint;

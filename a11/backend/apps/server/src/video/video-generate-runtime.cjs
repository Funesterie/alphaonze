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

function roundDimensionToMultiple(value, multiple = 64) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(multiple, Math.round(numeric / multiple) * multiple);
}

function resolveVideoFrameMaxSize(env = process.env) {
  const raw = env?.A11_VIDEO_FRAME_MAX_SIZE || env?.A11_VIDEO_MAX_RENDER_SIDE || 1024;
  return roundDimensionToMultiple(clampNumber(raw, 64, 4096, 1024));
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
  const maxRenderSide = resolveVideoFrameMaxSize(env);
  const minRenderSide = resolveVideoFrameMinSize(env, maxRenderSide);
  const hasExplicitMinRenderSide = Number.isFinite(Number(env.A11_VIDEO_MIN_RENDER_SIDE));
  const defaultRenderSide = localRuntime
    ? maxRenderSide
    : (hasExplicitMinRenderSide
        ? minRenderSide
        : Math.max(minRenderSide, Math.min(maxRenderSide, 1024)));
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
    frameInitStrength: clampNumber(env.A11_VIDEO_FRAME_INIT_STRENGTH, 0.05, 0.95, 0.28),
    useJanusFrameAnalysis: isTruthy(env.A11_VIDEO_USE_JANUS_FRAME_ANALYSIS),
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

function buildFramePrompt(basePrompt = '', { frameIndex = 0, frameCount = 1 } = {}) {
  const phase = frameCount <= 1
    ? 'single key frame'
    : (frameIndex === 0
      ? 'opening motion frame'
      : (frameIndex === frameCount - 1 ? 'ending motion frame' : 'mid-motion continuity frame'));
  return [
    String(basePrompt || '').trim(),
    'animated video frame',
    `frame ${frameIndex + 1} of ${frameCount}`,
    phase,
    'same main subject, consistent identity, consistent composition, cinematic continuity, smooth motion',
  ].filter(Boolean).join('. ');
}

function normalizeVideoRequest(body = {}, promptOverride = '') {
  const config = resolveVideoEnvConfig(process.env);
  const parsed = parseVideoGenerateRequest(promptOverride || body?.message || body?.prompt || '', body);
  const format = normalizeVideoFormat(parsed.format || body?.format || config.defaultFormat, config.defaultFormat);
  const durationSeconds = clampNumber(
    parsed.durationSeconds || body?.durationSeconds || body?.duration_seconds || body?.duration,
    1,
    config.maxDurationSeconds,
    config.defaultDurationSeconds
  );
  const fps = clampNumber(parsed.fps || body?.fps, 1, config.maxFps, config.defaultFps);
  function clampFrameDimension(val, fallback) {
    let n = Number(val);
    if (!Number.isFinite(n)) n = fallback;
    n = Math.round(n);
    if (n > 1 && n % 2 !== 0) n = n - 1;
    return Math.max(config.minRenderSide, Math.min(config.maxRenderSide, n));
  }
  const requestedWidth = Number(parsed.width || body?.width || config.defaultWidth);
  const requestedHeight = Number(parsed.height || body?.height || config.defaultHeight);
  const width = clampFrameDimension(requestedWidth, config.defaultWidth);
  const height = clampFrameDimension(requestedHeight, config.defaultHeight);
  if (requestedWidth !== undefined && width !== requestedWidth) {
    console.warn(`[A11][video-runtime] width requested=${requestedWidth} effective=${width} (clamp min=${config.minRenderSide} max=${config.maxRenderSide})`);
  }
  if (requestedHeight !== undefined && height !== requestedHeight) {
    console.warn(`[A11][video-runtime] height requested=${requestedHeight} effective=${height} (clamp min=${config.minRenderSide} max=${config.maxRenderSide})`);
  }
  const frameCount = Math.max(2, Math.min(config.maxRenderFrames, Math.round(durationSeconds * fps)));
  const prompt = String(parsed.prompt || promptOverride || body?.prompt || body?.message || '').trim();

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
    // Pour traçabilité
    requestedWidth,
    requestedHeight,
    VIDEO_FRAME_MAX_SIZE: config.maxRenderSide,
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

async function downloadBinary(url, fetchImpl = defaultFetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`video_frame_download_failed:${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
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
  if (explicitImageUrl) {
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

async function runFfmpegAssembly({
  ffmpegBin,
  fps,
  format,
  framesDir,
  outputPath,
  mp4Codec = 'libx264',
  mp4Preset = 'medium',
  mp4Quality = 19,
}) {
  const args = buildFfmpegAssemblyArgs({
    fps,
    format,
    framesDir,
    outputPath,
    mp4Codec,
    mp4Preset,
    mp4Quality,
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
}) {
  const inputPattern = path.join(framesDir, 'frame-%04d.png');
  return format === 'gif'
    ? ['-y', '-framerate', String(fps), '-i', inputPattern, outputPath]
    : (
      /_nvenc$/i.test(String(mp4Codec || ''))
        ? [
            '-y',
            '-framerate', String(fps),
            '-i', inputPattern,
            '-c:v', String(mp4Codec || 'h264_nvenc'),
            '-preset', String(mp4Preset || 'p5'),
            '-rc', 'vbr',
            '-cq', String(mp4Quality),
            '-b:v', '0',
            '-profile:v', 'high',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            outputPath,
          ]
        : [
            '-y',
            '-framerate', String(fps),
            '-i', inputPattern,
            '-c:v', String(mp4Codec || 'libx264'),
            '-preset', String(mp4Preset || 'medium'),
            '-crf', String(mp4Quality),
            '-pix_fmt', 'yuv420p',
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
  const runFfmpeg = overrides.runFfmpeg || runFfmpegAssembly;
  const ensureFfmpeg = overrides.ensureFfmpegAvailable || ensureFfmpegAvailable;

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

    console.log(
      `[A11][video] start prompt="${request.prompt}" duration=${request.durationSeconds}s fps=${request.fps} format=${request.format} frames=${request.frameCount} size=${request.width}x${request.height}`
    );

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
      imageRequestMode: 'raw',
    });
    const baseSdBody = {
      ...(compiledState?.sdBody && typeof compiledState.sdBody === 'object' ? compiledState.sdBody : {}),
      width: request.width,
      height: request.height,
    };

    const frames = [];
    let previousFrameUrl = '';
    let previousFramePath = '';
    let firstFrameAnalysis = null;
    const preferRemoteFrameReferences = hasSdProxyConfigured(process.env);
    const initialReference = await resolveInitialReferenceFrame({
      req,
      request,
      workingPaths,
      fetchImpl,
      uploadBufferToR2,
    });

    for (let frameIndex = 0; frameIndex < request.frameCount; frameIndex += 1) {
      const framePrompt = buildFramePrompt(baseSdBody.prompt || request.prompt, {
        frameIndex,
        frameCount: request.frameCount,
      });
      const frameBody = {
        ...baseSdBody,
        prompt: framePrompt,
        prompt_prebuilt: true,
        ...(baseSdBody.negative_prompt ? { negative_prompt: baseSdBody.negative_prompt, negative_prompt_prebuilt: true } : {}),
        num_inference_steps: request.config.sdSteps,
        guidance_scale: request.config.sdGuidanceScale,
        width: request.width,
        height: request.height,
        seed: Number(baseSdBody.seed || 0) ? Number(baseSdBody.seed) + frameIndex : undefined,
        ...(((frameIndex > 0 && (previousFramePath || previousFrameUrl)) || (frameIndex === 0 && (initialReference.initImagePath || initialReference.initImageUrl)))
          ? {
              init_image_url: frameIndex > 0
                ? resolveFrameReferenceCandidate({
                    preferRemoteReference: preferRemoteFrameReferences,
                    localPath: previousFramePath,
                    remoteUrl: previousFrameUrl,
                  })
                : resolveFrameReferenceCandidate({
                    preferRemoteReference: preferRemoteFrameReferences,
                    localPath: initialReference.initImagePath,
                    remoteUrl: initialReference.initImageUrl,
                  }),
              strength: request.config.frameInitStrength,
            }
          : {}),
      };

      console.log(`[A11][video] render frame ${frameIndex + 1}/${request.frameCount}`);
      const sdResult = await generateSd({
        req,
        prompt: framePrompt,
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
        // Log explicite pour traçabilité
        console.log(`[A11][video-runtime] Frame ${frameIndex + 1}/${request.frameCount} written: ${framePath} (${frameBuffer.length} bytes, ${request.width}x${request.height})`);
      } catch (err) {
        console.error(`[A11][video-runtime] Erreur lors de l'écriture de la frame ${frameIndex + 1}: ${err && err.message}`);
        throw err;
      }
      if (frameIndex === 0) {
        firstFrameAnalysis = await maybeDescribeFirstFrameWithJanus(framePath, 'image/png', request.config);
      }

      previousFrameUrl = frameUrl;
      previousFramePath = framePath;
      frames.push({
        index: frameIndex,
        prompt: framePrompt,
        url: frameUrl,
        path: framePath,
      });
    }

    const filename = ensureVideoFilename(request.format);
    const outputPath = path.join(workingPaths.jobRoot, filename);
    const ffmpegOptions = {
      ffmpegBin: request.config.ffmpegBin,
      fps: request.fps,
      format: request.format,
      framesDir: workingPaths.framesDir,
      outputPath,
      mp4Codec: request.config.mp4Codec,
      mp4Preset: request.config.mp4Preset,
      mp4Quality: request.config.mp4Quality,
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
      compiledPrompt: String(baseSdBody.prompt || request.prompt).trim(),
      negativePrompt: String(baseSdBody.negative_prompt || '').trim() || null,
      format: request.format,
      durationSeconds: request.durationSeconds,
      fps: request.fps,
      frameCount: request.frameCount,
      width: request.width,
      height: request.height,
      filename,
      url: videoUrl || null,
      video_url: videoUrl || null,
      outputPath,
      firstFrameAnalysis,
      sourceMode: initialReference.sourceMode || null,
      frames: frames.map((frame) => ({
        index: frame.index,
        url: frame.url,
      })),
    };
  };
}

module.exports = {
  buildVideoAssistantMessage,
  buildFfmpegAssemblyArgs,
  createGenerateVideoHandler,
  ensureFfmpegAvailable,
  normalizeVideoRequest,
  resolveVideoEnvConfig,
  runFfmpegAssembly,
  toVideoChatProxyPayload,
};

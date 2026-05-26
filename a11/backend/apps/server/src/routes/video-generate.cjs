const express = require('express');
const crypto = require('node:crypto');

const sdToolsModule = require('./sd-tools.cjs');
const {
  createGenerateVideoHandler,
} = require('../video/video-generate-runtime.cjs');
const {
  createEmergencyVideoAsset,
} = require('../media/emergency-media.cjs');

function normalizeProxyUrl(rawValue = '') {
  const value = String(rawValue || '').trim();
  return value ? value.replace(/\/+$/, '') : '';
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

function resolveVideoProxyUrl() {
  return normalizeProxyUrl(
    process.env.A11_VIDEO_PROXY_URL
    || process.env.VIDEO_PROXY_URL
    || ''
  );
}

function resolveVideoProxyTimeoutMs() {
  const numeric = Number(process.env.A11_VIDEO_PROXY_TIMEOUT_MS || process.env.VIDEO_PROXY_TIMEOUT_MS || 600000);
  if (!Number.isFinite(numeric)) return 600000;
  return Math.max(1000, Math.min(3600000, Math.round(numeric)));
}

function resolveVideoPublicFileBaseUrl(req = null) {
  const explicit = normalizeProxyUrl(
    process.env.A11_VIDEO_PUBLIC_FILE_BASE_URL
    || process.env.A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL
    || ''
  );
  if (explicit) return explicit;

  const publicOrigin = resolvePublicApiOrigin(req);
  return publicOrigin ? `${publicOrigin}/files/runtime/files/generated/videos` : '';
}

const ASYNC_VIDEO_JOB_TTL_MS = Math.max(
  60_000,
  Math.min(
    3_600_000,
    Math.round(Number(process.env.A11_VIDEO_ASYNC_JOB_TTL_MS || process.env.A11_ASYNC_JOB_TTL_MS || 1_200_000) || 1_200_000)
  )
);
const ASYNC_VIDEO_JOB_POLL_INTERVAL_MS = Math.max(
  1_000,
  Math.min(
    30_000,
    Math.round(Number(process.env.A11_VIDEO_ASYNC_POLL_INTERVAL_MS || process.env.A11_ASYNC_POLL_INTERVAL_MS || 4_000) || 4_000)
  )
);
const asyncVideoJobs = new Map();

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isFalsey(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function shouldUseEmergencyVideoFirst(body = {}) {
  if (body?.forceRealVideo === true || isTruthy(body?.forceRealVideo)) return false;
  if (body?.disableEmergencyVideo === true || isTruthy(body?.disableEmergencyVideo)) return false;
  if (body?.emergencyVideo === true || isTruthy(body?.emergencyVideo)) return true;
  const configured = process.env.A11_VIDEO_EMERGENCY_MODE || process.env.A11_EMERGENCY_MEDIA_MODE;
  if (configured === undefined || String(configured || '').trim() === '') return false;
  if (isFalsey(configured)) return false;
  if (isTruthy(configured)) return true;
  return false;
}

function shouldFallbackToEmergencyVideo(body = {}) {
  if (body?.disableEmergencyVideo === true || isTruthy(body?.disableEmergencyVideo)) return false;
  const configured = process.env.A11_VIDEO_EMERGENCY_FALLBACK;
  if (configured === undefined || String(configured || '').trim() === '') return false;
  if (isFalsey(configured)) return false;
  return isTruthy(configured);
}

function isAsyncVideoJobRequested(body = {}) {
  return body?.acceptAsyncVideoJob === true
    || body?.acceptAsyncJob === true
    || body?.mobileAsync === true
    || body?.async === true
    || isTruthy(body?.acceptAsyncVideoJob)
    || isTruthy(body?.acceptAsyncJob)
    || isTruthy(body?.mobileAsync)
    || isTruthy(body?.async);
}

function buildAsyncVideoJobPath(jobId = '') {
  return `/api/video/jobs/${encodeURIComponent(String(jobId || '').trim())}`;
}

function cleanupExpiredVideoJobs() {
  const now = Date.now();
  for (const [jobId, job] of asyncVideoJobs.entries()) {
    const updatedAt = Number(job?.updatedAt || job?.createdAt || 0);
    if (!updatedAt || now - updatedAt > ASYNC_VIDEO_JOB_TTL_MS) {
      asyncVideoJobs.delete(jobId);
    }
  }
}

function buildAsyncVideoJobEnvelope(job = {}) {
  const jobId = String(job.id || '').trim();
  const status = String(job.status || 'pending').trim() || 'pending';
  const pollIntervalMs = Number(job.pollIntervalMs || ASYNC_VIDEO_JOB_POLL_INTERVAL_MS);
  return {
    id: jobId,
    jobId,
    kind: 'video.generate',
    status,
    poll_url: buildAsyncVideoJobPath(jobId),
    pollUrl: buildAsyncVideoJobPath(jobId),
    pollIntervalMs,
    maxPollAttempts: Number(job.maxPollAttempts || Math.max(1, Math.floor(ASYNC_VIDEO_JOB_TTL_MS / pollIntervalMs))),
    maxWaitMs: Number(job.maxWaitMs || ASYNC_VIDEO_JOB_TTL_MS),
    createdAt: Number(job.createdAt || Date.now()),
    updatedAt: Number(job.updatedAt || job.createdAt || Date.now()),
    completedAt: Number(job.completedAt || 0) || null,
    strategy: 'bat-sleep/rome-poll',
    mobileScreenSleepSafe: true,
  };
}

function serializeAsyncVideoJob(job = {}) {
  const asyncJob = buildAsyncVideoJobEnvelope(job);
  if (asyncJob.status === 'done') {
    return {
      ok: true,
      jobId: asyncJob.jobId,
      status: asyncJob.status,
      poll_url: asyncJob.poll_url,
      pollUrl: asyncJob.pollUrl,
      pollIntervalMs: asyncJob.pollIntervalMs,
      maxWaitMs: asyncJob.maxWaitMs,
      createdAt: asyncJob.createdAt,
      updatedAt: asyncJob.updatedAt,
      completedAt: asyncJob.completedAt,
      asyncJob,
      result: job.result || null,
    };
  }

  if (asyncJob.status === 'error') {
    return {
      ok: false,
      jobId: asyncJob.jobId,
      status: asyncJob.status,
      poll_url: asyncJob.poll_url,
      pollUrl: asyncJob.pollUrl,
      pollIntervalMs: asyncJob.pollIntervalMs,
      maxWaitMs: asyncJob.maxWaitMs,
      error: String(job.error || 'video_job_failed'),
      message: String(job.message || job.error || 'video_job_failed'),
      createdAt: asyncJob.createdAt,
      updatedAt: asyncJob.updatedAt,
      completedAt: asyncJob.completedAt,
      asyncJob,
    };
  }

  return {
    ok: true,
    jobId: asyncJob.jobId,
    status: asyncJob.status,
    poll_url: asyncJob.poll_url,
    pollUrl: asyncJob.pollUrl,
    pollIntervalMs: asyncJob.pollIntervalMs,
    maxWaitMs: asyncJob.maxWaitMs,
    createdAt: asyncJob.createdAt,
    updatedAt: asyncJob.updatedAt,
    asyncJob,
  };
}

function snapshotRequestForAsyncJob(req) {
  return {
    body: { ...(req?.body || {}) },
    headers: { ...(req?.headers || {}) },
    protocol: req?.protocol,
    socket: { encrypted: Boolean(req?.socket?.encrypted) },
    user: req?.user || null,
  };
}

function resolveSdPublicFileBaseUrl(req = null) {
  const explicit = normalizeProxyUrl(
    process.env.A11_SD_PUBLIC_FILE_BASE_URL
    || process.env.A11_VIDEO_PUBLIC_FILE_BASE_URL
    || process.env.A11_VIDEO_PROXY_PUBLIC_FILE_BASE_URL
    || ''
  );
  if (explicit) return explicit;

  const publicOrigin = resolvePublicApiOrigin(req);
  return publicOrigin ? `${publicOrigin}/files/runtime/files/generated/images` : '';
}

function resolveRequestOrigin(req = null) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req?.protocol || (req?.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(
    req?.headers?.['x-forwarded-host']
    || req?.headers?.host
    || ''
  ).split(',')[0].trim();
  return forwardedHost ? `${proto || 'http'}://${forwardedHost}` : '';
}

function resolvePublicApiOrigin(req = null) {
  const explicit = normalizeProxyUrl(
    process.env.PUBLIC_API_URL
    || process.env.API_URL
    || process.env.A11_SERVER_URL
    || ''
  );
  if (explicit) return explicit;
  return normalizeProxyUrl(resolveRequestOrigin(req));
}

function isLocalishHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  return host === '127.0.0.1'
    || host === 'localhost'
    || host === '::1'
    || host === '[::1]'
    || host === '0.0.0.0'
    || host === 'host.containers.internal'
    || host === 'host.docker.internal'
    || host.endsWith('.internal');
}

function rewritePublicFilesUrl(value = '', req = null) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  const publicOrigin = resolvePublicApiOrigin(req);
  if (!publicOrigin) return raw;

  try {
    const parsed = new URL(raw);
    if (!parsed.pathname.startsWith('/files/')) return raw;
    if (/^\/files\/generated\//i.test(parsed.pathname)) return raw;
    if (!isLocalishHost(parsed.hostname) && !/^http:$/i.test(parsed.protocol)) return raw;
    return `${publicOrigin}${parsed.pathname}${parsed.search || ''}`;
  } catch {
    if (!raw.startsWith('/files/')) return raw;
    if (/^\/files\/generated\//i.test(raw)) return raw;
    return `${publicOrigin}${raw}`;
  }
}

function encodePathSegments(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function extractGeneratedVideoRelativePath(value = '') {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  const marker = '/files/generated/videos/';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }

  const fallbackMarker = '/generated/videos/';
  const fallbackIndex = normalized.toLowerCase().indexOf(fallbackMarker);
  if (fallbackIndex >= 0) {
    return normalized.slice(fallbackIndex + fallbackMarker.length);
  }

  return '';
}

function extractGeneratedImageRelativePath(value = '') {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized) return '';
  const marker = '/files/generated/images/';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length);
  }

  const runtimeMarker = '/runtime/files/generated/images/';
  const runtimeIndex = normalized.toLowerCase().indexOf(runtimeMarker);
  if (runtimeIndex >= 0) {
    return normalized.slice(runtimeIndex + runtimeMarker.length);
  }

  const fallbackMarker = '/generated/images/';
  const fallbackIndex = normalized.toLowerCase().indexOf(fallbackMarker);
  if (fallbackIndex >= 0) {
    return normalized.slice(fallbackIndex + fallbackMarker.length);
  }

  return '';
}

function buildPublicVideoUrlFromPath(value = '', req = null) {
  const rewrittenFilesUrl = rewritePublicFilesUrl(value, req);
  if (rewrittenFilesUrl && rewrittenFilesUrl !== String(value || '').trim()) return rewrittenFilesUrl;

  const baseUrl = resolveVideoPublicFileBaseUrl(req);
  if (!baseUrl) return '';
  const relativePath = extractGeneratedVideoRelativePath(value);
  const encodedPath = encodePathSegments(relativePath);
  return encodedPath ? `${baseUrl}/${encodedPath}` : '';
}

function rewriteSdProxyFileUrl(value = '', req = null) {
  const rewrittenFilesUrl = rewritePublicFilesUrl(value, req);
  if (rewrittenFilesUrl && rewrittenFilesUrl !== String(value || '').trim()) return rewrittenFilesUrl;

  const baseUrl = resolveSdPublicFileBaseUrl(req);
  const raw = String(value || '').trim();
  if (!baseUrl || !raw) return raw;

  try {
    const parsed = new URL(raw);
    if (!parsed.pathname.startsWith('/files/')) return raw;
    const relativePath = extractGeneratedImageRelativePath(parsed.pathname);
    const encodedPath = encodePathSegments(relativePath);
    if (encodedPath) return `${baseUrl}/${encodedPath}${parsed.search || ''}`;
    const rewrittenPath = parsed.pathname.replace(/^\/files\/?/, '/');
    const fallbackPath = encodePathSegments(decodeURIComponent(rewrittenPath));
    return fallbackPath ? `${baseUrl}/${fallbackPath}${parsed.search || ''}` : baseUrl;
  } catch {
    const relativePath = extractGeneratedImageRelativePath(raw);
    const encodedPath = encodePathSegments(relativePath);
    return encodedPath ? `${baseUrl}/${encodedPath}` : raw;
  }
}

function firstPublicVideoUrlFromPayload(payload = {}, req = null) {
  const candidates = [
    payload.outputPath,
    payload.output_path,
    payload.local_path,
    payload.localPath,
    payload.path,
    payload.file_path,
    payload.video_path,
    payload.videoPath,
    payload.url,
    payload.video_url,
    payload.videoUrl,
    payload.download_url,
    payload.downloadUrl,
    payload.file_url,
    payload.fileUrl,
  ];

  for (const candidate of candidates) {
    const rewritten = buildPublicVideoUrlFromPath(candidate, req);
    if (rewritten) return rewritten;
  }
  return '';
}

function rewriteVideoProxyPayload(payload, req = null) {
  if (!payload || typeof payload !== 'object') return payload;

  const publicVideoUrl = firstPublicVideoUrlFromPayload(payload, req);
  if (publicVideoUrl) {
    payload.url = publicVideoUrl;
    payload.video_url = publicVideoUrl;
    payload.videoUrl = publicVideoUrl;
  }

  if (Array.isArray(payload.frames)) {
    payload.frames = payload.frames.map((frame) => {
      if (!frame || typeof frame !== 'object') return frame;
      const rewrittenFrameUrl = rewriteSdProxyFileUrl(
        frame.url
        || frame.image_url
        || frame.imageUrl
        || frame.outputPath
        || frame.output_path
        || frame.local_path
        || frame.localPath
        || frame.path
        || '',
        req
      );
      return {
        ...frame,
        url: rewrittenFrameUrl,
        image_url: rewrittenFrameUrl,
        imageUrl: rewrittenFrameUrl,
      };
    });
  }

  return payload;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function resolveProxyDefaultNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function withProxyDefaults(body = {}, prompt = '') {
  const nextBody = { ...(body || {}) };
  if (!nextBody.prompt && prompt) nextBody.prompt = prompt;
  if (!nextBody.message && prompt) nextBody.message = prompt;

  const defaults = {
    durationSeconds: clampNumber(
      resolveProxyDefaultNumber(process.env.A11_VIDEO_PROXY_DEFAULT_DURATION_SEC, process.env.A11_VIDEO_DEFAULT_DURATION_SEC, 4),
      3,
      30,
      4
    ),
    fps: clampNumber(
      resolveProxyDefaultNumber(process.env.A11_VIDEO_PROXY_DEFAULT_FPS, process.env.A11_VIDEO_DEFAULT_FPS, 3),
      3,
      30,
      3
    ),
    width: clampNumber(
      resolveProxyDefaultNumber(process.env.A11_VIDEO_PROXY_DEFAULT_WIDTH, process.env.A11_VIDEO_DEFAULT_WIDTH, 384),
      128,
      2048,
      384
    ),
    height: clampNumber(
      resolveProxyDefaultNumber(process.env.A11_VIDEO_PROXY_DEFAULT_HEIGHT, process.env.A11_VIDEO_DEFAULT_HEIGHT, 384),
      128,
      2048,
      384
    ),
    format: String(process.env.A11_VIDEO_PROXY_DEFAULT_FORMAT || process.env.A11_VIDEO_DEFAULT_FORMAT || 'mp4').trim() || 'mp4',
  };
  const timingMode = String(nextBody.timingMode || nextBody.timing_mode || '').trim().toLowerCase();
  const hasManualTiming = Boolean(
    Number(nextBody.durationSeconds || nextBody.duration_seconds || nextBody.duration)
    || Number(nextBody.fps)
    || Number(nextBody.frameCount || nextBody.frame_count || nextBody.frames)
  );
  if (!hasManualTiming || timingMode === 'auto') {
    nextBody.timingMode = nextBody.timingMode || 'auto';
    nextBody.autoTiming = nextBody.autoTiming !== undefined ? nextBody.autoTiming : true;
    nextBody.allowAutoTiming = nextBody.allowAutoTiming !== undefined ? nextBody.allowAutoTiming : true;
  }

  if (!Number(nextBody.durationSeconds || nextBody.duration_seconds || nextBody.duration)) {
    nextBody.durationSeconds = defaults.durationSeconds;
  }
  if (!Number(nextBody.fps)) nextBody.fps = defaults.fps;
  if (!Number(nextBody.width)) nextBody.width = defaults.width;
  if (!Number(nextBody.height)) nextBody.height = defaults.height;
  if (!nextBody.format && !nextBody.outputFormat) nextBody.format = defaults.format;

  return nextBody;
}

function createVideoGenerateRouter(overrides = {}) {
  const router = express.Router();
  const localGenerateVideoInternal = overrides.generateVideo || createGenerateVideoHandler({
    generateSd: overrides.generateSd || sdToolsModule.generateImageInternal || sdToolsModule.generateSdInternal,
    fetch: overrides.fetch,
    uploadBufferToR2: overrides.uploadBufferToR2,
    buildCanonicalImageMaskFromText: overrides.buildCanonicalImageMaskFromText,
    compileMaskImageGenerateRuntime: overrides.compileMaskImageGenerateRuntime,
    runFfmpeg: overrides.runFfmpeg,
  });
  const fetchImpl = overrides.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  async function generateViaProxy({ req = null, body = {}, prompt = '' } = {}) {
    const videoProxyUrl = resolveVideoProxyUrl();
    if (!videoProxyUrl) return null;
    if (typeof fetchImpl !== 'function') {
      const error = new Error('fetch_unavailable_for_video_proxy');
      error.statusCode = 500;
      error.payload = {
        ok: false,
        error: 'video_proxy_fetch_unavailable',
        message: 'fetch_unavailable_for_video_proxy',
      };
      throw error;
    }

    const proxyBody = withProxyDefaults(body, prompt);
    const proxyResponse = await fetchImpl(videoProxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAiServiceAuthHeaders(),
      },
      body: JSON.stringify(proxyBody),
      signal: AbortSignal.timeout(resolveVideoProxyTimeoutMs()),
    });
    const text = await proxyResponse.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!proxyResponse.ok) {
      const error = new Error(text || `video_proxy_status_${proxyResponse.status}`);
      error.statusCode = proxyResponse.status || 502;
      error.payload = payload || {
        ok: false,
        error: 'video_proxy_failed',
        message: text || `video_proxy_status_${proxyResponse.status}`,
      };
      throw error;
    }

    return rewriteVideoProxyPayload(payload || {
      ok: true,
      proxied: true,
      raw: text,
    }, req);
  }

  async function generateVideoInternal(options = {}) {
    const body = options.body || options.req?.body || {};
    const prompt = options.prompt || body.prompt || body.message || '';
    if (shouldUseEmergencyVideoFirst(body)) {
      return createEmergencyVideoAsset({
        prompt,
        body,
        req: options.req || null,
      });
    }

    const proxied = await generateViaProxy({
      req: options.req || null,
      body,
      prompt,
    });
    if (proxied) return proxied;

    try {
      return await localGenerateVideoInternal(options);
    } catch (error_) {
      if (!shouldFallbackToEmergencyVideo(body)) throw error_;
      console.error('[A11][video-route] emergency fallback after local failure:', String(error_?.message || error_));
      return createEmergencyVideoAsset({
        prompt,
        body,
        req: options.req || null,
      });
    }
  }

  function startAsyncVideoJob(req) {
    cleanupExpiredVideoJobs();
    const body = { ...(req.body || {}) };
    const prompt = body.prompt || body.message || '';
    const pollIntervalMs = Math.max(
      1000,
      Math.min(30000, Math.round(Number(body.pollIntervalMs || body.poll_interval_ms || ASYNC_VIDEO_JOB_POLL_INTERVAL_MS) || ASYNC_VIDEO_JOB_POLL_INTERVAL_MS))
    );
    const maxWaitMs = Math.max(
      pollIntervalMs,
      Math.min(
        ASYNC_VIDEO_JOB_TTL_MS,
        Math.round(Number(body.maxWaitMs || body.max_wait_ms || body.clientMaxWaitMs || ASYNC_VIDEO_JOB_TTL_MS) || ASYNC_VIDEO_JOB_TTL_MS)
      )
    );
    const jobId = `vjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const job = {
      id: jobId,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pollIntervalMs,
      maxPollAttempts: Math.max(1, Math.floor(maxWaitMs / pollIntervalMs)),
      maxWaitMs,
    };
    asyncVideoJobs.set(jobId, job);

    const reqSnapshot = snapshotRequestForAsyncJob(req);
    Promise.resolve().then(async () => {
      const runningJob = asyncVideoJobs.get(jobId);
      if (runningJob) {
        runningJob.status = 'running';
        runningJob.updatedAt = Date.now();
      }
      const result = await generateVideoInternal({
        req: reqSnapshot,
        prompt,
        body,
      });
      asyncVideoJobs.set(jobId, {
        ...job,
        status: 'done',
        result,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
    }).catch((error_) => {
      console.error('[A11][video-job] generation failed:', String(error_?.stack || error_?.message || error_));
      asyncVideoJobs.set(jobId, {
        ...job,
        status: 'error',
        error: String(error_?.message || error_ || 'video_job_failed'),
        message: String(error_?.message || error_ || 'video_job_failed'),
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
    });

    return serializeAsyncVideoJob(job);
  }

  async function handleGenerate(req, res) {
    try {
      if (isAsyncVideoJobRequested(req.body || {})) {
        return res.status(202).json(startAsyncVideoJob(req));
      }

      const result = await generateVideoInternal({
        req,
        prompt: req.body?.prompt || req.body?.message || '',
        body: req.body || {},
      });
      return res.json(result);
    } catch (error_) {
      console.error('[A11][video-route] generation failed:', String(error_?.stack || error_?.message || error_));
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || {
          ok: false,
          error: 'video_generation_failed',
          message: String(error_?.message || error_),
        }
      );
    }
  }

  function handleJobStatus(req, res) {
    cleanupExpiredVideoJobs();
    const jobId = String(req.params?.jobId || '').trim();
    const job = asyncVideoJobs.get(jobId);
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: 'video_job_not_found',
        message: 'video_job_not_found',
        jobId,
      });
    }
    return res.json(serializeAsyncVideoJob(job));
  }

  router.post('/video/generate', express.json({ limit: '4mb' }), handleGenerate);
  router.post('/tools/generate_video', express.json({ limit: '4mb' }), handleGenerate);
  router.get('/video/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'a11-video',
      proxyConfigured: Boolean(resolveVideoProxyUrl()),
      emergencyMode: shouldUseEmergencyVideoFirst({}),
      emergencyFallback: shouldFallbackToEmergencyVideo({}),
      asyncJobs: asyncVideoJobs.size,
    });
  });
  router.get('/video/status', (_req, res) => {
    res.json({
      ok: true,
      service: 'a11-video',
      modes: ['generate', 'async-job', 'emergency-video'],
      proxyConfigured: Boolean(resolveVideoProxyUrl()),
      emergencyMode: shouldUseEmergencyVideoFirst({}),
      asyncJobs: asyncVideoJobs.size,
    });
  });
  router.get('/video/jobs/:jobId', handleJobStatus);
  router.get('/tools/video_jobs/:jobId', handleJobStatus);

  return {
    router,
    generateVideoInternal,
  };
}

function looksLikeDependencyBag(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      'generateSd' in value
      || 'generateVideo' in value
      || 'fetch' in value
      || 'uploadBufferToR2' in value
      || 'buildCanonicalImageMaskFromText' in value
      || 'compileMaskImageGenerateRuntime' in value
      || 'runFfmpeg' in value
    )
  );
}

const defaultVideoRouter = createVideoGenerateRouter();

function videoGenerateEntrypoint(...args) {
  if (args.length === 1 && looksLikeDependencyBag(args[0])) {
    return createVideoGenerateRouter(args[0]);
  }
  return defaultVideoRouter.router(...args);
}

videoGenerateEntrypoint.router = defaultVideoRouter.router;
videoGenerateEntrypoint.generateVideoInternal = defaultVideoRouter.generateVideoInternal;
videoGenerateEntrypoint.createVideoGenerateRouter = createVideoGenerateRouter;

module.exports = videoGenerateEntrypoint;

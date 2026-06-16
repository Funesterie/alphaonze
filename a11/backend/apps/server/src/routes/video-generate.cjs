const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sdToolsModule = require('./sd-tools.cjs');
const {
  createGenerateVideoHandler,
} = require('../video/video-generate-runtime.cjs');
const {
  createEmergencyVideoAsset,
} = require('../media/emergency-media.cjs');
const {
  buildVideoPrompt,
} = require('../video/video-prompt-builder.cjs');
const {
  tryGenerateVideoWithHuggingFace,
  resolveHuggingFaceVideoConfig,
} = require('../../lib/hf-video.cjs');
const {
  tryGenerateVideoWithXai,
  resolveXaiVideoConfig,
} = require('../../lib/xai-video.cjs');
const {
  resolveMcpAccountProfileSync,
} = require('../auth/mcp-account-tier.cjs');

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

function getRequestHeader(req = null, name = '') {
  const headers = req?.headers || {};
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return '';
  const value = headers[normalized] ?? headers[name];
  if (Array.isArray(value)) return String(value.find(Boolean) || '').trim();
  return String(value || '').trim();
}

function sanitizeSessionProviderToken(value = '') {
  const token = String(value || '').trim();
  if (!token || token.length > 8192) return '';
  return token;
}

function resolveSessionVideoTokens(req = null, body = {}) {
  return {
    huggingface: sanitizeSessionProviderToken(
      body.sessionHuggingFaceVideoKey
      || body.sessionHuggingFaceKey
      || body.sessionHfVideoKey
      || body.sessionHfKey
      || getRequestHeader(req, 'x-a11-hf-video-key')
      || getRequestHeader(req, 'x-a11-huggingface-key')
      || getRequestHeader(req, 'x-huggingface-token')
      || getRequestHeader(req, 'x-hf-token')
    ),
    runcomfy: sanitizeSessionProviderToken(
      body.sessionRunComfyKey
      || body.sessionRuncomfyKey
      || body.sessionComfyKey
      || getRequestHeader(req, 'x-a11-runcomfy-key')
      || getRequestHeader(req, 'x-runcomfy-api-key')
      || getRequestHeader(req, 'x-a11-comfy-key')
      || getRequestHeader(req, 'x-comfy-api-key')
    ),
    xai: sanitizeSessionProviderToken(
      body.sessionXaiKey
      || body.sessionGrokKey
      || getRequestHeader(req, 'x-a11-xai-key')
      || getRequestHeader(req, 'x-a11-grok-key')
      || getRequestHeader(req, 'x-xai-api-key')
      || getRequestHeader(req, 'x-grok-api-key')
    ),
    civitai: sanitizeSessionProviderToken(
      body.sessionCivitaiKey
      || getRequestHeader(req, 'x-a11-civitai-key')
      || getRequestHeader(req, 'x-civitai-token')
    ),
    replicate: sanitizeSessionProviderToken(
      body.sessionReplicateKey
      || getRequestHeader(req, 'x-a11-replicate-key')
      || getRequestHeader(req, 'x-replicate-api-token')
    ),
  };
}

function normalizeVideoProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['grok', 'grok-imagine', 'xai', 'x-ai'].includes(normalized)) return 'xai';
  if (['hf', 'hugging-face', 'huggingface'].includes(normalized)) return 'huggingface';
  if (['run-comfy', 'runcomfy', 'comfy', 'comfyui', 'comfy-ui'].includes(normalized)) return 'runcomfy';
  return normalized;
}

function resolveRequestedVideoProvider(body = {}, req = null) {
  return normalizeVideoProvider(
    body.videoProvider
    || body.provider
    || body.video_provider
    || body.generator
    || getRequestHeader(req, 'x-a11-video-provider')
  );
}

function isXaiVideoProvider(provider = '') {
  return normalizeVideoProvider(provider) === 'xai';
}

function isHuggingFaceVideoProvider(provider = '') {
  return ['huggingface', 'replicate'].includes(normalizeVideoProvider(provider));
}

function isRunComfyVideoProvider(provider = '') {
  return normalizeVideoProvider(provider) === 'runcomfy';
}

function hasVideoReferenceImage(body = {}) {
  return Boolean(
    body?.sourceImageUrl
    || body?.source_image_url
    || body?.referenceImageUrl
    || body?.reference_image_url
    || body?.initImageUrl
    || body?.init_image_url
    || body?.imageUrl
    || body?.image_url
  );
}

function canUseServerPaidVideo(req = null) {
  if (isTruthy(process.env.A11_VIDEO_SERVER_CLOUD_OPEN)) return true;
  if (!req?.user) return false;
  const profile = resolveMcpAccountProfileSync(req.user || {});
  return ['premium', 'founder', 'admin_family'].includes(String(profile?.tier || '').trim().toLowerCase());
}

function buildPaidVideoDeniedPayload(provider = 'video') {
  return {
    ok: false,
    error: 'paid_video_demo_required',
    message: 'Generation video cloud reservee aux comptes Famille/Premium/Fondateur, sauf si tu ajoutes ta propre cle API dans les reglages de session.',
    provider,
  };
}

function buildAiServiceAuthHeaders(req = null, body = {}) {
  const videoProxyToken = firstConfiguredToken(
    process.env.A11_VIDEO_PROXY_TOKEN,
    process.env.A11_VIDEO_BRIDGE_TOKEN,
    process.env.VIDEO_PROXY_TOKEN
  );
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
  if (videoProxyToken) headers['x-a11-video-token'] = videoProxyToken;
  if (serviceToken || videoProxyToken) headers['x-nez-token'] = serviceToken || videoProxyToken;
  if (adminToken) headers['x-nez-admin-token'] = adminToken;
  const sessionTokens = resolveSessionVideoTokens(req, body);
  if (sessionTokens.runcomfy) {
    headers['x-a11-runcomfy-key'] = sessionTokens.runcomfy;
    headers['x-runcomfy-api-key'] = sessionTokens.runcomfy;
  }
  if (sessionTokens.huggingface) {
    headers['x-a11-hf-video-key'] = sessionTokens.huggingface;
    headers['x-huggingface-token'] = sessionTokens.huggingface;
  }
  if (sessionTokens.xai) {
    headers['x-a11-xai-key'] = sessionTokens.xai;
    headers['x-xai-api-key'] = sessionTokens.xai;
  }
  if (sessionTokens.civitai) headers['x-a11-civitai-key'] = sessionTokens.civitai;
  if (sessionTokens.replicate) headers['x-a11-replicate-key'] = sessionTokens.replicate;
  return headers;
}

function resolveLocalRunnerUrl() {
  return normalizeProxyUrl(
    process.env.A11_VIDEO_LOCAL_RUNNER_URL
    || process.env.A11_MOCHI_RUNNER_URL
    || ''
  );
}

function resolvePlatformCloudUrl() {
  return normalizeProxyUrl(
    process.env.A11_VIDEO_PROXY_URL
    || process.env.VIDEO_PROXY_URL
    || ''
  );
}

function resolveVideoProxyUrl() {
  return resolveLocalRunnerUrl() || resolvePlatformCloudUrl();
}

function resolveUserRole(req = null) {
  if (!req?.user) return 'guest';
  const profile = resolveMcpAccountProfileSync(req.user || {});
  return String(profile?.tier || 'basic').trim().toLowerCase();
}

function canUsePlatformCloudVideo(req = null) {
  const role = resolveUserRole(req);
  return ['founder', 'admin_family'].includes(role);
}

function enrichVideoResult(result, meta = {}) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    providerUsed: meta.providerUsed || 'unknown',
    chargedCredits: meta.chargedCredits !== undefined ? meta.chargedCredits : false,
    role: String(meta.role || 'unknown'),
    fallbackUsed: Boolean(meta.fallbackUsed),
    requiresConfirmation: Boolean(meta.requiresConfirmation),
  };
}

const LOCAL_VIDEO_WEIGHT_FILES = [
  { name: 'dit.safetensors', minBytes: 40_000_000_000 },
  { name: 'encoder.safetensors', minBytes: 300_000_000 },
  { name: 'decoder.safetensors', minBytes: 1_000_000_000 },
];

function resolveLocalVideoWeightsDir() {
  return String(
    process.env.A11_VIDEO_LOCAL_WEIGHTS_DIR
    || process.env.A11_MOCHI_WEIGHTS_DIR
    || 'E:\\Funesterie\\models\\video\\weights'
  ).trim();
}

function statLocalWeightFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: stat.isFile(),
      sizeBytes: stat.isFile() ? stat.size : 0,
    };
  } catch {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
}

function resolveLocalVideoWeightsStatus() {
  const directory = resolveLocalVideoWeightsDir();
  const runnerUrl = normalizeProxyUrl(
    process.env.A11_VIDEO_LOCAL_RUNNER_URL
    || process.env.A11_MOCHI_RUNNER_URL
    || ''
  );
  const files = LOCAL_VIDEO_WEIGHT_FILES.map((entry) => {
    const stat = directory ? statLocalWeightFile(path.join(directory, entry.name)) : { exists: false, sizeBytes: 0 };
    return {
      name: entry.name,
      present: Boolean(stat.exists && stat.sizeBytes >= entry.minBytes),
      sizeBytes: stat.sizeBytes,
    };
  });
  const installed = files.every((file) => file.present);
  const backend = String(process.env.A11_VIDEO_BACKEND || '').trim().toLowerCase();
  const enabled = isTruthy(process.env.A11_VIDEO_LOCAL_WEIGHTS_ENABLED)
    || isTruthy(process.env.A11_MOCHI_ENABLED)
    || backend.includes('mochi');

  return {
    configured: Boolean(directory),
    installed,
    enabled,
    modelFamily: 'mochi',
    modelHint: 'genmo/mochi-1-preview',
    files,
    runnerConfigured: Boolean(runnerUrl),
    inferenceReady: Boolean(installed && runnerUrl),
  };
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

function shouldForceAsyncVideoProxy() {
  const configured = process.env.A11_VIDEO_PROXY_FORCE_ASYNC;
  if (configured === undefined || String(configured || '').trim() === '') return true;
  return !isFalsey(configured);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function summarizeProxyErrorText(text = '', status = 0) {
  const value = String(text || '').trim();
  if (!value) return `video_proxy_status_${status || 'unknown'}`;
  if (/^<!doctype html/i.test(value) || /<html[\s>]/i.test(value)) {
    return `video_proxy_status_${status || 'unknown'}_html_response`;
  }
  return value.slice(0, 1000);
}

function proxyPayloadStatus(payload = {}) {
  const status = String(
    payload?.status
    || payload?.asyncJob?.status
    || payload?.job?.status
    || ''
  ).trim().toLowerCase();
  return status;
}

function proxyPayloadJobId(payload = {}) {
  return String(
    payload?.jobId
    || payload?.id
    || payload?.asyncJob?.jobId
    || payload?.asyncJob?.id
    || payload?.job?.jobId
    || payload?.job?.id
    || ''
  ).trim();
}

function isProxyAsyncJobPayload(payload = {}) {
  const status = proxyPayloadStatus(payload);
  if (['pending', 'queued', 'running', 'processing'].includes(status)) return true;
  return Boolean(proxyPayloadJobId(payload) && (payload?.poll_url || payload?.pollUrl || payload?.asyncJob?.poll_url || payload?.asyncJob?.pollUrl));
}

function isProxyDonePayload(payload = {}) {
  return ['done', 'complete', 'completed', 'success', 'succeeded'].includes(proxyPayloadStatus(payload));
}

function isProxyErrorPayload(payload = {}) {
  return ['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(proxyPayloadStatus(payload));
}

function extractProxyJobResultPayload(payload = {}) {
  if (payload?.result && typeof payload.result === 'object') {
    return {
      ...payload.result,
      proxied: true,
      provider: payload.result.provider || payload.provider || 'comfyui-mochi',
    };
  }
  return {
    ...(payload || {}),
    proxied: true,
    provider: payload?.provider || 'comfyui-mochi',
  };
}

function resolveProxyPollUrl(videoProxyUrl = '', payload = {}) {
  const raw = String(
    payload?.poll_url
    || payload?.pollUrl
    || payload?.asyncJob?.poll_url
    || payload?.asyncJob?.pollUrl
    || ''
  ).trim();
  if (!raw) return '';
  try {
    return new URL(raw, videoProxyUrl).toString();
  } catch {
    return '';
  }
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

  const localComfyPublicMarker = '/runtime/files/generated/videos/comfy/';
  const localComfyPublicIndex = normalized.toLowerCase().indexOf(localComfyPublicMarker);
  if (localComfyPublicIndex >= 0) {
    return normalized.slice(localComfyPublicIndex + localComfyPublicMarker.length);
  }

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

function isPublicExternalVideoUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return /^https?:$/i.test(parsed.protocol) && !isLocalishHost(parsed.hostname);
  } catch {
    return false;
  }
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
    payload.url,
    payload.video_url,
    payload.videoUrl,
    payload.download_url,
    payload.downloadUrl,
    payload.file_url,
    payload.fileUrl,
    payload.outputPath,
    payload.output_path,
    payload.local_path,
    payload.localPath,
    payload.path,
    payload.file_path,
    payload.video_path,
    payload.videoPath,
  ];

  for (const candidate of candidates) {
    if (isPublicExternalVideoUrl(candidate)) return String(candidate || '').trim();
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
  const buildVideoPromptImpl = typeof overrides.buildVideoPrompt === 'function'
    ? overrides.buildVideoPrompt
    : buildVideoPrompt;

  async function pollVideoProxyJob({ videoProxyUrl = '', initialPayload = {}, req = null } = {}) {
    const pollUrl = resolveProxyPollUrl(videoProxyUrl, initialPayload);
    if (!pollUrl) {
      const error = new Error('video_proxy_poll_url_missing');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'video_proxy_poll_url_missing',
        message: 'video_proxy_poll_url_missing',
      };
      throw error;
    }

    const pollIntervalMs = Math.max(
      1000,
      Math.min(30000, Number(initialPayload?.pollIntervalMs || initialPayload?.asyncJob?.pollIntervalMs || ASYNC_VIDEO_JOB_POLL_INTERVAL_MS) || ASYNC_VIDEO_JOB_POLL_INTERVAL_MS)
    );
    const maxWaitMs = Math.max(
      pollIntervalMs,
      Math.min(resolveVideoProxyTimeoutMs(), Number(initialPayload?.maxWaitMs || initialPayload?.asyncJob?.maxWaitMs || resolveVideoProxyTimeoutMs()) || resolveVideoProxyTimeoutMs())
    );
    const startedAt = Date.now();
    let payload = initialPayload || {};

    while (Date.now() - startedAt <= maxWaitMs) {
      if (isProxyDonePayload(payload)) {
        return rewriteVideoProxyPayload(extractProxyJobResultPayload(payload), req);
      }
      if (isProxyErrorPayload(payload)) {
        const message = String(payload?.message || payload?.error || 'video_proxy_job_failed');
        const error = new Error(message);
        error.statusCode = 502;
        error.payload = {
          ok: false,
          error: String(payload?.error || 'video_proxy_job_failed'),
          message,
          jobId: proxyPayloadJobId(payload),
        };
        throw error;
      }

      await sleep(pollIntervalMs);
      const pollResponse = await fetchImpl(pollUrl, {
        method: 'GET',
        headers: {
          ...buildAiServiceAuthHeaders(req),
        },
        signal: AbortSignal.timeout(Math.min(60_000, Math.max(5_000, pollIntervalMs + 10_000))),
      });
      const text = await pollResponse.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!pollResponse.ok) {
        const message = summarizeProxyErrorText(text, pollResponse.status);
        const error = new Error(message);
        error.statusCode = pollResponse.status || 502;
        error.payload = payload || {
          ok: false,
          error: 'video_proxy_poll_failed',
          message,
          jobId: proxyPayloadJobId(initialPayload),
        };
        throw error;
      }
    }

    const error = new Error(`video_proxy_job_timeout: ${proxyPayloadJobId(initialPayload) || 'unknown'}`);
    error.statusCode = 504;
    error.payload = {
      ok: false,
      error: 'video_proxy_job_timeout',
      message: 'video_proxy_job_timeout',
      jobId: proxyPayloadJobId(initialPayload),
    };
    throw error;
  }

  async function generateViaProxy({ req = null, body = {}, prompt = '', proxyUrl = null } = {}) {
    const videoProxyUrl = proxyUrl !== null ? proxyUrl : resolveVideoProxyUrl();
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
    if (shouldForceAsyncVideoProxy()) {
      proxyBody.acceptAsyncVideoJob = true;
      proxyBody.acceptAsyncJob = true;
    }
    const proxyResponse = await fetchImpl(videoProxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAiServiceAuthHeaders(req, body),
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
      const message = summarizeProxyErrorText(text, proxyResponse.status);
      const error = new Error(message);
      error.statusCode = proxyResponse.status || 502;
      error.payload = payload || {
        ok: false,
        error: 'video_proxy_failed',
        message,
      };
      throw error;
    }

    if (isProxyAsyncJobPayload(payload || {})) {
      return pollVideoProxyJob({
        videoProxyUrl,
        initialPayload: payload || {},
        req,
      });
    }

    return rewriteVideoProxyPayload(payload || {
      ok: true,
      proxied: true,
      raw: text,
    }, req);
  }

  async function generateVideoInternal(options = {}) {
    const body = options.body || options.req?.body || {};
    const req = options.req || null;
    const prompt = options.prompt || body.prompt || body.message || '';
    const requestedProvider = resolveRequestedVideoProvider(body, req);
    const sessionVideoTokens = resolveSessionVideoTokens(req, body);
    const role = resolveUserRole(req);

    if (shouldUseEmergencyVideoFirst(body)) {
      return createEmergencyVideoAsset({ prompt, body, req });
    }

    // Step 1: xAI — BYOK (user_cloud) or platform (premium/founder/admin allowed)
    const xaiVideoConfig = resolveXaiVideoConfig(process.env, { token: sessionVideoTokens.xai });
    if (isXaiVideoProvider(requestedProvider) || sessionVideoTokens.xai) {
      const hasByok = Boolean(sessionVideoTokens.xai);
      const usesServerToken = Boolean(!hasByok && xaiVideoConfig.token);
      if (usesServerToken && !canUseServerPaidVideo(req)) {
        const error = new Error('paid_video_demo_required');
        error.statusCode = 402;
        error.payload = buildPaidVideoDeniedPayload('xai');
        throw error;
      }
      const xaiResult = await tryGenerateVideoWithXai({
        req, body, prompt, fetchImpl,
        uploadBufferToR2Impl: overrides.uploadBufferToR2,
        tokenOverride: sessionVideoTokens.xai,
      });
      if (xaiResult?.ok) {
        return enrichVideoResult(rewriteVideoProxyPayload(xaiResult, req), {
          providerUsed: hasByok ? 'user_cloud' : 'platform_cloud',
          chargedCredits: hasByok ? 'user_token' : 'platform',
          role,
          requiresConfirmation: hasByok,
        });
      }
      if (isXaiVideoProvider(requestedProvider) || xaiVideoConfig.strict) {
        const error = new Error(xaiResult?.message || xaiResult?.error || 'xai_video_failed');
        error.statusCode = xaiResult?.statusCode || 502;
        error.payload = xaiResult || { ok: false, error: 'xai_video_failed', message: 'xai_video_failed' };
        throw error;
      }
      console.warn('[A11][video-route] xAI video unavailable, falling back:', String(xaiResult?.message || xaiResult?.error || 'unknown'));
    }

    // Step 2: RunComfy explicit — needs a proxy URL
    if (isRunComfyVideoProvider(requestedProvider) && !resolveVideoProxyUrl()) {
      const error = new Error('runcomfy_proxy_missing');
      error.statusCode = 424;
      error.payload = {
        ok: false, error: 'runcomfy_proxy_missing',
        message: 'RunComfy/Comfy demande une URL proxy A11_VIDEO_PROXY_URL ou A11_VIDEO_LOCAL_RUNNER_URL.',
        provider: 'runcomfy',
      };
      throw error;
    }

    // Step 3: Local runner — free, available to all, no role check
    if (!isHuggingFaceVideoProvider(requestedProvider) && !isXaiVideoProvider(requestedProvider)) {
      const localUrl = resolveLocalRunnerUrl();
      if (localUrl) {
        const localResult = await generateViaProxy({ req, body, prompt, proxyUrl: localUrl });
        if (localResult) {
          return enrichVideoResult(localResult, {
            providerUsed: 'local',
            chargedCredits: false,
            role,
          });
        }
      }
    }

    // Step 4: HuggingFace / Replicate — BYOK (user_cloud) or platform (premium/founder/admin allowed)
    const hfProviderOverride = isHuggingFaceVideoProvider(requestedProvider) ? requestedProvider : '';
    const hfVideoConfig = resolveHuggingFaceVideoConfig(process.env, {
      token: sessionVideoTokens.huggingface,
      replicateToken: sessionVideoTokens.replicate,
      provider: hfProviderOverride,
    });
    if (isHuggingFaceVideoProvider(requestedProvider) || hfVideoConfig.enabled) {
      const hasByok = Boolean(sessionVideoTokens.huggingface || sessionVideoTokens.replicate);
      const usesServerToken = Boolean(!hasByok && hfVideoConfig.token);
      if (usesServerToken && !canUseServerPaidVideo(req)) {
        if (isHuggingFaceVideoProvider(requestedProvider)) {
          const error = new Error('paid_video_demo_required');
          error.statusCode = 402;
          error.payload = buildPaidVideoDeniedPayload(hfVideoConfig.provider || 'huggingface');
          throw error;
        }
        // Not explicitly requested + role insufficient → skip silently, continue to next step
      } else {
        const hasReferenceImage = hasVideoReferenceImage(body);
        const builtPrompt = await buildVideoPromptImpl({
          userMessage: prompt,
          hasReferenceImage,
          timeoutMs: 10000,
        });
        const cloudPrompt = builtPrompt?.prompt || prompt;
        const hfResult = await tryGenerateVideoWithHuggingFace({
          req, body: { ...body, prompt: cloudPrompt }, prompt: cloudPrompt, fetchImpl,
          uploadBufferToR2Impl: overrides.uploadBufferToR2,
          tokenOverride: sessionVideoTokens.huggingface,
          configOverrides: { provider: hfProviderOverride, replicateToken: sessionVideoTokens.replicate },
        });
        if (hfResult?.ok) {
          return enrichVideoResult(rewriteVideoProxyPayload(hfResult, req), {
            providerUsed: hasByok ? 'user_cloud' : 'platform_cloud',
            chargedCredits: hasByok ? 'user_token' : 'platform',
            role,
            requiresConfirmation: hasByok,
          });
        }
        if (isHuggingFaceVideoProvider(requestedProvider) || hfVideoConfig.strict) {
          const error = new Error(hfResult?.message || hfResult?.error || 'hf_video_failed');
          error.statusCode = hfResult?.statusCode || 502;
          error.payload = hfResult || { ok: false, error: 'hf_video_failed', message: 'hf_video_failed' };
          throw error;
        }
        console.warn('[A11][video-route] Hugging Face video unavailable, falling back:', String(hfResult?.message || hfResult?.error || 'unknown'));
      }
    }

    // Step 5: Platform cloud proxy — BYOK allowed for all, server credits = admin/founder only
    const platformCloudUrl = resolvePlatformCloudUrl();
    if (platformCloudUrl) {
      const hasByokForCloud = Boolean(
        sessionVideoTokens.runcomfy
        || sessionVideoTokens.xai
        || sessionVideoTokens.huggingface
        || sessionVideoTokens.replicate
        || sessionVideoTokens.civitai
      );
      if (!hasByokForCloud && !canUsePlatformCloudVideo(req)) {
        const error = new Error('platform_cloud_video_forbidden');
        error.statusCode = 403;
        error.payload = {
          ok: false,
          error: 'platform_cloud_video_forbidden',
          message: 'Génération vidéo via le cloud plateforme réservée aux fondateurs et administrateurs. Aucun runner local ni token BYOK disponible.',
          providerUsed: null,
          chargedCredits: null,
          role,
        };
        throw error;
      }
      const cloudResult = await generateViaProxy({ req, body, prompt, proxyUrl: platformCloudUrl });
      if (cloudResult) {
        return enrichVideoResult(cloudResult, {
          providerUsed: hasByokForCloud ? 'user_cloud' : 'platform_cloud',
          chargedCredits: hasByokForCloud ? 'user_token' : 'platform',
          role,
          fallbackUsed: !hasByokForCloud,
          requiresConfirmation: hasByokForCloud,
        });
      }
    }

    // Step 6: Mochi local weights inference
    try {
      const mochiResult = await localGenerateVideoInternal(options);
      return enrichVideoResult(mochiResult, {
        providerUsed: 'local',
        chargedCredits: false,
        role,
        fallbackUsed: true,
      });
    } catch (error_) {
      if (!shouldFallbackToEmergencyVideo(body)) throw error_;
      console.error('[A11][video-route] emergency fallback after local failure:', String(error_?.message || error_));
      return createEmergencyVideoAsset({ prompt, body, req });
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
    const xaiVideoConfig = resolveXaiVideoConfig();
    res.json({
      ok: true,
      service: 'a11-video',
      localRunnerConfigured: Boolean(resolveLocalRunnerUrl()),
      platformCloudConfigured: Boolean(resolvePlatformCloudUrl()),
      proxyConfigured: Boolean(resolveVideoProxyUrl()),
      huggingFaceConfigured: Boolean(resolveHuggingFaceVideoConfig().enabled && resolveHuggingFaceVideoConfig().token),
      huggingFaceProvider: resolveHuggingFaceVideoConfig().provider,
      huggingFaceModel: resolveHuggingFaceVideoConfig().model,
      xaiConfigured: Boolean(xaiVideoConfig.enabled && xaiVideoConfig.token),
      xaiModel: xaiVideoConfig.model,
      localWeights: resolveLocalVideoWeightsStatus(),
      emergencyMode: shouldUseEmergencyVideoFirst({}),
      emergencyFallback: shouldFallbackToEmergencyVideo({}),
      asyncJobs: asyncVideoJobs.size,
    });
  });
  router.get('/video/status', (_req, res) => {
    const xaiVideoConfig = resolveXaiVideoConfig();
    res.json({
      ok: true,
      service: 'a11-video',
      modes: ['generate', 'async-job', 'proxy', 'huggingface', 'xai-grok-imagine', 'emergency-video'],
      proxyConfigured: Boolean(resolveVideoProxyUrl()),
      huggingFaceConfigured: Boolean(resolveHuggingFaceVideoConfig().enabled && resolveHuggingFaceVideoConfig().token),
      huggingFaceProvider: resolveHuggingFaceVideoConfig().provider,
      huggingFaceModel: resolveHuggingFaceVideoConfig().model,
      xaiConfigured: Boolean(xaiVideoConfig.enabled && xaiVideoConfig.token),
      xaiModel: xaiVideoConfig.model,
      localWeights: resolveLocalVideoWeightsStatus(),
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
      || 'buildVideoPrompt' in value
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
videoGenerateEntrypoint.resolveLocalVideoWeightsStatus = resolveLocalVideoWeightsStatus;
videoGenerateEntrypoint.hasVideoReferenceImage = hasVideoReferenceImage;

module.exports = videoGenerateEntrypoint;

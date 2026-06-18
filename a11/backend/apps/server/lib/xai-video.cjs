'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');

const { uploadBufferToR2 } = require('./file-storage.cjs');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeBaseUrl(value = '') {
  const raw = String(value || '').trim() || 'https://api.x.ai/v1';
  return raw.replace(/\/+$/, '');
}

function sanitizeXaiVideoToken(value = '') {
  const token = String(value || '').trim();
  if (!token || /^gsk_/i.test(token)) return '';
  return token;
}

function resolveXaiVideoToken(env = process.env, override = '') {
  const candidates = [
    override,
    env.A11_XAI_VIDEO_TOKEN,
    env.A11_GROK_VIDEO_TOKEN,
    env.XAI_API_KEY,
    env.GROK_API_KEY,
  ];
  for (const candidate of candidates) {
    const token = sanitizeXaiVideoToken(candidate);
    if (token) return token;
  }
  return '';
}

function isXaiVideoEnabled(env = process.env, tokenOverride = '') {
  const backend = String(env.A11_VIDEO_BACKEND || env.VIDEO_BACKEND || '').trim().toLowerCase();
  const token = resolveXaiVideoToken(env, tokenOverride);
  return Boolean(token)
    || isTruthy(env.A11_ENABLE_XAI_VIDEO)
    || isTruthy(env.A11_ENABLE_GROK_VIDEO)
    || ['xai', 'grok', 'grok-imagine', 'xai-video'].includes(backend);
}

function normalizeXaiDuration(value) {
  const duration = clampInteger(value, 6, 15, 6);
  if (duration <= 8) return 6;
  if (duration <= 12) return 10;
  return 15;
}

function resolveXaiVideoConfig(env = process.env, overrides = {}) {
  const tokenOverride = String(overrides.token || overrides.tokenOverride || '').trim();
  const token = resolveXaiVideoToken(env, tokenOverride);
  return {
    enabled: isXaiVideoEnabled(env, tokenOverride),
    token,
    baseUrl: normalizeBaseUrl(overrides.baseUrl || env.A11_XAI_BASE_URL || env.XAI_BASE_URL || 'https://api.x.ai/v1'),
    model: String(overrides.model || env.A11_XAI_VIDEO_MODEL || env.A11_GROK_VIDEO_MODEL || 'grok-imagine-video').trim(),
    defaultDuration: normalizeXaiDuration(overrides.duration || env.A11_XAI_VIDEO_DURATION || env.A11_GROK_VIDEO_DURATION || 6),
    timeoutMs: clampInteger(overrides.timeoutMs || env.A11_XAI_VIDEO_TIMEOUT_MS || env.A11_GROK_VIDEO_TIMEOUT_MS || 600000, 1000, 3600000, 600000),
    pollIntervalMs: clampInteger(overrides.pollIntervalMs || env.A11_XAI_VIDEO_POLL_INTERVAL_MS || env.A11_GROK_VIDEO_POLL_INTERVAL_MS || 4000, 250, 30000, 4000),
    strict: isTruthy(overrides.strict) || isTruthy(env.A11_XAI_VIDEO_STRICT) || isTruthy(env.A11_GROK_VIDEO_STRICT),
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizePrompt(value = '') {
  const prompt = String(value || '').replace(/\s+/g, ' ').trim();
  return prompt.length > 1000 ? prompt.slice(0, 997).trimEnd() + '...' : prompt;
}

function resolveReferenceImageUrl(request = {}) {
  return firstNonEmptyString(
    request.sourceImageUrl,
    request.source_image_url,
    request.referenceImageUrl,
    request.reference_image_url,
    request.initImageUrl,
    request.init_image_url,
    request.imageUrl,
    request.image_url
  );
}

function buildXaiVideoPayload(config, request = {}) {
  const prompt = normalizePrompt(request.prompt || request.message || '');
  const duration = normalizeXaiDuration(request.durationSeconds || request.durationSec || request.duration || config.defaultDuration);
  const payload = {
    model: config.model,
    duration,
  };
  const referenceImageUrl = resolveReferenceImageUrl(request);
  if (referenceImageUrl && !prompt) {
    payload.image_url = referenceImageUrl;
  } else {
    payload.prompt = prompt;
  }
  return payload;
}

function buildRuntimeVideoPath(filename = '') {
  const safeName = String(filename || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || `a11-xai-video-${Date.now()}.mp4`;
  const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim()
    || path.resolve(process.cwd(), '..', '..', '..', 'runtime');
  return path.join(runtimeRoot, 'files', 'generated', 'videos', safeName);
}

function videoExtensionFromContentType(contentType = '') {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('quicktime')) return '.mov';
  return '.mp4';
}

async function readResponsePayload(response) {
  const contentType = String(
    typeof response.headers?.get === 'function'
      ? response.headers.get('content-type')
      : response.headers?.['content-type'] || ''
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let json = null;
  if (contentType.includes('json') || /^[\s\r\n]*[\[{]/.test(text)) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { buffer, text, json, contentType };
}

function findVideoUrl(value, depth = 0) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') {
    return /^https?:\/\/.+\.(mp4|webm|mov|gif)(\?|#|$)/i.test(value) || /^https?:\/\/.+/i.test(value) ? value : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const direct = firstNonEmptyString(
    value.url,
    value.video_url,
    value.videoUrl,
    value.output_url,
    value.outputUrl,
    value.download_url,
    value.downloadUrl,
    value?.video?.url,
    value?.video?.video_url,
    value?.data?.url,
    value?.data?.video_url,
    value?.result?.url,
    value?.result?.video_url
  );
  if (direct) return direct;
  for (const child of Object.values(value)) {
    const found = findVideoUrl(child, depth + 1);
    if (found) return found;
  }
  return '';
}

function findRequestId(value = {}) {
  return firstNonEmptyString(
    value.id,
    value.request_id,
    value.requestId,
    value.generation_id,
    value.generationId,
    value?.data?.id,
    value?.data?.request_id
  );
}

function isDoneStatus(status = '') {
  return ['done', 'completed', 'complete', 'succeeded', 'success', 'ready'].includes(String(status || '').trim().toLowerCase());
}

function isFailedStatus(status = '') {
  return ['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled', 'rejected'].includes(String(status || '').trim().toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function xaiAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function downloadVideoUrl(fetchImpl, url, token, timeoutMs) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'video/mp4, video/webm, application/octet-stream',
      ...(String(url || '').includes('api.x.ai') ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(payload.json?.error?.message || payload.json?.message || payload.text || `xai_video_download_${response.status}`);
  }
  return payload;
}

async function pollXaiVideo(fetchImpl, config, requestId) {
  const statusUrl = `${config.baseUrl}/videos/${encodeURIComponent(requestId)}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= config.timeoutMs) {
    await sleep(config.pollIntervalMs);
    const response = await fetchImpl(statusUrl, {
      method: 'GET',
      headers: xaiAuthHeaders(config.token),
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, Math.max(5000, config.pollIntervalMs + 10000))),
    });
    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new Error(payload.json?.error?.message || payload.json?.message || payload.text || `xai_video_status_${response.status}`);
    }
    const videoUrl = findVideoUrl(payload.json);
    if (videoUrl) return downloadVideoUrl(fetchImpl, videoUrl, config.token, config.timeoutMs);
    const status = firstNonEmptyString(payload.json?.status, payload.json?.data?.status, payload.json?.result?.status);
    if (isDoneStatus(status) && !videoUrl) throw new Error('xai_video_missing_url');
    if (isFailedStatus(status)) throw new Error(firstNonEmptyString(payload.json?.message, payload.json?.error?.message, payload.json?.error) || 'xai_video_failed');
  }
  throw new Error('xai_video_timeout');
}

async function tryGenerateVideoWithXai({
  body = {},
  prompt = '',
  req = null,
  fetchImpl = null,
  uploadBufferToR2Impl = uploadBufferToR2,
  tokenOverride = '',
  configOverrides = {},
} = {}) {
  const config = resolveXaiVideoConfig(process.env, {
    ...configOverrides,
    token: tokenOverride || configOverrides.token,
  });
  if (!config.enabled) {
    return {
      ok: false,
      error: 'xai_video_disabled',
      message: 'La generation video Grok/xAI est desactivee sur cet environnement.',
    };
  }
  if (!config.token) {
    return {
      ok: false,
      error: 'xai_video_unconfigured',
      message: 'Cle xAI manquante pour Grok Imagine.',
    };
  }
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      error: 'xai_video_fetch_unavailable',
      message: 'fetch_unavailable_for_xai_video',
    };
  }

  const requestBody = {
    ...(body || {}),
    prompt: normalizePrompt(prompt || body.prompt || body.message || ''),
  };
  if (!requestBody.prompt && !resolveReferenceImageUrl(requestBody)) {
    return {
      ok: false,
      error: 'xai_video_prompt_missing',
      message: 'Prompt video Grok/xAI manquant.',
    };
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: xaiAuthHeaders(config.token),
      body: JSON.stringify(buildXaiVideoPayload(config, requestBody)),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const responsePayload = await readResponsePayload(response);
    if (!response.ok) {
      return {
        ok: false,
        error: String(responsePayload.json?.error?.code || responsePayload.json?.error || 'xai_video_failed'),
        message: String(responsePayload.json?.error?.message || responsePayload.json?.message || responsePayload.text || `xai_video_status_${response.status}`),
        statusCode: Number(response.status || 0) || undefined,
        provider: 'xai',
        model: config.model,
      };
    }

    let videoPayload = responsePayload;
    const immediateVideoUrl = findVideoUrl(responsePayload.json);
    if (immediateVideoUrl) {
      videoPayload = await downloadVideoUrl(fetchImpl, immediateVideoUrl, config.token, config.timeoutMs);
    } else if (responsePayload.json) {
      const requestId = findRequestId(responsePayload.json);
      if (!requestId) {
        return {
          ok: false,
          error: 'xai_video_missing_request_id',
          message: 'La reponse Grok/xAI ne contient pas de video ni de request_id.',
          provider: 'xai',
          model: config.model,
        };
      }
      videoPayload = await pollXaiVideo(fetchImpl, config, requestId);
    }

    if (!videoPayload.buffer?.length) {
      return {
        ok: false,
        error: 'xai_video_missing_payload',
        message: 'La reponse Grok/xAI video est vide.',
        provider: 'xai',
        model: config.model,
      };
    }

    const extension = videoExtensionFromContentType(videoPayload.contentType);
    const filename = `a11-xai-video-${Date.now()}${extension}`;
    const outputPath = buildRuntimeVideoPath(filename);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, videoPayload.buffer);

    let uploadedUrl = '';
    let storageKey = '';
    try {
      const uploadResult = await uploadBufferToR2Impl({
        userId: req?.user?.id || body?._user || 'video-tool',
        filename,
        buffer: videoPayload.buffer,
        contentType: videoPayload.contentType || 'video/mp4',
      });
      uploadedUrl = String(uploadResult?.url || '').trim();
      storageKey = String(uploadResult?.storageKey || '').trim();
    } catch {
      // The runtime file route remains a valid fallback.
    }

    return {
      ok: true,
      tool: 'generate_video',
      artifact_type: 'video',
      backend: 'xai-video',
      mode: 'grok-imagine-video',
      provider: 'xai',
      model: config.model,
      prompt: requestBody.prompt,
      format: extension.replace(/^\./, '') || 'mp4',
      filename,
      outputPath,
      url: uploadedUrl || null,
      video_url: uploadedUrl || null,
      storage_key: storageKey || null,
      contentType: videoPayload.contentType || 'video/mp4',
    };
  } catch (error) {
    return {
      ok: false,
      error: 'xai_video_failed',
      message: String(error?.message || error || 'xai_video_failed'),
      provider: 'xai',
      model: config.model,
    };
  }
}

module.exports = {
  tryGenerateVideoWithXai,
  resolveXaiVideoConfig,
  isXaiVideoEnabled,
  buildXaiVideoPayload,
};

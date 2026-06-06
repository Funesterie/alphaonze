const path = require('node:path');
const fsp = require('node:fs/promises');

const { uploadBufferToR2 } = require('./file-storage.cjs');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fal' || normalized === 'fal_ai') return 'fal-ai';
  if (normalized === 'replicate') return 'replicate';
  if (normalized === 'wavespeed' || normalized === 'wavespeed-ai') return 'wavespeed';
  if (normalized === 'hf' || normalized === 'hf-inference' || normalized === 'huggingface') return 'hf-inference';
  return normalized || 'fal-ai';
}

function isHuggingFaceVideoEnabled(env = process.env) {
  const backend = String(env.A11_VIDEO_BACKEND || env.VIDEO_BACKEND || '').trim().toLowerCase();
  return isTruthy(env.A11_ENABLE_HF_VIDEO || env.A11_ENABLE_HUGGINGFACE_VIDEO)
    || ['hf', 'huggingface', 'huggingface-video', 'hf-video'].includes(backend);
}

function resolveHuggingFaceVideoToken(env = process.env) {
  return String(
    env.A11_HF_VIDEO_TOKEN
    || env.A11_HUGGINGFACE_VIDEO_TOKEN
    || env.A11_HF_IMAGE_TOKEN
    || env.A11_HUGGINGFACE_IMAGE_TOKEN
    || env.HF_TOKEN
    || env.HF_API_KEY
    || env.HUGGINGFACE_HUB_TOKEN
    || env.HUGGINGFACEHUB_API_TOKEN
    || ''
  ).trim();
}

function resolveReplicateVideoToken(env = process.env) {
  return String(
    env.A11_REPLICATE_VIDEO_TOKEN
    || env.A11_REPLICATE_API_TOKEN
    || env.REPLICATE_API_TOKEN
    || env.REPLICATE_TOKEN
    || ''
  ).trim();
}

function resolveReplicateVideoModel(env = process.env) {
  return String(
    env.A11_REPLICATE_VIDEO_MODEL
    || env.REPLICATE_VIDEO_MODEL
    || 'wan-video/wan-2.2-5b-fast'
  ).trim() || 'wan-video/wan-2.2-5b-fast';
}

function defaultReplicateEndpoint(env = process.env) {
  const baseUrl = String(env.A11_REPLICATE_BASE_URL || 'https://api.replicate.com/v1').trim().replace(/\/+$/, '');
  const modelPath = resolveReplicateVideoModel(env).split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/models/${modelPath}/predictions`;
}

function defaultEndpointForProvider(provider = 'fal-ai', model = '') {
  const encodedModel = String(model || '').trim().split('/').map(encodeURIComponent).join('/');
  if (provider === 'fal-ai') {
    return 'https://router.huggingface.co/fal-ai/fal-ai/wan/v2.2-5b/text-to-video?_subdomain=queue';
  }
  if (provider === 'replicate') {
    return 'https://router.huggingface.co/replicate/v1/models/wan-video/wan-2.2-5b-fast/predictions';
  }
  if (provider === 'wavespeed') {
    return 'https://router.huggingface.co/wavespeed/api/v3/wavespeed-ai/wan-2.2/t2v-5b-720p';
  }
  return `https://router.huggingface.co/hf-inference/models/${encodedModel || 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers'}`;
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveHuggingFaceVideoConfig(env = process.env, overrides = {}) {
  const overrideToken = String(overrides.token || overrides.tokenOverride || '').trim();
  const overrideReplicateToken = String(overrides.replicateToken || overrides.replicateTokenOverride || '').trim();
  const provider = normalizeProvider(overrides.provider || env.A11_HF_VIDEO_PROVIDER || env.A11_HUGGINGFACE_VIDEO_PROVIDER || 'fal-ai');
  const replicateToken = overrideReplicateToken || resolveReplicateVideoToken(env);
  const tokenKind = provider === 'replicate' && replicateToken ? 'replicate' : 'huggingface';
  const enabled = Boolean(overrides.enabled) || Boolean(overrideToken) || Boolean(overrideReplicateToken) || isHuggingFaceVideoEnabled(env);
  const model = String(
    overrides.model
    || env.A11_HF_VIDEO_MODEL
    || env.A11_HUGGINGFACE_VIDEO_MODEL
    || 'Wan-AI/Wan2.2-TI2V-5B'
  ).trim();
  const endpointOverride = String(
    overrides.endpoint
    || env.A11_HF_VIDEO_ENDPOINT
    || env.A11_HUGGINGFACE_VIDEO_ENDPOINT
    || ''
  ).trim();
  const endpoint = String(
    endpointOverride
    || (tokenKind === 'replicate' ? defaultReplicateEndpoint(env) : '')
    || defaultEndpointForProvider(provider, model)
  ).trim();
  const token = tokenKind === 'replicate' ? replicateToken : (overrideToken || resolveHuggingFaceVideoToken(env));
  const defaultFrames = clampInteger(env.A11_HF_VIDEO_FRAMES || env.A11_HUGGINGFACE_VIDEO_FRAMES || 16, 4, 121, 16);
  const defaultSteps = clampInteger(env.A11_HF_VIDEO_STEPS || env.A11_HUGGINGFACE_VIDEO_STEPS || 4, 1, 50, 4);
  const timeoutMs = clampInteger(env.A11_HF_VIDEO_TIMEOUT_MS || env.A11_HUGGINGFACE_VIDEO_TIMEOUT_MS || 600000, 1000, 3600000, 600000);
  const pollIntervalMs = clampInteger(env.A11_HF_VIDEO_POLL_INTERVAL_MS || env.A11_HUGGINGFACE_VIDEO_POLL_INTERVAL_MS || 3000, 10, 30000, 3000);
  const strict = isTruthy(env.A11_HF_VIDEO_STRICT || env.A11_HUGGINGFACE_VIDEO_STRICT)
    || ['hf', 'huggingface', 'huggingface-video', 'hf-video'].includes(String(env.A11_VIDEO_BACKEND || '').trim().toLowerCase());
  return {
    enabled,
    provider,
    model,
    endpoint,
    token,
    tokenKind,
    defaultFrames,
    defaultSteps,
    timeoutMs,
    pollIntervalMs,
    strict,
  };
}

function buildRuntimeVideoPath(filename = '') {
  const safeName = String(filename || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || `a11-hf-video-${Date.now()}.mp4`;
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

function normalizeNegativePrompt(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? [text] : undefined;
}

function normalizeNegativePromptText(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  return String(value || '').trim() || undefined;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function resolveVideoReferenceImageUrl(request = {}) {
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

function buildHuggingFaceVideoPayload(config, request = {}) {
  const prompt = String(request.prompt || request.message || '').trim();
  const referenceImageUrl = resolveVideoReferenceImageUrl(request);
  const minFrames = config.provider === 'replicate' ? 81 : 4;
  const numFrames = clampInteger(
    request.num_frames || request.numFrames || request.frameCount || request.frame_count || request.frames,
    minFrames,
    121,
    Math.max(minFrames, config.defaultFrames)
  );
  const steps = clampInteger(
    request.num_inference_steps || request.numInferenceSteps || request.steps,
    1,
    50,
    config.defaultSteps
  );
  const parameters = {
    num_frames: numFrames,
    num_inference_steps: steps,
    ...(Number.isFinite(Number(request.guidance_scale || request.guidanceScale))
      ? { guidance_scale: Number(request.guidance_scale || request.guidanceScale) }
      : {}),
    ...(config.provider === 'replicate' && normalizeNegativePromptText(request.negative_prompt || request.negativePrompt)
      ? { negative_prompt: normalizeNegativePromptText(request.negative_prompt || request.negativePrompt) }
      : {}),
    ...(config.provider !== 'replicate' && normalizeNegativePrompt(request.negative_prompt || request.negativePrompt)
      ? { negative_prompt: normalizeNegativePrompt(request.negative_prompt || request.negativePrompt) }
      : {}),
    ...(Number.isFinite(Number(request.seed)) ? { seed: Number(request.seed) } : {}),
  };

  if (config.provider === 'replicate') {
    return {
      input: {
        prompt,
        ...(referenceImageUrl ? { image: referenceImageUrl } : {}),
        ...parameters,
      },
    };
  }
  if (config.provider === 'hf-inference') {
    return { inputs: prompt, parameters };
  }
  return { prompt, ...parameters };
}

async function readResponsePayload(response) {
  const contentType = String(response.headers?.get?.('content-type') || '').trim();
  const buffer = Buffer.from(await response.arrayBuffer());
  if (contentType.includes('application/json') || contentType.includes('text/')) {
    const text = buffer.toString('utf8');
    try {
      return { contentType, buffer, json: text ? JSON.parse(text) : null, text };
    } catch {
      return { contentType, buffer, json: null, text };
    }
  }
  return { contentType, buffer, json: null, text: '' };
}

function findVideoUrl(value, depth = 0) {
  if (!value || depth > 5) return '';
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) ? value : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const priorityKeys = [
    'video_url',
    'videoUrl',
    'url',
    'download_url',
    'downloadUrl',
    'file_url',
    'fileUrl',
  ];
  for (const key of priorityKeys) {
    const found = findVideoUrl(value[key], depth + 1);
    if (found) return found;
  }
  for (const key of ['video', 'output', 'outputs', 'data', 'result', 'file']) {
    const found = findVideoUrl(value[key], depth + 1);
    if (found) return found;
  }
  return '';
}

async function downloadVideoUrl(fetchImpl, url, token, timeoutMs, tokenKind = 'huggingface') {
  const response = await fetchImpl(url, {
    headers: headersForHuggingFaceVideoUrl(url, token, tokenKind),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(payload.text || `hf_video_download_status_${response.status}`);
  }
  if (!payload.buffer.length) throw new Error('hf_video_download_empty');
  return payload;
}

function headersForHuggingFaceVideoUrl(url, token, tokenKind = 'huggingface') {
  const targetUrl = String(url || '');
  if (!token) return {};
  return /^https:\/\/router\.huggingface\.co\//i.test(targetUrl)
    || (tokenKind === 'replicate' && /^https:\/\/api\.replicate\.com\//i.test(targetUrl))
    ? { Authorization: `Bearer ${token}` }
    : {};
}

function normalizeQueueUrl(requestUrl, value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  const parsed = new URL(requestUrl);
  return `${parsed.protocol}//${parsed.host}${text.startsWith('/') ? '' : '/'}${text}`;
}

function normalizeFalQueueStatus(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function extractFalQueueUrls(json = {}, requestUrl = '') {
  const statusUrl = normalizeQueueUrl(
    requestUrl,
    json.status_url || json.statusUrl || json.urls?.status || json.data?.status_url || json.data?.urls?.status || ''
  );
  const responseUrl = normalizeQueueUrl(
    requestUrl,
    json.response_url || json.responseUrl || json.urls?.response || json.data?.response_url || json.data?.urls?.response || ''
  );
  return { statusUrl, responseUrl };
}

function extractFalQueueStatus(json = {}) {
  return normalizeFalQueueStatus(
    json.status || json.state || json.data?.status || json.data?.state || json.queue?.status || ''
  );
}

async function pollFalQueueResult(fetchImpl, responseJson, requestUrl, token, timeoutMs, pollIntervalMs, tokenKind = 'huggingface') {
  let { statusUrl, responseUrl } = extractFalQueueUrls(responseJson, requestUrl);
  const deadline = Date.now() + timeoutMs;
  let lastStatus = extractFalQueueStatus(responseJson);
  let lastMessage = '';

  while (Date.now() < deadline) {
    if (statusUrl) {
      const statusResponse = await fetchImpl(statusUrl, {
        headers: headersForHuggingFaceVideoUrl(statusUrl, token, tokenKind),
        signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, deadline - Date.now()))),
      });
      const statusPayload = await readResponsePayload(statusResponse);
      if (!statusResponse.ok) {
        throw new Error(statusPayload.text || `hf_fal_queue_status_${statusResponse.status}`);
      }
      const statusJson = statusPayload.json || {};
      const urls = extractFalQueueUrls(statusJson, requestUrl);
      statusUrl = urls.statusUrl || statusUrl;
      responseUrl = urls.responseUrl || responseUrl;
      lastStatus = extractFalQueueStatus(statusJson) || lastStatus;
      lastMessage = String(statusJson.error || statusJson.message || statusJson.logs?.[0]?.message || statusPayload.text || '').trim();
      if (['completed', 'complete', 'succeeded', 'success', 'ok'].includes(lastStatus)) {
        break;
      }
      if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(lastStatus)) {
        throw new Error(lastMessage || `hf_fal_queue_${lastStatus}`);
      }
    } else if (responseUrl) {
      const resultResponse = await fetchImpl(responseUrl, {
        headers: headersForHuggingFaceVideoUrl(responseUrl, token, tokenKind),
        signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, deadline - Date.now()))),
      });
      const resultPayload = await readResponsePayload(resultResponse);
      if (resultResponse.ok) {
        if (!resultPayload.json) return resultPayload;
        const videoUrl = findVideoUrl(resultPayload.json);
        if (videoUrl) return downloadVideoUrl(fetchImpl, videoUrl, token, timeoutMs, tokenKind);
        lastStatus = extractFalQueueStatus(resultPayload.json) || lastStatus;
      } else if (![202, 409, 425].includes(Number(resultResponse.status))) {
        throw new Error(resultPayload.text || `hf_fal_queue_response_${resultResponse.status}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!responseUrl) {
    throw new Error(lastMessage || 'hf_fal_queue_missing_response_url');
  }

  const finalResponse = await fetchImpl(responseUrl, {
    headers: headersForHuggingFaceVideoUrl(responseUrl, token, tokenKind),
    signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, deadline - Date.now()))),
  });
  const finalPayload = await readResponsePayload(finalResponse);
  if (!finalResponse.ok) {
    throw new Error(finalPayload.text || `hf_fal_queue_result_${finalResponse.status}`);
  }
  if (!finalPayload.json) return finalPayload;
  const videoUrl = findVideoUrl(finalPayload.json);
  if (!videoUrl) {
    throw new Error(lastMessage || 'hf_fal_queue_missing_video_url');
  }
  return downloadVideoUrl(fetchImpl, videoUrl, token, timeoutMs, tokenKind);
}

function extractReplicatePredictionUrl(json = {}, requestUrl = '') {
  return normalizeQueueUrl(
    requestUrl,
    json.urls?.get || json.get_url || json.getUrl || json.prediction_url || json.predictionUrl || ''
  );
}

async function pollReplicateResult(fetchImpl, responseJson, requestUrl, token, timeoutMs, pollIntervalMs, tokenKind = 'huggingface') {
  let prediction = responseJson || {};
  const predictionUrl = extractReplicatePredictionUrl(responseJson, requestUrl);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = normalizeFalQueueStatus(prediction.status || prediction.state || '');
    if (['succeeded', 'success', 'completed', 'complete', 'ok'].includes(status)) {
      const videoUrl = findVideoUrl(prediction.output || prediction.result || prediction.video || prediction.data || {});
      if (!videoUrl) throw new Error('hf_replicate_missing_video_url');
      return downloadVideoUrl(fetchImpl, videoUrl, token, timeoutMs, tokenKind);
    }
    if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(String(prediction.error || prediction.logs || `hf_replicate_${status}`));
    }
    if (!predictionUrl) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const response = await fetchImpl(predictionUrl, {
      headers: headersForHuggingFaceVideoUrl(predictionUrl, token, tokenKind),
      signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, deadline - Date.now()))),
    });
    const payload = await readResponsePayload(response);
    if (!response.ok) throw new Error(payload.text || `hf_replicate_status_${response.status}`);
    prediction = payload.json || {};
  }

  throw new Error('hf_replicate_timeout');
}

async function pollWavespeedResult(fetchImpl, responseJson, requestUrl, token, timeoutMs, tokenKind = 'huggingface') {
  const resultPath = responseJson?.data?.urls?.get;
  if (!resultPath) return null;
  const parsed = new URL(requestUrl);
  const baseUrl = parsed.hostname === 'router.huggingface.co'
    ? `${parsed.protocol}//${parsed.host}/wavespeed`
    : `${parsed.protocol}//${parsed.host}`;
  const resultUrl = /^https?:\/\//i.test(resultPath)
    ? resultPath
    : `${baseUrl}${String(resultPath).startsWith('/') ? '' : '/'}${resultPath}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const response = await fetchImpl(resultUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, deadline - Date.now()))),
    });
    const payload = await readResponsePayload(response);
    if (!response.ok) throw new Error(payload.text || `hf_wavespeed_status_${response.status}`);
    const data = payload.json?.data || {};
    if (data.status === 'completed') {
      const outputUrl = Array.isArray(data.outputs) ? data.outputs[0] : data.outputs;
      if (!outputUrl) throw new Error('hf_wavespeed_missing_output');
      return downloadVideoUrl(fetchImpl, outputUrl, token, timeoutMs, tokenKind);
    }
    if (data.status === 'failed') {
      throw new Error(String(data.error || 'hf_wavespeed_failed'));
    }
  }
  throw new Error('hf_wavespeed_timeout');
}

async function tryGenerateVideoWithHuggingFace({
  body = {},
  prompt = '',
  req = null,
  fetchImpl = null,
  uploadBufferToR2Impl = uploadBufferToR2,
  tokenOverride = '',
  configOverrides = {},
} = {}) {
  const config = resolveHuggingFaceVideoConfig(process.env, {
    ...configOverrides,
    token: tokenOverride || configOverrides.token,
  });
  if (!config.enabled) {
    return {
      ok: false,
      error: 'hf_video_disabled',
      message: 'La generation video Hugging Face est desactivee sur cet environnement.',
    };
  }
  if (!config.token) {
    return {
      ok: false,
      error: 'hf_video_unconfigured',
      message: 'HF_TOKEN manquant pour la generation video Hugging Face.',
    };
  }
  if (!config.endpoint) {
    return {
      ok: false,
      error: 'hf_video_endpoint_missing',
      message: 'Endpoint Hugging Face video manquant.',
    };
  }
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      error: 'hf_video_fetch_unavailable',
      message: 'fetch_unavailable_for_hf_video',
    };
  }

  const requestBody = {
    ...(body || {}),
    prompt: String(prompt || body.prompt || body.message || '').trim(),
  };
  if (!requestBody.prompt) {
    return {
      ok: false,
      error: 'hf_video_prompt_missing',
      message: 'Prompt video Hugging Face manquant.',
    };
  }

  const payload = buildHuggingFaceVideoPayload(config, requestBody);
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    headers: {
      ...headersForHuggingFaceVideoUrl(config.endpoint, config.token, config.tokenKind),
      'Content-Type': 'application/json',
      Accept: 'video/mp4, application/json',
      ...(config.provider === 'replicate' && config.tokenKind === 'replicate'
        ? { Prefer: `wait=${Math.min(60, Math.ceil(config.timeoutMs / 1000))}` }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs),
  }).catch((error_) => ({
    ok: false,
    status: 0,
    headers: new Map(),
    arrayBuffer: async () => Buffer.from(String(error_?.message || error_)),
  }));
  const responsePayload = await readResponsePayload(response);
  if (!response.ok) {
    return {
      ok: false,
      error: String(responsePayload.json?.error || responsePayload.json?.error_type || 'hf_video_failed'),
      message: String(responsePayload.json?.message || responsePayload.json?.error || responsePayload.text || `hf_video_status_${response.status}`),
      statusCode: Number(response.status || 0) || undefined,
      provider: config.provider,
      model: config.model,
    };
  }

  let videoPayload = responsePayload;
  if (responsePayload.json) {
    if (config.provider === 'wavespeed' && responsePayload.json?.data?.urls?.get) {
      videoPayload = await pollWavespeedResult(fetchImpl, responsePayload.json, config.endpoint, config.token, config.timeoutMs, config.tokenKind);
    } else if (config.provider === 'replicate' && (responsePayload.json?.urls?.get || responsePayload.json?.status)) {
      videoPayload = await pollReplicateResult(
        fetchImpl,
        responsePayload.json,
        config.endpoint,
        config.token,
        config.timeoutMs,
        config.pollIntervalMs,
        config.tokenKind
      );
    } else if (
      config.provider === 'fal-ai'
      && (
        responsePayload.json?.status_url
        || responsePayload.json?.statusUrl
        || responsePayload.json?.response_url
        || responsePayload.json?.responseUrl
        || responsePayload.json?.request_id
        || responsePayload.json?.requestId
      )
    ) {
      videoPayload = await pollFalQueueResult(
        fetchImpl,
        responsePayload.json,
        config.endpoint,
        config.token,
        config.timeoutMs,
        config.pollIntervalMs,
        config.tokenKind
      );
    } else {
      const videoUrl = findVideoUrl(responsePayload.json);
      if (!videoUrl) {
        return {
          ok: false,
          error: 'hf_video_missing_url',
          message: 'La reponse Hugging Face ne contient pas de video exploitable.',
          provider: config.provider,
          model: config.model,
        };
      }
      videoPayload = await downloadVideoUrl(fetchImpl, videoUrl, config.token, config.timeoutMs, config.tokenKind);
    }
  }

  if (!videoPayload.buffer?.length) {
    return {
      ok: false,
      error: 'hf_video_missing_payload',
      message: 'La reponse Hugging Face video est vide.',
      provider: config.provider,
      model: config.model,
    };
  }

  const extension = videoExtensionFromContentType(videoPayload.contentType);
  const filename = `a11-hf-video-${Date.now()}${extension}`;
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
    backend: 'huggingface-video',
    mode: 'huggingface-video',
    provider: config.provider,
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
}

module.exports = {
  tryGenerateVideoWithHuggingFace,
  resolveHuggingFaceVideoConfig,
  isHuggingFaceVideoEnabled,
  buildHuggingFaceVideoPayload,
};

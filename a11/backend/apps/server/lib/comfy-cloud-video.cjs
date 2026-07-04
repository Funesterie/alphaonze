const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { uploadBufferToR2 } = require('./file-storage.cjs');

const DEFAULT_BASE_URL = 'https://cloud.comfy.org';
const DEFAULT_WORKFLOW_PATH = path.resolve(__dirname, '../src/video/workflows/comfy-wan-image-to-video-api.json');
const DEFAULT_NEGATIVE_PROMPT = [
  'low quality',
  'blurry',
  'distorted face',
  'broken hands',
  'bad anatomy',
  'floating limbs',
  'disconnected body parts',
  'disembodied legs',
  'missing torso',
  'incomplete anatomy',
  'cut off body',
  'severed limbs',
  'text',
  'letters',
  'words',
  'caption',
  'subtitles',
  'title card',
  'logo',
  'watermark',
  'signature',
  'typography',
  'signage',
  'UI text',
  'gibberish text',
  'pseudo text',
  'scribbles',
  'fake writing'
].join(', ');
const VOCAL_PERFORMANCE_NEGATIVE_PROMPT = 'closed mouth, sealed lips, frozen lips, expressionless face, mouth hidden, microphone covering mouth';

function firstConfiguredToken(...values) {
  for (const value of values) {
    const token = String(value || '').split(/[\s,]+/).map((item) => item.trim()).find(Boolean);
    if (token) return token;
  }
  return '';
}

function normalizeBaseUrl(value = '') {
  const url = String(value || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  return url.replace(/\/+$/, '');
}

function toBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isFalsey(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeOneLine(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendCommaTerms(...groups) {
  const output = [];
  const seen = new Set();
  for (const group of groups) {
    for (const part of String(group || '').split(',')) {
      const text = normalizeOneLine(part);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(text);
    }
  }
  return output.join(', ');
}

function hasVocalPerformanceIntent(body = {}, prompt = '') {
  if (body.vocalPerformance === false || body.vocal_performance === false || body.visualOnly === true || body.visual_only === true) {
    return false;
  }
  const text = normalizeOneLine([
    prompt,
    body.userMessage,
    body.message,
    body.title,
    body.audioMotionPlan ? JSON.stringify(body.audioMotionPlan).slice(0, 4000) : '',
  ].join(' '))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return body.vocalPerformance === true
    || body.vocal_performance === true
    || /\b(?:song|singer|singing|lyrics|lyric|vocal|vocals|voice|mouth|lip|lips|microphone|mic|chorus|refrain|verse|couplet|clip musical|music video|chanson|chant|chante|chanter|paroles|voix|micro|concert)\b/.test(text);
}

function hardenComfyPrompt(prompt = '', body = {}) {
  const vocalPerformance = hasVocalPerformanceIntent(body, prompt);
  let next = normalizeOneLine(prompt);
  if (!/\b(?:no text|without text|no readable text|no captions|no subtitles|no logos|no watermark)\b/i.test(next)) {
    next = `${next}. No readable text, no fake letters, no subtitles, no captions, no logos, no watermarks; screens, signs, labels and clothing prints stay blank or abstract.`;
  }
  if (vocalPerformance && !/\b(?:singing|sings|mouth articulation|lips open|lip movement|visible vocal performance)\b/i.test(next)) {
    next = `${next}. Visible vocal performance: the lead performer sings on camera with natural mouth articulation, lips opening and closing, expressive phrasing, microphone never hiding the mouth.`;
  }
  return normalizeOneLine(next).replace(/\.{2,}/g, '.');
}

function hardenComfyNegativePrompt(value = '', body = {}, prompt = '') {
  const vocalPerformance = hasVocalPerformanceIntent(body, prompt);
  return appendCommaTerms(
    value,
    DEFAULT_NEGATIVE_PROMPT,
    vocalPerformance ? VOCAL_PERFORMANCE_NEGATIVE_PROMPT : ''
  );
}

function resolveComfyCloudVideoConfig(env = process.env, overrides = {}) {
  const token = firstConfiguredToken(
    overrides.token,
    env.A11_COMFY_CLOUD_API_KEY,
    env.COMFY_CLOUD_API_KEY,
    env.A11_COMFY_ORG_API_KEY,
    env.A11_COMFY_API_KEY,
    env.COMFY_ORG_API_KEY,
    env.COMFYUI_API_KEY
  );
  const configured = env.A11_VIDEO_COMFY_CLOUD_ENABLED ?? env.COMFY_CLOUD_VIDEO_ENABLED ?? '';
  const enabled = configured === '' ? Boolean(token) : !isFalsey(configured);
  return {
    enabled: Boolean(enabled && token),
    token,
    baseUrl: normalizeBaseUrl(overrides.baseUrl || env.A11_COMFY_CLOUD_BASE_URL || env.COMFY_CLOUD_BASE_URL || DEFAULT_BASE_URL),
    workflowPath: path.resolve(overrides.workflowPath || env.A11_COMFY_CLOUD_WORKFLOW_PATH || env.COMFY_CLOUD_WORKFLOW_PATH || DEFAULT_WORKFLOW_PATH),
    model: String(overrides.model || env.A11_COMFY_CLOUD_WAN_MODEL || env.A11_COMFY_WAN_MODEL || 'wan2.5-i2v-preview').trim() || 'wan2.5-i2v-preview',
    resolution: String(overrides.resolution || env.A11_COMFY_CLOUD_WAN_RESOLUTION || env.A11_COMFY_WAN_RESOLUTION || '480P').trim().toUpperCase() || '480P',
    timeoutMs: clampNumber(overrides.timeoutMs || env.A11_COMFY_CLOUD_TIMEOUT_MS || env.A11_VIDEO_COMFY_CLOUD_TIMEOUT_MS, 30_000, 3_600_000, 2_700_000),
    pollIntervalMs: clampNumber(overrides.pollIntervalMs || env.A11_COMFY_CLOUD_POLL_INTERVAL_MS, 1_000, 30_000, 5_000),
    strict: toBoolean(overrides.strict || env.A11_COMFY_CLOUD_STRICT),
  };
}

function pickReferenceImageSource(body = {}) {
  const candidates = [
    body.sourceImageUrl,
    body.source_image_url,
    body.referenceImageUrl,
    body.reference_image_url,
    body.initImageUrl,
    body.init_image_url,
    body.imageUrl,
    body.image_url,
    ...(Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls : []),
    ...(Array.isArray(body.reference_image_urls) ? body.reference_image_urls : []),
  ];
  return String(candidates.find((item) => String(item || '').trim()) || '').trim();
}

function contentTypeToExtension(contentType = '') {
  const clean = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (clean === 'image/jpeg' || clean === 'image/jpg') return '.jpg';
  if (clean === 'image/webp') return '.webp';
  if (clean === 'image/gif') return '.gif';
  return '.png';
}

function extensionToContentType(filename = '') {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function safeFilenameFromSource(source = '', contentType = '') {
  try {
    const url = new URL(source);
    const basename = path.basename(url.pathname || '').replace(/[^a-zA-Z0-9._-]+/g, '-');
    if (basename && /\.[a-z0-9]{2,5}$/i.test(basename)) return basename;
  } catch {}
  return `reference-${crypto.randomBytes(4).toString('hex')}${contentTypeToExtension(contentType)}`;
}

async function readReferenceImage(source = '', fetchImpl = globalThis.fetch) {
  const value = String(source || '').trim();
  if (!value) throw new Error('reference_image_required_for_comfy_cloud');

  if (/^data:/i.test(value)) {
    const [header, encoded = ''] = value.split(',', 2);
    const contentType = header.slice(5).split(';')[0] || 'image/png';
    return {
      filename: safeFilenameFromSource('', contentType),
      contentType,
      buffer: Buffer.from(encoded, 'base64'),
    };
  }

  if (/^https?:\/\//i.test(value)) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable_for_comfy_cloud_image');
    const response = await fetchImpl(value, { headers: { 'User-Agent': 'A11-ComfyCloud/1.0' } });
    if (!response.ok) throw new Error(`comfy_cloud_reference_download_${response.status}`);
    const contentType = response.headers?.get?.('content-type') || 'image/png';
    return {
      filename: safeFilenameFromSource(value, contentType),
      contentType,
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }

  const buffer = await fs.readFile(value);
  return {
    filename: path.basename(value),
    contentType: extensionToContentType(value),
    buffer,
  };
}

async function fetchJson(fetchImpl, url, options = {}, context = 'comfy_cloud_request') {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || payload?.detail || text || `${context}_${response.status}`;
    const error = new Error(String(message).slice(0, 400));
    error.statusCode = response.status;
    error.payload = { ok: false, error: context, status: response.status, payload };
    throw error;
  }
  return payload;
}

async function uploadInputImage({ config, source, fetchImpl }) {
  const image = await readReferenceImage(source, fetchImpl);
  if (!image.buffer.length) throw new Error('comfy_cloud_reference_empty');
  const form = new FormData();
  form.set('type', 'input');
  form.set('overwrite', 'true');
  form.set('image', new Blob([image.buffer], { type: image.contentType || 'image/png' }), image.filename);
  const payload = await fetchJson(fetchImpl, `${config.baseUrl}/api/upload/image`, {
    method: 'POST',
    headers: { 'X-API-Key': config.token },
    body: form,
  }, 'comfy_cloud_upload_image_failed');
  const filename = String(payload.name || payload.filename || image.filename || '').trim();
  if (!filename) throw new Error('comfy_cloud_upload_missing_filename');
  const subfolder = String(payload.subfolder || '').trim();
  return subfolder ? `${subfolder}/${filename}` : filename;
}

async function loadWorkflowTemplate(config) {
  const raw = await fs.readFile(config.workflowPath, 'utf8');
  return JSON.parse(raw);
}

function normalizeDurationSeconds(value, fallback = 5) {
  const requested = Math.round(Number(value || fallback) || fallback);
  if (requested <= 5) return 5;
  if (requested <= 10) return 10;
  return 15;
}

function normalizeResolution(body = {}, config = {}) {
  const requested = String(body.resolution || config.resolution || '').trim().toUpperCase();
  if (['480P', '720P', '1080P'].includes(requested)) return requested;
  const longest = Math.max(Number(body.width || 0), Number(body.height || 0));
  if (longest >= 1080) return '1080P';
  if (longest >= 720) return '720P';
  return '480P';
}

function patchComfyWorkflow(workflow, { body = {}, prompt = '', uploadedImage = '', jobId = '', config = {} }) {
  const next = JSON.parse(JSON.stringify(workflow || {}));
  const safePrompt = hardenComfyPrompt(prompt, body);
  const negative = hardenComfyNegativePrompt(String(body.negative_prompt || body.negativePrompt || '').trim(), body, safePrompt);
  const model = String(body.model || config.model || 'wan2.5-i2v-preview').trim() || 'wan2.5-i2v-preview';
  const seed = Number.isFinite(Number(body.seed))
    ? Math.round(Number(body.seed))
    : Math.floor(Math.random() * 2_147_483_000) + 1;
  const duration = normalizeDurationSeconds(body.duration_seconds || body.durationSeconds || body.duration || 5, 5);
  const resolution = normalizeResolution(body, config);
  let loadImagePatched = false;
  let videoNodePatched = false;
  let savePatched = false;

  for (const node of Object.values(next)) {
    if (!node || typeof node !== 'object') continue;
    const classType = String(node.class_type || '').trim();
    node.inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
    if (classType === 'LoadImage') {
      node.inputs.image = uploadedImage;
      loadImagePatched = true;
    } else if (classType === 'WanImageToVideoApi') {
      node.inputs.prompt = safePrompt;
      node.inputs.negative_prompt = negative;
      node.inputs.model = model;
      node.inputs.resolution = resolution;
      node.inputs.duration = duration;
      node.inputs.seed = seed;
      node.inputs.generate_audio = false;
      if (node.inputs.prompt_extend === undefined) node.inputs.prompt_extend = true;
      if (node.inputs.watermark === undefined) node.inputs.watermark = false;
      videoNodePatched = true;
    } else if (classType === 'SaveVideo') {
      node.inputs.filename_prefix = `a11-comfy-cloud/${jobId}`;
      if (!node.inputs.format) node.inputs.format = 'mp4';
      if (!node.inputs.codec) node.inputs.codec = 'h264';
      savePatched = true;
    }
  }

  if (!loadImagePatched) throw new Error('comfy_cloud_workflow_missing_load_image');
  if (!videoNodePatched) throw new Error('comfy_cloud_workflow_missing_wan_node');
  if (!savePatched) throw new Error('comfy_cloud_workflow_missing_save_video');
  return { workflow: next, model, duration, resolution, seed };
}

function normalizeStatus(value = '') {
  return String(value || '').trim().toLowerCase();
}

function extractOutputs(job = {}) {
  return job.outputs || job.output || job.result?.outputs || job.history?.outputs || {};
}

function collectOutputFiles(outputs = {}) {
  const files = [];
  const seen = new Set();
  const visit = (value, key = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }

    const filename = String(value.filename || value.name || value.display_name || '').trim();
    const url = String(value.url || value.download_url || value.downloadUrl || value.file_url || value.fileUrl || '').trim();
    const fullpath = String(value.fullpath || value.full_path || value.path || '').trim();
    const looksLikeMedia = /\.(mp4|webm|mov|mkv|gif|png|jpe?g|webp|wav|mp3)$/i.test(filename || fullpath || url);
    if ((filename || url || fullpath) && looksLikeMedia) {
      const normalizedFilename = filename && filename.includes('/') ? path.basename(filename) : filename;
      const item = {
        filename: normalizedFilename || path.basename(fullpath || url),
        displayName: filename,
        subfolder: String(value.subfolder || '').trim(),
        type: String(value.type || 'output').trim() || 'output',
        key,
        url,
        fullpath,
        format: String(value.format || '').trim(),
        workflow: String(value.workflow || '').trim(),
        timestamp: value.timestamp,
        channel: String(value.channel || '').trim(),
        mediaType: String(value.mediaType || value.media_type || '').trim(),
      };
      const dedupeKey = [item.filename, item.subfolder, item.type, item.url, item.fullpath].join('|').toLowerCase();
      if (item.filename && !seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        files.push(item);
      }
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      if (['workflow', 'prompt'].includes(childKey)) continue;
      visit(childValue, childKey);
    }
  };
  visit(outputs);
  return files;
}

function pickVideoOutput(files = []) {
  return files.find((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename))
    || files.find((file) => ['video', 'videos', 'gifs', 'files'].includes(file.key))
    || files[0]
    || null;
}

async function waitForComfyJob({ config, promptId, fetchImpl }) {
  const deadline = Date.now() + config.timeoutMs;
  let lastPayload = {};
  while (Date.now() < deadline) {
    const statusPayload = await fetchJson(fetchImpl, `${config.baseUrl}/api/job/${encodeURIComponent(promptId)}/status`, {
      headers: { 'X-API-Key': config.token },
    }, 'comfy_cloud_status_failed');
    lastPayload = statusPayload;
    const status = normalizeStatus(statusPayload.status || statusPayload.state);
    if (status === 'completed' || status === 'complete' || status === 'success' || status === 'succeeded') {
      return statusPayload;
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'error') {
      throw new Error(`comfy_cloud_job_${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
  throw new Error(`comfy_cloud_timeout:${normalizeStatus(lastPayload.status) || 'unknown'}`);
}

async function fetchComfyJob({ config, promptId, fetchImpl }) {
  return fetchJson(fetchImpl, `${config.baseUrl}/api/jobs/${encodeURIComponent(promptId)}`, {
    headers: { 'X-API-Key': config.token },
  }, 'comfy_cloud_job_fetch_failed');
}

async function fetchComfyHistoryJob({ config, promptId, fetchImpl }) {
  const payload = await fetchJson(fetchImpl, `${config.baseUrl}/api/history_v2/${encodeURIComponent(promptId)}`, {
    headers: { 'X-API-Key': config.token },
  }, 'comfy_cloud_history_fetch_failed');
  return payload?.[promptId] || payload?.history?.find?.((item) => String(item?.prompt_id || item?.prompt?.prompt_id || '') === promptId) || payload;
}

async function downloadComfyOutput({ config, fileInfo, fetchImpl }) {
  if (fileInfo.url && /^https?:\/\//i.test(fileInfo.url)) {
    const response = await fetchImpl(fileInfo.url);
    if (!response.ok) throw new Error(`comfy_cloud_output_url_${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const params = new URLSearchParams({
    filename: fileInfo.filename,
    subfolder: fileInfo.subfolder || '',
    type: fileInfo.type || 'output',
  });
  if (fileInfo.fullpath) params.set('fullpath', fileInfo.fullpath);
  if (fileInfo.format) params.set('format', fileInfo.format);
  if (fileInfo.workflow) params.set('workflow', fileInfo.workflow);
  if (fileInfo.timestamp !== undefined && fileInfo.timestamp !== null && fileInfo.timestamp !== '') params.set('timestamp', String(fileInfo.timestamp));
  if (fileInfo.channel) params.set('channel', fileInfo.channel);
  const viewResponse = await fetchImpl(`${config.baseUrl}/api/view?${params}`, {
    headers: { 'X-API-Key': config.token },
    redirect: 'manual',
  });
  if (![301, 302, 303, 307, 308].includes(viewResponse.status)) {
    if (!viewResponse.ok) throw new Error(`comfy_cloud_view_${viewResponse.status}`);
    return Buffer.from(await viewResponse.arrayBuffer());
  }
  const signedUrl = viewResponse.headers?.get?.('location');
  if (!signedUrl) throw new Error('comfy_cloud_view_missing_location');
  const fileResponse = await fetchImpl(signedUrl);
  if (!fileResponse.ok) throw new Error(`comfy_cloud_output_download_${fileResponse.status}`);
  return Buffer.from(await fileResponse.arrayBuffer());
}

async function tryGenerateVideoWithComfyCloud({
  body = {},
  prompt = '',
  fetchImpl = globalThis.fetch,
  uploadBufferToR2Impl = uploadBufferToR2,
  tokenOverride = '',
  configOverrides = {},
} = {}) {
  const config = resolveComfyCloudVideoConfig(process.env, { ...configOverrides, token: tokenOverride || configOverrides.token });
  if (!config.enabled) {
    return { ok: false, error: 'comfy_cloud_not_configured', message: 'Comfy Cloud API key missing or disabled.' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch_unavailable', message: 'fetch_unavailable' };
  }
  const source = pickReferenceImageSource(body);
  if (!source) {
    return { ok: false, error: 'reference_image_required_for_comfy_cloud', message: 'Comfy Cloud Wan image-to-video needs a cover/reference image.' };
  }
  const cleanPrompt = String(prompt || body.prompt || body.message || '').trim();
  if (!cleanPrompt) return { ok: false, error: 'prompt_required', message: 'prompt_required' };

  try {
    const jobId = `wan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const uploadedImage = await uploadInputImage({ config, source, fetchImpl });
    const baseWorkflow = await loadWorkflowTemplate(config);
    const patched = patchComfyWorkflow(baseWorkflow, {
      body,
      prompt: cleanPrompt,
      uploadedImage,
      jobId,
      config,
    });
    const queued = await fetchJson(fetchImpl, `${config.baseUrl}/api/prompt`, {
      method: 'POST',
      headers: { 'X-API-Key': config.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: patched.workflow,
        client_id: crypto.randomUUID(),
        extra_data: { api_key_comfy_org: config.token },
      }),
    }, 'comfy_cloud_prompt_failed');
    const promptId = String(queued.prompt_id || queued.promptId || queued.id || '').trim();
    if (!promptId) throw new Error('comfy_cloud_prompt_id_missing');
    console.log(`[A11][comfy-cloud] queued job=${promptId} model=${patched.model} duration=${patched.duration}s resolution=${patched.resolution}`);
    await waitForComfyJob({ config, promptId, fetchImpl });
    const job = await fetchComfyJob({ config, promptId, fetchImpl });
    let fileInfo = pickVideoOutput(collectOutputFiles({
      outputs: extractOutputs(job),
      preview_output: job?.preview_output,
      result: job?.result,
    }));
    if (!fileInfo) {
      const historyJob = await fetchComfyHistoryJob({ config, promptId, fetchImpl }).catch(() => null);
      fileInfo = pickVideoOutput(collectOutputFiles({
        outputs: extractOutputs(historyJob || {}),
        preview_output: historyJob?.preview_output,
        history: historyJob,
      }));
    }
    if (!fileInfo) throw new Error('comfy_cloud_output_missing');
    const buffer = await downloadComfyOutput({ config, fileInfo, fetchImpl });
    if (!buffer.length) throw new Error('comfy_cloud_output_empty');
    const extension = path.extname(fileInfo.filename || '') || '.mp4';
    const uploaded = await uploadBufferToR2Impl({
      userId: 'vivy-twitch-live',
      filename: `${jobId}${extension}`,
      buffer,
      contentType: extension.toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4',
    });
    const publicUrl = uploaded?.url || uploaded?.publicUrl || uploaded?.href || '';
    return {
      ok: true,
      tool: 'generate_video',
      provider: 'comfy_cloud',
      providerLabel: 'Comfy Cloud',
      model: patched.model,
      resolution: patched.resolution,
      durationSeconds: patched.duration,
      seed: patched.seed,
      prompt: cleanPrompt,
      prompt_id: promptId,
      promptId,
      filename: uploaded?.filename || path.basename(fileInfo.filename || `${jobId}.mp4`),
      video_url: publicUrl,
      videoUrl: publicUrl,
      url: publicUrl,
      r2: uploaded,
      imageReferenceSupported: true,
      chargedCredits: 'comfy_cloud',
    };
  } catch (error) {
    return {
      ok: false,
      error: 'comfy_cloud_video_failed',
      message: String(error?.message || error || 'comfy_cloud_video_failed').slice(0, 500),
      statusCode: error?.statusCode || 502,
      payload: error?.payload,
    };
  }
}

module.exports = {
  DEFAULT_WORKFLOW_PATH,
  patchComfyWorkflow,
  resolveComfyCloudVideoConfig,
  tryGenerateVideoWithComfyCloud,
};

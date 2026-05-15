const path = require('node:path');
const fsp = require('node:fs/promises');
const { uploadBufferToR2 } = require('./file-storage.cjs');

function isHuggingFaceImageEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(env.A11_ENABLE_HF_IMAGE || env.A11_ENABLE_HUGGINGFACE_IMAGE || '').trim().toLowerCase()
  );
}

function resolveHuggingFaceImageConfig(env = process.env) {
  const enabled = isHuggingFaceImageEnabled(env);
  const token = String(
    env.A11_HF_IMAGE_TOKEN
    || env.A11_HUGGINGFACE_IMAGE_TOKEN
    || env.HF_TOKEN
    || env.HF_API_KEY
    || env.HUGGINGFACE_HUB_TOKEN
    || env.HUGGINGFACEHUB_API_TOKEN
    || ''
  ).trim();
  const endpoint = String(
    env.A11_HF_IMAGE_ENDPOINT
    || env.A11_HUGGINGFACE_IMAGE_ENDPOINT
    || 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell'
  ).trim();
  const defaultSteps = Math.max(1, Math.min(12, Math.round(Number(env.A11_HF_IMAGE_STEPS || 4) || 4)));
  return { enabled, token, endpoint, defaultSteps };
}

function normalizeHfImageDimension(value, fallback = 512) {
  const numeric = Number(value || fallback);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  const clamped = Math.max(256, Math.min(1024, Math.round(numeric)));
  return Math.round(clamped / 8) * 8;
}

function imageExtensionFromContentType(contentType = '') {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  return '.jpg';
}

function outputPathWithExtension(outputPath = '', extension = '.jpg') {
  const rawExt = String(extension ?? '').trim();
  const safeExt = rawExt || '.jpg';
  const normalizedExt = safeExt.startsWith('.') ? safeExt : `.${safeExt}`;
  const parsed = path.parse(String(outputPath || '').trim());
  if (!parsed.dir || !parsed.name) return String(outputPath || '').trim();
  return path.join(parsed.dir, `${parsed.name}${normalizedExt}`);
}

async function tryGenerateImageWithHuggingFace({
  prompt,
  outputPath,
  width,
  height,
  steps,
  guidanceScale,
  userId = 'image-tool',
}) {
  const config = resolveHuggingFaceImageConfig();
  if (!config.enabled) {
    return {
      ok: false,
      error: 'hf_image_disabled',
      message: 'La generation image Hugging Face est desactivee sur cet environnement.',
    };
  }
  if (!config.token) {
    return {
      ok: false,
      error: 'hf_image_unconfigured',
      message: 'HF_TOKEN manquant pour la generation image Hugging Face.',
    };
  }
  if (!config.endpoint) {
    return {
      ok: false,
      error: 'hf_image_endpoint_missing',
      message: 'Endpoint Hugging Face image manquant.',
    };
  }

  const payload = {
    inputs: String(prompt || '').trim(),
    parameters: {
      width: normalizeHfImageDimension(width, 512),
      height: normalizeHfImageDimension(height, 512),
      num_inference_steps: Math.max(1, Math.min(12, Math.round(Number(steps || config.defaultSteps) || config.defaultSteps))),
      ...(Number.isFinite(Number(guidanceScale)) ? { guidance_scale: Number(guidanceScale) } : {}),
    },
  };

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      Accept: 'image/jpeg',
    },
    body: JSON.stringify(payload),
  }).catch((error_) => ({
    ok: false,
    status: 0,
    headers: new Map(),
    text: async () => String(error_?.message || error_),
    arrayBuffer: async () => Buffer.alloc(0),
  }));

  const contentType = String(response.headers?.get?.('content-type') || '').trim();
  if (!response.ok || contentType.includes('application/json') || contentType.includes('text/')) {
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return {
      ok: false,
      error: String(body?.error || body?.error_type || 'hf_image_failed'),
      message: String(body?.message || body?.error || text || `hf_image_status_${response.status}`),
      statusCode: Number(response.status || 0) || undefined,
    };
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (!imageBuffer.length) {
    return {
      ok: false,
      error: 'hf_image_missing_payload',
      message: 'La reponse Hugging Face image est vide.',
      statusCode: Number(response.status || 0) || undefined,
    };
  }

  const finalOutputPath = outputPathWithExtension(outputPath, imageExtensionFromContentType(contentType));
  await fsp.writeFile(finalOutputPath, imageBuffer);

  let uploadedUrl = '';
  try {
    const uploadResult = await uploadBufferToR2({
      userId,
      filename: path.basename(finalOutputPath),
      buffer: imageBuffer,
      contentType: contentType || 'image/jpeg',
    });
    uploadedUrl = String(uploadResult?.url || '').trim();
  } catch {
    // Local file serving remains a valid fallback.
  }

  return {
    ok: true,
    outputPath: finalOutputPath,
    width: payload.parameters.width,
    height: payload.parameters.height,
    mode: 'huggingface-image',
    prompt: String(prompt || '').trim(),
    sourceUrl: uploadedUrl || null,
    model: config.endpoint.split('/models/')[1] || config.endpoint,
    contentType: contentType || 'image/jpeg',
  };
}

module.exports = {
  tryGenerateImageWithHuggingFace,
  resolveHuggingFaceImageConfig,
  isHuggingFaceImageEnabled,
};

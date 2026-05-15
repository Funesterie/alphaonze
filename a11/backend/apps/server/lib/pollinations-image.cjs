const path = require('node:path');
const fsp = require('node:fs/promises');
const { uploadBufferToR2 } = require('./file-storage.cjs');

function isPollinationsImageEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(env.A11_ENABLE_POLLINATIONS_IMAGE || env.A11_ENABLE_POLLINATIONS || '').trim().toLowerCase()
  );
}

function resolvePollinationsImageConfig(env = process.env) {
  const enabled = isPollinationsImageEnabled(env);
  const baseUrl = String(
    env.A11_POLLINATIONS_IMAGE_BASE_URL
    || 'https://image.pollinations.ai/prompt'
  ).trim().replace(/\/+$/, '');
  const model = String(env.A11_POLLINATIONS_IMAGE_MODEL || 'flux').trim() || 'flux';
  const referrer = String(env.A11_POLLINATIONS_REFERRER || 'funesterie-a11').trim() || 'funesterie-a11';
  const timeoutMs = Math.max(10000, Math.min(120000, Number(env.A11_POLLINATIONS_IMAGE_TIMEOUT_MS || 60000) || 60000));
  return { enabled, baseUrl, model, referrer, timeoutMs };
}

function clampImageDimension(value, fallback = 512) {
  const numeric = Number(value || fallback);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  const clamped = Math.max(256, Math.min(1536, Math.round(numeric)));
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
  const parsed = path.parse(String(outputPath || '').trim());
  if (!parsed.dir || !parsed.name) return String(outputPath || '').trim();
  const safeExt = String(extension || '.jpg').startsWith('.') ? String(extension || '.jpg') : `.${extension}`;
  return path.join(parsed.dir, `${parsed.name}${safeExt}`);
}

function buildPollinationsUrl({
  prompt,
  width,
  height,
  seed,
  model,
  referrer,
  baseUrl,
}) {
  const params = new URLSearchParams();
  params.set('width', String(clampImageDimension(width, 512)));
  params.set('height', String(clampImageDimension(height, 512)));
  params.set('model', String(model || 'flux'));
  params.set('nologo', 'true');
  params.set('private', 'true');
  params.set('safe', 'true');
  params.set('referrer', String(referrer || 'funesterie-a11'));
  if (seed !== undefined && seed !== null && String(seed).trim() !== '') {
    params.set('seed', String(seed).trim());
  }
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${encodeURIComponent(String(prompt || '').trim())}?${params.toString()}`;
}

async function tryGenerateImageWithPollinations({
  prompt,
  outputPath,
  width,
  height,
  seed,
  userId = 'image-tool',
}) {
  const config = resolvePollinationsImageConfig();
  if (!config.enabled) {
    return {
      ok: false,
      error: 'pollinations_image_disabled',
      message: 'La generation image Pollinations est desactivee sur cet environnement.',
    };
  }

  const imageUrl = buildPollinationsUrl({
    prompt,
    width,
    height,
    seed,
    model: config.model,
    referrer: config.referrer,
    baseUrl: config.baseUrl,
  });

  const response = await fetch(imageUrl, {
    headers: {
      Accept: 'image/jpeg,image/png,image/webp,*/*',
    },
    signal: AbortSignal.timeout(config.timeoutMs),
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
    return {
      ok: false,
      error: 'pollinations_image_failed',
      message: text || `pollinations_image_status_${response.status}`,
      statusCode: Number(response.status || 0) || undefined,
      model: config.model,
    };
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (!imageBuffer.length) {
    return {
      ok: false,
      error: 'pollinations_image_missing_payload',
      message: 'La reponse Pollinations image est vide.',
      statusCode: Number(response.status || 0) || undefined,
      model: config.model,
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
    width: clampImageDimension(width, 512),
    height: clampImageDimension(height, 512),
    mode: 'pollinations-image',
    prompt: String(prompt || '').trim(),
    sourceUrl: uploadedUrl || imageUrl,
    model: config.model,
    contentType: contentType || 'image/jpeg',
  };
}

module.exports = {
  tryGenerateImageWithPollinations,
  resolvePollinationsImageConfig,
  isPollinationsImageEnabled,
};

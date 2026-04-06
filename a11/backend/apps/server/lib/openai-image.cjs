const path = require('node:path');
const fsp = require('node:fs/promises');
const axios = require('axios');
const { uploadBufferToR2 } = require('./file-storage.cjs');

function resolveOpenAiImageConfig() {
  const apiKey = String(
    process.env.A11_OPENAI_IMAGE_API_KEY
    || process.env.OPENAI_API_KEY
    || ''
  ).trim();
  const baseUrl = String(
    process.env.A11_OPENAI_IMAGE_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'https://api.openai.com/v1'
  ).trim().replace(/\/+$/, '');
  const model = String(
    process.env.A11_OPENAI_IMAGE_MODEL
    || process.env.OPENAI_IMAGE_MODEL
    || 'gpt-image-1-mini'
  ).trim() || 'gpt-image-1-mini';
  const quality = String(process.env.A11_OPENAI_IMAGE_QUALITY || 'medium').trim() || 'medium';
  return { apiKey, baseUrl, model, quality };
}

function resolveOpenAiImageSize(width, height) {
  const safeWidth = Number(width || 1024) || 1024;
  const safeHeight = Number(height || 1024) || 1024;
  if (safeWidth === safeHeight) return '1024x1024';
  return safeHeight > safeWidth ? '1024x1536' : '1536x1024';
}

function decodeBase64Image(rawValue) {
  const base64 = String(rawValue || '').trim();
  if (!base64) return null;
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

async function tryGeneratePngWithOpenAI({
  prompt,
  outputPath,
  width,
  height,
  userId = 'image-tool',
}) {
  const config = resolveOpenAiImageConfig();
  if (!config.apiKey) {
    return {
      ok: false,
      error: 'openai_image_unconfigured',
      message: 'OPENAI_API_KEY manquante pour la generation image OpenAI.',
    };
  }

  const size = resolveOpenAiImageSize(width, height);
  const endpoint = `${config.baseUrl}/images/generations`;
  const payload = {
    model: config.model,
    prompt: String(prompt || '').trim(),
    size,
    quality: config.quality,
    output_format: 'png',
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).catch((error_) => ({
    ok: false,
    status: 0,
    text: async () => String(error_?.message || error_),
  }));

  const rawText = await response.text();
  let body = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: String(body?.error?.code || body?.error?.type || 'openai_image_failed'),
      message: String(body?.error?.message || rawText || `openai_image_status_${response.status}`),
      statusCode: Number(response.status || 0) || undefined,
      model: config.model,
    };
  }

  const firstImage = Array.isArray(body?.data) ? body.data[0] : null;
  let imageBuffer = decodeBase64Image(firstImage?.b64_json);
  const remoteUrl = String(firstImage?.url || '').trim();

  if (!imageBuffer && remoteUrl) {
    try {
      const imageResponse = await axios.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
      });
      imageBuffer = Buffer.from(imageResponse.data);
    } catch (error_) {
      return {
        ok: false,
        error: 'openai_image_download_failed',
        message: String(error_?.message || error_),
        statusCode: Number(response.status || 0) || undefined,
        model: config.model,
      };
    }
  }

  if (!imageBuffer || !imageBuffer.length) {
    return {
      ok: false,
      error: 'openai_image_missing_payload',
      message: 'La reponse OpenAI image ne contient ni b64_json ni URL exploitable.',
      statusCode: Number(response.status || 0) || undefined,
      model: config.model,
    };
  }

  await fsp.writeFile(outputPath, imageBuffer);

  let uploadedUrl = '';
  try {
    const uploadResult = await uploadBufferToR2({
      userId,
      filename: path.basename(outputPath),
      buffer: imageBuffer,
      contentType: 'image/png',
    });
    uploadedUrl = String(uploadResult?.url || '').trim();
  } catch {
    // Local file serving remains a valid fallback.
  }

  return {
    ok: true,
    outputPath,
    width,
    height,
    mode: 'openai-image',
    prompt: String(prompt || '').trim(),
    sourceUrl: uploadedUrl || remoteUrl || null,
    model: config.model,
    size,
  };
}

function looksLikeOpenAiQuotaError(result = {}) {
  const statusCode = Number(result?.statusCode || 0);
  const errorCode = String(result?.error || '').trim().toLowerCase();
  const message = String(result?.message || '').trim().toLowerCase();

  if (statusCode === 429) return true;
  if (errorCode.includes('insufficient_quota')) return true;
  if (errorCode.includes('billing')) return true;
  if (message.includes('billing hard limit')) return true;
  if (message.includes('insufficient quota')) return true;
  if (message.includes('exceeded your current quota')) return true;
  return false;
}

module.exports = {
  tryGeneratePngWithOpenAI,
  looksLikeOpenAiQuotaError,
  resolveOpenAiImageConfig,
  resolveOpenAiImageSize,
};

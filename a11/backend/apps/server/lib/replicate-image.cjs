const path = require('node:path');
const fsp = require('node:fs/promises');
const { uploadBufferToR2 } = require('./file-storage.cjs');

function isReplicateImageEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(env.A11_ENABLE_REPLICATE_IMAGE || env.A11_ENABLE_REPLICATE || '').trim().toLowerCase()
  );
}

function resolveReplicateImageConfig(env = process.env) {
  const enabled = isReplicateImageEnabled(env);
  const token = String(
    env.A11_REPLICATE_IMAGE_TOKEN
    || env.REPLICATE_API_TOKEN
    || env.REPLICATE_TOKEN
    || ''
  ).trim();
  const model = String(
    env.A11_REPLICATE_IMAGE_MODEL
    || env.REPLICATE_IMAGE_MODEL
    || 'black-forest-labs/flux-schnell'
  ).trim() || 'black-forest-labs/flux-schnell';
  const baseUrl = String(env.A11_REPLICATE_BASE_URL || 'https://api.replicate.com/v1').trim().replace(/\/+$/, '');
  const timeoutMs = Math.max(10000, Math.min(180000, Number(env.A11_REPLICATE_IMAGE_TIMEOUT_MS || 90000) || 90000));
  const defaultSteps = Math.max(1, Math.min(4, Math.round(Number(env.A11_REPLICATE_IMAGE_STEPS || 4) || 4)));
  return { enabled, token, model, baseUrl, timeoutMs, defaultSteps };
}

function imageExtensionFromContentType(contentType = '') {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  return '.webp';
}

function outputPathWithExtension(outputPath = '', extension = '.webp') {
  const parsed = path.parse(String(outputPath || '').trim());
  if (!parsed.dir || !parsed.name) return String(outputPath || '').trim();
  const safeExt = String(extension || '.webp').startsWith('.') ? String(extension || '.webp') : `.${extension}`;
  return path.join(parsed.dir, `${parsed.name}${safeExt}`);
}

function normalizeReplicateAspectRatio(width, height) {
  const w = Math.max(1, Number(width || 1024) || 1024);
  const h = Math.max(1, Number(height || 1024) || 1024);
  const ratio = w / h;
  const options = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
  ];
  let best = options[0];
  let bestDistance = Math.abs(ratio - best[1]);
  for (const option of options.slice(1)) {
    const distance = Math.abs(ratio - option[1]);
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return best[0];
}

function resolveReplicateOutputUrl(prediction = {}) {
  const output = prediction?.output;
  if (typeof output === 'string' && output) return output;
  if (Array.isArray(output)) {
    const first = output.find((item) => typeof item === 'string' && item);
    if (first) return first;
  }
  if (output && typeof output === 'object') {
    for (const value of Object.values(output)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
      if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === 'string' && /^https?:\/\//i.test(item));
        if (first) return first;
      }
    }
  }
  return '';
}

async function parseJsonResponse(response) {
  const rawText = await response.text();
  try {
    return rawText ? JSON.parse(rawText) : null;
  } catch {
    return { rawText };
  }
}

async function fetchPredictionUntilDone({ prediction, token, timeoutMs }) {
  let current = prediction;
  const getUrl = String(prediction?.urls?.get || '').trim();
  if (!getUrl) return current;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = String(current?.status || '').trim().toLowerCase();
    if (status === 'succeeded' || status === 'failed' || status === 'canceled') return current;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    current = await parseJsonResponse(response);
    if (!response.ok) return current;
  }
  return {
    ...current,
    status: current?.status || 'timeout',
    error: 'replicate_prediction_timeout',
  };
}

async function tryGenerateImageWithReplicate({
  prompt,
  outputPath,
  width,
  height,
  steps,
  userId = 'image-tool',
}) {
  const config = resolveReplicateImageConfig();
  if (!config.enabled) {
    return {
      ok: false,
      error: 'replicate_image_disabled',
      message: 'La generation image Replicate est desactivee sur cet environnement.',
    };
  }
  if (!config.token) {
    return {
      ok: false,
      error: 'replicate_image_unconfigured',
      message: 'REPLICATE_API_TOKEN manquant pour la generation image Replicate.',
    };
  }

  const modelPath = config.model.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${config.baseUrl}/models/${modelPath}/predictions`;
  const stepCount = Math.max(1, Math.min(4, Math.round(Number(steps || config.defaultSteps) || config.defaultSteps)));
  const payload = {
    input: {
      prompt: String(prompt || '').trim(),
      num_inference_steps: stepCount,
      aspect_ratio: normalizeReplicateAspectRatio(width, height),
      output_format: 'webp',
      output_quality: 85,
      num_outputs: 1,
      disable_safety_checker: false,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      Prefer: `wait=${Math.min(60, Math.ceil(config.timeoutMs / 1000))}`,
    },
    body: JSON.stringify(payload),
  }).catch((error_) => ({
    ok: false,
    status: 0,
    text: async () => String(error_?.message || error_),
  }));

  let prediction = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      error: String(prediction?.detail || prediction?.error || 'replicate_image_failed'),
      message: String(prediction?.detail || prediction?.error || prediction?.rawText || `replicate_image_status_${response.status}`),
      statusCode: Number(response.status || 0) || undefined,
      model: config.model,
    };
  }

  prediction = await fetchPredictionUntilDone({
    prediction,
    token: config.token,
    timeoutMs: config.timeoutMs,
  });

  if (String(prediction?.status || '').toLowerCase() !== 'succeeded') {
    return {
      ok: false,
      error: String(prediction?.error || `replicate_prediction_${prediction?.status || 'unknown'}`),
      message: String(prediction?.error || prediction?.logs || `Replicate prediction status: ${prediction?.status || 'unknown'}`).slice(0, 1200),
      statusCode: Number(response.status || 0) || undefined,
      model: config.model,
    };
  }

  const imageUrl = resolveReplicateOutputUrl(prediction);
  if (!imageUrl) {
    return {
      ok: false,
      error: 'replicate_image_missing_output',
      message: 'La reponse Replicate ne contient pas d URL image exploitable.',
      model: config.model,
    };
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    return {
      ok: false,
      error: 'replicate_image_download_failed',
      message: `replicate_image_download_status_${imageResponse.status}`,
      statusCode: Number(imageResponse.status || 0) || undefined,
      model: config.model,
    };
  }

  const contentType = String(imageResponse.headers?.get?.('content-type') || 'image/webp').trim();
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!imageBuffer.length) {
    return {
      ok: false,
      error: 'replicate_image_empty_download',
      message: 'Le fichier image Replicate telecharge est vide.',
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
      contentType: contentType || 'image/webp',
    });
    uploadedUrl = String(uploadResult?.url || '').trim();
  } catch {
    // Local file serving remains a valid fallback.
  }

  return {
    ok: true,
    outputPath: finalOutputPath,
    width: Number(width || 0) || undefined,
    height: Number(height || 0) || undefined,
    mode: 'replicate-image',
    prompt: String(prompt || '').trim(),
    sourceUrl: uploadedUrl || imageUrl,
    model: config.model,
    predictionId: prediction?.id || null,
    contentType: contentType || 'image/webp',
  };
}

async function tryGenerateImageWithReplicateKontext({
  prompt,
  inputImageUrl,
  outputPath,
  width,
  height,
  userId = 'image-tool',
  env = process.env,
}) {
  const config = resolveReplicateImageConfig(env);
  const token = config.token || String(env.REPLICATE_API_TOKEN || '').trim();
  if (!token) {
    return { ok: false, error: 'replicate_kontext_unconfigured', message: 'REPLICATE_API_TOKEN manquant.' };
  }
  if (!inputImageUrl || !/^https?:\/\//i.test(String(inputImageUrl))) {
    return { ok: false, error: 'replicate_kontext_no_image', message: 'input_image_url manquant ou non-HTTP.' };
  }

  const kontextModel = String(env.A11_REPLICATE_KONTEXT_MODEL || 'black-forest-labs/flux-kontext-pro').trim();
  const modelPath = kontextModel.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${config.baseUrl}/models/${modelPath}/predictions`;

  const payload = {
    input: {
      prompt: String(prompt || '').trim(),
      input_image: String(inputImageUrl).trim(),
      aspect_ratio: normalizeReplicateAspectRatio(width, height),
      output_format: 'jpg',  // flux-kontext-pro n'accepte que jpg/png, pas webp
      output_quality: 85,
      safety_tolerance: 2,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: `wait=${Math.min(60, Math.ceil(config.timeoutMs / 1000))}`,
    },
    body: JSON.stringify(payload),
  }).catch((error_) => ({
    ok: false,
    status: 0,
    text: async () => String(error_?.message || error_),
  }));

  let prediction = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      error: String(prediction?.detail || prediction?.error || 'replicate_kontext_failed'),
      message: String(prediction?.detail || prediction?.error || prediction?.rawText || `replicate_kontext_status_${response.status}`),
      statusCode: Number(response.status || 0) || undefined,
      model: kontextModel,
    };
  }

  prediction = await fetchPredictionUntilDone({ prediction, token, timeoutMs: config.timeoutMs });

  if (String(prediction?.status || '').toLowerCase() !== 'succeeded') {
    return {
      ok: false,
      error: String(prediction?.error || `replicate_kontext_${prediction?.status || 'unknown'}`),
      message: String(prediction?.error || prediction?.logs || `Replicate Kontext status: ${prediction?.status || 'unknown'}`).slice(0, 1200),
      model: kontextModel,
    };
  }

  const imageUrl = resolveReplicateOutputUrl(prediction);
  if (!imageUrl) {
    return { ok: false, error: 'replicate_kontext_missing_output', message: 'Kontext: pas d URL image.', model: kontextModel };
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    return { ok: false, error: 'replicate_kontext_download_failed', message: `download_status_${imageResponse.status}`, model: kontextModel };
  }

  const contentType = String(imageResponse.headers?.get?.('content-type') || 'image/webp').trim();
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!imageBuffer.length) {
    return { ok: false, error: 'replicate_kontext_empty_download', model: kontextModel };
  }

  const finalOutputPath = outputPathWithExtension(outputPath, imageExtensionFromContentType(contentType));
  await fsp.writeFile(finalOutputPath, imageBuffer);

  let uploadedUrl = '';
  try {
    const uploadResult = await uploadBufferToR2({
      userId,
      filename: path.basename(finalOutputPath),
      buffer: imageBuffer,
      contentType: contentType || 'image/webp',
    });
    uploadedUrl = String(uploadResult?.url || '').trim();
  } catch {
    // ok, local fallback
  }

  return {
    ok: true,
    outputPath: finalOutputPath,
    width: Number(width || 0) || undefined,
    height: Number(height || 0) || undefined,
    mode: 'replicate-kontext',
    prompt: String(prompt || '').trim(),
    inputImageUrl: String(inputImageUrl).trim(),
    sourceUrl: uploadedUrl || imageUrl,
    model: kontextModel,
    predictionId: prediction?.id || null,
    contentType: contentType || 'image/webp',
  };
}

module.exports = {
  tryGenerateImageWithReplicate,
  tryGenerateImageWithReplicateKontext,
  resolveReplicateImageConfig,
  isReplicateImageEnabled,
};

const buildMaskImageGenerateFromText = require('./text-to-mask-image-generate.cjs');
const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');
const validateMaskImageGenerate = require('./validate-mask-image-generate.cjs');
const compileMaskToSD = require('./compile-mask-to-sd.cjs');
const compileMaskImageToPython = require('./compile-mask-image-to-python.cjs');
const adaptMaskToFreelandValue = require('./adapt-mask-to-freeland-value.cjs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  ANIMAL_SUBJECT_PATTERN,
  inferExpectedImageContract,
  normalizeText,
  resolveVisionConfig,
  verifyGeneratedImageCardinality,
  buildRetrySdBody,
} = require('../image/verify-generated-image-cardinality.cjs');

function extractLatestUserMessage(body = {}) {
  if (typeof body?.message === 'string' && body.message.trim()) return body.message.trim();
  if (typeof body?.prompt === 'string' && body.prompt.trim()) return body.prompt.trim();

  if (Array.isArray(body?.messages)) {
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const entry = body.messages[index];
      if (String(entry?.role || '').trim().toLowerCase() !== 'user') continue;

      if (typeof entry?.content === 'string' && entry.content.trim()) {
        return entry.content.trim();
      }

      if (Array.isArray(entry?.content)) {
        const text = entry.content
          .map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
            return '';
          })
          .join(' ')
          .trim();
        if (text) return text;
      }
    }
  }

  return '';
}

function buildSdRequestBody(mask, compiledPayload) {
  const payload = resolveCompiledSdPayload(compiledPayload);

  return {
    prompt: String(payload.prompt || mask?.raw || '').trim(),
    negative_prompt: String(payload.negative_prompt || '').trim(),
    prompt_prebuilt: true,
    negative_prompt_prebuilt: true,
    width: Number(payload.width || mask?.options?.width || 768),
    height: Number(payload.height || mask?.options?.height || 768),
    num_inference_steps: Number(payload.steps || mask?.options?.steps || 30),
    guidance_scale: Number(payload.guidance_scale || mask?.options?.guidance_scale || 7.5),
    ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
    ...(payload.sampler ? { sampler: payload.sampler } : {}),
  };
}

function resolveCompiledSdPayload(compiledPayload) {
  const candidates = [
    compiledPayload?.value?.payload,
    compiledPayload?.value?.sdPayload,
    compiledPayload?.value?.sdBody,
    compiledPayload?.payload,
    compiledPayload?.sdPayload,
    compiledPayload?.sdBody,
    compiledPayload,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    if (
      'prompt' in candidate
      || 'negative_prompt' in candidate
      || 'width' in candidate
      || 'height' in candidate
    ) {
      return candidate;
    }
  }

  return {};
}

function compileMaskImage(mask) {
  const compilerTarget = String(mask?.compiler?.target || '').trim().toLowerCase();
  if (compilerTarget === 'python') {
    return compileMaskImageToPython(mask);
  }
  return compileMaskToSD(mask);
}

function compileMaskImageGenerate(rawMask) {
  const mask = normalizeMaskImageGenerate(rawMask);
  const validation = validateMaskImageGenerate(mask);
  if (!validation.valid) {
    const error = new Error('invalid_mask');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'invalid_mask',
      details: validation.errors,
      mask,
    };
    throw error;
  }

  const compiledPayload = compileMaskImage(mask);
  const compiled = adaptMaskToFreelandValue(mask, compiledPayload);
  const sdBody = buildSdRequestBody(mask, compiledPayload);

  return {
    mask,
    compiledPayload,
    compiled,
    sdBody,
  };
}

function buildImageVerificationRequestId(compiledState = {}) {
  const subject = String(compiledState?.mask?.inputs?.subject?.[0] || compiledState?.mask?.raw || 'image').trim();
  const slug = subject
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image';
  return `img-${slug}-${Date.now()}`;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getConfiguredImageVerificationFlag() {
  for (const rawValue of [
    process.env.A11_IMAGE_CARDINALITY_GUARD,
    process.env.A11_IMAGE_VERIFY_CARDINALITY,
  ]) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (!normalized) continue;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return null;
}

function looksLikeSingleAnimalContract(expectedImageContract = {}, compiledState = {}) {
  if (Number(expectedImageContract?.subjectCount || 0) !== 1) return false;
  if (expectedImageContract?.allowGroup === true) return false;

  const candidates = [
    expectedImageContract?.subjectLabel,
    expectedImageContract?.subjectType,
    compiledState?.mask?.inputs?.subject?.[0],
    compiledState?.sdBody?.prompt,
  ];

  return candidates.some((value) => ANIMAL_SUBJECT_PATTERN.test(normalizeText(value)));
}

function isImageVerificationEnabled(explicitValue, { expectedImageContract, compiledState } = {}) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const configuredFlag = getConfiguredImageVerificationFlag();
  if (configuredFlag !== null) return configuredFlag;
  if (!resolveVisionConfig().available) return false;
  return looksLikeSingleAnimalContract(expectedImageContract, compiledState);
}

function resolveMaxVerificationRetries(explicitValue) {
  if (explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
    const numeric = Number(explicitValue);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  }
  const fromEnv = Number(
    process.env.A11_IMAGE_CARDINALITY_MAX_RETRIES
    || process.env.A11_IMAGE_VERIFY_MAX_RETRIES
    || 1
  );
  return Number.isFinite(fromEnv) ? Math.max(0, Math.floor(fromEnv)) : 1;
}

function buildCompiledPromptHash(sdBody = {}) {
  return crypto
    .createHash('sha1')
    .update(`${String(sdBody?.prompt || '').trim()}\n--\n${String(sdBody?.negative_prompt || '').trim()}`)
    .digest('hex')
    .slice(0, 16);
}

async function generateImageFromMask({
  req,
  rawMask,
  generateSd,
  verifyImageCardinality = verifyGeneratedImageCardinality,
  imageVerificationEnabled,
  maxVerificationRetries,
}) {
  const compiledState = compileMaskImageGenerate(rawMask);

  if (typeof generateSd !== 'function') {
    const error = new Error('generateSd handler unavailable');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'sd_unavailable',
      message: 'generateSd handler unavailable',
    };
    throw error;
  }

  const requestId = buildImageVerificationRequestId(compiledState);
  const expectedImageContract = inferExpectedImageContract({
    mask: compiledState.mask,
    compiledState,
  });
  const guardEnabled = isImageVerificationEnabled(imageVerificationEnabled, {
    expectedImageContract,
    compiledState,
  });
  const resolvedMaxVerificationRetries = resolveMaxVerificationRetries(maxVerificationRetries);
  const attempts = [];

  let activeSdBody = { ...compiledState.sdBody };
  let compiledPromptHash = buildCompiledPromptHash(activeSdBody);
  console.log(
    `[A11][image-guard] start requestId=${requestId} enabled=${guardEnabled} promptHash=${compiledPromptHash} seed=${activeSdBody.seed ?? 'none'}`
  );
  let sdResult = await generateSd({
    req,
    prompt: activeSdBody.prompt,
    body: activeSdBody,
  });
  attempts.push({
    attempt: 1,
    prompt_hash: compiledPromptHash,
    prompt: String(activeSdBody.prompt || '').trim(),
    negative_prompt: String(activeSdBody.negative_prompt || '').trim(),
    seed: activeSdBody.seed,
    image_url: resolveGeneratedImageUrl(sdResult),
  });

  let verification = null;
  const retryHistory = [];
  if (guardEnabled && typeof verifyImageCardinality === 'function' && expectedImageContract?.enabled) {
    try {
      verification = await verifyImageCardinality({
        imageUrl: resolveGeneratedImageUrl(sdResult),
        expected: expectedImageContract,
        requestId,
        prompt: String(activeSdBody.prompt || '').trim(),
        seed: activeSdBody.seed,
      });
    } catch (error_) {
      verification = {
        ok: false,
        skipped: true,
        reason: 'vision_verify_failed',
        message: String(error_?.message || error_),
      };
    }
    console.log(
      `[A11][image-guard] verify requestId=${requestId} promptHash=${compiledPromptHash} status=${verification?.ok ? 'ok' : 'skip'} reason=${verification?.decision?.reason || verification?.reason || 'unknown'}`
    );

    let retryCount = 0;
    while (
      retryCount < resolvedMaxVerificationRetries
      && verification?.ok
      && verification?.decision?.retry === true
    ) {
      retryCount += 1;
      console.log(
        `[A11][image-guard] retry=${retryCount} requestId=${requestId} reason=${verification.decision.reason} observed=${verification.observed?.subject_count} expected=${verification.expected?.subject_count}`
      );
      retryHistory.push({
        retry: retryCount,
        reason: String(verification?.decision?.reason || '').trim() || 'verification_retry',
        observed_subject_count: Number(verification?.observed?.subject_count || 0),
        confidence: Number(verification?.observed?.confidence || 0),
      });

      activeSdBody = buildRetrySdBody(activeSdBody, verification, {
        seed: Date.now(),
      });
      compiledPromptHash = buildCompiledPromptHash(activeSdBody);
      sdResult = await generateSd({
        req,
        prompt: activeSdBody.prompt,
        body: activeSdBody,
      });
      attempts.push({
        attempt: retryCount + 1,
        prompt_hash: compiledPromptHash,
        prompt: String(activeSdBody.prompt || '').trim(),
        negative_prompt: String(activeSdBody.negative_prompt || '').trim(),
        seed: activeSdBody.seed,
        image_url: resolveGeneratedImageUrl(sdResult),
      });

      try {
        verification = await verifyImageCardinality({
          imageUrl: resolveGeneratedImageUrl(sdResult),
          expected: expectedImageContract,
          requestId,
          prompt: String(activeSdBody.prompt || '').trim(),
          seed: activeSdBody.seed,
        });
      } catch (error_) {
        verification = {
          ok: false,
          skipped: true,
          reason: 'vision_verify_failed',
          message: String(error_?.message || error_),
        };
        break;
      }
      console.log(
        `[A11][image-guard] verify requestId=${requestId} promptHash=${compiledPromptHash} status=${verification?.ok ? 'ok' : 'skip'} reason=${verification?.decision?.reason || verification?.reason || 'unknown'}`
      );
    }
  }

  return {
    ...compiledState,
    sdBody: activeSdBody,
    sdResult,
    imageGuard: {
      requestId,
      enabled: guardEnabled,
      compiledPromptHash: attempts[0]?.prompt_hash || compiledPromptHash,
      expected: expectedImageContract,
      verification,
      retries: retryHistory,
      attempts,
    },
  };
}

async function generateImageFromText({ req, text, generateSd, ...rest }) {
  const message = String(text || '').trim();
  if (!message) {
    const error = new Error('missing_message');
    error.statusCode = 400;
    error.payload = { ok: false, error: 'missing_message' };
    throw error;
  }

  const rawMask = buildMaskImageGenerateFromText(message);
  if (!rawMask) {
    const error = new Error('invalid_mask');
    error.statusCode = 400;
    error.payload = {
      ok: false,
      error: 'invalid_mask',
      message: 'Impossible de construire un MASK image.generate a partir du texte fourni.',
    };
    throw error;
  }

  return generateImageFromMask({
    req,
    rawMask,
    generateSd,
    ...rest,
  });
}

function resolveGeneratedImageUrl(sdResult) {
  return String(
    sdResult?.image_url
    || sdResult?.url
    || sdResult?.imagePath
    || sdResult?.public_url
    || sdResult?.file?.downloadUrl
    || sdResult?.file?.url
    || sdResult?.conversationResource?.downloadUrl
    || sdResult?.conversationResource?.url
    || sdResult?.result?.image_url
    || ''
  ).trim();
}

function inferImageFilename(imageUrl = '') {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  try {
    const pathname = new URL(raw).pathname || '';
    const candidate = path.basename(decodeURIComponent(pathname));
    return String(candidate || '').trim();
  } catch {
    const candidate = raw.split('?')[0].split('#')[0].split('/').pop();
    return String(candidate || '').trim();
  }
}

function ensureImageFilename(filename, imageUrl, contentType = '', artifactType = '') {
  const normalizedContentType = String(contentType || '').trim().toLowerCase();
  const normalizedArtifactType = String(artifactType || '').trim().toLowerCase();
  const candidate = String(filename || '').trim() || inferImageFilename(imageUrl);
  if (/\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(candidate)) {
    return candidate;
  }
  if (normalizedContentType === 'image/jpeg') return `${candidate || 'image'}.jpg`;
  if (normalizedContentType === 'image/webp') return `${candidate || 'image'}.webp`;
  if (normalizedContentType === 'image/gif') return `${candidate || 'image'}.gif`;
  if (normalizedContentType.startsWith('image/') || normalizedArtifactType.includes('image')) {
    return `${candidate || 'image'}.png`;
  }
  return candidate;
}

function buildImageAssistantMessage({ imageUrl, filename }) {
  if (imageUrl && filename) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  if (imageUrl) return `C'est fait. L'image est prête. [ouvrir l'image](${imageUrl})`;
  return "C'est fait. L'image a été générée.";
}

function buildWebImageAssistantMessage({ subject, title, imageUrl, sourceUrl }) {
  const displaySubject = String(subject || title || 'ce sujet').trim();
  return [
    `Voici une image de ${displaySubject}.`,
    sourceUrl ? `[ouvrir la source](${sourceUrl})` : '',
    imageUrl ? `[ouvrir l'image](${imageUrl})` : '',
  ].filter(Boolean).join(' ');
}

function toWebImageChatProxyPayload({ subject, result }) {
  const imageUrl = String(
    result?.image_url
    || result?.imageUrl
    || result?.url
    || ''
  ).trim();
  const sourceUrl = String(
    result?.source_url
    || result?.sourceUrl
    || ''
  ).trim();
  const title = String(result?.title || subject || '').trim();
  const normalizedResult = {
    ok: result?.ok !== false,
    artifact_type: 'web_image',
    query: String(result?.query || subject || '').trim() || null,
    image_url: imageUrl || null,
    source_url: sourceUrl || null,
    title: title || null,
    width: result?.width,
    height: result?.height,
  };
  const content = buildWebImageAssistantMessage({
    subject: normalizedResult.query || title,
    title,
    imageUrl,
    sourceUrl,
  });

  return {
    ok: normalizedResult.ok,
    id: `a11-webimg-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'a11-web-image-search',
    mode: 'web_image_search',
    tool: 'web_image_search',
    artifact_type: 'web_image',
    image_url: imageUrl || null,
    imagePath: imageUrl || null,
    source_url: sourceUrl || null,
    title: title || null,
    width: result?.width,
    height: result?.height,
    assistant: content,
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
    a11Agent: {
      imagePath: imageUrl || null,
      results: [
        {
          action: 'web_image_search',
          ok: normalizedResult.ok,
          artifact_type: 'web_image',
          result: normalizedResult,
        },
      ],
    },
    result: normalizedResult,
  };
}

function toImageChatProxyPayload({ sdResult, mask, compiled, sdBody, imageGuard }) {
  const imageUrl = resolveGeneratedImageUrl(sdResult);
  const filename = ensureImageFilename(
    sdResult?.filename || sdResult?.conversationResource?.filename || sdResult?.file?.filename,
    imageUrl,
    sdResult?.content_type || sdResult?.contentType || sdResult?.conversationResource?.contentType || sdResult?.file?.contentType,
    sdResult?.artifact_type
  );
  const content = buildImageAssistantMessage({ imageUrl, filename });

  return {
    ok: sdResult?.ok !== false,
    id: `a11-img-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'a11-mask-image',
    mode: 'generate_sd',
    tool: 'generate_sd',
    artifact_type: sdResult?.artifact_type || 'image',
    image_url: imageUrl || null,
    imagePath: imageUrl || null,
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
    a11Agent: {
      imagePath: imageUrl || null,
      imageGuard: imageGuard || null,
      results: [
        {
          action: 'generate_sd',
          ok: sdResult?.ok !== false,
          result: sdResult,
        },
      ],
    },
    result: sdResult,
    mask,
    compiled,
    sdBody,
  };
}

module.exports = {
  extractLatestUserMessage,
  buildSdRequestBody,
  resolveCompiledSdPayload,
  compileMaskImageGenerate,
  generateImageFromMask,
  generateImageFromText,
  resolveGeneratedImageUrl,
  toWebImageChatProxyPayload,
  toImageChatProxyPayload,
};

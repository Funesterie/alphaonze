const normalizeMaskImageGenerate = require('./normalize-mask-image-generate.cjs');
const validateMaskImageGenerate = require('./validate-mask-image-generate.cjs');
const compileMaskToSD = require('./compile-mask-to-sd.cjs');
const compileMaskToImagePrompt = require('./compile-mask-to-image-prompt.cjs');
const {
  enrichMaskForSpecialImageCompiler,
  resolveImageCompilerCompartment,
  isImageOrchestratorEnabled,
} = require('./compile-mask-to-image-prompt-special.cjs');
const adaptMaskToFreelandValue = require('./adapt-mask-to-freeland-value.cjs');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  inferExpectedImageContract,
  verifyGeneratedImageCardinality,
  buildRetrySdBody,
} = require('../image/verify-generated-image-cardinality.cjs');
const {
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
} = require('../image/image-hint-memory.cjs');
const {
  verifyGeneratedImageWithLlmJudge,
} = require('../image/verify-generated-image-with-llm.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('./resolve-image-mask-from-text.cjs');
const {
  lookupImageHintWebContext: defaultLookupImageHintWebContext,
  resolveImageWebDraft: defaultResolveImageWebDraft,
} = require('../knowledge/image-hint-web-context.cjs');
const {
  resolveImageEntityContext: defaultResolveImageEntityContext,
} = require('../knowledge/image-entity-resolver.cjs');
const {
  directImageRequest: defaultDirectImageRequest,
} = require('../knowledge/image-request-director.cjs');
const {
  lookupDefinitionContext: defaultLookupDefinitionContext,
} = require('../knowledge/definition-context.cjs');
const {
  duckduckgoImageSearch: defaultDuckduckgoImageSearch,
} = require('../../lib/image-search.cjs');
const {
  enrichImageMaskWithScratchpad,
} = require('./image-scratchpad.cjs');

let sharpLib;

function getSharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = require('sharp');
  } catch {
    sharpLib = null;
  }
  return sharpLib;
}

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
  const payload = compiledPayload && typeof compiledPayload === 'object'
    ? compiledPayload
    : {};
  const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
    ? mask.meta.webImageDraft
    : {};
  const initImage = String(
    payload.init_image
    || payload.initImage
    || payload.init_image_url
    || payload.initImageUrl
    || webImageDraft.initImagePath
    || webImageDraft.initImageUrl
    || ''
  ).trim();
  const strength = payload.strength !== undefined
    ? Number(payload.strength)
    : Number(webImageDraft.strength);

  return {
    prompt: String(payload.prompt || mask?.raw || '').trim(),
    prompt_prebuilt: true,
    ...(payload.prompt_language ? { prompt_language: String(payload.prompt_language).trim() } : {}),
    ...(String(payload.negative_prompt || '').trim()
      ? {
          negative_prompt: String(payload.negative_prompt).trim(),
          negative_prompt_prebuilt: true,
        }
      : {}),
    width: Number(payload.width || mask?.options?.width || 768),
    height: Number(payload.height || mask?.options?.height || 768),
    num_inference_steps: Number(payload.steps || mask?.options?.steps || 30),
    guidance_scale: Number(payload.guidance_scale || mask?.options?.guidance_scale || 7.5),
    ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
    ...(payload.sampler ? { sampler: payload.sampler } : {}),
    ...(initImage ? { init_image_url: initImage } : {}),
    ...(Number.isFinite(strength) ? { strength } : {}),
  };
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

  const compilerTarget = String(mask?.compiler?.target || 'image-prompt-fr').trim() || 'image-prompt-fr';
  const compiledPayload = compilerTarget === 'sd-payload'
    ? compileMaskToSD(mask)
    : compileMaskToImagePrompt(mask);
  const compiled = adaptMaskToFreelandValue(mask, compiledPayload);
  const sdBody = compilerTarget === 'sd-payload'
    ? buildSdRequestBody(mask, compiledPayload)
    : {
        ...compiledPayload,
        width: Number(compiledPayload?.width || mask?.options?.width || 768),
        height: Number(compiledPayload?.height || mask?.options?.height || 768),
        num_inference_steps: Number(compiledPayload?.num_inference_steps || mask?.options?.steps || 30),
        guidance_scale: Number(compiledPayload?.guidance_scale || mask?.options?.guidance_scale || 7.5),
        ...(compiledPayload?.seed !== undefined ? { seed: compiledPayload.seed } : {}),
        ...(() => {
          const webImageDraft = mask?.meta?.webImageDraft && typeof mask.meta.webImageDraft === 'object'
            ? mask.meta.webImageDraft
            : {};
          const initImage = String(
            compiledPayload?.init_image
            || compiledPayload?.initImage
            || compiledPayload?.init_image_url
            || compiledPayload?.initImageUrl
            || webImageDraft.initImagePath
            || webImageDraft.initImageUrl
            || ''
          ).trim();
          const strength = compiledPayload?.strength !== undefined
            ? Number(compiledPayload.strength)
            : Number(webImageDraft.strength);
          return {
            ...(initImage ? { init_image_url: initImage } : {}),
            ...(Number.isFinite(strength) ? { strength } : {}),
          };
        })(),
      };

  return {
    mask,
    compiledPayload,
    compiled,
    sdBody,
  };
}

async function compileMaskImageGenerateRuntime(rawMask, options = {}) {
  const baseSelection = resolveImageCompilerCompartment(rawMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
  });
  const orchestratorEnabled = isImageOrchestratorEnabled(baseSelection.pipelineMode);
  let preferredHintMemory = null;
  if (orchestratorEnabled) {
    try {
      preferredHintMemory = typeof options.readPreferredImageHintMemory === 'function'
        ? await options.readPreferredImageHintMemory(rawMask)
        : await readPreferredImageHintMemory(rawMask);
    } catch (error_) {
      preferredHintMemory = {
        available: false,
        skipped: true,
        reason: 'hint_memory_read_failed',
        message: String(error_?.message || error_),
        hints: {
          composition_hints: [],
          environment_hints: [],
          style_hints: [],
          prompt_instructions: [],
        },
      };
    }
  }
  const selection = orchestratorEnabled
    ? resolveImageCompilerCompartment(rawMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
    })
    : baseSelection;
  let runtimeMask = rawMask;
  if (typeof options.resolveImageEntityContext === 'function') {
    try {
      const imageEntityContext = await options.resolveImageEntityContext({
        mask: runtimeMask,
        selection,
      });
      if (imageEntityContext && typeof imageEntityContext === 'object') {
        runtimeMask = enrichImageMaskWithScratchpad(runtimeMask, { entityContext: imageEntityContext });
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageEntityContextError: String(error_?.message || error_),
        },
      };
    }
  }
  let webHintContext = null;
  if (orchestratorEnabled && typeof options.lookupImageHintWebContext === 'function') {
    try {
      webHintContext = await options.lookupImageHintWebContext({
        mask: runtimeMask,
        selection,
      });
      if (webHintContext && typeof webHintContext === 'object') {
        runtimeMask = {
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webHintContext,
          },
        };
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webHintContextError: String(error_?.message || error_),
        },
      };
    }
  }
  if (orchestratorEnabled && typeof options.resolveImageWebDraft === 'function') {
    try {
      const webImageDraft = await options.resolveImageWebDraft({
        mask: runtimeMask,
        selection,
        webHintContext,
      });
      if (webImageDraft && typeof webImageDraft === 'object') {
        runtimeMask = {
          ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
          meta: {
            ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
            webImageDraft,
          },
        };
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          webImageDraftError: String(error_?.message || error_),
        },
      };
    }
  }
  let director = null;
  if (orchestratorEnabled && typeof options.directImageRequest === 'function') {
    try {
      const directed = await options.directImageRequest({
        mask: runtimeMask,
        selection,
        callStructuredLlm: options.callStructuredLlmJson,
        lookupDefinitionContext: options.lookupDefinitionContext,
        duckduckgoImageSearch: options.duckduckgoImageSearch,
      });
      if (directed && typeof directed === 'object') {
        director = directed.director || null;
        if (directed.mask && typeof directed.mask === 'object') {
          runtimeMask = directed.mask;
        }
      }
    } catch (error_) {
      runtimeMask = {
        ...(runtimeMask && typeof runtimeMask === 'object' ? runtimeMask : {}),
        meta: {
          ...((runtimeMask && runtimeMask.meta && typeof runtimeMask.meta === 'object') ? runtimeMask.meta : {}),
          imageRequestDirectorError: String(error_?.message || error_),
        },
      };
    }
  }
  const enriched = await enrichMaskForSpecialImageCompiler(runtimeMask, {
    callStructuredLlmJson: options.callStructuredLlmJson,
    preferredHints: preferredHintMemory?.hints || {},
  });
  const enrichedMask = enriched?.mask || runtimeMask;
  const compiledState = compileMaskImageGenerate(enrichedMask);
  compiledState.imageRequestDirector = director;
  compiledState.specialCompiler = {
    selection: enriched?.selection || resolveImageCompilerCompartment(runtimeMask, {
      callStructuredLlmJson: options.callStructuredLlmJson,
      preferredHints: preferredHintMemory?.hints || {},
    }),
    appliedHints: enriched?.appliedHints || null,
    fallbackReason: String(enriched?.fallbackReason || '').trim(),
    preferredHintMemory: preferredHintMemory || null,
  };
  return compiledState;
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

function isFalsyEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').trim().toLowerCase());
}

function isImageVerificationEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_CARDINALITY_GUARD
    || process.env.A11_IMAGE_VERIFY_CARDINALITY
    || '';
  if (!String(envValue).trim()) return true;
  if (isFalsyEnv(envValue)) return false;
  return isTruthyEnv(envValue);
}

function resolveMaxVerificationRetries(explicitValue) {
  if (explicitValue !== undefined && explicitValue !== null && explicitValue !== '') {
    const numeric = Number(explicitValue);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
  }
  const fromEnv = Number(
    process.env.A11_IMAGE_CARDINALITY_MAX_RETRIES
    || process.env.A11_IMAGE_VERIFY_MAX_RETRIES
    || 2
  );
  return Number.isFinite(fromEnv) ? Math.max(0, Math.floor(fromEnv)) : 2;
}

function buildCompiledPromptHash(sdBody = {}) {
  return crypto
    .createHash('sha1')
    .update(String(sdBody?.prompt || '').trim())
    .digest('hex')
    .slice(0, 16);
}

function deriveOperationalSeed({ mask = {}, sdBody = {} } = {}) {
  const existingSeed = Number(sdBody?.seed);
  if (Number.isFinite(existingSeed)) {
    return Math.max(1, Math.floor(existingSeed));
  }

  const payload = [
    String(sdBody?.prompt || '').trim(),
    String(mask?.raw || '').trim(),
    String(mask?.inputs?.subject?.join('|') || '').trim(),
    String(mask?.meta?.canonicalSubject || mask?.meta?.imageScratchpad?.canonicalSubject || '').trim(),
    String(mask?.meta?.subjectProfile?.type || '').trim(),
  ].join('\n');

  const digest = crypto.createHash('sha1').update(payload).digest();
  const derived = digest.readUInt32BE(0) & 0x7fffffff;
  return Math.max(1, derived || 1);
}

function ensureOperationalSdBody(sdBody = {}, mask = {}) {
  return {
    ...sdBody,
    seed: deriveOperationalSeed({ mask, sdBody }),
  };
}

async function inspectGeneratedImage(sdResult) {
  const imageUrl = resolveGeneratedImageUrl(sdResult);
  if (!imageUrl) {
    return { ok: true, skipped: true, reason: 'missing_image_url' };
  }

  const sharp = getSharp();
  if (!sharp || typeof globalThis.fetch !== 'function') {
    return { ok: true, skipped: true, reason: 'image_probe_unavailable' };
  }

  try {
    const response = await globalThis.fetch(imageUrl);
    if (!response.ok) {
      return {
        ok: true,
        skipped: true,
        reason: 'image_probe_unavailable',
        message: `image_probe_http_${response.status}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const probe = sharp(buffer, { failOn: 'none' });
    const [metadata, stats] = await Promise.all([
      probe.metadata(),
      probe.stats(),
    ]);
    const rgbChannels = Array.isArray(stats?.channels) ? stats.channels.slice(0, 3) : [];
    const solidBlack = rgbChannels.length >= 3 && rgbChannels.every((channel) => (
      Number(channel?.max || 0) <= 2 && Number(channel?.mean || 0) <= 2
    ));

    if (solidBlack) {
      return {
        ok: false,
        reason: 'solid_black_image_detected',
        imageUrl,
        metadata: {
          width: Number(metadata?.width || 0),
          height: Number(metadata?.height || 0),
          channels: Number(metadata?.channels || 0),
          sizeBytes: buffer.length,
        },
      };
    }

    return {
      ok: true,
      imageUrl,
      metadata: {
        width: Number(metadata?.width || 0),
        height: Number(metadata?.height || 0),
        channels: Number(metadata?.channels || 0),
        sizeBytes: buffer.length,
      },
    };
  } catch (error_) {
    return {
      ok: true,
      skipped: true,
      reason: 'image_probe_failed',
      message: String(error_?.message || error_),
    };
  }
}

async function generateImageFromMask({
  req,
  rawMask,
  generateImage,
  generateSd,
  specialCompilerCallStructuredLlmJson,
  verifyImageCardinality = verifyGeneratedImageCardinality,
  verifyImageWithLlmJudge = verifyGeneratedImageWithLlmJudge,
  inspectGeneratedImageResult = inspectGeneratedImage,
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
  callStructuredVisionJudgeJson,
  resolveImageEntityContext = defaultResolveImageEntityContext,
  directImageRequest = defaultDirectImageRequest,
  lookupDefinitionContext = defaultLookupDefinitionContext,
  duckduckgoImageSearch = defaultDuckduckgoImageSearch,
  lookupImageHintWebContext = defaultLookupImageHintWebContext,
  resolveImageWebDraft = defaultResolveImageWebDraft,
  imageVerificationEnabled,
  maxVerificationRetries,
}) {
  const compiledState = await compileMaskImageGenerateRuntime(rawMask, {
    callStructuredLlmJson: specialCompilerCallStructuredLlmJson,
    readPreferredImageHintMemory,
    resolveImageEntityContext,
    directImageRequest,
    lookupDefinitionContext,
    duckduckgoImageSearch,
    lookupImageHintWebContext,
    resolveImageWebDraft,
  });
  const imageGenerator = typeof generateImage === 'function'
    ? generateImage
    : generateSd;

  if (typeof imageGenerator !== 'function') {
    const error = new Error('generateImage handler unavailable');
    error.statusCode = 500;
    error.payload = {
      ok: false,
      error: 'image_engine_unavailable',
      message: 'generateImage handler unavailable',
    };
    throw error;
  }

  const requestId = buildImageVerificationRequestId(compiledState);
  const expectedImageContract = inferExpectedImageContract({
    mask: compiledState.mask,
    compiledState,
  });
  const guardEnabled = isImageVerificationEnabled(imageVerificationEnabled);
  const resolvedMaxVerificationRetries = resolveMaxVerificationRetries(maxVerificationRetries);
  const attempts = [];

  let activeSdBody = ensureOperationalSdBody(compiledState.sdBody, compiledState.mask);
  let compiledPromptHash = buildCompiledPromptHash(activeSdBody);
  console.log(
    `[A11][image-guard] start requestId=${requestId} enabled=${guardEnabled} promptHash=${compiledPromptHash} seed=${activeSdBody.seed ?? 'none'}`
  );
  let sdResult = await imageGenerator({
    req,
    prompt: activeSdBody.prompt,
    body: activeSdBody,
  });
  attempts.push({
    attempt: 1,
    prompt_hash: compiledPromptHash,
    prompt: String(activeSdBody.prompt || '').trim(),
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
      sdResult = await imageGenerator({
        req,
        prompt: activeSdBody.prompt,
        body: activeSdBody,
      });
      attempts.push({
        attempt: retryCount + 1,
        prompt_hash: compiledPromptHash,
        prompt: String(activeSdBody.prompt || '').trim(),
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

  const imageInspection = typeof inspectGeneratedImageResult === 'function'
    ? await inspectGeneratedImageResult(sdResult)
    : { ok: true, skipped: true, reason: 'image_probe_disabled' };
  if (imageInspection?.ok === false) {
    const error = new Error('Generated image is invalid');
    error.statusCode = 502;
    error.payload = {
      ok: false,
      error: 'image_generation_invalid',
      message: "Le backend image a renvoye une image invalide.",
      details: imageInspection,
      result: sdResult,
    };
    throw error;
  }

  const imageUrl = resolveGeneratedImageUrl(sdResult);
  const shouldRunLlmJudge = Boolean(
    imageUrl
    && typeof verifyImageWithLlmJudge === 'function'
    && (
      compiledState?.specialCompiler?.selection?.candidate === true
      || compiledState?.specialCompiler?.selection?.compartment === 'special'
      || retryHistory.length > 0
    )
  );
  const imageLlmJudge = shouldRunLlmJudge
    ? await verifyImageWithLlmJudge({
      imageUrl,
      mask: compiledState.mask,
      requestId,
      prompt: String(activeSdBody.prompt || '').trim(),
      seed: activeSdBody.seed,
      callStructuredVisionJson: callStructuredVisionJudgeJson,
    })
    : {
      ok: false,
      skipped: true,
      reason: 'vision_llm_not_needed',
    };

  let hintMemory = null;
  if (
    imageLlmJudge?.ok === true
    && imageLlmJudge?.decision?.accepted === true
    && typeof recordSuccessfulImageHintMemory === 'function'
  ) {
    try {
      hintMemory = await recordSuccessfulImageHintMemory({
        mask: compiledState.mask,
        workingHints: imageLlmJudge.workingHints,
        judgeResult: imageLlmJudge,
      });
    } catch (error_) {
      hintMemory = {
        ok: false,
        skipped: true,
        reason: 'hint_memory_record_failed',
        message: String(error_?.message || error_),
      };
    }
  }

  return {
    ...compiledState,
    sdBody: activeSdBody,
    sdResult,
    imageInspection,
    imageLlmJudge,
    hintMemory,
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

  const maskResolution = await buildCanonicalImageMaskFromText(message, {
    allowCompatFallback: true,
  });

  return generateImageFromMask({
    req,
    rawMask: maskResolution.rawMask,
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

function toImageChatProxyPayload({
  sdResult,
  mask,
  compiled,
  sdBody,
  imageGuard,
  imageLlmJudge,
  hintMemory,
  imageRequestDirector,
}) {
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
    mode: 'generate_image',
    tool: sdResult?.tool || 'generate_image',
    engine: sdResult?.mode || null,
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
      imageDraft: mask?.meta?.webImageDraft || null,
      imageRequestDirector: imageRequestDirector || mask?.meta?.imageRequestDirector || null,
      imageGuard: imageGuard || null,
      imageLlmJudge: imageLlmJudge || null,
      hintMemory: hintMemory || null,
      results: [
        {
          action: sdResult?.tool || 'generate_image',
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
  compileMaskImageGenerate,
  compileMaskImageGenerateRuntime,
  generateImageFromMask,
  generateImageFromText,
  resolveGeneratedImageUrl,
  inspectGeneratedImage,
  resolveImageCompilerCompartment,
  toImageChatProxyPayload,
};

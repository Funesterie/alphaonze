const defaultFs = require('node:fs');
const defaultPath = require('node:path');
const { buildSdPromptBundle: buildSharedSdPromptBundle } = require('../mask/build-sd-prompt-bundle.cjs');
const { buildCanonicalImageMaskFromText } = require('../mask/resolve-image-mask-from-text.cjs');
const { compileMaskImageGenerate } = require('../mask/image-chat-runtime.cjs');
const {
  resolveSdProxyUrl: defaultResolveSdProxyUrl,
  resolveSdScriptPath: defaultResolveSdScriptPath,
  runSdScript: defaultRunSdScript,
  shouldAllowLocalSdFallback: defaultShouldAllowLocalSdFallback,
} = require('../../lib/sd-runtime.cjs');
const { uploadBufferToR2: defaultUploadBufferToR2 } = require('../../lib/file-storage.cjs');
const {
  tryGeneratePngWithOpenAI,
  looksLikeOpenAiQuotaError,
  resolveOpenAiImageConfig,
  isOpenAiImageEnabled,
} = require('../../lib/openai-image.cjs');

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function buildSdPromptBundleFallback(rawPrompt = '', options = {}) {
  return buildSharedSdPromptBundle(rawPrompt, options);
}

function resolveOpenAiPreferredForImage(requestBody = {}) {
  if (!isOpenAiImageEnabled(process.env)) return false;

  const explicitEngine = String(
    requestBody?.engine
    || requestBody?.image_engine
    || requestBody?.provider
    || ''
  ).trim().toLowerCase();
  if (explicitEngine === 'sd' || explicitEngine === 'stable-diffusion') return false;
  if (explicitEngine === 'openai' || explicitEngine === 'openai-image') return true;

  const order = String(process.env.A11_IMAGE_PROVIDER_ORDER || 'openai,sd')
    .split(',')
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  return order[0] === 'openai' || order[0] === 'openai-image';
}

function normalizePromptFragment(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPromptFragments(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => normalizePromptFragment(entry))
    .filter(Boolean);
}

function mergeNegativePrompts(...values) {
  const entries = values
    .flatMap((value) => splitPromptFragments(value))
    .map((entry) => normalizePromptFragment(entry))
    .filter(Boolean);
  return [...new Set(entries)].join(', ').trim();
}

function looksLikeCompiledSdPrompt(value = '') {
  const normalized = normalizePromptFragment(value).toLowerCase();
  if (!normalized) return false;

  const markers = [
    'literal interpretation',
    'interprétation littérale',
    'demande :',
    'créer une image fidèle à la demande',
    'solo composition',
    'composition solo',
    'simple clean background',
    'fond simple et propre',
    'centered subject',
    'exactly one ',
    'sujet principal :',
    'couleurs :',
    'only one animal in frame',
  ];

  let matches = 0;
  for (const marker of markers) {
    if (normalized.includes(marker)) matches += 1;
  }

  return matches >= 2;
}

function repairCompiledSdPromptArtifacts(value = '') {
  const repairableSubjects = [
    'rabbit',
    'cow',
    'pig',
    'fish',
    'cat',
    'dog',
    'fox',
    'bear',
    'panda',
    'lion',
    'tiger',
    'dragon',
    'unicorn',
    'bicycle',
    'bike',
    'cyclist',
    'knight',
    'hero',
    'princess',
    'character',
    'batman',
    'robin',
  ];
  const subjectPattern = repairableSubjects
    .sort((left, right) => right.length - left.length)
    .map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return normalizePromptFragment(value)
    .replace(new RegExp(`\\b(?:e\\s+)?image\\s+(${subjectPattern})\\b`, 'gi'), '$1')
    .replace(/\bone\s+one\b/gi, 'one')
    .replace(/\bexactly one one\b/gi, 'exactly one');
}

function fallbackIsAdminRequest(req) {
  const configuredAdminToken = String(process.env.NEZ_ADMIN_TOKEN || '').trim();
  const adminHeaders = [
    req?.headers?.['x-nez-admin'],
    req?.headers?.['x-nez-admin-token'],
    req?.headers?.['x-admin-token'],
  ].map((value) => String(value || '').trim()).filter(Boolean);

  if (configuredAdminToken && adminHeaders.includes(configuredAdminToken)) {
    return true;
  }

  if (adminHeaders.some((value) => ['1', 'true', 'yes', 'admin'].includes(value.toLowerCase()))) {
    return true;
  }

  const rawTokens = [
    process.env.NEZ_ALLOWED_TOKEN,
    process.env.NEZ_TOKENS,
  ].filter(Boolean).join(',');

  const allowedTokens = rawTokens
    .split(/[,\s]+/)
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (allowedTokens.length === 0) {
    return false;
  }

  const bearer = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const directToken = String(req?.headers?.['x-nez-token'] || '').trim();
  return allowedTokens.includes(bearer) || allowedTokens.includes(directToken);
}

function isMissingTorchFailure(result = {}) {
  const text = String(result?.message || result?.stderr || '').toLowerCase();
  return text.includes('no module named') && text.includes('torch');
}

function buildSdUnavailablePayload({ localResult = null, openAiResult = null } = {}) {
  const reasons = [];
  if (localResult?.error === 'python_spawn_failed') reasons.push('le runtime Python SD local est introuvable');
  if (isMissingTorchFailure(localResult)) reasons.push('torch manque sur le backend image');
  if (openAiResult?.error === 'openai_image_disabled') reasons.push('OpenAI image est desactive');
  if (openAiResult?.error === 'openai_image_unconfigured') reasons.push('OPENAI_API_KEY image n est pas configuree');
  if (looksLikeOpenAiQuotaError(openAiResult)) reasons.push('le quota OpenAI image est depasse');
  if (!reasons.length && localResult?.message) reasons.push(String(localResult.message));
  if (!reasons.length && openAiResult?.message) reasons.push(String(openAiResult.message));

  return {
    ok: false,
    error: 'image_backend_unavailable',
    message: reasons.length
      ? `Generation image indisponible: ${reasons.join(' ; ')}.`
      : 'Generation image indisponible sur cet environnement.',
    local: localResult || null,
    openai: openAiResult || null,
  };
}

function buildSdBackendUnavailablePayload({
  proxyUrl = '',
  proxyResult = null,
  reason = 'backend image unavailable',
  localFallbackBlocked = false,
} = {}) {
  const expectedProxyRoute = '/api/tools/generate_sd';
  const upstreamMessage = String(
    proxyResult?.body?.message
    || proxyResult?.text
    || reason
    || 'backend image unavailable'
  ).trim();
  const routeHint = proxyUrl
    ? `Proxy attendu: ${proxyUrl}. Route attendue: POST ${expectedProxyRoute}.`
    : `Route attendue: POST ${expectedProxyRoute} via A11_SD_PROXY_URL.`;
  const proxyOnlyHint = localFallbackBlocked
    ? 'Mode proxy-only actif: le fallback local est volontairement desactive en production.'
    : '';

  return {
    ok: false,
    error: 'image_backend_unavailable',
    code: localFallbackBlocked ? 'local_only_fallback_blocked' : 'sd_backend_unavailable',
    message: localFallbackBlocked
      ? `Generation image indisponible: backend SD proxy en echec en production. ${proxyOnlyHint} ${upstreamMessage} ${routeHint}`.trim()
      : `Generation image indisponible: ${upstreamMessage} ${routeHint}`.trim(),
    upstream: proxyUrl ? {
      provider: 'sd-proxy',
      url: proxyUrl,
      status: Number(proxyResult?.status || 0) || null,
    } : null,
    proxyOnlyMode: localFallbackBlocked,
    expectedProxyRoute,
  };
}

function resolveDependencies(overrides = {}) {
  return {
    fs: overrides.fs || defaultFs,
    path: overrides.path || defaultPath,
    fetch: overrides.fetch || defaultFetch,
    buildSdPromptBundle: overrides.buildSdPromptBundle || buildSdPromptBundleFallback,
    resolveSdProxyUrl: overrides.resolveSdProxyUrl || defaultResolveSdProxyUrl,
    resolveSdScriptPath: overrides.resolveSdScriptPath || defaultResolveSdScriptPath,
    runSdScript: overrides.runSdScript || defaultRunSdScript,
    uploadBufferToR2: overrides.uploadBufferToR2 || defaultUploadBufferToR2,
    isAdminRequest: overrides.isAdminRequest || fallbackIsAdminRequest,
    shouldAllowLocalSdFallback: overrides.shouldAllowLocalSdFallback || defaultShouldAllowLocalSdFallback,
  };
}

function createSdToolsRouter(overrides = {}) {
  const {
    fs,
    path,
    fetch,
    buildSdPromptBundle,
    resolveSdProxyUrl,
    resolveSdScriptPath,
    runSdScript,
    uploadBufferToR2,
    isAdminRequest,
    shouldAllowLocalSdFallback,
  } = resolveDependencies(overrides);

  const express = require('express');
  const router = express.Router();

  async function generateSdInternal({ req, prompt, body = null }) {
    const requestBody = body || req?.body || {};
    const rawPrompt = String(prompt || requestBody?.prompt || '').trim();
    if (!rawPrompt) {
      const error = new Error('missing_prompt');
      error.statusCode = 400;
      throw error;
    }

    const promptAlreadyCompiled = requestBody?.prompt_prebuilt === true || requestBody?.skip_prompt_enrichment === true;
    const inferredPromptAlreadyCompiled = !promptAlreadyCompiled && looksLikeCompiledSdPrompt(rawPrompt);

    let semanticCompiledState = null;
    if (!promptAlreadyCompiled && !inferredPromptAlreadyCompiled) {
      try {
        const maskResolution = await buildCanonicalImageMaskFromText(rawPrompt, {
          allowCompatFallback: true,
          maskOptions: {
            width: Number(requestBody?.width || 768),
            height: Number(requestBody?.height || 768),
            steps: Number(requestBody?.num_inference_steps || requestBody?.steps || 35),
            guidance_scale: Number(requestBody?.guidance_scale || 8.0),
            ...(requestBody?.seed !== undefined ? { seed: Number(requestBody.seed) } : {}),
          },
        });
        if (maskResolution?.rawMask) {
          semanticCompiledState = compileMaskImageGenerate(maskResolution.rawMask);
        }
      } catch {
        semanticCompiledState = null;
      }
    }

    const repairedRawPrompt = repairCompiledSdPromptArtifacts(rawPrompt);
    const promptBundle = promptAlreadyCompiled || inferredPromptAlreadyCompiled || semanticCompiledState
      ? { prompt: repairedRawPrompt || rawPrompt, negativeHints: [] }
      : buildSdPromptBundle(rawPrompt, {
        preferLiteralColor: requestBody?.prefer_literal_color === true || requestBody?.image_interpretation === 'literal_color',
        forceColorPrompt: requestBody?.force_color_prompt === true,
      });
    const finalPrompt = repairCompiledSdPromptArtifacts(
      promptAlreadyCompiled || inferredPromptAlreadyCompiled
        ? (repairedRawPrompt || rawPrompt)
        : (semanticCompiledState?.sdBody?.prompt || promptBundle.prompt)
    );
    const finalNegativePrompt = mergeNegativePrompts(
      semanticCompiledState?.sdBody?.negative_prompt,
      requestBody?.negative_prompt,
      Array.isArray(promptBundle?.negativeHints) ? promptBundle.negativeHints.join(', ') : ''
    );

    const num_inference_steps = Number(requestBody?.num_inference_steps || requestBody?.steps || 35);
    const guidance_scale = Number(requestBody?.guidance_scale || 8.0);
    const width = Number(requestBody?.width || 768);
    const height = Number(requestBody?.height || 768);
    const seed = requestBody?.seed !== undefined ? String(requestBody.seed) : undefined;
    const initImage = String(
      requestBody?.init_image
      || requestBody?.initImage
      || requestBody?.init_image_url
      || requestBody?.initImageUrl
      || requestBody?.reference_image_url
      || requestBody?.referenceImageUrl
      || ''
    ).trim();
    const strength = requestBody?.strength !== undefined && requestBody?.strength !== null && String(requestBody?.strength).trim() !== ''
      ? Number(requestBody.strength)
      : undefined;

    const proxyUrl = resolveSdProxyUrl();
    const scriptPath = resolveSdScriptPath();
    const sdFallbackEnv = proxyUrl && !process.env.A11_SD_PROXY_URL && !process.env.SD_PROXY_URL
      ? { ...process.env, A11_SD_PROXY_URL: proxyUrl }
      : process.env;
    const allowLocalFallback = typeof shouldAllowLocalSdFallback === 'function'
      ? shouldAllowLocalSdFallback(sdFallbackEnv)
      : String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
    const hasLocalScript = allowLocalFallback && !!scriptPath && fs.existsSync(scriptPath);

    if (proxyUrl) {
      try {
        const proxyResponse = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(typeof req?.headers?.authorization === 'string' ? { authorization: req.headers.authorization } : {}),
            ...(typeof req?.headers?.['x-nez-admin'] === 'string' ? { 'x-nez-admin': req.headers['x-nez-admin'] } : {}),
            ...(typeof req?.headers?.['x-nez-token'] === 'string' ? { 'x-nez-token': req.headers['x-nez-token'] } : {}),
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            prompt_prebuilt: true,
            ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt, negative_prompt_prebuilt: true } : {}),
            num_inference_steps,
            guidance_scale,
            width,
            height,
            ...(initImage ? { init_image_url: initImage } : {}),
            ...(Number.isFinite(strength) ? { strength } : {}),
            ...(seed !== undefined ? { seed } : {}),
          }),
        });

        const proxyText = await proxyResponse.text();
        let proxyJson = null;
        try {
          proxyJson = proxyText ? JSON.parse(proxyText) : null;
        } catch {
          proxyJson = null;
        }

        if (proxyResponse.ok && proxyJson) {
          return proxyJson;
        }

        if (!hasLocalScript) {
          const error = new Error(proxyJson?.message || proxyText || `Proxy SD indisponible (${proxyUrl})`);
          error.statusCode = proxyResponse.status || 502;
          error.payload = buildSdBackendUnavailablePayload({
            proxyUrl,
            proxyResult: {
              status: proxyResponse.status,
              text: proxyText,
              body: proxyJson,
            },
            reason: proxyJson?.message || proxyText || `Proxy SD indisponible (${proxyUrl})`,
            localFallbackBlocked: !allowLocalFallback,
          });
          throw error;
        }

        console.warn('[A11][generate_sd] SD proxy failed, fallback to local script:', proxyResponse.status, proxyText);
      } catch (error_) {
        if (!hasLocalScript) {
          const error = new Error(String(error_?.message || error_));
          error.statusCode = error_?.statusCode || 502;
          error.payload = error_?.payload || buildSdBackendUnavailablePayload({
            proxyUrl,
            reason: String(error_?.message || error_),
            localFallbackBlocked: !allowLocalFallback,
          });
          throw error;
        }
        console.warn('[A11][generate_sd] SD proxy unreachable, fallback to local script:', error_?.message);
      }
    }

    const enableSd = String(process.env.ENABLE_SD || '').toLowerCase() === 'true';
    const adminAllowed = typeof isAdminRequest === 'function' ? isAdminRequest(req) : false;
    if (!enableSd && !adminAllowed) {
      const error = new Error('Stable Diffusion désactivé sur cet environnement');
      error.statusCode = 503;
      error.payload = { ok: false, error: 'sd_disabled', message: error.message };
      throw error;
    }

    if (!hasLocalScript) {
      if (!allowLocalFallback) {
        const error = new Error('Generation image indisponible: backend SD local bloque en production.');
        error.statusCode = 503;
        error.payload = buildSdBackendUnavailablePayload({
          reason: 'backend SD local indisponible sur cet environnement',
          localFallbackBlocked: true,
        });
        throw error;
      }

      const tempDir = String(process.env.SD_OUTPUT_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/a11-images' : path.join(process.cwd(), 'tmp', 'generated')));
      fs.mkdirSync(tempDir, { recursive: true });
      const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const outputPath = path.join(tempDir, outputName);
      const openAiFallback = await tryGeneratePngWithOpenAI({
        prompt: finalPrompt,
        outputPath,
        width,
        height,
        userId: req?.user?.id || 'image-tool',
      });

      if (openAiFallback?.ok) {
        return {
          ok: true,
          url: openAiFallback.sourceUrl || null,
          image_url: openAiFallback.sourceUrl || null,
          filename: path.basename(openAiFallback.outputPath || outputPath),
          prompt: finalPrompt,
          num_inference_steps,
          guidance_scale,
          width,
          height,
          ...(initImage ? { init_image_url: initImage } : {}),
          ...(Number.isFinite(strength) ? { strength } : {}),
          seed: seed !== undefined ? Number(seed) : undefined,
          mode: openAiFallback.mode || 'openai-image',
        };
      }

      const error = new Error(openAiFallback?.message || 'Stable Diffusion indisponible sur cet environnement');
      error.statusCode = 503;
      error.payload = buildSdUnavailablePayload({
        localResult: { ok: false, error: 'sd_unavailable', message: 'Aucun script SD local disponible.' },
        openAiResult: openAiFallback,
      });
      throw error;
    }

    const tempDir = String(process.env.SD_OUTPUT_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/a11-images' : path.join(process.cwd(), 'tmp', 'generated')));
    fs.mkdirSync(tempDir, { recursive: true });
    const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const outputPath = path.join(tempDir, outputName);

    const outputJson = await runSdScript({
      prompt: finalPrompt,
      ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt } : {}),
      num_inference_steps,
      guidance_scale,
      width,
      height,
      ...(initImage ? { init_image_url: initImage } : {}),
      ...(Number.isFinite(strength) ? { strength } : {}),
      ...(seed !== undefined ? { seed } : {}),
      output: outputPath,
    }, { scriptPath });

    if (!outputJson?.ok || !outputJson?.output_path || !fs.existsSync(outputJson.output_path)) {
      if (!allowLocalFallback) {
        const error = new Error('Generation image indisponible: fallback local bloque en production.');
        error.statusCode = 503;
        error.payload = buildSdBackendUnavailablePayload({
          reason: outputJson?.message || 'fallback local bloque en production',
          localFallbackBlocked: true,
        });
        throw error;
      }

      const openAiFallback = await tryGeneratePngWithOpenAI({
        prompt: finalPrompt,
        outputPath,
        width,
        height,
        userId: req?.user?.id || 'image-tool',
      });

      if (openAiFallback?.ok) {
        return {
          ok: true,
          url: openAiFallback.sourceUrl || null,
          image_url: openAiFallback.sourceUrl || null,
          filename: path.basename(openAiFallback.outputPath || outputPath),
          prompt: finalPrompt,
          num_inference_steps,
          guidance_scale,
          width,
          height,
          ...(initImage ? { init_image_url: initImage } : {}),
          ...(Number.isFinite(strength) ? { strength } : {}),
          seed: seed !== undefined ? Number(seed) : undefined,
          mode: openAiFallback.mode || 'openai-image',
        };
      }

      console.error('[no_image] stdout:', outputJson?.stdout || '');
      console.error('[no_image] stderr:', outputJson?.stderr || '');
      console.error('[no_image] outputJson:', outputJson);
      console.error('[no_image] output_path:', outputJson?.output_path);
      console.error('[no_image] existsSync:', outputJson?.output_path ? fs.existsSync(outputJson.output_path) : 'no path');

      const error = new Error(openAiFallback?.message || outputJson?.message || 'Aucune image générée');
      error.statusCode = 503;
      error.payload = buildSdUnavailablePayload({
        localResult: outputJson,
        openAiResult: openAiFallback,
      });
      throw error;
    }

    try {
      const buffer = fs.readFileSync(outputJson.output_path);
      const filename = `sd_${Date.now()}.png`;
      const userId = req?.user?.id || 'image-tool';
      const uploadResult = await uploadBufferToR2({
        userId,
        filename,
        buffer,
        contentType: 'image/png',
      });
      try {
        fs.unlinkSync(outputJson.output_path);
      } catch {}

      return {
        ok: true,
        url: uploadResult.url || null,
        image_url: uploadResult.url || null,
        filename,
        prompt: finalPrompt,
        num_inference_steps,
        guidance_scale,
        width,
        height,
        ...(initImage ? { init_image_url: initImage } : {}),
        ...(Number.isFinite(strength) ? { strength } : {}),
        seed: seed !== undefined ? Number(seed) : undefined,
        mode: 'stable-diffusion-local',
        device: outputJson.device || null,
        model_id: outputJson.model_id || null,
        torch_dtype: outputJson.torch_dtype || null,
        cuda_available: outputJson.cuda_available === true,
        cuda_device_name: outputJson.cuda_device_name || null,
        xformers_enabled: outputJson.xformers_enabled === true,
        init_image_used: outputJson.init_image_used === true,
        init_image_source: outputJson.init_image_source || null,
      };
    } catch (error_) {
      const error = new Error(String(error_?.message || error_));
      error.statusCode = 500;
      error.payload = { ok: false, error: 'upload_failed', message: error.message };
      throw error;
    }
  }

  async function generateImageInternal({ req, prompt, body = null }) {
    const requestBody = body || req?.body || {};
    const rawPrompt = String(prompt || requestBody?.prompt || '').trim();
    if (!rawPrompt) {
      const error = new Error('missing_prompt');
      error.statusCode = 400;
      throw error;
    }

    const width = Number(requestBody?.width || 768);
    const height = Number(requestBody?.height || 768);
    const openAiFirst = resolveOpenAiPreferredForImage(requestBody);
    const openAiConfig = resolveOpenAiImageConfig();

    if (openAiFirst && openAiConfig.enabled && openAiConfig.apiKey) {
      try {
        const tempDir = String(process.env.SD_OUTPUT_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/a11-images' : path.join(process.cwd(), 'tmp', 'generated')));
        fs.mkdirSync(tempDir, { recursive: true });
        const outputName = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
        const outputPath = path.join(tempDir, outputName);

        const openAiResult = await tryGeneratePngWithOpenAI({
          prompt: rawPrompt,
          outputPath,
          width,
          height,
          userId: req?.user?.id || 'image-tool',
        });

        if (openAiResult?.ok) {
          return {
            ok: true,
            artifact_type: 'image',
            tool: 'generate_image',
            url: openAiResult.sourceUrl || null,
            image_url: openAiResult.sourceUrl || null,
            filename: path.basename(openAiResult.outputPath || outputPath),
            prompt: rawPrompt,
            width,
            height,
            num_inference_steps: Number(requestBody?.num_inference_steps || requestBody?.steps || 40),
            guidance_scale: Number(requestBody?.guidance_scale || 8),
            seed: requestBody?.seed !== undefined ? Number(requestBody.seed) : undefined,
            mode: openAiResult.mode || 'openai-image',
          };
        }
      } catch (error_) {
        console.warn('[A11][generate_image] OpenAI image failed, fallback to SD:', error_?.message);
      }
    }

    const sdResult = await generateSdInternal({ req, prompt: rawPrompt, body: requestBody });
    return {
      ...sdResult,
      tool: sdResult?.tool || 'generate_image',
    };
  }

  router.post('/tools/generate_sd', express.json({ limit: '2mb' }), async (req, res) => {
    console.log('[DEBUG] Entrée dans /api/tools/generate_sd', {
      ip: req.ip,
      headers: req.headers,
      body: req.body,
    });

    try {
      const result = await generateImageInternal({
        req,
        prompt: req.body?.prompt,
        body: req.body,
      });
      return res.json(result);
    } catch (error_) {
      console.error('[A11][generate_sd] failed:', error_?.message);
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || { ok: false, error: 'internal_error', message: String(error_?.message || error_) }
      );
    }
  });

  return {
    router,
    generateSdInternal,
    generateImageInternal,
  };
}

function looksLikeDependencyBag(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      'fs' in value
      || 'path' in value
      || 'fetch' in value
      || 'buildSdPromptBundle' in value
      || 'resolveSdProxyUrl' in value
      || 'resolveSdScriptPath' in value
      || 'runSdScript' in value
      || 'uploadBufferToR2' in value
      || 'isAdminRequest' in value
      || 'shouldAllowLocalSdFallback' in value
    )
  );
}

const defaultSdTools = createSdToolsRouter();

function sdToolsEntrypoint(...args) {
  if (args.length === 1 && looksLikeDependencyBag(args[0])) {
    return createSdToolsRouter(args[0]);
  }
  return defaultSdTools.router(...args);
}

sdToolsEntrypoint.router = defaultSdTools.router;
sdToolsEntrypoint.generateImageInternal = defaultSdTools.generateImageInternal;
sdToolsEntrypoint.generateSdInternal = defaultSdTools.generateImageInternal;
sdToolsEntrypoint.createSdToolsRouter = createSdToolsRouter;
sdToolsEntrypoint.buildSdBackendUnavailablePayload = buildSdBackendUnavailablePayload;

module.exports = sdToolsEntrypoint;

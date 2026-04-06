const defaultFs = require('node:fs');
const defaultPath = require('node:path');
const { buildSdPromptBundle: buildSharedSdPromptBundle } = require('../mask/build-sd-prompt-bundle.cjs');
const {
  resolveSdProxyUrl: defaultResolveSdProxyUrl,
  resolveSdScriptPath: defaultResolveSdScriptPath,
  runSdScript: defaultRunSdScript,
} = require('../../lib/sd-runtime.cjs');
const { uploadBufferToR2: defaultUploadBufferToR2 } = require('../../lib/file-storage.cjs');

function defaultFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  return import('node-fetch').then((mod) => mod.default(...args));
}

function buildSdPromptBundleFallback(rawPrompt = '', options = {}) {
  return buildSharedSdPromptBundle(rawPrompt, options);
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
    const negativePromptAlreadyCompiled = requestBody?.negative_prompt_prebuilt === true || requestBody?.skip_negative_prompt_enrichment === true;

    const promptBundle = promptAlreadyCompiled
      ? { prompt: rawPrompt, negativeHints: [] }
      : buildSdPromptBundle(rawPrompt, {
        preferLiteralColor: requestBody?.prefer_literal_color === true || requestBody?.image_interpretation === 'literal_color',
        forceColorPrompt: requestBody?.force_color_prompt === true,
      });
    const finalPrompt = promptAlreadyCompiled ? rawPrompt : promptBundle.prompt;

    const negativePromptParts = [
      String(requestBody?.negative_prompt || 'blurry, abstract, deformed, extra limbs, bad anatomy, low quality, text, watermark').trim(),
      ...(negativePromptAlreadyCompiled ? [] : promptBundle.negativeHints),
    ].filter(Boolean);
    const negative_prompt = [...new Set(negativePromptParts)].join(', ');
    const num_inference_steps = Number(requestBody?.num_inference_steps || requestBody?.steps || 35);
    const guidance_scale = Number(requestBody?.guidance_scale || 8.0);
    const width = Number(requestBody?.width || 768);
    const height = Number(requestBody?.height || 768);
    const seed = requestBody?.seed !== undefined ? String(requestBody.seed) : undefined;

    const proxyUrl = resolveSdProxyUrl();
    const scriptPath = resolveSdScriptPath();
    const hasLocalScript = !!scriptPath && fs.existsSync(scriptPath);

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
            negative_prompt,
            ...(promptAlreadyCompiled ? { prompt_prebuilt: true } : {}),
            ...(negativePromptAlreadyCompiled ? { negative_prompt_prebuilt: true } : {}),
            num_inference_steps,
            guidance_scale,
            width,
            height,
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
          error.payload = {
            ok: false,
            error: proxyJson?.error || 'sd_proxy_failed',
            message: proxyJson?.message || proxyText || `Proxy SD indisponible (${proxyUrl})`,
          };
          throw error;
        }

        console.warn('[A11][generate_sd] SD proxy failed, fallback to local script:', proxyResponse.status, proxyText);
      } catch (error_) {
        if (!hasLocalScript) {
          const error = new Error(String(error_?.message || error_));
          error.statusCode = error_?.statusCode || 502;
          error.payload = error_?.payload || {
            ok: false,
            error: 'sd_proxy_failed',
            message: String(error_?.message || error_),
          };
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
      const error = new Error('Stable Diffusion indisponible sur cet environnement');
      error.statusCode = 503;
      error.payload = { ok: false, error: 'sd_unavailable', message: error.message };
      throw error;
    }

    const tempDir = String(process.env.SD_OUTPUT_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/a11-images' : path.join(process.cwd(), 'tmp', 'generated')));
    fs.mkdirSync(tempDir, { recursive: true });
    const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const outputPath = path.join(tempDir, outputName);

    const outputJson = await runSdScript({
      prompt: finalPrompt,
      negative_prompt,
      num_inference_steps,
      guidance_scale,
      width,
      height,
      ...(seed !== undefined ? { seed } : {}),
      output: outputPath,
    }, { scriptPath });

    if (!outputJson?.ok || !outputJson?.output_path || !fs.existsSync(outputJson.output_path)) {
      console.error('[no_image] stdout:', outputJson?.stdout || '');
      console.error('[no_image] stderr:', outputJson?.stderr || '');
      console.error('[no_image] outputJson:', outputJson);
      console.error('[no_image] output_path:', outputJson?.output_path);
      console.error('[no_image] existsSync:', outputJson?.output_path ? fs.existsSync(outputJson.output_path) : 'no path');

      const error = new Error(outputJson?.message || 'Aucune image générée');
      error.statusCode = 500;
      error.payload = {
        ok: false,
        error: outputJson?.error || 'no_image',
        message: outputJson?.message || 'Aucune image générée',
        raw: outputJson,
      };
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
        negative_prompt,
        num_inference_steps,
        guidance_scale,
        width,
        height,
        seed: seed !== undefined ? Number(seed) : undefined,
        mode: 'stable-diffusion-local',
      };
    } catch (error_) {
      const error = new Error(String(error_?.message || error_));
      error.statusCode = 500;
      error.payload = { ok: false, error: 'upload_failed', message: error.message };
      throw error;
    }
  }

  router.post('/tools/generate_sd', express.json({ limit: '2mb' }), async (req, res) => {
    console.log('[DEBUG] Entrée dans /api/tools/generate_sd', {
      ip: req.ip,
      headers: req.headers,
      body: req.body,
    });

    try {
      const result = await generateSdInternal({
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
sdToolsEntrypoint.generateSdInternal = defaultSdTools.generateSdInternal;
sdToolsEntrypoint.createSdToolsRouter = createSdToolsRouter;

module.exports = sdToolsEntrypoint;

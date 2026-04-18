const express = require('express');

const sdToolsModule = require('./sd-tools.cjs');
const {
  createGenerateVideoHandler,
} = require('../video/video-generate-runtime.cjs');

function normalizeProxyUrl(rawValue = '') {
  const value = String(rawValue || '').trim();
  return value ? value.replace(/\/+$/, '') : '';
}

function resolveVideoProxyUrl() {
  return normalizeProxyUrl(
    process.env.A11_VIDEO_PROXY_URL
    || process.env.VIDEO_PROXY_URL
    || ''
  );
}

function resolveVideoProxyTimeoutMs() {
  const numeric = Number(process.env.A11_VIDEO_PROXY_TIMEOUT_MS || process.env.VIDEO_PROXY_TIMEOUT_MS || 600000);
  if (!Number.isFinite(numeric)) return 600000;
  return Math.max(1000, Math.min(3600000, Math.round(numeric)));
}

function createVideoGenerateRouter(overrides = {}) {
  const router = express.Router();
  const generateVideoInternal = overrides.generateVideo || createGenerateVideoHandler({
    generateSd: overrides.generateSd || sdToolsModule.generateImageInternal || sdToolsModule.generateSdInternal,
    fetch: overrides.fetch,
    uploadBufferToR2: overrides.uploadBufferToR2,
    buildCanonicalImageMaskFromText: overrides.buildCanonicalImageMaskFromText,
    compileMaskImageGenerateRuntime: overrides.compileMaskImageGenerateRuntime,
    runFfmpeg: overrides.runFfmpeg,
  });
  const fetchImpl = overrides.fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  async function handleGenerate(req, res) {
    try {
      const videoProxyUrl = resolveVideoProxyUrl();
      if (videoProxyUrl) {
        if (typeof fetchImpl !== 'function') {
          return res.status(500).json({
            ok: false,
            error: 'video_proxy_fetch_unavailable',
            message: 'fetch_unavailable_for_video_proxy',
          });
        }
        const proxyResponse = await fetchImpl(videoProxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(req.body || {}),
          signal: AbortSignal.timeout(resolveVideoProxyTimeoutMs()),
        });
        const text = await proxyResponse.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }

        if (!proxyResponse.ok) {
          return res.status(proxyResponse.status || 502).json(
            payload || {
              ok: false,
              error: 'video_proxy_failed',
              message: text || `video_proxy_status_${proxyResponse.status}`,
            }
          );
        }

        return res.json(payload || {
          ok: true,
          proxied: true,
          raw: text,
        });
      }

      const result = await generateVideoInternal({
        req,
        prompt: req.body?.prompt || req.body?.message || '',
        body: req.body || {},
      });
      return res.json(result);
    } catch (error_) {
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || {
          ok: false,
          error: 'video_generation_failed',
          message: String(error_?.message || error_),
        }
      );
    }
  }

  router.post('/video/generate', express.json({ limit: '4mb' }), handleGenerate);
  router.post('/tools/generate_video', express.json({ limit: '4mb' }), handleGenerate);

  return {
    router,
    generateVideoInternal,
  };
}

function looksLikeDependencyBag(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      'generateSd' in value
      || 'generateVideo' in value
      || 'fetch' in value
      || 'uploadBufferToR2' in value
      || 'buildCanonicalImageMaskFromText' in value
      || 'compileMaskImageGenerateRuntime' in value
      || 'runFfmpeg' in value
    )
  );
}

const defaultVideoRouter = createVideoGenerateRouter();

function videoGenerateEntrypoint(...args) {
  if (args.length === 1 && looksLikeDependencyBag(args[0])) {
    return createVideoGenerateRouter(args[0]);
  }
  return defaultVideoRouter.router(...args);
}

videoGenerateEntrypoint.router = defaultVideoRouter.router;
videoGenerateEntrypoint.generateVideoInternal = defaultVideoRouter.generateVideoInternal;
videoGenerateEntrypoint.createVideoGenerateRouter = createVideoGenerateRouter;

module.exports = videoGenerateEntrypoint;

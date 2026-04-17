const express = require('express');

const sdToolsModule = require('./sd-tools.cjs');
const {
  createGenerateVideoHandler,
} = require('../video/video-generate-runtime.cjs');

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

  async function handleGenerate(req, res) {
    try {
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

const express = require('express');
const sdToolsModule = require('./sd-tools.cjs');
const {
  runImageAtelier,
  toImageAtelierPayload,
} = require('../mask/image-atelier-runtime.cjs');

function resolveDependencies(overrides = {}) {
  return {
    runImageAtelier: overrides.runImageAtelier || runImageAtelier,
    generateImage: overrides.generateImage || sdToolsModule.generateImageInternal || sdToolsModule.generateSdInternal,
  };
}

function createImageAtelierRouter(overrides = {}) {
  const {
    runImageAtelier: runImageAtelierRuntime,
    generateImage,
  } = resolveDependencies(overrides);
  const router = express.Router();

  router.post('/image/atelier', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if ((!body.mask || typeof body.mask !== 'object') && !String(body.message || '').trim()) {
        return res.status(400).json({
          ok: false,
          error: 'missing_image_input',
          message: 'Fournis soit "message", soit "mask" pour lancer l atelier image.',
        });
      }
      const atelierResult = await runImageAtelierRuntime({
        req,
        message: body.message,
        rawMask: body.mask,
        max_rounds: body.max_rounds,
        return_trace: body.return_trace,
        generateImage,
      });
      return res.json(toImageAtelierPayload(atelierResult));
    } catch (error_) {
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || {
          ok: false,
          error: 'internal_error',
          message: String(error_?.message || error_),
        }
      );
    }
  });

  return router;
}

function looksLikeDependencyBag(value) {
  return !!(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      'runImageAtelier' in value
      || 'generateImage' in value
    )
  );
}

const defaultRouter = createImageAtelierRouter();

function imageAtelierEntrypoint(...args) {
  if (args.length === 1 && looksLikeDependencyBag(args[0])) {
    return createImageAtelierRouter(args[0]);
  }
  return defaultRouter(...args);
}

imageAtelierEntrypoint.router = defaultRouter;
imageAtelierEntrypoint.createImageAtelierRouter = createImageAtelierRouter;

module.exports = imageAtelierEntrypoint;

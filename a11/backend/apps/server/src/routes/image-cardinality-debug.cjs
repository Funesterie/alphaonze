const express = require('express');
const {
  inferExpectedImageContract: defaultInferExpectedImageContract,
  resolveVisionConfig: defaultResolveVisionConfig,
  verifyGeneratedImageCardinality: defaultVerifyGeneratedImageCardinality,
  buildVerificationDebugMeta,
} = require('../image/verify-generated-image-cardinality.cjs');

function createImageCardinalityDebugRouter({
  verifyJWT,
  isAdminRequest,
  inferExpectedImageContract = defaultInferExpectedImageContract,
  resolveVisionConfig = defaultResolveVisionConfig,
  verifyGeneratedImageCardinality = defaultVerifyGeneratedImageCardinality,
} = {}) {
  const router = express.Router();

  router.post(
    '/image-cardinality',
    express.json({ limit: '2mb' }),
    (req, res, next) => {
      if (typeof verifyJWT !== 'function') {
        return res.status(500).json({ ok: false, error: 'admin_auth_not_configured' });
      }
      return verifyJWT(req, res, next);
    },
    (req, res, next) => {
      if (typeof isAdminRequest !== 'function') {
        return res.status(500).json({ ok: false, error: 'admin_guard_not_configured' });
      }
      if (!isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }
      return next();
    },
    async (req, res) => {
      try {
        const imageUrl = String(req.body?.imageUrl || req.body?.image_url || '').trim();
        if (!imageUrl) {
          return res.status(400).json({ ok: false, error: 'missing_image_url' });
        }

        const expected = req.body?.expected && typeof req.body.expected === 'object'
          ? req.body.expected
          : inferExpectedImageContract({
              mask: req.body?.mask && typeof req.body.mask === 'object' ? req.body.mask : undefined,
              compiledState: req.body?.compiledState && typeof req.body.compiledState === 'object' ? req.body.compiledState : undefined,
            });

        const verification = await verifyGeneratedImageCardinality({
          imageUrl,
          expected,
          requestId: String(req.body?.requestId || req.headers['x-request-id'] || 'manual-debug').trim(),
          prompt: String(req.body?.prompt || req.body?.mask?.raw || '').trim(),
          seed: req.body?.seed,
        });

        return res.json({
          ok: true,
          imageUrl,
          expected,
          config: resolveVisionConfig(),
          verification,
          debug: buildVerificationDebugMeta(verification),
        });
      } catch (error_) {
        return res.status(error_?.statusCode || 500).json(
          error_?.payload || { ok: false, error: 'image_cardinality_debug_failed', message: String(error_?.message || error_) }
        );
      }
    }
  );

  return router;
}

module.exports = createImageCardinalityDebugRouter;

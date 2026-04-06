// Route canonique MASK-first pour image.generate
const express = require('express');
const router = express.Router();
const sdToolsModule = require('./sd-tools.cjs');
const {
  generateImageFromMask,
  toImageChatProxyPayload,
} = require('../mask/image-chat-runtime.cjs');

router.post('/generate-mask', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    try {
      const imageResult = await generateImageFromMask({
        req,
        rawMask: req.body,
        generateSd: sdToolsModule.generateSdInternal,
      });
      return res.json(toImageChatProxyPayload(imageResult));
    } catch (error_) {
      return res.status(error_?.statusCode || 500).json(
        error_?.payload || { ok: false, error: 'sd_failed', message: String(error_?.message || error_) }
      );
    }
  } catch (error_) {
    return res.status(500).json({ ok: false, error: 'internal_error', message: String(error_?.message || error_) });
  }
});

module.exports = router;

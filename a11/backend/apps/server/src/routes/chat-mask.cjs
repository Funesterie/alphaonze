// routes/chat-mask.cjs
// Route de test pour le flux texte → MASK → code Python

const express = require('express');
const router = express.Router();
const { createIntentResolver } = require('../resolve-user-request.cjs');

router.use(express.json({ limit: '2mb' }));

const intentResolver = createIntentResolver();

router.post('/mask', async (req, res) => {
  const userMessage = String(req.body?.message || req.body?.text || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'missing_message' });
  }

  try {
    const resolution = await intentResolver.resolveUserRequest({
      req,
      body: req.body || {},
      userText: userMessage,
      preferredDomain: 'code',
    });

    if (
      resolution.kind !== 'code.python.generate'
      || resolution.mask?.task?.domain !== 'filesystem'
      || resolution.mask?.task?.action !== 'sort_images'
    ) {
      return res.status(400).json({
        error: 'no_mask_match',
        message: 'Aucun pattern MASK reconnu pour ce message.',
      });
    }

    return res.json({
      ok: true,
      traceId: resolution.traceId,
      pipeline: resolution.pipeline,
      kind: resolution.kind,
      mask: resolution.mask,
      code: resolution.code,
    });
  } catch (error_) {
    return res.status(error_?.statusCode || 400).json(
      error_?.payload || { error: 'compilation_failed', message: String(error_?.message || error_) }
    );
  }
});

module.exports = router;

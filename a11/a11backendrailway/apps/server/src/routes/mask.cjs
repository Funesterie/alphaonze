// routes/mask.cjs
// Express route for /api/mask/compile

const express = require('express');
const router = express.Router();
const validateMaskUnified = require('../mask/validate-mask-unified.cjs');
const compileMaskUnified = require('../mask/compile-mask-unified.cjs');
const { createIntentResolver } = require('../resolve-user-request.cjs');

router.use(express.json({ limit: '2mb' }));

router.post('/compile', (req, res) => {
  const mask = req.body;
  const validation = validateMaskUnified(mask);
  const intent = mask?.intent;
  const domain = mask?.task?.domain;
  const action = mask?.task?.action;
  if (!validation.valid) {
    console.warn(`[MASK][compile] Rejete: ${validation.error} | intent=${intent} domain=${domain} action=${action}`);
    return res.status(400).json({ error: validation.error });
  }
  try {
    const compiled = compileMaskUnified(mask);
    console.log(`[MASK][compile] OK | intent=${intent} domain=${domain} action=${action}`);
    if (compiled?.target === 'python' && typeof compiled.value === 'string') {
      return res.json({ code: compiled.value });
    }
    return res.json({
      compiled: compiled?.value,
      target: compiled?.target || null,
    });
  } catch (err) {
    console.warn(`[MASK][compile] Erreur compilation: ${err.message} | intent=${intent} domain=${domain} action=${action}`);
    return res.status(400).json({ error: err.message });
  }
});

const intentResolver = createIntentResolver();

router.post('/from-text', async (req, res) => {
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

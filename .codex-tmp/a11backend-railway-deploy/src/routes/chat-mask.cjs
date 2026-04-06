// routes/chat-mask.cjs
// Route de test pour le flux texte → MASK → code Python

const express = require('express');
const router = express.Router();
const tryBuildMaskFromText = require('../mask/try-build-mask-from-text.cjs');
const validateMask = require('../mask/validate-mask.cjs');
const compileMaskToPython = require('../mask/compile-mask-to-python.cjs');

router.use(express.json({ limit: '2mb' }));

router.post('/mask', (req, res) => {
  const userMessage = String(req.body?.message || req.body?.text || '').trim();
  if (!userMessage) {
    return res.status(400).json({ error: 'missing_message' });
  }
  const mask = tryBuildMaskFromText(userMessage);
  if (!mask) {
    return res.status(400).json({ error: 'no_mask_match', message: 'Aucun pattern MASK reconnu pour ce message.' });
  }
  const validation = validateMask(mask);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid_mask', details: validation.error });
  }
  try {
    const code = compileMaskToPython(mask);
    return res.json({ ok: true, mask, code });
  } catch (err) {
    return res.status(400).json({ error: 'compilation_failed', message: err.message });
  }
});

module.exports = router;

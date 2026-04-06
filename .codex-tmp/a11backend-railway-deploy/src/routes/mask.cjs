// routes/mask.cjs
// Express route for /api/mask/compile

const express = require('express');
const router = express.Router();
const validateMask = require('../mask/validate-mask.cjs');
const compileMaskToPython = require('../mask/compile-mask-to-python.cjs');

router.use(express.json({ limit: '2mb' }));

router.post('/compile', (req, res) => {
  const mask = req.body;
  const validation = validateMask(mask);
  const intent = mask?.intent;
  const domain = mask?.task?.domain;
  const action = mask?.task?.action;
  if (!validation.valid) {
    console.warn(`[MASK][compile] Rejeté: ${validation.error} | intent=${intent} domain=${domain} action=${action}`);
    return res.status(400).json({ error: validation.error });
  }
  try {
    const code = compileMaskToPython(mask);
    console.log(`[MASK][compile] OK | intent=${intent} domain=${domain} action=${action}`);
    res.json({ code });
  } catch (err) {
    console.warn(`[MASK][compile] Erreur compilation: ${err.message} | intent=${intent} domain=${domain} action=${action}`);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

// --- Route expérimentale : POST /api/mask/from-text ---
// Prend du texte brut, tente de parser en MASK, valide, compile, retourne code ou erreur explicite
const tryBuildMaskFromText = require('../mask/try-build-mask-from-text.cjs');

router.post('/from-text', (req, res) => {
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

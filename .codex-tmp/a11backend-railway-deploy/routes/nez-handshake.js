const express = require('express');
const router = express.Router();
let nez = null;
try {
  nez = require('nezlephant');
} catch (e) {
  // nezlephant not installed; handshake will return 501 if used
}
const jwt = require('jsonwebtoken');

// POST /v1/nez/handshake
// Accepts JSON payload with either { devToken } for quick dev flow
// or { oc8: '<string>' } / { image_base64: '<base64>' } for real Nezlephant validation.
router.post('/handshake', async (req, res) => {
  try {
    const body = req.body || {};
    const secret = process.env.NEZ_JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'NEZ_MISCONFIG', message: 'NEZ_JWT_SECRET not configured' });
    }

    // Dev quick flow: accept NEZ_ALLOWED_TOKEN or devToken matching env
    if (process.env.NEZ_ALLOWED_TOKEN && body.devToken && body.devToken === process.env.NEZ_ALLOWED_TOKEN) {
      const token = jwt.sign({ sub: 'dev-fallback' }, secret, { expiresIn: '15m' });
      return res.json({ token });
    }

    if (!nez) {
      return res.status(501).json({ error: 'nezlephant_missing', message: 'Nezlephant library not installed' });
    }

    // Try validate via nezlephant API (adapt to library interface)
    let valid = false;
    let claims = {};
    if (body.oc8) {
      // assume nez.validateOC8 exists
      if (typeof nez.validateOC8 === 'function') {
        const r = await nez.validateOC8(body.oc8);
        valid = !!r?.valid;
        claims = r?.claims || {};
      }
    } else if (body.image_base64) {
      if (typeof nez.decodeImage === 'function') {
        const r = await nez.decodeImage(body.image_base64);
        valid = !!r?.valid;
        claims = r?.claims || {};
      }
    }

    if (!valid) {
      return res.status(400).json({ error: 'nez_invalid', message: 'Nezlephant validation failed' });
    }

    const token = jwt.sign({ sub: claims.sub || 'nez-user', claims }, secret, { expiresIn: '15m' });
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'nez_handshake_error', message: String(err.message) });
  }
});

module.exports = router;

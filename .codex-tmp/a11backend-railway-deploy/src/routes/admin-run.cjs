const express = require('express');

function createAdminRunRouter({ isAdminRequest, runQflushFlow } = {}) {
  const router = express.Router();

  router.post('/admin/run', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      if (typeof isAdminRequest !== 'function' || !isAdminRequest(req)) {
        return res.status(403).json({
          ok: false,
          error: 'admin_required',
          message: 'Accès réservé à l’admin.',
        });
      }

      const { flow, payload } = req.body || {};
      if (!flow || typeof flow !== 'string') {
        return res.status(400).json({
          ok: false,
          error: 'missing_flow',
          message: 'Champ "flow" requis.',
        });
      }

      if (typeof runQflushFlow !== 'function') {
        return res.status(500).json({
          ok: false,
          error: 'qflush_unavailable',
          message: 'runQflushFlow unavailable',
        });
      }

      const result = await runQflushFlow(flow, payload || {}, { admin: true });
      return res.json({ ok: true, result });
    } catch (error_) {
      console.error('[A11][admin/run] error:', error_?.message);
      return res.status(500).json({ ok: false, error: String(error_?.message || error_) });
    }
  });

  return router;
}

module.exports = createAdminRunRouter;

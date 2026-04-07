const express = require('express');
const { ensureRequestId, truncateText } = require('../../lib/request-context.cjs');

function buildAdminRunErrorPayload(error_, requestId) {
  const payload = {
    ok: false,
    error: String(error_?.error || 'admin_run_failed'),
    requestId,
    message: String(error_?.message || error_),
  };

  if (error_?.upstream && typeof error_.upstream === 'object') {
    payload.upstream = {
      ...error_.upstream,
      body: error_?.upstream?.body ? truncateText(error_.upstream.body, 2000) : null,
    };
  }

  return payload;
}

function createAdminRunRouter({ isAdminRequest, runQflushFlow } = {}) {
  const router = express.Router();

  router.post('/admin/run', express.json({ limit: '2mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      if (typeof isAdminRequest !== 'function' || !isAdminRequest(req)) {
        return res.status(403).json({
          ok: false,
          error: 'admin_required',
          requestId,
          message: 'Accès réservé à l’admin.',
        });
      }

      const { flow, payload } = req.body || {};
      if (!flow || typeof flow !== 'string') {
        return res.status(400).json({
          ok: false,
          error: 'missing_flow',
          requestId,
          message: 'Champ "flow" requis.',
        });
      }

      if (typeof runQflushFlow !== 'function') {
        return res.status(500).json({
          ok: false,
          error: 'qflush_unavailable',
          requestId,
          message: 'runQflushFlow unavailable',
        });
      }

      const result = await runQflushFlow(flow, payload || {}, { admin: true, requestId });
      return res.json({ ok: true, requestId, result });
    } catch (error_) {
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 500;
      console.error(`[A11][admin/run] requestId=${requestId} error:`, error_?.message || error_);
      return res.status(status).json(buildAdminRunErrorPayload(error_, requestId));
    }
  });

  return router;
}

module.exports = createAdminRunRouter;

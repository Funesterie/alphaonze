'use strict';

const express = require('express');

function sendServiceError(res, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: String(error?.code || 'sudoku_capability_failed'),
    message: String(error?.message || 'Sudoku capability failed.'),
  });
}

function readCapabilityToken(req = {}) {
  const header = String(req.headers?.['x-a11-creative-capability'] || '').trim();
  if (header) return header;
  const authorization = String(req.headers?.authorization || '').trim();
  return authorization.startsWith('Capability ') ? authorization.slice('Capability '.length).trim() : '';
}

function createSudokuCapabilityRouter({ service } = {}) {
  if (!service) throw new TypeError('sudoku capability service is required');
  const router = express.Router();

  router.get('/status', (req, res) => res.json(service.status(req.user || {})));

  router.post('/challenges', express.json({ limit: '32kb' }), (req, res) => {
    try {
      return res.status(201).json({ ok: true, challenge: service.createChallenge(req.user || {}) });
    } catch (error) {
      return sendServiceError(res, error);
    }
  });

  router.post('/challenges/:id/solve', express.json({ limit: '32kb' }), (req, res) => {
    try {
      const challenge = service.solveChallenge(req.params.id, req.user || {}, req.body?.solution);
      return res.json({ ok: true, challenge });
    } catch (error) {
      return sendServiceError(res, error);
    }
  });

  router.post('/challenges/:id/approve', express.json({ limit: '32kb' }), (req, res) => {
    try {
      if (req.body?.confirm !== 'marvin-approve-creative-session') {
        return res.status(400).json({
          ok: false,
          error: 'marvin_confirmation_required',
          message: 'Confirmation explicite Marvin manquante.',
        });
      }
      const challenge = service.approveChallenge(req.params.id, req.user || {}, req.body?.approvalCode);
      return res.json({ ok: true, challenge });
    } catch (error) {
      return sendServiceError(res, error);
    }
  });

  router.post('/challenges/:id/redeem', express.json({ limit: '8kb' }), (req, res) => {
    try {
      return res.json(service.redeemChallenge(req.params.id, req.user || {}));
    } catch (error) {
      return sendServiceError(res, error);
    }
  });

  router.get('/validate', (req, res) => {
    try {
      const token = readCapabilityToken(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'creative_capability_missing' });
      }
      return res.json(service.verifyCapabilityToken(token, req.user || {}));
    } catch (error) {
      return sendServiceError(res, error);
    }
  });

  return router;
}

module.exports = {
  createSudokuCapabilityRouter,
  readCapabilityToken,
};

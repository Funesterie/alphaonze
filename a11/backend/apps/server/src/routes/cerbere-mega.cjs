'use strict';

const express = require('express');
const {
  authorizeCerbereMega,
  buildCerbereMegaContext,
  buildCerbereMegaState,
} = require('../security/cerbere-mega.cjs');

function createCerbereMegaRouter({ db = null, env = process.env } = {}) {
  const router = express.Router();

  router.get('/context', async (req, res) => {
    try {
      const state = await buildCerbereMegaState({
        user: req.user || {},
        req,
        db,
        env,
      });
      return res.json({
        ok: true,
        state,
        context: buildCerbereMegaContext(state),
      });
    } catch (error) {
      console.warn('[CerbereMega] context failed:', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'cerbere_context_failed',
      });
    }
  });

  router.post('/authorize', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const capability = String(req.body?.capability || req.query?.capability || '').trim();
      if (!capability) {
        return res.status(400).json({
          ok: false,
          error: 'missing_capability',
        });
      }

      const state = await buildCerbereMegaState({
        user: req.user || {},
        req,
        db,
        env,
      });
      const decision = authorizeCerbereMega(state, capability);
      return res.status(decision.allowed ? 200 : 403).json({
        ...decision,
        state,
      });
    } catch (error) {
      console.warn('[CerbereMega] authorize failed:', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'cerbere_authorize_failed',
      });
    }
  });

  return router;
}

module.exports = createCerbereMegaRouter;

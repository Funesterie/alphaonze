'use strict';

const express = require('express');
const {
  buildMolliePublicConfig,
  buildMollieWebhookInput,
  createMolliePayment,
  fetchMollieMethods,
  fetchMolliePayment,
  fetchMolliePayments,
  fetchMollieProfiles,
  fetchMollieSummary,
} = require('../lib/mollie-client.cjs');

function sendNotConfigured(res, env) {
  const config = buildMolliePublicConfig(env);
  if (config.configured) return false;
  res.status(503).json({
    ok: false,
    configured: false,
    error: 'mollie_not_configured',
    missing: config.missing,
  });
  return true;
}

function sendMollieError(res, error) {
  const status = Number(error?.status || 0);
  return res.status(status >= 400 && status < 500 ? status : 502).json({
    ok: false,
    configured: true,
    error: error?.code || 'mollie_request_failed',
    status: status || null,
    message: status === 401 || status === 403
      ? 'Cle API Mollie refusee ou droits insuffisants.'
      : 'Verification Mollie impossible pour le moment.',
  });
}

function createMollieRouter({
  env = process.env,
  fetchImpl = globalThis.fetch,
  verifyJWT = (_req, _res, next) => next(),
  hasFinanceAccess = () => false,
  db = null,
} = {}) {
  const router = express.Router();

  router.post('/webhook', express.urlencoded({ extended: false }), express.json(), async (req, res) => {
    const input = buildMollieWebhookInput({
      ...(req.query || {}),
      ...(req.body || {}),
    });
    if (!input.id) {
      return res.status(400).json({
        ok: false,
        error: 'mollie_payment_id_required',
      });
    }
    if (sendNotConfigured(res, env)) return undefined;

    try {
      const payment = await fetchMolliePayment({ env, fetchImpl, id: input.id });
      if (db?.collection) {
        try {
          await db.collection('mollie_webhook_events').insertOne({
            paymentId: input.id,
            payment: payment.payment,
            receivedAt: new Date(),
          });
        } catch {
          // Webhooks should acknowledge Mollie even if local bookkeeping is down.
        }
      }
      return res.json({
        ok: true,
        received: true,
        payment: payment.payment,
      });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  router.use(verifyJWT);

  router.use((req, res, next) => {
    if (hasFinanceAccess(req.user || {})) return next();
    return res.status(403).json({
      ok: false,
      error: 'mollie_admin_required',
      message: 'Acces Mollie reserve au compte admin/famille.',
    });
  });

  router.get('/config', (_req, res) => {
    return res.json({
      ok: true,
      ...buildMolliePublicConfig(env),
      note: 'Mollie utilise Authorization: Bearer <api-key>. La cle API n est jamais renvoyee.',
    });
  });

  router.get('/methods', async (req, res) => {
    if (sendNotConfigured(res, env)) return;
    try {
      const methods = await fetchMollieMethods({ env, fetchImpl, query: req.query || {} });
      return res.json({ ok: true, configured: true, ...methods });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  router.get('/profiles', async (req, res) => {
    if (sendNotConfigured(res, env)) return;
    try {
      const profiles = await fetchMollieProfiles({ env, fetchImpl, query: req.query || {} });
      return res.json({ ok: true, configured: true, ...profiles });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  router.get('/summary', async (req, res) => {
    if (sendNotConfigured(res, env)) return;
    try {
      const summary = await fetchMollieSummary({ env, fetchImpl, query: req.query || {} });
      return res.json({ ok: true, configured: true, ...summary });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  router.get('/payments', async (req, res) => {
    if (sendNotConfigured(res, env)) return;
    try {
      const payments = await fetchMolliePayments({ env, fetchImpl, query: req.query || {} });
      return res.json({ ok: true, configured: true, ...payments });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  router.get('/payments/:id', async (req, res) => {
    if (sendNotConfigured(res, env)) return;
    try {
      const payment = await fetchMolliePayment({ env, fetchImpl, id: req.params.id });
      return res.json({ ok: true, configured: true, ...payment });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  router.post('/payments', async (req, res) => {
    const config = buildMolliePublicConfig(env);
    if (!config.configured) return sendNotConfigured(res, env);
    if (!config.allowPaymentCreate) {
      return res.status(403).json({
        ok: false,
        error: 'mollie_payment_create_disabled',
        message: 'Creation de paiement desactivee. Definir MOLLIE_ALLOW_PAYMENT_CREATE=true apres validation explicite.',
      });
    }

    try {
      const payment = await createMolliePayment({
        env,
        fetchImpl,
        amount: req.body?.amount,
        currency: req.body?.currency,
        description: req.body?.description,
        redirectUrl: req.body?.redirectUrl || req.body?.redirect_url,
        webhookUrl: req.body?.webhookUrl || req.body?.webhook_url || env.MOLLIE_WEBHOOK_URL,
        metadata: req.body?.metadata,
      });
      return res.status(201).json({ ok: true, configured: true, ...payment });
    } catch (error) {
      return sendMollieError(res, error);
    }
  });

  return router;
}

module.exports = {
  createMollieRouter,
};

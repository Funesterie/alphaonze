'use strict';

const express = require('express');
const {
  buildQontoPublicConfig,
  fetchQontoBankAccounts,
  fetchQontoOrganization,
  fetchQontoSummary,
  fetchQontoTransactions,
} = require('../lib/qonto-client.cjs');

function sendNotConfigured(res, env) {
  const config = buildQontoPublicConfig(env);
  if (config.configured) return false;
  res.status(503).json({
    ok: false,
    configured: false,
    error: 'qonto_not_configured',
    missing: config.missing,
  });
  return true;
}

function sendQontoError(res, error) {
  const status = Number(error?.status || 0);
  return res.status(status >= 400 && status < 500 ? status : 502).json({
    ok: false,
    configured: true,
    error: error?.code || 'qonto_check_failed',
    status: status || null,
    message: status === 401 || status === 403
      ? 'Identifiants Qonto refuses ou compte non encore autorise.'
      : 'Verification Qonto impossible pour le moment.',
  });
}

function queryValue(query, names) {
  for (const name of names) {
    if (query[name] !== undefined) return query[name];
  }
  return undefined;
}

function buildTransactionsInput(query) {
  return {
    bankAccountId: queryValue(query, ['bankAccountId', 'bank_account_id']),
    iban: query.iban,
    page: query.page,
    perPage: queryValue(query, ['perPage', 'per_page']),
    status: queryValue(query, ['status', 'statuses', 'status[]']),
    includes: queryValue(query, ['includes', 'include', 'includes[]']),
    operationType: queryValue(query, ['operationType', 'operationTypes', 'operation_type', 'operation_type[]']),
    side: query.side,
    sortBy: queryValue(query, ['sortBy', 'sort_by']),
    withAttachments: queryValue(query, ['withAttachments', 'with_attachments']),
    settledAtFrom: queryValue(query, ['settledAtFrom', 'settled_at_from']),
    settledAtTo: queryValue(query, ['settledAtTo', 'settled_at_to']),
    updatedAtFrom: queryValue(query, ['updatedAtFrom', 'updated_at_from']),
    updatedAtTo: queryValue(query, ['updatedAtTo', 'updated_at_to']),
    emittedAtFrom: queryValue(query, ['emittedAtFrom', 'emitted_at_from']),
    emittedAtTo: queryValue(query, ['emittedAtTo', 'emitted_at_to']),
  };
}

function createQontoRouter({
  env = process.env,
  fetchImpl = globalThis.fetch,
  hasFinanceAccess = () => false,
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (hasFinanceAccess(req.user || {})) return next();
    return res.status(403).json({
      ok: false,
      error: 'qonto_admin_required',
      message: 'Acces Qonto reserve au compte admin/famille.',
    });
  });

  router.get('/config', (_req, res) => {
    return res.json({
      ok: true,
      ...buildQontoPublicConfig(env),
      note: 'Qonto utilise Authorization: login:secret-key. La cle et le staging token ne sont jamais renvoyes.',
    });
  });

  router.get('/organization', async (_req, res) => {
    if (sendNotConfigured(res, env)) return;

    try {
      const organization = await fetchQontoOrganization({ env, fetchImpl });
      return res.json({
        ok: true,
        configured: true,
        ...organization,
      });
    } catch (error) {
      return sendQontoError(res, error);
    }
  });

  router.get('/bank-accounts', async (req, res) => {
    if (sendNotConfigured(res, env)) return;

    try {
      const bankAccounts = await fetchQontoBankAccounts({
        env,
        fetchImpl,
        query: {
          page: req.query?.page,
          perPage: queryValue(req.query || {}, ['perPage', 'per_page']),
        },
      });
      return res.json({
        ok: true,
        configured: true,
        ...bankAccounts,
      });
    } catch (error) {
      return sendQontoError(res, error);
    }
  });

  router.get('/transactions', async (req, res) => {
    if (sendNotConfigured(res, env)) return;

    try {
      const transactions = await fetchQontoTransactions({
        env,
        fetchImpl,
        query: buildTransactionsInput(req.query || {}),
      });
      return res.json({
        ok: true,
        configured: true,
        ...transactions,
      });
    } catch (error) {
      return sendQontoError(res, error);
    }
  });

  router.get('/summary', async (req, res) => {
    if (sendNotConfigured(res, env)) return;

    try {
      const summary = await fetchQontoSummary({
        env,
        fetchImpl,
        query: buildTransactionsInput(req.query || {}),
      });
      return res.json({
        ok: true,
        configured: true,
        ...summary,
      });
    } catch (error) {
      return sendQontoError(res, error);
    }
  });

  return router;
}

module.exports = {
  createQontoRouter,
};

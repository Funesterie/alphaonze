const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createQontoRouter } = require('../routes/qonto.cjs');

async function withServer({ env, fetchImpl, hasFinanceAccess = () => true }, runAssertions) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin', email: 'jeffrey@example.test', fullAccess: true };
    next();
  });
  app.use('/api/qonto', createQontoRouter({ env, fetchImpl, hasFinanceAccess }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await runAssertions(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createFetchMock(requests = []) {
  return async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/organization')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          organization: {
            id: 'org_123',
            name: 'Funesterie',
            legal_name: 'Funesterie EI',
            iban: 'FR7611112222333344445555666',
            bank_accounts: [{
              id: 'ba_123',
              name: 'Compte principal',
              iban: 'FR7611112222333344445555666',
              balance_cents: 123456,
              currency: 'EUR',
            }],
          },
        }),
      };
    }
    if (String(url).includes('/bank_accounts')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          bank_accounts: [{
            id: 'ba_123',
            name: 'Compte principal',
            iban: 'FR7611112222333344445555666',
            balance_cents: 123456,
            currency: 'EUR',
          }],
        }),
      };
    }
    if (String(url).includes('/transactions')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          transactions: [{
            id: 'tr_123',
            bank_account_id: 'ba_123',
            amount_cents: -2500,
            currency: 'EUR',
            label: 'Fournisseur',
            counterparty_name: 'Example SAS',
          }],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  };
}

test('qonto config is admin-only and never exposes the secret', async () => {
  await withServer({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
      QONTO_STAGING_TOKEN: 'staging-token-value',
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qonto/config`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.loginConfigured, true);
    assert.equal(payload.secretConfigured, true);
    assert.equal(payload.stagingTokenConfigured, true);
    assert.equal(payload.readOnly, true);
    assert.equal(JSON.stringify(payload).includes('super-secret-key'), false);
    assert.equal(JSON.stringify(payload).includes('staging-token-value'), false);
  });
});

test('qonto organization endpoint returns sanitized organization details', async () => {
  const requests = [];
  await withServer({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
    },
    fetchImpl: createFetchMock(requests),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qonto/organization`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.organization.name, 'Funesterie');
    assert.equal(payload.organization.iban, undefined);
    assert.equal(payload.organization.bankAccounts[0].maskedIban, 'FR76...5666');
    assert.equal(requests[0].options.headers.Authorization, 'funesterie-7979:super-secret-key');
  });
});

test('qonto bank accounts endpoint returns masked accounts', async () => {
  await withServer({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
    },
    fetchImpl: createFetchMock([]),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qonto/bank-accounts`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.bankAccounts[0].id, 'ba_123');
    assert.equal(payload.bankAccounts[0].maskedIban, 'FR76...5666');
    assert.equal(payload.bankAccounts[0].iban, undefined);
  });
});

test('qonto transactions endpoint passes safe filters and returns sanitized transactions', async () => {
  const requests = [];
  await withServer({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
    },
    fetchImpl: createFetchMock(requests),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qonto/transactions?bankAccountId=ba_123&status=completed,pending&perPage=10`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.transactions[0].label, 'Fournisseur');
    assert.equal(payload.transactions[0].iban, undefined);

    const requestUrl = new URL(requests[0].url);
    assert.equal(requestUrl.pathname.endsWith('/transactions'), true);
    assert.equal(requestUrl.searchParams.get('bank_account_id'), 'ba_123');
    assert.equal(requestUrl.searchParams.get('per_page'), '10');
    assert.deepEqual(requestUrl.searchParams.getAll('status[]'), ['completed', 'pending']);
  });
});

test('qonto summary endpoint combines organization, accounts and recent transactions', async () => {
  await withServer({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
    },
    fetchImpl: createFetchMock([]),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qonto/summary`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.organization.name, 'Funesterie');
    assert.equal(payload.bankAccounts.length, 1);
    assert.equal(payload.recentTransactions.length, 1);
    assert.equal(payload.totalsByCurrency.EUR.debitCents, -2500);
  });
});

test('qonto route denies non finance users', async () => {
  await withServer({
    env: {},
    hasFinanceAccess: () => false,
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/qonto/config`);
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'qonto_admin_required');
  });
});

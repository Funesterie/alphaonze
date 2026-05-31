const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildQontoPublicConfig,
  buildTransactionQuery,
  fetchQontoBankAccounts,
  fetchQontoOrganization,
  fetchQontoTransactions,
  filterQontoBankAccounts,
  resolveQontoConfig,
} = require('../lib/qonto-client.cjs');

test('qonto config reads secret from file without exposing it publicly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qonto-test-'));
  const secretPath = path.join(dir, 'secret.txt');
  fs.writeFileSync(secretPath, 'super-secret-key\n', 'utf8');

  const env = {
    QONTO_API_LOGIN: 'funesterie-7979',
    QONTO_SECRET_KEY_FILE: secretPath,
  };

  const privateConfig = resolveQontoConfig(env);
  assert.equal(privateConfig.configured, true);
  assert.equal(privateConfig.authHeader, 'funesterie-7979:super-secret-key');

  const publicConfig = buildQontoPublicConfig(env);
  assert.equal(publicConfig.configured, true);
  assert.equal(publicConfig.secretConfigured, true);
  assert.equal(publicConfig.secretSource, 'QONTO_SECRET_KEY_FILE');
  assert.equal(publicConfig.readOnly, true);
  assert.equal(JSON.stringify(publicConfig).includes('super-secret-key'), false);
});

test('qonto organization check uses login:secret authorization header', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        organization: {
          id: 'org_123',
          name: 'Funesterie',
          legal_name: 'Funesterie EI',
          status: 'active',
        },
      }),
    };
  };

  const result = await fetchQontoOrganization({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
    },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.organization.name, 'Funesterie');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://thirdparty.qonto.com/v2/organization');
  assert.equal(requests[0].options.headers.Authorization, 'funesterie-7979:super-secret-key');
});

test('qonto staging token is sent but never exposed publicly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qonto-staging-test-'));
  const tokenPath = path.join(dir, 'staging-token.txt');
  fs.writeFileSync(tokenPath, 'staging-token-value\n', 'utf8');
  const requests = [];

  await fetchQontoOrganization({
    env: {
      QONTO_API_LOGIN: 'funesterie-7979',
      QONTO_SECRET_KEY: 'super-secret-key',
      QONTO_STAGING_TOKEN_FILE: tokenPath,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ organization: { id: 'org_123' } }),
      };
    },
  });

  const publicConfig = buildQontoPublicConfig({
    QONTO_API_LOGIN: 'funesterie-7979',
    QONTO_SECRET_KEY: 'super-secret-key',
    QONTO_STAGING_TOKEN_FILE: tokenPath,
  });
  assert.equal(requests[0].options.headers['X-Qonto-Staging-Token'], 'staging-token-value');
  assert.equal(publicConfig.stagingTokenConfigured, true);
  assert.equal(publicConfig.stagingTokenSource, 'QONTO_STAGING_TOKEN_FILE');
  assert.equal(JSON.stringify(publicConfig).includes('staging-token-value'), false);
});

test('qonto bank accounts and transactions are sanitized', async () => {
  const fetchImpl = async (url) => {
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
          iban: 'FR7600000000000000000000000',
        }],
      }),
    };
  };
  const env = {
    QONTO_API_LOGIN: 'funesterie-7979',
    QONTO_SECRET_KEY: 'super-secret-key',
  };

  const accounts = await fetchQontoBankAccounts({ env, fetchImpl });
  assert.equal(accounts.bankAccounts[0].maskedIban, 'FR76...5666');
  assert.equal(accounts.bankAccounts[0].iban, undefined);

  const transactions = await fetchQontoTransactions({
    env,
    fetchImpl,
    query: { bankAccountId: 'ba_123', status: ['completed'], perPage: 10 },
  });
  assert.equal(transactions.transactions[0].label, 'Fournisseur');
  assert.equal(transactions.transactions[0].iban, undefined);
});

test('qonto transaction query keeps only supported filters', () => {
  const query = buildTransactionQuery({
    bankAccountId: 'ba_123',
    perPage: 999,
    status: 'completed,pending',
    includes: ['attachments'],
    operationType: 'transfer',
    withAttachments: 'true',
    settledAtFrom: '2026-05-01',
    unknown: 'ignored',
  });

  assert.equal(query.bank_account_id, 'ba_123');
  assert.equal(query.per_page, 200);
  assert.deepEqual(query['status[]'], ['completed', 'pending']);
  assert.deepEqual(query['includes[]'], ['attachments']);
  assert.deepEqual(query['operation_type[]'], ['transfer']);
  assert.equal(query.with_attachments, 'true');
  assert.equal(query.unknown, undefined);
});

test('qonto excluded bank account ids are filtered from public account lists', () => {
  const accounts = filterQontoBankAccounts([
    { id: 'ba_keep', name: 'Compte principal' },
    { id: 'ba_drop', name: 'Compte BNP doublon' },
  ], {
    QONTO_EXCLUDED_BANK_ACCOUNT_IDS: 'ba_drop',
  });

  const publicConfig = buildQontoPublicConfig({
    QONTO_API_LOGIN: 'funesterie-7979',
    QONTO_SECRET_KEY: 'super-secret-key',
    QONTO_EXCLUDED_BANK_ACCOUNT_IDS: 'ba_drop',
  });

  assert.deepEqual(accounts.map((account) => account.id), ['ba_keep']);
  assert.equal(publicConfig.excludedBankAccountsCount, 1);
});

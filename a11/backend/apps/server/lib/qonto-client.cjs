'use strict';

const fs = require('node:fs');

const DEFAULT_QONTO_API_BASE_URL = 'https://thirdparty.qonto.com/v2';

function clean(value) {
  return String(value || '').trim();
}

function firstEnv(env, names) {
  for (const name of names) {
    const value = clean(env?.[name]);
    if (value) return { name, value };
  }
  return { name: null, value: '' };
}

function readSecretFile(filePath) {
  const resolved = clean(filePath);
  if (!resolved) return '';
  try {
    return clean(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return '';
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function appendQuery(url, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const cleaned = clean(item);
        if (cleaned) params.append(key, cleaned);
      }
      continue;
    }
    params.set(key, clean(value));
  }
  const encoded = params.toString();
  return encoded ? `${url}?${encoded}` : url;
}

function maskIban(value) {
  const iban = clean(value).replace(/\s+/g, '');
  if (!iban) return null;
  if (iban.length <= 8) return `${iban.slice(0, 2)}...`;
  return `${iban.slice(0, 4)}...${iban.slice(-4)}`;
}

function resolveQontoConfig(env = process.env) {
  const apiBaseUrl = clean(env.QONTO_API_BASE_URL) || DEFAULT_QONTO_API_BASE_URL;
  const login = firstEnv(env, [
    'QONTO_API_LOGIN',
    'QONTO_LOGIN',
    'QONTO_SIGN_IN',
    'QONTO_ORGANIZATION_LOGIN',
  ]);
  const secret = firstEnv(env, [
    'QONTO_SECRET_KEY',
    'QONTO_API_SECRET_KEY',
    'QONTO_API_KEY',
  ]);
  const secretFile = firstEnv(env, [
    'QONTO_SECRET_KEY_FILE',
    'QONTO_API_SECRET_KEY_FILE',
    'QONTO_API_KEY_FILE',
  ]);
  const stagingToken = firstEnv(env, [
    'QONTO_STAGING_TOKEN',
    'QONTO_SANDBOX_TOKEN',
  ]);
  const stagingTokenFile = firstEnv(env, [
    'QONTO_STAGING_TOKEN_FILE',
    'QONTO_SANDBOX_TOKEN_FILE',
  ]);
  const secretFromFile = secret.value ? '' : readSecretFile(secretFile.value);
  const stagingTokenFromFile = stagingToken.value ? '' : readSecretFile(stagingTokenFile.value);
  const effectiveSecret = secret.value || secretFromFile;
  const effectiveStagingToken = stagingToken.value || stagingTokenFromFile;
  const authHeader = login.value && effectiveSecret
    ? `${login.value}:${effectiveSecret}`
    : '';
  const missing = [];
  if (!login.value) missing.push('QONTO_API_LOGIN');
  if (!effectiveSecret) missing.push('QONTO_SECRET_KEY or QONTO_SECRET_KEY_FILE');

  return {
    configured: missing.length === 0,
    apiBaseUrl,
    login: login.value,
    loginSource: login.name,
    authHeader,
    secretConfigured: Boolean(effectiveSecret),
    secretSource: secret.value ? secret.name : (secretFromFile ? secretFile.name : null),
    secretFile: secretFile.value,
    stagingToken: effectiveStagingToken,
    stagingTokenConfigured: Boolean(effectiveStagingToken),
    stagingTokenSource: stagingToken.value
      ? stagingToken.name
      : (stagingTokenFromFile ? stagingTokenFile.name : null),
    stagingTokenFile: stagingTokenFile.value,
    missing,
  };
}

function buildQontoAuthHeader(config) {
  const header = clean(config?.authHeader);
  if (!header) {
    const error = new Error('qonto_credentials_missing');
    error.code = 'qonto_credentials_missing';
    error.missing = config?.missing || ['QONTO_API_LOGIN', 'QONTO_SECRET_KEY'];
    throw error;
  }
  return header;
}

function buildQontoHeaders(config) {
  const headers = {
    Authorization: buildQontoAuthHeader(config),
    Accept: 'application/json',
  };
  const stagingToken = clean(config?.stagingToken);
  if (stagingToken) headers['X-Qonto-Staging-Token'] = stagingToken;
  return headers;
}

function sanitizeQontoBankAccount(source = {}) {
  return {
    id: source.id || source.bank_account_id || null,
    slug: source.slug || null,
    name: source.name || source.account_name || source.label || null,
    type: source.account_type || source.type || null,
    currency: source.currency || null,
    balance: source.balance ?? source.authorized_balance ?? null,
    balanceCents: source.balance_cents ?? source.authorized_balance_cents ?? null,
    status: source.status || null,
    maskedIban: maskIban(source.iban),
  };
}

function sanitizeQontoOrganization(payload) {
  const source = payload?.organization || payload?.data?.organization || payload || {};
  const bankAccounts = Array.isArray(source.bank_accounts)
    ? source.bank_accounts.map(sanitizeQontoBankAccount)
    : undefined;
  return {
    id: source.id || source.organization_id || null,
    slug: source.slug || source.login || null,
    name: source.name || source.legal_name || source.trade_name || null,
    legalName: source.legal_name || null,
    status: source.status || source.state || null,
    verificationStatus: source.kyb_status || source.kyc_status || source.verification_status || null,
    country: source.legal_country || source.country || null,
    bankAccounts,
  };
}

function getExcludedBankAccountIds(env = process.env) {
  return new Set(splitList(env.QONTO_EXCLUDED_BANK_ACCOUNT_IDS || env.QONTO_IGNORED_BANK_ACCOUNT_IDS));
}

function filterQontoBankAccounts(accounts, env = process.env) {
  const excludedIds = getExcludedBankAccountIds(env);
  if (!excludedIds.size) return accounts;
  return accounts.filter((account) => !excludedIds.has(clean(account?.id)));
}

function sanitizeQontoTransaction(source = {}) {
  return {
    id: source.id || source.transaction_id || null,
    bankAccountId: source.bank_account_id || source.bankAccountId || null,
    amount: source.amount ?? null,
    amountCents: source.amount_cents ?? null,
    currency: source.currency || null,
    side: source.side || null,
    operationType: source.operation_type || source.operationType || null,
    status: source.status || null,
    settledAt: source.settled_at || source.settledAt || null,
    emittedAt: source.emitted_at || source.emittedAt || null,
    updatedAt: source.updated_at || source.updatedAt || null,
    label: source.label || source.reference || source.note || null,
    counterpartyName: source.counterparty_name || source.counterpartyName || null,
    category: source.category || source.category_name || null,
    attachmentIds: Array.isArray(source.attachment_ids) ? source.attachment_ids.slice(0, 20) : undefined,
  };
}

async function requestQontoJson({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
  path = '/organization',
  query = {},
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const config = resolveQontoConfig(env);
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const normalizedPath = `/${clean(path).replace(/^\/+/, '')}`;
  const url = appendQuery(`${baseUrl}${normalizedPath}`, query);
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: buildQontoHeaders(config),
    signal,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `qonto_http_${response.status}`);
    error.code = 'qonto_request_failed';
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    ok: true,
    status: response.status,
    payload,
  };
}

async function fetchQontoOrganization(options = {}) {
  const result = await requestQontoJson({ ...options, path: '/organization' });
  const organization = sanitizeQontoOrganization(result.payload);
  if (Array.isArray(organization.bankAccounts)) {
    organization.bankAccounts = filterQontoBankAccounts(organization.bankAccounts, options.env);
  }
  return {
    ok: true,
    status: result.status,
    organization,
  };
}

function buildPageQuery(input = {}, maxPerPage = 100) {
  return {
    page: clampInt(input.page, 1, 1, 100000),
    per_page: clampInt(input.perPage || input.per_page, maxPerPage, 1, maxPerPage),
  };
}

async function fetchQontoBankAccounts(options = {}) {
  const result = await requestQontoJson({
    ...options,
    path: '/bank_accounts',
    query: buildPageQuery(options.query || {}, 100),
  });
  const source = result.payload?.bank_accounts
    || result.payload?.data?.bank_accounts
    || result.payload?.organization?.bank_accounts
    || [];
  return {
    ok: true,
    status: result.status,
    bankAccounts: Array.isArray(source)
      ? filterQontoBankAccounts(source.map(sanitizeQontoBankAccount), options.env)
      : [],
  };
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const text = clean(value);
  if (!text) return [];
  return text.split(',').map(clean).filter(Boolean);
}

function buildTransactionQuery(input = {}) {
  const query = {
    page: clampInt(input.page, 1, 1, 100000),
    per_page: clampInt(input.perPage || input.per_page, 50, 1, 200),
  };
  const directKeys = [
    ['bank_account_id', input.bankAccountId || input.bank_account_id],
    ['iban', input.iban],
    ['settled_at_from', input.settledAtFrom || input.settled_at_from],
    ['settled_at_to', input.settledAtTo || input.settled_at_to],
    ['updated_at_from', input.updatedAtFrom || input.updated_at_from],
    ['updated_at_to', input.updatedAtTo || input.updated_at_to],
    ['emitted_at_from', input.emittedAtFrom || input.emitted_at_from],
    ['emitted_at_to', input.emittedAtTo || input.emitted_at_to],
    ['side', input.side],
    ['sort_by', input.sortBy || input.sort_by],
  ];
  for (const [key, value] of directKeys) {
    const cleaned = clean(value);
    if (cleaned) query[key] = cleaned;
  }
  const statuses = splitList(input.status || input.statuses || input['status[]']);
  if (statuses.length) query['status[]'] = statuses;
  const includes = splitList(input.includes || input.include || input['includes[]']);
  if (includes.length) query['includes[]'] = includes;
  const operationTypes = splitList(input.operationType || input.operationTypes || input.operation_type || input['operation_type[]']);
  if (operationTypes.length) query['operation_type[]'] = operationTypes;
  if (input.withAttachments !== undefined || input.with_attachments !== undefined) {
    query.with_attachments = clean(input.withAttachments ?? input.with_attachments) === 'true' ? 'true' : 'false';
  }
  return query;
}

async function fetchQontoTransactions(options = {}) {
  const query = buildTransactionQuery(options.query || {});
  const result = await requestQontoJson({ ...options, path: '/transactions', query });
  const source = result.payload?.transactions
    || result.payload?.data?.transactions
    || result.payload?.transactions_list
    || [];
  return {
    ok: true,
    status: result.status,
    page: query.page,
    perPage: query.per_page,
    transactions: Array.isArray(source) ? source.map(sanitizeQontoTransaction) : [],
  };
}

function addAmount(totals, transaction) {
  const currency = transaction.currency || 'unknown';
  if (!totals[currency]) {
    totals[currency] = {
      creditCents: 0,
      debitCents: 0,
      creditCount: 0,
      debitCount: 0,
    };
  }
  const cents = Number(transaction.amountCents ?? Math.round(Number(transaction.amount || 0) * 100));
  if (!Number.isFinite(cents)) return;
  if (cents >= 0) {
    totals[currency].creditCents += cents;
    totals[currency].creditCount += 1;
  } else {
    totals[currency].debitCents += cents;
    totals[currency].debitCount += 1;
  }
}

async function fetchQontoSummary(options = {}) {
  const organization = await fetchQontoOrganization(options);
  let bankAccounts = Array.isArray(organization.organization.bankAccounts)
    ? organization.organization.bankAccounts
    : [];
  if (!bankAccounts.length) {
    bankAccounts = (await fetchQontoBankAccounts(options)).bankAccounts;
  }
  const query = buildTransactionQuery({
    ...(options.query || {}),
    perPage: options.query?.perPage || options.query?.per_page || 30,
  });
  const accountFilter = clean(query.bank_account_id);
  const targetAccounts = accountFilter
    ? bankAccounts.filter((account) => clean(account.id) === accountFilter)
    : bankAccounts.slice(0, 3);
  if (accountFilter && !targetAccounts.length) {
    targetAccounts.push({ id: accountFilter, name: null, maskedIban: null });
  }

  const recentTransactions = [];
  const totalsByCurrency = {};
  for (const account of targetAccounts) {
    const transactions = await fetchQontoTransactions({
      ...options,
      query: {
        ...query,
        bankAccountId: account.id || query.bank_account_id,
      },
    });
    for (const transaction of transactions.transactions) {
      recentTransactions.push(transaction);
      addAmount(totalsByCurrency, transaction);
    }
  }

  return {
    ok: true,
    organization: organization.organization,
    bankAccounts,
    sampledBankAccounts: targetAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      maskedIban: account.maskedIban,
    })),
    recentTransactions: recentTransactions.slice(0, 100),
    totalsByCurrency,
  };
}

function buildQontoPublicConfig(env = process.env) {
  const config = resolveQontoConfig(env);
  const excludedIds = getExcludedBankAccountIds(env);
  return {
    configured: config.configured,
    apiBaseUrl: config.apiBaseUrl,
    loginConfigured: Boolean(config.login),
    secretConfigured: config.secretConfigured,
    secretSource: config.secretSource,
    stagingTokenConfigured: config.stagingTokenConfigured,
    stagingTokenSource: config.stagingTokenSource,
    missing: config.missing,
    mode: 'business-api-key',
    readOnly: true,
    excludedBankAccountsCount: excludedIds.size,
  };
}

module.exports = {
  DEFAULT_QONTO_API_BASE_URL,
  resolveQontoConfig,
  buildQontoAuthHeader,
  buildQontoPublicConfig,
  buildTransactionQuery,
  fetchQontoBankAccounts,
  fetchQontoOrganization,
  fetchQontoSummary,
  fetchQontoTransactions,
  filterQontoBankAccounts,
  getExcludedBankAccountIds,
  maskIban,
  requestQontoJson,
  sanitizeQontoBankAccount,
  sanitizeQontoOrganization,
  sanitizeQontoTransaction,
};

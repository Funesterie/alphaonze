'use strict';

const fs = require('node:fs');

const DEFAULT_MOLLIE_API_BASE_URL = 'https://api.mollie.com/v2';

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

function detectMollieMode(apiKey) {
  const key = clean(apiKey);
  if (key.startsWith('live_')) return 'live';
  if (key.startsWith('test_')) return 'test';
  return 'unknown';
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
    params.set(key, clean(value));
  }
  const encoded = params.toString();
  return encoded ? `${url}?${encoded}` : url;
}

function resolveMollieConfig(env = process.env) {
  const apiBaseUrl = clean(env.MOLLIE_API_BASE_URL) || DEFAULT_MOLLIE_API_BASE_URL;
  const apiKey = firstEnv(env, [
    'MOLLIE_API_KEY',
    'MOLLIE_SECRET_KEY',
  ]);
  const apiKeyFile = firstEnv(env, [
    'MOLLIE_API_KEY_FILE',
    'MOLLIE_SECRET_KEY_FILE',
  ]);
  const apiKeyFromFile = apiKey.value ? '' : readSecretFile(apiKeyFile.value);
  const effectiveApiKey = apiKey.value || apiKeyFromFile;
  const missing = [];
  if (!effectiveApiKey) missing.push('MOLLIE_API_KEY or MOLLIE_API_KEY_FILE');

  return {
    configured: missing.length === 0,
    apiBaseUrl,
    apiKey: effectiveApiKey,
    apiKeyConfigured: Boolean(effectiveApiKey),
    apiKeySource: apiKey.value ? apiKey.name : (apiKeyFromFile ? apiKeyFile.name : null),
    apiKeyFile: apiKeyFile.value,
    authHeader: effectiveApiKey ? `Bearer ${effectiveApiKey}` : '',
    mode: clean(env.MOLLIE_MODE) || detectMollieMode(effectiveApiKey),
    publicBaseUrl: clean(env.MOLLIE_PUBLIC_BASE_URL),
    webhookUrl: clean(env.MOLLIE_WEBHOOK_URL),
    allowPaymentCreate: clean(env.MOLLIE_ALLOW_PAYMENT_CREATE).toLowerCase() === 'true',
    missing,
  };
}

function buildMolliePublicConfig(env = process.env) {
  const config = resolveMollieConfig(env);
  return {
    configured: config.configured,
    apiBaseUrl: config.apiBaseUrl,
    apiKeyConfigured: config.apiKeyConfigured,
    apiKeySource: config.apiKeySource,
    mode: config.mode,
    publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
    webhookUrlConfigured: Boolean(config.webhookUrl),
    allowPaymentCreate: config.allowPaymentCreate,
    missing: config.missing,
  };
}

function buildMollieHeaders(config) {
  if (!clean(config?.authHeader)) {
    const error = new Error('mollie_credentials_missing');
    error.code = 'mollie_credentials_missing';
    error.missing = config?.missing || ['MOLLIE_API_KEY'];
    throw error;
  }
  return {
    Authorization: config.authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function requestMollieJson({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000,
  method = 'GET',
  path = '/methods',
  query = {},
  body = undefined,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const config = resolveMollieConfig(env);
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const normalizedPath = `/${clean(path).replace(/^\/+/, '')}`;
  const url = appendQuery(`${baseUrl}${normalizedPath}`, query);
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const options = {
    method: clean(method).toUpperCase() || 'GET',
    headers: buildMollieHeaders(config),
    signal,
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetchImpl(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload?.detail || payload?.title || payload?.error || `mollie_http_${response.status}`);
    error.code = 'mollie_request_failed';
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

function embeddedList(payload, key) {
  const direct = payload?.[key];
  if (Array.isArray(direct)) return direct;
  const embedded = payload?._embedded?.[key];
  return Array.isArray(embedded) ? embedded : [];
}

function sanitizeMollieMethod(source = {}) {
  return {
    id: source.id || null,
    description: source.description || null,
    status: source.status || null,
    image: source.image?.svg || source.image?.size2x || null,
    minimumAmount: source.minimumAmount || null,
    maximumAmount: source.maximumAmount || null,
  };
}

function sanitizeMollieProfile(source = {}) {
  return {
    id: source.id || null,
    mode: source.mode || null,
    name: source.name || null,
    website: source.website || null,
    email: source.email || null,
    phone: source.phone || null,
    categoryCode: source.categoryCode || null,
    status: source.status || null,
    review: source.review || null,
    createdAt: source.createdAt || null,
  };
}

function sanitizeMolliePayment(source = {}) {
  return {
    id: source.id || null,
    mode: source.mode || null,
    status: source.status || null,
    isCancelable: source.isCancelable ?? null,
    amount: source.amount || null,
    amountRefunded: source.amountRefunded || null,
    amountRemaining: source.amountRemaining || null,
    description: source.description || null,
    method: source.method || null,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : undefined,
    createdAt: source.createdAt || null,
    paidAt: source.paidAt || null,
    canceledAt: source.canceledAt || null,
    expiresAt: source.expiresAt || null,
    checkoutUrl: source._links?.checkout?.href || null,
    selfUrl: source._links?.self?.href || null,
    dashboardUrl: source._links?.dashboard?.href || null,
  };
}

async function fetchMollieMethods(options = {}) {
  const result = await requestMollieJson({
    ...options,
    path: '/methods',
    query: {
      resource: options.query?.resource || 'payments',
      locale: options.query?.locale,
      include: options.query?.include,
    },
  });
  return {
    ok: true,
    status: result.status,
    methods: embeddedList(result.payload, 'methods').map(sanitizeMollieMethod),
  };
}

async function fetchMollieProfiles(options = {}) {
  const result = await requestMollieJson({
    ...options,
    path: '/profiles',
    query: {
      limit: clampInt(options.query?.limit, 20, 1, 100),
      from: options.query?.from,
    },
  });
  return {
    ok: true,
    status: result.status,
    profiles: embeddedList(result.payload, 'profiles').map(sanitizeMollieProfile),
  };
}

async function fetchMolliePayments(options = {}) {
  const result = await requestMollieJson({
    ...options,
    path: '/payments',
    query: {
      limit: clampInt(options.query?.limit, 20, 1, 100),
      from: options.query?.from,
      profileId: options.query?.profileId || options.query?.profile_id,
    },
  });
  return {
    ok: true,
    status: result.status,
    payments: embeddedList(result.payload, 'payments').map(sanitizeMolliePayment),
  };
}

async function fetchMolliePayment(options = {}) {
  const id = clean(options.id || options.paymentId || options.payment_id);
  if (!id) {
    const error = new Error('mollie_payment_id_required');
    error.code = 'mollie_payment_id_required';
    throw error;
  }
  const result = await requestMollieJson({
    ...options,
    path: `/payments/${encodeURIComponent(id)}`,
  });
  return {
    ok: true,
    status: result.status,
    payment: sanitizeMolliePayment(result.payload),
  };
}

async function safeProbe(label, fn) {
  try {
    const result = await fn();
    return { label, ok: true, ...result };
  } catch (error) {
    return {
      label,
      ok: false,
      status: error.status || null,
      error: error.code || error.message,
      title: error.payload?.title || null,
      detail: error.payload?.detail || null,
    };
  }
}

async function fetchMollieSummary(options = {}) {
  const [methodsProbe, profilesProbe, paymentsProbe] = await Promise.all([
    safeProbe('methods', async () => fetchMollieMethods(options)),
    safeProbe('profiles', async () => fetchMollieProfiles({
      ...options,
      query: {
        ...(options.query || {}),
        limit: options.query?.profilesLimit || options.query?.limit || 10,
      },
    })),
    safeProbe('payments', async () => fetchMolliePayments({
      ...options,
      query: {
        ...(options.query || {}),
        limit: options.query?.paymentsLimit || options.query?.limit || 10,
      },
    })),
  ]);

  return {
    ok: true,
    config: buildMolliePublicConfig(options.env),
    methods: methodsProbe.ok ? methodsProbe.methods : [],
    profiles: profilesProbe.ok ? profilesProbe.profiles : [],
    recentPayments: paymentsProbe.ok ? paymentsProbe.payments : [],
    probes: {
      methods: {
        ok: methodsProbe.ok,
        status: methodsProbe.status || null,
        count: methodsProbe.methods?.length || 0,
        error: methodsProbe.error || null,
        detail: methodsProbe.detail || null,
      },
      profiles: {
        ok: profilesProbe.ok,
        status: profilesProbe.status || null,
        count: profilesProbe.profiles?.length || 0,
        error: profilesProbe.error || null,
        detail: profilesProbe.detail || null,
      },
      payments: {
        ok: paymentsProbe.ok,
        status: paymentsProbe.status || null,
        count: paymentsProbe.payments?.length || 0,
        error: paymentsProbe.error || null,
        detail: paymentsProbe.detail || null,
      },
    },
  };
}

function normalizeAmount(value) {
  if (typeof value === 'object' && value !== null) {
    return {
      currency: clean(value.currency || 'EUR').toUpperCase(),
      value: clean(value.value),
    };
  }
  const parsed = Number.parseFloat(String(value || '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return {
    currency: 'EUR',
    value: parsed.toFixed(2),
  };
}

async function createMolliePayment(options = {}) {
  const amount = normalizeAmount(options.amount);
  const currency = clean(options.currency).toUpperCase();
  if (amount && currency) amount.currency = currency;
  const description = clean(options.description).slice(0, 255);
  const redirectUrl = clean(options.redirectUrl || options.redirect_url);
  const webhookUrl = clean(options.webhookUrl || options.webhook_url);
  if (!amount?.value || !amount.currency) {
    const error = new Error('mollie_amount_required');
    error.code = 'mollie_amount_required';
    throw error;
  }
  if (!description) {
    const error = new Error('mollie_description_required');
    error.code = 'mollie_description_required';
    throw error;
  }
  if (!redirectUrl) {
    const error = new Error('mollie_redirect_url_required');
    error.code = 'mollie_redirect_url_required';
    throw error;
  }

  const body = {
    amount,
    description,
    redirectUrl,
  };
  if (webhookUrl) body.webhookUrl = webhookUrl;
  if (options.metadata && typeof options.metadata === 'object') {
    body.metadata = options.metadata;
  }

  const result = await requestMollieJson({
    env: options.env,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    method: 'POST',
    path: '/payments',
    body,
  });

  return {
    ok: true,
    status: result.status,
    payment: sanitizeMolliePayment(result.payload),
  };
}

function buildMollieWebhookInput(input = {}) {
  return {
    id: clean(input.id || input.paymentId || input.payment_id),
  };
}

module.exports = {
  DEFAULT_MOLLIE_API_BASE_URL,
  buildMollieHeaders,
  buildMolliePublicConfig,
  buildMollieWebhookInput,
  createMolliePayment,
  detectMollieMode,
  fetchMollieMethods,
  fetchMolliePayment,
  fetchMolliePayments,
  fetchMollieProfiles,
  fetchMollieSummary,
  requestMollieJson,
  resolveMollieConfig,
  sanitizeMollieMethod,
  sanitizeMolliePayment,
  sanitizeMollieProfile,
};

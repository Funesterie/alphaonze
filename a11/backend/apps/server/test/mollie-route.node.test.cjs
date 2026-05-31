const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createMollieRouter } = require('../routes/mollie.cjs');

async function withServer({
  env,
  fetchImpl,
  hasFinanceAccess = () => true,
  verifyJWT = (req, _res, next) => {
    req.user = { id: 'admin', email: 'jeffrey@example.test', fullAccess: true };
    next();
  },
  db = null,
}, runAssertions) {
  const app = express();
  app.use(express.json());
  app.use('/api/mollie', createMollieRouter({
    env,
    fetchImpl,
    hasFinanceAccess,
    verifyJWT,
    db,
  }));
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
    if (String(url).includes('/methods')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { methods: [{ id: 'ideal', status: 'activated' }] } }),
      };
    }
    if (String(url).includes('/profiles')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { profiles: [{ id: 'pfl_123', name: 'Funesterie' }] } }),
      };
    }
    if (String(url).includes('/payments/tr_123')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'tr_123',
          status: 'paid',
          amount: { currency: 'EUR', value: '9.99' },
        }),
      };
    }
    if (String(url).includes('/payments')) {
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'tr_123',
            status: 'open',
            amount: { currency: 'EUR', value: '9.99' },
            _links: { checkout: { href: 'https://www.mollie.com/checkout/test' } },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { payments: [{ id: 'tr_123', status: 'paid' }] } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  };
}

test('mollie config is admin-only and never exposes the API key', async () => {
  await withServer({
    env: { MOLLIE_API_KEY: 'live_super-secret-key' },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mollie/config`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.configured, true);
    assert.equal(payload.apiKeyConfigured, true);
    assert.equal(payload.mode, 'live');
    assert.equal(JSON.stringify(payload).includes('super-secret-key'), false);
  });
});

test('mollie methods, profiles and payment endpoints return sanitized data', async () => {
  const requests = [];
  await withServer({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    fetchImpl: createFetchMock(requests),
  }, async (baseUrl) => {
    const methods = await (await fetch(`${baseUrl}/api/mollie/methods`)).json();
    const profiles = await (await fetch(`${baseUrl}/api/mollie/profiles`)).json();
    const payments = await (await fetch(`${baseUrl}/api/mollie/payments`)).json();
    const payment = await (await fetch(`${baseUrl}/api/mollie/payments/tr_123`)).json();

    assert.equal(methods.methods[0].id, 'ideal');
    assert.equal(profiles.profiles[0].name, 'Funesterie');
    assert.equal(payments.payments[0].id, 'tr_123');
    assert.equal(payment.payment.status, 'paid');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test_secret-key');
  });
});

test('mollie payment creation is disabled unless explicitly enabled', async () => {
  await withServer({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    fetchImpl: createFetchMock([]),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mollie/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: '9.99',
        description: 'Funesterie test',
        redirectUrl: 'https://funesterie.me/payments/return',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'mollie_payment_create_disabled');
  });
});

test('mollie summary returns counts even when profile probe is unavailable', async () => {
  await withServer({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    fetchImpl: async (url, options) => {
      if (String(url).includes('/profiles')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            title: 'Forbidden',
            detail: 'Profile-scoped key cannot list profiles.',
          }),
        };
      }
      return createFetchMock([])(url, options);
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mollie/summary`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.probes.methods.ok, true);
    assert.equal(payload.probes.payments.ok, true);
    assert.equal(payload.probes.profiles.ok, false);
  });
});

test('mollie payment creation sends a checkout request when enabled', async () => {
  const requests = [];
  await withServer({
    env: {
      MOLLIE_API_KEY: 'test_secret-key',
      MOLLIE_ALLOW_PAYMENT_CREATE: 'true',
      MOLLIE_WEBHOOK_URL: 'https://funesterie.me/api/mollie/webhook',
    },
    fetchImpl: createFetchMock(requests),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mollie/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: '9.99',
        description: 'Funesterie test',
        redirectUrl: 'https://funesterie.me/payments/return',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.payment.checkoutUrl, 'https://www.mollie.com/checkout/test');
    assert.equal(JSON.parse(requests[0].options.body).webhookUrl, 'https://funesterie.me/api/mollie/webhook');
  });
});

test('mollie webhook is public and verifies event by fetching the payment', async () => {
  const writes = [];
  await withServer({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    fetchImpl: createFetchMock([]),
    verifyJWT: (_req, _res, next) => next(),
    db: {
      collection: () => ({
        insertOne: async (doc) => writes.push(doc),
      }),
    },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mollie/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'id=tr_123',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.received, true);
    assert.equal(payload.payment.id, 'tr_123');
    assert.equal(writes[0].paymentId, 'tr_123');
  });
});

test('mollie route denies non finance users', async () => {
  await withServer({
    env: {},
    hasFinanceAccess: () => false,
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/mollie/config`);
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error, 'mollie_admin_required');
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildMolliePublicConfig,
  createMolliePayment,
  detectMollieMode,
  fetchMollieMethods,
  fetchMolliePayment,
  fetchMollieProfiles,
  fetchMollieSummary,
  resolveMollieConfig,
} = require('../lib/mollie-client.cjs');

test('mollie config reads API key from file without exposing it publicly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mollie-test-'));
  const secretPath = path.join(dir, 'secret.txt');
  fs.writeFileSync(secretPath, 'live_super-secret-key\n', 'utf8');

  const env = { MOLLIE_API_KEY_FILE: secretPath };
  const privateConfig = resolveMollieConfig(env);
  assert.equal(privateConfig.configured, true);
  assert.equal(privateConfig.authHeader, 'Bearer live_super-secret-key');
  assert.equal(privateConfig.mode, 'live');

  const publicConfig = buildMolliePublicConfig(env);
  assert.equal(publicConfig.configured, true);
  assert.equal(publicConfig.apiKeyConfigured, true);
  assert.equal(publicConfig.apiKeySource, 'MOLLIE_API_KEY_FILE');
  assert.equal(JSON.stringify(publicConfig).includes('super-secret-key'), false);
});

test('mollie mode is inferred from API key prefix', () => {
  assert.equal(detectMollieMode('live_abc'), 'live');
  assert.equal(detectMollieMode('test_abc'), 'test');
  assert.equal(detectMollieMode('abc'), 'unknown');
});

test('mollie methods and profiles use bearer authentication and sanitize payloads', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/methods')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: {
            methods: [{
              id: 'creditcard',
              description: 'Credit card',
              status: 'activated',
              image: { svg: 'https://example.test/card.svg' },
            }],
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          profiles: [{
            id: 'pfl_123',
            mode: 'live',
            name: 'Funesterie',
            status: 'verified',
          }],
        },
      }),
    };
  };

  const env = { MOLLIE_API_KEY: 'test_secret-key' };
  const methods = await fetchMollieMethods({ env, fetchImpl });
  const profiles = await fetchMollieProfiles({ env, fetchImpl });

  assert.equal(methods.methods[0].id, 'creditcard');
  assert.equal(profiles.profiles[0].name, 'Funesterie');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test_secret-key');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test_secret-key');
});

test('mollie payment create normalizes amount and exposes only safe fields', async () => {
  const requests = [];
  const payment = await createMolliePayment({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'tr_123',
          mode: 'test',
          status: 'open',
          amount: { currency: 'EUR', value: '12.34' },
          description: 'Test Funesterie',
          _links: {
            checkout: { href: 'https://www.mollie.com/checkout/test' },
            dashboard: { href: 'https://my.mollie.com/dashboard' },
          },
        }),
      };
    },
    amount: '12,34',
    description: 'Test Funesterie',
    redirectUrl: 'https://funesterie.me/payments/return',
    webhookUrl: 'https://funesterie.me/api/mollie/webhook',
  });

  const body = JSON.parse(requests[0].options.body);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(body.amount.value, '12.34');
  assert.equal(body.amount.currency, 'EUR');
  assert.equal(payment.payment.checkoutUrl, 'https://www.mollie.com/checkout/test');
  assert.equal(payment.payment.id, 'tr_123');
});

test('mollie payment fetch requires an id and sanitizes payment payload', async () => {
  await assert.rejects(() => fetchMolliePayment({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  }), /mollie_payment_id_required/);

  const result = await fetchMolliePayment({
    env: { MOLLIE_API_KEY: 'test_secret-key' },
    id: 'tr_123',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'tr_123',
        status: 'paid',
        amount: { currency: 'EUR', value: '5.00' },
        sequenceType: 'oneoff',
      }),
    }),
  });

  assert.equal(result.payment.status, 'paid');
  assert.equal(result.payment.sequenceType, undefined);
});

test('mollie summary tolerates profile-scoped keys that cannot list profiles', async () => {
  const summary = await fetchMollieSummary({
    env: { MOLLIE_API_KEY: 'live_profile-key' },
    fetchImpl: async (url) => {
      if (String(url).includes('/profiles')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            title: 'Forbidden',
            detail: 'This API endpoint is only available with an access token not restricted to a specific profile.',
          }),
        };
      }
      if (String(url).includes('/methods')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { methods: [{ id: 'ideal' }] } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { payments: [] } }),
      };
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.methods.length, 1);
  assert.equal(summary.probes.profiles.ok, false);
  assert.equal(summary.probes.profiles.status, 403);
});

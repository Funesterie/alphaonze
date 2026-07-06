const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const createSubscriptionRouter = require('../routes/subscription.cjs');
const stripeService = require('../lib/stripe-service.cjs');

async function withServer(registerRoutes, runAssertions) {
  const app = express();
  app.use(express.json());
  registerRoutes(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await runAssertions(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function snapshotStripeContributionMethods() {
  return {
    getAvailableContributions: stripeService.getAvailableContributions,
    normalizeContribution: stripeService.normalizeContribution,
    isContributionEnabled: stripeService.isContributionEnabled,
    createContributionSession: stripeService.createContributionSession,
  };
}

function restoreStripeContributionMethods(snapshot) {
  Object.assign(stripeService, snapshot);
}

async function getJson(baseUrl, path) {
  const response = await fetch(baseUrl + path);
  return { response, json: await response.json() };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, json: await response.json() };
}

test('GET /api/subscription/contributions exposes configured contribution options', async () => {
  const snapshot = snapshotStripeContributionMethods();
  try {
    stripeService.getAvailableContributions = () => ([{
      id: 'royalties',
      kind: 'contribution',
      label: 'Royalties — Soutien Funesterie',
      enabled: true,
      payWhatYouWant: true,
      minEur: 2,
    }]);

    await withServer((app) => {
      app.use('/api/subscription', createSubscriptionRouter({ verifyJWT: (_req, _res, next) => next(), db: null }));
    }, async (baseUrl) => {
      const { response, json } = await getJson(baseUrl, '/api/subscription/contributions');
      assert.equal(response.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.contributions[0].id, 'royalties');
      assert.equal(json.contributions[0].enabled, true);
    });
  } finally {
    restoreStripeContributionMethods(snapshot);
  }
});

test('POST /api/subscription/create-contribution refuses disabled royalties', async () => {
  const snapshot = snapshotStripeContributionMethods();
  try {
    stripeService.normalizeContribution = () => 'royalties';
    stripeService.isContributionEnabled = () => false;
    stripeService.createContributionSession = async () => {
      throw new Error('should_not_create_session');
    };

    await withServer((app) => {
      app.use('/api/subscription', createSubscriptionRouter({ verifyJWT: (_req, _res, next) => next(), db: null }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/subscription/create-contribution', { contribution: 'royalties' });
      assert.equal(response.status, 503);
      assert.equal(json.error, 'Contribution non configurée');
    });
  } finally {
    restoreStripeContributionMethods(snapshot);
  }
});

test('POST /api/subscription/create-contribution creates a one-time checkout session when enabled', async () => {
  const snapshot = snapshotStripeContributionMethods();
  const calls = [];
  try {
    stripeService.normalizeContribution = (value) => String(value || 'royalties').toLowerCase();
    stripeService.isContributionEnabled = (id) => id === 'royalties';
    stripeService.createContributionSession = async (userId, userEmail, options) => {
      calls.push({ userId, userEmail, options });
      return { sessionId: 'cs_test_royalties', url: 'https://checkout.stripe.test/royalties', contribution: options.contribution };
    };

    await withServer((app) => {
      app.use('/api/subscription', createSubscriptionRouter({ verifyJWT: (_req, _res, next) => next(), db: null }));
    }, async (baseUrl) => {
      const { response, json } = await postJson(baseUrl, '/api/subscription/create-contribution', { contribution: 'royalties' });
      assert.equal(response.status, 200);
      assert.deepEqual(json, {
        ok: true,
        sessionId: 'cs_test_royalties',
        url: 'https://checkout.stripe.test/royalties',
        contribution: 'royalties',
      });
      assert.deepEqual(calls, [{ userId: '', userEmail: '', options: { contribution: 'royalties' } }]);
    });
  } finally {
    restoreStripeContributionMethods(snapshot);
  }
});

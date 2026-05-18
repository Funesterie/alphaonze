const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createPaypalRouter } = require('../routes/paypal.cjs');

async function withServer(runAssertions) {
  const app = express();
  app.use(express.json());
  app.use('/api/paypal', createPaypalRouter());
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

test('paypal config exposes public business receiver and webhook status', async () => {
  const previous = {
    PAYPAL_ENV: process.env.PAYPAL_ENV,
    PAYPAL_RECEIVER_EMAIL: process.env.PAYPAL_RECEIVER_EMAIL,
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID,
    PAYPAL_WEBHOOK_URL: process.env.PAYPAL_WEBHOOK_URL,
  };

  process.env.PAYPAL_ENV = 'sandbox';
  process.env.PAYPAL_RECEIVER_EMAIL = 'cellaurojeffrey@hotmail.com';
  process.env.PAYPAL_CLIENT_ID = 'client';
  process.env.PAYPAL_CLIENT_SECRET = 'secret';
  process.env.PAYPAL_WEBHOOK_ID = 'webhook';
  process.env.PAYPAL_WEBHOOK_URL = 'https://a11.funesterie.me/api/paypal/webhook';

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/paypal/config`);
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.configured, true);
      assert.equal(payload.receiverEmail, 'cellaurojeffrey@hotmail.com');
      assert.equal(payload.webhookUrl, 'https://a11.funesterie.me/api/paypal/webhook');
      assert.equal(payload.mode, 'sandbox');
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

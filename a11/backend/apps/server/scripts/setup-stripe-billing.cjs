'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SERVER_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILES = [
  path.join(SERVER_ROOT, 'profiles', 'a11.env'),
  path.join(SERVER_ROOT, '.env.local'),
  path.join(SERVER_ROOT, '.env'),
];

const PLANS = [
  {
    envKey: 'STRIPE_PREMIUM_PRICE_ID',
    fallbackEnvKey: 'STRIPE_PRICE_ID',
    lookupKey: 'a11_premium_monthly_899',
    productName: 'A11 Premium',
    unitAmount: 899,
    currency: 'eur',
  },
  {
    envKey: 'STRIPE_FOUNDER_PRICE_ID',
    lookupKey: 'a11_founder_monthly_2999',
    productName: 'A11 Fondateur',
    unitAmount: 2999,
    currency: 'eur',
  },
];

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
];

function loadEnvFiles() {
  for (const file of DEFAULT_ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    dotenv.config({ path: file, override: false, quiet: true });
  }
}

function parseArgs(argv) {
  const args = {
    writeEnv: '',
    webhookUrl: '',
    rotateWebhook: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write-env') {
      args.writeEnv = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--webhook-url') {
      args.webhookUrl = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--rotate-webhook') {
      args.rotateWebhook = true;
    }
  }
  return args;
}

function upsertEnvFile(file, values) {
  if (!file) return false;
  const target = path.resolve(file);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  const keys = new Set(Object.keys(values));
  const used = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !keys.has(match[1])) return line;
    used.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!used.has(key)) nextLines.push(`${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, nextLines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
  return true;
}

async function ensureProduct(stripe, name) {
  const products = await stripe.products.search({
    query: `name:'${name.replace(/'/g, "\\'")}' AND active:'true'`,
    limit: 1,
  });
  if (products.data[0]) return products.data[0];
  return stripe.products.create({ name });
}

async function ensureMonthlyPrice(stripe, plan) {
  const existing = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0];

  const product = await ensureProduct(stripe, plan.productName);
  return stripe.prices.create({
    product: product.id,
    unit_amount: plan.unitAmount,
    currency: plan.currency,
    recurring: { interval: 'month' },
    lookup_key: plan.lookupKey,
    metadata: {
      plan: plan.lookupKey.includes('founder') ? 'founder' : 'premium',
    },
  });
}

async function ensureWebhook(stripe, webhookUrl, rotateWebhook) {
  if (!webhookUrl) return null;

  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const matching = existing.data.filter((endpoint) => endpoint.url === webhookUrl && endpoint.status === 'enabled');
  if (matching[0] && process.env.STRIPE_WEBHOOK_SECRET && !rotateWebhook) {
    await stripe.webhookEndpoints.update(matching[0].id, {
      enabled_events: WEBHOOK_EVENTS,
    });
    return { endpoint: matching[0], secret: null, reused: true };
  }

  if (rotateWebhook) {
    for (const endpoint of matching) {
      await stripe.webhookEndpoints.update(endpoint.id, { disabled: true });
    }
  }

  const created = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: WEBHOOK_EVENTS,
    description: 'A11 subscription automation',
  });
  return { endpoint: created, secret: created.secret || null, reused: false };
}

function maskId(value) {
  const raw = String(value || '');
  if (raw.length < 12) return raw ? `${raw.slice(0, 3)}...` : '';
  return `${raw.slice(0, 10)}...${raw.slice(-4)}`;
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));
  const Stripe = require('stripe');
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY manquante');
  }

  const stripe = new Stripe(apiKey, {
    apiVersion: process.env.STRIPE_API_VERSION || '2026-02-25.clover',
  });

  const updates = {};
  const planResults = [];
  for (const plan of PLANS) {
    const price = await ensureMonthlyPrice(stripe, plan);
    updates[plan.envKey] = price.id;
    if (plan.fallbackEnvKey && !process.env[plan.fallbackEnvKey]) {
      updates[plan.fallbackEnvKey] = price.id;
    }
    planResults.push({
      envKey: plan.envKey,
      lookupKey: plan.lookupKey,
      priceId: maskId(price.id),
    });
  }

  const webhookUrl = String(
    args.webhookUrl
      || process.env.STRIPE_WEBHOOK_URL
      || `${String(process.env.A11_PUBLIC_BASE_URL || 'https://a11.funesterie.me').replace(/\/+$/, '')}/api/subscription/webhook`
  ).trim();
  const webhook = await ensureWebhook(stripe, webhookUrl, args.rotateWebhook);
  if (webhook?.secret) {
    updates.STRIPE_WEBHOOK_SECRET = webhook.secret;
  }

  const wroteEnv = args.writeEnv ? upsertEnvFile(args.writeEnv, updates) : false;

  console.log(JSON.stringify({
    ok: true,
    plans: planResults,
    webhook: webhook
      ? {
          url: webhookUrl,
          endpointId: maskId(webhook.endpoint?.id),
          reused: webhook.reused,
          secretWritten: Boolean(webhook.secret && wroteEnv),
        }
      : null,
    envWritten: wroteEnv ? path.resolve(args.writeEnv) : null,
  }, null, 2));
}

main().catch((error) => {
  const safeMessage = /api key|secret|token/i.test(String(error?.message || ''))
    ? 'Erreur Stripe liee aux identifiants API'
    : error.message;
  console.error(`[stripe:setup:billing] ${safeMessage}`);
  process.exitCode = 1;
});

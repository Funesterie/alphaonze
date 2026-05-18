'use strict';

const express = require('express');

const PAYPAL_LIVE_API_BASE = 'https://api-m.paypal.com';
const PAYPAL_SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com';

function getPayPalApiBase(env = process.env) {
  const mode = String(env.PAYPAL_ENV || env.PAYPAL_MODE || 'live').trim().toLowerCase();
  return mode === 'sandbox' ? PAYPAL_SANDBOX_API_BASE : PAYPAL_LIVE_API_BASE;
}

function hasPayPalWebhookConfig(env = process.env) {
  return Boolean(
    String(env.PAYPAL_CLIENT_ID || '').trim()
    && String(env.PAYPAL_CLIENT_SECRET || '').trim()
    && String(env.PAYPAL_WEBHOOK_ID || '').trim()
  );
}

function getPayPalTransmissionHeaders(req) {
  return {
    auth_algo: String(req.headers['paypal-auth-algo'] || '').trim(),
    cert_url: String(req.headers['paypal-cert-url'] || '').trim(),
    transmission_id: String(req.headers['paypal-transmission-id'] || '').trim(),
    transmission_sig: String(req.headers['paypal-transmission-sig'] || '').trim(),
    transmission_time: String(req.headers['paypal-transmission-time'] || '').trim(),
  };
}

function hasRequiredTransmissionHeaders(headers) {
  return Boolean(
    headers.auth_algo
    && headers.cert_url
    && headers.transmission_id
    && headers.transmission_sig
    && headers.transmission_time
  );
}

async function getPayPalAccessToken(env = process.env, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }

  const clientId = String(env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('paypal_credentials_missing');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl(`${getPayPalApiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `paypal_oauth_failed:${response.status}`);
  }

  return String(payload.access_token);
}

async function verifyPayPalWebhookSignature(req, webhookEvent, env = process.env, fetchImpl = globalThis.fetch) {
  if (!hasPayPalWebhookConfig(env)) {
    return { ok: false, configured: false, status: 'CONFIG_MISSING' };
  }

  const transmission = getPayPalTransmissionHeaders(req);
  if (!hasRequiredTransmissionHeaders(transmission)) {
    return { ok: false, configured: true, status: 'HEADERS_MISSING' };
  }

  const accessToken = await getPayPalAccessToken(env, fetchImpl);
  const response = await fetchImpl(`${getPayPalApiBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...transmission,
      webhook_id: String(env.PAYPAL_WEBHOOK_ID || '').trim(),
      webhook_event: webhookEvent,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const status = String(payload?.verification_status || '').trim().toUpperCase();
  return {
    ok: response.ok && status === 'SUCCESS',
    configured: true,
    status: status || `HTTP_${response.status}`,
  };
}

function summarizePayPalEvent(event) {
  const resource = event?.resource || {};
  return {
    id: event?.id || null,
    eventType: event?.event_type || null,
    createTime: event?.create_time || null,
    resourceType: event?.resource_type || null,
    resourceId: resource?.id || resource?.supplementary_data?.related_ids?.order_id || null,
    status: resource?.status || resource?.state || null,
    amount: resource?.amount || resource?.seller_receivable_breakdown?.gross_amount || null,
    customId: resource?.custom_id || resource?.invoice_id || resource?.purchase_units?.[0]?.custom_id || null,
    payerEmail: resource?.payer?.email_address || resource?.payer_info?.email || null,
  };
}

function getRequestOrigin(req) {
  const configured = String(
    process.env.PAYPAL_PUBLIC_BASE_URL
      || process.env.A11_PUBLIC_BASE_URL
      || process.env.PUBLIC_API_URL
      || ''
  ).trim().replace(/\/+$/, '');
  if (configured) return configured;

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
  return host ? `${proto}://${host}` : 'https://a11.funesterie.me';
}

function createPaypalRouter({ db = null, fetchImpl = globalThis.fetch } = {}) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    const origin = getRequestOrigin(req);
    res.json({
      ok: true,
      configured: hasPayPalWebhookConfig(process.env),
      receiverEmail: String(process.env.PAYPAL_RECEIVER_EMAIL || '').trim() || null,
      webhookUrl: String(process.env.PAYPAL_WEBHOOK_URL || `${origin}/api/paypal/webhook`).trim(),
      mode: String(process.env.PAYPAL_ENV || process.env.PAYPAL_MODE || 'live').trim().toLowerCase(),
    });
  });

  router.post('/webhook', async (req, res) => {
    try {
      const event = req.body && typeof req.body === 'object' ? req.body : {};
      const summary = summarizePayPalEvent(event);
      const verification = await verifyPayPalWebhookSignature(req, event, process.env, fetchImpl);

      if (!verification.configured) {
        console.warn('[PayPal] Webhook received but PayPal env is not configured:', summary);
        return res.status(503).json({
          ok: false,
          error: 'paypal_webhook_not_configured',
          message: 'PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET et PAYPAL_WEBHOOK_ID sont requis.',
        });
      }

      if (!verification.ok) {
        console.warn('[PayPal] Invalid webhook signature:', verification.status, summary);
        return res.status(400).json({
          ok: false,
          error: 'paypal_webhook_signature_invalid',
          status: verification.status,
        });
      }

      console.log('[PayPal] Verified webhook:', summary);

      if (db && summary.eventType && summary.id) {
        try {
          await db.query(
            `CREATE TABLE IF NOT EXISTS paypal_webhook_events (
              id TEXT PRIMARY KEY,
              event_type TEXT,
              resource_id TEXT,
              status TEXT,
              payload JSONB,
              received_at TIMESTAMPTZ DEFAULT NOW()
            )`
          );
          await db.query(
            `INSERT INTO paypal_webhook_events (id, event_type, resource_id, status, payload)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [summary.id, summary.eventType, summary.resourceId, summary.status, event]
          );
        } catch (dbError) {
          console.warn('[PayPal] Failed to persist webhook event:', dbError?.message || dbError);
        }
      }

      return res.json({
        ok: true,
        received: true,
        event: summary,
      });
    } catch (error) {
      console.error('[PayPal] Webhook error:', error);
      return res.status(500).json({
        ok: false,
        error: 'paypal_webhook_failed',
      });
    }
  });

  return router;
}

module.exports = {
  createPaypalRouter,
  verifyPayPalWebhookSignature,
  summarizePayPalEvent,
};

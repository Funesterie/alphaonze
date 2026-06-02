'use strict';

const express = require('express');
const stripeService = require('../lib/stripe-service.cjs');
const { hasFullAccess, isFullAccessEmail } = require('../src/auth/full-access.cjs');

function planLabel(planId) {
  const plan = stripeService.resolvePlanConfig(planId);
  return plan?.label || 'A11 Premium';
}

function buildFounderPayment() {
  const phone = String(
    process.env.A11_FOUNDER_PAYMENT_PHONE
      || process.env.FOUNDER_PAYMENT_PHONE
      || process.env.A11_WERO_PHONE
      || process.env.VITE_A11_WERO_PHONE
      || ''
  ).trim();
  const ribUrl = String(
    process.env.A11_RIB_URL
      || process.env.RIB_DOCUMENT_URL
      || process.env.VITE_A11_RIB_URL
      || ''
  ).trim();
  return {
    available: Boolean(phone || ribUrl),
    phone: phone || null,
    ribUrl: ribUrl || null,
  };
}

function buildFullAccessStatus(reason = 'allowlist') {
  return {
    ok: true,
    active: true,
    fullAccess: true,
    tier: 'admin_family',
    plan: 'Admin famille',
    reason,
    endDate: null,
    stripeStatus: null,
    founderPayment: buildFounderPayment(),
    availablePlans: stripeService.getAvailablePlans(),
  };
}

function getCheckoutPlan(req) {
  return stripeService.normalizeCheckoutPlan(req.body?.plan || req.body?.tier || req.query?.plan);
}

function timestampToDate(value) {
  if (!value) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getSubscriptionPriceId(subscription) {
  return String(subscription?.items?.data?.[0]?.price?.id || '').trim() || null;
}

async function markFullAccessUser(db, userId) {
  await db.query(
    `UPDATE users
      SET subscription_active = true,
          subscription_end_date = NULL,
          account_tier = 'admin_family',
          subscription_plan = 'admin_family',
          updated_at = NOW()
      WHERE id = $1`,
    [userId]
  );
}

async function applySubscriptionByUserId(db, userId, input) {
  if (!db || !userId) return;
  const plan = stripeService.normalizeCheckoutPlan(input.plan);
  await db.query(
    `UPDATE users
      SET stripe_customer_id = COALESCE($1, stripe_customer_id),
          stripe_subscription_id = COALESCE($2, stripe_subscription_id),
          stripe_price_id = COALESCE($3, stripe_price_id),
          subscription_active = $4,
          subscription_end_date = $5,
          subscription_plan = $6,
          account_tier = $7,
          updated_at = NOW()
      WHERE id = $8`,
    [
      input.customerId || null,
      input.subscriptionId || null,
      input.priceId || null,
      Boolean(input.active),
      input.endDate || null,
      plan,
      plan,
      userId,
    ]
  );
}

async function applySubscriptionByCustomerId(db, customerId, input) {
  if (!db || !customerId) return;
  const plan = stripeService.normalizeCheckoutPlan(input.plan);
  await db.query(
    `UPDATE users
      SET stripe_subscription_id = COALESCE($1, stripe_subscription_id),
          stripe_price_id = COALESCE($2, stripe_price_id),
          subscription_active = $3,
          subscription_end_date = $4,
          subscription_plan = $5,
          account_tier = $6,
          updated_at = NOW()
      WHERE stripe_customer_id = $7`,
    [
      input.subscriptionId || null,
      input.priceId || null,
      Boolean(input.active),
      input.endDate || null,
      plan,
      plan,
      customerId,
    ]
  );
}

function createSubscriptionRouter({ verifyJWT, db }) {
  const router = express.Router();

  router.post('/create-checkout', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;
      const requestedPlan = getCheckoutPlan(req);

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      if (hasFullAccess(req.user)) {
        return res.json(buildFullAccessStatus('token'));
      }

      if (!db) {
        return res.status(503).json({ error: 'Base de donnees non disponible' });
      }

      if (!stripeService.isStripeEnabled(requestedPlan)) {
        return res.status(503).json({ error: `Paiement ${requestedPlan} non configure` });
      }

      const userResult = await db.query(
        'SELECT email FROM users WHERE id = $1',
        [userId]
      );

      if (!userResult.rows[0]?.email) {
        return res.status(404).json({ error: 'Email utilisateur non trouve' });
      }

      const userEmail = userResult.rows[0].email;
      if (isFullAccessEmail(userEmail)) {
        await markFullAccessUser(db, userId);
        return res.json(buildFullAccessStatus('allowlist'));
      }

      const session = await stripeService.createCheckoutSession(userId, userEmail, { plan: requestedPlan });

      return res.json({
        ok: true,
        sessionId: session.sessionId,
        url: session.url,
        plan: session.plan,
      });
    } catch (error) {
      console.error('[Subscription] Checkout creation error:', error);
      return res.status(500).json({ error: 'Erreur lors de la creation de la session' });
    }
  });

  router.post('/create-portal', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Base de donnees non disponible' });
      }

      if (!stripeService.isStripeEnabled('premium')) {
        return res.status(503).json({ error: 'Service de paiement non disponible' });
      }

      const userResult = await db.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );

      if (!userResult.rows[0]?.stripe_customer_id) {
        return res.status(404).json({ error: 'Aucun abonnement trouve' });
      }

      const session = await stripeService.createCustomerPortalSession(
        userResult.rows[0].stripe_customer_id
      );

      return res.json({
        ok: true,
        url: session.url,
      });
    } catch (error) {
      console.error('[Subscription] Portal creation error:', error);
      return res.status(500).json({ error: 'Erreur lors de la creation du portail' });
    }
  });

  router.get('/status', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      if (!db) {
        const fullAccess = hasFullAccess(req.user);
        return res.json(fullAccess
          ? buildFullAccessStatus('token')
          : {
              ok: true,
              active: false,
              fullAccess: false,
              tier: 'basic',
              plan: null,
              reason: 'local_no_database',
              endDate: null,
              stripeStatus: null,
              availablePlans: stripeService.getAvailablePlans(),
            });
      }

      const userResult = await db.query(
        `SELECT email, stripe_customer_id, subscription_active, subscription_end_date,
                account_tier, subscription_plan, stripe_subscription_id, stripe_price_id
          FROM users WHERE id = $1`,
        [userId]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouve' });
      }

      const fullAccess = isFullAccessEmail(user.email) || hasFullAccess(req.user);
      if (fullAccess) {
        if (!user.subscription_active || user.account_tier !== 'admin_family') {
          await markFullAccessUser(db, userId);
        }
        return res.json(buildFullAccessStatus('allowlist'));
      }

      let stripeStatus = null;
      if (user.stripe_customer_id && stripeService.isStripeEnabled(user.subscription_plan || 'premium')) {
        stripeStatus = await stripeService.getSubscriptionStatus(user.stripe_customer_id);
      }

      const tier = stripeService.normalizeCheckoutPlan(
        user.account_tier || user.subscription_plan || stripeStatus?.plan || 'basic'
      );
      const active = Boolean(user.subscription_active || stripeStatus?.active);
      const currentPlan = active ? planLabel(tier) : null;

      return res.json({
        ok: true,
        active,
        fullAccess: false,
        tier: active ? tier : 'basic',
        plan: currentPlan,
        reason: active ? 'subscription' : 'inactive',
        endDate: user.subscription_end_date,
        stripeStatus,
        founderPayment: active && tier === 'founder' ? buildFounderPayment() : null,
        availablePlans: stripeService.getAvailablePlans(),
      });
    } catch (error) {
      console.error('[Subscription] Status error:', error);
      return res.status(500).json({ error: 'Erreur lors de la recuperation du statut' });
    }
  });

  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Stripe] STRIPE_WEBHOOK_SECRET non configure');
      return res.status(500).send('Webhook secret non configure');
    }

    if (!db) {
      return res.status(503).send('Database unavailable');
    }

    let event;

    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const webhookBody = Buffer.isBuffer(req.body) || typeof req.body === 'string'
        ? req.body
        : req.rawBody;
      event = stripe.webhooks.constructEvent(webhookBody, sig, webhookSecret);
    } catch (error) {
      console.error('[Stripe] Webhook validation error:', error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const userId = session.metadata?.userId || session.client_reference_id;
          const customerId = session.customer || null;
          const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id || null;
          const plan = stripeService.inferSubscriptionPlan(session, 'premium');

          await applySubscriptionByUserId(db, userId, {
            customerId,
            subscriptionId,
            plan,
            active: true,
          });
          console.log(`[Stripe] Subscription activated for user ${userId} (${plan})`);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customerId = subscription.customer;
          const isActive = subscription.status === 'active' || subscription.status === 'trialing';
          const endDate = timestampToDate(subscription.current_period_end);
          const plan = stripeService.inferSubscriptionPlan(subscription, 'premium');

          await applySubscriptionByCustomerId(db, customerId, {
            subscriptionId: subscription.id,
            priceId: getSubscriptionPriceId(subscription),
            active: isActive,
            endDate,
            plan,
          });
          console.log(`[Stripe] Subscription updated for customer ${customerId}: ${subscription.status} (${plan})`);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customerId = subscription.customer;
          const endDate = timestampToDate(subscription.current_period_end);
          const plan = stripeService.inferSubscriptionPlan(subscription, 'premium');

          await applySubscriptionByCustomerId(db, customerId, {
            subscriptionId: subscription.id,
            priceId: getSubscriptionPriceId(subscription),
            active: false,
            endDate,
            plan,
          });
          console.log(`[Stripe] Subscription cancelled for customer ${customerId}`);
          break;
        }

        default:
          console.log(`[Stripe] Unhandled event: ${event.type}`);
      }

      return res.json({ received: true });
    } catch (error) {
      console.error('[Stripe] Webhook processing error:', error);
      return res.status(500).json({ error: 'Erreur traitement webhook' });
    }
  });

  return router;
}

module.exports = createSubscriptionRouter;

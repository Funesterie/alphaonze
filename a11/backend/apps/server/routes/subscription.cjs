'use strict';

const express = require('express');
const stripeService = require('../lib/stripe-service.cjs');
const { hasFullAccess, isFullAccessEmail } = require('../src/auth/full-access.cjs');

function buildFullAccessStatus(reason = 'allowlist') {
  return {
    ok: true,
    active: true,
    fullAccess: true,
    plan: 'A11 Studio Full Access',
    reason,
    endDate: null,
    stripeStatus: null,
  };
}

function createSubscriptionRouter({ verifyJWT, db }) {
  const router = express.Router();

  router.post('/create-checkout', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      if (hasFullAccess(req.user)) {
        return res.json(buildFullAccessStatus('token'));
      }

      if (!db) {
        return res.status(503).json({ error: 'Base de donnees non disponible' });
      }

      if (!stripeService.isStripeEnabled()) {
        return res.status(503).json({ error: 'Service de paiement non disponible' });
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
        await db.query(
          'UPDATE users SET subscription_active=true, subscription_end_date=NULL, updated_at=NOW() WHERE id=$1',
          [userId]
        );
        return res.json(buildFullAccessStatus('allowlist'));
      }

      const session = await stripeService.createCheckoutSession(userId, userEmail);

      return res.json({
        ok: true,
        sessionId: session.sessionId,
        url: session.url,
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

      if (!stripeService.isStripeEnabled()) {
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
              plan: null,
              reason: 'local_no_database',
              endDate: null,
              stripeStatus: null,
            });
      }

      const userResult = await db.query(
        'SELECT email, stripe_customer_id, subscription_active, subscription_end_date FROM users WHERE id = $1',
        [userId]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouve' });
      }

      const fullAccess = isFullAccessEmail(user.email) || hasFullAccess(req.user);
      if (fullAccess) {
        if (!user.subscription_active) {
          await db.query(
            'UPDATE users SET subscription_active=true, subscription_end_date=NULL, updated_at=NOW() WHERE id=$1',
            [userId]
          );
        }
        return res.json(buildFullAccessStatus('allowlist'));
      }

      let stripeStatus = null;
      if (user.stripe_customer_id && stripeService.isStripeEnabled()) {
        stripeStatus = await stripeService.getSubscriptionStatus(user.stripe_customer_id);
      }

      return res.json({
        ok: true,
        active: user.subscription_active || false,
        fullAccess: false,
        plan: user.subscription_active ? 'A11 Studio' : null,
        reason: user.subscription_active ? 'subscription' : 'inactive',
        endDate: user.subscription_end_date,
        stripeStatus,
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
          const customerId = session.customer;

          if (userId && customerId) {
            await db.query(
              'UPDATE users SET stripe_customer_id = $1, subscription_active = true WHERE id = $2',
              [customerId, userId]
            );
            console.log(`[Stripe] Subscription activated for user ${userId}`);
          }
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object;
          const customerId = subscription.customer;
          const isActive = subscription.status === 'active';
          const endDate = new Date(subscription.current_period_end * 1000);

          await db.query(
            'UPDATE users SET subscription_active = $1, subscription_end_date = $2 WHERE stripe_customer_id = $3',
            [isActive, endDate, customerId]
          );
          console.log(`[Stripe] Subscription updated for customer ${customerId}: ${subscription.status}`);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          await db.query(
            'UPDATE users SET subscription_active = false WHERE stripe_customer_id = $1',
            [customerId]
          );
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

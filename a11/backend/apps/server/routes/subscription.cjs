'use strict';

/**
 * Routes pour la gestion des abonnements Stripe
 */

const express = require('express');
const stripeService = require('../lib/stripe-service.cjs');

function createSubscriptionRouter({ verifyJWT, db }) {
  const router = express.Router();

  /**
   * POST /api/subscription/create-checkout
   * Crée une session de checkout Stripe
   */
  router.post('/create-checkout', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      if (!stripeService.isStripeEnabled()) {
        return res.status(503).json({ error: 'Service de paiement non disponible' });
      }

      // Récupérer l'email depuis la DB
      const userResult = await db.query(
        'SELECT email FROM users WHERE id = $1',
        [userId]
      );

      if (!userResult.rows[0]?.email) {
        return res.status(404).json({ error: 'Email utilisateur non trouvé' });
      }

      const userEmail = userResult.rows[0].email;
      const session = await stripeService.createCheckoutSession(userId, userEmail);

      res.json({
        ok: true,
        sessionId: session.sessionId,
        url: session.url,
      });
    } catch (error) {
      console.error('[Subscription] Erreur création checkout:', error);
      res.status(500).json({ error: 'Erreur lors de la création de la session' });
    }
  });

  /**
   * POST /api/subscription/create-portal
   * Crée une session du portail client Stripe
   */
  router.post('/create-portal', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      if (!stripeService.isStripeEnabled()) {
        return res.status(503).json({ error: 'Service de paiement non disponible' });
      }

      // Récupérer le customerId depuis la DB
      const userResult = await db.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );

      if (!userResult.rows[0]?.stripe_customer_id) {
        return res.status(404).json({ error: 'Aucun abonnement trouvé' });
      }

      const session = await stripeService.createCustomerPortalSession(
        userResult.rows[0].stripe_customer_id
      );

      res.json({
        ok: true,
        url: session.url,
      });
    } catch (error) {
      console.error('[Subscription] Erreur création portail:', error);
      res.status(500).json({ error: 'Erreur lors de la création du portail' });
    }
  });

  /**
   * GET /api/subscription/status
   * Récupère le statut d'abonnement de l'utilisateur
   */
  router.get('/status', verifyJWT, async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
      }

      // Récupérer le customerId et subscription_active depuis la DB
      const userResult = await db.query(
        'SELECT stripe_customer_id, subscription_active, subscription_end_date FROM users WHERE id = $1',
        [userId]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      let stripeStatus = null;
      if (user.stripe_customer_id && stripeService.isStripeEnabled()) {
        stripeStatus = await stripeService.getSubscriptionStatus(user.stripe_customer_id);
      }

      res.json({
        ok: true,
        active: user.subscription_active || false,
        endDate: user.subscription_end_date,
        stripeStatus,
      });
    } catch (error) {
      console.error('[Subscription] Erreur récupération statut:', error);
      res.status(500).json({ error: 'Erreur lors de la récupération du statut' });
    }
  });

  /**
   * POST /api/subscription/webhook
   * Webhook Stripe pour gérer les événements d'abonnement
   */
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Stripe] STRIPE_WEBHOOK_SECRET non configuré');
      return res.status(500).send('Webhook secret non configuré');
    }

    let event;

    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (error) {
      console.error('[Stripe] Erreur validation webhook:', error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    // Gérer les événements Stripe
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
            console.log(`[Stripe] Abonnement activé pour user ${userId}`);
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
          console.log(`[Stripe] Abonnement mis à jour pour customer ${customerId}: ${subscription.status}`);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          const customerId = subscription.customer;

          await db.query(
            'UPDATE users SET subscription_active = false WHERE stripe_customer_id = $1',
            [customerId]
          );
          console.log(`[Stripe] Abonnement annulé pour customer ${customerId}`);
          break;
        }

        default:
          console.log(`[Stripe] Événement non géré: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('[Stripe] Erreur traitement webhook:', error);
      res.status(500).json({ error: 'Erreur traitement webhook' });
    }
  });

  return router;
}

module.exports = createSubscriptionRouter;

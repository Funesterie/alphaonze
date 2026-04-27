'use strict';

/**
 * Service Stripe pour gérer les abonnements A11
 * Forfait : 2,99€/mois, annulable à tout moment
 */

let stripe = null;

try {
  const Stripe = require('stripe');
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (apiKey) {
    stripe = new Stripe(apiKey, {
      apiVersion: '2024-11-20.acacia',
    });
  }
} catch (error) {
  console.warn('[Stripe] Module non disponible ou clé manquante');
}

const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_default'; // À configurer dans Stripe Dashboard
const SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'https://funesterie.pro/subscription/success';
const CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'https://funesterie.pro/subscription/cancel';

/**
 * Crée une session de checkout Stripe pour l'abonnement
 * @param {string} userId - ID de l'utilisateur
 * @param {string} userEmail - Email de l'utilisateur
 * @returns {Promise<{sessionId: string, url: string}>}
 */
async function createCheckoutSession(userId, userEmail) {
  if (!stripe) {
    throw new Error('Stripe non configuré');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: CANCEL_URL,
    client_reference_id: userId,
    customer_email: userEmail,
    metadata: {
      userId,
    },
    subscription_data: {
      metadata: {
        userId,
      },
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
  };
}

/**
 * Crée un portail client Stripe pour gérer l'abonnement
 * @param {string} customerId - ID client Stripe
 * @returns {Promise<{url: string}>}
 */
async function createCustomerPortalSession(customerId) {
  if (!stripe) {
    throw new Error('Stripe non configuré');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: process.env.STRIPE_PORTAL_RETURN_URL || 'https://funesterie.pro/account',
  });

  return {
    url: session.url,
  };
}

/**
 * Récupère les informations d'abonnement d'un utilisateur
 * @param {string} customerId - ID client Stripe
 * @returns {Promise<{active: boolean, status: string, currentPeriodEnd: number}>}
 */
async function getSubscriptionStatus(customerId) {
  if (!stripe) {
    return { active: false, status: 'no_stripe', currentPeriodEnd: null };
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return { active: false, status: 'no_subscription', currentPeriodEnd: null };
    }

    const sub = subscriptions.data[0];
    return {
      active: sub.status === 'active',
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  } catch (error) {
    console.error('[Stripe] Erreur lors de la récupération du statut:', error);
    return { active: false, status: 'error', currentPeriodEnd: null };
  }
}

/**
 * Annule un abonnement à la fin de la période en cours
 * @param {string} subscriptionId - ID de l'abonnement Stripe
 * @returns {Promise<{success: boolean, cancelAt: number}>}
 */
async function cancelSubscription(subscriptionId) {
  if (!stripe) {
    throw new Error('Stripe non configuré');
  }

  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  return {
    success: true,
    cancelAt: subscription.current_period_end,
  };
}

/**
 * Vérifie si Stripe est configuré
 * @returns {boolean}
 */
function isStripeEnabled() {
  return stripe !== null;
}

module.exports = {
  createCheckoutSession,
  createCustomerPortalSession,
  getSubscriptionStatus,
  cancelSubscription,
  isStripeEnabled,
};

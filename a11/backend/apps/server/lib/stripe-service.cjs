'use strict';

/**
 * Service Stripe pour gérer les abonnements A11
 * Forfait public : A11 Studio leger, chat long + credits de creation.
 * Les credits bonus sont attribues apres score de pertinence des apports utilisateur.
 */

let stripe = null;

try {
  const Stripe = require('stripe');
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (apiKey) {
    stripe = new Stripe(apiKey, {
      apiVersion: process.env.STRIPE_API_VERSION || '2026-02-25.clover',
    });
  }
} catch (error) {
  console.warn('[Stripe] Module non disponible ou clé manquante');
}

const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_default'; // À configurer dans Stripe Dashboard
const DEFAULT_PUBLIC_BASE_URL = String(
  process.env.A11_PUBLIC_BASE_URL
    || process.env.PUBLIC_APP_URL
    || process.env.FRONTEND_URL
    || 'https://a11.funesterie.me'
).trim().replace(/\/+$/, '');
const ACTIVE_PRICE_ID = String(process.env.STRIPE_PRICE_ID || '').trim();
const SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || `${DEFAULT_PUBLIC_BASE_URL}/subscription/success`;
const CANCEL_URL = process.env.STRIPE_CANCEL_URL || `${DEFAULT_PUBLIC_BASE_URL}/subscription/cancel`;

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

  if (!ACTIVE_PRICE_ID) {
    throw new Error('Stripe price non configure');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    // Let Stripe Checkout select every enabled method for the customer
    // (cards, wallets, SEPA/Link/etc.) from the Stripe Dashboard.
    line_items: [
      {
        price: ACTIVE_PRICE_ID,
        quantity: 1,
      },
    ],
    billing_address_collection: 'auto',
    allow_promotion_codes: true,
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
    return_url: process.env.STRIPE_PORTAL_RETURN_URL || `${DEFAULT_PUBLIC_BASE_URL}/account`,
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
  return stripe !== null && Boolean(ACTIVE_PRICE_ID);
}

module.exports = {
  createCheckoutSession,
  createCustomerPortalSession,
  getSubscriptionStatus,
  cancelSubscription,
  isStripeEnabled,
};

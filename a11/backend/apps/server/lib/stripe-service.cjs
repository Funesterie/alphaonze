'use strict';

/**
 * Service Stripe pour gerer les abonnements A11.
 * Plans publics :
 * - Premium : 8,99 EUR / trimestre
 * - Fondateur : 29,99 EUR / trimestre
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
  console.warn('[Stripe] Module non disponible ou cle manquante');
}

const DEFAULT_PUBLIC_BASE_URL = String(
  process.env.A11_PUBLIC_BASE_URL
    || process.env.PUBLIC_APP_URL
    || process.env.FRONTEND_URL
    || 'https://a11.funesterie.me'
).trim().replace(/\/+$/, '');

const SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || `${DEFAULT_PUBLIC_BASE_URL}/subscription/success`;
const CANCEL_URL = process.env.STRIPE_CANCEL_URL || `${DEFAULT_PUBLIC_BASE_URL}/subscription/cancel`;

const SUBSCRIPTION_PLANS = Object.freeze({
  premium: Object.freeze({
    id: 'premium',
    accountTier: 'premium',
    label: 'A11 Premium',
    monthlyEur: 8.99,
    priceCentsEur: 899,
    billingPeriod: 'quarterly',
    intervalLabel: 'trimestre',
    features: Object.freeze([
      'Chat long et credits creation inclus',
      'Catalogue voix consenties pour preview et chanson',
      'Routage media avance',
    ]),
    priceEnv: 'STRIPE_PREMIUM_PRICE_ID',
    fallbackPriceEnv: 'STRIPE_PRICE_ID',
    lookupSlug: 'a11_premium_monthly_899',
  }),
  founder: Object.freeze({
    id: 'founder',
    accountTier: 'founder',
    label: 'A11 Fondateur',
    monthlyEur: 29.99,
    priceCentsEur: 2999,
    billingPeriod: 'quarterly',
    intervalLabel: 'trimestre',
    features: Object.freeze([
      'Priorite haute',
      'Catalogue voix consenties pour preview et chanson',
      'IA custom future: avatar, description, prompt et providers personnels',
      'Acces avance MCP, Neo4j et Docker avec garde-fous',
    ]),
    priceEnv: 'STRIPE_FOUNDER_PRICE_ID',
    lookupSlug: 'a11_founder_monthly_2999',
  }),
});

function normalizeCheckoutPlan(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (
    raw === 'founder'
    || raw === 'fondateur'
    || raw === 'founder_2999'
    || raw === 'fondateur_2999'
    || raw === 'a11_founder'
    || raw === 'a11_fondateur'
  ) {
    return 'founder';
  }
  return 'premium';
}

function getPlanPriceId(planId) {
  const plan = SUBSCRIPTION_PLANS[normalizeCheckoutPlan(planId)] || SUBSCRIPTION_PLANS.premium;
  return String(
    process.env[plan.priceEnv]
      || (plan.fallbackPriceEnv ? process.env[plan.fallbackPriceEnv] : '')
      || ''
  ).trim();
}

function resolvePlanConfig(value) {
  const planId = normalizeCheckoutPlan(value);
  const plan = SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS.premium;
  return {
    ...plan,
    priceId: getPlanPriceId(planId),
  };
}

function getConfiguredPriceIds() {
  return Object.fromEntries(
    Object.keys(SUBSCRIPTION_PLANS).map((planId) => [planId, getPlanPriceId(planId)])
  );
}

function inferSubscriptionPlan(input, fallback = 'premium') {
  const metadataPlan = input?.metadata?.plan
    || input?.metadata?.accountTier
    || input?.plan
    || input?.accountTier;
  const normalizedMetadataPlan = normalizeCheckoutPlan(metadataPlan);
  if (metadataPlan && normalizedMetadataPlan) {
    return normalizedMetadataPlan;
  }

  const price = input?.items?.data?.[0]?.price || input?.price || input;
  const priceId = String(price?.id || input?.priceId || '').trim();
  const lookupKey = String(price?.lookup_key || price?.lookupKey || '').trim().toLowerCase();

  const configured = getConfiguredPriceIds();
  if ((configured.founder && priceId === configured.founder) || lookupKey === SUBSCRIPTION_PLANS.founder.lookupSlug) {
    return 'founder';
  }
  if ((configured.premium && priceId === configured.premium) || lookupKey === SUBSCRIPTION_PLANS.premium.lookupSlug) {
    return 'premium';
  }
  if (lookupKey.includes('founder') || lookupKey.includes('fondateur') || lookupKey.includes('2999')) {
    return 'founder';
  }
  if (lookupKey.includes('premium') || lookupKey.includes('899')) {
    return 'premium';
  }
  return normalizeCheckoutPlan(fallback);
}

/**
 * Cree une session de checkout Stripe pour l'abonnement.
 * @param {string} userId
 * @param {string} userEmail
 * @param {{ plan?: string }} options
 * @returns {Promise<{sessionId: string, url: string, plan: string}>}
 */
async function createCheckoutSession(userId, userEmail, options = {}) {
  if (!stripe) {
    throw new Error('Stripe non configuré');
  }

  const plan = resolvePlanConfig(options.plan);
  if (!plan.priceId) {
    throw new Error(`Stripe price non configuré pour ${plan.id}`);
  }

  const metadata = {
    userId,
    plan: plan.id,
    accountTier: plan.accountTier,
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      {
        price: plan.priceId,
        quantity: 1,
      },
    ],
    billing_address_collection: 'auto',
    allow_promotion_codes: true,
    success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: CANCEL_URL,
    client_reference_id: userId,
    customer_email: userEmail,
    metadata,
    subscription_data: {
      metadata,
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
    plan: plan.id,
  };
}

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

async function getSubscriptionStatus(customerId) {
  if (!stripe) {
    return { active: false, status: 'no_stripe', currentPeriodEnd: null, plan: null };
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price'],
    });

    const sub = subscriptions.data.find((candidate) => (
      candidate.status === 'active'
      || candidate.status === 'trialing'
      || candidate.status === 'past_due'
    )) || subscriptions.data[0];

    if (!sub) {
      return { active: false, status: 'no_subscription', currentPeriodEnd: null, plan: null };
    }

    const plan = inferSubscriptionPlan(sub, 'premium');
    return {
      active: sub.status === 'active' || sub.status === 'trialing',
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      plan,
    };
  } catch (error) {
    console.error('[Stripe] Erreur lors de la récupération du statut:', error);
    return { active: false, status: 'error', currentPeriodEnd: null, plan: null };
  }
}

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

function isStripeEnabled(plan = 'premium') {
  return stripe !== null && Boolean(resolvePlanConfig(plan).priceId);
}

function getAvailablePlans() {
  return Object.values(SUBSCRIPTION_PLANS).map((plan) => ({
    id: plan.id,
    accountTier: plan.accountTier,
    label: plan.label,
    monthlyEur: plan.monthlyEur,
    priceCentsEur: plan.priceCentsEur,
    features: Array.isArray(plan.features) ? [...plan.features] : [],
  }));
}

// ─── One-time contributions (royalties / support) ───────────────────────────
// Distinct from subscriptions: a pay-what-you-want one-time payment so anyone can
// "participer à l'évolution de la Funesterie". Uses a Stripe custom_unit_amount price.
const CONTRIBUTIONS = Object.freeze({
  royalties: Object.freeze({
    id: 'royalties',
    kind: 'contribution',
    label: 'Royalties — Soutien Funesterie',
    description: "Contribution libre pour participer à l'évolution de la Funesterie.",
    mode: 'payment',
    priceEnv: 'STRIPE_ROYALTIES_PRICE_ID',
    payWhatYouWant: true,
    minEur: 2,
    presetEur: 10,
  }),
});

function normalizeContribution(value) {
  const raw = String(value || '').trim().toLowerCase();
  return CONTRIBUTIONS[raw] ? raw : 'royalties';
}

function getContributionPriceId(id = 'royalties') {
  const contribution = CONTRIBUTIONS[normalizeContribution(id)];
  return String(process.env[contribution.priceEnv] || '').trim();
}

function isContributionEnabled(id = 'royalties') {
  return stripe !== null && Boolean(getContributionPriceId(id));
}

/**
 * Create a one-time contribution ("royalties") checkout session. Pay-what-you-want:
 * the amount is entered by the supporter via the custom_unit_amount price.
 */
async function createContributionSession(userId, userEmail, options = {}) {
  if (!stripe) {
    throw new Error('Stripe non configuré');
  }
  const id = normalizeContribution(options.contribution || options.plan);
  const contribution = CONTRIBUTIONS[id];
  const priceId = getContributionPriceId(id);
  if (!priceId) {
    throw new Error(`Stripe price non configuré pour ${contribution.id}`);
  }
  const metadata = {
    userId: userId || '',
    contribution: contribution.id,
    kind: 'contribution',
  };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    submit_type: 'donate',
    billing_address_collection: 'auto',
    success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}&contribution=${contribution.id}`,
    cancel_url: CANCEL_URL,
    ...(userId ? { client_reference_id: userId } : {}),
    ...(userEmail ? { customer_email: userEmail } : {}),
    metadata,
    payment_intent_data: { metadata },
  });
  return { sessionId: session.id, url: session.url, contribution: contribution.id };
}

function getAvailableContributions() {
  return Object.values(CONTRIBUTIONS).map((contribution) => ({
    id: contribution.id,
    kind: contribution.kind,
    label: contribution.label,
    description: contribution.description,
    payWhatYouWant: contribution.payWhatYouWant,
    minEur: contribution.minEur,
    presetEur: contribution.presetEur,
    enabled: isContributionEnabled(contribution.id),
  }));
}

module.exports = {
  SUBSCRIPTION_PLANS,
  createCheckoutSession,
  createCustomerPortalSession,
  getSubscriptionStatus,
  cancelSubscription,
  isStripeEnabled,
  normalizeCheckoutPlan,
  resolvePlanConfig,
  inferSubscriptionPlan,
  getAvailablePlans,
  getConfiguredPriceIds,
  CONTRIBUTIONS,
  normalizeContribution,
  getContributionPriceId,
  isContributionEnabled,
  createContributionSession,
  getAvailableContributions,
};

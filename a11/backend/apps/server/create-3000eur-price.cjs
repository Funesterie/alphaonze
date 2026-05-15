#!/usr/bin/env node
'use strict';

/**
 * Legacy filename kept for compatibility.
 * Creates the current A11 Studio Stripe price: 149 EUR/month.
 * Usage: node create-3000eur-price.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createEnterprisePrice() {
  console.log('Creating A11 Studio price at 149 EUR/month...\n');

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured in .env.local');
    }

    const product = await stripe.products.create({
      name: 'A11 Studio',
      description: 'A11 creation plan with monthly creation tokens and contribution rewards.',
      metadata: {
        tier: 'studio',
        included_creation_tokens: '2500',
        created_by: 'create-3000eur-price.cjs',
        supersedes: '3000-eur-legacy-price',
      },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 14900,
      currency: 'eur',
      recurring: {
        interval: 'month',
      },
      metadata: {
        tier: 'studio',
        included_creation_tokens: '2500',
        created_by: 'create-3000eur-price.cjs',
      },
    });

    console.log('Product created:', product.id);
    console.log('Price created:', price.id);
    console.log('Amount:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('\nSet this value locally and in Render:');
    console.log(`STRIPE_PRICE_ID=${price.id}`);
    console.log('\nCommit message suggestion:');
    console.log('feat: update A11 Studio Stripe price');

    return { product, price };
  } catch (error) {
    console.error('Stripe price creation failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createEnterprisePrice()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { createEnterprisePrice };

#!/usr/bin/env node
'use strict';

/**
 * Creates the current A11 Blueprint deployment Stripe price: 120,000 EUR one-time.
 * Usage: node create-blueprint-onetime.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createBlueprintOneTimePrice() {
  console.log('Creating A11 Blueprint deployment price at 120,000 EUR one-time...\n');

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured in .env.local');
    }

    const product = await stripe.products.create({
      name: 'A11 Blueprint - Deployment Package',
      description: [
        'Qualified A11 deployment package:',
        'source, deployment, runbook, infrastructure alignment, onboarding, and limited transfer support.',
      ].join(' '),
      metadata: {
        type: 'blueprint',
        tier: 'deployment_package',
        payment_type: 'one_time',
        contact_policy: 'qualified_email_then_phone',
        created_by: 'create-blueprint-onetime.cjs',
        supersedes: '3000-eur-legacy-blueprint',
      },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 12000000,
      currency: 'eur',
      metadata: {
        type: 'blueprint',
        tier: 'deployment_package',
        payment_type: 'one_time',
        created_by: 'create-blueprint-onetime.cjs',
      },
    });

    console.log('Product created:', product.id);
    console.log('Price created:', price.id);
    console.log('Amount:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('\nSave these values:');
    console.log(`STRIPE_BLUEPRINT_DEPLOYMENT_PRODUCT_ID=${product.id}`);
    console.log(`STRIPE_BLUEPRINT_DEPLOYMENT_PRICE_ID=${price.id}`);
    console.log('\nPublic contact: contact@funesterie.me');
    console.log('Phone contact is shared only after qualification.');

    return { product, price };
  } catch (error) {
    console.error('Blueprint deployment price creation failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createBlueprintOneTimePrice()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { createBlueprintOneTimePrice };

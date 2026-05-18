#!/usr/bin/env node
'use strict';

/**
 * Legacy filename kept for compatibility.
 * Creates the current A11 Blueprint source-license Stripe price: 85,000 EUR one-time.
 * Usage: node create-blueprint-8000eur.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createBlueprint8000Price() {
  console.log('Creating A11 Blueprint source-license price at 85,000 EUR one-time...\n');

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured in .env.local');
    }

    const product = await stripe.products.create({
      name: 'A11 Blueprint - Source License',
      description: [
        'Qualified A11 source license:',
        'backend, frontend, infrastructure, memory, agent orchestration, image/video pipeline, runbook, onboarding, and transfer support.',
      ].join(' '),
      metadata: {
        type: 'blueprint',
        tier: 'source_license',
        payment_type: 'one_time',
        support_days: '90',
        updates_months: '12',
        contact_policy: 'qualified_email_then_phone',
        created_by: 'create-blueprint-8000eur.cjs',
        supersedes: '8000-eur-legacy-blueprint',
      },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 8500000,
      currency: 'eur',
      metadata: {
        type: 'blueprint',
        tier: 'source_license',
        payment_type: 'one_time',
        created_by: 'create-blueprint-8000eur.cjs',
      },
    });

    console.log('Product created:', product.id);
    console.log('Price created:', price.id);
    console.log('Amount:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('\nSave these values:');
    console.log(`STRIPE_BLUEPRINT_PRODUCT_ID=${product.id}`);
    console.log(`STRIPE_BLUEPRINT_PRICE_ID=${price.id}`);
    console.log('\nPublic contact: contact@funesterie.me');
    console.log('Phone contact is shared only after qualification.');

    return { product, price };
  } catch (error) {
    console.error('Blueprint price creation failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  createBlueprint8000Price()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { createBlueprint8000Price };

#!/usr/bin/env node
'use strict';

/**
 * Script pour créer un prix Stripe à 3000€/mois
 * Usage: node create-3000eur-price.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createEnterprisePrice() {
  console.log('🚀 Création du prix Enterprise à 3000€/mois...\n');

  try {
    // Vérifier que Stripe est configuré
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY non configuré dans .env.local');
    }

    // Créer le produit
    console.log('📦 Création du produit...');
    const product = await stripe.products.create({
      name: 'A11 Premium Enterprise',
      description: 'Accès complet à A11 avec support prioritaire et fonctionnalités avancées',
      metadata: {
        tier: 'enterprise',
        created_by: 'create-3000eur-price.cjs',
      },
    });

    console.log('✅ Produit créé:', product.id);
    console.log('   Nom:', product.name);
    console.log('   Description:', product.description);
    console.log('');

    // Créer le prix
    console.log('💰 Création du prix...');
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 300000, // 3000€ en centimes
      currency: 'eur',
      recurring: {
        interval: 'month',
      },
      metadata: {
        tier: 'enterprise',
        created_by: 'create-3000eur-price.cjs',
      },
    });

    console.log('✅ Prix créé:', price.id);
    console.log('   Montant:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('   Période:', price.recurring.interval);
    console.log('');

    // Instructions
    console.log('📋 PROCHAINES ÉTAPES :');
    console.log('');
    console.log('1. Copie cet ID dans ton .env.local :');
    console.log('');
    console.log(`   STRIPE_PRICE_ID=${price.id}`);
    console.log('');
    console.log('2. Mets à jour render.yaml :');
    console.log('');
    console.log('   - key: STRIPE_PRICE_ID');
    console.log(`     value: ${price.id}`);
    console.log('');
    console.log('3. Commit et push :');
    console.log('');
    console.log('   git add a11/backend/apps/server/render.yaml');
    console.log('   git add a11/backend/apps/server/.env.local');
    console.log('   git commit -m "feat: Update Stripe price to 3000 EUR"');
    console.log('   git push origin master');
    console.log('');
    console.log('4. Configure sur Render Dashboard :');
    console.log('');
    console.log(`   STRIPE_PRICE_ID=${price.id}`);
    console.log('');
    console.log('🎯 Voir le prix sur Stripe Dashboard :');
    console.log(`   https://dashboard.stripe.com/prices/${price.id}`);
    console.log('');

    return { product, price };
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    if (error.type === 'StripeAuthenticationError') {
      console.error('');
      console.error('💡 Vérifie que STRIPE_SECRET_KEY est correct dans .env.local');
      console.error('   Il doit commencer par sk_live_ ou sk_test_');
    }
    throw error;
  }
}

// Exécuter
if (require.main === module) {
  createEnterprisePrice()
    .then(() => {
      console.log('✅ Terminé avec succès !');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Échec:', error.message);
      process.exit(1);
    });
}

module.exports = { createEnterprisePrice };

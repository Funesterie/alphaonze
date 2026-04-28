#!/usr/bin/env node
'use strict';

/**
 * Test script pour vérifier l'intégration Stripe
 * Usage: node test-stripe-integration.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripeService = require('./lib/stripe-service.cjs');

async function testStripeIntegration() {
  console.log('🔍 Test de l\'intégration Stripe...\n');

  // 1. Vérifier que Stripe est activé
  console.log('1. Vérification de la configuration Stripe:');
  const isEnabled = stripeService.isStripeEnabled();
  console.log(`   ✓ Stripe activé: ${isEnabled ? 'OUI' : 'NON'}`);
  
  if (!isEnabled) {
    console.log('   ❌ STRIPE_SECRET_KEY manquante dans .env.local');
    process.exit(1);
  }

  // 2. Vérifier les variables d'environnement
  console.log('\n2. Variables d\'environnement:');
  console.log(`   ✓ STRIPE_SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? 'Configurée' : 'MANQUANTE'}`);
  console.log(`   ✓ STRIPE_PRICE_ID: ${process.env.STRIPE_PRICE_ID || 'MANQUANTE'}`);
  console.log(`   ✓ STRIPE_WEBHOOK_SECRET: ${process.env.STRIPE_WEBHOOK_SECRET ? 'Configurée' : 'MANQUANTE (optionnel pour les tests)'}`);
  console.log(`   ✓ STRIPE_SUCCESS_URL: ${process.env.STRIPE_SUCCESS_URL || 'Par défaut'}`);
  console.log(`   ✓ STRIPE_CANCEL_URL: ${process.env.STRIPE_CANCEL_URL || 'Par défaut'}`);

  // 3. Vérifier que le PRICE_ID est correct
  const priceId = process.env.STRIPE_PRICE_ID;
  if (priceId && !priceId.startsWith('price_')) {
    console.log(`\n   ⚠️  ATTENTION: STRIPE_PRICE_ID devrait commencer par "price_" et non "${priceId.split('_')[0]}_"`);
    console.log('   ℹ️  Vérifiez dans le Stripe Dashboard > Products > [Votre produit] > Pricing');
  }

  // 4. Test de création de session (simulation)
  console.log('\n3. Test de création de session Stripe:');
  try {
    const testUserId = 'test-user-123';
    const testEmail = 'test@example.com';
    
    console.log(`   → Création d'une session pour ${testEmail}...`);
    const session = await stripeService.createCheckoutSession(testUserId, testEmail);
    
    console.log(`   ✓ Session créée avec succès!`);
    console.log(`   ✓ Session ID: ${session.sessionId}`);
    console.log(`   ✓ URL de paiement: ${session.url}`);
    console.log('\n   ℹ️  Cette session est réelle et peut être utilisée pour tester le paiement.');
    console.log('   ℹ️  Utilisez une carte de test Stripe: 4242 4242 4242 4242');
  } catch (error) {
    console.log(`   ❌ Erreur lors de la création de session: ${error.message}`);
    if (error.message.includes('price')) {
      console.log('\n   💡 Solution: Vérifiez que STRIPE_PRICE_ID est correct dans .env.local');
      console.log('      1. Allez sur https://dashboard.stripe.com/products');
      console.log('      2. Sélectionnez votre produit');
      console.log('      3. Copiez le Price ID (commence par "price_")');
    }
    process.exit(1);
  }

  console.log('\n✅ Tous les tests sont passés!');
  console.log('\n📝 Prochaines étapes:');
  console.log('   1. Configurez STRIPE_WEBHOOK_SECRET pour la production');
  console.log('   2. Testez le flux complet dans le frontend');
  console.log('   3. Vérifiez que les webhooks fonctionnent correctement');
}

testStripeIntegration().catch((error) => {
  console.error('\n❌ Erreur fatale:', error);
  process.exit(1);
});

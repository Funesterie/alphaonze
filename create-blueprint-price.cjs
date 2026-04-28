#!/usr/bin/env node
'use strict';

/**
 * Script pour créer un prix Stripe pour le Blueprint à 3000€ (paiement unique)
 * Usage: node create-blueprint-price.cjs
 */

require('dotenv').config({ path: 'a11/backend/apps/server/.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createBlueprintPrice() {
  console.log('🚀 Création du produit Blueprint à 3000€ (paiement unique)...\n');

  try {
    // Vérifier que Stripe est configuré
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY non configuré dans .env.local');
    }

    // Créer le produit
    console.log('📦 Création du produit...');
    const product = await stripe.products.create({
      name: 'A11 Blueprint - Code Source Complet',
      description: 'Accès au code source complet d\'A11 avec documentation, déploiement et support 30 jours',
      metadata: {
        type: 'blueprint',
        tier: 'enterprise',
        created_by: 'create-blueprint-price.cjs',
      },
      images: ['https://alphaonze.funesterie.pro/og-image.png'], // Optionnel
    });

    console.log('✅ Produit créé:', product.id);
    console.log('   Nom:', product.name);
    console.log('   Description:', product.description);
    console.log('');

    // Créer le prix (paiement unique)
    console.log('💰 Création du prix...');
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 300000, // 3000€ en centimes
      currency: 'eur',
      // PAS de recurring - c'est un paiement unique
      metadata: {
        type: 'blueprint',
        tier: 'enterprise',
        created_by: 'create-blueprint-price.cjs',
      },
    });

    console.log('✅ Prix créé:', price.id);
    console.log('   Montant:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('   Type:', price.type); // 'one_time'
    console.log('');

    // Instructions
    console.log('📋 PROCHAINES ÉTAPES :');
    console.log('');
    console.log('1. Copie cet ID pour créer un lien de paiement :');
    console.log('');
    console.log(`   STRIPE_BLUEPRINT_PRICE_ID=${price.id}`);
    console.log('');
    console.log('2. Créer un lien de paiement Stripe :');
    console.log('');
    console.log('   a) Va sur : https://dashboard.stripe.com/payment-links/create');
    console.log(`   b) Sélectionne le produit : "${product.name}"`);
    console.log('   c) Configure :');
    console.log('      - Quantité : 1 (fixe)');
    console.log('      - Après paiement : Rediriger vers une page de succès');
    console.log('      - Collecter : Email, Nom, Adresse (optionnel)');
    console.log('   d) Copie le lien de paiement');
    console.log('');
    console.log('3. Ajouter le lien dans BLUEPRINT_PRICING.md :');
    console.log('');
    console.log('   [Acheter le Blueprint (3000€)](https://buy.stripe.com/xxx)');
    console.log('');
    console.log('4. Créer un webhook pour gérer l\'achat :');
    console.log('');
    console.log('   a) Dashboard Stripe → Webhooks → Add endpoint');
    console.log('   b) URL : https://a11-backend.onrender.com/api/blueprint/webhook');
    console.log('   c) Events : checkout.session.completed, payment_intent.succeeded');
    console.log('   d) Copie le signing secret');
    console.log('');
    console.log('5. Automatiser l\'envoi de l\'accès GitHub :');
    console.log('');
    console.log('   - Créer une route /api/blueprint/webhook');
    console.log('   - Détecter payment_intent.succeeded');
    console.log('   - Envoyer email avec invitation GitHub');
    console.log('   - Ajouter à la liste des acheteurs');
    console.log('');
    console.log('🎯 Voir le produit sur Stripe Dashboard :');
    console.log(`   https://dashboard.stripe.com/products/${product.id}`);
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
  createBlueprintPrice()
    .then(() => {
      console.log('✅ Terminé avec succès !');
      console.log('');
      console.log('💡 Prochaine étape : Créer le lien de paiement sur Stripe Dashboard');
      console.log('   https://dashboard.stripe.com/payment-links/create');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Échec:', error.message);
      process.exit(1);
    });
}

module.exports = { createBlueprintPrice };

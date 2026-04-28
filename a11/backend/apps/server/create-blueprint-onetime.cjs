#!/usr/bin/env node
'use strict';

/**
 * Script pour créer un prix Stripe pour le Blueprint à 3000€ (PAIEMENT UNIQUE)
 * Usage: node create-blueprint-onetime.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createBlueprintOneTimePrice() {
  console.log('🚀 Création du produit Blueprint à 3000€ (PAIEMENT UNIQUE)...\n');

  try {
    // Vérifier que Stripe est configuré
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY non configuré dans .env.local');
    }

    // Créer le produit
    console.log('📦 Création du produit...');
    const product = await stripe.products.create({
      name: 'A11 Blueprint - Code Source Complet',
      description: 'Accès au code source complet d\'A11 : backend, frontend, infrastructure, documentation complète, support 30 jours, mises à jour 6 mois, licence commerciale',
      metadata: {
        type: 'blueprint',
        tier: 'enterprise',
        payment_type: 'one_time',
        created_by: 'create-blueprint-onetime.cjs',
      },
    });

    console.log('✅ Produit créé:', product.id);
    console.log('   Nom:', product.name);
    console.log('   Description:', product.description);
    console.log('');

    // Créer le prix (PAIEMENT UNIQUE - pas de recurring)
    console.log('💰 Création du prix (paiement unique)...');
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 300000, // 3000€ en centimes
      currency: 'eur',
      // PAS de recurring = paiement unique
      metadata: {
        type: 'blueprint',
        tier: 'enterprise',
        payment_type: 'one_time',
        created_by: 'create-blueprint-onetime.cjs',
      },
    });

    console.log('✅ Prix créé:', price.id);
    console.log('   Montant:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('   Type:', price.type); // Devrait être 'one_time'
    console.log('   Récurrent:', price.recurring ? 'Oui' : 'Non'); // Devrait être 'Non'
    console.log('');

    // Instructions
    console.log('📋 PROCHAINES ÉTAPES :');
    console.log('');
    console.log('1. Créer un Payment Link sur Stripe Dashboard :');
    console.log('');
    console.log('   a) Va sur : https://dashboard.stripe.com/payment-links/create');
    console.log(`   b) Sélectionne le produit : "${product.name}"`);
    console.log(`   c) Prix : ${price.id}`);
    console.log('   d) Configure :');
    console.log('      - Quantité : 1 (fixe, non modifiable)');
    console.log('      - Après paiement : https://alphaonze.funesterie.pro/blueprint/success');
    console.log('      - Collecter : Email, Nom complet');
    console.log('      - Message personnalisé : "Merci ! Vous recevrez l\'accès GitHub sous 24h."');
    console.log('   e) Copie le lien de paiement (ex: https://buy.stripe.com/xxx)');
    console.log('');
    console.log('2. Mettre à jour BLUEPRINT_PRICING.md :');
    console.log('');
    console.log('   [Acheter le Blueprint (3000€)](https://buy.stripe.com/xxx)');
    console.log('');
    console.log('3. Créer un webhook pour automatiser l\'accès :');
    console.log('');
    console.log('   a) Dashboard Stripe → Webhooks → Add endpoint');
    console.log('   b) URL : https://a11-backend.onrender.com/api/blueprint/webhook');
    console.log('   c) Events à écouter :');
    console.log('      - checkout.session.completed');
    console.log('      - payment_intent.succeeded');
    console.log('   d) Copie le signing secret (whsec_...)');
    console.log('   e) Ajoute dans .env.local :');
    console.log('      STRIPE_BLUEPRINT_WEBHOOK_SECRET=whsec_...');
    console.log('');
    console.log('4. Implémenter la route webhook (TODO) :');
    console.log('');
    console.log('   - Créer /api/blueprint/webhook dans le backend');
    console.log('   - Détecter checkout.session.completed');
    console.log('   - Récupérer email client');
    console.log('   - Envoyer email avec invitation GitHub');
    console.log('   - Logger l\'achat dans la DB');
    console.log('');
    console.log('5. Tester le paiement :');
    console.log('');
    console.log('   - Utilise une carte de test Stripe');
    console.log('   - 4242 4242 4242 4242');
    console.log('   - Date future, CVC 123');
    console.log('   - Vérifie que le webhook est appelé');
    console.log('');
    console.log('🎯 Voir le produit sur Stripe Dashboard :');
    console.log(`   https://dashboard.stripe.com/products/${product.id}`);
    console.log('');
    console.log('🎯 Voir le prix sur Stripe Dashboard :');
    console.log(`   https://dashboard.stripe.com/prices/${price.id}`);
    console.log('');
    console.log('💾 Sauvegarde ces IDs :');
    console.log('');
    console.log(`   STRIPE_BLUEPRINT_PRODUCT_ID=${product.id}`);
    console.log(`   STRIPE_BLUEPRINT_PRICE_ID=${price.id}`);
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
  createBlueprintOneTimePrice()
    .then(() => {
      console.log('✅ Terminé avec succès !');
      console.log('');
      console.log('💡 Prochaine étape : Créer le Payment Link sur Stripe Dashboard');
      console.log('   https://dashboard.stripe.com/payment-links/create');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Échec:', error.message);
      process.exit(1);
    });
}

module.exports = { createBlueprintOneTimePrice };

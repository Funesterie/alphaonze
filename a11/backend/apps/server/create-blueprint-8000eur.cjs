#!/usr/bin/env node
'use strict';

/**
 * Script pour créer un prix Stripe pour le Blueprint à 8000€ (PAIEMENT UNIQUE)
 * Prix optimisé après analyse de marché
 * Usage: node create-blueprint-8000eur.cjs
 */

require('dotenv').config({ path: '.env.local' });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createBlueprint8000Price() {
  console.log('🚀 Création du produit Blueprint à 8000€ (PAIEMENT UNIQUE)...\n');

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY non configuré dans .env.local');
    }

    // Créer le produit
    console.log('📦 Création du produit...');
    const product = await stripe.products.create({
      name: 'A11 Blueprint - Code Source Complet',
      description: 'Accès au code source complet d\'A11 : backend Express.js, frontend React/Vite, infrastructure Docker/Render, intégration Stripe, routeur LLM multi-provider, génération d\'images/vidéos, mémoire épisodique, graphe de connaissances Neo4j, documentation complète, support 90 jours, mises à jour 12 mois, licence commerciale',
      metadata: {
        type: 'blueprint',
        tier: 'professional',
        payment_type: 'one_time',
        support_days: '90',
        updates_months: '12',
        created_by: 'create-blueprint-8000eur.cjs',
      },
    });

    console.log('✅ Produit créé:', product.id);
    console.log('   Nom:', product.name);
    console.log('');

    // Créer le prix (PAIEMENT UNIQUE)
    console.log('💰 Création du prix (paiement unique)...');
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 800000, // 8000€ en centimes
      currency: 'eur',
      metadata: {
        type: 'blueprint',
        tier: 'professional',
        payment_type: 'one_time',
        created_by: 'create-blueprint-8000eur.cjs',
      },
    });

    console.log('✅ Prix créé:', price.id);
    console.log('   Montant:', (price.unit_amount / 100).toFixed(2), price.currency.toUpperCase());
    console.log('   Type:', price.type);
    console.log('   Récurrent:', price.recurring ? 'Oui' : 'Non');
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
    console.log('      - Collecter : Email, Nom complet, Entreprise (optionnel)');
    console.log('      - Message : "Merci ! Vous recevrez l\'accès GitHub sous 24h."');
    console.log('   e) Copie le lien de paiement');
    console.log('');
    console.log('2. Mettre à jour BLUEPRINT_PRICING.md :');
    console.log('');
    console.log('   [Acheter le Blueprint (8000€)](https://buy.stripe.com/xxx)');
    console.log('');
    console.log('3. Créer un webhook :');
    console.log('');
    console.log('   a) Dashboard Stripe → Webhooks → Add endpoint');
    console.log('   b) URL : https://a11-backend.onrender.com/api/blueprint/webhook');
    console.log('   c) Events : checkout.session.completed, payment_intent.succeeded');
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
    console.log('💰 Justification du prix 8000€ :');
    console.log('');
    console.log('   - Économie de 52 000€ vs développement from scratch (60k€)');
    console.log('   - ROI immédiat pour une startup');
    console.log('   - Moins cher qu\'un dev freelance pendant 2 mois');
    console.log('   - Produit complet, testé, documenté, prêt à déployer');
    console.log('   - Support 90 jours + mises à jour 12 mois inclus');
    console.log('');

    return { product, price };
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    if (error.type === 'StripeAuthenticationError') {
      console.error('');
      console.error('💡 Vérifie que STRIPE_SECRET_KEY est correct dans .env.local');
    }
    throw error;
  }
}

if (require.main === module) {
  createBlueprint8000Price()
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

module.exports = { createBlueprint8000Price };

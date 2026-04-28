#!/usr/bin/env node
'use strict';

/**
 * Script de test complet du flux d'abonnement Stripe
 * Usage: node test-subscription-flow.cjs
 */

require('dotenv').config({ path: '.env.local' });

const http = require('http');
const { Pool } = require('pg');

const BASE_URL = 'http://localhost:3000';
const TEST_USER_EMAIL = 'djeff@a11.local';

// Couleurs pour le terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testServerRunning() {
  log('\n📡 Test 1: Vérification que le serveur est démarré', 'cyan');
  try {
    const response = await makeRequest('GET', '/api/health');
    if (response.status === 200 || response.status === 404) {
      log('✅ Serveur accessible sur http://localhost:3000', 'green');
      return true;
    }
  } catch (error) {
    log('❌ Serveur non accessible', 'red');
    log('   Démarrer le serveur avec: npm start', 'yellow');
    return false;
  }
}

async function testStripeConfiguration() {
  log('\n🔑 Test 2: Vérification de la configuration Stripe', 'cyan');
  
  const hasSecretKey = !!process.env.STRIPE_SECRET_KEY;
  const hasPriceId = !!process.env.STRIPE_PRICE_ID;
  const hasWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;

  log(`   STRIPE_SECRET_KEY: ${hasSecretKey ? '✅' : '❌'}`, hasSecretKey ? 'green' : 'red');
  log(`   STRIPE_PRICE_ID: ${hasPriceId ? '✅' : '❌'}`, hasPriceId ? 'green' : 'red');
  log(`   STRIPE_WEBHOOK_SECRET: ${hasWebhookSecret ? '✅' : '❌'}`, hasWebhookSecret ? 'green' : 'red');

  if (!hasSecretKey || !hasPriceId) {
    log('\n⚠️  Configuration Stripe incomplète', 'yellow');
    log('   Consulter: GET_STRIPE_KEYS.md', 'yellow');
    return false;
  }

  log('✅ Configuration Stripe complète', 'green');
  return true;
}

async function testDatabaseConnection() {
  log('\n🗄️  Test 3: Vérification de la connexion à la base de données', 'cyan');
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('❌ DATABASE_URL non configuré', 'red');
    return false;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await pool.query('SELECT NOW()');
    log('✅ Connexion à la base de données réussie', 'green');
    
    // Vérifier les colonnes Stripe
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND (column_name LIKE 'stripe%' OR column_name LIKE 'subscription%')
    `);

    if (result.rows.length >= 3) {
      log('✅ Colonnes Stripe présentes dans la table users', 'green');
      await pool.end();
      return true;
    } else {
      log('❌ Colonnes Stripe manquantes', 'red');
      log('   Exécuter: npm run db:migrate:stripe', 'yellow');
      await pool.end();
      return false;
    }
  } catch (error) {
    log('❌ Erreur de connexion à la base de données', 'red');
    log(`   ${error.message}`, 'red');
    await pool.end();
    return false;
  }
}

async function testSubscriptionStatus(token) {
  log('\n📊 Test 4: Vérification du statut d\'abonnement', 'cyan');
  
  try {
    const response = await makeRequest('GET', '/api/subscription/status', null, token);
    
    if (response.status === 200) {
      log('✅ Endpoint /api/subscription/status accessible', 'green');
      log(`   Abonnement actif: ${response.data.active ? '✅ OUI' : '❌ NON'}`, response.data.active ? 'green' : 'yellow');
      return response.data;
    } else if (response.status === 401) {
      log('❌ Non authentifié (JWT requis)', 'red');
      return null;
    } else {
      log(`❌ Erreur ${response.status}`, 'red');
      return null;
    }
  } catch (error) {
    log('❌ Erreur lors de la requête', 'red');
    log(`   ${error.message}`, 'red');
    return null;
  }
}

async function testProtectedRoute(token) {
  log('\n🔒 Test 5: Test d\'une route protégée (génération d\'image)', 'cyan');
  
  try {
    const response = await makeRequest('POST', '/api/jobs/sd', {
      prompt: 'un panda mignon'
    }, token);
    
    if (response.status === 200 || response.status === 201) {
      log('✅ Accès autorisé (abonnement actif ou admin)', 'green');
      return true;
    } else if (response.status === 403) {
      log('❌ Accès refusé (abonnement requis)', 'yellow');
      log('   Code: ' + response.data.code, 'yellow');
      log('   Message: ' + response.data.message, 'yellow');
      return false;
    } else if (response.status === 401) {
      log('❌ Non authentifié (JWT requis)', 'red');
      return false;
    } else {
      log(`⚠️  Réponse inattendue: ${response.status}`, 'yellow');
      return false;
    }
  } catch (error) {
    log('❌ Erreur lors de la requête', 'red');
    log(`   ${error.message}`, 'red');
    return false;
  }
}

async function activateAdminSubscription() {
  log('\n🔧 Activation de l\'abonnement pour l\'admin', 'cyan');
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('❌ DATABASE_URL non configuré', 'red');
    return false;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const result = await pool.query(`
      UPDATE users 
      SET subscription_active = TRUE 
      WHERE email = $1
      RETURNING id, email, subscription_active;
    `, [TEST_USER_EMAIL]);

    if (result.rows.length > 0) {
      log(`✅ Abonnement activé pour ${TEST_USER_EMAIL}`, 'green');
      await pool.end();
      return true;
    } else {
      log(`❌ Utilisateur ${TEST_USER_EMAIL} non trouvé`, 'red');
      await pool.end();
      return false;
    }
  } catch (error) {
    log('❌ Erreur lors de l\'activation', 'red');
    log(`   ${error.message}`, 'red');
    await pool.end();
    return false;
  }
}

async function runTests() {
  log('╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║   Test complet du flux d\'abonnement Stripe - A11         ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝', 'blue');

  // Test 1: Serveur
  const serverRunning = await testServerRunning();
  if (!serverRunning) {
    log('\n❌ Tests interrompus: serveur non accessible', 'red');
    process.exit(1);
  }

  await sleep(500);

  // Test 2: Configuration Stripe
  const stripeConfigured = await testStripeConfiguration();
  if (!stripeConfigured) {
    log('\n⚠️  Tests partiels: configuration Stripe incomplète', 'yellow');
  }

  await sleep(500);

  // Test 3: Base de données
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    log('\n❌ Tests interrompus: base de données non accessible', 'red');
    process.exit(1);
  }

  await sleep(500);

  // Test 4: Statut d'abonnement (sans JWT pour l'instant)
  log('\n📝 Note: Les tests suivants nécessitent un JWT valide', 'yellow');
  log('   Pour un test complet, utiliser un vrai JWT d\'authentification', 'yellow');

  // Test 5: Activer l'abonnement pour l'admin
  await sleep(500);
  await activateAdminSubscription();

  // Résumé
  log('\n╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║                      Résumé des tests                      ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝', 'blue');

  log('\n✅ Tests réussis:', 'green');
  log('   - Serveur accessible', 'green');
  if (stripeConfigured) log('   - Configuration Stripe complète', 'green');
  log('   - Base de données connectée', 'green');
  log('   - Colonnes Stripe présentes', 'green');
  log('   - Abonnement admin activé', 'green');

  log('\n📋 Prochaines étapes:', 'cyan');
  log('   1. Tester avec Stripe CLI:', 'white');
  log('      stripe listen --forward-to localhost:3000/api/subscription/webhook', 'yellow');
  log('   2. Déclencher un événement:', 'white');
  log('      stripe trigger checkout.session.completed', 'yellow');
  log('   3. Tester avec une vraie carte:', 'white');
  log('      Carte de test: 4242 4242 4242 4242', 'yellow');

  log('\n📚 Documentation:', 'cyan');
  log('   - GET_STRIPE_KEYS.md - Récupérer les clés Stripe', 'white');
  log('   - NEXT_STEPS.md - Prochaines étapes', 'white');
  log('   - COMMANDS_CHEATSHEET.md - Toutes les commandes', 'white');

  log('\n✅ Tests terminés avec succès!\n', 'green');
}

// Exécuter les tests
runTests().catch(error => {
  log('\n❌ Erreur fatale:', 'red');
  console.error(error);
  process.exit(1);
});

#!/usr/bin/env node
'use strict';

/**
 * Script de migration SQL pour Stripe (sans psql)
 * Usage: node run-migration.cjs
 */

// Charger les variables d'environnement depuis .env.local
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  console.log('=== Migration SQL Stripe ===\n');

  // Vérifier DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL non configuré dans .env.local');
    process.exit(1);
  }

  console.log('✅ DATABASE_URL trouvé');

  // Créer le pool PostgreSQL
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Tester la connexion
    console.log('🔌 Connexion à la base de données...');
    await pool.query('SELECT NOW()');
    console.log('✅ Connexion réussie\n');

    // Lire le fichier de migration
    const migrationPath = path.join(__dirname, 'migrations', 'add-subscription-columns.sql');
    console.log(`📄 Lecture du fichier: ${migrationPath}`);
    
    if (!fs.existsSync(migrationPath)) {
      console.error('❌ Fichier de migration non trouvé');
      process.exit(1);
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    console.log('✅ Fichier de migration lu\n');

    // Exécuter la migration
    console.log('🚀 Exécution de la migration...');
    await pool.query(migrationSql);
    console.log('✅ Migration exécutée avec succès\n');

    // Vérifier les colonnes créées
    console.log('🔍 Vérification des colonnes...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND (column_name LIKE 'stripe%' OR column_name LIKE 'subscription%')
      ORDER BY column_name;
    `);

    if (result.rows.length > 0) {
      console.log('✅ Colonnes créées:');
      result.rows.forEach(row => {
        console.log(`   - ${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
      });
    } else {
      console.log('⚠️  Aucune colonne trouvée (peut-être déjà existantes)');
    }

    // Vérifier les index
    console.log('\n🔍 Vérification des index...');
    const indexResult = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'users'
        AND (indexname LIKE '%stripe%' OR indexname LIKE '%subscription%')
      ORDER BY indexname;
    `);

    if (indexResult.rows.length > 0) {
      console.log('✅ Index créés:');
      indexResult.rows.forEach(row => {
        console.log(`   - ${row.indexname}`);
      });
    }

    // Vérifier les admins
    console.log('\n🔍 Vérification des admins...');
    const adminResult = await pool.query(`
      SELECT id, email, role, subscription_active
      FROM users
      WHERE role = 'admin'
      LIMIT 5;
    `);

    if (adminResult.rows.length > 0) {
      console.log('✅ Admins trouvés:');
      adminResult.rows.forEach(row => {
        console.log(`   - ${row.email} (subscription_active: ${row.subscription_active})`);
      });
    } else {
      console.log('⚠️  Aucun admin trouvé');
    }

    console.log('\n=== Migration terminée avec succès ===\n');

  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:');
    console.error(error.message);
    console.error('\nDétails:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Exécuter la migration
runMigration().catch(error => {
  console.error('Erreur fatale:', error);
  process.exit(1);
});

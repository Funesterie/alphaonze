#!/usr/bin/env node
/**
 * Script de test de connexion Neo4j pour A11
 * Usage: node test-neo4j-connection.cjs
 */

const neo4j = require('neo4j-driver');
const path = require('path');
const fs = require('fs');

// Charger les variables d'environnement depuis .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'neo4j';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

console.log('\n=== Test de connexion Neo4j ===\n');
console.log(`URI: ${NEO4J_URI}`);
console.log(`Username: ${NEO4J_USERNAME}`);
console.log(`Database: ${NEO4J_DATABASE}`);
console.log(`Password: ${'*'.repeat(NEO4J_PASSWORD.length)}\n`);

async function testConnection() {
  let driver;
  let session;
  
  try {
    console.log('Création du driver Neo4j...');
    driver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
      {
        maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 heures
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 2 * 60 * 1000, // 2 minutes
        disableLosslessIntegers: true
      }
    );
    
    console.log('✓ Driver créé\n');
    
    console.log('Vérification de la connectivité...');
    await driver.verifyConnectivity();
    console.log('✓ Connectivité vérifiée\n');
    
    console.log('Ouverture d\'une session...');
    session = driver.session({ database: NEO4J_DATABASE });
    console.log('✓ Session ouverte\n');
    
    // Test 1: Version de Neo4j
    console.log('Test 1: Récupération de la version Neo4j...');
    const versionResult = await session.run('CALL dbms.components() YIELD name, versions, edition');
    const versionRecord = versionResult.records[0];
    console.log(`✓ Neo4j ${versionRecord.get('versions')[0]} (${versionRecord.get('edition')})\n`);
    
    // Test 2: Création d'un nœud de test
    console.log('Test 2: Création d\'un nœud de test...');
    const createResult = await session.run(
      'CREATE (n:A11Test {name: $name, timestamp: datetime()}) RETURN n',
      { name: 'Test Connection ' + new Date().toISOString() }
    );
    const createdNode = createResult.records[0].get('n');
    console.log(`✓ Nœud créé: ${JSON.stringify(createdNode.properties, null, 2)}\n`);
    
    // Test 3: Comptage des nœuds de test
    console.log('Test 3: Comptage des nœuds de test...');
    const countResult = await session.run('MATCH (n:A11Test) RETURN count(n) as count');
    const count = countResult.records[0].get('count');
    console.log(`✓ Nombre de nœuds A11Test: ${count}\n`);
    
    // Test 4: Nettoyage des nœuds de test
    console.log('Test 4: Nettoyage des nœuds de test...');
    const deleteResult = await session.run('MATCH (n:A11Test) DELETE n RETURN count(n) as deleted');
    const deleted = deleteResult.records[0].get('deleted');
    console.log(`✓ ${deleted} nœud(s) supprimé(s)\n`);
    
    console.log('=== ✓ Tous les tests réussis! ===\n');
    console.log('Neo4j est correctement configuré pour A11.\n');
    
    return true;
    
  } catch (error) {
    console.error('\n=== ✗ ERREUR ===\n');
    console.error(`Type: ${error.name}`);
    console.error(`Message: ${error.message}`);
    
    if (error.code) {
      console.error(`Code: ${error.code}`);
    }
    
    console.error('\n=== Diagnostic ===\n');
    
    if (error.message.includes('authentication')) {
      console.error('❌ Erreur d\'authentification');
      console.error('   → Vérifiez NEO4J_USERNAME et NEO4J_PASSWORD dans .env.local');
      console.error('   → Credentials par défaut: neo4j / neo4j');
      console.error('   → Changez le mot de passe lors de la première connexion\n');
    } else if (error.message.includes('connection') || error.message.includes('ECONNREFUSED')) {
      console.error('❌ Impossible de se connecter à Neo4j');
      console.error('   → Vérifiez que Neo4j Desktop est lancé');
      console.error('   → Vérifiez que la base de données est démarrée');
      console.error('   → Vérifiez NEO4J_URI dans .env.local');
      console.error('   → URI par défaut: bolt://localhost:7687\n');
    } else if (error.message.includes('database')) {
      console.error('❌ Base de données introuvable');
      console.error('   → Vérifiez NEO4J_DATABASE dans .env.local');
      console.error('   → Créez la base de données dans Neo4j Desktop\n');
    } else {
      console.error('❌ Erreur inconnue');
      console.error('   → Consultez les logs Neo4j Desktop');
      console.error('   → Vérifiez la configuration dans .env.local\n');
    }
    
    return false;
    
  } finally {
    if (session) {
      await session.close();
      console.log('Session fermée');
    }
    if (driver) {
      await driver.close();
      console.log('Driver fermé\n');
    }
  }
}

// Exécuter le test
testConnection()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Erreur fatale:', error);
    process.exit(1);
  });

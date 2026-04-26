#!/usr/bin/env node
/**
 * Script pour tester différentes configurations d'authentification Neo4j
 */

const neo4j = require('neo4j-driver');

const configs = [
  { username: 'neo4j', password: 'neoj4neoj4', database: 'neo4j' },
  { username: 'neo4j', password: 'neoj4neoj4', database: 'a11-knowledge-graph' },
  { username: 'neo4j', password: 'neo4j', database: 'neo4j' },
  { username: 'neo4j', password: 'neo4j', database: 'a11-knowledge-graph' },
];

const uri = 'bolt://localhost:7687';

async function testConfig(config) {
  const driver = neo4j.driver(uri, neo4j.auth.basic(config.username, config.password));
  
  try {
    await driver.verifyConnectivity();
    const session = driver.session({ database: config.database });
    
    try {
      const result = await session.run('RETURN 1 as test');
      console.log(`✓ SUCCESS: username=${config.username}, password=${config.password.slice(0, 3)}***, database=${config.database}`);
      return true;
    } catch (error) {
      console.log(`✗ FAILED (query): username=${config.username}, password=${config.password.slice(0, 3)}***, database=${config.database}`);
      console.log(`  Error: ${error.message}`);
      return false;
    } finally {
      await session.close();
    }
  } catch (error) {
    console.log(`✗ FAILED (auth): username=${config.username}, password=${config.password.slice(0, 3)}***, database=${config.database}`);
    console.log(`  Error: ${error.message}`);
    return false;
  } finally {
    await driver.close();
  }
}

async function main() {
  console.log('\n=== Test des configurations Neo4j ===\n');
  console.log(`URI: ${uri}\n`);
  
  for (const config of configs) {
    await testConfig(config);
    console.log('');
  }
  
  console.log('=== Test terminé ===\n');
}

main().catch(console.error);

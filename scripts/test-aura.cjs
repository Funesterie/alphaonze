'use strict';

const path = require('node:path');

function requireNeo4jDriver() {
  const candidates = [
    'neo4j-driver',
    path.resolve(__dirname, '..', 'a11', 'backend', 'apps', 'server', 'node_modules', 'neo4j-driver'),
    path.resolve(__dirname, '..', 'a11mcp', 'node_modules', 'neo4j-driver'),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next workspace-local install.
    }
  }

  throw new Error('Cannot find neo4j-driver. Run npm install in a11/backend/apps/server or a11mcp first.');
}

const neo4j = requireNeo4jDriver();

function loadEnvFile(filePath) {
  try {
    const fs = require('node:fs');
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Optional local env fallback only.
  }
}

loadEnvFile(path.resolve(__dirname, '..', 'a11', 'backend', 'apps', 'server', '.env.local'));

const uri = process.env.KIRO_V2 || process.env.NEO4J_AURA_URI;
const user = process.env.KIRO_V2_USER || process.env.NEO4J_AURA_USER;
const password = process.env.KIRO_V2_PASSWORD || process.env.NEO4J_AURA_PASSWORD;
const database = process.env.KIRO_V2_DATABASE || process.env.NEO4J_AURA_DATABASE || 'neo4j';

async function test() {
  if (!uri || !user || !password) {
    throw new Error('Missing Aura env. Set KIRO_V2, KIRO_V2_USER, KIRO_V2_PASSWORD and KIRO_V2_DATABASE.');
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  try {
    await driver.verifyConnectivity();
    const session = driver.session({ database });
    try {
      const result = await session.run('MATCH (n) RETURN count(n) AS total');
      const labels = await session.run(`
        MATCH (n)
        WITH labels(n) AS labels, count(n) AS count
        WITH labels, count ORDER BY count DESC LIMIT 12
        RETURN labels, count
      `);
      const total = result.records[0].get('total');
      console.log(JSON.stringify({
        ok: true,
        uri,
        database,
        totalNodes: typeof total.toNumber === 'function' ? total.toNumber() : total,
        labelSummary: labels.records.map((record) => {
          const count = record.get('count');
          return {
            labels: record.get('labels'),
            count: typeof count.toNumber === 'function' ? count.toNumber() : count,
          };
        }),
      }, null, 2));
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

test().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.code || error.name,
    message: String(error.message || error).slice(0, 240),
  }, null, 2));
  process.exitCode = 1;
});

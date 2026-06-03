#!/usr/bin/env node
'use strict';

const neo4j = require('neo4j-driver');

const { loadRouterEnv } = require('./a11-env-loader.cjs');
const {
  resolveRouterConfig,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');
const {
  NUMA_SYMBOLIC_LANGUAGE,
  listNumaValues,
} = require('../src/knowledge/numa-symbolic-language.cjs');

function parseArgs(argv = []) {
  const out = { target: 'local', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') out.target = argv[++i] || 'local';
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

function resolveEndpoint(target) {
  loadRouterEnv();
  const config = resolveRouterConfig(process.env);
  return target === 'aura' ? config.aura : config.local;
}

function createDriver(endpoint) {
  const auth = endpoint.auth === 'none'
    ? neo4j.auth.none()
    : neo4j.auth.basic(endpoint.username, endpoint.password);
  return neo4j.driver(endpoint.uri, auth, {
    connectionAcquisitionTimeout: 20000,
    maxConnectionPoolSize: 4,
    disableLosslessIntegers: true,
  });
}

function buildPayload() {
  const module = NUMA_SYMBOLIC_LANGUAGE;
  const now = new Date().toISOString();
  const values = listNumaValues().map((entry) => ({
    id: `numa:number:${entry.token}`,
    languageId: 'numa',
    token: String(entry.token),
    kind: 'number',
    primaryMeaning: entry.primaryMeaning,
    aliases: entry.aliases || [],
    confidence: entry.confidence || 'unknown',
    updatedAt: now,
  }));
  return {
    language: {
      id: 'numa',
      label: module.label,
      moduleId: module.id,
      discipline: module.discipline,
      status: 'private-experimental-canon',
      description: 'Langage symbolique Funesterie pour encoder des idees par nombres, motifs et valeurs composees.',
      avoidGenericNumerology: true,
      preserveCompoundNumbers: true,
      updatedAt: now,
    },
    concepts: (module.knowledge?.concepts || []).map((label, index) => ({
      id: `numa:concept:${index}`,
      languageId: 'numa',
      label,
      updatedAt: now,
    })),
    methods: (module.knowledge?.methods || []).map((label, index) => ({
      id: `numa:method:${index}`,
      languageId: 'numa',
      label,
      updatedAt: now,
    })),
    commonErrors: (module.knowledge?.commonErrors || []).map((label, index) => ({
      id: `numa:error:${index}`,
      languageId: 'numa',
      label,
      updatedAt: now,
    })),
    values,
    sourceCards: (module.knowledge?.sourceCards || []).map((source) => ({
      id: source.id,
      languageId: 'numa',
      title: source.title,
      role: source.role,
      note: source.note,
      updatedAt: now,
    })),
  };
}

async function upsertRows(session, cypher, rows) {
  if (!rows.length) return;
  await session.run(cypher, { rows: rows.map((row) => sanitizePropertyMap(row)) });
}

async function sync(session, payload) {
  const constraints = [
    'CREATE CONSTRAINT symbolic_language_id IF NOT EXISTS FOR (n:FunesterieSymbolicLanguage) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT symbolic_value_id IF NOT EXISTS FOR (n:FunesterieSymbolicValue) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT symbolic_concept_id IF NOT EXISTS FOR (n:FunesterieSymbolicConcept) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT symbolic_method_id IF NOT EXISTS FOR (n:FunesterieSymbolicMethod) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT symbolic_error_id IF NOT EXISTS FOR (n:FunesterieSymbolicCommonError) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT symbolic_source_id IF NOT EXISTS FOR (n:FunesterieSymbolicSourceCard) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);

  await session.run(`
    MERGE (language:FunesterieSymbolicLanguage {id: $id})
    SET language += $props
  `, { id: payload.language.id, props: sanitizePropertyMap(payload.language) });

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (value:FunesterieSymbolicValue {id: row.id})
    SET value += row
    WITH value, row
    MATCH (language:FunesterieSymbolicLanguage {id: row.languageId})
    MERGE (language)-[:HAS_SYMBOLIC_VALUE]->(value)
  `, payload.values);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (concept:FunesterieSymbolicConcept {id: row.id})
    SET concept += row
    WITH concept, row
    MATCH (language:FunesterieSymbolicLanguage {id: row.languageId})
    MERGE (language)-[:HAS_CONCEPT]->(concept)
  `, payload.concepts);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (method:FunesterieSymbolicMethod {id: row.id})
    SET method += row
    WITH method, row
    MATCH (language:FunesterieSymbolicLanguage {id: row.languageId})
    MERGE (language)-[:HAS_METHOD]->(method)
  `, payload.methods);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (error:FunesterieSymbolicCommonError {id: row.id})
    SET error += row
    WITH error, row
    MATCH (language:FunesterieSymbolicLanguage {id: row.languageId})
    MERGE (language)-[:HAS_COMMON_ERROR]->(error)
  `, payload.commonErrors);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (source:FunesterieSymbolicSourceCard {id: row.id})
    SET source += row
    WITH source, row
    MATCH (language:FunesterieSymbolicLanguage {id: row.languageId})
    MERGE (language)-[:HAS_SOURCE_CARD]->(source)
  `, payload.sourceCards);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildPayload();
  const summary = {
    ok: true,
    dryRun: args.dryRun,
    target: args.target,
    language: payload.language.id,
    values: payload.values.length,
    concepts: payload.concepts.length,
    methods: payload.methods.length,
    commonErrors: payload.commonErrors.length,
    sourceCards: payload.sourceCards.length,
  };
  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const endpoint = resolveEndpoint(args.target);
  const driver = createDriver(endpoint);
  const session = driver.session({
    database: endpoint.database,
    defaultAccessMode: neo4j.session.WRITE,
  });
  try {
    await driver.verifyConnectivity();
    await sync(session, payload);
    const verify = await session.run(`
      MATCH (language:FunesterieSymbolicLanguage {id: 'numa'})
      OPTIONAL MATCH (language)-[:HAS_SYMBOLIC_VALUE]->(value)
      RETURN count(DISTINCT value) AS values
    `);
    console.log(JSON.stringify({
      ...summary,
      neo4j: {
        name: endpoint.name,
        uri: endpoint.uri,
        database: endpoint.database,
        values: verify.records[0].get('values'),
      },
    }, null, 2));
  } finally {
    await session.close().catch(() => {});
    await driver.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error.code || error.name || 'NumaNeo4jSyncError',
      message: String(error.message || error).slice(0, 300),
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  buildPayload,
  parseArgs,
};

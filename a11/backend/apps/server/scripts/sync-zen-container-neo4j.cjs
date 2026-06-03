#!/usr/bin/env node
'use strict';

const neo4j = require('neo4j-driver');

const { loadRouterEnv } = require('./a11-env-loader.cjs');
const {
  resolveRouterConfig,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');
const {
  ZEN_CONTAINER_FORMAT,
  listZenLayers,
  listZenPipeline,
} = require('../src/knowledge/zen-container.cjs');

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
  const module = ZEN_CONTAINER_FORMAT;
  const knowledge = module.knowledge || {};
  const now = new Date().toISOString();
  return {
    format: {
      id: 'zen',
      moduleId: module.id,
      label: module.label,
      discipline: module.discipline,
      status: 'private-experimental-spec',
      shortDefinition: knowledge.shortDefinition || '',
      canonicalDefinition: knowledge.canonicalDefinition || '',
      publicHeaderFormat: knowledge.publicHeader?.format || 'zen',
      publicHeaderVersion: knowledge.publicHeader?.version || '1.0',
      publicHeaderMode: knowledge.publicHeader?.mode || 'encrypted_multiload',
      headerPolicy: 'minimal-public',
      implementationWarning: 'specification only: use audited cryptography for real encrypted archives',
      updatedAt: now,
    },
    concepts: (knowledge.concepts || []).map((label, index) => ({
      id: `zen:concept:${index}`,
      formatId: 'zen',
      label,
      updatedAt: now,
    })),
    architecture: (knowledge.architecture || []).map((label, index) => ({
      id: `zen:architecture:${index}`,
      formatId: 'zen',
      label,
      updatedAt: now,
    })),
    layers: listZenLayers().map((entry, index) => ({
      id: `zen:layer:${entry.id || index}`,
      formatId: 'zen',
      layerKey: entry.id || String(index),
      label: entry.label || '',
      visibility: entry.visibility || '',
      purpose: entry.purpose || '',
      position: index,
      updatedAt: now,
    })),
    pipeline: listZenPipeline().map((entry, index) => ({
      id: `zen:pipeline:${entry.id || index}`,
      formatId: 'zen',
      subject: entry.subject || '',
      verb: entry.verb || '',
      object: entry.object || '',
      position: index,
      updatedAt: now,
    })),
    methods: (knowledge.methods || []).map((label, index) => ({
      id: `zen:method:${index}`,
      formatId: 'zen',
      label,
      updatedAt: now,
    })),
    commonErrors: (knowledge.commonErrors || []).map((label, index) => ({
      id: `zen:error:${index}`,
      formatId: 'zen',
      label,
      updatedAt: now,
    })),
    sourceCards: (knowledge.sourceCards || []).map((source) => ({
      id: source.id,
      formatId: 'zen',
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
    'CREATE CONSTRAINT container_format_id IF NOT EXISTS FOR (n:FunesterieContainerFormat) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_concept_id IF NOT EXISTS FOR (n:FunesterieContainerConcept) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_architecture_id IF NOT EXISTS FOR (n:FunesterieContainerArchitecture) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_layer_id IF NOT EXISTS FOR (n:FunesterieContainerLayer) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_pipeline_id IF NOT EXISTS FOR (n:FunesterieContainerPipelineStep) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_method_id IF NOT EXISTS FOR (n:FunesterieContainerMethod) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_error_id IF NOT EXISTS FOR (n:FunesterieContainerCommonError) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT container_source_id IF NOT EXISTS FOR (n:FunesterieContainerSourceCard) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);

  await session.run(`
    MERGE (format:FunesterieContainerFormat {id: $id})
    SET format += $props
  `, { id: payload.format.id, props: sanitizePropertyMap(payload.format) });

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (concept:FunesterieContainerConcept {id: row.id})
    SET concept += row
    WITH concept, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_CONCEPT]->(concept)
  `, payload.concepts);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (architecture:FunesterieContainerArchitecture {id: row.id})
    SET architecture += row
    WITH architecture, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_ARCHITECTURE]->(architecture)
  `, payload.architecture);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (layer:FunesterieContainerLayer {id: row.id})
    SET layer += row
    WITH layer, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_LAYER]->(layer)
  `, payload.layers);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (step:FunesterieContainerPipelineStep {id: row.id})
    SET step += row
    WITH step, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_PIPELINE_STEP]->(step)
  `, payload.pipeline);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (method:FunesterieContainerMethod {id: row.id})
    SET method += row
    WITH method, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_METHOD]->(method)
  `, payload.methods);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (error:FunesterieContainerCommonError {id: row.id})
    SET error += row
    WITH error, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_COMMON_ERROR]->(error)
  `, payload.commonErrors);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (source:FunesterieContainerSourceCard {id: row.id})
    SET source += row
    WITH source, row
    MATCH (format:FunesterieContainerFormat {id: row.formatId})
    MERGE (format)-[:HAS_SOURCE_CARD]->(source)
  `, payload.sourceCards);

  await upsertRows(session, `
    UNWIND $rows AS row
    MERGE (system:FunesterieSystemConcept {id: toLower(row.subject)})
    ON CREATE SET system.label = row.subject
    WITH system, row
    MATCH (step:FunesterieContainerPipelineStep {id: row.id})
    MERGE (step)-[:REFERENCES_SYSTEM]->(system)
  `, payload.pipeline.filter((row) => row.subject));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildPayload();
  const summary = {
    ok: true,
    dryRun: args.dryRun,
    target: args.target,
    format: payload.format.id,
    concepts: payload.concepts.length,
    architecture: payload.architecture.length,
    layers: payload.layers.length,
    pipeline: payload.pipeline.length,
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
      MATCH (format:FunesterieContainerFormat {id: 'zen'})
      OPTIONAL MATCH (format)-[:HAS_LAYER]->(layer)
      OPTIONAL MATCH (format)-[:HAS_PIPELINE_STEP]->(step)
      RETURN count(DISTINCT layer) AS layers,
             count(DISTINCT step) AS pipeline
    `);
    console.log(JSON.stringify({
      ...summary,
      neo4j: {
        name: endpoint.name,
        uri: endpoint.uri,
        database: endpoint.database,
        layers: verify.records[0].get('layers'),
        pipeline: verify.records[0].get('pipeline'),
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
      error: error.code || error.name || 'ZenNeo4jSyncError',
      message: String(error.message || error).slice(0, 300),
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  buildPayload,
  parseArgs,
};

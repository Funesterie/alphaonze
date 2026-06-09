#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const neo4j = require('neo4j-driver');

const {
  buildEcosystemCorpus,
  summarizeCorpus,
  toCypher,
  toMarkdown,
} = require('../src/knowledge/ecosystem-corpus.cjs');
const { hashtagNodeId } = require('../src/knowledge/identity-hashtags.cjs');
const {
  resolveRouterConfig,
  sanitizePropertyMap,
} = require('../lib/neo4j-memory-router.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');

loadEnvIfExists(path.join(SERVER_ROOT, '.env.local'), false);
loadEnvIfExists(path.join(SERVER_ROOT, '.env'), false);
loadEnvIfExists(path.join(WORKSPACE_ROOT, 'a11mcp', '.env'), false);

const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');
const ECOSYSTEM_SCOPE_PATH = path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.json');
const args = parseArgs(process.argv.slice(2));

async function main() {
  const scope = readJson(ECOSYSTEM_SCOPE_PATH);
  const corpus = buildEcosystemCorpus(scope);

  fs.mkdirSync(GRAPH_DIR, { recursive: true });
  const jsonPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.json');
  const markdownPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.md');
  const cypherPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.cypher');

  fs.writeFileSync(jsonPath, JSON.stringify(corpus, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, toMarkdown(corpus), 'utf8');
  fs.writeFileSync(cypherPath, toCypher(corpus), 'utf8');

  if (args.dryRun) {
    return output({
      ok: true,
      dryRun: true,
      corpus: summarizeCorpus(corpus),
      files: { jsonPath, markdownPath, cypherPath },
    });
  }

  const endpoints = resolveTargetEndpoints(args.target);
  const results = [];
  for (const endpoint of endpoints) results.push(await syncEndpoint(endpoint, corpus));

  output({
    ok: results.every((result) => result.ok),
    dryRun: false,
    target: args.target,
    corpus: summarizeCorpus(corpus),
    endpoints: results,
    files: { jsonPath, markdownPath, cypherPath },
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ecosystem scope at ${filePath}: ${error.message}`);
  }
}

function resolveTargetEndpoints(target) {
  const config = resolveRouterConfig(process.env);
  if (target === 'aura') return [config.aura];
  if (target === 'both') return [config.local, config.aura];
  return [config.local];
}

async function syncEndpoint(endpoint, corpus) {
  const startedAt = Date.now();
  try {
    const driver = neo4j.driver(endpoint.uri, neo4j.auth.basic(endpoint.username, endpoint.password), {
      connectionAcquisitionTimeout: 15000,
      maxConnectionPoolSize: 5,
      disableLosslessIntegers: true,
    });
    try {
      await driver.verifyConnectivity();
      const session = driver.session({
        database: endpoint.database,
        defaultAccessMode: neo4j.session.WRITE,
      });
      try {
        await syncCorpus(session, corpus, endpoint);
        const summary = await session.run(`
          MATCH (pack:FunesterieCorpusPack {id: $packId})
          OPTIONAL MATCH (pack)-[:HAS_SOURCE_CARD]->(card:FunesterieSourceCard)
          OPTIONAL MATCH (pack)-[:HAS_REPO_BRIEF]->(brief:FunesterieRepoBrief)
          OPTIONAL MATCH (card)-[:IN_DOMAIN]->(domain:FunesterieCorpusDomain)
          OPTIONAL MATCH (card)-[:HAS_BOUNDARY]->(boundary:FunesterieBoundary)
          OPTIONAL MATCH (:FunesterieEcosystemNode)-[r:FUNESTERIE_CORPUS_LINK]->(:FunesterieEcosystemNode)
          RETURN count(DISTINCT card) AS sourceCards,
                 count(DISTINCT brief) AS repoBriefs,
                 count(DISTINCT domain) AS domains,
                 count(DISTINCT boundary) AS boundaries,
                 count(DISTINCT r) AS links
        `, { packId: corpus.id });
        const record = summary.records[0];
        return {
          ok: true,
          name: endpoint.name,
          uri: endpoint.uri,
          database: endpoint.database,
          sourceCards: toPlain(record.get('sourceCards')),
          repoBriefs: toPlain(record.get('repoBriefs')),
          domains: toPlain(record.get('domains')),
          boundaries: toPlain(record.get('boundaries')),
          links: toPlain(record.get('links')),
          elapsedMs: Date.now() - startedAt,
        };
      } finally {
        await session.close().catch(() => {});
      }
    } finally {
      await driver.close().catch(() => {});
    }
  } catch (error) {
    return {
      ok: false,
      name: endpoint?.name || 'unknown',
      uri: endpoint?.uri || '',
      database: endpoint?.database || '',
      error: error.code || error.name || 'Neo4jError',
      message: String(error.message || error).slice(0, 300),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function syncCorpus(session, corpus, endpoint) {
  const constraints = [
    'CREATE CONSTRAINT funesterie_ecosystem_node_id IF NOT EXISTS FOR (n:FunesterieEcosystemNode) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_corpus_pack_id IF NOT EXISTS FOR (n:FunesterieCorpusPack) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_source_card_id IF NOT EXISTS FOR (n:FunesterieSourceCard) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_repo_brief_id IF NOT EXISTS FOR (n:FunesterieRepoBrief) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_corpus_domain_id IF NOT EXISTS FOR (n:FunesterieCorpusDomain) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_boundary_id IF NOT EXISTS FOR (n:FunesterieBoundary) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_identity_profile_id IF NOT EXISTS FOR (n:FunesterieIdentityProfile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT funesterie_identity_hashtag_id IF NOT EXISTS FOR (n:FunesterieIdentityHashtag) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);

  await session.run(`
    MERGE (pack:FunesterieEcosystemNode {id: $id})
    SET pack:FunesterieCorpusPack,
        pack.label = $label,
        pack.schema = $schema,
        pack.mode = $mode,
        pack.sourceScopeId = $sourceScopeId,
        pack.sourceScopeGeneratedAt = $sourceScopeGeneratedAt,
        pack.generatedAt = datetime($generatedAt),
        pack.endpointName = $endpointName,
        pack.endpointUri = $endpointUri,
        pack.endpointDatabase = $endpointDatabase,
        pack.summary = $summary,
        pack.updatedAt = datetime($generatedAt)
  `, {
    id: corpus.id,
    label: corpus.label,
    schema: corpus.schema,
    mode: corpus.mode,
    sourceScopeId: corpus.sourceScopeId,
    sourceScopeGeneratedAt: corpus.sourceScopeGeneratedAt,
    generatedAt: corpus.generatedAt,
    endpointName: endpoint.name,
    endpointUri: endpoint.uri,
    endpointDatabase: endpoint.database,
    summary: JSON.stringify(corpus.summary),
  });

  await session.run(`
    MATCH ()-[r]->()
    WHERE r.source = 'funesterie-ecosystem-corpus'
       OR type(r) = 'FUNESTERIE_CORPUS_LINK'
    DELETE r
  `);

  await upsertNodes(session, 'FunesterieCorpusDomain', corpus.domains.map((domain) => ({
    id: domain.id,
    props: { ...domain, kind: 'corpus-domain' },
  })), corpus, 'DESCRIBES_DOMAIN');

  await upsertNodes(session, 'FunesterieBoundary', corpus.boundaries.map((boundary) => ({
    id: boundary.id,
    props: { ...boundary, kind: 'boundary' },
  })), corpus, 'DESCRIBES_BOUNDARY');

  await upsertNodes(session, 'FunesterieSourceCard', corpus.sourceCards.map((card) => ({
    id: card.id,
    props: {
      kind: card.kind,
      subjectId: card.subjectId,
      title: card.title,
      name: card.name,
      role: card.role,
      status: card.status,
      confidence: card.confidence,
      boundary: card.boundary,
      domains: card.domains,
      filesKey: card.filesKey,
      evidence: card.evidence,
      risks: card.risks,
      publicSummary: card.publicSummary,
      agentUse: card.agentUse,
      identityProfileId: card.identity?.id || '',
      identityType: card.identity?.identityType || '',
      identityHashtags: card.identityHashtags || [],
      functionalHashtags: card.functionalHashtags || [],
      narrativeHashtags: card.narrativeHashtags || [],
      visualHashtags: card.visualHashtags || [],
      visualStyle: card.visualIdentity?.style || '',
      visualRepresentation: card.visualIdentity?.representation || '',
      symbolicRepresentation: card.visualIdentity?.symbolicRepresentation || '',
      humanRepresentationAllowed: card.visualIdentity?.humanRepresentationAllowed === true,
      identityPrompt: card.identityPrompt || '',
    },
  })), corpus, 'HAS_SOURCE_CARD');

  await upsertNodes(session, 'FunesterieRepoBrief', corpus.repoBriefs.map((brief) => ({
    id: brief.id,
    props: brief,
  })), corpus, 'HAS_REPO_BRIEF');

  const identityProfiles = Array.from(new Map(
    (corpus.sourceCards || [])
      .map((card) => card.identity)
      .filter((identity) => identity?.id)
      .map((identity) => [identity.id, identity])
  ).values());
  await upsertNodes(session, 'FunesterieIdentityProfile', identityProfiles.map((identity) => ({
    id: identity.id,
    props: {
      label: identity.label,
      identityType: identity.identityType,
      canonicalId: identity.canonicalId,
      hashtags: identity.hashtags || [],
      functionalHashtags: identity.functionalHashtags || [],
      narrativeHashtags: identity.narrativeHashtags || [],
      visualHashtags: identity.visualHashtags || [],
      routingTags: identity.routingTags || [],
      visualStyle: identity.visualIdentity?.style || '',
      palette: identity.visualIdentity?.palette || [],
      visualRepresentation: identity.visualIdentity?.representation || '',
      symbolicRepresentation: identity.visualIdentity?.symbolicRepresentation || '',
      humanRepresentationAllowed: identity.visualIdentity?.humanRepresentationAllowed === true,
      promptAnchor: identity.visualIdentity?.promptAnchor || '',
      sourceCardUse: identity.sourceCardUse || '',
      kind: 'identity-profile',
    },
  })), corpus, 'HAS_IDENTITY_PROFILE');

  const hashtags = Array.from(new Set(identityProfiles.flatMap((identity) => identity.hashtags || []))).sort();
  await upsertNodes(session, 'FunesterieIdentityHashtag', hashtags.map((hashtag) => ({
    id: hashtagNodeId(hashtag),
    props: {
      label: hashtag,
      normalized: hashtag.replace(/^#/, ''),
      kind: 'identity-hashtag',
    },
  })), corpus, 'HAS_IDENTITY_HASHTAG');

  const nodeIds = Array.from(new Set([
    corpus.id,
    ...corpus.sourceCards.flatMap((card) => [card.id, card.subjectId, card.boundary, ...card.domains]),
    ...corpus.repoBriefs.flatMap((brief) => [brief.id, brief.sourceCardId]),
    ...corpus.links.flatMap((link) => [link.from, link.to]),
  ]));
  await session.run(`
    UNWIND $nodeIds AS id
    MERGE (node:FunesterieEcosystemNode {id: id})
    SET node.updatedAt = datetime($generatedAt)
  `, {
    nodeIds,
    generatedAt: corpus.generatedAt,
  });

  for (const link of corpus.links) {
    await session.run(`
      MATCH (a:FunesterieEcosystemNode {id: $from})
      MATCH (b:FunesterieEcosystemNode {id: $to})
      MERGE (a)-[r:${safeRel(link.type)}]->(b)
      SET r.label = $type,
          r.source = 'funesterie-ecosystem-corpus',
          r.updatedAt = datetime($generatedAt)
      MERGE (a)-[generic:FUNESTERIE_CORPUS_LINK {kind: $type}]->(b)
      SET generic.source = 'funesterie-ecosystem-corpus',
          generic.updatedAt = datetime($generatedAt)
    `, {
      from: link.from,
      to: link.to,
      type: link.type,
      generatedAt: corpus.generatedAt,
    });
  }
}

async function upsertNodes(session, label, nodes, corpus, packRelType) {
  const safeLabel = safeNeo4jToken(label);
  const safeRelType = safeRel(packRelType);
  const rows = nodes.map((node) => ({
    id: node.id,
    props: sanitizePropertyMap({ ...node.props, id: node.id }),
  }));
  await session.run(`
    MATCH (pack:FunesterieCorpusPack {id: $packId})
    UNWIND $rows AS item
    MERGE (node:FunesterieEcosystemNode {id: item.id})
    SET node:${safeLabel},
        node += item.props,
        node.updatedAt = datetime($generatedAt)
    MERGE (pack)-[r:${safeRelType}]->(node)
    SET r.source = 'funesterie-ecosystem-corpus',
        r.updatedAt = datetime($generatedAt)
  `, {
    packId: corpus.id,
    rows,
    generatedAt: corpus.generatedAt,
  });
}

function safeNeo4jToken(value) {
  const token = String(value || 'Node').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(token) ? token : `L_${token}`;
}

function safeRel(value) {
  return safeNeo4jToken(String(value || 'RELATED_TO').toUpperCase());
}

function toPlain(value) {
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  return value;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    target: process.env.A11_ECOSYSTEM_CORPUS_TARGET || 'local',
  };
  for (const arg of argv) {
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
  }
  if (!['local', 'aura', 'both'].includes(parsed.target)) parsed.target = 'local';
  return parsed;
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

function loadEnvIfExists(filePath, override = false) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && (override || !Object.prototype.hasOwnProperty.call(process.env, key))) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

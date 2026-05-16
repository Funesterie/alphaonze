#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const neo4j = require('neo4j-driver');

const { createKnowledgeGraph } = require('../lib/knowledge-graph.cjs');
const { resolveRouterConfig, sanitizePropertyMap } = require('../lib/neo4j-memory-router.cjs');
const {
  buildAgentDomainPack,
  summarizePack,
  toCypher,
  toMarkdown,
} = require('../src/knowledge/agent-domain-pack.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');

loadEnvIfExists(path.join(SERVER_ROOT, '.env.local'), true);
loadEnvIfExists(path.join(SERVER_ROOT, '.env'), false);
loadEnvIfExists(path.join(WORKSPACE_ROOT, 'a11mcp', '.env'), false);

const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');
const GENERATED_AT = process.env.A11_AGENT_DOMAIN_PACK_UPDATED_AT || new Date().toISOString();

const args = parseArgs(process.argv.slice(2));

async function main() {
  fs.mkdirSync(GRAPH_DIR, { recursive: true });
  const pack = buildAgentDomainPack({
    generatedAt: GENERATED_AT,
    runtimeRoot: RUNTIME_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
  });

  const files = writePackFiles(pack);
  const graphResult = await writeJsonFallbackGraph(pack);

  if (args.dryRun) {
    return output({
      ok: true,
      dryRun: true,
      pack: summarizePack(pack),
      graphResult,
      files,
    });
  }

  const endpoints = resolveTargetEndpoints(args.target);
  const results = [];
  for (const endpoint of endpoints) {
    results.push(await syncEndpoint(endpoint, pack));
  }

  output({
    ok: results.every((result) => result.ok),
    dryRun: false,
    target: args.target,
    pack: summarizePack(pack),
    graphResult,
    endpoints: results,
    files,
  });
}

function writePackFiles(pack) {
  const jsonPath = path.join(GRAPH_DIR, 'a11-agent-domain-pack.json');
  const markdownPath = path.join(GRAPH_DIR, 'a11-agent-domain-pack.md');
  const cypherPath = path.join(GRAPH_DIR, 'a11-agent-domain-pack.cypher');
  fs.writeFileSync(jsonPath, JSON.stringify(pack, null, 2), 'utf8');
  fs.writeFileSync(markdownPath, toMarkdown(pack), 'utf8');
  fs.writeFileSync(cypherPath, toCypher(pack), 'utf8');
  return { jsonPath, markdownPath, cypherPath };
}

async function writeJsonFallbackGraph(pack) {
  const graph = createKnowledgeGraph('a11-agent-domain-pack', {
    forceJson: true,
    storageDir: GRAPH_DIR,
  });
  const triplets = buildGraphTriplets(pack);
  return graph.addTriplets(triplets, {
    source: 'seed-agent-domain-pack',
    generatedAt: pack.generatedAt,
    mode: pack.mode,
  });
}

function buildGraphTriplets(pack) {
  const label = new Map();
  for (const agent of pack.agents) label.set(agent.id, agent.name);
  for (const domain of pack.domains) label.set(domain.id, domain.label);
  for (const tool of pack.tools) label.set(tool.id, tool.label);
  for (const lane of pack.culturalLanes) label.set(lane.id, lane.label);
  for (const card of pack.seedCards) label.set(card.id, card.title);
  for (const asset of pack.sfxAssets) label.set(asset.id, asset.fileName);
  for (const hook of pack.hooks) label.set(hook.id, hook.name);

  const triplets = [
    { subject: 'Funesterie', predicate: 'has_agent_domain_pack', object: pack.label },
    { subject: pack.label, predicate: 'uses_source_policy', object: pack.sourcePolicy.currentPass },
    { subject: pack.label, predicate: 'next_pass_policy', object: pack.sourcePolicy.nextPass },
  ];

  for (const link of pack.links) {
    triplets.push({
      subject: label.get(link.from) || link.from,
      predicate: link.type.toLowerCase(),
      object: label.get(link.to) || link.to,
    });
  }

  for (const card of pack.seedCards) {
    triplets.push({
      subject: card.title,
      predicate: 'teaches',
      object: card.body,
    });
  }

  return triplets;
}

function resolveTargetEndpoints(target) {
  const config = resolveRouterConfig(process.env);
  if (target === 'aura') return [config.aura];
  if (target === 'both') return [config.local, config.aura];
  return [config.local];
}

async function syncEndpoint(endpoint, pack) {
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
        await syncPack(session, pack, endpoint);
        const summary = await session.run(`
          MATCH (pack:A11DomainPack {id: $packId})
          OPTIONAL MATCH (pack)-[:DESCRIBES_AGENT]->(agent:A11AgentProfile)
          OPTIONAL MATCH (:A11DomainEntity)-[r:A11_DOMAIN_LINK]->(:A11DomainEntity)
          OPTIONAL MATCH (domain:A11KnowledgeDomain)
          OPTIONAL MATCH (sfx:A11SfxAsset)
          RETURN count(DISTINCT agent) AS agents,
                 count(DISTINCT domain) AS domains,
                 count(DISTINCT sfx) AS sfxAssets,
                 count(DISTINCT r) AS links
        `, { packId: pack.id });
        const record = summary.records[0];
        return {
          ok: true,
          name: endpoint.name,
          uri: endpoint.uri,
          database: endpoint.database,
          agents: toPlain(record.get('agents')),
          domains: toPlain(record.get('domains')),
          sfxAssets: toPlain(record.get('sfxAssets')),
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

async function syncPack(session, pack, endpoint) {
  const constraints = [
    'CREATE CONSTRAINT a11_domain_pack_id IF NOT EXISTS FOR (n:A11DomainPack) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_domain_entity_id IF NOT EXISTS FOR (n:A11DomainEntity) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_agent_profile_id IF NOT EXISTS FOR (n:A11AgentProfile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_knowledge_domain_id IF NOT EXISTS FOR (n:A11KnowledgeDomain) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_capability_tool_id IF NOT EXISTS FOR (n:A11CapabilityTool) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_cultural_lane_id IF NOT EXISTS FOR (n:A11CulturalLane) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_seed_card_id IF NOT EXISTS FOR (n:A11SeedCard) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_sfx_asset_id IF NOT EXISTS FOR (n:A11SfxAsset) REQUIRE n.id IS UNIQUE',
  ];
  for (const constraint of constraints) await session.run(constraint);

  await session.run(`
    MERGE (pack:A11DomainPack:A11DomainEntity {id: $packId})
    SET pack.label = $label,
        pack.kind = 'domain-pack',
        pack.mode = $mode,
        pack.schema = $schema,
        pack.generatedAt = datetime($generatedAt),
        pack.updatedAt = datetime($generatedAt),
        pack.sourcePolicy = $sourcePolicy,
        pack.endpointName = $endpointName,
        pack.endpointUri = $endpointUri,
        pack.endpointDatabase = $endpointDatabase
  `, {
    packId: pack.id,
    label: pack.label,
    mode: pack.mode,
    schema: pack.schema,
    generatedAt: pack.generatedAt,
    sourcePolicy: JSON.stringify(pack.sourcePolicy),
    endpointName: endpoint.name,
    endpointUri: endpoint.uri,
    endpointDatabase: endpoint.database,
  });

  await upsertAgents(session, pack);
  await upsertDomains(session, pack);
  await upsertTools(session, pack);
  await upsertCulturalLanes(session, pack);
  await upsertSeedCards(session, pack);
  await upsertSfxAssets(session, pack);
  await upsertHooks(session, pack);
  await upsertLinks(session, pack);
}

async function upsertAgents(session, pack) {
  const agents = pack.agents.map((agent) => ({
    ...agent,
    properties: sanitizePropertyMap({
      label: agent.name,
      name: agent.name,
      kind: 'agent',
      role: agent.role,
      surface: agent.surface,
      nindo: agent.nindo,
      tone: agent.tone,
      domains: agent.domains,
      tools: agent.tools,
      hookChain: agent.hookChain,
      sfxPalette: agent.sfxPalette,
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $agents AS item
    MERGE (agent:A11DomainEntity:A11AgentProfile {id: item.id})
    SET agent += item.properties,
        agent.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:DESCRIBES_AGENT]->(agent)
  `, { packId: pack.id, agents, generatedAt: pack.generatedAt });
}

async function upsertDomains(session, pack) {
  const domains = pack.domains.map((domain) => ({
    ...domain,
    properties: sanitizePropertyMap({
      label: domain.label,
      kind: 'knowledge-domain',
      category: domain.category,
      summary: domain.summary,
      educationalUse: domain.educationalUse,
      examples: domain.examples,
      tags: domain.tags,
      assignedAgents: domain.assignedAgents,
      hookChain: domain.hookChain,
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $domains AS item
    MERGE (domain:A11DomainEntity:A11KnowledgeDomain {id: item.id})
    SET domain += item.properties,
        domain.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:DESCRIBES_DOMAIN]->(domain)
  `, { packId: pack.id, domains, generatedAt: pack.generatedAt });
}

async function upsertTools(session, pack) {
  const tools = pack.tools.map((tool) => ({
    ...tool,
    properties: sanitizePropertyMap({
      label: tool.label,
      kind: 'capability-tool',
      toolKind: tool.kind,
      safety: tool.safety,
      domains: tool.domains,
      assignedAgents: tool.assignedAgents,
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $tools AS item
    MERGE (tool:A11DomainEntity:A11CapabilityTool {id: item.id})
    SET tool += item.properties,
        tool.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:DESCRIBES_TOOL]->(tool)
  `, { packId: pack.id, tools, generatedAt: pack.generatedAt });
}

async function upsertCulturalLanes(session, pack) {
  const lanes = pack.culturalLanes.map((lane) => ({
    ...lane,
    properties: sanitizePropertyMap({
      label: lane.label,
      kind: 'cultural-lane',
      domains: lane.domains,
      agents: lane.agents,
      seedPolicy: lane.seedPolicy,
      hookChain: lane.hookChain,
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $lanes AS item
    MERGE (lane:A11DomainEntity:A11CulturalLane {id: item.id})
    SET lane += item.properties,
        lane.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:DESCRIBES_CULTURAL_LANE]->(lane)
  `, { packId: pack.id, lanes, generatedAt: pack.generatedAt });
}

async function upsertSeedCards(session, pack) {
  const cards = pack.seedCards.map((card) => ({
    ...card,
    properties: sanitizePropertyMap({
      label: card.title,
      kind: 'seed-card',
      domain: card.domain,
      title: card.title,
      body: card.body,
      useFor: card.useFor,
      agents: card.agents,
      hookChain: card.hookChain,
      copyrightMode: card.copyrightMode,
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $cards AS item
    MERGE (card:A11DomainEntity:A11SeedCard {id: item.id})
    SET card += item.properties,
        card.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:DESCRIBES_SEED_CARD]->(card)
  `, { packId: pack.id, cards, generatedAt: pack.generatedAt });
}

async function upsertSfxAssets(session, pack) {
  const assets = pack.sfxAssets.map((asset) => ({
    ...asset,
    properties: sanitizePropertyMap({
      label: asset.fileName,
      kind: 'sfx-asset',
      fileName: asset.fileName,
      tags: asset.tags,
      sourceRoots: asset.sourceRoots,
      pathHashes: asset.pathHashes,
      sizeBytes: asset.sizeBytes,
      modifiedAt: asset.modifiedAt,
      assignedAgents: asset.assignedAgents,
      usage: asset.usage,
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $assets AS item
    MERGE (sfx:A11DomainEntity:A11SfxAsset {id: item.id})
    SET sfx += item.properties,
        sfx.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:DESCRIBES_SFX_ASSET]->(sfx)
  `, { packId: pack.id, assets, generatedAt: pack.generatedAt });
}

async function upsertHooks(session, pack) {
  const hooks = pack.hooks.map((hook) => ({
    ...hook,
    properties: sanitizePropertyMap({
      label: hook.name,
      name: hook.name,
      kind: hook.kind,
      summary: hook.summary,
      source: 'agent-domain-pack',
    }),
  }));

  await session.run(`
    MATCH (pack:A11DomainPack {id: $packId})
    UNWIND $hooks AS item
    MERGE (hook:A11RuntimeHook {id: item.id})
    SET hook:A11DomainEntity,
        hook += item.properties,
        hook.updatedAt = datetime($generatedAt)
    MERGE (pack)-[:USES_HOOK]->(hook)
  `, { packId: pack.id, hooks, generatedAt: pack.generatedAt });
}

async function upsertLinks(session, pack) {
  const links = pack.links.map((link) => ({
    ...link,
    id: `${link.from}__${link.type}__${link.to}`,
  }));

  await session.run(`
    UNWIND $links AS item
    MATCH (a:A11DomainEntity {id: item.from})
    MATCH (b:A11DomainEntity {id: item.to})
    MERGE (a)-[r:A11_DOMAIN_LINK {id: item.id}]->(b)
    SET r.kind = item.type,
        r.source = 'seed-agent-domain-pack',
        r.updatedAt = datetime($generatedAt)
  `, { links, generatedAt: pack.generatedAt });
}

function toPlain(value) {
  if (neo4j.isInt(value)) return value.inSafeRange() ? value.toNumber() : value.toString();
  return value;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    json: true,
    target: process.env.A11_AGENT_DOMAIN_PACK_TARGET || 'local',
  };
  for (const arg of argv) {
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--pretty') parsed.json = false;
    else if (arg.startsWith('--target=')) parsed.target = arg.slice('--target='.length);
  }
  if (!['local', 'aura', 'both'].includes(parsed.target)) parsed.target = 'local';
  return parsed;
}

function output(value) {
  if (args.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`[A11 agent domain pack] ok=${value.ok} dryRun=${value.dryRun}`);
  console.log(`[A11 agent domain pack] agents=${value.pack.agents} domains=${value.pack.domains} tools=${value.pack.tools}`);
  if (value.endpoints) {
    for (const endpoint of value.endpoints) {
      console.log(`[A11 agent domain pack] ${endpoint.name}/${endpoint.database}: ok=${endpoint.ok}`);
    }
  }
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
    // Env files are optional.
  }
}

module.exports = {
  buildGraphTriplets,
  writePackFiles,
  writeJsonFallbackGraph,
  syncPack,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

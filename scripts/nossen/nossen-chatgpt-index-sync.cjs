#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(
  REPO_ROOT,
  'a11',
  'backend',
  'apps',
  'memory-base',
  'imports',
  'cellaurojeffrey-chatgpt-sorted',
  'neo4j_conversations.csv'
);
const DEFAULT_ACCOUNT = 'cellaurojeffrey-gmail';
const SOURCE = 'cellaurojeffrey-chatgpt-sorted-index';

const {
  resolveRouterConfig,
  sanitizePropertyMap,
  withSession,
} = require(path.join(REPO_ROOT, 'a11', 'backend', 'apps', 'server', 'lib', 'neo4j-memory-router.cjs'));

let neo4jDriver = null;

function getNeo4jDriver() {
  if (neo4jDriver) return neo4jDriver;
  try {
    neo4jDriver = require('neo4j-driver');
  } catch {
    neo4jDriver = require(path.join(
      REPO_ROOT,
      'a11',
      'backend',
      'apps',
      'server',
      'node_modules',
      'neo4j-driver',
    ));
  }
  return neo4jDriver;
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/nossen/nossen-chatgpt-index-sync.cjs [options]',
    '',
    'Options:',
    '  --input <csv>       Metadata CSV. Default: local sorted ChatGPT index CSV.',
    '  --account <label>   Account label used in Neo4j ids. Default: existing Aura account label.',
    '  --target <target>   aura, local, or both. Default: local.',
    '  --batch-id <id>     Batch id. Default: chatgpt-index-<account>.',
    '  --limit <n>         Limit records for tests.',
    '  --write             Write metadata-only missing conversations. Default: dry-run.',
    '  --help              Show this help.',
  ].join('\n'));
}

function parseArgs(argv) {
  const opts = {
    input: DEFAULT_INPUT,
    account: DEFAULT_ACCOUNT,
    target: 'local',
    batchId: '',
    limit: 0,
    write: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--input') opts.input = path.resolve(String(argv[++index] || '').trim());
    else if (arg === '--account') opts.account = String(argv[++index] || '').trim() || opts.account;
    else if (arg === '--target') opts.target = String(argv[++index] || 'local').trim().toLowerCase();
    else if (arg === '--batch-id') opts.batchId = String(argv[++index] || '').trim();
    else if (arg === '--limit') opts.limit = Math.max(0, Number(argv[++index] || 0) || 0);
    else if (arg === '--write') opts.write = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!['aura', 'local', 'both'].includes(opts.target)) {
    throw new Error('--target must be aura, local, or both');
  }
  opts.batchId = opts.batchId || `chatgpt-index-${opts.account}`;
  return opts;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function splitTags(value) {
  return String(value || '')
    .split(/[|;,\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function readCsvRecords(inputPath, options = {}) {
  const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((key) => key.trim());
  const index = Object.fromEntries(header.map((key, idx) => [key, idx]));
  const required = ['id', 'title', 'updated', 'score', 'themes', 'modules'];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(index, key)) {
      throw new Error(`CSV is missing required column "${key}"`);
    }
  }

  const seen = new Set();
  const records = [];
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const id = String(row[index.id] || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    records.push({
      externalId: id,
      title: String(row[index.title] || 'ChatGPT conversation').trim().slice(0, 300),
      updatedAt: String(row[index.updated] || '').trim(),
      score: Number(row[index.score] || 0) || 0,
      themes: splitTags(row[index.themes]),
      modules: splitTags(row[index.modules]),
    });
  }

  return options.limit > 0 ? records.slice(0, options.limit) : records;
}

function endpointList(config, target) {
  if (target === 'both') return [config.local, config.aura];
  return [target === 'aura' ? config.aura : config.local];
}

async function readExistingExternalIds(endpoint, records) {
  const ids = records.map((record) => record.externalId);
  if (!ids.length) return new Set();

  const rows = await withSession(endpoint, 'read', async (session) => {
    const result = await session.run(`
      UNWIND $ids AS externalId
      MATCH (c {externalId: externalId})
      WHERE c:ChatGPTConversation
         OR c:NossenConversation
         OR c:A11AuraMirror
      RETURN c.externalId AS externalId
    `, { ids });
    return result.records.map((record) => record.get('externalId')).filter(Boolean);
  });

  return new Set(rows);
}

async function writeRecords(endpoint, records, opts, existingIds) {
  if (!records.length) return { written: 0, linked: 0 };
  const now = new Date().toISOString();
  const rows = records.map((record) => ({
    id: `chatgpt:${opts.account}:${record.externalId}`,
    externalId: record.externalId,
    props: sanitizePropertyMap({
      provider: 'chatgpt',
      account: opts.account,
      externalId: record.externalId,
      title: record.title,
      updatedAt: record.updatedAt,
      indexScore: record.score,
      indexThemes: record.themes,
      indexModules: record.modules,
      metadataOnly: !existingIds.has(record.externalId),
      source: SOURCE,
    }),
  }));

  await withSession(endpoint, 'write', async (session) => {
    await session.run(`
      MERGE (b:NossenCorpusBatch:ChatGPTCorpusBatch {id: $batchId})
      SET b.provider = 'chatgpt',
          b.account = $account,
          b.source = $source,
          b.metadataOnly = true,
          b.localIndexCount = $localIndexCount,
          b.updatedAt = datetime($now)
    `, {
      batchId: opts.batchId,
      account: opts.account,
      source: SOURCE,
      localIndexCount: getNeo4jDriver().int(records.length),
      now,
    });

    for (const chunk of chunks(rows, 100)) {
      await session.run(`
        UNWIND $rows AS row
        MERGE (c:NossenConversation {id: row.id})
        ON CREATE SET c.createdFromIndexAt = datetime($now)
        SET c:ChatGPTConversation,
            c += row.props,
            c.indexedAt = datetime($now)
        WITH c
        MATCH (b:NossenCorpusBatch {id: $batchId})
        MERGE (b)-[:CONTAINS]->(c)
      `, {
        rows: chunk,
        batchId: opts.batchId,
        now,
      });
    }
  });

  return {
    written: records.filter((record) => !existingIds.has(record.externalId)).length,
    linked: records.length,
  };
}

function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

async function syncTarget(endpoint, records, opts) {
  const existingIds = await readExistingExternalIds(endpoint, records);
  const missing = records.filter((record) => !existingIds.has(record.externalId));
  const base = {
    name: endpoint.name,
    uri: endpoint.uri,
    database: endpoint.database,
    inputRecords: records.length,
    existing: existingIds.size,
    missing: missing.length,
  };

  if (!opts.write) return { ...base, written: 0, dryRun: true };

  const written = await writeRecords(endpoint, records, opts, existingIds);
  return {
    ...base,
    ...written,
    dryRun: false,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  const records = readCsvRecords(opts.input, { limit: opts.limit });
  const config = resolveRouterConfig(process.env);
  const endpoints = endpointList(config, opts.target);
  const results = [];
  for (const endpoint of endpoints) results.push(await syncTarget(endpoint, records, opts));

  console.log(JSON.stringify({
    ok: results.every((result) => result.missing === 0 || opts.write),
    dryRun: !opts.write,
    source: SOURCE,
    input: opts.input,
    account: opts.account,
    batchId: opts.batchId,
    records: records.length,
    targets: results,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[nossen-chatgpt-index-sync] ${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseCsvLine,
  readCsvRecords,
  splitTags,
};

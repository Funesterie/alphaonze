#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const neo4j = require('neo4j-driver');

loadEnv(path.resolve(__dirname, '..', '.env.local'));

const ROOTS = [
  {
    id: 'runtime-corpus',
    label: 'Runtime Corpus',
    path: path.resolve('D:/projets/funesterie/runtime/Corpus'),
    source: 'runtime',
  },
  {
    id: 'onedrive-corpus',
    label: 'OneDrive Corpus',
    path: path.resolve('C:/Users/cella/OneDrive/Corpus'),
    source: 'onedrive',
  },
];

const MAX_ENTRIES_PER_ROOT = Number(process.env.A11_NEO4J_SEED_MAX_ENTRIES || 512);
const INGESTED_AT = new Date().toISOString();

function loadEnv(filePath) {
  try {
    const content = fsSync.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim();
      if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    }
  } catch (_) {}
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function classifyEntry(name, isDirectory) {
  if (isDirectory) return 'folder';
  const ext = getEntryExtension(name);
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a'].includes(ext)) return 'audio';
  if (['.js', '.cjs', '.mjs', '.ts', '.tsx', '.py', '.ps1', '.cmd', '.json', '.yaml', '.yml'].includes(ext)) return 'code';
  if (['.txt', '.md', '.csv'].includes(ext)) return 'text';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.eml') return 'email';
  if (['.bin', '.exe', '.dll', '.iso', '.vhd', '.vhdx'].includes(ext)) return 'binary';
  return ext ? ext.slice(1) : 'file';
}

function getEntryExtension(name) {
  const lower = String(name || '').toLowerCase();
  const embeddedImageExt = lower.match(/\.(png|jpe?g|webp|gif|bmp)(?:=|$)/);
  if (embeddedImageExt) return `.${embeddedImageExt[1]}`;
  return path.extname(lower);
}

function isSensitiveName(name) {
  const lower = name.toLowerCase();
  return /^k\d{6,}.*\.pdf$/i.test(name)
    || lower.includes('recovery')
    || lower.includes('two-factor')
    || lower.includes('2fa')
    || lower.includes('hetzner');
}

function publicName(name) {
  if (!isSensitiveName(name)) return name;
  const ext = path.extname(name).toLowerCase() || '.file';
  return `redacted-sensitive${ext}`;
}

async function collectRootEntries(root) {
  let entries = [];
  try {
    entries = await fs.readdir(root.path, { withFileTypes: true });
  } catch (error) {
    return {
      root,
      missing: true,
      error: error.message,
      entries: [],
    };
  }

  const collected = [];
  for (const entry of entries.slice(0, MAX_ENTRIES_PER_ROOT)) {
    const fullPath = path.join(root.path, entry.name);
    let stat = null;
    try {
      stat = await fs.stat(fullPath);
    } catch (_) {
      continue;
    }

    const kind = classifyEntry(entry.name, entry.isDirectory());
    const sensitive = isSensitiveName(entry.name);
    collected.push({
      id: `file:${stableId(root.id, entry.name)}`,
      rootId: root.id,
      name: publicName(entry.name),
      originalNameHash: stableId('name', entry.name),
      extension: entry.isDirectory() ? '' : getEntryExtension(entry.name),
      kind,
      sensitive,
      isDirectory: entry.isDirectory(),
      sizeBytes: entry.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  return {
    root,
    missing: false,
    entries: collected,
  };
}

async function writeSeed(session, rootResults, neo4jDatabase) {
  const constraints = [
    'CREATE CONSTRAINT a11_entity_id IF NOT EXISTS FOR (n:A11Entity) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_corpus_id IF NOT EXISTS FOR (n:A11Corpus) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_file_id IF NOT EXISTS FOR (n:A11CorpusFile) REQUIRE n.id IS UNIQUE',
    'CREATE CONSTRAINT a11_kind_id IF NOT EXISTS FOR (n:A11Kind) REQUIRE n.id IS UNIQUE',
  ];

  for (const cypher of constraints) {
    await session.run(cypher);
  }

  await session.run(`
    MERGE (a:A11Entity:System {id: 'a11'})
    SET a.label = 'A11',
        a.kind = 'agent_system',
        a.updatedAt = datetime($ingestedAt)
    MERGE (f:A11Entity:Organization {id: 'funesterie'})
    SET f.label = 'Funesterie',
        f.kind = 'organization',
        f.updatedAt = datetime($ingestedAt)
    MERGE (p:A11Entity:Project {id: 'alphaonze'})
    SET p.label = 'AlphaOnze',
        p.kind = 'project',
        p.updatedAt = datetime($ingestedAt)
    MERGE (g:A11Entity:Graph {id: 'neo4j-a11-knowledge-graph'})
    SET g.label = 'Neo4j A11 Knowledge Graph',
        g.database = $database,
        g.mode = 'metadata_only',
        g.updatedAt = datetime($ingestedAt)
    MERGE (f)-[:OWNS]->(p)
    MERGE (p)-[:RUNS_AGENT]->(a)
    MERGE (a)-[:USES_GRAPH]->(g)
  `, {
    database: neo4jDatabase,
    ingestedAt: INGESTED_AT,
  });

  for (const result of rootResults) {
    await session.run(`
      MATCH (a:A11Entity {id: 'a11'})
      MERGE (c:A11Corpus {id: $id})
      SET c.label = $label,
          c.source = $source,
          c.missing = $missing,
          c.entryCount = $entryCount,
          c.error = $error,
          c.pathHash = $pathHash,
          c.updatedAt = datetime($ingestedAt)
      MERGE (a)-[:INDEXES_CORPUS]->(c)
    `, {
      id: result.root.id,
      label: result.root.label,
      source: result.root.source,
      missing: result.missing,
      entryCount: result.entries.length,
      error: result.error || null,
      pathHash: stableId('path', result.root.path),
      ingestedAt: INGESTED_AT,
    });

    for (const entry of result.entries) {
      await session.run(`
        MATCH (c:A11Corpus {id: $rootId})
        MERGE (f:A11CorpusFile {id: $id})
        SET f.name = $name,
            f.kind = $kind,
            f.extension = $extension,
            f.sensitive = $sensitive,
            f.isDirectory = $isDirectory,
            f.sizeBytes = $sizeBytes,
            f.modifiedAt = datetime($modifiedAt),
            f.originalNameHash = $originalNameHash,
            f.updatedAt = datetime($ingestedAt)
        WITH c, f
        OPTIONAL MATCH (f)-[oldKind:HAS_KIND]->(old:A11Kind)
        WHERE old.id <> $kind
        DELETE oldKind
        WITH c, f
        MERGE (k:A11Kind {id: $kind})
        SET k.label = $kind
        MERGE (c)-[:CONTAINS]->(f)
        MERGE (f)-[:HAS_KIND]->(k)
      `, {
        rootId: entry.rootId,
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        extension: entry.extension,
        sensitive: entry.sensitive,
        isDirectory: entry.isDirectory,
        sizeBytes: neo4j.int(Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, entry.sizeBytes || 0))),
        modifiedAt: entry.modifiedAt,
        originalNameHash: entry.originalNameHash,
        ingestedAt: INGESTED_AT,
      });
    }
  }

  await session.run('MATCH (k:A11Kind) WHERE NOT (:A11CorpusFile)-[:HAS_KIND]->(k) DELETE k');
}

async function main() {
  const neo4jUri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const neo4jUsername = process.env.NEO4J_USERNAME || 'neo4j';
  const neo4jPassword = process.env.NEO4J_PASSWORD || '';
  const neo4jDatabase = process.env.NEO4J_DATABASE || 'neo4j';

  const driver = neo4j.driver(
    neo4jUri,
    neo4j.auth.basic(neo4jUsername, neo4jPassword),
    { disableLosslessIntegers: true }
  );

  try {
    await driver.verifyConnectivity();
    const rootResults = [];
    for (const root of ROOTS) {
      rootResults.push(await collectRootEntries(root));
    }

    const session = driver.session({ database: neo4jDatabase });
    try {
      await writeSeed(session, rootResults, neo4jDatabase);
      const countResult = await session.run(`
        MATCH (n)
        RETURN labels(n) AS labels, count(n) AS count
        ORDER BY count DESC
      `);
      const relResult = await session.run('MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY count DESC');

      const files = rootResults.reduce((total, result) => total + result.entries.length, 0);
      console.log(`[Neo4j] seeded A11 graph in ${neo4jDatabase}`);
      console.log(`[Neo4j] metadata-only corpus entries indexed: ${files}`);
      console.log('[Neo4j] nodes by label:');
      for (const record of countResult.records) {
        console.log(`- ${record.get('labels').join(':')} ${record.get('count')}`);
      }
      console.log('[Neo4j] relationships by type:');
      for (const record of relResult.records) {
        console.log(`- ${record.get('type')} ${record.get('count')}`);
      }
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error('[Neo4j] seed failed:', error.message);
  process.exit(1);
});

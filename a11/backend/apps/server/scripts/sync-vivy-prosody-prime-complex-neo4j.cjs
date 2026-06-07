#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
  buildVivyProsodyNeo4jConstraints,
  buildVivyProsodyNeo4jCypher,
  buildVivyProsodyNeo4jRows,
  buildVivyProsodyPlan,
} = require('../src/vivy/prosody-prime-complex.cjs');
const {
  resolveRouterConfig,
  withSession,
} = require('../lib/neo4j-memory-router.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');
const GRAPH_DIR = path.resolve(process.env.A11_VIVY_PROSODY_OUT_DIR || path.join(A11_ROOT, 'runtime', 'knowledge-graph'));
const OUT_JSON = path.join(GRAPH_DIR, 'vivy-prosody-prime-complex.json');
const OUT_CYPHER = path.join(GRAPH_DIR, 'vivy-prosody-prime-complex.cypher');

function loadEnvFiles() {
  const candidates = [
    path.join(SERVER_ROOT, '.env.local'),
    path.join(SERVER_ROOT, '.env'),
    path.join(A11_ROOT, '.env.local'),
    path.join(A11_ROOT, '.env'),
    path.join(WORKSPACE_ROOT, 'a11mcp', '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const readValue = (name) => {
    const prefix = `--${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : '';
  };
  return {
    dryRun: args.has('--dry-run'),
    writeFiles: !args.has('--no-write-files'),
    pretty: args.has('--pretty'),
    target: readValue('target') || 'local',
    text: readValue('text'),
    inputJson: readValue('input-json'),
  };
}

function loadInput(options) {
  if (options.inputJson) {
    const filePath = path.resolve(options.inputJson);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return {
    mode: 'song',
    songArtists: ['djeff', 'vivy'],
    songMood: 'rap moto sombre, hook clair, tension cinematic',
    songText: options.text || [
      '[Verse 1 - Djeff]',
      "Un quatorzieme dans la bombonne, deux point deux dans l'huile.",
      'Double radiateur fresh, casque visse, pignon couronne crante.',
      '[Chorus - Duo]',
      'Quand la vitesse monte, Vivy tient le phare et Djeff garde le flow.',
    ].join('\n'),
  };
}

function writeArtifacts(plan, rows, cypher, options) {
  if (!options.writeFiles) return {};
  fs.mkdirSync(GRAPH_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ plan, neo4j: rows }, null, options.pretty ? 2 : 0), 'utf8');
  fs.writeFileSync(OUT_CYPHER, [
    ...buildVivyProsodyNeo4jConstraints().map((constraint) => `CYPHER 25\n${constraint};`),
    '',
    `${cypher};`,
    '',
  ].join('\n'), 'utf8');
  return { json: OUT_JSON, cypher: OUT_CYPHER };
}

async function applyToNeo4j(rows, target) {
  return withSession(target, 'write', async (session) => {
    for (const constraint of buildVivyProsodyNeo4jConstraints()) {
      await session.run(`CYPHER 25\n${constraint}`);
    }
    const result = await session.run(buildVivyProsodyNeo4jCypher(), rows);
    const first = result.records[0];
    return {
      name: target.name,
      database: target.database,
      segments: first ? Number(first.get('segments')?.toNumber?.() ?? first.get('segments') ?? 0) : 0,
      points: first ? Number(first.get('points')?.toNumber?.() ?? first.get('points') ?? 0) : 0,
    };
  });
}

async function main() {
  loadEnvFiles();
  const options = parseArgs();
  const input = loadInput(options);
  const plan = buildVivyProsodyPlan(input);
  const rows = buildVivyProsodyNeo4jRows(plan);
  const cypher = buildVivyProsodyNeo4jCypher();
  const artifacts = writeArtifacts(plan, rows, cypher, options);
  const result = {
    ok: true,
    dryRun: options.dryRun,
    target: options.target,
    schema: plan.schema,
    planId: plan.id,
    summary: plan.summary,
    artifacts,
    neo4j: [],
  };

  if (!options.dryRun) {
    const config = resolveRouterConfig(process.env);
    const targets = options.target === 'both'
      ? [config.local, config.aura]
      : [config[options.target] || config.local];
    for (const target of targets) {
      result.neo4j.push(await applyToNeo4j(rows, target));
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: 'sync_vivy_prosody_prime_complex_failed',
    message: String(error?.message || error),
  }, null, 2));
  process.exitCode = 1;
});

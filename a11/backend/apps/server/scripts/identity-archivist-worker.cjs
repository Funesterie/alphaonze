#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildEcosystemScope,
} = require('../src/knowledge/ecosystem-scope.cjs');
const {
  buildEcosystemCorpus,
} = require('../src/knowledge/ecosystem-corpus.cjs');
const {
  applyArchivistPatchesToCorpus,
  buildIdentityArchivistReport,
  toIdentityTagsCypher,
  toIdentityTagsMarkdown,
} = require('../src/knowledge/identity-archivist.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const RUNTIME_ROOT = path.resolve(process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
const GRAPH_DIR = path.join(RUNTIME_ROOT, 'knowledge-graph');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scopePath = path.join(GRAPH_DIR, 'funesterie-ecosystem-scope.json');
  const corpusPath = path.join(GRAPH_DIR, 'funesterie-ecosystem-corpus.json');
  const scope = readJsonOptional(scopePath) || buildEcosystemScope({ workspaceRoot: path.resolve(A11_ROOT, '..') });
  const corpus = readJsonOptional(corpusPath) || buildEcosystemCorpus(scope);
  const report = buildIdentityArchivistReport(scope, corpus);

  const jsonPath = path.join(GRAPH_DIR, 'identity-tags.json');
  const markdownPath = path.join(GRAPH_DIR, 'identity-tags.md');
  const cypherPath = path.join(GRAPH_DIR, 'identity-tags.cypher');

  if (!args.dryRun) {
    fs.mkdirSync(GRAPH_DIR, { recursive: true });
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(markdownPath, toIdentityTagsMarkdown(report), 'utf8');
    fs.writeFileSync(cypherPath, toIdentityTagsCypher(report), 'utf8');
    if (args.writeCorpus) {
      fs.writeFileSync(corpusPath, `${JSON.stringify(applyArchivistPatchesToCorpus(corpus, report), null, 2)}\n`, 'utf8');
    }
  }

  output({
    ok: true,
    dryRun: args.dryRun,
    writeCorpus: args.writeCorpus,
    summary: report.summary,
    files: args.dryRun ? {} : {
      jsonPath,
      markdownPath,
      cypherPath,
      ...(args.writeCorpus ? { corpusPath } : {}),
    },
  });
}

function readJsonOptional(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    writeCorpus: argv.includes('--write-corpus'),
  };
}

function output(value) {
  console.log(JSON.stringify(value, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
  });
}

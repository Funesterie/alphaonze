#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const {
  buildVivyGraphCorpus,
  buildVivyGraphSourceManifest,
  syncVivyGraphCorpus,
  toManifestMarkdown,
} = require('../src/knowledge/vivy-graph-access.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const A11_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..');
const WORKSPACE_ROOT = path.resolve(A11_ROOT, '..');
const DEFAULT_PASS_FILE = 'C:\\Users\\Djeff\\Desktop\\pass.txt';

function loadEnvFiles() {
  const candidates = [
    path.join(SERVER_ROOT, '.env'),
    path.join(SERVER_ROOT, '.env.local'),
    path.join(A11_ROOT, '.env'),
    path.join(A11_ROOT, '.env.local'),
    path.join(WORKSPACE_ROOT, 'a11mcp', '.env'),
    process.env.A11_MEMORY_PASS_FILE || DEFAULT_PASS_FILE,
  ];
  for (const envPath of candidates) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath, override: /\.env\.local$/i.test(envPath), quiet: true });
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  const readValue = (name, fallback = '') => {
    const prefix = `--${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    if (found) return found.slice(prefix.length);
    const index = argv.indexOf(`--${name}`);
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
    return fallback;
  };
  return {
    dryRun: flags.has('--dry-run'),
    writeFiles: !flags.has('--no-write-files'),
    pretty: flags.has('--pretty'),
    target: readValue('target', process.env.VIVY_GRAPH_NEO4J_TARGET || 'aura'),
    runtimeRoot: readValue('runtime-root', process.env.A11_RUNTIME_ROOT || ''),
  };
}

function redactError(value) {
  return String(value || '').replace(/(password|token|secret|key)[^",}\s]*/gi, '$1:[redacted]');
}

function writeArtifacts(corpus, options) {
  if (!options.writeFiles) return {};
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.A11_RUNTIME_ROOT || path.join(A11_ROOT, 'runtime'));
  const graphDir = path.join(runtimeRoot, 'knowledge-graph');
  fs.mkdirSync(graphDir, { recursive: true });
  const manifestPath = path.join(graphDir, 'vivy-graph-manifest.json');
  const markdownPath = path.join(graphDir, 'vivy-graph-manifest.md');
  const corpusPath = path.join(graphDir, 'vivy-graph-corpus.json');
  const spacing = options.pretty ? 2 : 0;
  fs.writeFileSync(manifestPath, JSON.stringify(corpus.manifest, null, spacing), 'utf8');
  fs.writeFileSync(markdownPath, toManifestMarkdown(corpus.manifest), 'utf8');
  fs.writeFileSync(corpusPath, JSON.stringify({
    schema: corpus.schema,
    id: corpus.id,
    generatedAt: corpus.generatedAt,
    summary: corpus.summary,
    files: corpus.files,
  }, null, spacing), 'utf8');
  return { manifestPath, markdownPath, corpusPath };
}

async function main() {
  loadEnvFiles();
  const options = parseArgs();
  const corpus = buildVivyGraphCorpus(options);
  const artifacts = writeArtifacts(corpus, options);

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dryRun: true,
      target: options.target,
      manifest: buildVivyGraphSourceManifest(options).summary,
      corpus: corpus.summary,
      artifacts,
    }, null, 2)}\n`);
    return;
  }

  const sync = await syncVivyGraphCorpus({
    ...options,
    corpus,
    target: options.target,
  });
  process.stdout.write(`${JSON.stringify({
    ...sync,
    dryRun: false,
    artifacts,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${redactError(error.stack || error.message || error)}\n`);
  process.exitCode = 1;
});

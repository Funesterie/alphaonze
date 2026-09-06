#!/usr/bin/env node
'use strict';

/**
 * Build a secret/copyright-safe reference digest for Funesterie détente/humour.
 *
 * This script intentionally does NOT publish or inject raw subtitles/dialogues.
 * It reads the local reference pool/catalogue, converts it to abstract traits,
 * and writes only capsules usable by A11/Vivy/Djeff/K44.
 */

const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');
const {
  buildReferenceCapsuleContext,
  loadReferenceCapsuleState,
  resolveReferenceRoot,
} = require('../src/chat/funesterie-reference-capsules.cjs');

function parseArgs(argv = []) {
  const opts = {
    dryRun: false,
    noFetch: false,
    pretty: false,
    source: '',
    out: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-fetch') opts.noFetch = true;
    else if (arg === '--pretty') opts.pretty = true;
    else if (arg === '--source' && argv[i + 1]) opts.source = path.resolve(argv[++i]);
    else if (arg === '--out' && argv[i + 1]) opts.out = path.resolve(argv[++i]);
  }
  return opts;
}

function writeJson(filePath, payload, pretty = true) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, pretty ? 2 : 0));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = { ...process.env };
  if (opts.source) env.FUNESTERIE_REFERENCE_ROOT = opts.source;
  const referenceRoot = resolveReferenceRoot(env);
  const state = loadReferenceCapsuleState(env, { maxEntries: 24 });
  const context = buildReferenceCapsuleContext(env, { maxChars: 3000 });
  const runtimeRoot = getCanonicalRuntimeRoot(env);
  const outFile = opts.out || path.join(runtimeRoot, 'knowledge', 'detente-humour', 'funesterie-reference-capsules.json');
  const payload = {
    ok: state.ok,
    schema: 'funesterie.reference_capsules.v1',
    generatedAt: new Date().toISOString(),
    sourceRootFound: Boolean(referenceRoot),
    sourceRootHint: referenceRoot ? path.basename(referenceRoot) : null,
    fetchSkipped: true,
    fetchReason: opts.noFetch ? 'no_fetch_requested' : 'ingest_only_no_network',
    copyrightMode: 'abstract-traits-no-raw-dialogue',
    quota: state.quota,
    dailyPool: state.dailyPool,
    languages: state.languages,
    traits: state.traits,
    entries: state.entries,
    context,
    rules: [
      'Do not expose raw subtitles/dialogue in prompts or public answers.',
      'Use references as timing, archetype, scene mechanics, rhythm and resilience only.',
      'Refuse exact script/lyrics lookup; offer abstract reference analysis.',
    ],
  };

  if (!opts.dryRun) {
    writeJson(outFile, payload, opts.pretty || true);
  }
  console.log(JSON.stringify({
    ok: payload.ok,
    wrote: opts.dryRun ? null : outFile,
    dryRun: opts.dryRun,
    sourceRootFound: payload.sourceRootFound,
    quota: payload.quota,
    entries: payload.entries.length,
    traits: payload.traits,
    copyrightMode: payload.copyrightMode,
  }, null, 2));

  if (!payload.ok) process.exitCode = 2;
}

main();

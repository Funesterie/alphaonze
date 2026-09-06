#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  exportZenReliqueForPublic,
} = require('../src/audio/zen-relique-exporter.cjs');

function parseArgs(argv = []) {
  const args = {
    inputs: [],
    out: '',
    polish: false,
    noFlac: false,
    noWav: false,
    pretty: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--out' || entry === '-o') {
      args.out = argv[++index] || '';
    } else if (entry === '--polish' || entry === '--protective-polish') {
      args.polish = true;
    } else if (entry === '--no-flac') {
      args.noFlac = true;
    } else if (entry === '--no-wav') {
      args.noWav = true;
    } else if (entry === '--pretty') {
      args.pretty = true;
    } else if (entry === '--help' || entry === '-h') {
      args.help = true;
    } else if (entry && !entry.startsWith('--')) {
      args.inputs.push(entry);
    }
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/export-zen-relique.cjs <relique.wav> [autre.wav...] --out <dossier> [--polish]',
    '',
    'Sorties:',
    '  *.public.wav',
    '  *.public.flac',
    '  *.public.manifest.json',
    '  *.public-polished.wav / *.public-polished.flac si --polish',
    '',
    'Le fichier relique source est conservé intact.',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputs.length) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const results = [];
  for (const input of args.inputs) {
    const inputPath = path.resolve(input);
    const outputDir = args.out ? path.resolve(args.out) : path.dirname(inputPath);
    const result = await exportZenReliqueForPublic({
      inputPath,
      outputDir,
      polish: args.polish,
      writeFlac: !args.noFlac,
      writeWav: !args.noWav,
    });
    results.push({
      input: inputPath,
      manifest: result.manifestPath,
      repairs: result.repairs,
      outputs: Object.fromEntries(
        Object.entries(result.outputs || {}).map(([key, value]) => [key, value.path])
      ),
    });
  }

  const payload = { ok: true, count: results.length, results };
  console.log(JSON.stringify(payload, null, args.pretty ? 2 : 0));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error?.message || error),
    code: error?.code || undefined,
  }));
  process.exit(1);
});

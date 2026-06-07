#!/usr/bin/env node
'use strict';

const {
  decodeFunesteZenFile,
  encodeFunesteZenFile,
  parseZen
} = require('../src/index.cjs');

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function usage() {
  return [
    'Usage:',
    '  funeste-zen encode --in input.json --out archive.zen --key-env FUNESTE_ZEN_KEY',
    '  funeste-zen decode --in archive.zen --out output.json --key-env FUNESTE_ZEN_KEY',
    '  funeste-zen inspect --in archive.zen',
    '',
    'Dev fixtures only:',
    '  funeste-zen encode --in input.txt --out sample.zen --allow-plaintext'
  ].join('\n');
}

function resolveKey(args) {
  const keyEnv = valueAfter(args, '--key-env');
  if (keyEnv) return process.env[keyEnv] || '';
  return process.env.FUNESTE_ZEN_KEY || process.env.ZEN_KEY || '';
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const input = valueAfter(args, '--in');
  const output = valueAfter(args, '--out');
  const manifest = {};
  const intent = valueAfter(args, '--intent');
  const corpus = valueAfter(args, '--corpus');

  if (intent) manifest.intent = intent;
  if (corpus) manifest.corpus = corpus;

  if (!command || !input) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  try {
    if (command === 'encode') {
      const out = encodeFunesteZenFile(input, output, {
        key: resolveKey(args),
        allowPlaintext: args.includes('--allow-plaintext'),
        manifest
      });
      process.stdout.write(`${out}\n`);
      return;
    }

    if (command === 'decode') {
      decodeFunesteZenFile(input, output, { key: resolveKey(args) });
      process.stdout.write(`${output || 'decoded'}\n`);
      return;
    }

    if (command === 'inspect') {
      const parsed = parseZen(input);
      process.stdout.write(`${JSON.stringify(parsed.header, null, 2)}\n`);
      return;
    }

    console.error(usage());
    process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

main();

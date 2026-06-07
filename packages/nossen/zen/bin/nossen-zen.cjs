#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const {
  decodeZenFile,
  encodeZenFile,
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
    '  nossen-zen encode --in input.json --out archive.zen --key-env ZEN_KEY',
    '  nossen-zen decode --in archive.zen --out output.json --key-env ZEN_KEY',
    '  nossen-zen inspect --in archive.zen',
    '',
    'Dev fixtures only:',
    '  nossen-zen encode --in input.txt --out sample.zen --allow-plaintext'
  ].join('\n');
}

function resolveKey(args) {
  const keyEnv = valueAfter(args, '--key-env');
  if (keyEnv) return process.env[keyEnv] || '';
  return process.env.ZEN_KEY || '';
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const input = valueAfter(args, '--in');
  const output = valueAfter(args, '--out');

  if (!command || !input) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  try {
    if (command === 'encode') {
      const out = encodeZenFile(input, output, {
        key: resolveKey(args),
        allowPlaintext: args.includes('--allow-plaintext')
      });
      process.stdout.write(`${out}\n`);
      return;
    }

    if (command === 'decode') {
      decodeZenFile(input, output, { key: resolveKey(args) });
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

if (!fs.existsSync(__filename)) {
  process.exitCode = 1;
} else {
  main();
}

#!/usr/bin/env node
'use strict';

const {
  decodeFunesteZenFileAsync,
  encodeFunesteZenFileAsync,
  inspectZen,
  verifyFunesteZenFileAsync
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
    '  funeste-zen inspect --in archive.zen [--json]',
    '  funeste-zen verify --in archive.zen --key-env FUNESTE_ZEN_KEY [--json]',
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

function limitOptions(args) {
  const result = {};
  const flags = {
    '--max-container-bytes': 'maxContainerBytes',
    '--max-header-bytes': 'maxHeaderBytes',
    '--max-payload-bytes': 'maxPayloadBytes',
    '--max-raw-bytes': 'maxRawBytes'
  };
  for (const [flag, property] of Object.entries(flags)) {
    const raw = valueAfter(args, flag);
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${flag} must be a positive integer`);
    result[property] = value;
  }
  return result;
}

function writeResult(value, json, text) {
  process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${text}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const input = valueAfter(args, '--in');
  const output = valueAfter(args, '--out');
  const json = args.includes('--json');
  const limits = limitOptions(args);

  if (!command || !input) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (command === 'encode') {
    const outputPath = output || `${input}.zen`;
    const written = await encodeFunesteZenFileAsync(input, outputPath, {
      ...limits,
      key: resolveKey(args),
      allowPlaintext: args.includes('--allow-plaintext')
    });
    writeResult({ outputPath: written }, json, written);
    return;
  }

  if (command === 'decode') {
    const outputPath = output || `${input}.decoded`;
    const decoded = await decodeFunesteZenFileAsync(input, outputPath, { ...limits, key: resolveKey(args) });
    writeResult({ outputPath: decoded.outputPath, rawBytes: decoded.rawBytes }, json, decoded.outputPath);
    return;
  }

  if (command === 'inspect') {
    const inspection = inspectZen(input, limits);
    writeResult(inspection, json, `${inspection.header.format} v${inspection.header.version} ${inspection.header.mode}`);
    return;
  }

  if (command === 'verify') {
    const verification = await verifyFunesteZenFileAsync(input, { ...limits, key: resolveKey(args) });
    writeResult(verification, json, `${verification.format} v${verification.version} valid`);
    return;
  }

  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error.code || 'ZEN_ERR'}: ${error.message}\n`);
  process.exitCode = 1;
});
